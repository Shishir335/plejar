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
const applicationRouter = require('./routes/applicationRoutes');
const travelerRoutes = require('./routes/travelerRoutes');
const socialRoutes = require('./routes/socialRoutes');
const chatRoutes = require('./routes/chatRoutes');
const appAuthRouter = require('./routes/appAuthRoutes');
const tourRoutes = require('./routes/tourRoutes');
const adminContentRouter = require('./routes/adminContentRoutes');
const adminApplicationRouter = require('./routes/adminApplicationRoutes');
const bookingRouter = require('./routes/bookingRoutes');
const reviewRouter = require('./routes/reviewRoutes');
const complaintRouter = require('./routes/complaintRoutes');
const agencyRouter = require('./routes/agencyRoutes');
const adminAgencyRouter = require('./routes/adminAgencyRoutes');
const adminUserRouter = require('./routes/adminUserRoutes');
const adminVendorRouter = require('./routes/adminVendorRoutes');
const adminDestinationRouter = require('./routes/adminDestinationRoutes');
const adminSystemRouter = require('./routes/adminSystemRoutes');
const adminSocialRouter = require('./routes/adminSocialRoutes');
const adminNotificationRouter = require('./routes/adminNotificationRoutes');

const AppError = require('./utils/appError');
const authController = require('./controllers/authController');
const globalErrorHandler = require('./controllers/errorController');
const swaggerUi = require('swagger-ui-express');
const { getSwaggerSpec } = require('./docs/swagger');

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
app.use('/api/v1/users/acceptInvite', authLimiter);
// Traveler app sign-in: 20 failed tries / 15 minutes per IP on each endpoint (successful ones
// don't count), on top of the per-code limits in appAuthController
['register', 'login', 'google', 'forgot-password', 'verify-code', 'reset-password', 'check', 'referral'].forEach(p => app.use(`/api/v1/auth/${p}`, rateLimit({
    max: 20,
    windowMs: 15 * 60 * 1000,
    skipSuccessfulRequests: true,
    validate: { trustProxy: false },
    message: { status: 'fail', message: 'Too many tries. Please wait 15 minutes and try again.' }
})));

// Checking whether an email is free (30 / 15 minutes, so the list of members can't be harvested)
app.use('/api/v1/users/check-email', rateLimit({
    max: 30,
    windowMs: 15 * 60 * 1000,
    validate: { trustProxy: false },
    message: { status: 'fail', message: 'Too many checks from this IP. Please try again after 15 minutes.' }
}));

// PUBLIC FORM RATE LIMITERS: membership applications (10 accepted / hour per IP to limit spam;
// a form sent back with errors doesn't count), and status checks and replies
// (30 / 15 minutes, failures included, so reference numbers can't be guessed)
const applicationLimiter = rateLimit({
    max: 10,
    windowMs: 60 * 60 * 1000,
    skipFailedRequests: true,
    validate: { trustProxy: false },
    message: { status: 'fail', message: 'Too many applications from this IP. Please try again in an hour.' }
});
const applicationLookupLimiter = rateLimit({
    max: 30,
    windowMs: 15 * 60 * 1000,
    validate: { trustProxy: false },
    message: { status: 'fail', message: 'Too many attempts. Please try again in 15 minutes.' }
});
app.post('/api/v1/applications', applicationLimiter);
app.post(['/api/v1/applications/status', '/api/v1/applications/reply'], applicationLookupLimiter);

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

app.get(['/agent', '/agent/dashboard', '/vendor', '/vendor/dashboard'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'agent.html'));
});

app.get(['/apply', '/apply/status'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'apply.html'));
});

app.get('/accept-invite', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'accept-invite.html'));
});

// SWAGGER UI INTERACTIVE API TESTING DASHBOARD
app.use(
    '/api-docs',
    swaggerUi.serve,
    (req, res, next) => {
        const spec = getSwaggerSpec(req.app);
        swaggerUi.setup(spec, {
            customSiteTitle: 'Plejar API Testing Dashboard',
            customCss: '.swagger-ui .topbar { display: none } .swagger-ui .info { margin: 25px 0 }',
            swaggerOptions: {
                persistAuthorization: true,
                displayRequestDuration: true,
                filter: true,
                tryItOutEnabled: true
            }
        })(req, res, next);
    }
);

app.get('/api-docs.json', (req, res) => {
    res.status(200).json(getSwaggerSpec(req.app));
});

// API ROUTES
app.use('/api/v1/users', userRouter);
app.use('/api/v1/subscribers', subscriberRouter);
app.use('/api/v1/applications', applicationRouter);
app.use('/api/v1/events', travelerRoutes.events);
app.use('/api/v1/announcements', travelerRoutes.announcements);
app.use('/api/v1/notifications', travelerRoutes.notifications);
app.use('/api/v1/destinations', travelerRoutes.destinations);
app.use('/api/v1/destination-categories', travelerRoutes.destinationCategories);
// Traveler side of the mobile app: feed, posts, comments, people, agencies, settings
app.use('/api/v1/auth', appAuthRouter);
app.use('/api/v1/tours', tourRoutes.tours);
app.use('/api/v1/hotels', tourRoutes.hotels);
app.use('/api/v1/promotions', tourRoutes.promotions);
app.use('/api/v1/guides', tourRoutes.guides);
app.use('/api/v1/app', socialRoutes.app);
app.use('/api/v1/feed', socialRoutes.feed);
app.use('/api/v1/posts', socialRoutes.posts);
app.use('/api/v1/comments', socialRoutes.comments);
app.use('/api/v1/people', socialRoutes.people);
app.use('/api/v1/agencies', socialRoutes.agencies);
app.use('/api/v1/me', socialRoutes.me);
app.use('/api/v1/vouchers', socialRoutes.vouchers);
app.use('/api/v1/help', socialRoutes.help);
app.use('/api/v1/pages', socialRoutes.pages);
app.use('/api/v1/agency-application', socialRoutes.agencyApplication);
app.use('/api/v1/bookings', bookingRouter);
app.use('/api/v1/reviews', reviewRouter);
app.use('/api/v1/complaints', complaintRouter);
app.use('/api/v1/chats', chatRoutes.traveler);
app.use('/api/v1/agency/me/chats', chatRoutes.agency);
app.use('/api/v1/agency', agencyRouter);
// Everything under /api/v1/admin is for administrators, managers and developers
app.use('/api/v1/admin/support-chats', chatRoutes.support);
app.use('/api/v1/admin', authController.protect, authController.restrictTo('admin', 'manager', 'dev'));
app.use('/api/v1/admin', adminUserRouter);
app.use('/api/v1/admin', adminVendorRouter);
app.use('/api/v1/admin', adminApplicationRouter);
app.use('/api/v1/admin', adminDestinationRouter);
app.use('/api/v1/admin', adminSystemRouter);
app.use('/api/v1/admin', adminSocialRouter);
app.use('/api/v1/admin', adminContentRouter);
app.use('/api/v1/admin', adminAgencyRouter);
app.use('/api/v1/admin/notifications', adminNotificationRouter);

// 404 UNHANDLED ROUTE CATCHER
app.all('*', (req, res, next) => {
    next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// GLOBAL ERROR HANDLER
app.use(globalErrorHandler);

module.exports = app;