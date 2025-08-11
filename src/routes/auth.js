const express = require('express');
const { pca, scopes } = require('../config/auth');
const router = express.Router();

// Initiate login
router.get('/login', async (req, res) => {
    const authCodeUrlParameters = {
        scopes: scopes,
        redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback',
    };

    try {
        const response = await pca.getAuthCodeUrl(authCodeUrlParameters);
        res.redirect(response);
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// Handle callback
router.get('/callback', async (req, res) => {
    if (!req.query.code) {
        return res.status(400).json({ error: 'Authorization code not provided' });
    }

    const tokenRequest = {
        code: req.query.code,
        scopes: scopes,
        redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback',
    };

    try {
        const response = await pca.acquireTokenByCode(tokenRequest);
        
        // Store token and user info in session
        req.session.accessToken = response.accessToken;
        req.session.user = {
            id: response.account.homeAccountId,
            username: response.account.username,
            name: response.account.name
        };
        
        console.log(`✅ User authenticated: ${response.account.username}`);
        res.redirect('/dashboard');
    } catch (error) {
        console.error('Error during token acquisition:', error);
        res.status(500).json({ error: 'Token acquisition failed' });
    }
});

// Get user info
router.get('/user', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    res.json({
        user: req.session.user,
        authenticated: true
    });
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
        res.redirect('/');
    });
});
// Debug route to check environment variables
router.get('/debug', (req, res) => {
    res.json({
        REDIRECT_URI: process.env.REDIRECT_URI,
        NODE_ENV: process.env.NODE_ENV,
        hasAzureClientId: !!process.env.AZURE_CLIENT_ID,
        hasAzureSecret: !!process.env.AZURE_CLIENT_SECRET,
        hasAzureTenant: !!process.env.AZURE_TENANT_ID
    });
});

module.exports = router;
