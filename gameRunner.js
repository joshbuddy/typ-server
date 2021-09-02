const asyncRedis = require("async-redis");
const advisoryLock = require('advisory-lock')
const { NodeVM } = require('vm2')
const GameInterface = require('./game/interface')
const db = require('./models')

class GameRunner {
  constructor(postgresUrl, redisUrl, localDevGame) {
    this.postgresUrl = postgresUrl
    this.redisUrl = redisUrl
    this.localDevGame = localDevGame
    this.runningSessionIds = new Set()
    this.redisClient = asyncRedis.createClient(redisUrl)
    this.mutexes = {}
  }

  sessionEventKey(sessionId) {
    return `session-events-${sessionId}`
  }

  async startSession(sessionId) {
    if (this.runningSessionIds.has(sessionId)) return
    this.runningSessionIds.add(sessionId)

    const lockLeaseTime = 6000
    const sessionLockKey = `session-lock-${sessionId}`
    this.mutexes[sessionId] = advisoryLock(this.postgresUrl)(sessionLockKey)

    while(this.runningSessionIds.has(sessionId)) {
      this.mutexes[sessionId].withLock(async () => {
        try {
          console.log(process.pid, "HAS LOCK")
          let lastLockTime = new Date().getTime()
          const session = await db.Session.findByPk(sessionId)
          const game = session.gameId === -1 ? this.localDevGame : await session.getGame()
          const gameInstance = new GameInterface()
          const playerViews = {}
          const vm = new NodeVM({
            console: 'inherit',
            sandbox: {game: gameInstance},
            require: {
              external: true,
            },
          })

          gameInstance.on('update', async ({type, userId, payload}) => {
            console.log(`R ${process.pid} ${userId}: update ${type}`)
            if (type == 'state') {
              playerViews[userId] = payload
            }
            await publish({type, userId, payload})
          })

          gameInstance.registerAction = async (player, sequence, action) => await session.createAction({player, sequence, action})

          const publish = async message => {
            await this.redisClient.publish(
              this.sessionEventKey(sessionId),
              JSON.stringify(message)
            )
          }

          const serverBuffer = game.file("/server.js")
          vm.run(serverBuffer.toString())

          const userIds = await session.getSessionUsers().map(u => u.userId)
          userIds.forEach(userId => gameInstance.addPlayer(userId))

          const history = (await session.getActions({order: ['sequence']})).map(action => (
            [action.player, action.sequence, ...action.action]
          ))
          console.log(`R restarting runner loop ${userIds}`)

          gameInstance.start(history).then(() => {
            // TODO handle this promise resolution (end of game)
          }).catch(e => {
            console.error('ERROR DURING PLAY', e)
            // TODO not enough players but this should be an explicit start command
          })

          const gameAction = (userId, sequence, action, ...args) => {
            gameInstance.receiveAction(userId, sequence, action, ...args)
          }

          const processGameEvent = async (message) => {
            console.log(`R ${process.pid} processGameEvent`, message.type)
            switch(message.type) {
              case 'action': return gameAction(message.payload.userId, message.payload.sequence, ...message.payload.action)
              case 'refresh': return publish({
                type: 'state',
                userId: message.payload.userId,
                payload: playerViews[message.payload.userId]
              })
              default: return console.log("unknown message", sessionId, message)
            }
          }

          while (this.runningSessionIds.has(sessionId)) {
            let timeRemaining = lockLeaseTime - (new Date().getTime() - lastLockTime) - 2000
            while (timeRemaining > 0) {
              const client = asyncRedis.decorate(await this.redisClient.duplicate())
              const data = await client.blpop(this.sessionEventKey(sessionId), timeRemaining)
              processGameEvent(JSON.parse(data[1]))
              timeRemaining = lockLeaseTime - (new Date().getTime() - lastLockTime) - 2000
            }
            lastLockTime = new Date().getTime()
          }

        } catch (e) {
          console.error(`${process.pid} ERROR IN GAME RUNNER LOOP`, e)
        }
      })
    }
  }

  async stopSession(sessionId) {
    this.runningSessionIds.delete(sessionId)
  }
}

module.exports = GameRunner
