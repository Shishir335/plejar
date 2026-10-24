// Shim for xss-clean, which still references the removed buffer.SlowBuffer on newer Node versions
const buffer = require('buffer');

/* eslint-disable node/no-deprecated-api */
if (!buffer.SlowBuffer) {
    buffer.SlowBuffer = buffer.Buffer;
}
/* eslint-enable node/no-deprecated-api */

const path = require('path');
const express = require('express');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const userRouter = require('./routes/userRoutes');
const subscriberRouter = require('./routes/subscriberRoutes');
const agentLeadRouter = require('./routes/agentLeadRoutes');

const AppError = require('./utils/appError');
const globalErrorHandler = require('./controllers/errorController');

const app = express();

// Trust reverse proxy for secure cookies and accurate client IP
app.enable('trust proxy');

// 1) GLOBAL MIDDLEWARES

// ENABLE CORS WITH CREDENTIALS (only for origins listed in CORS_ORIGINS; same-origin requests need no CORS)
const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

const corsOptions = {
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: true
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// SET SECURITY HTTP HEADERS (Configured to support Google Identity Services OAuth & GSI popups)
app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
        crossOriginResourcePolicy: false,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    })
);

if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

// GENERAL API RATE LIMITER (1000 requests / hour)
const limiter = rateLimit({
    max: 1000,
    windowMs: 60 * 60 * 1000,
    validate: { trustProxy: false },
    message: { status: 'fail', message: 'Too many requests from this IP. Please try again in an hour!' }
});
app.use('/api', limiter);

// STRICT AUTH RATE LIMITER (15 attempts / 15 minutes to prevent brute-force attacks)
const authLimiter = rateLimit({
    max: 15,
    windowMs: 15 * 60 * 1000,
    validate: { trustProxy: false },
    message: { status: 'fail', message: 'Too many authentication attempts from this IP. Please try again after 15 minutes.' }
});
app.use('/api/v1/users/login', authLimiter);
app.use('/api/v1/users/signup', authLimiter);
app.use('/api/v1/users/google-login', authLimiter);
app.use('/api/v1/users/forgotPassword', authLimiter);
app.use('/api/v1/users/resetPassword', authLimiter);

// PUBLIC FORM RATE LIMITER (10 agent enquiries / hour per IP to limit spam)
const leadLimiter = rateLimit({
    max: 10,
    windowMs: 60 * 60 * 1000,
    validate: { trustProxy: false },
    message: { status: 'fail', message: 'Too many submissions from this IP. Please try again in an hour.' }
});
app.post('/api/v1/agent-leads', leadLimiter);

// BODY PARSER, READING DATA FROM req.body
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// DATA SANITIZATION AGAINST NoSQL QUERY INJECTION
app.use(mongoSanitize());

// DATA SANITIZATION AGAINST XSS
app.use(xss());

// PREVENT PARAMETER POLLUTION
app.use(hpp());

// CLEAN URL REDIRECT (e.g. /index.html -> /)
app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && req.path.endsWith('.html')) {
        let cleanPath = req.path.replace(/\.html$/, '');
        if (cleanPath === '/index') cleanPath = '/';
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return res.redirect(301, cleanPath + query);
    }
    next();
});

// SERVING STATIC FILES
app.use(express.static(path.join(__dirname, 'public')));

app.use(compression());

// REQUEST TIMESTAMP MIDDLEWARE
app.use((req, res, next) => {
    req.requestTime = new Date().toISOString();
    next();
});

// HEALTH CHECK API
app.get('/api/v1/health', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'API is healthy and operational',
        timestamp: req.requestTime,
        environment: process.env.NODE_ENV || 'development'
    });
});

// UI FRONTEND ROUTES
app.get(['/', '/home'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get(['/admin', '/admin/dashboard'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

// API ROUTES
app.use('/api/v1/users', userRouter);
app.use('/api/v1/subscribers', subscriberRouter);
app.use('/api/v1/agent-leads', agentLeadRouter);

// 404 UNHANDLED ROUTE CATCHER
app.all('*', (req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// GLOBAL ERROR HANDLER
app.use(globalErrorHandler);

module.exports = app;