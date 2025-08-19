require('isomorphic-fetch');
const { ConfidentialClientApplication } = require('@azure/msal-node');

const msalConfig = {
    auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        authority: 'https://login.microsoftonline.com/common' // Changed from specific tenant
    },
    system: {
        loggerOptions: {
            loggerCallback(loglevel, message, containsPii) {
                if (!containsPii) {
                    console.log(`[MSAL] ${message}`);
                }
            },
            piiLoggingEnabled: false,
            logLevel: 'Info',
        }
    }
};

const pca = new ConfidentialClientApplication(msalConfig);

const scopes = [
    'https://graph.microsoft.com/Mail.ReadWrite',
    'https://graph.microsoft.com/Mail.Send',
    'https://graph.microsoft.com/Calendars.ReadWrite',
    'https://graph.microsoft.com/User.Read'
];

module.exports = { pca, scopes };
