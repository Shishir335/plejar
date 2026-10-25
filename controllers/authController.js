const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/userModel');
const Agency = require('../models/agencyModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Email = require('../utils/email');
const { recordLogin } = require('../utils/activity');
const { agencyBlockedReason } = require('../utils/agencyStanding');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Emails listed in ADMIN_EMAILS (comma-separated, exact match) are always treated as admins
const getAdminEmails = () =>
    (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map(email => email.trim().toLowerCase())
        .filter(Boolean);

const isAdminEmail = email => Boolean(email) && getAdminEmails().includes(email.toLowerCase());

// Explain why an account can't be used right now, or return null when it can.
// Suspensions with an end date lift themselves once that date has passed.
const blockedReason = async user => {
    if (user.deletedAt) return 'This account has been removed. Contact Plezar support if this is a mistake.';
    if (user.status === 'suspended' || user.status === 'deactivated') {
        if (user.status === 'suspended' && user.statusUntil && user.statusUntil <= new Date()) {
            user.status = 'active';
            user.statusReason = '';
            user.statusUntil = undefined;
            await user.save({ validateBeforeSave: false });
            return null;
        }
        const until = user.statusUntil ? ` until ${user.statusUntil.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
        const why = user.statusReason ? ` Reason: ${user.statusReason.replace(/[.\s]+$/, '')}.` : '';
        return user.status === 'suspended'
            ? `Your account is suspended${until}.${why} Contact Plezar support.`
            : `Your account is deactivated.${why} Contact Plezar support to reactivate it.`;
    }
    return null;
};
exports.blockedReason = blockedReason;

// Store the admin role for ADMIN_EMAILS accounts, so the admin console (which reads the role) lets them in
const promoteAdminEmail = async user => {
    if (user && isAdminEmail(user.email) && user.role !== 'admin' && user.role !== 'agent') {
        user.role = 'admin';
        await user.save({ validateBeforeSave: false });
    }
};


const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
});

const createAndSendToken = (user, statusCode, req, res) => {
    let actualReq = req;
    let actualRes = res;
    if (!res && req && typeof req.status === 'function') {
        actualRes = req;
        actualReq = null;
    }

    const token = signToken(user._id);

    const isSecure = process.env.NODE_ENV === 'production' || 
        Boolean(actualReq && (actualReq.secure || actualReq.headers['x-forwarded-proto'] === 'https'));

    const cookieOptions = {
        expires: new Date(Date.now() +
            process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000),
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecure
    };

    actualRes.cookie('jwt', token, cookieOptions);

    // removing the password from response
    user.password = undefined;

    res.status(statusCode).json({
        status: 'success',
        token: token,
        data: user
    });
}

exports.signup = catchAsync(async (req, res, next) => {
    const newUser = await User.create({
        name: req.body.name,
        email: req.body.email,
        password: req.body.password,
        confirmPassword: req.body.confirmPassword,
        phone: req.body.phone || '',
        address: req.body.address || '',
        role: 'user'
    });

    try {
        const url = `${req.protocol}://${req.get('host')}/`;
        await new Email(newUser, url).sendWelcome();
    } catch (mailErr) {
        console.warn('[MAIL WARNING] Welcome email deferred:', mailErr.message);
    }

    createAndSendToken(newUser, 201, req, res);
});

exports.login = catchAsync(async (req, res, next) => {
    const { email, password } = req.body;

    // 1) check if email and password exists
    if (!email || !password) {
        return next(new AppError('Please provide email and password', 400));
    }

    // 2) check if user exists in database and select password field
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    // 3) verify password with user record (invited accounts have no password yet)
    if (!user || !user.password || !(await user.correctPassword(password, user.password))) {
        if (user && user.accountStatus === 'invited') {
            await recordLogin(req, { user, email, success: false, reason: 'invite_not_accepted' });
            return next(new AppError('Your invite has not been accepted yet. Use the link in your invite email to set a password.', 401));
        }
        await recordLogin(req, { user, email, success: false, reason: user ? 'wrong_password' : 'unknown_email' });
        return next(new AppError('Incorrect email or password.', 401));
    }

    // 4) suspended, deactivated or removed accounts cannot sign in
    const blocked = await blockedReason(user);
    if (blocked) {
        await recordLogin(req, { user, email, success: false, reason: `blocked_${user.deletedAt ? 'deleted' : user.status}` });
        return next(new AppError(blocked, 403));
    }

    // 5) agents of a suspended agency cannot sign in
    if (user.role === 'agent') {
        const agency = await Agency.findById(user.agency);
        const agencyBlocked = await agencyBlockedReason(agency);
        if (agencyBlocked) {
            await recordLogin(req, { user, email, success: false, reason: 'agency_not_active' });
            return next(new AppError(agencyBlocked, 403));
        }
    }

    // 6) send token to client
    await promoteAdminEmail(user);
    user.lastLoginAt = new Date();
    user.loginCount = (user.loginCount || 0) + 1;
    await user.save({ validateBeforeSave: false });
    await recordLogin(req, { user, email, success: true });
    createAndSendToken(user, 200, req, res);
});

exports.googleLogin = catchAsync(async (req, res, next) => {
    const { credential } = req.body;
    if (!credential) {
        return next(new AppError('Google credential token is missing.', 400));
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return next(new AppError('Google login is not configured on this server.', 500));
    }

    let payload;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: clientId
        });
        payload = ticket.getPayload();
    } catch (err) {
        console.error('[GOOGLE TOKEN VERIFICATION FAILED]:', err.message);
        return next(new AppError(`Invalid or expired Google credential: ${err.message}`, 401));
    }

    const { sub: googleId, email, name, picture } = payload;

    if (!email) {
        return next(new AppError('Google profile did not provide an email address.', 400));
    }

    let user = await User.findOne({
        $or: [
            { googleId },
            { email: email.toLowerCase() }
        ]
    });

    if (user) {
        if (!user.googleId) {
            user.googleId = googleId;
            user.authProvider = 'google';
            if (picture && (!user.photo || user.photo === 'profile.png')) {
                user.photo = picture;
            }
            if (isAdminEmail(email)) {
                user.role = 'admin';
            }
            await user.save({ validateBeforeSave: false });
        } else if (isAdminEmail(email) && user.role !== 'admin') {
            user.role = 'admin';
            await user.save({ validateBeforeSave: false });
        }
    } else {
        user = await User.create({
            name: name || 'Google Collector',
            email: email.toLowerCase(),
            googleId,
            authProvider: 'google',
            photo: picture || 'profile.png',
            role: isAdminEmail(email) ? 'admin' : 'user'
        });
    }

    const blocked = await blockedReason(user);
    if (blocked) {
        await recordLogin(req, { user, email, success: false, reason: `blocked_${user.deletedAt ? 'deleted' : user.status}`, method: 'google' });
        return next(new AppError(blocked, 403));
    }

    user.lastLoginAt = new Date();
    user.loginCount = (user.loginCount || 0) + 1;
    await user.save({ validateBeforeSave: false });
    await recordLogin(req, { user, email, success: true, method: 'google' });
    createAndSendToken(user, 200, req, res);
});

