const webpack = require('webpack');
const path = require('path');

const config = {
  mode: 'development',

  entry: {
    app: [
      '/Users/ahull/typ-sample-game/client/index.js', // default-path-will-be-overwritten
      /* 'webpack-hot-middleware/client?reload=true', */
    ],
  },

  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/game/'
  },

  /* watchOptions: {
   *   ignored: ['node_modules/', 'views/', 'dist/']
   * }, */

  /* plugins: [
   *   new webpack.HotModuleReplacementPlugin(),
   * ], */

  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        loader: 'babel-loader',
        options: {
          "presets": [
            "@babel/preset-env",
            "@babel/preset-react"
          ]
        },
      },
      {
        test: /\.s[ac]ss$/i,
        use: [
          "style-loader",
          "css-loader",
          "sass-loader",
        ],
      },
    ],
  },

  resolve: {
    extensions: ['*', '.js', '.jsx'],
  },
};

module.exports = entry => {
  return webpack(Object.assign({}, config, { entry: {app: [entry] }}));
}
