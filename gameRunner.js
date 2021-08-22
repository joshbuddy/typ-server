const redis = require("redis")
const asyncRedis = require("async-redis");
const Redlock = require("redlock");
const { NodeVM } = require('vm2')
const GameInterface = require('./game/interface')
const db = require('./models')

class GameRunner {
  constructor(redisUrl, localDevGame) {
    this.redisUrl = redisUrl
    this.localDevGame = localDevGame
    this.runningSessionIds = new Set()
    this.redisClient = asyncRedis.createClient(redisUrl)
  }

  sessionEventKey(sessionId) {
    return `session-events-${sessionId}`
  }

  async startSession(sessionId, userId) {
    if (this.runningSessionIds.has(sessionId)) return
    this.runningSessionIds.add(sessionId)

    const lockLeaseTime = 10000
    const sessionLockKey = `session-lock-${sessionId}`
    const redlockClient = redis.createClient(this.redisUrl)
    const redlock = new Redlock(
      // You should have one client for each independent redis node
      // or cluster.
      [redlockClient],
      {
        driftFactor: 0.01,
        retryCount: 0, // don't retry
      }
    );

    while(this.runningSessionIds.has(sessionId)) {
      let lock
      try {
        lock = await redlock.acquire([sessionLockKey], lockLeaseTime)
        console.log("HAS LOCK")
        let lastLockTime = new Date().getTime()
        const session = await db.Session.findByPk(sessionId)
        const game = session.gameId === -1 ? this.localDevGame : await session.getGame()
        const gameInstance = new GameInterface()
        const vm = new NodeVM({
          console: 'inherit',
          sandbox: {game: gameInstance},
          require: {
            external: true,
          },
        })

        gameInstance.on('update', async (userId, state) => {
          await this.redisClient.publish(this.sessionEventKey(sessionId), JSON.stringify({
            type: 'state',
            userId: userId,
            state
          }))
        })

        const serverBuffer = game.file("/server.js")
        vm.run(serverBuffer.toString())

        const startGame = userId => {
          gameInstance.addPlayer(userId)
          gameInstance.start().then({
            // TODO handle this promise resolution (end of game)
          }).catch(e => {
            console.error('ERROR DURING PLAY', e)
            // TODO not enough players but this should be an explicit start command
          })
        }

        const gameAction = (userId, action, ...args) => {
          console.log('gameAction', action, args)

          const persist = gameInstance.receiveAction(userId, action, ...args)
          // TODO error handling?
          // TODO record history
        }

        const processGameEvent = async (message) => {
          switch(message.type) {
            case 'startGame': return await startGame(message.userId)
            case 'action': return await gameAction(message.userId, ...message.payload)
            default: return console.log("unknown message", sessionId, message)
          }
        }

        while (this.runningSessionIds.has(sessionId)) {
          let timeRemaining = lockLeaseTime - (new Date().getTime() - lastLockTime) - 1000
          while (timeRemaining > 0) {
            const client = asyncRedis.decorate(await this.redisClient.duplicate())
            const data = await client.blpop(this.sessionEventKey(sessionId), timeRemaining)
            await processGameEvent(JSON.parse(data[1]))
            timeRemaining = lockLeaseTime - (new Date().getTime() - lastLockTime) - 1000
          }
          lock = await lock.extend(lockLeaseTime)
          lastLockTime = new Date().getTime()
        }
      } catch (e) {
        console.error("ERROR IN GAME RUNNER LOOP", e)
      } finally {
        if (lock) await lock.release()
      }
    }
  }

  async stopSession(sessionId) {
    this.runningSessionIds.delete(sessionId)
  }
}

module.exports = GameRunner
