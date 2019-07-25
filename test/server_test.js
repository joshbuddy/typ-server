const createServer = require('../server')
const WebSocket = require('ws')
const jwt = require("jsonwebtoken");
const assert = require('assert')

describe("Server", () => {
  beforeEach(done => {
    this.secretKey = "some great secret"
    this.server = createServer({redis_url: "redis://localhost:6379"})
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

  it("should accept an authorized connection", done => {
    const ws = new WebSocket("ws://localhost:3000", {headers: {authorization: "1"}})

    ws.on('open', () => {
      ws.send(JSON.stringify({"some": "action"}))
    })
    ws.on('message', (message) => {
      assert.deepEqual(JSON.parse(message), {"some": "action"})
      ws.close()
    })

    ws.on('close', () => {
      done()
    })
  })
})
