// Update your src/services/microsoftGraph.js file:

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
                .api('/me/mailFolders/inbox/messages')
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
                .select('id,subject,from,toRecipients,receivedDateTime,body,attachments,replyTo,conversationId')
                .get();
            
            return email;
        } catch (error) {
            console.error('Error fetching email content:', error);
            throw error;
        }
    }

    // UPDATED: Fixed sendEmail method to properly handle replies
    async sendEmail(to, subject, body, replyToEmailId = null) {
        try {
            if (replyToEmailId) {
                // THIS IS THE KEY: Use the reply API to maintain threading
                console.log(`📧 Replying to email thread: ${replyToEmailId}`);
                
                const replyMessage = {
                    message: {
                        body: {
                            contentType: 'HTML',
                            content: body
                        }
                    },
                    comment: "" // Optional comment for the reply
                };

                const result = await this.graphClient
                    .api(`/me/messages/${replyToEmailId}/reply`)
                    .post(replyMessage);
                
                console.log('✅ Reply sent successfully in thread');
                return { 
                    success: true, 
                    message: 'Reply sent in thread successfully',
                    id: result.id,
                    type: 'reply'
                };
            } else {
                // Send a new email (not a reply)
                console.log('📧 Sending new email (not a reply)');
                
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

                const result = await this.graphClient
                    .api('/me/sendMail')
                    .post({ message });
                
                console.log('✅ New email sent successfully');
                return { 
                    success: true, 
                    message: 'New email sent successfully',
                    id: result.id,
                    type: 'new'
                };
            }
            
        } catch (error) {
            console.error('Error sending email:', error);
            console.error('Error details:', error.response?.data || error.message);
            throw error;
        }
    }
        
                async replyToEmail(emailId, body, replyToAll = false) {
            try {
                console.log(`📧 ${replyToAll ? 'Replying to all' : 'Replying'} to email: ${emailId}`);
                
                // SOLUTION: Microsoft Graph API should handle threading automatically
                // The key is to use ONLY the "comment" parameter for proper threading
                // According to Microsoft docs and Stack Overflow, this maintains the thread
                
                const replyMessage = {
                    comment: body  // HTML content is supported in comment parameter
                    // Do NOT use message.body.content - this breaks threading
                    // Comment automatically includes original email content below
                };
        
                const endpoint = replyToAll ? 'replyAll' : 'reply';
                
                console.log(`🔄 Sending ${endpoint} using comment parameter for proper threading...`);
                console.log(`📝 Reply content (first 50 chars): ${body.substring(0, 50)}...`);
                console.log(`🧵 Microsoft Graph should automatically:`);
                console.log(`   • Add our reply at the top`);
                console.log(`   • Include original email content below`);
                console.log(`   • Maintain proper conversationId threading`);
                console.log(`   • Set correct subject with "Re:" prefix`);
                console.log(`   • Preserve all recipients for threading`);
                
                const result = await this.graphClient
                    .api(`/me/messages/${emailId}/${endpoint}`)
                    .post(replyMessage);
                
                console.log(`✅ ${replyToAll ? 'Reply all' : 'Reply'} sent with automatic threading!`);
                console.log(`📧 Outlook should now display:`);
                console.log(`   • Your AI response at the top of the email`);
                console.log(`   • Original email content below (threaded)`);
                console.log(`   • Proper conversation grouping in Outlook`);
                console.log(`   • Future replies will maintain the thread`);
                
                return { 
                    success: true, 
                    message: `${replyToAll ? 'Reply all' : 'Reply'} sent with Outlook threading`,
                    id: result?.id || 'sent-successfully',
                    type: replyToAll ? 'reply-all' : 'reply',
                    threading: 'outlook-native-threading',
                    method: 'comment-parameter'
                };
                
            } catch (error) {
                console.error('❌ Error replying with Outlook threading:', error);
                
                // Enhanced error logging for debugging the threading issue
                if (error.response?.data) {
                    console.error('❌ Microsoft Graph Error:', JSON.stringify(error.response.data, null, 2));
                }
                
                console.error('❌ Full error details:', {
                    message: error.message,
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    url: error.config?.url,
                    method: error.config?.method
                });
                
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
