const GameDocument = require('./document')
const EventEmitter = require('events')
const {times, range} = require('./utils')

class InvalidChoiceError extends Error {}
class IncompleteActionError extends Error {
  constructor({choices, prompt}) {
    super(prompt)
    this.choices = choices
    this.prompt = prompt
  }
}

class GameInterface extends EventEmitter {
  constructor() {
    super()
    this.players = []
    this.phase = 'setup'
    this.hiddenKeys = []
    this.variables = {}
    this.allowedMoveElements = ''
    this.doc = new GameDocument(null, this)
    this.board = this.doc.board()
    this.pile = this.doc.pile()
    this.drags = {}
    this.actions = {}
    this.currentPlayer = undefined; // 1-indexed from list of players, or undefined if any player can play
    this.currentActions = [];
  }

  // start game from scratch and run history. returns when game is done
  async start(history) {
    if (this.players.length < this.minPlayers) throw Error("not enough players")
    if (this.phase !== 'setup') throw Error("not ready to start")
    this.variables = this.initialVariables || {}
    const playerMat = this.doc.addSpace('#player-mat', 'area')
    this.setupPlayerMat && this.setupPlayerMat(playerMat)
    times(this.players.length, player => playerMat.duplicate().set('player', player))
    playerMat.destroy()
    this.setupBoard && this.setupBoard(this.board)
    this.currentPlayer = 1
    this.phase = 'playing'
    this.sequence = 0
    console.log(`I: start()`, history)
    this.lastReplaySequence = history.length ? history[history.length - 1][1] : -1
    this.updatePlayers() // initial game state with no actions allowed
    this.replay(history)
    await this.play()
    this.updatePlayers() // final game state with no actions allowed
  }

  playerMat(player) {
    player = player || this.currentPlayer
    if (!player) throw Error("playerMat called without a player or a current player")
    return this.doc.find(`#player-mat[player="${player}"]`)
  }

  // add player to game
  addPlayer(userId) {
    if (this.players.includes(userId)) return
    if (this.phase !== 'setup') throw Error("not able to add players while playing")
    if (this.players.length == this.maxPlayers) throw Error("game already full")
    this.players.push(userId)
  }

  getPlayers() {
    return this.players
  }

  // send all players state along with allowed actions
  updatePlayers() {
    if (this.sequence <= this.lastReplaySequence) return // dont need to update unless at latest
    times(this.players.length, player => {
      this.emit('update', {
        type: 'state',
        userId: this.players[player - 1],
        payload: this.getPlayerView(player)
      })
    })
  }

