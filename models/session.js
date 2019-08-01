'use strict';
module.exports = (sequelize, DataTypes) => {
  const Session = sequelize.define('Session', {
    gameId: DataTypes.INTEGER,
    creatorId: DataTypes.INTEGER
  }, {});
  Session.associate = function(models) {
    //models.Session.hasMany(models.SessionUser)
    models.Session.belongsTo(models.Game, {foreignKey: 'gameId'})
    models.Session.belongsTo(models.User, {
      constraints: false,
      foreignKey: 'creatorId',
      as: 'creator'
    })
  }
  return Session;
};