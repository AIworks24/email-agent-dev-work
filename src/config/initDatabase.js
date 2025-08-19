const { sequelize, isConnected, isDatabaseAvailable } = require('./database');

async function initializeDatabase() {
    try {
        console.log('🚀 Starting production database initialization...');
        
        // Check if database is available
        if (!isDatabaseAvailable()) {
            console.log('⚠️ Database not available, running in no-persistence mode');
            console.log('📝 Organizations will be stored in memory only (lost on restart)');
            return true; // Allow app to continue
        }

        // Test connection
        const connected = await isConnected();
        if (!connected) {
            console.log('⚠️ Database connection failed, continuing without persistence');
            console.log('📝 Organizations will be stored in memory only (lost on restart)');
            return true; // Allow app to continue
        }

        console.log('✅ Database connection verified');
        
        // Try to sync models (only if we have a real database)
        if (sequelize.getDialect && sequelize.getDialect() !== 'mock') {
            try {
                // Import models here to avoid circular dependencies
                const ClientOrganization = require('../models/ClientOrganization');
                
                console.log('🔄 Synchronizing database tables...');
                await sequelize.sync({ alter: false });
                console.log('✅ Database tables synchronized');
                
                // Test model functionality with a simple count query
                const orgCount = await ClientOrganization.count ? 
                    await ClientOrganization.count() : 
                    (await ClientOrganization.findAll()).length;
                
                console.log(`📊 Current organizations in database: ${orgCount}`);
                console.log('✅ Database models working correctly');
                
            } catch (syncError) {
                console.warn('⚠️ Database sync failed:', syncError.message);
                console.log('📝 App will continue with limited database functionality');
                // Don't fail the entire app if sync fails
            }
        } else {
            console.log('📝 Using mock database - no table synchronization needed');
            console.log('⚠️ Data will be stored in memory only (lost on restart)');
        }
        
        return true;
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        console.log('🔄 App will continue in no-database mode');
        console.log('📝 Organizations will be stored in memory only (lost on restart)');
        
        // Always return true to allow app to start even without database
        return true;
    }
}

// Health check function for production monitoring
function getDatabaseStatus() {
    const status = {
        available: isDatabaseAvailable(),
        dialect: sequelize.getDialect ? sequelize.getDialect() : 'unknown',
        connected: false, // Will be updated by connection test
        mode: 'unknown'
    };
    
    if (status.available && status.dialect === 'postgres') {
        status.mode = 'production';
    } else if (status.available && status.dialect === 'sqlite') {
        status.mode = 'development';
    } else if (status.dialect === 'mock') {
        status.mode = 'memory_only';
    } else {
        status.mode = 'unavailable';
    }
    
    return status;
}

// Function to test database connectivity (for health checks)
async function testDatabaseConnection() {
    try {
        const connected = await isConnected();
        return {
            success: connected,
            timestamp: new Date().toISOString(),
            status: getDatabaseStatus()
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
            status: getDatabaseStatus()
        };
    }
}

// Function to get database statistics (for admin/monitoring)
async function getDatabaseStats() {
    try {
        if (!isDatabaseAvailable()) {
            return {
                available: false,
                mode: 'no_database',
                organizations: 0,
                message: 'Database not available'
            };
        }

        const ClientOrganization = require('../models/ClientOrganization');
        
        const totalOrgs = await ClientOrganization.count ? 
            await ClientOrganization.count() : 
            (await ClientOrganization.findAll()).length;
            
        const activeOrgs = await ClientOrganization.count ? 
            await ClientOrganization.count({ where: { isActive: true } }) :
            (await ClientOrganization.findAll({ where: { isActive: true } })).length;

        return {
            available: true,
            mode: getDatabaseStatus().mode,
            organizations: {
                total: totalOrgs,
                active: activeOrgs,
                inactive: totalOrgs - activeOrgs
            },
            is_mock: ClientOrganization._isMock || false,
            last_updated: new Date().toISOString()
        };
    } catch (error) {
        return {
            available: false,
            error: error.message,
            message: 'Failed to get database statistics'
        };
    }
}

module.exports = { 
    initializeDatabase,
    getDatabaseStatus,
    testDatabaseConnection,
    getDatabaseStats
};
