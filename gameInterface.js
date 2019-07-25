class GameInterface {
  constructor(playerId) {
    this.playerId = playerId
    this.state = {}
  }

  setState(state) {
    this.state = state
  }

  getPlayerState() {
    return this.state
  }

  receiveAction(action) {
    this.state = action
    return this.state
  }
}

module.exports = GameInterface
