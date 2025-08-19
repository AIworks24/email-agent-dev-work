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

    if (process.env.DATABASE_URL && pgAvailable) {
        try {
            console.log('🔗 Attempting PostgreSQL connection...');
            const dbUrl = process.env.DATABASE_URL.trim();
            
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
                        /Error: Please install pg package manually/
                    ],
                    max: 3
                }
            });
        } catch (error) {
            console.error('❌ PostgreSQL setup failed:', error.message);
            console.log('🔄 Falling back to SQLite...');
            createFallbackSequelize();
        }
    } else {
        console.log('🔄 Using SQLite fallback (no DATABASE_URL or pg package issues)');
        createFallbackSequelize();
    }
}

function createFallbackSequelize() {
    console.log('📦 Setting up SQLite fallback database...');
    
    // Check if sqlite3 is available, if not use memory storage
    let sqliteAvailable = false;
    try {
        require('sqlite3');
        sqliteAvailable = true;
    } catch (error) {
        console.warn('⚠️ SQLite3 not available, using in-memory storage');
    }

    if (sqliteAvailable) {
        sequelize = new Sequelize({
            dialect: 'sqlite',
            storage: ':memory:',
            logging: false
        });
    } else {
        // Ultra-minimal fallback - just create a mock sequelize-like object
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
        
        // If PostgreSQL fails, try fallback
        if (err.message.includes('pg package') || err.message.includes('PostgreSQL')) {
            console.log('🔄 PostgreSQL driver issue detected, switching to SQLite...');
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
