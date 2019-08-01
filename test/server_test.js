const fs = require('fs')
const WebSocket = require('ws')
const jwt = require("jsonwebtoken");
const assert = require('assert')
const request = require('request')
const AdmZip = require('adm-zip')
const sequelize = require('sequelize')

const createServer = require('../server')
const db = require('../models')


const SECRET_KEY = "asdasdasd"

describe("Server", () => {
  before(done => {
    db.sequelize.sync({force:true}).then(() => done())
  })

  beforeEach(done => {
    db.User.create({email: "hello@asdf.com", password: "some-pass", username: "asd"}).then(user=> {
      this.headers = {authorization: `JWT ${jwt.sign({id: user.id}, SECRET_KEY)}`}
      this.secretKey = "some great secret"
      this.server = createServer({secretKey: SECRET_KEY, redisUrl: "redis://localhost:6379"})
      this.server.listen(3000, done)
    })
  })

  afterEach(() => {
    this.server.close()
  })

  after(async () => {
    await db.sequelize.close()
  })

  it("should reject an unauthorized connection", done => {
    const ws = new WebSocket("ws://localhost:3000/sessions/123")

    ws.on('error', (err) => {
      assert(String(err).includes('Unexpected server response: 401'))
      done()
    });
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
