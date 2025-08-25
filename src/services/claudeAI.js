const axios = require('axios');

class ClaudeAIService {
    constructor() {
        this.apiKey = process.env.ANTHROPIC_API_KEY;
        this.baseURL = 'https://api.anthropic.com/v1/messages';
        this.userTimezone = 'America/New_York'; // Make this configurable later
    }

    getCurrentTimeContext() {
        const now = new Date();
        const estTime = now.toLocaleString('en-US', {
            timeZone: this.userTimezone,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZoneName: 'short'
        });
        
        return `Current time: ${estTime}`;
    }
    // Helper method to format signature
    formatSignature(signature) {
        if (!signature || !signature.enabled) {
            return '';
        }

        let signatureText = '\n\nThank you,\n';
        
        if (signature.name) {
            signatureText += `${signature.name}\n`;
        }
        
        if (signature.title) {
            signatureText += `${signature.title}\n`;
        }
        
        if (signature.company) {
            signatureText += `${signature.company}\n`;
        }
        
        // Add contact information
        const contactInfo = [];
        if (signature.phone) contactInfo.push(`Phone: ${signature.phone}`);
        if (signature.email) contactInfo.push(`Email: ${signature.email}`);
        if (signature.website) contactInfo.push(`Website: ${signature.website}`);
        
        if (contactInfo.length > 0) {
            signatureText += contactInfo.join(' | ') + '\n';
        }
        
        if (signature.additional) {
            signatureText += `${signature.additional}\n`;
        }
        
        return signatureText;
    }

    async processEmailQuery(query, emailData, calendarData = null) {
        const prompt = this.buildEmailQueryPrompt(query, emailData, calendarData);
        
        try {
            const response = await axios.post(this.baseURL, {
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1500,
                messages: [
                    { role: 'user', content: prompt }
                ]
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                }
            });

            return response.data.content[0].text;
        } catch (error) {
            console.error('Error calling Claude API:', error.response?.data || error.message);
            throw new Error('AI processing failed');
        }
    }

    buildEmailQueryPrompt(query, emailData, calendarData) {
        let prompt = `You are an AI assistant helping to manage Microsoft 365 emails and calendar. 

${this.getCurrentTimeContext()}

User Query: ${query}

Recent Email Data:
${this.formatEmailsForPrompt(emailData)}`;

        if (calendarData && calendarData.length > 0) {
            prompt += `\n\nUpcoming Calendar Events (times in Eastern Time):
${this.formatCalendarForPrompt(calendarData)}`;
        }

        prompt += `\n\nProvide a helpful response to the user's query. When mentioning times, always specify they are in Eastern Time (EST/EDT). Be specific and actionable.`;

        return prompt;
    }

    formatEmailsForPrompt(emails) {
        if (!emails || emails.length === 0) {
            return "No recent emails found.";
        }

        return emails.slice(0, 20).map((email, index) => {
            const from = email.from?.emailAddress?.address || 'Unknown sender';
            const name = email.from?.emailAddress?.name || '';
            
            // Format date in Eastern Time
            const date = new Date(email.receivedDateTime).toLocaleDateString('en-US', {
                timeZone: this.userTimezone
            });
            const time = new Date(email.receivedDateTime).toLocaleTimeString('en-US', {
                timeZone: this.userTimezone,
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            
            const preview = email.bodyPreview?.substring(0, 100) || 'No preview';
            
            return `${index + 1}. From: ${name} <${from}>
   Subject: ${email.subject}
   Date: ${date} ${time} EST
   Read: ${email.isRead ? 'Yes' : 'No'}
   Preview: ${preview}...`;
        }).join('\n\n');
    }

    formatCalendarForPrompt(events) {
        if (!events || events.length === 0) {
            return "No upcoming events found.";
        }

        return events.slice(0, 10).map((event, index) => {
            // Format times in Eastern Time
            const start = new Date(event.start.dateTime).toLocaleString('en-US', {
                timeZone: this.userTimezone,
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            const end = new Date(event.end.dateTime).toLocaleString('en-US', {
                timeZone: this.userTimezone,
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            
            const location = event.location?.displayName || 'No location';
            
            return `${index + 1}. ${event.subject}
   Start: ${start} EST
   End: ${end} EST
   Location: ${location}`;
        }).join('\n\n');
    }

    async generateEmailResponse(originalEmail, context = '', tone = 'professional', userSignature = null) {
    const timeContext = this.getCurrentTimeContext();
    
    // Format signature if provided
    const signature = userSignature ? this.formatSignature(userSignature) : '';
    
    console.log('🖊️ Signature to include:', signature ? 'YES' : 'NO');
    if (signature) {
        console.log('Signature content:', signature);
    }
    
    const prompt = `${timeContext}

Generate a ${tone} email response to the following email:

Original Email:
From: ${originalEmail.from?.emailAddress?.name} <${originalEmail.from?.emailAddress?.address}>
Subject: ${originalEmail.subject}
Content: ${originalEmail.body?.content || originalEmail.bodyPreview}

Additional Context: ${context}

Generate an appropriate response that:
- Addresses the main points of the original email
- Maintains a ${tone} tone
- Is concise but complete
- Includes a proper greeting
- If scheduling is mentioned, reference Eastern Time
- ${signature ? 'Must end with the provided signature exactly as shown' : 'Includes an appropriate closing with just the first name'}

${signature ? `IMPORTANT: You must include this exact signature at the end:
${signature}` : ''}

Return only the email content without subject line.`;

    try {
        const response = await axios.post(this.baseURL, {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            messages: [
                { role: 'user', content: prompt }
            ]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
            }
        });

        let generatedResponse = response.data.content[0].text;
        
        // If signature wasn't properly included by Claude, append it manually
        if (signature && !generatedResponse.includes(signature.trim().split('\n')[1])) {
            console.log('🔧 Manually appending signature');
            generatedResponse += signature;
        }

        return generatedResponse;
    } catch (error) {
        console.error('Error generating email response:', error.response?.data || error.message);
        throw new Error('Failed to generate email response');
    }
}
}

module.exports = ClaudeAIService;
