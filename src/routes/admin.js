const express = require('express');
const { requireAdminAuth, logoutAdmin, getActiveSessionsCount } = require('../middleware/adminAuth');
const router = express.Router();

// Middleware to parse form data
router.use(express.urlencoded({ extended: true }));

// Use the EXACT same database connection that works for the main app
function getWorkingDatabase() {
    // Import the working database configuration
    const { sequelize } = require('../config/database');
    const { DataTypes } = require('sequelize');
    
    // If sequelize is available and working, use it directly
    if (sequelize && sequelize.define) {
        // Define ClientOrganization using the working connection
        const ClientOrganization = sequelize.define('ClientOrganization', {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },
            tenantId: {
                type: DataTypes.STRING,
                unique: true,
                allowNull: false
            },
            organizationName: {
                type: DataTypes.STRING,
                allowNull: false
            },
            domain: {
                type: DataTypes.STRING,
                allowNull: true
            },
            subscriptionTier: {
                type: DataTypes.ENUM('free', 'basic', 'premium'),
                defaultValue: 'free',
                allowNull: false
            },
            isActive: {
                type: DataTypes.BOOLEAN,
                defaultValue: true,
                allowNull: false
            },
            settings: {
                type: DataTypes.JSON,
                defaultValue: {},
                allowNull: false
            },
            lastActiveAt: {
                type: DataTypes.DATE,
                allowNull: true
            },
            userCount: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                allowNull: false
            }
        }, {
            tableName: 'client_organizations',
            timestamps: true
        });
        
        return ClientOrganization;
    } else {
        throw new Error('Working database connection not available');
    }
}

// Main admin dashboard
router.all('/', requireAdminAuth, async (req, res) => {
    try {
        console.log('🔧 Admin dashboard accessed by:', req.adminUser);
        
        // Use the same working database connection as main app
        const ClientOrganization = getWorkingDatabase();
        
        // Sync the model
        await ClientOrganization.sync();
        
        // Load organizations
        console.log('📊 Loading organizations...');
        const organizations = await ClientOrganization.findAll({
            order: [['createdAt', 'DESC']]
        });
        console.log(`✅ Found ${organizations.length} organizations`);
        
        // Calculate statistics
        const now = new Date();
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        
        const stats = {
            totalOrganizations: organizations.length,
            activeThisMonth: organizations.filter(org => 
                org.updatedAt && new Date(org.updatedAt) > lastMonth
            ).length,
            newThisWeek: organizations.filter(org => 
                org.createdAt && new Date(org.createdAt) > lastWeek
            ).length,
            subscriptionBreakdown: {
                free: organizations.filter(org => org.subscriptionTier === 'free').length,
                basic: organizations.filter(org => org.subscriptionTier === 'basic').length,
                premium: organizations.filter(org => org.subscriptionTier === 'premium').length
            },
            activeSessions: getActiveSessionsCount()
        };
        
        res.send(generateAdminHTML(organizations, stats, req.adminUser));
        
    } catch (error) {
        console.error('🚨 Admin dashboard error:', error);
        
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Admin Dashboard Error</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; background: #f8f9fa; }
                    .error-container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                    .error-title { color: #dc3545; margin-bottom: 20px; }
                    .error-details { background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 15px 0; font-family: monospace; }
                    .action-links { margin-top: 20px; }
                    .action-links a { display: inline-block; margin-right: 15px; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <h2 class="error-title">🚨 Admin Dashboard Error</h2>
                    <p>Error using shared database connection.</p>
                    
                    <div class="error-details">
                        Error: ${error.message}<br>
                        Time: ${new Date().toISOString()}<br>
                        Admin: ${req.adminUser || 'Unknown'}
                    </div>
                    
                    <div class="action-links">
                        <a href="/health">📊 System Health</a>
                        <a href="/admin/logout">🚪 Logout</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
});

// Usage statistics
router.get('/usage', requireAdminAuth, async (req, res) => {
    try {
        const ClientOrganization = getWorkingDatabase();
        await ClientOrganization.sync();
        const organizations = await ClientOrganization.findAll();
        
        const usageStats = {
            totalOrganizations: organizations.length,
            byTier: {
                free: organizations.filter(org => org.subscriptionTier === 'free').length,
                basic: organizations.filter(org => org.subscriptionTier === 'basic').length,
                premium: organizations.filter(org => org.subscriptionTier === 'premium').length
            },
            activeStatus: {
                active: organizations.filter(org => org.isActive).length,
                inactive: organizations.filter(org => !org.isActive).length
            },
            recentActivity: organizations.filter(org => {
                const lastWeek = new Date();
                lastWeek.setDate(lastWeek.getDate() - 7);
                return org.updatedAt && new Date(org.updatedAt) > lastWeek;
            }).length
        };
        
        res.json({
            success: true,
            stats: usageStats,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Usage stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch usage statistics',
            message: error.message 
        });
    }
});

// Export data
router.get('/export', requireAdminAuth, async (req, res) => {
    try {
        const ClientOrganization = getWorkingDatabase();
        await ClientOrganization.sync();
        const organizations = await ClientOrganization.findAll();
        
        const csvHeaders = [
            'ID', 'Tenant ID', 'Organization Name', 'Domain', 
            'Subscription Tier', 'Status', 'User Count', 'Created', 'Updated'
        ];
        
        const csvData = [
            csvHeaders.join(','),
            ...organizations.map(org => 
                `"${org.id}","${org.tenantId}","${org.organizationName}","${org.domain || ''}","${org.subscriptionTier}","${org.isActive ? 'Active' : 'Inactive'}","${org.userCount || 0}","${org.createdAt}","${org.updatedAt}"`
            )
        ].join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="ai-email-agent-clients-${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csvData);
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to export data',
            message: error.message 
        });
    }
});

// System status
router.get('/status', requireAdminAuth, async (req, res) => {
    try {
        let dbStatus = 'unknown';
        let dbError = null;
        let orgCount = 0;
        
        try {
            const ClientOrganization = getWorkingDatabase();
            await ClientOrganization.sync();
            orgCount = await ClientOrganization.count();
            dbStatus = 'connected';
        } catch (error) {
            dbStatus = 'error';
            dbError = error.message;
        }
        
        const stats = {
            serverTime: new Date().toISOString(),
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            nodeVersion: process.version,
            environment: process.env.NODE_ENV || 'development',
            activeSessions: getActiveSessionsCount(),
            database: {
                status: dbStatus,
                error: dbError,
                organizationCount: orgCount
            },
            environmentVariables: {
                hasAdminUsername: !!process.env.ADMIN_USERNAME,
                hasAdminPassword: !!process.env.ADMIN_PASSWORD,
                hasDbHost: !!process.env.DB_HOST,
                hasDbUser: !!process.env.DB_USER,
                hasDbPassword: !!process.env.DB_PASSWORD,
                hasDbName: !!process.env.DB_NAME,
                hasAzureClientId: !!process.env.AZURE_CLIENT_ID
            }
        };
        
        res.json({
            success: true,
            status: 'healthy',
            stats: stats
        });
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ 
            success: false, 
            status: 'error', 
            error: error.message 
        });
    }
});

