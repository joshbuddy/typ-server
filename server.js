const _ = require('lodash')
const url = require('url')
const WebSocket = require("ws")
const express = require("express")
const http = require("http")
const redis = require("redis")
const bodyParser = require('body-parser')
const jwt = require("jsonwebtoken")
const { Sequelize } = require('sequelize')
const mime = require('mime')
const { NodeVM } = require('vm2')
const bcrypt = require('bcrypt')
const GameInterface = require('./game/interface')
const db = require('./models')
const cookieParser = require('cookie-parser')
const path = require('path')

module.exports = ({secretKey, redisUrl, ...devGame }) => {
  const app = express()
  const server = http.createServer(app)
  let localDevGame, webpackCompiler

  if (devGame.name) {
    localDevGame = new db.Game({ name: devGame.name, localDir: devGame.path })
    const webpack = require('./webpack')
    webpackCompiler = webpack(path.join(devGame.path, 'client/index.js'))
  }

  app.set('view engine', 'ejs')
  app.set('views', __dirname + '/views')
  app.use(bodyParser.json({limit: '50mb'}))
  app.use(bodyParser.urlencoded({ extended: true }))
  app.use(cookieParser())
  app.use((req, res, next) => {
    try {
      verifyToken(req, (error, user) => {
        if (error) {
          throw error
        }
        if (user) {
          req.userId = user.id
        }
      })
    } catch (error) {
      console.error("verifyToken: ", error)
    }
    return next()
  })

  function verifyToken(req, callback) {
    let token = null
    if (req.headers.hasOwnProperty("authorization")) {
      token = req.headers.authorization.replace("JWT ", "")
    } else if (req.cookies && req.cookies.jwt) {
      token = req.cookies.jwt
    }
    if (!token) {
      return callback()
    }
    jwt.verify(token, secretKey, { ignoreExpiration: true }, callback)
  }

  function unauthorized(req, res, message) {
    if (req.is('json')) {
      res.status(401).end(message)
    } else {
      res.cookie('flash', message)
      res.redirect('/login')
    }
  }

  app.post('/users', async (req, res) => {
    const name = req.body.name || ''
    const rawPassword = req.body.password || ''
    const email = req.body.email || ''

    const password = await bcrypt.hash(rawPassword, 10)

    const user = await db.User.create({name, password, email})
    res.status(201).json({id: user.id})
  })

  app.get('/login', async (req, res) => {
    const message = req.cookies.flash
    res.clearCookie('flash')
    res.render('login', { message })
  })

  app.post('/login', async (req, res) => {
    const name = req.body.name || ''
    const password = req.body.password || ''
    const user = await db.User.findOne({ where: {name} })
    if (!user) return unauthorized(req, res, res, 'incorrect login')
    const correctPassword = await bcrypt.compare(password, user.password)
    if (!correctPassword) return unauthorized(req, res, 'incorrect login')
    const token = jwt.sign({id: user.id}, secretKey)
    if (req.is('json')) {
      res.json({token})
    } else {
      res.cookie('jwt',token)
      res.redirect("/")
    }
  })

  app.get('/logout', async (req, res) => {
    res.clearCookie('jwt')
    res.redirect("/")
  })

  app.get('/', async (req, res) => {
    const sessions = await db.Session.findAll({ include: [db.Game, {model: db.User, as: 'creator'}] })
    res.render('index', {sessions: sessions})
  })

  app.get('/sessions/new', async (req, res) => {
    if (!req.userId) return unauthorized(req, res, 'permission denied')
    const games = await db.Game.findAll({attributes: ['name', [Sequelize.fn('max', Sequelize.col('id')), 'maxId']], group: ['name'], raw: true})
    if (localDevGame) {
      games.unshift({maxId: -1, name: localDevGame.get('name')})
    }
    res.render('sessions-new', {games: games})
  })

  app.post('/games', async (req, res) => {
    if (!req.userId) return unauthorized(req, res, 'permission denied')

    const game = await db.Game.create({name: req.body.name, content: Buffer.from(req.body.content, 'base64')})
    res.json({id: game.id})
  })

  app.get('/games/:id/*', async (req, res) => {
    if (!req.userId) return unauthorized(req, res, 'permission denied')
    let game
    if (req.params.id === "local") {
      game = localDevGame
    } else {
      game = await db.Game.findByPk(req.params.id)
    }
    if (!game) {
      res.status(404).end('No such game')
    }
    if (!req.params[0]) {
      res.render('client', {player: req.userId, entry: req.params.id === "local" ? '/local-game/index.js' : 'index.js'})
    } else {
      const buf = game.file(`/client/${req.params[0]}`)
      res.type(mime.getType(req.params[0]))
      res.end(buf)
    }
  })

  app.post('/sessions', async (req, res) => {
    if (!req.userId) return unauthorized(req, res, 'permission denied')
    if (!req.body.gameId) return res.status(400).end('no game specified')
    const session = await db.Session.create({creatorId: req.userId, gameId: req.body.gameId})
    await db.SessionUser.create({userId: req.userId, sessionId: session.id})
    if (req.is('json')) {
      res.json({id: session.id})
    } else {
      res.redirect('/sessions/' + session.id)
    }
  })

  app.get('/sessions/:id', async (req, res) => {
    if (!req.userId) return unauthorized(req, res, 'permission denied')
    const session = await db.Session.findByPk(req.params.id, {
      include: {
        model: db.SessionUser,
        include: db.User,
      }
    })
    if (req.is('json')) {
      res.json(session)
    } else {
      res.render('session', {session, me: req.userId})
    }
  })

  app.post('/user-sessions/:id', async (req, res) => {
    if (!req.userId) return unauthorized(req, res, 'permission denied')
    const userSession = await db.SessionUser.create({userId: req.userId, sessionId: req.params.id})
    if (req.is('json')) {
      res.json({id: userSession.id})
    } else {
      res.redirect('/sessions/' + req.params.id)
    }
  })

  if (webpackCompiler) {
    app.use(
      require('webpack-dev-middleware')(webpackCompiler, {
        publicPath: '/local-game/',
      }),
    )
  }

  app.get('/play', async (req, res) => {
    const sessions = await db.Session.findAll({ include: [db.Game, {model: db.User, as: 'creator'}] })
    res.render('index', {sessions: sessions})
  })

  app.use('/local-game', express.static(path.join(__dirname, '/dist')))
  
  const verifyClient = async (info, verified) => {
    cookieParser()(info.req, null, () => {})
    try {
      verifyToken(info.req, (error, user) => {
        if (error || !user) {
          console.error("verifyClient fail: ", error, user)
          return verified(false, 401, "Unauthorized")
        }
        info.req.userId = user.id
        verified(true)
      })
    } catch (error) {
      console.error("verifyClient: ", error)
      throw error
    }
  }

  const wss = new WebSocket.Server({verifyClient, server})
  const publisher = redis.createClient(redisUrl)

  wss.shouldHandle = (req) => {
    const path = url.parse(req.url).pathname
    const match = path.match(/\/sessions\/([^\/]+)/)
    if (match) {
      req.sessionId = match[1]
      return true
    } else {
      return false
    }
  }

  const onWssConnection = async (ws, req) => {
    const sessionUser = await db.SessionUser.findOne({where: {userId: req.userId, sessionId: req.sessionId}})
    if (!sessionUser) {
      return ws.close(4001)
    }

    const gameInstance = new GameInterface(req.userId)
    const vm = new NodeVM({
      console: 'inherit',
      sandbox: {game: gameInstance},
      require: {
        external: true,
      },
    })

    const session = await sessionUser.getSession()
    const game = session.gameId === -1 ? localDevGame : await session.getGame()

    const serverBuffer = game.file("/server.js")
    vm.run(serverBuffer.toString())
    const channelName = `session-${session.id}`
    let lastPlayerView = null
    let lastPlayers = null
    let locks = []

    if (session.lastState) {
      gameInstance.setState(session.lastState)
    }

    const subscriber = redis.createClient(redisUrl)
    subscriber.subscribe(channelName)

    const startGame = async () => {
      await db.sequelize.transaction(async transaction => {
        await session.reload()
        if (session.lastState && session.lastState.phase !== 'setup') {
          throw new Error("Cannot start game unless setup phase")
        }
        try {
          gameInstance.start()
          await session.update({lastState: gameInstance.getState()}, {transaction})
        } catch(e) {
          return ws.send(JSON.stringify(e.message))
        }
        const newPlayerView = gameInstance.getPlayerView()
        if (!_.isEqual(newPlayerView, lastPlayerView)) {
          ws.send(JSON.stringify({type: 'update', data: newPlayerView}))
          lastPlayerView = newPlayerView
        }
        await publisher.publish(channelName, JSON.stringify({type: 'state'}))
      })
    }

    const gameAction = async ([action, ...args]) => {
      console.log('gameAction', action, args)

      const persist = gameInstance.setState(session.lastState)
      try {
        gameInstance.receiveAction(action, args)
      } catch(e) {
        ws.send(JSON.stringify(e.message))
      }
      if (persist) {
        await db.sequelize.transaction(async transaction => {
          if (!session.lastState) {
            throw new Error("No lastState")
          }
          await session.update({lastState: gameInstance.getState()}, {transaction})
        })
      }

      const newPlayerView = gameInstance.getPlayerView()
      if (!_.isEqual(newPlayerView, lastPlayerView)) {
        ws.send(JSON.stringify({type: 'update', data: newPlayerView}))
        lastPlayerView = newPlayerView
      }

      await publisher.publish(channelName, JSON.stringify({type: 'state'}))
    }

    const updateGamePlayers = async () => {
      const sessionUsers = await db.SessionUser.findAll({
        where: {sessionId: session.id},
        order: [['userId']],
        include: {
          model: db.User,
          attributes: ['id', 'name'],
        },
      })
      const users = sessionUsers.map(s => s.User)
      users.forEach(u => {
        gameInstance.addPlayer(u.id)
      })
      if (!_.isEqual(lastPlayers, users)) {
        ws.send(JSON.stringify({type: 'players', players: users}))
        lastPlayers = users
      }
    }

    const updateGameState = async () => {
      await session.reload()
      gameInstance.setState(session.lastState)
      const newPlayerView = gameInstance.getPlayerView()
      if (!_.isEqual(newPlayerView, lastPlayerView)) {
        ws.send(JSON.stringify({type: 'update', data: newPlayerView}))
        lastPlayerView = newPlayerView
      }
    }

    const updateLocks = async () => {
      locks = await session.getElementLocks().map(lock => ({user: lock.userId, key: lock.element}))
      ws.send(JSON.stringify({type: 'updateLocks', data: locks}))
    }

    const refresh = async () => {
      await updateGameState()
      ws.send(JSON.stringify({type: 'update', data: gameInstance.getPlayerView()}))
    }

    const requestLock = async ({key}) => {
      try {
        await db.ElementLock.destroy({where: {
          sessionId: session.id,
          element: key,
          updatedAt: {[Sequelize.Op.lt]: new Date() - 60000}
        }})
        await db.ElementLock.create({ sessionId: session.id, userId: sessionUser.userId, element: key })
      } catch (e) {
        if (!(e instanceof db.Sequelize.UniqueConstraintError)) {
          throw e
        }
      }
      await publisher.publish(channelName, JSON.stringify({type: 'locks'}))
    }

    const releaseLock = async ({key}) => {
      await db.ElementLock.destroy({where: { sessionId: session.id, userId: sessionUser.userId, element: key }})
      await publisher.publish(channelName, JSON.stringify({type: 'locks'}))
    }

    const drag = ({key, x, y}) => {
      const lock = locks.find(lock => lock.key == key)
      console.log('drag', lock, sessionUser.userId)
      if (!lock || lock.user != sessionUser.userId) return
      publisher.publish(channelName, JSON.stringify({type: 'drag', user: lock.user, key, x, y}))
    }

    const updateElement = ({user, key, x, y}) => {
      if (user == sessionUser.userId) return
      ws.send(JSON.stringify({type: 'updateElement', data: {key, x, y}}))
    }

    ws.on("message", async (data) => {
      let message
      try {
        message = JSON.parse(data)
      } catch(e) {
        console.error(`invalid json ${data}`)
      }
      console.log('--> onmessage', req.userId, message)

      switch(message.type) {
        case 'startGame': return await startGame()
        case 'action': return await gameAction(message.payload)
        case 'refresh': return await refresh()
        case 'requestLock': return await requestLock(message.payload)
        case 'releaseLock': return await releaseLock(message.payload)
        case 'drag': return await drag(message.payload)
      }
    })

    await updateGamePlayers()
    await updateGameState()

    // redis
    //   needs an update when players change
    //   needs an update when state changes
    subscriber.on("message", async (channel, data) => {
      const message = JSON.parse(data)
      switch (message.type) {
        case 'players': return await updateGamePlayers()
        case 'state':   return await updateGameState()
        case 'locks':   return await updateLocks()
        case 'drag':   return await updateElement(message)
      }
    })

    ws.on("close", () => {
      subscriber.unsubscribe()
      subscriber.quit()
    })

    ws.on("error", error => {
      subscriber.unsubscribe()
      subscriber.quit()
      throw error
    })
  }

  wss.on("connection", onWssConnection)

  return server
}
