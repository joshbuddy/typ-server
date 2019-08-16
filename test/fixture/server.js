/* global game */

game.minPlayers = 2
game.maxPlayers = 2

game.initialVariables = {
  winner: null,
  correct: Math.floor(Math.random() * 10) + 1,
  guesses: 0
}

game.moves = {
  guess: number => {
    if (number === game.get('correct')) {
      game.phase = 'finished'
      game.set({ winner: game.playerIndex })
    } else {
      game.set({ guesses: game.get('guesses') + 1 })
      game.endTurn()
    }
  }
}
