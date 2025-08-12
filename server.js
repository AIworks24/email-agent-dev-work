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

// AI Calendar Analysis and Recommendations
app.post('/api/calendar/analyze', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const { query } = req.body;
        const graphClient = createGraphClient(accessToken);
        const axios = require('axios');
        
        // Get recent emails and calendar events for context
        const [emails, events] = await Promise.all([
            graphClient.api('/me/messages').top(20).select('id,subject,from,receivedDateTime,bodyPreview').get(),
            graphClient.api('/me/events').filter(`start/dateTime ge '${new Date().toISOString()}'`).top(20).get()
        ]);

        const emailSummary = emails.value.map(email => 
            `${email.subject} from ${email.from?.emailAddress?.name} - ${email.bodyPreview?.substring(0, 100)}`
        ).join('\n');

        const eventSummary = events.value.map(event => 
            `${event.subject} - ${new Date(event.start.dateTime).toLocaleString()}`
        ).join('\n');

        const prompt = `You are an AI calendar assistant. Analyze the user's request and current schedule to provide recommendations.

User Request: ${query}

Recent Emails:
${emailSummary}

Upcoming Calendar Events:
${eventSummary}

Based on this information, provide:
1. Analysis of current schedule and any conflicts
2. Specific meeting recommendations with suggested times, attendees, and agenda
3. For each recommendation, provide a JSON object with: title, suggestedTime, duration, attendees, agenda

Format your response as recommendations followed by a JSON array of meeting suggestions.`;

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

        res.json({
            success: true,
            analysis: claudeResponse.data.content[0].text,
            emailCount: emails.value.length,
            eventCount: events.value.length
        });
        
    } catch (error) {
        console.error('Error analyzing calendar:', error);
        res.status(500).json({ error: 'Failed to analyze calendar', message: error.message });
    }
});

// Create calendar invite
app.post('/api/calendar/create-invite', async (req, res) => {
    const accessToken = req.cookies.accessToken;
    if (!accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const { title, startTime, endTime, attendees, agenda, location } = req.body;
        
        if (!title || !startTime || !endTime) {
            return res.status(400).json({ error: 'Title, start time, and end time are required' });
        }
        
        const graphClient = createGraphClient(accessToken);
        
        const event = {
            subject: title,
            start: {
                dateTime: startTime,
                timeZone: 'UTC'
            },
            end: {
                dateTime: endTime,
                timeZone: 'UTC'
            },
            body: {
                contentType: 'HTML',
                content: agenda || 'Meeting agenda to be determined.'
            },
            location: location ? {
                displayName: location
            } : undefined,
            attendees: attendees ? attendees.map(email => ({
                emailAddress: {
                    address: email,
                    name: email
                },
                type: 'required'
            })) : []
        };

        const createdEvent = await graphClient
            .api('/me/events')
            .post(event);
        
        res.json({
            success: true,
            message: 'Calendar invite created successfully',
            eventId: createdEvent.id,
            event: createdEvent
        });
        
    } catch (error) {
        console.error('Error creating calendar invite:', error);
        res.status(500).json({ error: 'Failed to create calendar invite', message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 AI Email Agent running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
