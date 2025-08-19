const requireTenant = (req, res, next) => {
    const userData = req.cookies.userData;
    
    if (!userData) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const user = JSON.parse(userData);
        if (!user.tenantId) {
            return res.status(401).json({ error: 'Tenant information missing' });
        }
        
        req.user = user;
        req.tenantId = user.tenantId;
        req.organizationId = user.organizationId;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid user data' });
    }
};

module.exports = { requireTenant };
