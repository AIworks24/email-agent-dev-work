const express = require('express');
const MicrosoftGraphService = require('../services/microsoftGraph');
const ClaudeAIService = require('../services/claudeAI');
const UserSettings = require('../models/UserSettings');
const router = express.Router();

// Middleware to check authentication
const requireAuth = (req, res, next) => {
    if (!req.cookies.accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userData = req.cookies.userData ? JSON.parse(req.cookies.userData) : null;
    if (!userData || !userData.tenantId || !userData.username) {
        return res.status(401).json({ error: 'Invalid authentication data' });
    }
    
    req.session.accessToken = req.cookies.accessToken;
    
    // Extract user information
    req.userEmail = userData.username; // This should be the email from Microsoft 365
    req.userTenant = userData.tenantId;
    req.userOrganization = userData.organizationName;
    req.userName = userData.name;
    
    next();
};

async function getUserSignature(userEmail, tenantId) {
    try {
        console.log(`🔍 Looking up signature for user: ${userEmail} in tenant: ${tenantId}`);
        
        const userSettings = await UserSettings.findByUserEmail(userEmail, tenantId);
        
        if (userSettings && userSettings.signature) {
            console.log(`✅ Found signature for user: ${userEmail}`);
            return userSettings.signature;
        }
        
        console.log(`📭 No signature found for user: ${userEmail}`);
        return null;
    } catch (error) {
        console.error('Error fetching user signature:', error);
        return null;
    }
}

// Get recent emails
router.get('/', requireAuth, async (req, res) => {
    try {
        const { days = 1 } = req.query;
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const emails = await graphService.getRecentEmails(parseInt(days));
        
        res.json({
            success: true,
            count: emails.length,
            emails: emails
        });
    } catch (error) {
        console.error('Error fetching emails:', error);
        res.status(500).json({ 
            error: 'Failed to fetch emails',
            message: error.message 
        });
    }
});

// Get specific email content
router.get('/:emailId', requireAuth, async (req, res) => {
    try {
        const { emailId } = req.params;
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const email = await graphService.getEmailContent(emailId);
        
        res.json({
            success: true,
            email: email
        });
    } catch (error) {
        console.error('Error fetching email content:', error);
        res.status(500).json({ 
            error: 'Failed to fetch email content',
            message: error.message 
        });
    }
});

// Process email query with AI
router.post('/query', requireAuth, async (req, res) => {
    try {
        const { query, includeDays = 1 } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const claudeService = new ClaudeAIService();
        
        // Get recent emails and calendar data
        const [emails, calendarEvents] = await Promise.all([
            graphService.getRecentEmails(includeDays),
            graphService.getCalendarEvents(7).catch(() => []) // Don't fail if calendar fails
        ]);
        
        // Process with Claude AI
        const response = await claudeService.processEmailQuery(query, emails, calendarEvents);
        
        res.json({
            success: true,
            query: query,
            response: response,
            emailCount: emails.length,
            calendarEventCount: calendarEvents.length
        });
    } catch (error) {
        console.error('Error processing email query:', error);
        res.status(500).json({ 
            error: 'Failed to process query',
            message: error.message 
        });
    }
});

router.post('/:emailId/respond', requireAuth, async (req, res) => {
    try {
        const { emailId } = req.params;
        const { context = '', tone = 'professional' } = req.body;
        
        console.log(`📝 Generating email response for email ${emailId}`);
        console.log(`👤 User: ${req.userEmail} (${req.userName}) in tenant: ${req.userTenant}`);
        
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const claudeService = new ClaudeAIService();
        
        // Get original email
        const originalEmail = await graphService.getEmailContent(emailId);
        
        // Get THIS USER's signature settings (not organization-wide)
        const userSignature = await getUserSignature(req.userEmail, req.userTenant);
        
        console.log(`🖊️ User signature ${userSignature && userSignature.enabled ? 'enabled' : 'disabled/not found'} for ${req.userEmail}`);
        
        // Generate response with user's personal signature
        const responseContent = await claudeService.generateEmailResponse(
            originalEmail, 
            context, 
            tone, 
            userSignature
        );
        
        res.json({
            success: true,
            originalSubject: originalEmail.subject,
            originalFrom: `${originalEmail.from?.emailAddress?.name} <${originalEmail.from?.emailAddress?.address}>`,
            generatedResponse: responseContent,
            suggestedSubject: `Re: ${originalEmail.subject}`,
            signatureIncluded: !!(userSignature && userSignature.enabled),
            userEmail: req.userEmail
        });
        
    } catch (error) {
        console.error('Error generating email response:', error);
        res.status(500).json({ 
            error: 'Failed to generate response',
            message: error.message 
        });
    }
});


// Send email response
router.post('/:emailId/send', requireAuth, async (req, res) => {
    try {
        const { emailId } = req.params;
        const { responseContent, subject } = req.body;
        
        if (!responseContent) {
            return res.status(400).json({ error: 'Response content is required' });
        }

        console.log(`📧 Sending email response for ${emailId}`);
        console.log(`👤 Sent by user: ${req.userEmail} (${req.userName})`);
        
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        
        // Get original email to get sender info
        const originalEmail = await graphService.getEmailContent(emailId);
        const recipientEmail = originalEmail.from.emailAddress.address;
        const responseSubject = subject || `Re: ${originalEmail.subject}`;
        
        // Send the response
        const result = await graphService.sendEmail(
            recipientEmail,
            responseSubject,
            responseContent,
            emailId
        );

        console.log(`✅ Email sent successfully from ${req.userEmail} to ${recipientEmail}`);

        try {
            const userSettings = await UserSettings.findByUserEmail(req.userEmail, req.userTenant);
            if (userSettings) {
                await userSettings.updateLastActive();
            }
        } catch (updateError) {
            console.warn('Could not update user last active time:', updateError.message);
        }
        
        res.json({
            success: true,
            message: 'Email response sent successfully',
            recipient: recipientEmail,
            subject: responseSubject,
            sentBy: req.userEmail
        });
        
    } catch (error) {
        console.error('Error sending email response:', error);
        res.status(500).json({ 
            error: 'Failed to send email response',
            message: error.message 
        });
    }
});

// Mark email as read
router.patch('/:emailId/read', requireAuth, async (req, res) => {
    try {
        const { emailId } = req.params;
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        
        const result = await graphService.markEmailAsRead(emailId);
        
        res.json(result);
    } catch (error) {
        console.error('Error marking email as read:', error);
        res.status(500).json({ 
            error: 'Failed to mark email as read',
            message: error.message 
        });
    }
});

// Email summary endpoint
router.get('/summary/daily', requireAuth, async (req, res) => {
    try {
        const { days = 1 } = req.query;
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const claudeService = new ClaudeAIService();
        
        const emails = await graphService.getRecentEmails(parseInt(days));
        
        const summaryQuery = `Provide a summary of these emails including:
        1. Total number of emails
        2. Number of unread emails
        3. Most important emails (by sender or content)
        4. Any action items or follow-ups needed
        5. Quick overview of main topics/themes`;
        
        const summary = await claudeService.processEmailQuery(summaryQuery, emails);
        
        res.json({
            success: true,
            period: `${days} day(s)`,
            totalEmails: emails.length,
            unreadEmails: emails.filter(e => !e.isRead).length,
            summary: summary
        });
    } catch (error) {
        console.error('Error generating email summary:', error);
        res.status(500).json({ 
            error: 'Failed to generate email summary',
            message: error.message 
        });
    }
});

module.exports = router;
