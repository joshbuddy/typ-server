const GameDocument = require('./document');

class GameInterface {
  constructor() {
    this.players = []
    this.moves = {}
    this.phase = 'setup'
    this.hiddenKeys = []
    this.variables = {}
    this.doc = new GameDocument(null, this)
    this.board = this.doc.board()
    this.pile = this.doc.pile()
  }

  start() {
    if (this.players.length < this.minPlayers) throw Error("not enough players")
    this.variables = this.initialVariables || {}
    this.setup && this.setup()
    this.currentPlayer = 0
    this.phase = 'playing'
  }

  addPlayer(playerId) {
    if (this.players.indexOf(playerId) !== -1) return
    if (this.players.length == this.maxPlayers) throw Error("game already full")
    this.players.push(playerId)
    this.player = this.players.indexOf(this.playerId)
  }

  getPlayers() {
    return this.players
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
      return {[key]:vars.slice(1)}
    }, this.variables)
    return a
  }

  getState() {
    return {
      variables: this.variables,
      players: this.players,
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

  getPlayerViews() {
    const playerViews = {}
    for (let pid in this.players) {
      const playerView = this.doc.clone()
      playerView.findNodes(this.hidden()).forEach(n => n.replaceWith(document.createElement(n.nodeName)))
      playerViews[pid] = {
        variables: this.shownVariables(),
        phase: this.phase,
        players: this.players,
        currentPlayer: this.currentPlayer,
        board: playerView.boardNode().outerHTML,
        pile: this.doc.pileNode().outerHTML,
      }
    }
    return playerViews
  }

  hidden() {
    return null
  }

  receiveAction(action, args) {
    console.log('receiveAction', this.phase, this.currentPlayer, this.player)
    if (this.phase !== 'playing') throw Error("game not active")
    // if (this.currentPlayer !== this.player) throw Error("it's not your turn")
    if (action === '_moveElement') {
      this.moveElement(...args)
    }
    if (this.moves[action]) {
      this.moves[action].apply(this, args)
    }
  }

  moveElement(key, x, y) {
    const el = this.board.pieceAt(key)
    el.set('x', x)
    el.set('y', y)
  }

  endTurn() {
    this.currentPlayer = (this.currentPlayer + 1) % this.players.length
  }
}

module.exports = GameInterface
