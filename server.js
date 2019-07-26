const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const redis = require("redis");
const bodyParser = require('body-parser')
const jwt = require("jsonwebtoken")
const path = require('path')
const db = require('./models')

module.exports = ({redis_url}) => {
  const app = express();
  const server = http.createServer(app);

  app.use(bodyParser.json())

  app.get('/', (req, res) => res.sendFile('index.html'))

  app.post('/games', async (req, res) => {
    const game = await db.Game.create({name, req.body.name, content: new Buffer(req.body.content, 'base64')})
    res.json({id: game.id})
  })

  app.get('/games/:id/*', (req, res) => {
    res.sendFile(`${__dirname}/game/${req.params[0]}`)
  })

  app.post('/sessions', (req, res) => {
    const game = req.body.game
    // find game object, or 400
    // get id of game object, set it in new session
    db.Session({creator: req.userId, game: game})
  })

  app.get('/sessions/:id', (req, res) => {
    // get game session info
  })

  const verifyClient = async (info, verified) => {
    if (!info.req.headers.hasOwnProperty("authorization"))
      return verified(false, 401, "Authorization required");

    info.req.userId = info.req.headers.authorization;
    verified(true);
  }

  const wss = new WebSocket.Server({verifyClient, server})

  const onWssConnection = (ws, req) => {
    const channel = `game0`;
    const subscriber = redis.createClient(redis_url);
    const gameClass = require('./game/server.js')
    let state = 'new'
    let gameInterface = null
    let lastPlayerState = null
    subscriber.subscribe(channel);

    ws.on("message", data => {
      const message = JSON.parse(data)
      switch(message.type) {
        case 'joinGame':
          gameInterface = new gameClass(req.userId)
          break
        case 'startGame':
          gameInterface.start()
          break
        case 'action':
          gameInterface.receiveAction(message)
          const newPlayerState = gameInterface.getPlayerState()
          if (newPlayerState !== lastPlayerState) {
            lastPlayerState = newPlayerState
            ws.send(JSON.stringify(lastPlayerState))
          }
          break
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
    subscriber.on("message", (channel, message) => {
      JSON.parse(message)
      gameInterface.setState()
    })
  }

  wss.on("connection", onWssConnection);

  return server
}
