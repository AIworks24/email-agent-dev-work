const { sequelize, isConnected, isDatabaseAvailable } = require('./database');

async function initializeDatabase() {
    try {
        console.log('🚀 Starting database initialization...');
        
        // Check if database is available
        if (!isDatabaseAvailable()) {
            console.log('⚠️ Database not available, running in no-persistence mode');
            return true; // Allow app to continue
        }

        // Test connection
        const connected = await isConnected();
        if (!connected) {
            console.log('⚠️ Database connection failed, continuing without persistence');
            return true; // Allow app to continue
        }

        console.log('✅ Database connection verified');
        
        // Try to sync models (only if we have a real database)
        if (sequelize.getDialect && sequelize.getDialect() !== 'mock') {
            try {
                // Import models here to avoid circular dependencies
                const ClientOrganization = require('../models/ClientOrganization');
                
                await sequelize.sync({ alter: false });
                console.log('✅ Database tables synchronized');
                
                // Test model functionality
                await ClientOrganization.findAll({ limit: 1 });
                console.log('✅ Database models working correctly');
                
            } catch (syncError) {
                console.warn('⚠️ Database sync failed:', syncError.message);
                console.log('📝 App will continue with limited database functionality');
                // Don't fail the entire app if sync fails
            }
        } else {
            console.log('📝 Using mock database - no table synchronization needed');
        }
        
        return true;
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        console.log('🔄 App will continue in no-database mode');
        
        // Always return true to allow app to start even without database
        return true;
    }
}

// Health check function
function getDatabaseStatus() {
    return {
        available: isDatabaseAvailable(),
        dialect: sequelize.getDialect ? sequelize.getDialect() : 'unknown',
        connected: false // Will be updated by connection test
    };
}

module.exports = { 
    initializeDatabase,
    getDatabaseStatus
};
