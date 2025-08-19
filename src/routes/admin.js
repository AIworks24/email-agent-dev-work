const express = require('express');
const ClientOrganization = require('../models/ClientOrganization');
const { requireAdminAuth, logoutAdmin, getActiveSessionsCount } = require('../middleware/adminAuth');
const router = express.Router();

// Middleware to parse form data
router.use(express.urlencoded({ extended: true }));

// Main admin dashboard
router.all('/', requireAdminAuth, async (req, res) => {
    try {
        const organizations = await ClientOrganization.findAll({
            order: [['createdAt', 'DESC']]
        });
        
        // Calculate statistics
        const now = new Date();
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        
        const stats = {
            totalOrganizations: organizations.length,
            activeThisMonth: organizations.filter(org => org.updatedAt > lastMonth).length,
            newThisWeek: organizations.filter(org => org.createdAt > lastWeek).length,
            subscriptionBreakdown: {
                free: organizations.filter(org => org.subscriptionTier === 'free').length,
                basic: organizations.filter(org => org.subscriptionTier === 'basic').length,
                premium: organizations.filter(org => org.subscriptionTier === 'premium').length
            },
            activeSessions: getActiveSessionsCount()
        };
        
        res.send(generateAdminHTML(organizations, stats, req.adminUser));
        
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).send(`
            <html><body style="font-family: Arial; padding: 50px; text-align: center;">
                <h2>Error Loading Dashboard</h2>
                <p>Please try again or contact system administrator.</p>
                <a href="/admin">Return to Login</a>
            </body></html>
        `);
    }
});

