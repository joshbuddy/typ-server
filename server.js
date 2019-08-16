const _ = require('lodash')
const url = require('url')
const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const redis = require("redis");
const bodyParser = require('body-parser')
const jwt = require("jsonwebtoken")
const sequelize = require('sequelize')
const mime = require('mime')
const { NodeVM } = require('vm2');
const bcrypt = require('bcrypt')
const GameInterface = require('./gameInterface')
const db = require('./models')

module.exports = ({secretKey, redisUrl}) => {
  const app = express();
  const server = http.createServer(app);

  app.set('view engine', 'ejs')
  app.use(bodyParser.json({limit: '50mb'}))
  app.use((req, res, next) => {
    if (!req.headers.hasOwnProperty("authorization")) return next()

    const token = req.headers.authorization.replace("JWT ", "");
    try {
      jwt.verify(
        token,
        secretKey,
        {
          ignoreExpiration: true
        },
        (error, decoded) => {
          if (error) return res.status(401).end('permission denied')
          req.userId = decoded.id;
          next()
        }
      );
    } catch (error) {
      console.error("wssVerifyClient: ", error);
      return res.status(401).end('permission denied')
    }
  })

  app.post('/users', async (req, res) => {
    const name = req.body.name
    const rawPassword = req.body.password
    const email = req.body.email

    const password = await bcrypt.hash(rawPassword, 10)

    const user = await db.User.create({name, password, email})
    res.status(201).json({id: user.id})
  })

  app.post('/login', async (req, res) => {
    const name = req.body.name
    const password = req.body.password
    const user = await db.User.findOne({ where: {name} })
    if (!user) return res.status(401).end('')
    const correctPassword = await bcrypt.compare(password, user.password)
    if (!correctPassword) return res.status(401).end('')
    const token = jwt.sign({id: user.id}, secretKey)
    res.json({token})
  })

  app.get('/', async (req, res) => {
    const sessions = await db.Session.findAll()
    res.render('index', {sessions: sessions})
  })

  app.get('/sessions/new', async (req, res) => {
    const games = await db.Game.findAll({attributes: ['name', [sequelize.fn('max', sequelize.col('id')), 'maxId']] ,group: ['name'],raw: true})
    res.render('sessions-new', {games: games})
  })

  app.post('/games', async (req, res) => {
    // if (!req.userId) return res.status(401).end('permission denied')

    const game = await db.Game.create({name: req.body.name, content: Buffer.from(req.body.content, 'base64')})
    res.json({id: game.id})
  })

  app.get('/games/:id/*', async (req, res) => {
    if (!req.userId) return res.status(401).end('permission denied')
    const game = await db.Game.findByPk(req.params.id)
    console.log("req.params[0]", req.params[0])
    const buf = game.contentZip.readFile(`/${req.params[0]}`)
    res.type(mime.getType(req.params[0]))
    res.end(buf)
  })

  app.post('/sessions', async (req, res) => {
    if (!req.userId) return res.status(401).end('permission denied')
    const gameName = req.body.game
    const game = await db.Game.findOne({where: {name: gameName}, order: [['id', 'DESC']]})
    const session = await db.Session.create({creatorId: req.userId, gameId: game.id})
    const userSession = await db.SessionUser.create({userId: req.userId, sessionId: session.id})
    res.json({id: session.id})
  })

  app.get('/sessions/:id', async (req, res) => {
    if (!req.userId) return res.status(401).end('permission denied')
    const session = await db.Session.findByPk(req.params.id)
    res.json(session)
  })

  app.post('/user-sessions/:id', async (req, res) => {
    if (!req.userId) return res.status(401).end('permission denied')
    const userSession = await db.SessionUser.create({userId: req.userId, sessionId: req.params.id})
    res.json({id: userSession.id})
  })

  const verifyClient = async (info, verified) => {
    if (!info.req.headers.hasOwnProperty("authorization"))
      return verified(false, 401, "Authorization required");

    const token = info.req.headers.authorization.replace("JWT ", "");
    try {
      jwt.verify(
        token,
        secretKey,
        {
          ignoreExpiration: true
        },
        (error, decoded) => {
          if (error) {
            verified(false, 401, "Unauthorized");
          } else {
            info.req.userId = decoded.id;
            verified(true);
          }
        }
      );
    } catch (error) {
      console.error("wssVerifyClient: ", error);
      throw error;
    }
  }

  const wss = new WebSocket.Server({verifyClient, server})
  const publisher = redis.createClient(redisUrl);

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
    let sessionUser = await db.SessionUser.findOne({where: {userId: req.userId, sessionId: req.sessionId}})
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
    const game = await session.getGame()

    const serverBuffer = game.contentZip.readFile("/server.js")
    vm.run(serverBuffer.toString())
    const channelName = `session-${sessionUser.sessionId}`
    let lastPlayerView = null
    let lastPlayers = null

    const subscriber = redis.createClient(redisUrl);
    subscriber.subscribe(channelName)

    const startGame = async () => {
      const tx = await db.sequelize.transaction()
      const session = await db.Session.findByPk(sessionUser.sessionId, {transaction: tx, lock: {of: db.Session}})
      if (session.lastState) {
        await tx.rollback()
        return
      }
      gameInstance.start()
      await session.update({lastState: gameInstance.getState()}, {transaction: tx})
      await session.save({transaction: tx})
      await tx.commit()
      const newPlayerView = gameInstance.getPlayerView()
      if (!_.isEqual(newPlayerView, lastPlayerView)) {
        ws.send(JSON.stringify({type: 'update', data: newPlayerView}))
        lastPlayerView = newPlayerView
      }
      await publisher.publish(channelName, JSON.stringify({type: 'state'}))
    }

    const gameAction = async ([action, ...args]) => {
      console.log('gameAction', action, args);
      const tx = await db.sequelize.transaction()
      const session = await db.Session.findByPk(sessionUser.sessionId, {transaction: tx, lock: {of: db.Session}})
      if (!session.lastState) {
        await tx.rollback()
        return
      }

      gameInstance.setState(session.lastState)
      gameInstance.receiveAction(action, args)
      await session.update({lastState: gameInstance.getState()}, {transaction: tx})
      await session.save()
      await tx.commit()

      const newPlayerView = gameInstance.getPlayerView()
      if (!_.isEqual(newPlayerView, lastPlayerView)) {
        ws.send(JSON.stringify({type: 'update', data: newPlayerView}))
        lastPlayerView = newPlayerView
      }

      await publisher.publish(channelName, JSON.stringify({type: 'state'}))
    }

    const updateGamePlayers = async () => {
      const sessionUsers = await db.SessionUser.findAll({where: {sessionId: sessionUser.sessionId}, order: [['userId']]})
      sessionUsers.forEach(u => {
        gameInstance.addPlayer(u.userId)
      })
      const newPlayers = gameInstance.getPlayers()
      if (!_.isEqual(lastPlayers, newPlayers)) {
        ws.send(JSON.stringify({type: 'players', players: newPlayers}))
        lastPlayers = newPlayers
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

    const refresh = async () => {
      await updateGameState();
      ws.send(JSON.stringify({type: 'update', data: gameInstance.getPlayerView()}))
    }

    ws.on("message", async (data) => {
      const message = JSON.parse(data)
      console.log('onmessage', message.type);

      switch(message.type) {
        case 'startGame': return await startGame()
        case 'action':    return await gameAction(message.payload)
        case 'refresh':   return await refresh()
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
      }
    })

    ws.on("close", () => {
      subscriber.unsubscribe();
      subscriber.quit();
    });

    ws.on("error", error => {
      subscriber.unsubscribe();
      subscriber.quit();
      throw error;
    });
  }

  wss.on("connection", onWssConnection);

  return server
}
