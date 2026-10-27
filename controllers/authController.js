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
const { hasRole, addRole, rolesOf } = require('../utils/roles');

const googleClient = new OAuth2Client();

const getGoogleAudiences = () => {
    const sources = [
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_SERVER_CLIENT_ID,
        process.env.GOOGLE_IOS_CLIENT_ID,
        process.env.GOOGLE_ANDROID_CLIENT_ID,
        // Known client IDs for Plezar (Web, Android & iOS from Google/Firebase console)
        '783619291102-9ujg3f0v6hr5b7l357i6j8n5g8vh78qi.apps.googleusercontent.com',
        '756555119906-8737egoq23k7pfmcsqa7fuiodd43crcl.apps.googleusercontent.com',
        '756555119906-q67kbkuacjahi41jl8btrs6en7q7ps4o.apps.googleusercontent.com',
        '756555119906-7cmmq7mgvjqtj0i7300nmmjvhfo5is0p.apps.googleusercontent.com'
    ].filter(Boolean);

    const ids = new Set();
    sources.forEach(src => {
        String(src).split(',').forEach(item => {
            const trimmed = item.trim();
            if (trimmed) ids.add(trimmed);
        });
    });
    return Array.from(ids);
};

// Public configuration endpoint so frontend apps know the Google Web Client ID
exports.getGoogleClientId = (req, res) => {
    const raw = (process.env.GOOGLE_CLIENT_ID || '').split(',')[0].trim();
    res.status(200).json({
        status: 'success',
        data: {
            clientId: raw || '783619291102-9ujg3f0v6hr5b7l357i6j8n5g8vh78qi.apps.googleusercontent.com'
        }
    });
};

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
exports.isAdminEmail = isAdminEmail;

// Give ADMIN_EMAILS accounts the admin role (on top of any others), so the admin console lets them in
const promoteAdminEmail = async user => {
    if (user && isAdminEmail(user.email) && !hasRole(user, 'admin')) {
        addRole(user, 'admin');
        await user.save({ validateBeforeSave: false });
    }
};


const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
});

exports.signToken = signToken;

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

    // 5) someone who is only part of a suspended agency cannot sign in (other roles still can)
    if (hasRole(user, 'agent') && rolesOf(user).length === 1) {
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
    const credential = String(req.body.credential || req.body.idToken || '');
    if (!credential) {
        return next(new AppError('Google credential token is missing.', 400));
    }

    const audiences = getGoogleAudiences();
    if (!audiences.length) {
        return next(new AppError('Google sign-in is not configured on this server yet. Set GOOGLE_CLIENT_ID in server configuration.', 503));
    }

    let payload;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: audiences
        });
        payload = ticket.getPayload();
    } catch (err) {
        console.error('[GOOGLE TOKEN VERIFICATION FAILED]:', err.message);
        return next(new AppError(`Invalid or expired Google credential: ${err.message}`, 401));
    }

    const {
        sub: googleId,
        email,
        name,
        picture,
        given_name: givenName,
        family_name: familyName,
        email_verified: emailVerified
    } = payload;

    if (!email || emailVerified === false) {
        return next(new AppError('Your Google account has no confirmed email address.', 400));
    }

    const normalizedEmail = email.toLowerCase().trim();

    let user = await User.findOne({
        $or: [
            { googleId },
            { email: normalizedEmail }
        ]
    });

    let created = false;
    if (user) {
        if (!user.googleId) {
            user.googleId = googleId;
            user.authProvider = 'google';
        }
        if (picture && (!user.photo || user.photo === 'profile.png')) {
            user.photo = picture;
        }
        if (!user.firstName && givenName) {
            user.firstName = String(givenName).slice(0, 30);
        }
        if (!user.lastName && familyName) {
            user.lastName = String(familyName).slice(0, 30);
        }
        if (!user.emailVerifiedAt && emailVerified) {
            user.emailVerifiedAt = new Date();
        }
        if (isAdminEmail(normalizedEmail) && !hasRole(user, 'admin')) {
            addRole(user, 'admin');
        }
        await user.save({ validateBeforeSave: false });
    } else {
        created = true;
        user = await User.create({
            name: name || 'Google Traveler',
            firstName: (givenName || '').slice(0, 30),
            lastName: (familyName || '').slice(0, 30),
            email: normalizedEmail,
            googleId,
            authProvider: 'google',
            photo: picture || 'profile.png',
            emailVerifiedAt: emailVerified ? new Date() : undefined,
            roles: isAdminEmail(normalizedEmail) ? ['user', 'admin'] : ['user']
        });
    }

    const blocked = await blockedReason(user);
    if (blocked) {
        await recordLogin(req, {
            user,
            email: normalizedEmail,
            success: false,
            reason: `blocked_${user.deletedAt ? 'deleted' : user.status}`,
            method: 'google'
        });
        return next(new AppError(blocked, 403));
    }

    user.lastLoginAt = new Date();
    user.loginCount = (user.loginCount || 0) + 1;
    await user.save({ validateBeforeSave: false });
    await recordLogin(req, {
        user,
        email: normalizedEmail,
        success: true,
        method: 'google',
        reason: created ? 'signup' : ''
    });

    createAndSendToken(user, created ? 201 : 200, req, res);
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

// Like protect, but lets visitors through: req.user is set only when a valid sign-in is present.
// Used by app screens anyone can browse (e.g. the agencies list) that show more when signed in.
exports.optionalAuth = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) token = req.headers.authorization.split(' ')[1];
        else if (req.cookies && req.cookies.jwt && req.cookies.jwt !== 'loggedout') token = req.cookies.jwt;
        if (!token) return next();
        const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user || (user.changedPasswordAfter && user.changedPasswordAfter(decoded.iat)) || (await blockedReason(user))) return next();
        req.user = user;
    } catch (err) {
        // A bad or expired token just means "not signed in" here
    }
    next();
};

// Lets the request through when the signed-in account has any of these roles
exports.restrictTo = (...roles) => Object.assign((req, res, next) => {
    if (req.user && isAdminEmail(req.user.email)) {
        if (!hasRole(req.user, 'admin')) addRole(req.user, 'admin');
        return next();
    }

    if (!req.user || !hasRole(req.user, ...roles)) {
        return next(
            new AppError('You do not have administrative permission to perform this action.', 403));
    }

    next();
}, { roles }); // roles: read by the endpoint list in the admin panel

exports.logout = async (req, res) => {
    try {
        const fcmToken = req.body?.fcmToken || req.body?.token || req.query?.fcmToken;
        if (fcmToken) {
            const { removeUserToken } = require('../utils/pushNotification');
            if (req.user && req.user._id) {
                await removeUserToken(req.user._id, fcmToken);
            } else {
                await User.updateMany(
                    { 'fcmTokens.token': String(fcmToken).trim() },
                    { $pull: { fcmTokens: { token: String(fcmToken).trim() } } }
                );
            }
        }
    } catch (_) {
        // Non-blocking cleanup
    }

    const isSecure = process.env.NODE_ENV === 'production' || 
        Boolean(req && (req.secure || req.headers['x-forwarded-proto'] === 'https'));
    res.cookie('jwt', 'loggedout', {
        expires: new Date(Date.now() + 1000),
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecure,
        path: '/'
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
