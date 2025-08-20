const { Sequelize } = require('sequelize');

let sequelize;

function createSequelizeInstance() {
    console.log('🔧 Initializing Supabase database connection...');
    console.log('🌍 Environment:', process.env.NODE_ENV);
    
    // Check required environment variables
    const requiredVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    // Check if pg driver is available
    try {
        require('pg');
        console.log('✅ PostgreSQL driver (pg) is available');
    } catch (error) {
        throw new Error('PostgreSQL driver (pg) is not installed. Run: npm install pg');
    }

    console.log('🔗 Connecting to Supabase...');
    console.log(`📍 Host: ${process.env.DB_HOST}`);
    console.log(`👤 User: ${process.env.DB_USER}`);
    console.log(`🗄️ Database: ${process.env.DB_NAME}`);
    console.log(`🚪 Port: ${process.env.DB_PORT || 6543}`);

    try {
        sequelize = new Sequelize(
            process.env.DB_NAME,
            process.env.DB_USER,
            process.env.DB_PASSWORD,
            {
                host: process.env.DB_HOST,
                port: parseInt(process.env.DB_PORT) || 6543,
                dialect: 'postgres',
                dialectOptions: {
                    ssl: process.env.NODE_ENV === 'production' ? {
                        require: true,
                        rejectUnauthorized: false
                    } : false
                },
                logging: process.env.NODE_ENV === 'development' ? console.log : false,
                pool: {
                    max: 5,
                    min: 0,
                    acquire: 60000,
                    idle: 10000
                },
                retry: {
                    match: [
                        /ConnectionError/,
                        /ConnectionRefusedError/,
                        /ConnectionTimedOutError/,
                        /TimeoutError/,
                        /HostNotFoundError/,
                        /ENOTFOUND/,
                        /getaddrinfo/
                    ],
                    max: 3
                }
            }
        );
        console.log('✅ Sequelize instance created successfully');
    } catch (error) {
        console.error('❌ Failed to create Sequelize instance:', error.message);
        throw error;
    }
}

// Initialize Sequelize
createSequelizeInstance();

// Test connection
async function testConnection() {
    console.log('🔄 Testing Supabase connection...');
    
    try {
        await sequelize.authenticate();
        console.log('✅ Supabase connection established successfully');
        console.log(`📊 Using dialect: ${sequelize.getDialect()}`);
        return true;
    } catch (error) {
        console.error('❌ Supabase connection failed:', error.message);
        console.error('🔍 Error details:', error.parent?.message || 'No additional details');
        
        if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
            console.error('🌐 DNS/Network Error - Check:');
            console.error('   1. DB_HOST is correct:', process.env.DB_HOST);
            console.error('   2. Network connectivity to Supabase');
            console.error('   3. Supabase project is active');
            console.error('   4. Database credentials are correct');
        }
        
        throw error; // Don't hide the error - let it fail loudly
    }
}

// Test connection on module load
testConnection().catch(err => {
    console.error('💥 Database initialization failed - application cannot start');
    console.error('Fix your database connection and restart the application');
    throw err;
});

module.exports = {
    sequelize,
    isConnected: testConnection,
    isDatabaseAvailable: () => true // Always true now - no fallback
};
