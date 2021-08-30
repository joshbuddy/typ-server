const GameDocument = require('./document')
const EventEmitter = require('events')

class GameInterface extends EventEmitter {
  constructor() {
    super()
    this.players = []
    this.phase = 'setup'
    this.hiddenKeys = []
    this.variables = {}
    this.doc = new GameDocument(null, this)
    this.board = this.doc.board()
    this.pile = this.doc.pile() 
  }

  async start(history) {
    if (this.players.length < this.minPlayers) throw Error("not enough players")
    if (this.phase !== 'setup') throw Error("not ready to start")
    this.variables = this.initialVariables || {}
    this.setup && this.setup()
    this.currentPlayer = 0
    this.phase = 'playing'
    this.sequence = 0
    console.log(`I: start()`, history)
    this.lastReplaySequence = history.length ? history[history.length - 1][1] : -1
    this.updatePlayer() // initial game state with no actions allowed
    this.replay(history)
    await this.play()
    this.updatePlayer() // final game state with no actions allowed
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

  updatePlayer(allowedActions, forPlayer) {
    if (this.sequence <= this.lastReplaySequence) return
    console.log('I: allowedActions', forPlayer, this.players)
    this.players.forEach(player => {
      this.emit('update', {
        type: 'state',
        userId: player,
        payload: this.getPlayerView(
          player,
          forPlayer >= 0 && this.players[forPlayer] !== player ? {} : allowedActions
        )
      })
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
      sequence: this.sequence,
      board: playerView.boardNode().outerHTML,
      pile: this.doc.pileNode().outerHTML,
      allowedActions,
    }
  }

  hidden(player) { // eslint-disable-line no-unused-vars
    return null
  }

  async currentPlayerPlay(actions) {
    return await this.playerPlay(actions, this.currentPlayer)
  }

  async anyPlayerPlay(actions) {
    return await this.playerPlay(actions)
  }

  async playerPlay(actions, player) {
    actions = actions.includes ? actions : [actions]
    return await this.waitForAction(actions, player)
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

  playersMayAlwaysMove(selector) {
    this.allowedMoveElements = selector
    this.emit('update', {
      type: 'allowedMove',
      payload: selector
    })
  }

  playersMayNoLonger(moves) {
    moves = moves.includes ? moves : [moves]
    this.freeMoves = this.freeMoves.filter(move => !moves.includes(move))
  }

  optionsFromActions(actions) {
    return actions.reduce((options, action) => {
      const result = this.testAction(action, [])
      if (result === false) return
      if (result === true) {
        options[action.name] = action.name
      } else {
        options[action.name] = result
      }
      return options
    }, {})
  }

  // given a set of actions, return a mapping of board choices to each action
  /* optionsFromActions(actions) {
   *   return actions.reduce((options, action) => {
   *     const result = this.testAction(action, [])
   *     if (result === false) return
   *     if (result === true) {
   *       options[action.name] = action.name
   *     } else {
   *       result.forEach(option => options[option] = action.name)
   *     }
   *     return options
   *   }, {})
   * } */

  testAction(action, args) {
    const state = this.getState()
    const result = action(...args)
    this.setState(state)
    return result
  }

  replay(actions) {
    actions.forEach(action => setImmediate(() => {
      this.emit('action', false, ...action)
    }))
  }

  receiveAction(userId, sequence, action, ...args) {
    if (this.phase !== 'playing') throw Error("game not active")
    console.log(`I: receiveAction(${userId}, ${sequence}, ${action}, ${args})`)
    if (this.listenerCount('action') === 0) {
      console.error(`${this.userId}: no listener`)
      throw Error("No listener")
    }
    this.emit('action', true, this.players.indexOf(userId), sequence, action, ...args)
  }

  // returns a promise that resolves when receiving a valid action from fromPlayer (default any) in the actions list
  // runs the action upon resolving. if action is partial, it sends a follow-up question
  async waitForAction(actions, fromPlayer) {
    console.log(`I: waitForAction(${actions.map(a=>a.name)}, ${fromPlayer})`)
    this.updatePlayer(this.optionsFromActions(actions), fromPlayer)
    return new Promise((resolve, reject) => {
      if (this.listenerCount('action') > 1) {
        console.error("Game play has gotten ahead of itself. You are probably missing an `await` in the play function")
        return reject("Game play has gotten ahead of itself. You are probably missing an `await` in the play function")
      }
      this.on('action', (realtime, player, sequence, action, ...args) => {
        console.log(`I: got action (${player}, ${action}, ${args})`)
        if (action == 'moveElement') {
          try {
            if (realtime) this.registerAction(player, sequence, ['moveElement', ...args])
            this.sequence++;
            this.moveElement(...args)
            this.updatePlayer(this.optionsFromActions(actions), fromPlayer)
          } catch(e) {
            console.error("unable to register action", e)
            // UNDO?
          }
        } else {
          const allowedAction = actions.find(a => a.name == action)
          console.log('I try resolve with', allowedAction, `${fromPlayer}==${player}, ${sequence}==${this.sequence}`)
          if ((fromPlayer === undefined || player === fromPlayer) && allowedAction && this.sequence === sequence) {
            const result = allowedAction(...args)
            console.log('I result', result)
            if (result === true) {
              try {
                console.log(`I: registerAction(${player}, ${sequence}, ${action}, ${args})`)
                if (realtime) this.registerAction(player, sequence, [action, ...args])
                this.sequence++;
                this.removeAllListeners('action')
                resolve([action, ...args])
              } catch(e) {
                console.error("unable to register action", e)
                // UNDO?
              }
            }
            if (result === false) {
              // illegal action
            }
            if (result.includes) {
              this.updatePlayer({[action]: [...args, result]})
            }
          }
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

  moveElement(key, x, y) {
    const el = this.board.pieceAt(key)
    if (el.matches(this.allowedMoveElements)) {
      el.set('x', x)
      el.set('y', y)
    } else {
      console.error("Illegal moveElement", el.node.outerHTML, el.doc.innerHTML, this.allowedMoveElements)
    }
  }
}

module.exports = GameInterface
