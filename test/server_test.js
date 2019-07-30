const fs = require('fs')
const WebSocket = require('ws')
const jwt = require("jsonwebtoken");
const assert = require('assert')
const request = require('request')
const AdmZip = require('adm-zip')

const createServer = require('../server')
const db = require('../models')

const SECRET_KEY = "asdasdasd"
const headers = {authorization: `JWT ${jwt.sign({id: 1}, SECRET_KEY)}`}

describe("Server", () => {
  beforeEach(done => {
    this.secretKey = "some great secret"
    this.server = createServer({secretKey: SECRET_KEY, redisUrl: "redis://localhost:6379"})
    this.server.listen(3000, done)
  })

  afterEach(done => {
    this.server.close(done)
  })

  it("should reject an unauthorized connection", done => {
    const ws = new WebSocket("ws://localhost:3000")

    ws.on('error', (err) => {
      assert(String(err).includes('Unexpected server response: 401'))
      done()
    });
  })

  context("authorized", () => {
    it("should accept an authorized connection", done => {
      const ws = new WebSocket("ws://localhost:3000", {headers})

      ws.on('open', () => {
        ws.close()
      })

      ws.on('close', () => {
        done()
      })
    })

    it("should allow creating a new game", (done) => {
      const gameZip = new AdmZip()
      gameZip.addFile("server.js", Buffer.from("hello"));
      gameZip.addFile("index.js", Buffer.from("hello"));

      request.post("http://localhost:3000/games", {json: {name: 'hey', content: gameZip.toBuffer().toString('base64')},headers}, (error, response, body) => {
        assert(!error, "no error")
        assert(body.id, "has no id")
        done()
      })
    })

    context("with a game", () => {
      beforeEach(async () => {
        const gameZip = new AdmZip()
        gameZip.addFile("server.js", fs.readFileSync(__dirname + "/fixture/server.js"));
        gameZip.addFile("index.js", fs.readFileSync(__dirname + "/fixture/index.js"));
        this.game = await db.Game.create({name: "hey", content: gameZip.toBuffer()})
      })

      it("should allow joining a new game", (done) => {
        request.post("http://localhost:3000/sessions", {json: {game: 'hey'},headers}, (error, response, body) => {
          assert(!error, "no error")
          assert(body.id, "has no id")
          done()
        })
      })

      it("should allow getting a specific asset", (done) => {
        request.get(`http://localhost:3000/games/${this.game.id}/index.js`,{headers}, (error, response, body) => {
          assert.equal(body, fs.readFileSync(__dirname + "/fixture/index.js"))
          done()
        })
      })
    })
  })
})
