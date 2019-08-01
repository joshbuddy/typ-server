class NumberGuess {
  constructor(playerId) {
    this.playerId = playerId
    this.players = [playerId]
    this.state = null
  }

  start() {
    if (this.players.length !== 2) throw Exception("not enough players")

    this.playerIndex = this.players.indexOf(this.playerId)
    this.state = {
      winner: null,
      stage: 'playing',
      currentPlayerIndex: 0,
      correct: Math.floor(Math.random() * 10) + 1
    }
  }

  addPlayer(playerId) {
    if (this.players.indexOf(playerId) !== -1) return
    this.players.push(playerId)
  }

  getPlayers() {
    return this.players
  }

  getState() {
    return this.state
  }

  setState(state) {
    this.state = state
  }

  getPlayerState() {
    return this.state
  }

  receiveAction(action) {
    if (this.state.stage !== 'playing') throw Exception("can't make a guess right now!")
    if (this.currentPlayerIndex !== this.playerIndex) throw Exception("it's not your turn")
    if (action.guess === this.state.correct) {
      this.state.stage = 'finished'
      this.winner = this.currentPlayerIndex
    } else {
      // do nothing for now
    }
  }
}

module.exports = NumberGuess
