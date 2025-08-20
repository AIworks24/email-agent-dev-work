require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const { initializeDatabase } = require('./src/config/initDatabase');
const app = express();
const PORT = process.env.PORT || 3000;

// MOVE THESE FUNCTIONS OUTSIDE THE DATABASE CALLBACK
/**
 * Helper function to determine if we're in Daylight Saving Time
 */
function isInDST(date = new Date()) {
    const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
    const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
    return Math.max(jan, jul) !== date.getTimezoneOffset();
}

/**
 * Get timezone label (EST vs EDT) based on current date
 */
function getTimezoneLabel(date = new Date()) {
    return isInDST(date) ? 'EDT' : 'EST';
}

/**
 * Create timezone-aware date range for calendar queries
 */
function createUserTimezoneDateRange(userTimezone = 'America/New_York', days = 7) {
    const now = new Date();
    
    // Create start of current day in user timezone
    const startDate = new Date(now.toLocaleString('en-US', { timeZone: userTimezone }));
    startDate.setHours(0, 0, 0, 0);
    
    // Create end date (start + days) in user timezone
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days);
    endDate.setHours(23, 59, 59, 999);
    
    return {
        start: startDate,
        end: endDate,
        userTimezone,
        timezoneLabel: getTimezoneLabel()
    };
}

/**
 * Create timezone-aware date range for a specific day
 */
function createUserTimezoneDay(userTimezone = 'America/New_York', daysOffset = 0) {
    const now = new Date();
    
    // Get today in user timezone and add offset
    const targetDate = new Date(now.toLocaleString('en-US', { timeZone: userTimezone }));
    targetDate.setDate(targetDate.getDate() + daysOffset);
    
    // Create start of day (00:00:00)
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    // Create end of day (23:59:59)
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    return {
        start: startOfDay,
        end: endOfDay,
        userTimezone,
        timezoneLabel: getTimezoneLabel()
    };
}

// Initialize database
initializeDatabase().then(success => {
    if (success) {
        console.log('🚀 Database ready for multi-tenant operations');
    } else {
        console.error('⚠️ Database initialization failed - some features may not work');
    }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-session-secret',
    resave: true,
    saveUninitialized: true,
    cookie: { 
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

function createGraphClient(accessToken) {
    const { Client } = require('@microsoft/microsoft-graph-client');
    
    const authProvider = {
        getAccessToken: async () => {
            return accessToken;
        }
    };
    
    return Client.initWithMiddleware({
        authProvider: authProvider
    });
}

// Basic routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/dashboard.html'));
});

app.get('/test', (req, res) => {
    res.send('TEST ROUTE WORKS!');
});

// Auth routes
app.get('/auth/login', async (req, res) => {
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
                authority: 'https://login.microsoftonline.com/common'
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
        
        // Extract tenant and organization info
        const tenantId = response.account.tenantId;
        const organizationName = response.account.tenantDisplayName || 'Unknown Organization';
        const userDomain = response.account.username.split('@')[1];
        
        // Store/update organization in database and INCREMENT login count
        try {
            const ClientOrganization = require('./src/models/ClientOrganization');
            
            const [organization, created] = await ClientOrganization.findOrCreate({
                where: { tenantId: tenantId },
                defaults: {
                    organizationName: organizationName,
                    domain: userDomain,
                    subscriptionTier: 'free',
                    isActive: true,
                    userCount: 1, // First login = 1
                    lastActiveAt: new Date()
                }
            });
            
            if (created) {
                console.log(`🎉 New organization registered: ${organizationName} (${tenantId}) - Login count: 1`);
            } else {
                // ALWAYS increment login count on each login (regardless of user)
                await organization.update({ 
                    updatedAt: new Date(),
                    lastActiveAt: new Date(),
                    userCount: organization.userCount + 1 // Increment total login count
                });
                console.log(`✅ User login: ${response.account.username} from ${organizationName} - Total logins: ${organization.userCount + 1}`);
            }
            
            const userData = {
                id: response.account.homeAccountId,
                username: response.account.username,
                name: response.account.name,
                tenantId: tenantId,
                organizationName: organizationName,
                organizationId: organization.id
            };
            
            res.cookie('accessToken', response.accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000
            });
            
            res.cookie('userData', JSON.stringify(userData), {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000
            });
            
            console.log(`✅ User authenticated: ${response.account.username} from ${organizationName}`);
            res.redirect('/dashboard');
            
        } catch (dbError) {
            console.error('Database error during auth:', dbError);
            // Still allow login even if database fails
            const userData = {
                id: response.account.homeAccountId,
                username: response.account.username,
                name: response.account.name,
                tenantId: tenantId,
                organizationName: organizationName
            };
            
            res.cookie('accessToken', response.accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000
            });
            
            res.cookie('userData', JSON.stringify(userData), {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000
            });
            
            res.redirect('/dashboard');
        }
        
    } catch (error) {
        console.error('Token exchange error:', error);
        res.status(500).json({ 
            error: 'Token exchange failed',
            message: error.message
        });
    }
});

