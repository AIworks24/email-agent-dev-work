require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Test routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/auth/login', (req, res) => {
    res.json({ 
        message: 'Login working',
        env: process.env.NODE_ENV,
        hasEnvVars: {
            clientId: !!process.env.AZURE_CLIENT_ID,
            redirectUri: !!process.env.REDIRECT_URI
        }
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
