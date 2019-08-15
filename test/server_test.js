const fs = require('fs')
const WebSocket = require('ws')
const jwt = require("jsonwebtoken");
const assert = require('assert')
const request = require('request')
const rp = require('request-promise');
const AdmZip = require('adm-zip')
const sequelize = require('sequelize')
const bcrypt = require('bcrypt')

const createServer = require('../server')
const db = require('../models')


const SECRET_KEY = "asdasdasd"

describe("Server", () => {
  beforeEach(async () => {
    for (let k in db.sequelize.models) {
      await db.sequelize.query(`TRUNCATE TABLE "${db.sequelize.models[k].tableName}" CASCADE`)
    }
  })

  beforeEach(done => {
    const app = createServer({secretKey: SECRET_KEY, redisUrl: "redis://localhost:6379"})
    this.server = app.listen(3000, done)
  })

  beforeEach(async () => {
    const user = await db.User.create({email: "hello@asdf.com", password: "some-pass", name: "asd"})
    this.headers = {authorization: `JWT ${jwt.sign({id: user.id}, SECRET_KEY)}`}
    this.secretKey = "some great secret"
  })

  afterEach(() => {
    this.server.close()
  })

  it("should reject an unauthorized connection", done => {
    const ws = new WebSocket("ws://localhost:3000/sessions/123")

    ws.on('error', (err) => {
      assert(String(err).includes('Unexpected server response: 401'))
      done()
    });
  })

  it("should allow login", async () => {
    const user = await db.User.create({name: 'joshbuddy', password: await bcrypt.hash('hello', 10)})
    const body = await rp.post("http://localhost:3000/login", {json: {name: 'joshbuddy', password: 'hello'}, headers: this.headers})
    console.log(body)
    assert(body.token, "has no token")
  })

  context("authorized", () => {
    it("should accept an authorized connection", done => {
      const ws = new WebSocket("ws://localhost:3000/sessions/123", {headers: this.headers})

      ws.on('open', () => {
        ws.close()
      })

      ws.on('close', () => {
        done()
      })
    })

    it("should allow creating a new game", (done) => {
      const gameZip = new AdmZip()
      gameZip.addFile("server.js", fs.readFileSync(__dirname + "/fixture/server.js"));
      gameZip.addFile("index.js", fs.readFileSync(__dirname + "/fixture/index.js"));

      request.post("http://localhost:3000/games", {json: {name: 'hey', content: gameZip.toBuffer().toString('base64')}, headers: this.headers}, (error, response, body) => {
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

      it("should allow creating a session", (done) => {
        request.post("http://localhost:3000/sessions", {json: {game: 'hey'}, headers: this.headers}, (error, response, body) => {
          assert(!error, "no error")
          assert(body.id, "has no id")
          done()
        })
      })

      it("should allow getting a specific asset", (done) => {
        request.get(`http://localhost:3000/games/${this.game.id}/index.js`,{headers: this.headers}, (error, response, body) => {
          assert.equal(body, fs.readFileSync(__dirname + "/fixture/index.js"))
          done()
        })
      })

      it("should allow joining a game", (done) => {
        request.post("http://localhost:3000/sessions", {json: {game: 'hey'}, headers: this.headers}, (error, response, body) => {
          assert(!error, "no error")
          assert(body.id, "has no id")
          const ws = new WebSocket(`ws://localhost:3000/sessions/${body.id}`, {headers: this.headers})
          ws.once('message', (d) => {
            done()
          })
        })
      })
    })
  })
})