app.get('/auth/logout', (req, res) => {
    console.log('🚪 User logout requested');
    
    try {
        const userData = req.cookies.userData;
        if (userData) {
            const user = JSON.parse(userData);
            console.log(`👋 User logging out: ${user.username} from ${user.organizationName || 'Unknown Org'}`);
        }
        
        // Clear authentication cookies
        res.clearCookie('accessToken');
        res.clearCookie('userData');
        
        console.log('✅ User session cleared - redirecting to home');
        res.redirect('/');
        
    } catch (error) {
        console.error('Logout error:', error);
        // Still clear cookies and redirect even if there's an error
        res.clearCookie('accessToken');
        res.clearCookie('userData');
        res.redirect('/');
    }
});

app.get('/auth/user', (req, res) => {
    const userData = req.cookies.userData;
    const accessToken = req.cookies.accessToken;
    
    if (!userData || !accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const user = JSON.parse(userData);
        res.json({
            user: user,
            authenticated: true
        });
    } catch (error) {
        res.status(401).json({ error: 'Invalid user data' });
    }
});

app.get('/auth/debug', (req, res) => {
    res.json({
        hasSession: !!req.session,
        sessionId: req.sessionID,
        hasAccessToken: !!req.session?.accessToken,
        hasUser: !!req.session?.user,
        user: req.session?.user,
        cookies: req.headers.cookie
    });
});

app.use(express.urlencoded({ extended: true }));

const adminRoutes = require('./src/routes/admin');
app.use('/admin', adminRoutes);

app.get('/api/debug/graph', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    
    res.json({
        hasAccessToken: !!accessToken,
        tokenLength: accessToken ? accessToken.length : 0,
        tokenStart: accessToken ? accessToken.substring(0, 20) + '...' : 'No token'
    });
});

// API Routes
// Replace the existing /api/emails endpoint in your server.js with this improved version:

app.get('/api/emails', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const { days = 1 } = req.query;
        const graphClient = createGraphClient(accessToken);
        
        // Get current user info to filter out sent emails
        const userProfile = await graphClient.api('/me').select('mail').get();
        
        // Get emails from Inbox folder specifically to avoid sent items
        const emails = await graphClient
            .api('/me/mailFolders/inbox/messages')
            .filter(`receivedDateTime ge ${new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()}`)
            .select('id,subject,from,sender,receivedDateTime,bodyPreview,isRead,importance,hasAttachments,parentFolderId')
            .orderby('receivedDateTime desc')
            .top(50)
            .get();
        
        // Additional filtering on the server side to ensure we only get received emails
        const receivedEmails = emails.value.filter(email => {
            // Make sure this email has a 'from' field and it's not from the user
            const fromEmail = email.from?.emailAddress?.address || email.sender?.emailAddress?.address;
            return fromEmail && fromEmail.toLowerCase() !== userProfile.mail?.toLowerCase();
        });
        
        res.json({
            success: true,
            count: receivedEmails.length,
            emails: receivedEmails
        });
    } catch (error) {
        console.error('Error fetching emails:', error);
        res.status(500).json({ 
            error: 'Failed to fetch emails', 
            message: error.message 
        });
    }
});

