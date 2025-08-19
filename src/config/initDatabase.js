const sequelize = require('./database');
const ClientOrganization = require('../models/ClientOrganization');

async function initializeDatabase() {
    try {
        // Test connection
        await sequelize.authenticate();
        console.log('✅ Database connection verified');
        
        // Sync models (create tables if they don't exist)
        await sequelize.sync({ alter: false });
        console.log('✅ Database tables synchronized');
        
        return true;
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        return false;
    }
}

module.exports = { initializeDatabase };
