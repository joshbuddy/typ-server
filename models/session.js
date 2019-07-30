'use strict';
module.exports = (sequelize, DataTypes) => {
  const Session = sequelize.define('Session', {
    game_id: DataTypes.INTEGER,
    creator_id: DataTypes.INTEGER
  }, {});
  Session.associate = function(models) {
    // associations can be defined here
  };
  return Session;
};