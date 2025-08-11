require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const session = require('express-session');
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/auth/login', async (req, res) => {
    try {
        // For now, let's test if we can load the MSAL library
        const { ConfidentialClientApplication } = require('@azure/msal-node');
        
        const msalConfig = {
            auth: {
                clientId: process.env.AZURE_CLIENT_ID,
                clientSecret: process.env.AZURE_CLIENT_SECRET,
                authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'common'}`
            }
        };

        const pca = new ConfidentialClientApplication(msalConfig);
        const scopes = [
            'https://graph.microsoft.com/Mail.ReadWrite',
            'https://graph.microsoft.com/Mail.Send',
            'https://graph.microsoft.com/Calendars.ReadWrite',
            'https://graph.microsoft.com/User.Read'
        ];

        const authCodeUrlParameters = {
            scopes: scopes,
            redirectUri: process.env.REDIRECT_URI,
        };

        const authUrl = await pca.getAuthCodeUrl(authCodeUrlParameters);
        res.redirect(authUrl);
        
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ 
            error: 'Authentication failed',
            message: error.message,
            hasClientId: !!process.env.AZURE_CLIENT_ID,
            hasClientSecret: !!process.env.AZURE_CLIENT_SECRET,
            redirectUri: process.env.REDIRECT_URI
        });
    }
});

app.get('/auth/callback', async (req, res) => {
    if (!req.query.code) {
        return res.status(400).json({ error: 'Authorization code not provided' });
    }

    try {
        const { ConfidentialClientApplication } = require('@azure/msal-node');
        
        const msalConfig = {
            auth: {
                clientId: process.env.AZURE_CLIENT_ID,
                clientSecret: process.env.AZURE_CLIENT_SECRET,
                authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'common'}`
            }
        };

        const pca = new ConfidentialClientApplication(msalConfig);
        const scopes = [
            'https://graph.microsoft.com/Mail.ReadWrite',
            'https://graph.microsoft.com/Mail.Send',
            'https://graph.microsoft.com/Calendars.ReadWrite',
            'https://graph.microsoft.com/User.Read'
        ];

        const tokenRequest = {
            code: req.query.code,
            scopes: scopes,
            redirectUri: process.env.REDIRECT_URI,
        };

        const response = await pca.acquireTokenByCode(tokenRequest);
        
        // Store token in session (we'll need to add session middleware)
        // For now, just redirect to dashboard with success
        res.redirect('/dashboard?auth=success');
        
    } catch (error) {
        console.error('Token exchange error:', error);
        res.status(500).json({ 
            error: 'Token exchange failed',
            message: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
