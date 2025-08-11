const express = require('express');
const MicrosoftGraphService = require('../services/microsoftGraph');
const ClaudeAIService = require('../services/claudeAI');
const router = express.Router();

// Middleware to check authentication
const requireAuth = (req, res, next) => {
    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

// Get calendar events
router.get('/events', requireAuth, async (req, res) => {
    try {
        const { days = 7 } = req.query;
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const events = await graphService.getCalendarEvents(parseInt(days));
        
        res.json({
            success: true,
            period: `${days} days`,
            count: events.length,
            events: events
        });
    } catch (error) {
        console.error('Error fetching calendar events:', error);
        res.status(500).json({ 
            error: 'Failed to fetch calendar events',
            message: error.message 
        });
    }
});

// Get today's schedule
router.get('/today', requireAuth, async (req, res) => {
    try {
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const claudeService = new ClaudeAIService();
        
        // Get today's events
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const events = await graphService.getCalendarEvents(1);
        
        // Filter for today only
        const todayEvents = events.filter(event => {
            const eventDate = new Date(event.start.dateTime);
            return eventDate.toDateString() === today.toDateString();
        });
        
        // Generate AI summary
        const summaryQuery = `Provide a brief summary of today's schedule including:
        1. Number of meetings
        2. Most important meetings
        3. Available time blocks
        4. Any scheduling conflicts or tight timings`;
        
        const summary = await claudeService.processEmailQuery(summaryQuery, [], todayEvents);
        
        res.json({
            success: true,
            date: today.toDateString(),
            eventCount: todayEvents.length,
            events: todayEvents,
            summary: summary
        });
    } catch (error) {
        console.error('Error fetching today\'s schedule:', error);
        res.status(500).json({ 
            error: 'Failed to fetch today\'s schedule',
            message: error.message 
        });
    }
});

// Check availability
router.get('/availability', requireAuth, async (req, res) => {
    try {
        const { date, duration = 60 } = req.query;
        
        if (!date) {
            return res.status(400).json({ error: 'Date parameter is required (YYYY-MM-DD)' });
        }
        
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const claudeService = new ClaudeAIService();
        
        // Get events for the specified date
        const events = await graphService.getCalendarEvents(7);
        
        // Filter events for the specific date
        const targetDate = new Date(date);
        const dayEvents = events.filter(event => {
            const eventDate = new Date(event.start.dateTime);
            return eventDate.toDateString() === targetDate.toDateString();
        });
        
        // Use AI to analyze availability
        const availabilityQuery = `Based on these calendar events for ${date}, identify available time slots of at least ${duration} minutes during business hours (9 AM - 5 PM). Consider:
        1. Existing meetings and their durations
        2. Buffer time between meetings
        3. Lunch break (12-1 PM typically)
        4. Suggest the best available time slots`;
        
        const availability = await claudeService.processEmailQuery(availabilityQuery, [], dayEvents);
        
        res.json({
            success: true,
            date: date,
            requestedDuration: `${duration} minutes`,
            existingEvents: dayEvents.length,
            availability: availability,
            events: dayEvents
        });
    } catch (error) {
        console.error('Error checking availability:', error);
        res.status(500).json({ 
            error: 'Failed to check availability',
            message: error.message 
        });
    }
});

// Analyze calendar for scheduling conflicts
router.get('/conflicts', requireAuth, async (req, res) => {
    try {
        const { days = 7 } = req.query;
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const claudeService = new ClaudeAIService();
        
        const events = await graphService.getCalendarEvents(parseInt(days));
        
        const conflictQuery = `Analyze these calendar events for the next ${days} days and identify:
        1. Any overlapping meetings or scheduling conflicts
        2. Back-to-back meetings without breaks
        3. Very long meeting days (over 6 hours of meetings)
        4. Recommendations for better scheduling
        5. Potential free time for important tasks`;
        
        const analysis = await claudeService.processEmailQuery(conflictQuery, [], events);
        
        res.json({
            success: true,
            period: `${days} days`,
            totalEvents: events.length,
            analysis: analysis,
            events: events
        });
    } catch (error) {
        console.error('Error analyzing calendar conflicts:', error);
        res.status(500).json({ 
            error: 'Failed to analyze calendar conflicts',
            message: error.message 
        });
    }
});

// Get meeting preparation summary
router.get('/next-meeting', requireAuth, async (req, res) => {
    try {
        const graphService = new MicrosoftGraphService(req.session.accessToken);
        const claudeService = new ClaudeAIService();
        
        // Get upcoming events
        const events = await graphService.getCalendarEvents(1);
        
        // Find the next meeting (within next 24 hours)
        const now = new Date();
        const nextMeeting = events
            .filter(event => new Date(event.start.dateTime) > now)
            .sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime))[0];
        
        if (!nextMeeting) {
            return res.json({
                success: true,
                message: 'No upcoming meetings found in the next 24 hours',
                nextMeeting: null
            });
        }
        
        // Get recent emails that might be related to this meeting
        const emails = await graphService.getRecentEmails(7);
        
        const preparationQuery = `Based on this upcoming meeting and recent emails, provide:
        1. Meeting details summary
        2. Likely agenda or topics based on subject and attendees
        3. Any recent email discussions that might be relevant
        4. Preparation recommendations
        5. Key attendees to note
        
        Meeting: ${nextMeeting.subject}
        Time: ${new Date(nextMeeting.start.dateTime).toLocaleString()}
        Location: ${nextMeeting.location?.displayName || 'No location specified'}`;
        
        const preparation = await claudeService.processEmailQuery(preparationQuery, emails, [nextMeeting]);
        
        res.json({
            success: true,
            nextMeeting: {
                subject: nextMeeting.subject,
                start: nextMeeting.start.dateTime,
                end: nextMeeting.end.dateTime,
                location: nextMeeting.location?.displayName,
                attendees: nextMeeting.attendees?.length || 0
            },
            preparation: preparation
        });
    } catch (error) {
        console.error('Error getting next meeting info:', error);
        res.status(500).json({ 
            error: 'Failed to get next meeting information',
            message: error.message 
        });
    }
});

module.exports = router;
