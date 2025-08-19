const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ClientOrganization = sequelize.define('ClientOrganization', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    tenantId: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false
    },
    organizationName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    domain: {
        type: DataTypes.STRING,
        allowNull: true
    },
    subscriptionTier: {
        type: DataTypes.ENUM('free', 'basic', 'premium'),
        defaultValue: 'free'
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    settings: {
        type: DataTypes.JSON,
        defaultValue: {}
    }
}, {
    tableName: 'client_organizations',
    timestamps: true
});

module.exports = ClientOrganization;
