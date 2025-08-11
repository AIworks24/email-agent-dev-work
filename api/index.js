module.exports = (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    
    if (req.url === '/') {
        return res.status(200).json({ 
            message: 'API is working!',
            timestamp: new Date().toISOString()
        });
    }
    
    if (req.url === '/health') {
        return res.status(200).json({ 
            status: 'healthy',
            timestamp: new Date().toISOString()
        });
    }
    
    if (req.url === '/auth/login') {
        return res.status(200).json({ 
            message: 'Auth endpoint working',
            hasClientId: !!process.env.AZURE_CLIENT_ID,
            redirectUri: process.env.REDIRECT_URI || 'Not set'
        });
    }
    
    return res.status(404).json({ 
        error: 'Not found',
        path: req.url 
    });
};
