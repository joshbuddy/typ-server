const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'development',

  entry: {
    app: [
      path.join(__dirname, 'games/index.js'),
      'webpack-hot-middleware/client?reload=true',
    ],
  },

  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/game/'
  },

  watchOptions: {
    ignored: ['node_modules/', 'views/', 'dist/']
  },

  plugins: [
    new webpack.HotModuleReplacementPlugin(),
  ],

  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: ['babel-loader'],
      },
    ],
  },

  resolve: {
    extensions: ['*', '.js', '.jsx'],
  },
};