app.get('/api/calendar/events', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const graphClient = createGraphClient(accessToken);
        const { days = 7 } = req.query;
        const userTimezone = 'America/New_York';
        
        // Use proper timezone-aware date range creation
        const dateRange = createUserTimezoneDateRange(userTimezone, parseInt(days));
        
        console.log('📅 Calendar events range calculation:', {
            userTimezone,
            days: parseInt(days),
            startISO: dateRange.start.toISOString(),
            endISO: dateRange.end.toISOString(),
            timezoneLabel: dateRange.timezoneLabel,
            startLocal: dateRange.start.toLocaleString('en-US', { timeZone: userTimezone }),
            endLocal: dateRange.end.toLocaleString('en-US', { timeZone: userTimezone })
        });

        // Fetch events with timezone preference
        const events = await graphClient
            .api('/me/events')
            .filter(`start/dateTime ge '${dateRange.start.toISOString()}' and end/dateTime le '${dateRange.end.toISOString()}'`)
            .select('id,subject,start,end,location,attendees,importance,showAs,organizer')
            .header('Prefer', `outlook.timezone="${userTimezone}"`)
            .orderby('start/dateTime')
            .top(50)
            .get();
        
        // Process events with corrected timezone handling
        const processedEvents = events.value.map(event => {
            // Parse the datetime from Microsoft Graph
            const startDateTime = new Date(event.start.dateTime);
            const endDateTime = new Date(event.end.dateTime);
            
            // Format times in user's timezone
            const startTimeFormatted = startDateTime.toLocaleString('en-US', {
                timeZone: userTimezone,
                weekday: 'short',
                month: 'short', 
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            
            const endTimeFormatted = endDateTime.toLocaleString('en-US', {
                timeZone: userTimezone,
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            
            return {
                ...event,
                start: {
                    ...event.start,
                    timeZone: userTimezone,
                    displayTime: startTimeFormatted,
                    timezoneLabel: dateRange.timezoneLabel
                },
                end: {
                    ...event.end,
                    timeZone: userTimezone,
                    displayTime: endTimeFormatted,
                    timezoneLabel: dateRange.timezoneLabel
                },
                displayTimeRange: `${startTimeFormatted} - ${endTimeFormatted} ${dateRange.timezoneLabel}`
            };
        });
        
        res.json({
            success: true,
            count: processedEvents.length,
            events: processedEvents,
            timezone: userTimezone,
            timezoneLabel: dateRange.timezoneLabel,
            isDST: isInDST(),
            debug: {
                queryStartUTC: dateRange.start.toISOString(),
                queryEndUTC: dateRange.end.toISOString(),
                requestedDays: parseInt(days),
                userTimezone: userTimezone
            }
        });
        
    } catch (error) {
        console.error('Error fetching calendar:', error);
        res.status(500).json({
            error: 'Failed to fetch calendar events', 
            message: error.message 
        });
    }
});
app.get('/api/calendar/today', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const graphClient = createGraphClient(accessToken);
        const userTimezone = 'America/New_York';
        
        // Use proper timezone-aware date range creation
        const todayRange = createUserTimezoneDay(userTimezone, 0);
        
        console.log('🕐 Today range calculation:', {
            userTimezone,
            startISO: todayRange.start.toISOString(),
            endISO: todayRange.end.toISOString(),
            timezoneLabel: todayRange.timezoneLabel,
            startLocal: todayRange.start.toLocaleString('en-US', { timeZone: userTimezone }),
            endLocal: todayRange.end.toLocaleString('en-US', { timeZone: userTimezone })
        });

        const events = await graphClient
            .api('/me/events')
            .filter(`start/dateTime ge '${todayRange.start.toISOString()}' and start/dateTime lt '${todayRange.end.toISOString()}'`)
            .select('id,subject,start,end,location,attendees,importance,showAs,organizer')
            .header('Prefer', `outlook.timezone="${userTimezone}"`)
            .orderby('start/dateTime')
            .get();
        
        // Format events with proper timezone display
        const formattedEvents = events.value.map(event => {
            const startTime = new Date(event.start.dateTime);
            const endTime = new Date(event.end.dateTime);
            
            // Format times specifically in user's timezone
            const startTimeFormatted = startTime.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: userTimezone
            });
            
            const endTimeFormatted = endTime.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: userTimezone
            });
            
            return {
                ...event,
                displayTime: `${startTimeFormatted} - ${endTimeFormatted} ${todayRange.timezoneLabel}`,
                start: {
                    ...event.start,
                    timeZone: userTimezone,
                    localTime: startTimeFormatted,
                    timezoneLabel: todayRange.timezoneLabel
                },
                end: {
                    ...event.end,
                    timeZone: userTimezone,
                    localTime: endTimeFormatted,
                    timezoneLabel: todayRange.timezoneLabel
                }
            };
        });
        
        // Get current date in user's timezone for display
        const todayInUserTZ = new Date().toLocaleDateString('en-US', { 
            timeZone: userTimezone,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        res.json({
            success: true,
            date: todayInUserTZ,
            eventCount: formattedEvents.length,
            events: formattedEvents,
            summary: `You have ${formattedEvents.length} meetings today.`,
            timezone: userTimezone,
            timezoneLabel: todayRange.timezoneLabel,
            debug: {
                queryStartUTC: todayRange.start.toISOString(),
                queryEndUTC: todayRange.end.toISOString(),
                userTimezone: userTimezone
            }
        });
    } catch (error) {
        console.error('Error fetching today schedule:', error);
        res.status(500).json({ 
            error: 'Failed to fetch today\'s schedule', 
            message: error.message 
        });
    }
});

