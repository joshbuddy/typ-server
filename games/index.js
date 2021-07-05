import React, { Component } from 'react';
import { render } from 'react-dom';

class IndexPage extends Component {
  render() {
    return (
      <div>Hello</div>
    );
  }
}

render(<IndexPage />, document.getElementById('container'));
