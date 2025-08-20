const { sequelize, isConnected } = require('./database');

async function initializeDatabase() {
    try {
        console.log('🚀 Initializing Supabase database...');
        
        // Test connection first
        console.log('🔄 Testing database connection...');
        await isConnected();
        console.log('✅ Database connection verified');
        
        // Import and sync models
        console.log('📋 Loading models...');
        const ClientOrganization = require('../models/ClientOrganization');
        
        console.log('🔄 Synchronizing database tables...');
        await sequelize.sync({ alter: false }); // Don't auto-alter tables in production
        console.log('✅ Database tables synchronized');
        
        // Check current data
        const orgCount = await ClientOrganization.count();
        console.log(`📊 Current organizations in database: ${orgCount}`);
        
        console.log('✅ Database initialization complete');
        return true;
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        console.error('💥 Application cannot start without database connection');
        throw error; // Let the application fail - no fallback
    }
}

// Function to get database status
function getDatabaseStatus() {
    return {
        available: true,
        dialect: sequelize.getDialect(),
        connected: true,
        mode: 'production'
    };
}

// Function to test database connectivity
async function testDatabaseConnection() {
    try {
        await isConnected();
        return {
            success: true,
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

// Function to get database statistics
async function getDatabaseStats() {
    try {
        const ClientOrganization = require('../models/ClientOrganization');
        
        const totalOrgs = await ClientOrganization.count();
        const activeOrgs = await ClientOrganization.count({ where: { isActive: true } });

        return {
            available: true,
            mode: 'production',
            organizations: {
                total: totalOrgs,
                active: activeOrgs,
                inactive: totalOrgs - activeOrgs
            },
            last_updated: new Date().toISOString()
        };
    } catch (error) {
        throw new Error(`Failed to get database statistics: ${error.message}`);
    }
}

module.exports = { 
    initializeDatabase,
    getDatabaseStatus,
    testDatabaseConnection,
    getDatabaseStats
};
