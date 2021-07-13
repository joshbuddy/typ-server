const webpack = require('webpack');
const path = require('path');

const config = {
  mode: 'development',

  entry: {
    app: [
      'default-path-will-be-overwritten',
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
  const localConfig = Object.assign({}, config);
  localConfig.entry.app[0] = entry;
  console.log(localConfig);
  return webpack(localConfig);
}
