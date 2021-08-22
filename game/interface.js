const GameDocument = require('./document')
const EventEmitter = require('events')

class GameInterface extends EventEmitter {
  constructor() {
    super()
    this.players = []
    this.moves = {}
    this.phase = 'setup'
    this.hiddenKeys = []
    this.variables = {}
    this.doc = new GameDocument(null, this)
    this.board = this.doc.board()
    this.pile = this.doc.pile()
  }

  async start() {
    if (this.players.length < this.minPlayers) throw Error("not enough players")
    this.variables = this.initialVariables || {}
    this.setup && this.setup()
    this.currentPlayer = 0
    this.phase = 'playing'
    console.log(`I: start()`)
    await this.play()
    this.update() // final game state
  }

  addPlayer(userId) {
    if (this.players.includes(userId)) return
    if (this.players.length == this.maxPlayers) throw Error("game already full")
    this.players.push(userId)
    this.player = this.players.indexOf(this.userId)
  }

  getPlayers() {
    return this.players
  }

  update(allowedActions, forPlayer) {
    console.log('I: allowedActions', forPlayer)
    this.players.forEach(player => {
      this.emit('update', player, this.getPlayerView(
        player,
        forPlayer >= 0 && this.players[forPlayer] !== player ? {} : allowedActions
      ))
    })
  }

  get(key) {
    return this.variables[key]
  }

  set(key, value) {
    this.variables[key] = value
  }

  delete(key) {
    delete this.variables[key]
  }

  hide(key) {
    this.hiddenKeys.push(key)
  }

  shownVariables() {
    const a = this.hiddenKeys.reduce((vars, key) => {
      let {[key]: omit, ...rest} = vars
      return rest
    }, this.variables)
    return a
  }

  getState() {
    return {
      variables: {...this.variables},
      players: [...this.players],
      currentPlayer: this.currentPlayer,
      phase: this.phase,
      doc: this.doc.node.innerHTML,
    }
  }

  setState(state) {
    if (state) {
      this.variables = state.variables
      this.players = state.players
      this.currentPlayer = state.currentPlayer
      this.phase = state.phase
      this.doc.node.innerHTML = state.doc
    }
    return true
  }

  getPlayerView(player, allowedActions) {
    const playerView = this.doc.clone()
    playerView.findNodes(this.hidden(player)).forEach(n => n.replaceWith(document.createElement(n.nodeName)))
    return {
      variables: this.shownVariables(),
      phase: this.phase,
      players: this.players,
      currentPlayer: this.currentPlayer,
      board: playerView.boardNode().outerHTML,
      pile: this.doc.pileNode().outerHTML,
      allowedActions,
    }
  }

  hidden(player) { // eslint-disable-line no-unused-vars
    return null
  }

  async currentPlayerPlay(moves) {
    return await this.playerPlay(moves, this.currentPlayer)
  }

  async anyPlayerPlay(moves) {
    return await this.playerPlay(moves)
  }

  async playerPlay(moves, player) {
    moves = moves.includes ? moves : [moves]
    this.update(this.optionsFromMoves(moves), player)
    return await this.waitForAction(moves, player)
  }

    async repeat(times, fn) {
    for (let i=0; i<times; i++) {
      await fn(i)
    }
  }

  // runs provided async block for each player, starting with the current
  async playersInTurn(fn) {
    await this.repeat(this.players.length, async turn => {
      await fn(turn)
      this.endTurn()
    })
  }

  // given a set of moves, return a mapping of board choices to each move
  optionsFromMoves(moves) {
    return moves.reduce((options, move) => {
      const result = this.testMove(move, [])
      if (result === false) return
      if (result === true) {
        options[move.name] = move.name
      } else {
        result.forEach(option => options[option] = move.name)
      }
      return options
    }, {})
  }

  testMove(move, args) {
    const state = this.getState()
    const result = move(...args)
    this.setState(state)
    return result
  }

  replay(moves) {
    moves.forEach(move => setImmediate(() => {
      this.emit('action', ...move)
    }))
  }

  receiveAction(userId, action, ...args) {
    if (this.phase !== 'playing') throw Error("game not active")
    console.log(`I: receiveAction(${userId}, ${action}, ${args})`)
    if (this.listenerCount('action') === 0) {
      console.error(`${this.userId}: no listener`)
      throw Error("No listener")
    }
    this.emit('action', this.players.indexOf(userId), action, ...args)
    // if (this.currentPlayer !== this.player) throw Error("it's not your turn")
  }

  // returns a promise that resolves when receiving an action from fromPlayer (default any) in the actions list
  // runs the action upon resolving
  async waitForAction(actions, fromPlayer) {
    console.log(`I: waitForAction(${actions.map(a=>a.name)}, ${fromPlayer})`)
    return new Promise((resolve, reject) => {
      if (this.listenerCount('action') > 1) {
        console.error("Game play has gotten ahead of itself. You are probably missing an `await` in the play function")
        return reject("Game play has gotten ahead of itself. You are probably missing an `await` in the play function")
      }
      this.on('action', (player, action, ...args) => {
        console.log(`I: got action (${player}, ${action}, ${args})`)
        const allowedAction = actions.find(a => a.name == action)
        if ((fromPlayer === undefined || player === fromPlayer) && allowedAction) {
          console.log(`I: resolve(${action}, ${args})`)
          allowedAction(...args)
          this.removeAllListeners('action')
          resolve([action, ...args])
        }
      })
      console.log(`I: waiting...`)
    })
  }

  setCurrentPlayer(player) {
    if (player >= this.players.length || player < 0) {
      throw(`No such player #{player}`)
    }
    this.currentPlayer = player
  }

  endTurn() {
    this.currentPlayer = (this.currentPlayer + 1) % this.players.length
  }
}

module.exports = GameInterface