app.get('/api/emails/summary/daily', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const graphClient = createGraphClient(accessToken);
        const axios = require('axios');
        
        const emails = await graphClient
            .api('/me/messages')
            .top(20)
            .select('id,subject,from,receivedDateTime,bodyPreview,isRead,importance')
            .get();

        const emailSummary = emails.value.map((email, index) => {
            const from = email.from?.emailAddress?.address || 'Unknown sender';
            const name = email.from?.emailAddress?.name || '';
            const date = new Date(email.receivedDateTime).toLocaleDateString();
            const preview = email.bodyPreview?.substring(0, 100) || 'No preview';
            
            return `${index + 1}. From: ${name} <${from}>
   Subject: ${email.subject}
   Date: ${date}
   Read: ${email.isRead ? 'Yes' : 'No'}
   Preview: ${preview}...`;
        }).join('\n\n');

        const summaryQuery = `Provide a summary of these emails including:
        1. Total number of emails
        2. Number of unread emails  
        3. Most important emails (by sender or content)
        4. Any action items or follow-ups needed
        5. Quick overview of main topics/themes`;

        const claudeResponse = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            messages: [
                { 
                    role: 'user', 
                    content: `${summaryQuery}

Recent Email Data:
${emailSummary}

Provide a helpful summary of the user's emails. Be specific and actionable.`
                }
            ]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            }
        });
        
        const unreadCount = emails.value.filter(e => !e.isRead).length;
        
        res.json({
            success: true,
            totalEmails: emails.value.length,
            unreadEmails: unreadCount,
            summary: claudeResponse.data.content[0].text
        });
    } catch (error) {
        console.error('Error generating summary:', error);
        res.status(500).json({ error: 'Failed to generate email summary', message: error.message });
    }
});

