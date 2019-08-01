'use strict';

const AdmZip = require('adm-zip')

module.exports = (sequelize, DataTypes) => {
  const Game = sequelize.define('Game', {
    content: DataTypes.BLOB,
    name: DataTypes.STRING
  }, {
    getterMethods: {
      contentZip: function() {
        return new AdmZip(this.getDataValue('content'))
      }
    }
  });
  Game.associate = function(models) {
    // associations can be defined here
  };
  return Game;
};