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
const bcrypt = require('bcrypt')
const db = require('./models')
const GameRunner = require('./gameRunner')
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

  const gameRunner = new GameRunner(redisUrl, localDevGame)

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

    let lastPlayerView = null

    const sendPlayerView = async () => {
      const data = await redisClient.get(`session-player-state-${req.sessionId}-${req.userId}`)
      if (data !== lastPlayerView) {
        ws.send(data)
        lastPlayerView = data
      }
    }

    gameRunner.startSession(session.id).catch(error => {
      console.error("error starting session!", error)
    })

    const sessionEventKey = `session-events-${sessionId}`
    ws.on('message', async (data) => {
      const message = JSON.parse(data)
      await redisClient.push(sessionEventKey, {playerId: req.userId, ...message})
    })

    const subscriber = redis.createClient(redisUrl)
    subscriber.subscribe(channelName)
    subscriber.on("message", async (channel, data) => {
      await sendPlayerView()
    })

    ws.on("close", () => {
      subscriber.unsubscribe()
      subscriber.quit()
      gameRunner.stopSession(session.id)
    })

    ws.on("error", error => {
      subscriber.unsubscribe()
      subscriber.quit()
      gameRunner.stopSession(session.id)
      throw error
    })

    await sendPlayerView()
  }
  wss.on("connection", onWssConnection)

  return server
}
