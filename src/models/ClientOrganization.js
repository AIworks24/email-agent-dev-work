const { sequelize, isDatabaseAvailable } = require('../config/database');
const { DataTypes } = require('sequelize');

let ClientOrganization;

if (isDatabaseAvailable() && sequelize.define) {
    // Real database model
    ClientOrganization = sequelize.define('ClientOrganization', {
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
                isEmail: false, // Allow domain format like "company.com"
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

} else {
    // Production-ready mock model (no sample data)
    console.log('📝 Creating production mock ClientOrganization model');
    
    // In-memory storage for mock model (starts empty)
    let mockData = [];
    let mockIdCounter = 1;
    
    ClientOrganization = {
        // Core CRUD operations
        findAll: async (options = {}) => {
            console.log('🔧 Mock ClientOrganization.findAll called');
            let results = [...mockData];
            
            // Apply where conditions
            if (options.where) {
                results = results.filter(item => {
                    for (const [key, value] of Object.entries(options.where)) {
                        if (item[key] !== value) {
                            return false;
                        }
                    }
                    return true;
                });
            }
            
            // Apply limit
            if (options.limit) {
                results = results.slice(0, options.limit);
            }
            
            return results;
        },
        
        findOne: async (options = {}) => {
            console.log('🔧 Mock ClientOrganization.findOne called');
            if (options.where) {
                return mockData.find(item => {
                    for (const [key, value] of Object.entries(options.where)) {
                        if (item[key] !== value) {
                            return false;
                        }
                    }
                    return true;
                }) || null;
            }
            return mockData[0] || null;
        },
        
        create: async (data) => {
            console.log('🔧 Mock ClientOrganization.create called');
            
            // Validate required fields
            if (!data.tenantId || !data.organizationName) {
                throw new Error('tenantId and organizationName are required');
            }
            
            // Check for duplicate tenantId
            const existing = mockData.find(item => item.tenantId === data.tenantId);
            if (existing) {
                throw new Error('Organization with this tenantId already exists');
            }
            
            const newItem = {
                id: mockIdCounter++,
                tenantId: data.tenantId,
                organizationName: data.organizationName,
                domain: data.domain || null,
                subscriptionTier: data.subscriptionTier || 'free',
                isActive: data.isActive !== undefined ? data.isActive : true,
                settings: data.settings || {},
                lastActiveAt: data.lastActiveAt || null,
                userCount: data.userCount || 0,
                createdAt: new Date(),
                updatedAt: new Date(),
                
                // Instance methods for mock
                updateLastActive: function() {
                    this.lastActiveAt = new Date();
                    this.updatedAt = new Date();
                    return Promise.resolve(this);
                },
                
                incrementUserCount: function() {
                    this.userCount += 1;
                    this.updatedAt = new Date();
                    return Promise.resolve(this);
                },
                
                decrementUserCount: function() {
                    if (this.userCount > 0) {
                        this.userCount -= 1;
                    }
                    this.updatedAt = new Date();
                    return Promise.resolve(this);
                },
                
                save: function() {
                    this.updatedAt = new Date();
                    return Promise.resolve(this);
                }
            };
            
            mockData.push(newItem);
            return newItem;
        },
        
        update: async (updates, options = {}) => {
            console.log('🔧 Mock ClientOrganization.update called');
            let updateCount = 0;
            
            if (options.where) {
                mockData.forEach(item => {
                    let shouldUpdate = true;
                    for (const [key, value] of Object.entries(options.where)) {
                        if (item[key] !== value) {
                            shouldUpdate = false;
                            break;
                        }
                    }
                    
                    if (shouldUpdate) {
                        Object.assign(item, updates, { updatedAt: new Date() });
                        updateCount++;
                    }
                });
            }
            
            return [updateCount];
        },
        
        destroy: async (options = {}) => {
            console.log('🔧 Mock ClientOrganization.destroy called');
            let deleteCount = 0;
            
            if (options.where) {
                for (let i = mockData.length - 1; i >= 0; i--) {
                    const item = mockData[i];
                    let shouldDelete = true;
                    
                    for (const [key, value] of Object.entries(options.where)) {
                        if (item[key] !== value) {
                            shouldDelete = false;
                            break;
                        }
                    }
                    
                    if (shouldDelete) {
                        mockData.splice(i, 1);
                        deleteCount++;
                    }
                }
            }
            
            return deleteCount;
        },
        
        // Custom class methods
        findByTenantId: async function(tenantId) {
            return this.findOne({ where: { tenantId, isActive: true } });
        },
        
        getActiveOrganizations: async function() {
            return this.findAll({ where: { isActive: true } });
        },
        
        // Utility methods
        count: async (options = {}) => {
            const results = await this.findAll(options);
            return results.length;
        },
        
        // Method to check if this is a mock (for debugging)
        _isMock: true,
        
        // Get current data (for admin/debugging purposes)
        _getData: () => [...mockData],
        
        // Clear all data (for testing/reset purposes)
        _clearData: () => {
            mockData = [];
            mockIdCounter = 1;
            console.log('🗑️ Mock ClientOrganization data cleared');
        }
    };
}

module.exports = ClientOrganization;