app.post('/api/emails/query', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        const graphClient = createGraphClient(accessToken);
        const axios = require('axios');
        
        const emails = await graphClient
            .api('/me/messages')
            .top(20)
            .select('id,subject,from,receivedDateTime,bodyPreview,isRead,importance')
            .get();

        const emailSummary = emails.value.map((email, index) => {
            const from = email.from?.emailAddress?.address || 'Unknown sender';
            const name = email.from?.emailAddress?.name || '';
            const date = new Date(email.receivedDateTime).toLocaleDateString();
            const preview = email.bodyPreview?.substring(0, 100) || 'No preview';
            
            return `${index + 1}. From: ${name} <${from}>
   Subject: ${email.subject}
   Date: ${date}
   Read: ${email.isRead ? 'Yes' : 'No'}
   Preview: ${preview}...`;
        }).join('\n\n');

        const claudeResponse = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            messages: [
                { 
                    role: 'user', 
                    content: `You are an AI assistant helping to manage Microsoft 365 emails. Provide helpful, concise responses.

User Query: ${query}

Recent Email Data:
${emailSummary}

Provide a helpful response to the user's query. Be specific and actionable.`
                }
            ]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            }
        });

        res.json({
            success: true,
            query: query,
            response: claudeResponse.data.content[0].text,
            emailCount: emails.value.length
        });
        
    } catch (error) {
        console.error('Error processing query:', error);
        res.status(500).json({ error: 'Failed to process query', message: error.message });
    }
});

app.get('/api/emails/:emailId', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const { emailId } = req.params;
        const graphClient = createGraphClient(accessToken);
        
        const email = await graphClient
            .api(`/me/messages/${emailId}`)
            .select('id,subject,from,sender,receivedDateTime,body,bodyPreview,replyTo,toRecipients,ccRecipients,importance,hasAttachments')
            .get();
        
        res.json({
            success: true,
            email: email
        });
    } catch (error) {
        console.error('Error fetching email content:', error);
        res.status(500).json({ 
            error: 'Failed to fetch email content', 
            message: error.message,
            details: error.response?.data || 'No additional details available'
        });
    }
});

app.post('/api/emails/:emailId/respond', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const { emailId } = req.params;
        const { context = '', tone = 'professional' } = req.body;
        
        const graphClient = createGraphClient(accessToken);
        const axios = require('axios');
        
        // Get original email content with correct field selection
        const originalEmail = await graphClient
            .api(`/me/messages/${emailId}`)
            .select('id,subject,from,receivedDateTime,body,bodyPreview,sender,replyTo,toRecipients')
            .get();
        
        console.log('Original email data:', JSON.stringify(originalEmail, null, 2)); // Debug log
        
        // Extract email content safely
        const fromName = originalEmail.from?.emailAddress?.name || originalEmail.sender?.emailAddress?.name || 'Unknown Sender';
        const fromEmail = originalEmail.from?.emailAddress?.address || originalEmail.sender?.emailAddress?.address || 'unknown@email.com';
        const emailBody = originalEmail.body?.content || originalEmail.bodyPreview || 'No content available';
        const subject = originalEmail.subject || 'No Subject';
        
        // Generate response using Claude
        const prompt = `Generate a ${tone} email response to the following email:

Original Email:
From: ${fromName} <${fromEmail}>
Subject: ${subject}
Content: ${emailBody}

Additional Context: ${context}

Generate an appropriate response that:
- Addresses the main points of the original email
- Maintains a ${tone} tone
- Is concise but complete
- Includes a proper greeting and closing

Return only the email content without subject line.`;

        const claudeResponse = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 800,
            messages: [{ role: 'user', content: prompt }]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            }
        });
        
        res.json({
            success: true,
            originalSubject: subject,
            originalFrom: fromName,
            originalFromEmail: fromEmail,
            generatedResponse: claudeResponse.data.content[0].text,
            suggestedSubject: `Re: ${subject}`,
            emailId: emailId
        });
        
    } catch (error) {
        console.error('Error generating email response:', error);
        
        // More detailed error logging
        if (error.response && error.response.data) {
            console.error('API Error Details:', error.response.data);
        }
        
        res.status(500).json({ 
            error: 'Failed to generate response', 
            message: error.message,
            details: error.response?.data || 'No additional details available'
        });
    }
});

