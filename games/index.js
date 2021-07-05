import React, { Component } from 'react'
import { render } from 'react-dom'

class IndexPage extends Component {
  constructor(props) {
    super(props)
    this.state = {
      data: {},
      players: []
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

    setInterval(() => this.webSocket.send(JSON.stringify({type: "refresh"})), 5000)
  }

  render() {
    return (
      <div>
        <div>
          Players:
          <ul>{this.state.players.map(player => <li key={player}>{player}</li>)}</ul>
        </div>
        <div>Game state: {JSON.stringify(this.state.data)}</div>
      </div>
    )
  }
}

render(<IndexPage />, document.getElementById('container'))
