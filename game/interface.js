const GameDocument = require('./document');

class GameInterface {
  constructor(playerId) {
    this.playerId = playerId
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
    this.variables = this.initialVariables || {};
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
    this.variables[key] = value;
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
      variables: this.variables,
      players: this.players,
      currentPlayer: this.currentPlayer,
      phase: this.phase,
      doc: this.doc.outerHTML,
    }
  }

  setState(state) {
    if (state) {
      this.variables = state.variables;
      this.players = state.players;
      this.currentPlayer = state.currentPlayer;
      this.phase = state.phase
      this.doc.outerHTML = state.doc
    }
    return true
  }

  getPlayerView() {
    const playerView = this.doc.clone();
    playerView.findNodes(this.hidden()).forEach(n => n.replaceWith(document.createElement(n.nodeName)));

    return {
      variables: this.shownVariables(),
      phase: this.phase,
      players: this.players,
      currentPlayer: this.currentPlayer,
      board: playerView.boardNode().outerHTML,
      pile: this.doc.pileNode().outerHTML,
    }
  }

  hidden() {
    return null;
  }

  receiveAction(action, args) {
    console.log('receiveAction', this.phase, this.currentPlayer, this.player)
    if (this.phase !== 'playing') throw Error("game not active")
    if (this.currentPlayer !== this.player) throw Error("it's not your turn")
    if (this.moves[action]) {
      this.moves[action].apply(this, args)
    }
  }

  endTurn() {
    this.currentPlayer = (this.currentPlayer + 1) % this.players.length
  }
}

module.exports = GameInterface