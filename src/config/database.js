const { Sequelize } = require('sequelize');

let sequelize;

if (process.env.DATABASE_URL) {
    // Production: Use PostgreSQL
    sequelize = new Sequelize(process.env.DATABASE_URL, {
        dialect: 'postgres',
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        },
        logging: process.env.NODE_ENV === 'development' ? console.log : false,
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        }
    });
} else {
    // Development fallback: In-memory (for local development only)
    console.warn('⚠️ No DATABASE_URL found - using fallback mode');
    sequelize = new Sequelize('sqlite::memory:', {
        dialect: 'sqlite',
        logging: false,
        storage: ':memory:'
    });
}

// Test connection
sequelize.authenticate()
    .then(() => {
        console.log('✅ Database connection established successfully');
    })
    .catch(err => {
        console.error('❌ Unable to connect to database:', err.message);
    });

module.exports = sequelize;