app.post('/api/emails/:emailId/send', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const { emailId } = req.params;
        const { responseContent, subject } = req.body;
        
        if (!responseContent) {
            return res.status(400).json({ error: 'Response content is required' });
        }
        
        const graphClient = createGraphClient(accessToken);
        
        // Get original email to get sender info with correct fields
        const originalEmail = await graphClient
            .api(`/me/messages/${emailId}`)
            .select('from,sender,subject')
            .get();
        
        // Extract recipient email safely
        const recipientEmail = originalEmail.from?.emailAddress?.address || 
                              originalEmail.sender?.emailAddress?.address;
        
        if (!recipientEmail) {
            throw new Error('Could not determine recipient email address');
        }
        
        const responseSubject = subject || `Re: ${originalEmail.subject || 'No Subject'}`;
        
        // Send the response
        const message = {
            subject: responseSubject,
            body: {
                contentType: 'HTML',
                content: responseContent
            },
            toRecipients: [{
                emailAddress: {
                    address: recipientEmail
                }
            }]
        };

        await graphClient
            .api('/me/sendMail')
            .post({ message });
        
        res.json({
            success: true,
            message: 'Email response sent successfully',
            recipient: recipientEmail,
            subject: responseSubject
        });
        
    } catch (error) {
        console.error('Error sending email response:', error);
        res.status(500).json({ 
            error: 'Failed to send email response', 
            message: error.message,
            details: error.response?.data || 'No additional details available'
        });
    }
});

// Move selected emails to deleted items (soft delete)
app.post('/api/emails/move-selected-to-trash', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const { emailIds } = req.body;
        
        if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
            return res.status(400).json({ error: 'Email IDs array is required' });
        }
        
        const graphClient = createGraphClient(accessToken);
        const results = [];
        
        // Move each selected email to deleted items folder
        for (const emailId of emailIds) {
            try {
                await graphClient
                    .api(`/me/messages/${emailId}/move`)
                    .post({
                        destinationId: 'deleteditems'
                    });
                
                results.push({
                    emailId: emailId,
                    success: true,
                    message: 'Moved to deleted items'
                });
            } catch (error) {
                console.error(`Error moving email ${emailId}:`, error);
                results.push({
                    emailId: emailId,
                    success: false,
                    error: error.message
                });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        res.json({
            success: true,
            message: `Moved ${successCount} emails to deleted items${failCount > 0 ? `, ${failCount} failed` : ''}`,
            results: results,
            summary: {
                total: emailIds.length,
                successful: successCount,
                failed: failCount
            }
        });
        
    } catch (error) {
        console.error('Error in move to trash operation:', error);
        res.status(500).json({ 
            error: 'Failed to move emails to deleted items', 
            message: error.message 
        });
    }
});

