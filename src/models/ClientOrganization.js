const { sequelize } = require('../config/database');
const { DataTypes } = require('sequelize');

// Define the ClientOrganization model
const ClientOrganization = sequelize.define('ClientOrganization', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    tenantId: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        }
    },
    organizationName: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 255]
        }
    },
    domain: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            len: [0, 255]
        }
    },
    subscriptionTier: {
        type: DataTypes.ENUM('free', 'basic', 'premium'),
        defaultValue: 'free',
        allowNull: false
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false
    },
    settings: {
        type: DataTypes.JSON,
        defaultValue: {},
        allowNull: false
    },
    lastActiveAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    userCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
        validate: {
            min: 0
        }
    }
}, {
    tableName: 'client_organizations',
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['tenantId']
        },
        {
            fields: ['isActive']
        },
        {
            fields: ['subscriptionTier']
        }
    ]
});

// Instance methods
ClientOrganization.prototype.updateLastActive = function() {
    this.lastActiveAt = new Date();
    return this.save();
};

ClientOrganization.prototype.incrementUserCount = function() {
    this.userCount += 1;
    return this.save();
};

ClientOrganization.prototype.decrementUserCount = function() {
    if (this.userCount > 0) {
        this.userCount -= 1;
    }
    return this.save();
};

// Class methods
ClientOrganization.findByTenantId = function(tenantId) {
    return this.findOne({ where: { tenantId, isActive: true } });
};

ClientOrganization.getActiveOrganizations = function() {
    return this.findAll({ where: { isActive: true } });
};

module.exports = ClientOrganization;
