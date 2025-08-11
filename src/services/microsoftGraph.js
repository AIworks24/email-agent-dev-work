const { Client } = require('@microsoft/microsoft-graph-client');

class TokenAuthProvider {
    constructor(accessToken) {
        this.accessToken = accessToken;
    }

    async getAccessToken() {
        return this.accessToken;
    }
}

class MicrosoftGraphService {
    constructor(accessToken) {
        const authProvider = new TokenAuthProvider(accessToken);
        this.graphClient = Client.initWithMiddleware({ authProvider });
    }

    async getUserProfile() {
        try {
            const user = await this.graphClient.api('/me').get();
            return user;
        } catch (error) {
            console.error('Error fetching user profile:', error);
            throw error;
        }
    }

    async getRecentEmails(days = 1) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        try {
            const emails = await this.graphClient
                .api('/me/messages')
                .filter(`receivedDateTime ge ${startDate.toISOString()}`)
                .select('id,subject,from,receivedDateTime,bodyPreview,isRead,importance,hasAttachments')
                .orderby('receivedDateTime desc')
                .top(50)
                .get();
            
            return emails.value;
        } catch (error) {
            console.error('Error fetching emails:', error);
            throw error;
        }
    }

    async getEmailContent(emailId) {
        try {
            const email = await this.graphClient
                .api(`/me/messages/${emailId}`)
                .select('id,subject,from,to,receivedDateTime,body,attachments,replyTo')
                .get();
            
            return email;
        } catch (error) {
            console.error('Error fetching email content:', error);
            throw error;
        }
    }

    async sendEmail(to, subject, body, replyToId = null) {
        const message = {
            subject: subject,
            body: {
                contentType: 'HTML',
                content: body
            },
            toRecipients: [{
                emailAddress: {
                    address: to
                }
            }]
        };

        try {
            if (replyToId) {
                await this.graphClient
                    .api(`/me/messages/${replyToId}/reply`)
                    .post({ message });
            } else {
                await this.graphClient
                    .api('/me/sendMail')
                    .post({ message });
            }
            
            return { success: true, message: 'Email sent successfully' };
        } catch (error) {
            console.error('Error sending email:', error);
            throw error;
        }
    }

    async getCalendarEvents(days = 7) {
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + days);

        try {
            const events = await this.graphClient
                .api('/me/events')
                .filter(`start/dateTime ge '${startDate.toISOString()}' and end/dateTime le '${endDate.toISOString()}'`)
                .select('id,subject,start,end,location,attendees,importance,showAs')
                .orderby('start/dateTime')
                .get();
            
            return events.value;
        } catch (error) {
            console.error('Error fetching calendar events:', error);
            throw error;
        }
    }

    async markEmailAsRead(emailId) {
        try {
            await this.graphClient
                .api(`/me/messages/${emailId}`)
                .patch({ isRead: true });
            
            return { success: true, message: 'Email marked as read' };
        } catch (error) {
            console.error('Error marking email as read:', error);
            throw error;
        }
    }
}

module.exports = MicrosoftGraphService;