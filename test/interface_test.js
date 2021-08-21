/* global context, describe, it, beforeEach, afterEach, __dirname */

const Interface = require('../game/interface')
const assert = require('assert')
const chai = require('chai')
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

describe("GameInterface", () => {
  beforeEach(() => {
    this.updateSpy = chai.spy(console.log)
    const game = this.interface = new Interface(101)
    game.on('update', this.updateSpy)
    game.minPlayers = 4;
    [101,102,103,104].forEach(p => game.addPlayer(p))
    game.play = async () => {
      game.set('tokens', 4)
      do {
        await game.anyPlayerPlay(game.moves.addSome)
      } while (game.get('tokens') < 8)
        
      game.setCurrentPlayer(0)
      do {
        await game.playersInTurn(async turn => {
          await game.currentPlayerPlay(game.moves.takeOne)
        })
      } while (game.get('tokens') > 0)
    }
    game.moves = {
      addSome: n => {game.set('tokens', game.get('tokens') + n); return true},
      takeOne: () => {game.set('tokens', game.get('tokens') - 1); return true}
    }
  })

  describe("replay", () => {
    it("plays", done => {
      this.interface.play().then(() => {
        expect(this.updateSpy).to.have.been.called.exactly(10)
        expect(this.updateSpy).on.nth(1).be.called.with({addSome: 'addSome'})
        expect(this.updateSpy).on.nth(2).be.called.with({addSome: 'addSome'})
        expect(this.updateSpy).on.nth(3).be.called.with({takeOne: 'takeOne'})
        expect(this.updateSpy).on.nth(4).be.called.with({})
        done()
      })
      this.interface.replay([
        [1, 'addSome', 2],
        [2, 'addSome', 2],
        [3, 'addSome', 200], // will be ignored
        [0, 'takeOne'],
        [1, 'takeOne'],
        [2, 'takeOne'],
        [3, 'takeOne'],
        [3, 'takeOne'], // will be ignored
        [0, 'takeOne'],
        [1, 'takeOne'],
        [2, 'takeOne'],
        [3, 'takeOne'],
      ])
    })
  })

  describe("waitForAction", () => {
    beforeEach(() => {
      this.moves = {
        hi: () => {},
      }
    })

    it('resolves on action', async () => {
      setTimeout(() => this.interface.emit('action', 1, 'hi', 'there', 'gamer'), 100)
      const [action, ...args] = await this.interface.waitForAction([this.moves.hi], 1)
      assert.equal(action, 'hi')
      assert.deepEqual(args, ['there', 'gamer'])
      assert.equal(this.interface.listenerCount('action'), 0)
    })

    it('waits without action', done => {
      setTimeout(() => {
        assert.equal(this.interface.listenerCount('action'), 1)
        done()
      }, 200)
      this.interface.waitForAction([this.moves.hi], 1).then(() => {
        assert(false, 'waitForAction completed early')
        done()
      })
    })

    it('waits with wrong action', done => {
      setTimeout(() => this.interface.emit('action', 1, 'wrong action'), 100)
      setTimeout(done, 200)
      this.interface.waitForAction([this.moves.hi], 1).then(() => {
        assert(false, 'waitForAction completed early')
        done()
      })
    })

    it('waits with wrong player', done => {
      setTimeout(() => this.interface.emit('action', 2, 'hi'), 100)
      setTimeout(done, 200)
      this.interface.waitForAction([this.moves.hi], 1).then(() => {
        assert(false, 'waitForAction completed early')
        done()
      })
    })

    it('resolves on action eventually', async () => {
      setTimeout(() => this.interface.emit('action', 1, 'wrong action'), 100)
      setTimeout(() => this.interface.emit('action', 1, 'hi'), 150)
      await this.interface.waitForAction([this.moves.hi], 1)
    })
  })
})
