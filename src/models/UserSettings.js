const { sequelize } = require('../config/database');
const { DataTypes } = require('sequelize');

// Define the UserSettings model for individual user preferences
const UserSettings = sequelize.define('UserSettings', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userEmail: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isEmail: true,
            notEmpty: true
        },
        comment: 'The email address of the user (from Microsoft 365 login)'
    },
    tenantId: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            notEmpty: true
        },
        comment: 'The organization tenant ID this user belongs to'
    },
    userName: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Full name of the user from Microsoft 365'
    },
    signature: {
        type: DataTypes.JSON,
        defaultValue: {},
        allowNull: false,
        comment: 'Email signature settings for this specific user'
    },
    preferences: {
        type: DataTypes.JSON,
        defaultValue: {},
        allowNull: false,
        comment: 'Other user-specific preferences (tone, meeting settings, etc.)'
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false
    },
    lastActiveAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'user_settings',
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['userEmail', 'tenantId'],
            name: 'unique_user_per_tenant'
        },
        {
            fields: ['userEmail']
        },
        {
            fields: ['tenantId']
        },
        {
            fields: ['isActive']
        }
    ]
});

// Instance methods
UserSettings.prototype.updateLastActive = function() {
    this.lastActiveAt = new Date();
    return this.save();
};

UserSettings.prototype.updateSignature = function(signatureData) {
    this.signature = signatureData;
    this.lastActiveAt = new Date();
    return this.save();
};

// Class methods
UserSettings.findByUserEmail = function(userEmail, tenantId = null) {
    const whereClause = { userEmail, isActive: true };
    if (tenantId) {
        whereClause.tenantId = tenantId;
    }
    return this.findOne({ where: whereClause });
};

UserSettings.getOrCreateUser = async function(userData) {
    const { email, name, tenantId } = userData;
    
    const [userSettings, created] = await this.findOrCreate({
        where: { 
            userEmail: email,
            tenantId: tenantId 
        },
        defaults: {
            userEmail: email,
            userName: name,
            tenantId: tenantId,
            signature: {},
            preferences: {},
            isActive: true,
            lastActiveAt: new Date()
        }
    });
    
    // Update name if it changed
    if (!created && userSettings.userName !== name) {
        await userSettings.update({ userName: name, lastActiveAt: new Date() });
    }
    
    return userSettings;
};

module.exports = UserSettings;
