class NumberGuess {
  constructor(playerId) {
    this.playerId = playerId
    this.players = []
    this.state = null
  }

  startGame() {
    if (this.players.length !== 2) throw Error("not enough players")

    this.state = {
      winner: null,
      stage: 'playing',
      currentPlayerIndex: 0,
      correct: Math.floor(Math.random() * 10) + 1,
      guesses: 0
    }
  }

  addPlayer(playerId) {
    if (this.players.indexOf(playerId) !== -1) return
    this.players.push(playerId)
    this.playerIndex = this.players.indexOf(this.playerId)
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
    const state = {...this.state}
    delete state['correct']
    return state
  }

  receiveAction(action) {
    if (this.state.stage !== 'playing') throw Error("can't make a guess right now!")
    if (this.state.currentPlayerIndex !== this.playerIndex) throw Error("it's not your turn")
    if (action.guess === this.state.correct) {
      this.state.stage = 'finished'
      this.state.winner = this.state.currentPlayerIndex
    } else {
      this.state.currentPlayerIndex = this.state.currentPlayerIndex === 0 ? 1 : 0
      this.state.guesses++
    }
  }
}

module.exports = NumberGuess
