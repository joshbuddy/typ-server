class GameInterface {
  constructor(playerId) {
    this.playerId = playerId
    this.players = []
    this.moves = {}
    this.phase = 'setup'
  }

  start() {
    if (this.players.length < this.minPlayers) throw Error("not enough players")
    this.variables = this.initialVariables;
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
    this.variables = Object.assign(this.variables, value);
  }

  delete(key) {
    delete this.variables[key]
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
    console.log('setState', saveData);
    if (saveData) {
      this.variables = saveData.variables,
      this.players = saveData.players;
      this.currentPlayer = saveData.currentPlayer;
      this.phase = saveData.phase
    }
  }

  getPlayerView() {
    return {
      variables: this.variables,
      phase: this.phase,
      players: this.players,
      currentPlayer: this.currentPlayer,
    }
  }

  receiveAction(action, args) {
    if (this.phase !== 'playing') throw Error("game not active")
    if (this.currentPlayer !== this.player) throw Error("it's not your turn")
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