app.post('/api/calendar/analyze', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const { query, emailContext } = req.body;
        const graphClient = createGraphClient(accessToken);
        const axios = require('axios');
        const userTimezone = 'America/New_York';
        
        // Simple timezone detection
        const now = new Date();
        const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
        const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
        const isDST = Math.max(jan, jul) !== now.getTimezoneOffset();
        const timezoneLabel = isDST ? 'EDT' : 'EST';
        
        // Get current time context
        const currentTime = now.toLocaleString('en-US', {
            timeZone: userTimezone,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZoneName: 'short'
        });
        
        // FIXED: Use timezone-aware date range
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0); // Start of today
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 14); // 2 weeks ahead
        endDate.setHours(23, 59, 59, 999);
        
        console.log('🕐 Calendar query debug:', {
            userTimezone,
            timezoneLabel,
            startLocal: startDate.toLocaleString('en-US', { timeZone: userTimezone }),
            endLocal: endDate.toLocaleString('en-US', { timeZone: userTimezone }),
            startUTC: startDate.toISOString(),
            endUTC: endDate.toISOString()
        });
        
        // Get recent emails and calendar events for context
        const [emails, events, userProfile] = await Promise.all([
            graphClient.api('/me/messages').top(20).select('id,subject,from,receivedDateTime,bodyPreview,body').get(),
            graphClient.api('/me/events')
                .filter(`start/dateTime ge '${startDate.toISOString()}' and end/dateTime le '${endDate.toISOString()}'`)
                .header('Prefer', `outlook.timezone="${userTimezone}"`) // THIS IS CRITICAL
                .select('id,subject,start,end,location,attendees,importance,showAs,organizer')
                .orderby('start/dateTime')
                .top(20).get(),
            graphClient.api('/me').select('mail,displayName').get()
        ]);

        // Format email summary with correct timezone
        const emailSummary = emails.value.map(email => {
            const emailTime = new Date(email.receivedDateTime).toLocaleString('en-US', {
                timeZone: userTimezone,
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            return `${email.subject} from ${email.from?.emailAddress?.name} (${emailTime} ${timezoneLabel}) - ${email.bodyPreview?.substring(0, 100)}`;
        }).join('\n');

        // FORMAT EVENTS WITH PROPER TIMEZONE CONVERSION
        const eventSummary = events.value.map(event => {
            // Microsoft Graph returns the datetime in the timezone specified by the header
            // But we need to ensure proper formatting
            const eventDateTime = new Date(event.start.dateTime);
            
            console.log('📅 Event debug:', {
                eventTitle: event.subject,
                rawDateTime: event.start.dateTime,
                parsedDateTime: eventDateTime.toISOString(),
                formattedInUserTZ: eventDateTime.toLocaleString('en-US', { timeZone: userTimezone })
            });
            
            const eventTime = eventDateTime.toLocaleString('en-US', {
                timeZone: userTimezone,
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            
            return `${event.subject} - ${eventTime} ${timezoneLabel}`;
        }).join('\n');

        // Build prompt for Claude with debug info
        const prompt = `You are an AI calendar assistant. Current time: ${currentTime}

User Request: ${query}

${emailContext ? `
Related Email Context:
From: ${emailContext.from}
Subject: ${emailContext.subject} 
Content: ${emailContext.content}
` : ''}

Recent Emails (with ${timezoneLabel} times):
${emailSummary}

Upcoming Calendar Events (in ${timezoneLabel}):
${eventSummary}

Current User: ${userProfile.displayName} (${userProfile.mail})

CRITICAL: All event times above are already converted to ${timezoneLabel}. When displaying times, use exactly what's provided above.

INSTRUCTIONS:
1. All times should be referenced in Eastern Time (${timezoneLabel})
2. Provide clean, formatted text response
3. DO NOT include JSON code blocks in your main response

Provide analysis of the request and calendar information.

If you detect a meeting should be scheduled, end with only this JSON:
{"meetingDetected": true, "meetingDetails": {"title": "title", "duration": 60, "attendees": ["email"], "description": "description", "meetingType": "teams", "suggestedTimes": [{"date": "2025-08-21", "time": "14:00", "label": "Tomorrow 2:00 PM ${timezoneLabel}"}], "priority": "medium"}}

If no meeting detected:
{"meetingDetected": false}`;

        const claudeResponse = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            messages: [{ role: 'user', content: prompt }]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            }
        });

        let responseText = claudeResponse.data.content[0].text;
        
        // Extract and clean JSON from response
        let meetingData = null;
        const jsonMatch = responseText.match(/\{[\s\S]*?"meetingDetected"[\s\S]*?\}/);
        
        if (jsonMatch) {
            try {
                meetingData = JSON.parse(jsonMatch[0]);
                responseText = responseText.replace(jsonMatch[0], '').trim();
                
                if (meetingData.meetingDetails && meetingData.meetingDetails.suggestedTimes) {
                    meetingData.meetingDetails.suggestedTimes = meetingData.meetingDetails.suggestedTimes.map(time => ({
                        ...time,
                        timezone: userTimezone,
                        timezoneLabel: timezoneLabel
                    }));
                }
            } catch (e) {
                console.log('Could not parse meeting JSON:', e);
                responseText = responseText.replace(/\{[\s\S]*?\}/g, '').trim();
            }
        }

        // Clean up any remaining JSON artifacts
        responseText = responseText.replace(/```json[\s\S]*?```/g, '').trim();
        responseText = responseText.replace(/```[\s\S]*?```/g, '').trim();

        res.json({
            success: true,
            analysis: responseText,
            meetingData: meetingData,
            emailCount: emails.value.length,
            eventCount: events.value.length,
            currentTime: currentTime,
            timezone: userTimezone,
            timezoneLabel: timezoneLabel,
            debug: {
                eventsFound: events.value.length,
                sampleEvent: events.value[0] ? {
                    title: events.value[0].subject,
                    rawTime: events.value[0].start.dateTime,
                    formattedTime: new Date(events.value[0].start.dateTime).toLocaleString('en-US', { timeZone: userTimezone })
                } : null
            }
        });
        
    } catch (error) {
        console.error('Error analyzing calendar:', error);
        res.status(500).json({ 
            error: 'Failed to analyze calendar', 
            message: error.message 
        });
    }
});

