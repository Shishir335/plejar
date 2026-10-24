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
        const appName = process.env.APP_NAME || 'Plezar';
        const fromAddress = process.env.EMAIL_FROM || 'support@plezar.com';
        this.from = `${appName} <${fromAddress}>`;
    }

    newTransport() {
        if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
            return nodemailer.createTransport({
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
                    host: 'smtp-relay.brevo.com',
                    port: 587,
                    auth: {
                        user: process.env.SENDGRID_USERNAME,
                        pass: process.env.SENDGRID_PASSWORD
                    }
                });
            }
            return nodemailer.createTransport({
                service: 'SendGrid',
                auth: {
                    user: process.env.SENDGRID_USERNAME,
                    pass: process.env.SENDGRID_PASSWORD
                }
            });
        }

        return nodemailer.createTransport({
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
            appName: process.env.APP_NAME || 'Plezar',
            subject,
            ...this.data
        });

        // 2) define the email options
        const mailOptions = {
            from: this.from,
            to: this.to,
            replyTo: process.env.EMAIL_FROM || 'support@plezar.com',
            subject,
            html,
            text: convert(html)
        };

        // 3) create a transport and send email
        await this.newTransport().sendMail(mailOptions);
    }

    async sendWelcome() {
        const appName = process.env.APP_NAME || 'Plezar';
        await this.send('welcome', `Welcome to ${appName}! 🎉`);
    }

    async sendAgentInvite() {
        const appName = process.env.APP_NAME || 'Plezar';
        await this.send('agentInvite', `You're invited to manage ${this.data.agencyName || 'your agency'} on ${appName}`);
    }

    async sendApplicationReceived() {
        await this.send('applicationReceived', `We received your application (${this.data.reference})`);
    }

    async sendApplicationInfoRequested() {
        await this.send('applicationInfoRequested', `More information needed for your application (${this.data.reference})`);
    }

    async sendApplicationRejected() {
        await this.send('applicationRejected', `Your application to ${process.env.APP_NAME || 'Plezar'} (${this.data.reference})`);
    }

    async sendPasswordReset() {
        await this.send('passwordReset', 'Your password reset token (valid for only 10 minutes)');
    }
};