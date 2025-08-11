require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Helper function to create Graph client
function createGraphClient(accessToken) {
    const { Client } = require('@microsoft/microsoft-graph-client');
    return Client.init({
        authProvider: {
            getAccessToken: async () => accessToken
        }
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
        
        const userData = {
            id: response.account.homeAccountId,
            username: response.account.username,
            name: response.account.name
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
        
        console.log(`✅ User authenticated: ${response.account.username}`);
        res.redirect('/dashboard');
        
    } catch (error) {
        console.error('Token exchange error:', error);
        res.status(500).json({ 
            error: 'Token exchange failed',
            message: error.message
        });
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

app.get('/api/debug/graph', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    
    res.json({
        hasAccessToken: !!accessToken,
        tokenLength: accessToken ? accessToken.length : 0,
        tokenStart: accessToken ? accessToken.substring(0, 20) + '...' : 'No token'
    });
});

// API Routes
app.get('/api/emails', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const graphClient = createGraphClient(accessToken);
        
        const emails = await graphClient
            .api('/me/messages')
            .top(50)
            .select('id,subject,from,receivedDateTime,isRead')
            .get();
        
        res.json({
            success: true,
            count: emails.value.length,
            emails: emails.value
        });
    } catch (error) {
        console.error('Error fetching emails:', error);
        res.status(500).json({ error: 'Failed to fetch emails', message: error.message });
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
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + parseInt(days));

        const events = await graphClient
            .api('/me/events')
            .filter(`start/dateTime ge '${startDate.toISOString()}' and end/dateTime le '${endDate.toISOString()}'`)
            .top(50)
            .get();
        
        res.json({
            success: true,
            count: events.value.length,
            events: events.value
        });
    } catch (error) {
        console.error('Error fetching calendar:', error);
        res.status(500).json({ error: 'Failed to fetch calendar events', message: error.message });
    }
});

app.get('/api/calendar/today', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const graphClient = createGraphClient(accessToken);
        
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const events = await graphClient
            .api('/me/events')
            .filter(`start/dateTime ge '${today.toISOString()}' and start/dateTime lt '${tomorrow.toISOString()}'`)
            .get();
        
        res.json({
            success: true,
            date: today.toDateString(),
            eventCount: events.value.length,
            events: events.value,
            summary: `You have ${events.value.length} meetings today.`
        });
    } catch (error) {
        console.error('Error fetching today schedule:', error);
        res.status(500).json({ error: 'Failed to fetch today\'s schedule', message: error.message });
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

app.listen(PORT, () => {
    console.log(`🚀 AI Email Agent running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
