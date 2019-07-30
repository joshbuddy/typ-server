'use strict';
module.exports = (sequelize, DataTypes) => {
  const SessionUser = sequelize.define('SessionUser', {
    session_id: DataTypes.INTEGER,
    user_id: DataTypes.INTEGER
  }, {});
  SessionUser.associate = function(models) {
    // associations can be defined here
  };
  return SessionUser;
};