  // send a player specific allowed actions
  updatePlayer(player, allowedActions = null) {
    if (this.sequence <= this.lastReplaySequence) return // dont need to update unless at latest
    const payload = this.getPlayerView(player)
    if (allowedActions) {
      payload.allowedActions = allowedActions
      payload.allowedMoveElements = null
      payload.allowedDrags = {}
    }
    this.emit('update', {
      type: 'state',
      userId: this.players[player - 1],
      payload
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
      this.board = this.doc.board()
      this.pile = this.doc.pile()
    }
    return true
  }

  serialize(value) {
    try {
      if (value instanceof Array) return value.map(v => this.serialize(v))
      if (value && value.serialize) {
        return value.serialize()
      }
      return JSON.stringify(value)
    } catch(e) {
      console.error("unable to serialize", value)
      throw e
    }
  }

  deserialize(value) {
    try {
      if (value instanceof Array) return value.map(v => this.deserialize(v))
      if (value.slice && value.slice(0,4) == '$el(') {
        return this.doc.pieceAt(value.slice(4,-1))
      }
      return JSON.parse(value)
    } catch(e) {
      console.error("unable to deserialize", value)
      throw e
    }
  }

  getPlayerView(player) {
    const playerView = this.doc.clone()
    const currentPlayer = this.currentPlayer
    this.currentPlayer = player

    playerView.findNodes(this.hidden(player)).forEach(n => {
      if (n.getAttribute('class').match(/\bpiece\b/)) {
        n.removeAttribute('id') //  piece identity is hidden
      } else {
        n.innerHTML = '' // space contents are hidden
      }
    })

    const allowedDrags = this.currentActions.reduce((drags, action) => {
      if (this.actions[action].drag) {
        drags[action] = {
          pieces: this.serialize(this.doc.findAll(this.actions[action].drag)),
          spaces: this.serialize(this.doc.findAll(this.actions[action].onto)),
        }
      }
      return drags
    }, {})
    this.currentPlayer = currentPlayer

    return {
      variables: this.shownVariables(),
      phase: this.phase,
      players: this.players,
      currentPlayer: this.currentPlayer,
      sequence: this.sequence,
      doc: playerView.node.outerHTML,
      allowedMove: this.allowedMoveElements,
      allowedActions: this.choicesFromActions(player),
      allowedDrags,
    }
  }

  hidden(player) { // eslint-disable-line no-unused-vars
    return null
  }

  // wait for an action from list of actions from current player
  async currentPlayerPlay(actions) {
    return await this.playerPlay(actions, this.currentPlayer)
  }

  // wait for an action from list of actions from any player
  async anyPlayerPlay(actions) {
    return await this.playerPlay(actions)
  }

  async playerPlay(actions, player) {
    this.currentActions = actions instanceof Array ? actions : [actions]
    this.currentPlayer = player
    return await this.waitForAction()
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

  // allow movement of pieces within their space if match the given selector
  playersMayAlwaysMove(selector) {
    this.allowedMoveElements = selector
  }

  // test list of actions for validity and options, returns object of name:{prompt, choices?}
  choicesFromActions(player) {
    if (this.currentPlayer !== undefined && player != this.currentPlayer) return {}
    return this.currentActions.reduce((choices, action) => {
      try {
        const prompt = this.testAction(action, player)
        //console.log('testAction OK', action)
        choices[action] = {prompt}
      } catch(e) {
        if (e instanceof IncompleteActionError) {
          //console.log('testAction IncompleteActionError', action, e.choices)
          choices[action] = {prompt: e.prompt, choices: e.choices}
        } else {
          throw e
        }
      }
      return choices
    }, {})
  }

  // test a given action without modifying state, rethrow
  testAction(action, player) {
    const state = this.getState()
    const currentPlayer = this.currentPlayer
    this.currentPlayer = player
    //console.log('-------------------------------------------------TESTACTION', action)
    try {
      this.runAction(action)
    } finally {
      //console.log('-------------------------------------------------END TESTACTION')
      this.setState(state)
      this.currentPlayer = currentPlayer
    }
  }

  // function that tries to run an action and delegates to the various main types of actions to determine outcome
  runAction(action, args=[], argIndex=0) {
    if (typeof action == 'string' && this.actions[action]) {
      action = this.actions[action]
    }
    console.log('running action', action, args, argIndex)
    if (!action) {
      throw Error(`No such action: ${action}`)
    }
    let nextAction = action.action

    if (action.next) {
      if (action.action) {
        throw Error("${action} may not have both 'next' and 'action'")
      }
      nextAction = this.runAction(action.next, args, argIndex + 1)
    }

    if (action.drag) {
      if (!action.onto) {
        throw Error(`${action} has a 'drag' but no 'onto'`)
      }
      this.dragAction(action.drag, action.onto, action.prompt, action.promptOnto, nextAction)(...args)
    } else if (action.select) {
      if (action.select instanceof Array) {
        this.chooseAction(action.select, action.prompt, nextAction, argIndex)(...args)
      } else if (typeof action.select == 'string') {
        this.chooseAction(this.doc.findAll(action.select), action.prompt, nextAction)(...args)
      } else {
        throw Error(`'select' for ${action} must be a list or a finder`)
      }
    } else if (action.max) { // simple numerical
      this.chooseAction(range(action.min, action.max), action.prompt, nextAction, argIndex)(...args)
    } else if (nextAction) {
      nextAction(...args)
    }
  }

  dragAction(pieceSelector, spaceSelector, prompt, promptOnto, action) {
    //console.log('dragAction', pieceSelector, this.board.findAll(pieceSelector).length)
    const fn = this.chooseAction(
      this.doc.findAll(pieceSelector),
      prompt,
      this.chooseAction(
        this.doc.findAll(spaceSelector),
        promptOnto || prompt,
        (piece, space, x, y) => {
          piece.move(space)
          piece.set('x', x)
          piece.set('y', y)
          if (action) {
            action(piece, space)
          }
        },
        1
      )
    )
    fn.type = 'drag'
    return fn
  }

  // returns a fn (...choices) -> action that throws appropriate choice errors
  chooseAction(validChoices, prompt, action, argIndex = 0) {
    const choices = this.serialize(validChoices)
    return (...args) => {
      const choice = args[argIndex]
      if (choice === undefined) {
        if (validChoices.length == 1 && action && argIndex > 0) {
          // auto-select simgle choice if not the first arg
          console.log('autocompleted action with', ...args, validChoices[0])
          action(...args, validChoices[0])
        } else {
          throw new IncompleteActionError({choices, prompt})
        }
      } else {
        if (!choices.includes(this.serialize(choice))) throw new InvalidChoiceError(`${this.serialize(choice)} not found in ${choices}`)
        if (action) action(...args)
      }
      return prompt
    }
  }

  replay(actions) {
    actions.forEach(action => setImmediate(
      () => this.emit('action', false, ...action)
    ))
  }

  receiveAction(userId, sequence, action, ...args) {
    if (this.phase !== 'playing') throw Error("game not active")
    console.log(`received action (${userId}, ${sequence}, ${action}, ${args})`)
    if (this.listenerCount('action') === 0) {
      console.error(`${this.userId}: no listener`)
      throw Error("No listener")
    }
    this.emit('action', true, this.players.indexOf(userId) + 1, sequence, action, ...args)
  }

  updateUser(userId) {
    this.updatePlayer(this.players.indexOf(userId) + 1)
  }

  // core function to listen for actions
  // returns a promise that resolves when receiving one of currentActions from currentPlayer
  // runs the action upon resolving. if action is partial, it sends a follow-up question
  async waitForAction() {
    this.updatePlayers()
    return new Promise((resolve, reject) => {
      if (this.listenerCount('action') > 1) {
        console.error("Game play has gotten ahead of itself. You are probably missing an `await` in the play function")
        return reject("Game play has gotten ahead of itself. You are probably missing an `await` in the play function")
      }
      this.on('action', (realtime, player, sequence, action, ...args) => {
        console.log(`I: got action (${player}, ${action}, ${args})`)
        const deserializedArgs = this.deserialize(args)
        if (action == 'moveElement') {
          // moveElement is a special case that doesn't count as a full action but we need to register it and just keep listening
          try {
            if (realtime) this.registerAction(player, sequence, ['moveElement', ...args])
            this.sequence++
            this.moveElement(...deserializedArgs)
            this.updatePlayers()
          } catch(e) {
            console.error("unable to register move action", e)
            // UNDO?
          }
        } else {
          console.log('I try resolve with', action, `${this.currentPlayer}==${player}`, this.sequence, sequence)
          if (this.sequence !== sequence) {
            if (sequence <= this.lastReplaySequence) {
              console.error("Unable to replay history with this game version", this.sequence, sequence)
              return reject("Unable to replay history with this game version")
            }
            console.error("Out of sequence", this.sequence, sequence)
            return
          }
          if ((this.currentPlayer === undefined || player === this.currentPlayer) && this.actions[action] && this.currentActions.includes(action)) {
            const currentPlayer = this.currentPlayer
            this.currentPlayer = player
            try {
              this.runAction(action, deserializedArgs)
            } catch(e) {
              if (e instanceof IncompleteActionError) {
                console.log("got IncompleteActionError", e)
                this.updatePlayer(player, {[action]: {args, choices: e.choices, prompt: e.prompt}})
                return
              } else {
                throw e
              }
            } finally {
              this.currentPlayer = currentPlayer
            }
            console.log(`action succeeded registerAction(${player}, ${sequence}, ${action}, ${args})`)
            try {
              if (realtime) this.registerAction(player, sequence, [action, ...args])
              this.sequence++
              this.removeAllListeners('action')
              resolve([action, ...deserializedArgs])
            } catch(e) {
              console.error("unable to register action", e)
            }
          }
        }
      })
    })
  }

  setCurrentPlayer(player) {
    if (player > this.players.length || player < 1) {
      throw(`No such player ${player}`)
    }
    this.currentPlayer = player
  }

  endTurn() {
    this.currentPlayer = this.currentPlayer % this.players.length + 1
  }

  moveElement(el, x, y) {
    if (el.matches(this.allowedMoveElements)) {
      el.set('x', x)
      el.set('y', y)
    } else {
      console.error("Illegal moveElement", el.node.outerHTML, this.allowedMoveElements)
    }
  }
}

module.exports = GameInterface