// Enhanced meeting creation endpoint with Teams/Zoom support
app.post('/api/calendar/create-invite', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const { title, startTime, endTime, attendees, location, agenda, meetingType } = req.body;
        
        if (!title || !startTime || !endTime) {
            return res.status(400).json({ error: 'Title, start time, and end time are required' });
        }
        
        const graphClient = createGraphClient(accessToken);
        const userTimezone = 'America/New_York';
        
        // Prepare meeting location based on type
        let meetingLocation = location;
        let onlineMeeting = null;
        
        if (meetingType === 'teams') {
            onlineMeeting = {
                provider: 'teamsForBusiness'
            };
            meetingLocation = 'Microsoft Teams Meeting';
        } else if (meetingType === 'zoom') {
            meetingLocation = 'Zoom Meeting (Link to be provided)';
        }
        
        const event = {
            subject: title,
            start: {
                dateTime: new Date(startTime).toISOString(),
                timeZone: userTimezone // Specify the user's timezone
            },
            end: {
                dateTime: new Date(endTime).toISOString(),
                timeZone: userTimezone // Specify the user's timezone
            },
            body: {
                contentType: 'HTML',
                content: agenda || 'Meeting agenda to be determined.'
            },
            location: meetingLocation ? {
                displayName: meetingLocation
            } : undefined,
            attendees: attendees ? attendees.map(email => ({
                emailAddress: {
                    address: email,
                    name: email
                },
                type: 'required'
            })) : [],
            isOnlineMeeting: meetingType === 'teams',
            onlineMeetingProvider: meetingType === 'teams' ? 'teamsForBusiness' : undefined
        };

        const createdEvent = await graphClient
            .api('/me/events')
            .post(event);
        
        res.json({
            success: true,
            message: 'Calendar invite created successfully',
            eventId: createdEvent.id,
            event: createdEvent,
            meetingType: meetingType,
            timezone: userTimezone
        });
        
    } catch (error) {
        console.error('Error creating calendar invite:', error);
        res.status(500).json({ 
            error: 'Failed to create calendar invite', 
            message: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 AI Email Agent running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
