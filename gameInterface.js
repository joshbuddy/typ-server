class GameInterface {
  constructor(playerId) {
    this.playerId = playerId
    this.players = []
    this.moves = {}
    this.phase = 'setup'
    this.hiddenKeys = []
    this.variables = {}
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
    }
  }

  setState(saveData) {
    if (saveData) {
      this.variables = saveData.variables
      this.players = saveData.players;
      this.currentPlayer = saveData.currentPlayer;
      this.phase = saveData.phase
    }
    return true
  }

  getPlayerView() {
    return {
      variables: this.shownVariables(),
      phase: this.phase,
      players: this.players,
      currentPlayer: this.currentPlayer,
    }
  }

  receiveAction(action, args) {
    console.log('receiveAction', this.phase, this.currentPlayer, this.player)
    if (this.phase !== 'playing') throw Error("game not active")
    if (this.currentPlayer !== this.player) throw Error("it's not your turn")
    console.log('moves', action, args)
    if (this.moves[action]) {
      this.moves[action].apply(this, args)
    }
    console.log('action taken', this.getState())
  }

  endTurn() {
    this.currentPlayer = (this.currentPlayer + 1) % this.players.length
  }
}

module.exports = GameInterface