// Organization details
router.get('/org/:id', requireAdminAuth, async (req, res) => {
    try {
        const organization = await ClientOrganization.findByPk(req.params.id);
        
        if (!organization) {
            return res.status(404).send('Organization not found');
        }
        
        res.json({
            success: true,
            organization: organization,
            lastAccess: organization.updatedAt,
            settings: organization.settings || {}
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch organization details' });
    }
});

// Usage statistics
router.get('/usage', requireAdminAuth, async (req, res) => {
    try {
        const organizations = await ClientOrganization.findAll();
        
        // Placeholder for usage data - you'll implement actual tracking later
        const usageData = {
            totalApiCalls: 'Tracking not yet implemented',
            emailsProcessed: 'Coming in Phase 6',
            meetingsScheduled: 'Coming in Phase 6',
            avgSessionTime: 'Coming in Phase 6',
            organizationUsage: organizations.map(org => ({
                name: org.organizationName,
                lastActive: org.updatedAt,
                tier: org.subscriptionTier,
                status: org.isActive
            }))
        };
        
        res.json({
            success: true,
            usage: usageData,
            generatedAt: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch usage data' });
    }
});

// Export data
router.get('/export', requireAdminAuth, async (req, res) => {
    try {
        const organizations = await ClientOrganization.findAll({
            order: [['createdAt', 'DESC']]
        });
        
        const csvData = [
            'Organization Name,Domain,Tenant ID,Subscription Tier,Status,Date Joined,Last Activity',
            ...organizations.map(org => 
                `"${org.organizationName}","${org.domain || 'N/A'}","${org.tenantId}","${org.subscriptionTier}","${org.isActive ? 'Active' : 'Inactive'}","${org.createdAt.toISOString()}","${org.updatedAt.toISOString()}"`
            )
        ].join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="ai-email-agent-clients-${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csvData);
        
        console.log(`📊 Admin export: ${req.adminUser} exported ${organizations.length} organizations`);
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Failed to export data' });
    }
});

// System status
router.get('/status', requireAdminAuth, async (req, res) => {
    try {
        const stats = {
            serverTime: new Date().toISOString(),
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            nodeVersion: process.version,
            environment: process.env.NODE_ENV || 'development',
            activeSessions: getActiveSessionsCount()
        };
        
        res.json({
            success: true,
            status: 'healthy',
            stats: stats
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            status: 'error', 
            error: error.message 
        });
    }
});

// Logout
router.get('/logout', logoutAdmin);

// Helper function to generate admin dashboard HTML
function generateAdminHTML(organizations, stats, adminUser) {
    const recentOrgs = organizations.slice(0, 10);
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>AI Email Agent - Admin Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                margin: 0;
                background: #f8f9fa;
                color: #333;
            }
            .header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 20px 30px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .header h1 {
                margin: 0;
                font-weight: 300;
            }
            .admin-info {
                text-align: right;
                font-size: 14px;
            }
            .container {
                max-width: 1400px;
                margin: 0 auto;
                padding: 30px;
            }
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin-bottom: 40px;
            }
            .stat-card {
                background: white;
                padding: 25px;
                border-radius: 12px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.05);
                border-left: 4px solid #667eea;
            }
            .stat-value {
                font-size: 2.5em;
                font-weight: bold;
                color: #667eea;
                line-height: 1;
            }
            .stat-label {
                color: #666;
                margin-top: 8px;
                font-size: 14px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .main-content {
                display: grid;
                grid-template-columns: 2fr 1fr;
                gap: 30px;
            }
            .organizations-panel, .actions-panel {
                background: white;
                padding: 25px;
                border-radius: 12px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.05);
            }
            .panel-title {
                font-size: 1.3em;
                font-weight: 600;
                margin-bottom: 20px;
                color: #333;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 15px;
            }
            th, td {
                padding: 12px 8px;
                text-align: left;
                border-bottom: 1px solid #eee;
            }
            th {
                background: #f8f9fa;
                font-weight: 600;
                font-size: 14px;
                color: #666;
            }
            .status-active {
                color: #28a745;
                font-weight: 600;
            }
            .status-inactive {
                color: #dc3545;
                font-weight: 600;
            }
            .tier-badge {
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
            }
            .tier-free { background: #e9ecef; color: #495057; }
            .tier-basic { background: #cce7ff; color: #0066cc; }
            .tier-premium { background: #ffe6cc; color: #cc6600; }
            .action-button {
                display: block;
                width: 100%;
                padding: 12px 20px;
                margin-bottom: 15px;
                background: #667eea;
                color: white;
                text-decoration: none;
                border-radius: 8px;
                text-align: center;
                font-weight: 500;
                transition: background 0.3s;
            }
            .action-button:hover {
                background: #5a67d8;
                color: white;
            }
            .action-button.secondary {
                background: #6c757d;
            }
            .action-button.secondary:hover {
                background: #5a6268;
            }
            .action-button.danger {
                background: #dc3545;
            }
            .action-button.danger:hover {
                background: #c82333;
            }
            .refresh-note {
                text-align: center;
                color: #666;
                font-size: 12px;
                margin-top: 20px;
            }
            @media (max-width: 768px) {
                .main-content {
                    grid-template-columns: 1fr;
                }
                .container {
                    padding: 20px;
                }
                .header {
                    padding: 15px 20px;
                    flex-direction: column;
                    gap: 10px;
                }
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
                    <div class="stat-value">${stats.subscriptionBreakdown.premium}</div>
                    <div class="stat-label">Premium Clients</div>
                </div>
            </div>
            
            <div class="main-content">
                <div class="organizations-panel">
                    <div class="panel-title">
                        📊 Recent Organizations
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Organization</th>
                                <th>Domain</th>
                                <th>Tier</th>
                                <th>Status</th>
                                <th>Joined</th>
                                <th>Last Active</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentOrgs.map(org => `
                                <tr>
                                    <td><strong>${org.organizationName}</strong></td>
                                    <td>${org.domain || 'N/A'}</td>
                                    <td><span class="tier-badge tier-${org.subscriptionTier}">${org.subscriptionTier}</span></td>
                                    <td class="${org.isActive ? 'status-active' : 'status-inactive'}">
                                        ${org.isActive ? 'Active' : 'Inactive'}
                                    </td>
                                    <td>${new Date(org.createdAt).toLocaleDateString()}</td>
                                    <td>${new Date(org.updatedAt).toLocaleDateString()}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ${organizations.length > 10 ? `<p style="text-align: center; margin-top: 15px; color: #666;">Showing 10 of ${organizations.length} organizations</p>` : ''}
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
                        <h4 style="margin: 0 0 10px 0; color: #333;">Quick Stats</h4>
                        <p style="margin: 5px 0; font-size: 14px;">Free: ${stats.subscriptionBreakdown.free}</p>
                        <p style="margin: 5px 0; font-size: 14px;">Basic: ${stats.subscriptionBreakdown.basic}</p>
                        <p style="margin: 5px 0; font-size: 14px;">Premium: ${stats.subscriptionBreakdown.premium}</p>
                        <p style="margin: 5px 0; font-size: 14px;">Admin Sessions: ${stats.activeSessions}</p>
                    </div>
                </div>
            </div>
            
            <div class="refresh-note">
                Dashboard updates in real-time. Last refresh: ${new Date().toLocaleString()}
            </div>
        </div>
    </body>
    </html>
    `;
}

module.exports = router;
