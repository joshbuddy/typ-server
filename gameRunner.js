const _ = require('lodash')
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

  async startSession(sessionId) {
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
        const gameInstance = new GameInterface(session.lastState)
        const vm = new NodeVM({
          console: 'inherit',
          sandbox: {game: gameInstance},
          require: {
            external: true,
          },
        })

        // wheres the socket now?
        /* gameInstance.on('update', allowedActions => {
         *   ws.send(JSON.stringify({
         *     type: 'update',
         *     state: gameInstance.getPlayerView(),
         *     allowedActions,
         *   }))
         * }) */

        const serverBuffer = game.file("/server.js")
        vm.run(serverBuffer.toString())

        const pumpGameState = async () => {
          const playerViews = gameInstance.getPlayerViews()
          _.each(playerViews, async (value, key) => {
            await this.redisClient.set(`session-player-state-${sessionId}-${key}`, value, 'ex', 86400)
          })
          await this.redisClient.publish(`session-state-channel-${sessionId}`, '')
        }

        const startGame = async () => {
          await db.sequelize.transaction(async transaction => {
            if (session.lastState && session.lastState.phase !== 'setup') {
              throw new Error("Cannot start game unless setup phase")
            }
            gameInstance.start()
            await session.update({lastState: gameInstance.getState()}, {transaction})
          })
          await pumpGameState()
        }

        const gameAction = async ([action, ...args]) => {
          console.log('gameAction', action, args)

          const persist = gameInstance.receiveAction(action, args)
          if (persist) {
            await db.sequelize.transaction(async transaction => {
              if (!session.lastState) {
                throw new Error("No lastState")
              }
              await session.update({lastState: gameInstance.getState()}, {transaction})
            })
          }
          await pumpGameState()
        }

        const processGameEvent = async (message) => {
          switch(message.type) {
            case 'startGame': return await startGame({playerId: message.playerId})
            case 'action': return await gameAction({playerId: message.playerId, ...message.payload})
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