exports.protect = catchAsync(async (req, res, next) => {
    // 1) Getting token and check if it's there
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.jwt) {
        token = req.cookies.jwt;
    }

    if (!token) {
        return next(new AppError('You are not logged in. Please log in to access this resource.', 401));
    }

    // 2) Verify token
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

    // 3) Check if user still exists in database
    const currentUser = await User.findById(decoded.id);

    if (!currentUser) {
        return next(new AppError('The user belonging to this token no longer exists.', 401));
    }

    // 4) Check if user changed password after token was issued

    if (currentUser.changedPasswordAfter && currentUser.changedPasswordAfter(decoded.iat)) {
        return next(new AppError('Password changed recently. Please login again.', 401));
    }

    const blocked = await blockedReason(currentUser);
    if (blocked) {
        return next(new AppError(blocked, 403));
    }

    await promoteAdminEmail(currentUser);

    // Grant access to protected route
    req.user = currentUser;
    res.locals.user = currentUser;

    next();
});

exports.restrictTo = (...roles) => Object.assign((req, res, next) => {
    if (req.user && isAdminEmail(req.user.email)) {
        req.user.role = 'admin';
        return next();
    }

    if (!req.user || !roles.includes(req.user.role)) {
        return next(
            new AppError('You do not have administrative permission to perform this action.', 403));
    }

    next();
}, { roles }); // roles: read by the endpoint list in the admin panel

exports.logout = (req, res) => {
    const isSecure = process.env.NODE_ENV === 'production' || 
        Boolean(req && (req.secure || req.headers['x-forwarded-proto'] === 'https'));
    res.cookie('jwt', 'loggedout', {
        expires: new Date(Date.now() + 5 * 1000),
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecure
    });
    res.status(200).json({ status: 'success', message: 'Logged out successfully' });
};

