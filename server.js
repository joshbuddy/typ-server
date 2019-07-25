const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const redis = require("redis");
//const jwt = require("jsonwebtoken");
//const enforce = require('express-sslify');

module.exports = ({redis_url}) => {
  const app = express();
  const server = http.createServer(app);

  app.get('/index', (req, res) => res.sendFile(''))

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
    const gameClass = require('./gameInterface')
    let gameInterface = new gameClass(req.userId)
    let lastPlayerState = null
    subscriber.subscribe(channel);

    ws.on("message", data => {
      gameInterface.receiveAction(JSON.parse(data))
      const newPlayerState = gameInterface.getPlayerState()
      if (newPlayerState !== lastPlayerState) {
        lastPlayerState = newPlayerState
        ws.send(JSON.stringify(lastPlayerState))
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

    subscriber.on("message", (channel, message) => {
      gameInterface.setState(JSON.parse(message))
    })
  }

  wss.on("connection", onWssConnection);

  return server
}
