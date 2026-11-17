const nodemailer = require('nodemailer');
const pug = require('pug');
const { convert } = require('html-to-text');

module.exports = class Email {
    constructor(user, url, data = {}) {
        this.to = user.email;
        this.firstName = (user.name || 'User').split(' ')[0];
        this.name = user.name || 'User';
        this.url = url;
        this.data = data;
        const appName = process.env.APP_NAME || 'Plejar';
        const fromAddress = process.env.EMAIL_FROM || 'support@plejar.com';
        this.from = `${appName} <${fromAddress}>`;
    }

    newTransport() {
        // Give up quickly when the mail server can't be reached (some hosts block SMTP),
        // instead of nodemailer's default of minutes
        const limits = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 };
        if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
            return nodemailer.createTransport({
                ...limits,
                service: 'gmail',
                auth: {
                    user: process.env.GMAIL_USER.trim(),
                    pass: process.env.GMAIL_PASS.replace(/\s+/g, '')
                }
            });
        }

        if (process.env.NODE_ENV === 'production') {
            if (process.env.SENDGRID_USERNAME && process.env.SENDGRID_USERNAME.includes('brevo')) {
                return nodemailer.createTransport({
                    ...limits,
                    host: 'smtp-relay.brevo.com',
                    port: 587,
                    auth: {
                        user: process.env.SENDGRID_USERNAME,
                        pass: process.env.SENDGRID_PASSWORD
                    }
                });
            }
            return nodemailer.createTransport({
                ...limits,
                service: 'SendGrid',
                auth: {
                    user: process.env.SENDGRID_USERNAME,
                    pass: process.env.SENDGRID_PASSWORD
                }
            });
        }

        return nodemailer.createTransport({
            ...limits,
            host: process.env.EMAIL_HOST || 'sandbox.smtp.mailtrap.io',
            port: process.env.EMAIL_PORT || 2525,
            auth: {
                user: process.env.EMAIL_USERNAME,
                pass: process.env.EMAIL_PASSWORD
            }
        });
    }

    // send actual email
    async send(template, subject) {
        // 1) render HTML based on a pug template
        const html = pug.renderFile(`${__dirname}/../views/email/${template}.pug`, {
            firstName: this.firstName,
            name: this.name,
            url: this.url,
            appName: process.env.APP_NAME || 'Plejar',
            subject,
            ...this.data
        });

        // 2) define the email options
        const mailOptions = {
            from: this.from,
            to: this.to,
            replyTo: process.env.EMAIL_FROM || 'support@plejar.com',
            subject,
            html,
            text: convert(html)
        };

        // 3) create a transport and send email
        await this.newTransport().sendMail(mailOptions);
    }

    async sendWelcome() {
        const appName = process.env.APP_NAME || 'Plejar';
        await this.send('welcome', `Welcome to ${appName}! 🎉`);
    }

    async sendAgentInvite() {
        const appName = process.env.APP_NAME || 'Plejar';
        await this.send('agentInvite', `You're invited to manage ${this.data.agencyName || 'your agency'} on ${appName}`);
    }

    async sendApplicationReceived() {
        await this.send('applicationReceived', `We received your application (${this.data.reference})`);
    }

    async sendApplicationInfoRequested() {
        await this.send('applicationInfoRequested', `More information needed for your application (${this.data.reference})`);
    }

    async sendApplicationRejected() {
        await this.send('applicationRejected', `Your application to ${process.env.APP_NAME || 'Plejar'} (${this.data.reference})`);
    }

    // Accepted onto an account the person already has: no new password to send
    async sendVendorAccepted() {
        await this.send('vendorAccepted', `${this.data.agencyName} is now a ${process.env.APP_NAME || 'Plejar'} member agency`);
    }

    async sendStayRequest() {
        await this.send('stayRequest', `New stay request for ${this.data.hotelName}`);
    }

    async sendVendorLogin(subject) {
        await this.send('vendorLogin', subject);
    }

    async sendVendorReport(subject) {
        await this.send('vendorReport', subject);
    }

    // 4-digit code for "forgot password" in the app (this.data.code)
    async sendDeleteAccountCode() {
        await this.send('deleteAccountCode', `${this.data.code} is your code to delete your ${process.env.APP_NAME || 'Plejar'} account`);
    }

    async sendPasswordCode() {
        await this.send('passwordCode', `${this.data.code} is your ${process.env.APP_NAME || 'Plejar'} security code`);
    }

    // 4-digit code to confirm the traveler's email address (this.data.code)
    async sendVerifyCode() {
        await this.send('verifyCode', `${this.data.code} is your ${process.env.APP_NAME || 'Plejar'} email code`);
    }

    // A Plejar admin accepted or rejected a vendor's ad (this.data: accepted, adTitle, reason)
    async sendAdDecision() {
        await this.send('adDecision', this.data.accepted ? `Your ad "${this.data.adTitle}" was accepted` : `Your ad "${this.data.adTitle}" needs changes`);
    }

    // Whether any mail account is set up in config.env (otherwise sending fails)
    static isConfigured() {
        if (process.env.GMAIL_USER && process.env.GMAIL_PASS) return true;
        if (process.env.NODE_ENV === 'production') return Boolean(process.env.SENDGRID_USERNAME && process.env.SENDGRID_PASSWORD);
        return Boolean(process.env.EMAIL_USERNAME && process.env.EMAIL_PASSWORD);
    }

    async sendPasswordReset() {
        await this.send('passwordReset', 'Your password reset token (valid for only 10 minutes)');
    }
};