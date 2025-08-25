// Update your src/routes/emails.js - CRITICAL FIXES for email threading

const express = require('express');
const MicrosoftGraphService = require('../services/microsoftGraph');
const ClaudeAIService = require('../services/claudeAI');
const UserSettings = require('../models/UserSettings'); // Make sure this is added
const router = express.Router();

// Updated authentication middleware to extract user data
const requireAuth = (req, res, next) => {
    if (!req.cookies.accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userData = req.cookies.userData ? JSON.parse(req.cookies.userData) : null;
    if (!userData || !userData.tenantId || !userData.username) {
        return res.status(401).json({ error: 'Invalid authentication data' });
    }
    
    req.accessToken = req.cookies.accessToken;
    
    // Extract user information for signature lookup
    req.userEmail = userData.username;
    req.userTenant = userData.tenantId;
    req.userOrganization = userData.organizationName;
    req.userName = userData.name;
    
    next();
};

// Helper function to get user's signature
async function getUserSignature(userEmail, tenantId) {
    try {
        console.log(`🔍 Looking up signature for user: ${userEmail}`);
        
        const userSettings = await UserSettings.findByUserEmail(userEmail, tenantId);
        
        if (userSettings && userSettings.signature) {
            console.log(`✅ Found signature for user: ${userEmail}`, userSettings.signature);
            return userSettings.signature;
        }
        
        console.log(`📭 No signature found for user: ${userEmail}`);
        return null;
    } catch (error) {
        console.error('Error fetching user signature:', error);
        return null;
    }
}

// Get recent emails (existing code - no changes)
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

// Get specific email content (existing code - no changes)
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

// Generate email response - UPDATED WITH SIGNATURE SUPPORT
router.post('/:emailId/respond', requireAuth, async (req, res) => {
    try {
        const { emailId } = req.params;
        const { context = '', tone = 'professional' } = req.body;
        
        console.log(`📝 Generating email response for email ${emailId}`);
        console.log(`👤 User: ${req.userEmail} in tenant: ${req.userTenant}`);
        
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const claudeService = new ClaudeAIService();
        
        // Get original email
        const originalEmail = await graphService.getEmailContent(emailId);

        // Get user's signature - USE ONLY ONE METHOD
        const userSignature = await getUserSignature(req.userEmail, req.userTenant);
        
        console.log(`🖊️ User signature ${userSignature && userSignature.enabled ? 'enabled' : 'disabled/not found'} for ${req.userEmail}`);
        
        // Generate response with signature
        const responseContent = await claudeService.generateEmailResponse(
            originalEmail, 
            context, 
            tone, 
            userSignature  // Pass signature to Claude
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

// CRITICAL FIX: Send email response as REPLY to maintain threading
router.post('/:emailId/send', requireAuth, async (req, res) => {
    try {
        const { emailId } = req.params;
        const { responseContent, subject, replyToAll = false } = req.body;
        
        if (!responseContent) {
            return res.status(400).json({ error: 'Response content is required' });
        }
        
        console.log(`📧 Replying to email thread ${emailId}`);
        console.log(`👤 Sent by user: ${req.userEmail}`);
        
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        
        // IMPROVED HTML conversion
        let htmlContent = responseContent
            .replace(/\n\n/g, '||PARAGRAPH||')
            .replace(/\n/g, '<br>')
            .replace(/\|\|PARAGRAPH\|\|/g, '</p><p>');

        if (!htmlContent.startsWith('<p>')) {
            htmlContent = '<p>' + htmlContent;
        }
        if (!htmlContent.endsWith('</p>')) {
            htmlContent = htmlContent + '</p>';
        }
        
        htmlContent = htmlContent.replace(/<p><\/p>/g, '');
        
        console.log('Converted HTML content:', htmlContent);
        
        // ONLY use replyToEmail (remove the sendEmail call)
        const result = await graphService.replyToEmail(emailId, htmlContent, replyToAll);
        
        console.log(`✅ Email reply sent successfully by ${req.userEmail}`);
        
        res.json({
            success: true,
            message: 'Email reply sent successfully - thread maintained',
            messageId: result.id,
            replyType: result.type,
            sentBy: req.userEmail,
            threadMaintained: true
        });
        
    } catch (error) {
        console.error('Error sending email reply:', error);
        res.status(500).json({ 
            error: 'Failed to send email reply',
            message: error.message
        });
    }
});

// NEW: Endpoint to send reply to all
router.post('/:emailId/reply-all', requireAuth, async (req, res) => {
    try {
        const { emailId } = req.params;
        const { responseContent } = req.body;
        
        if (!responseContent) {
            return res.status(400).json({ error: 'Response content is required' });
        }
        
        console.log(`📧 Replying to ALL on email thread ${emailId}`);
        console.log(`👤 Sent by user: ${req.userEmail}`);
        
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        
        // Get user signature
        const userSignature = await getUserSignature(req.userEmail, req.userTenant);
        
        // Add signature if enabled
        let finalContent = responseContent;
        if (userSignature && userSignature.enabled) {
            const claudeService = new ClaudeAIService();
            const signature = claudeService.formatSignature ? claudeService.formatSignature(userSignature) : '';
            if (signature) {
                finalContent += signature;
            }
        }
        
        // Convert to HTML
        const htmlContent = finalContent
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^(.*)$/, '<p>$1</p>')
            .replace(/<p><\/p>/g, '');
        
        // Reply to all
        const result = await graphService.replyToEmail(
            emailId,
            htmlContent,
            true // replyToAll = true
        );
        
        console.log(`✅ Reply to all sent successfully by ${req.userEmail}`);
        
        res.json({
            success: true,
            message: 'Reply to all sent successfully - thread maintained',
            messageId: result.id,
            replyType: result.type,
            sentBy: req.userEmail,
            threadMaintained: true
        });
        
    } catch (error) {
        console.error('Error sending reply to all:', error);
        res.status(500).json({ 
            error: 'Failed to send reply to all',
            message: error.message
        });
    }
});

// Process email query with AI (existing code - keep unchanged)
router.post('/query', requireAuth, async (req, res) => {
    try {
        const { query, includeDays = 1 } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const claudeService = new ClaudeAIService();
        
        const [emails, calendarEvents] = await Promise.all([
            graphService.getRecentEmails(includeDays),
            graphService.getCalendarEvents(7).catch(() => [])
        ]);
        
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

module.exports = router;
