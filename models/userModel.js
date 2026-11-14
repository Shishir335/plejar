const crypto = require('crypto');
const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const { mainRole } = require('../utils/roles');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please tell ur your name']
    },
    // Travelers register with first and last name; name is kept as "first last" for the rest of the system
    firstName: { type: String, trim: true, maxlength: [30, 'First name is too long'], default: '' },
    lastName: { type: String, trim: true, maxlength: [30, 'Last name is too long'], default: '' },
    dateOfBirth: Date,
    // Travelers who sign up with a mobile number have no email (unique among those who do, see the index below)
    email: {
        type: String,
        required: [function () { return !this.phone; }, 'Please provide your email'],
        lowercase: true,
        trim: true,
        validate: { validator: v => !v || validator.isEmail(v), message: 'Please provide a valid email' }
    },
    photo: {
        type: String,
        default: 'profile.png'
    },
    // The main role (the most powerful one in `roles`), kept for labels and older code
    role: {
        type: String,
        enum: ['user', 'manager', 'admin', 'dev', 'agent'],
        default: 'user'
    },
    // Everything this person is on Plejar: traveler, vendor (agent), staff. See utils/roles.js
    roles: [{ type: String, enum: ['user', 'manager', 'admin', 'dev', 'agent'] }],

    // Tour agency membership (only for role 'agent')
    agency: {
        type: mongoose.Schema.ObjectId,
        ref: 'Agency',
        default: null
    },
    agencyRole: {
        type: String,
        enum: ['owner', 'staff'],
        default: null
    },
    // A hotel the same person also runs. Only set when `agency` is their tour agency: one account
    // can have one tour agency (/agent) and one hotel (/hotel). See utils/vendorMembership.js
    hotelAgency: {
        type: mongoose.Schema.ObjectId,
        ref: 'Agency',
        default: null
    },
    hotelAgencyRole: {
        type: String,
        enum: ['owner', 'staff'],
        default: null
    },

    // Account standing, managed by the master admin
    status: {
        type: String,
        enum: ['active', 'suspended', 'deactivated'],
        default: 'active'
    },
    statusReason: { type: String, trim: true, maxlength: 500, default: '' },
    statusUntil: Date,
    statusChangedAt: Date,
    statusChangedBy: { type: mongoose.Schema.ObjectId, ref: 'User' },

    // Soft delete: the account is hidden and cannot sign in, but can be restored
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    deletedReason: { type: String, trim: true, maxlength: 500, default: '' },

    // Things the user is blocked from doing while still being able to sign in
    restrictions: {
        booking: { type: Boolean, default: false },
        reviews: { type: Boolean, default: false },
        messaging: { type: Boolean, default: false },
        posting: { type: Boolean, default: false },
        reason: { type: String, trim: true, maxlength: 500, default: '' },
        until: Date,
        setBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
        setAt: Date
    },

    // Prepaid balance in taka; changes go through WalletTransaction so every change is recorded
    walletBalance: { type: Number, default: 0 },

    lastLoginAt: Date,
    // When the person last used the app and the website (utils/client.js), saved at most hourly
    seen: {
      app: { at: Date, version: String, platform: String },
      web: { at: Date, platform: String }
    },
    loginCount: { type: Number, default: 0 },

    // Identity verification (NID, passport...) reviewed by the master admin
    verification: {
        status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
        documents: [{
            kind: { type: String, enum: ['nid', 'passport', 'driving_license', 'selfie'], required: true },
            // Stored outside /public and served only through an authenticated route
            file: { type: String, required: true, select: false },
            originalName: { type: String, default: '' },
            mimeType: { type: String, default: '' },
            uploadedAt: { type: Date, default: Date.now }
        }],
        note: { type: String, trim: true, maxlength: 500, default: '' },
        submittedAt: Date,
        reviewedAt: Date,
        reviewedBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
    },

    // Invited accounts have no password until the invite is accepted
    accountStatus: {
        type: String,
        enum: ['invited', 'active'],
        default: 'active'
    },
    // Set when Plejar creates the account with a temporary password; the agency panel asks for a new one first
    mustChangePassword: { type: Boolean, default: false },
    credentialsSentAt: Date,
    inviteToken: {
        type: String,
        select: false
    },
    inviteExpires: {
        type: Date,
        select: false
    },
    phone: {
        type: String,
        default: ''
    },

    // Public profile in the app
    bio: { type: String, trim: true, maxlength: [300, 'Keep your bio under 300 characters'], default: '' },
    coverPhoto: { type: String, default: '' },
    hometown: { type: String, trim: true, maxlength: [80, 'Hometown is too long'], default: '' },
    // Under the name on the Account screen, e.g. "Designer"
    occupation: { type: String, trim: true, maxlength: [60, 'Keep your occupation under 60 characters'], default: '' },
    // Address book; the default one is also copied to `address` as one line
    addresses: [{
        label: { type: String, trim: true, maxlength: 30, default: '' }, // Home, Office...
        districtCode: { type: String, required: true },
        district: { type: String, required: true },
        division: { type: String, default: '' },
        area: { type: String, required: true },
        line: { type: String, trim: true, required: true, maxlength: 200 }, // house, flat no, road
        isDefault: { type: Boolean, default: false }
    }],
    // My Interest: what to recommend
    interests: [{ type: String, enum: ['travel', 'restaurant', 'tour', 'hotel', 'place', 'food', 'games', 'travel_group'] }],

    // App settings (Settings tab)
    settings: {
        privacy: {
            defaultAudience: { type: String, enum: ['public', 'followers', 'private'], default: 'public' },
            whoCanComment: { type: String, enum: ['everyone', 'followers', 'nobody'], default: 'everyone' },
            showTrips: { type: Boolean, default: true },
            // Settings > Profile: what other travelers see on your profile
            showPersonalInfo: { type: Boolean, default: true }, // bio, hometown, occupation
            showAddress: { type: Boolean, default: false } // your default address's area and district (never the street)
        },
        notifications: {
            reactions: { type: Boolean, default: true },
            comments: { type: Boolean, default: true },
            replies: { type: Boolean, default: true },
            shares: { type: Boolean, default: true },
            follows: { type: Boolean, default: true },
            tours: { type: Boolean, default: true }
        },
        language: { type: String, enum: ['en', 'bn'], default: 'en' }
    },
    address: {
        type: String,
        default: ''
    },
    gender: { type: String, enum: ['male', 'female', 'other', 'prefer_not_to_say', ''], default: '' },

    // Contact details confirmed with a code ("ID Verification" in the app)
    emailVerifiedAt: Date,
    phoneVerifiedAt: Date,

    // Refer Friends: this traveler's code, who invited them, and when the inviter was rewarded
    referralCode: { type: String, uppercase: true, trim: true },
    referredBy: { type: mongoose.Schema.ObjectId, ref: 'User' },
    referralRewardedAt: Date,

    authProvider: {
        type: String,
        enum: ['local', 'google'],
        default: 'local'
    },
    googleId: {
        type: String,
        default: null
    },

    password: {
        type: String,
        required: function() {
            return this.authProvider === 'local' && this.accountStatus !== 'invited';
        },
        minlength: 8,
        select: false
    },
    confirmPassword: {
        type: String,
        required: function() {
            return this.authProvider === 'local' && this.isNew && this.accountStatus !== 'invited';
        },
        validate: {
            validator: function (el) {
                return !el || el === this.password;
            },
            message: 'Passwords are not same'
        },
        select: false
    },
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpire: Date,
    active: {
        type: Boolean,
        default: true,
        select: false
    },
    // Device tokens for Firebase Cloud Messaging (FCM) push notifications
    fcmTokens: [{
        token: { type: String, required: true, trim: true },
        device: { type: String, trim: true, default: '' },
        platform: { type: String, enum: ['android', 'ios', 'web', 'other'], default: 'android' },
        updatedAt: { type: Date, default: Date.now }
    }]
});

userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ phone: 1 });
userSchema.index({ roles: 1 });
userSchema.index({ hotelAgency: 1 }, { partialFilterExpression: { hotelAgency: { $type: 'objectId' } } });
userSchema.index({ referralCode: 1 }, { unique: true, partialFilterExpression: { referralCode: { $type: 'string' } } });
userSchema.index({ referredBy: 1 });
userSchema.index({ 'fcmTokens.token': 1 });

// Keep name as "first last" (on validate for new accounts, on save for updates that skip validation)
function syncName(next) {
    if ((this.isModified('firstName') || this.isModified('lastName')) && (this.firstName || this.lastName)) {
        this.name = `${this.firstName || ''} ${this.lastName || ''}`.trim();
    }
    next();
}
userSchema.pre('validate', syncName);
userSchema.pre('save', syncName);

// Keep `roles` and the main `role` in step. Setting `role` on its own adds that role.
userSchema.pre('save', function (next) {
    if (!this.roles || !this.roles.length) this.roles = [this.role || 'user'];
    else if (this.isModified('role') && !this.isModified('roles') && !this.roles.includes(this.role)) this.roles.push(this.role);
    this.role = mainRole(this.roles);
    next();
});

userSchema.pre('save', async function (next) {
    if (!this.isModified('password') || !this.password) return next();

    this.password = await bcrypt.hash(this.password, 12);

    this.confirmPassword = undefined;
    next();
});

userSchema.pre('save', function (next) {
    if (!this.isModified('password') || this.isNew) return next();

    this.passwordChangedAt = Date.now() - 1000;
    // Choosing your own password ends the temporary one (unless Plejar is issuing a new temporary one)
    if (!this.$locals.temporaryPassword) this.mustChangePassword = false;
    next();
});

userSchema.pre(/^find/, function (next) {
    // this points to current query; admin screens pass { includeInactive: true } to see deleted accounts
    if (!this.getOptions().includeInactive) this.find({ active: { $ne: false } });
    next();
});

userSchema.methods.correctPassword = async function (candidatePassword, userPassword) {
    return await bcrypt.compare(candidatePassword, userPassword);
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
    if (this.passwordChangedAt) {
        const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);

        return JWTTimestamp < changedTimestamp;
    }

    // false means not changed
    return false;
};

userSchema.methods.createPasswordResetToken = function () {
    const resetToken = crypto.randomBytes(32).toString('hex');

    this.passwordResetToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

    this.passwordResetExpire = Date.now() + 10 * 60 * 1000;

    return resetToken;
}

// Invite links stay valid for 7 days; only the hash is stored
userSchema.methods.createInviteToken = function () {
    const inviteToken = crypto.randomBytes(32).toString('hex');

    this.inviteToken = crypto
        .createHash('sha256')
        .update(inviteToken)
        .digest('hex');

    this.inviteExpires = Date.now() + 7 * 24 * 60 * 60 * 1000;

    return inviteToken;
}

const User = mongoose.model('User', userSchema);

module.exports = User;