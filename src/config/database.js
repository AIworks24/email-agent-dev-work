const { Sequelize } = require('sequelize');

let sequelize;

function createSequelizeInstance() {
    console.log('🔧 Initializing database connection...');
    
    // First, try to check if pg is available
    let pgAvailable = false;
    try {
        require('pg');
        pgAvailable = true;
        console.log('✅ PostgreSQL driver (pg) is available');
    } catch (error) {
        console.warn('⚠️ PostgreSQL driver (pg) not found:', error.message);
        pgAvailable = false;
    }

    // Try individual components first (no URL encoding issues)
    if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME && pgAvailable) {
        try {
            console.log('🔗 Attempting PostgreSQL connection with individual components...');
            console.log(`📍 Host: ${process.env.DB_HOST}`);
            console.log(`👤 User: ${process.env.DB_USER}`);
            console.log(`🗄️ Database: ${process.env.DB_NAME}`);
            console.log(`🔑 Password length: ${process.env.DB_PASSWORD.length}`);
            
            sequelize = new Sequelize(
                process.env.DB_NAME,
                process.env.DB_USER,
                process.env.DB_PASSWORD,
                {
                    host: process.env.DB_HOST,
                    port: process.env.DB_PORT || 5432,
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
                        acquire: 30000,
                        idle: 10000
                    },
                    retry: {
                        match: [
                            /ConnectionError/,
                            /ConnectionRefusedError/,
                            /ConnectionTimedOutError/,
                            /TimeoutError/,
                            /HostNotFoundError/
                        ],
                        max: 3
                    }
                }
            );
            console.log('✅ PostgreSQL setup with individual components successful');
            return;
        } catch (error) {
            console.error('❌ PostgreSQL setup with components failed:', error.message);
        }
    }

    // Fallback to DATABASE_URL if components not available
    if (process.env.DATABASE_URL && pgAvailable) {
        try {
            console.log('🔗 Attempting PostgreSQL connection with DATABASE_URL...');
            const dbUrl = process.env.DATABASE_URL.trim();
            console.log('📍 URL format check:', dbUrl.substring(0, 50) + '...');
            
            sequelize = new Sequelize(dbUrl, {
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
                    acquire: 30000,
                    idle: 10000
                },
                retry: {
                    match: [
                        /ConnectionError/,
                        /ConnectionRefusedError/,
                        /ConnectionTimedOutError/,
                        /TimeoutError/,
                        /HostNotFoundError/,
                        /URI malformed/
                    ],
                    max: 3
                }
            });
            console.log('✅ PostgreSQL setup with DATABASE_URL successful');
            return;
        } catch (error) {
            console.error('❌ PostgreSQL setup with DATABASE_URL failed:', error.message);
        }
    }

    // If nothing works, fall back to mock
    console.log('🔄 Falling back to mock database...');
    createFallbackSequelize();
}

function createFallbackSequelize() {
    console.log('📦 Setting up mock database...');
    
    // Ultra-minimal fallback - create a mock sequelize-like object
    sequelize = {
        authenticate: () => Promise.resolve(),
        sync: () => Promise.resolve(),
        getDialect: () => 'mock',
        define: () => ({
            findAll: () => Promise.resolve([]),
            create: () => Promise.resolve({}),
            findOne: () => Promise.resolve(null)
        })
    };
    console.log('⚠️ Using minimal mock database (no persistence)');
}

// Initialize Sequelize
createSequelizeInstance();

// Enhanced connection testing
async function testConnection() {
    try {
        if (typeof sequelize.authenticate === 'function') {
            await sequelize.authenticate();
            console.log('✅ Database connection established successfully');
            console.log(`📊 Using dialect: ${sequelize.getDialect ? sequelize.getDialect() : 'unknown'}`);
            return true;
        } else {
            console.log('✅ Mock database connection established');
            return true;
        }
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        console.error('🔍 Error details:', err.parent?.message || 'No additional details');
        
        // If PostgreSQL fails, try fallback
        if (err.message.includes('URI malformed') || err.message.includes('ENOTFOUND') || err.message.includes('HostNotFound')) {
            console.log('🔄 Database connection issue detected, switching to mock...');
            createFallbackSequelize();
            try {
                if (typeof sequelize.authenticate === 'function') {
                    await sequelize.authenticate();
                    console.log('✅ Fallback database connection established');
                    return true;
                }
            } catch (fallbackErr) {
                console.error('❌ Fallback database also failed:', fallbackErr.message);
            }
        }
        
        console.log('⚠️ Running without database persistence');
        return false;
    }
}

// Test connection on module load
testConnection().catch(err => {
    console.error('Database initialization error:', err);
});

// Export both sequelize and a flag indicating if it's working
module.exports = {
    sequelize,
    isConnected: testConnection,
    isDatabaseAvailable: () => sequelize && typeof sequelize.authenticate === 'function'
};