exports.getMe = (req, res) => {
    res.status(200).json({
        status: 'success',
        data: {
            user: req.user
        }
    });
};


exports.forgotPassword = catchAsync(async (req, res, next) => {
    // 1) Get user based on posted email
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
        return next(new AppError('There is no user with this email address', 404));
    }

    // 2) Generate the random reset token
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });


    // 3) send it to user's email
    const resetURL = `${req.protocol}://${req.get('host')}/reset-password?token=${resetToken}`;

    try {
        if (process.env.NODE_ENV === 'development') {
            console.log('\n======================================================');
            console.log(`🔑 PASSWORD RESET LINK for ${user.email}:`);
            console.log(resetURL);
            console.log('======================================================\n');
        }

        await new Email(user, resetURL).sendPasswordReset();

        res.status(200).json({
            status: 'success',
            message: 'Password reset link sent to your email address.',
            emailSent: true,
            resetURL: process.env.NODE_ENV === 'development' ? resetURL : undefined
        });
    } catch (err) {
        console.warn('Password reset email sending failed:', err.message);

        // Only expose the link in development; in production that would let anyone reset any account
        if (process.env.NODE_ENV === 'development') {
            return res.status(200).json({
                status: 'success',
                message: 'Password reset link was generated.',
                emailSent: false,
                resetURL: resetURL
            });
        }

        user.passwordResetToken = undefined;
        user.passwordResetExpire = undefined;
        await user.save({ validateBeforeSave: false });

        return next(new AppError('There was an error sending the email. Please try again later.', 500));
    }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
    // 1) Get user of the token
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.
        findOne({
            passwordResetToken: hashedToken,
            passwordResetExpire: { $gt: Date.now() }
        });

    // 2) if token has not expired, and there is user, set the new password
    if (!user) {
        return next(new AppError('Token is invalid or expired', 400));
    }

    user.password = req.body.password;
    user.confirmPassword = req.body.confirmPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpire = undefined;
    // Setting a password through a reset link also completes a pending invite
    user.accountStatus = 'active';
    user.inviteToken = undefined;
    user.inviteExpires = undefined;

    await user.save();

    // 3) Update changedPasswordAt property for the user

    // 4) Log the user in, send JWT
    createAndSendToken(user, 200, req, res);
});

// Find a pending invite by its raw token
const findInvitedUser = token => {
    const hashedToken = crypto.createHash('sha256').update(String(token || '')).digest('hex');
    return User.findOne({
        inviteToken: hashedToken,
        inviteExpires: { $gt: Date.now() },
        accountStatus: 'invited'
    }).populate('agency', 'name status');
};

// Show who an invite is for, so the set-password page can greet them
exports.checkInvite = catchAsync(async (req, res, next) => {
    const user = await findInvitedUser(req.params.token);
    if (!user) {
        return next(new AppError('This invite link is invalid or has expired. Ask for a new invite.', 400));
    }

    res.status(200).json({
        status: 'success',
        data: {
            name: user.name,
            email: user.email,
            agencyName: user.agency ? user.agency.name : '',
            agencyRole: user.agencyRole
        }
    });
});

// Set a password for an invited account and sign in
exports.acceptInvite = catchAsync(async (req, res, next) => {
    const user = await findInvitedUser(req.params.token);
    if (!user) {
        return next(new AppError('This invite link is invalid or has expired. Ask for a new invite.', 400));
    }
    const inviteBlocked = user.agency ? await agencyBlockedReason(await Agency.findById(user.agency._id)) : null;
    if (inviteBlocked) {
        return next(new AppError(inviteBlocked, 403));
    }

    user.password = req.body.password;
    user.confirmPassword = req.body.confirmPassword;
    user.accountStatus = 'active';
    user.inviteToken = undefined;
    user.inviteExpires = undefined;
    await user.save();

    createAndSendToken(user, 200, req, res);
});

exports.changePassword = catchAsync(async (req, res, next) => {
    // 1) Get user form collection
    const user = await User.findById(req.user.id).select('+password');

    // 2) Check if the posted current password is correct
    if (!user.password || !(await user.correctPassword(req.body.currentPassword || '', user.password))) {
        return next(new AppError('Your current password is wrong', 401));
    }

    // 3) If so, update password
    user.password = req.body.password;
    user.confirmPassword = req.body.confirmPassword;

    await user.save();

    // 4) Log user in, send jwt
    createAndSendToken(user, 200, req, res);

});

// Labels for the endpoint list in the admin panel (utils/routeCatalog.js)
exports.protect.access = 'signed-in';
