const crypto = require('crypto');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'secure-password';
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// In-memory session store (for production, consider Redis)
const adminSessions = new Map();

// Clean up expired sessions every 15 minutes
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (now > session.expires) {
            adminSessions.delete(token);
        }
    }
}, 15 * 60 * 1000);

const requireAdminAuth = (req, res, next) => {
    const sessionToken = req.cookies.adminSession;
    
    // Check existing session
    if (sessionToken && adminSessions.has(sessionToken)) {
        const session = adminSessions.get(sessionToken);
        if (Date.now() < session.expires) {
            // Extend session
            session.expires = Date.now() + SESSION_TIMEOUT;
            req.adminUser = session.user;
            return next();
        } else {
            // Session expired
            adminSessions.delete(sessionToken);
            res.clearCookie('adminSession');
        }
    }
    
    // Handle login POST request
    if (req.method === 'POST' && req.body.username && req.body.password) {
        if (req.body.username === ADMIN_USERNAME && req.body.password === ADMIN_PASSWORD) {
            // Create new session
            const token = crypto.randomBytes(32).toString('hex');
            adminSessions.set(token, {
                expires: Date.now() + SESSION_TIMEOUT,
                user: req.body.username,
                loginTime: new Date().toISOString()
            });
            
            res.cookie('adminSession', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: SESSION_TIMEOUT,
                sameSite: 'strict'
            });
            
            console.log(`🔐 Admin login successful: ${req.body.username} at ${new Date().toISOString()}`);
            req.adminUser = req.body.username;
            return next();
        } else {
            console.warn(`⚠️ Failed admin login attempt: ${req.body.username} at ${new Date().toISOString()}`);
            return res.status(401).send(getLoginForm('Invalid credentials. Please try again.'));
        }
    }
    
    // Show login form
    res.send(getLoginForm());
};

const getLoginForm = (errorMessage = '') => {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Admin Login - AI Email Agent</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0;
                    padding: 20px;
                }
                .login-container {
                    background: white;
                    padding: 40px;
                    border-radius: 15px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                    max-width: 400px;
                    width: 100%;
                }
                .login-header {
                    text-align: center;
                    margin-bottom: 30px;
                }
                .login-header h2 {
                    color: #333;
                    margin: 10px 0;
                    font-weight: 300;
                }
                .login-icon {
                    font-size: 3rem;
                    margin-bottom: 10px;
                }
                .form-group {
                    margin-bottom: 20px;
                }
                .form-group label {
                    display: block;
                    margin-bottom: 5px;
                    color: #333;
                    font-weight: 500;
                }
                .form-input {
                    width: 100%;
                    padding: 12px 16px;
                    border: 2px solid #e1e5e9;
                    border-radius: 8px;
                    font-size: 16px;
                    transition: border-color 0.3s ease;
                    box-sizing: border-box;
                }
                .form-input:focus {
                    outline: none;
                    border-color: #667eea;
                }
                .login-button {
                    width: 100%;
                    padding: 12px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: transform 0.2s ease;
                }
                .login-button:hover {
                    transform: translateY(-2px);
                }
                .error-message {
                    background: #f8d7da;
                    color: #721c24;
                    padding: 12px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    text-align: center;
                }
                .security-note {
                    margin-top: 20px;
                    text-align: center;
                    font-size: 12px;
                    color: #666;
                }
            </style>
        </head>
        <body>
            <div class="login-container">
                <div class="login-header">
                    <div class="login-icon">🔐</div>
                    <h2>Admin Access</h2>
                    <p>AI Email Agent Control Panel</p>
                </div>
                
                ${errorMessage ? `<div class="error-message">${errorMessage}</div>` : ''}
                
                <form method="POST">
                    <div class="form-group">
                        <label for="username">Username</label>
                        <input type="text" id="username" name="username" class="form-input" required autocomplete="username">
                    </div>
                    <div class="form-group">
                        <label for="password">Password</label>
                        <input type="password" id="password" name="password" class="form-input" required autocomplete="current-password">
                    </div>
                    <button type="submit" class="login-button">
                        Access Dashboard
                    </button>
                </form>
                
                <div class="security-note">
                    Secure access only. All login attempts are logged.
                </div>
            </div>
        </body>
        </html>
    `;
};

// Logout function
const logoutAdmin = (req, res) => {
    const sessionToken = req.cookies.adminSession;
    if (sessionToken && adminSessions.has(sessionToken)) {
        adminSessions.delete(sessionToken);
        console.log(`🔐 Admin logout: ${req.adminUser} at ${new Date().toISOString()}`);
    }
    res.clearCookie('adminSession');
    res.redirect('/admin');
};

module.exports = { 
    requireAdminAuth, 
    logoutAdmin,
    getActiveSessionsCount: () => adminSessions.size 
};
