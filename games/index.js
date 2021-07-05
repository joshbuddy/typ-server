import React, { Component } from 'react'
import { render } from 'react-dom'

class IndexPage extends Component {
  constructor(props) {
    super(props)
    this.state = {
      data: {},
      players: [],
      input: ''
    }
  }

  componentDidMount() {
    const session = document.location.search.match(/[\?+]session=(\d+)/)[1]
    this.webSocket=new WebSocket('ws://' + document.location.host + '/sessions/' + session)

    this.webSocket.onopen = () => console.log('websocket client connected')
    this.webSocket.onclose = () => console.log('websocket client disconnected')
    this.webSocket.onmessage = e => {
      const res = JSON.parse(e.data)
      console.log("Received", res)
      if (res.type === 'update') {
        this.setState({data: res.data})
      }
      if (res.type === 'players') {
        this.setState({players: res.players})
      }
    }

    setInterval(() => this.send('refresh'), 5000)
  }

  send(action, args) {
    this.webSocket.send(JSON.stringify(Object.assign({type: action}, args)))
  }

  gameAction() {
    this.send(
      'action', {
        payload: this.state.input.split(' ')
      }
    )
    this.setState({input: ''})
  }

  render() {
    return (
      <div>
        <div>
          Players:
          <ul>
            {this.state.players.map(player => (
              <li key={player.id}>{player.name} {player === this.state.players[this.state.data.currentPlayer] && '<--'}</li>
            ))}
          </ul>
        </div>
        <div>Game state: {JSON.stringify(this.state.data.variables)}</div>
        {this.state.data.phase === 'setup' && (
          <div>
            <button onClick={e => this.send('startGame')}>Start</button>
          </div>
        )}
        {this.state.data.phase === 'playing' && (
          <div>
            <input value={this.state.input} onChange={e => this.setState({input: e.target.value})}/>
            <button onClick={e => this.gameAction()}>Send</button>
          </div>
        )}
      </div>
        )
  }
}

render(<IndexPage />, document.getElementById('container'))
