const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const redis = require("redis");
const bodyParser = require('body-parser')
const jwt = require("jsonwebtoken")
const path = require('path')
const mime = require('mime')

const db = require('./models')

module.exports = ({secretKey, redisUrl}) => {
  const app = express();
  const server = http.createServer(app);

  app.use(bodyParser.json())
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
    const password = req.body.password
    const email = req.body.email

    const user = await db.User.create({name, password, email})
    res.status(201).end('')
  })

  app.post('/login', async (req, res) => {
    const name = req.body.name
    const password = req.body.password

    const user = await db.User.login(name, password)
    if (!user) return res.status(400).end('')

    res.json({token: jwt.sign({id: user.id}, secretKey)})
  })

  app.get('/', (req, res) => res.sendFile('index.html'))

  app.post('/games', async (req, res) => {
    if (!req.userId) return res.status(401).end('permission denied')
    const game = await db.Game.create({name: req.body.name, content: new Buffer(req.body.content, 'base64')})
    res.json({id: game.id})
  })

  app.get('/games/:id/*', async (req, res) => {
    if (!req.userId) return res.status(401).end('permission denied')
    const game = await db.Game.get(req.params.id)
    const zip = new AdmZip(game.content)
    const buf = zip.readFile(req.params[0])
    res.type(mime.getType(req.params[0]))
    res.sendFile(buf)
  })

  app.post('/sessions', async (req, res) => {
    if (!req.userId) return res.status(401).end('permission denied')
    const gameName = req.body.game
    const game = await db.Game.findOne({where: {name: gameName}}, {order: [['id', 'DESC']]})
    const session = await db.Session.create({creator_id: req.userId, game_id: game.id})
    res.json({id: session.id})
  })

  app.get('/sessions/:id', async (req, res) => {
    if (!req.userId) return res.status(401).end('permission denied')
    const session = await db.Session.get(req.params.id)
    res.json(session)
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

  const onWssConnection = (ws, req) => {
    const subscriber = redis.createClient(redisUrl);
    let channel = null;
    let state = 'new'
    let gameInterface = null
    let lastPlayerState = null
    let sessionUser = null

    const joinGame = async (message) => {
      sessionUser = await db.SessionUser.create({user_id: req.userId, session_id: message.sessionId}) // TODO should be upsert
      const tempDir = await fs.mkdtemp()
      sessionUser.game.contentZip.extractAllTo(tempDir)
      const gameClass = require(`${tempDir}/server.js`)
      gameInterface = new gameClass(req.userId)
      subscriber.subscribe(`session-${sessionUser.session_id}`)
    }

    const startGame = async (message) => {
      gameInterface.start()
      const state = gameInterface.getState()
      const tx = Sequelize.transaction()
      const session = await db.Session.findById(sessionUser.session_id, {transaction: tx, lock: {of: db.Session}})
      if (session.last_state) return
      gameInterface.startGame()
      session.last_state = gameInterface.getState()
      await session.save()
    }

    const gameAction = async (message) => {
      const tx = Sequelize.transaction()
      const session = await db.Session.findById(sessionUser.session_id, {transaction: tx, lock: {of: db.Session}})
      gameInterface.setState(session.last_state)
      gameInterface.receieveAction(message.action)
      session.last_state = gameInterface.getState()
      await session.save()
      const newPlayerState = gameInterface.getPlayerState()
      if (newPlayerState !== lastPlayerState) {
        lastPlayerState = newPlayerState
        ws.send(JSON.stringify({type: 'playerState', state: lastPlayerState}))
      }
    }

    ws.on("message", async (data) => {
      const message = JSON.parse(data)
      switch(message.type) {
        case 'joinGame': return await joinGame(message)
        case 'startGame': return await startGame(message)
        case 'action': return await gameAction(message)
      }
    })

    ws.on("close", () => {
      subscriber.unsubscribe();
      subscriber.quit();
    });

    ws.on("error", error => {
      console.log(error.message);
      subscriber.unsubscribe();
      subscriber.quit();
      throw error;
    });

    // redis
    subscriber.on("message", async (channel, message) => {
      const session = await db.Session.findById(sessionUser.session_id)
      gameInterface.setState(session.last_state)
      ws.send(JSON.stringify({type: playerState, state: gameInterface.getPlayerState()}))
    })
  }

  wss.on("connection", onWssConnection);

  return server
}