// Organization details
router.get('/org/:id', requireAdminAuth, async (req, res) => {
    try {
        const ClientOrganization = getWorkingDatabase();
        await ClientOrganization.sync();
        const organization = await ClientOrganization.findByPk(req.params.id);
        
        if (!organization) {
            return res.status(404).json({ 
                success: false, 
                error: 'Organization not found',
                id: req.params.id 
            });
        }
        
        res.json({
            success: true,
            organization: organization,
            lastAccess: organization.updatedAt || organization.createdAt,
            settings: organization.settings || {}
        });
        
    } catch (error) {
        console.error('Error fetching organization:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch organization details',
            message: error.message 
        });
    }
});

// Logout
router.get('/logout', logoutAdmin);

function generateAdminHTML(organizations, stats, adminUser) {
    const recentOrgs = organizations.slice(0, 10);
    const totalLogins = organizations.reduce((total, org) => total + (org.userCount || 0), 0);
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>AI Email Agent - Admin Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #f8f9fa; }
            .header { background: linear-gradient(135deg, #28a745, #20c997); color: white; padding: 20px; display: flex; justify-content: space-between; align-items: center; }
            .header h1 { margin: 0; font-size: 24px; }
            .admin-info { text-align: right; font-size: 14px; opacity: 0.9; }
            .container { max-width: 1200px; margin: 0 auto; padding: 30px; }
            .success-banner { background: #d4edda; color: #155724; padding: 15px; border-radius: 8px; margin-bottom: 30px; border-left: 4px solid #28a745; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .stat-card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; border-left: 4px solid #28a745; }
            .stat-value { font-size: 48px; font-weight: bold; color: #28a745; margin-bottom: 10px; }
            .stat-label { color: #666; font-size: 16px; text-transform: uppercase; letter-spacing: 1px; }
            .main-content { display: grid; grid-template-columns: 2fr 1fr; gap: 30px; }
            .panel { background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
            .panel-title { background: #28a745; color: white; padding: 20px; font-size: 18px; font-weight: 600; margin: 0; }
            .panel-content { padding: 30px; }
            .actions-panel { background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .action-button { display: block; width: 100%; padding: 15px 20px; margin-bottom: 10px; background: #28a745; color: white; text-decoration: none; border-radius: 8px; text-align: center; font-weight: 500; transition: background 0.3s; }
            .action-button:hover { background: #218838; color: white; }
            .action-button.secondary { background: #6c757d; }
            .action-button.secondary:hover { background: #5a6268; }
            .action-button.danger { background: #dc3545; }
            .action-button.danger:hover { background: #c82333; }
            .org-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            .org-table th, .org-table td { padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
            .org-table th { background: #f8f9fa; font-weight: 600; }
            .org-table tr:hover { background: #f8f9fa; }
            .status-active { color: #28a745; font-weight: 600; }
            .status-inactive { color: #dc3545; font-weight: 600; }
            .login-count { color: #007bff; font-weight: 600; }
            .empty-state { text-align: center; padding: 40px; color: #666; }
            .refresh-note { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            @media (max-width: 768px) {
                .main-content { grid-template-columns: 1fr; }
                .container { padding: 20px; }
                .header { padding: 15px 20px; flex-direction: column; gap: 10px; }
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🤖 AI Email Agent - Admin Control Panel</h1>
            <div class="admin-info">
                Logged in as: <strong>${adminUser}</strong><br>
                ${new Date().toLocaleString()}
            </div>
        </div>
        
        <div class="container">
            <div class="success-banner">
                ✅ <strong>Admin Dashboard Connected:</strong> Tracking ${stats.totalOrganizations} organizations with ${totalLogins} total logins.
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${stats.totalOrganizations}</div>
                    <div class="stat-label">Total Organizations</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.activeThisMonth}</div>
                    <div class="stat-label">Active This Month</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.newThisWeek}</div>
                    <div class="stat-label">New This Week</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${totalLogins}</div>
                    <div class="stat-label">Total Logins</div>
                </div>
            </div>
            
            <div class="main-content">
                <div class="panel">
                    <div class="panel-title">
                        🏢 Client Organizations (${organizations.length})
                    </div>
                    ${organizations.length === 0 ? 
                        `<div class="empty-state">
                            <h3>Ready for Client Organizations</h3>
                            <p>When clients authenticate with their Microsoft 365 accounts, their organizations will appear here with login tracking.</p>
                            <p><strong>Database:</strong> Connected and operational</p>
                        </div>` : 
                        `<div class="panel-content">
                            <table class="org-table">
                                <thead>
                                    <tr>
                                        <th>Organization</th>
                                        <th>Domain</th>
                                        <th>Tier</th>
                                        <th>Status</th>
                                        <th>Total Logins</th>
                                        <th>Created</th>
                                        <th>Last Active</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${recentOrgs.map(org => `
                                        <tr>
                                            <td><strong>${org.organizationName}</strong></td>
                                            <td>${org.domain || 'N/A'}</td>
                                            <td style="text-transform: capitalize;">${org.subscriptionTier}</td>
                                            <td class="${org.isActive ? 'status-active' : 'status-inactive'}">
                                                ${org.isActive ? 'Active' : 'Inactive'}
                                            </td>
                                            <td class="login-count">${org.userCount || 0}</td>
                                            <td>${new Date(org.createdAt).toLocaleDateString()}</td>
                                            <td>${new Date(org.updatedAt).toLocaleDateString()}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                            ${organizations.length > 10 ? `<p style="text-align: center; margin-top: 15px; color: #666;">Showing 10 of ${organizations.length} organizations</p>` : ''}
                        </div>`
                    }
                </div>
                
                <div class="actions-panel">
                    <div class="panel-title">
                        🔧 Admin Actions
                    </div>
                    
                    <a href="/admin/usage" class="action-button">
                        📈 View Usage Statistics
                    </a>
                    
                    <a href="/admin/export" class="action-button">
                        📊 Export Client Data
                    </a>
                    
                    <a href="/admin/status" class="action-button secondary">
                        🖥️ System Status
                    </a>
                    
                    <a href="/admin" class="action-button secondary">
                        🔄 Refresh Dashboard
                    </a>
                    
                    <a href="/admin/logout" class="action-button danger">
                        🚪 Logout
                    </a>
                    
                    <div style="margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                        <h4 style="margin: 0 0 10px 0; color: #333;">Usage Overview</h4>
                        <p style="margin: 5px 0; font-size: 14px;">Free Tier: ${stats.subscriptionBreakdown.free}</p>
                        <p style="margin: 5px 0; font-size: 14px;">Basic Tier: ${stats.subscriptionBreakdown.basic}</p>
                        <p style="margin: 5px 0; font-size: 14px;">Premium Tier: ${stats.subscriptionBreakdown.premium}</p>
                        <hr style="margin: 10px 0; border: none; border-top: 1px solid #ddd;">
                        <p style="margin: 5px 0; font-size: 14px;">Total Logins: ${totalLogins}</p>
                        <p style="margin: 5px 0; font-size: 14px;">Admin Sessions: ${stats.activeSessions}</p>
                    </div>
                </div>
            </div>
            
            <div class="refresh-note">
                Login tracking active. Last refresh: ${new Date().toLocaleString()}
            </div>
        </div>
    </body>
    </html>
    `;
}

module.exports = router;
