const express = require('express');
const router = express.Router();
const UserSettings = require('../models/UserSettings');

// Middleware to require authentication and extract user data
const requireAuth = (req, res, next) => {
    if (!req.cookies.accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userData = req.cookies.userData ? JSON.parse(req.cookies.userData) : null;
    if (!userData || !userData.tenantId || !userData.username) {
        return res.status(401).json({ error: 'Invalid authentication data' });
    }
    
    // Extract user information
    req.userEmail = userData.username; // This should be the email from Microsoft 365
    req.userTenant = userData.tenantId;
    req.userOrganization = userData.organizationName;
    req.userName = userData.name;
    
    next();
};

// GET signature settings for the current user
router.get('/signature', requireAuth, async (req, res) => {
    try {
        console.log(`📝 Loading signature settings for user: ${req.userEmail} (tenant: ${req.userTenant})`);
        
        // Find user settings by email and tenant
        const userSettings = await UserSettings.findByUserEmail(req.userEmail, req.userTenant);
        
        if (!userSettings) {
            // User doesn't exist yet, return empty signature
            console.log(`👤 User settings not found for ${req.userEmail}, returning empty signature`);
            return res.json({
                success: true,
                signature: null,
                userEmail: req.userEmail,
                message: 'No signature settings found - user will be created on first save'
            });
        }
        
        // Get signature from user settings
        const signature = userSettings.signature || null;
        
        console.log(`✅ Signature settings loaded for ${req.userEmail}`);
        res.json({
            success: true,
            signature: signature,
            userEmail: req.userEmail,
            userName: userSettings.userName
        });
        
    } catch (error) {
        console.error('Error loading signature settings:', error);
        res.status(500).json({ 
            error: 'Failed to load signature settings',
            message: error.message 
        });
    }
});

// POST signature settings (save/update) for the current user
router.post('/signature', requireAuth, async (req, res) => {
    try {
        const { signature } = req.body;
        
        if (!signature) {
            return res.status(400).json({ error: 'Signature data is required' });
        }
        
        console.log(`💾 Saving signature settings for user: ${req.userEmail} (tenant: ${req.userTenant})`);
        
        // Get or create user settings
        const userSettings = await UserSettings.getOrCreateUser({
            email: req.userEmail,
            name: req.userName,
            tenantId: req.userTenant
        });
        
        // Update signature
        await userSettings.updateSignature(signature);
        
        console.log(`✅ Signature settings saved for ${req.userEmail}`);
        res.json({
            success: true,
            message: 'Signature settings saved successfully',
            signature: signature,
            userEmail: req.userEmail
        });
        
    } catch (error) {
        console.error('Error saving signature settings:', error);
        res.status(500).json({ 
            error: 'Failed to save signature settings',
            message: error.message 
        });
    }
});

// DELETE signature settings for the current user
router.delete('/signature', requireAuth, async (req, res) => {
    try {
        console.log(`🗑️ Deleting signature settings for user: ${req.userEmail} (tenant: ${req.userTenant})`);
        
        // Find user settings
        const userSettings = await UserSettings.findByUserEmail(req.userEmail, req.userTenant);
        
        if (!userSettings) {
            return res.status(404).json({ 
                error: 'User settings not found' 
            });
        }
        
        // Clear signature
        await userSettings.updateSignature({});
        
        console.log(`✅ Signature settings deleted for ${req.userEmail}`);
        res.json({
            success: true,
            message: 'Signature settings deleted successfully',
            userEmail: req.userEmail
        });
        
    } catch (error) {
        console.error('Error deleting signature settings:', error);
        res.status(500).json({ 
            error: 'Failed to delete signature settings',
            message: error.message 
        });
    }
});

// GET all user preferences (signature + other settings)
router.get('/preferences', requireAuth, async (req, res) => {
    try {
        console.log(`⚙️ Loading all preferences for user: ${req.userEmail}`);
        
        const userSettings = await UserSettings.findByUserEmail(req.userEmail, req.userTenant);
        
        if (!userSettings) {
            return res.json({
                success: true,
                signature: null,
                preferences: {},
                userEmail: req.userEmail
            });
        }
        
        res.json({
            success: true,
            signature: userSettings.signature,
            preferences: userSettings.preferences,
            userEmail: req.userEmail,
            userName: userSettings.userName
        });
        
    } catch (error) {
        console.error('Error loading user preferences:', error);
        res.status(500).json({ 
            error: 'Failed to load user preferences',
            message: error.message 
        });
    }
});

// POST all user preferences (signature + other settings)
router.post('/preferences', requireAuth, async (req, res) => {
    try {
        const { signature, preferences } = req.body;
        
        console.log(`⚙️ Saving all preferences for user: ${req.userEmail}`);
        
        // Get or create user settings
        const userSettings = await UserSettings.getOrCreateUser({
            email: req.userEmail,
            name: req.userName,
            tenantId: req.userTenant
        });
        
        // Update both signature and preferences
        const updates = {};
        if (signature !== undefined) updates.signature = signature;
        if (preferences !== undefined) updates.preferences = preferences;
        updates.lastActiveAt = new Date();
        
        await userSettings.update(updates);
        
        console.log(`✅ All preferences saved for ${req.userEmail}`);
        res.json({
            success: true,
            message: 'User preferences saved successfully',
            signature: userSettings.signature,
            preferences: userSettings.preferences,
            userEmail: req.userEmail
        });
        
    } catch (error) {
        console.error('Error saving user preferences:', error);
        res.status(500).json({ 
            error: 'Failed to save user preferences',
            message: error.message 
        });
    }
});

module.exports = router;
