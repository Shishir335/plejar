const crypto = require('crypto');
const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please tell ur your name']
    },
    email: {
        type: String,
        required: [true, 'Please provide your email'],
        unique: true,
        lowercase: true,
        validate: [validator.isEmail]
    },
    photo: {
        type: String,
        default: 'profile.png'
    },
    role: {
        type: String,
        enum: ['user', 'manager', 'admin', 'dev', 'agent'],
        default: 'user'
    },

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
    // Set when Plezar creates the account with a temporary password; the agency panel asks for a new one first
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

    // App settings (Settings tab)
    settings: {
        privacy: {
            defaultAudience: { type: String, enum: ['public', 'followers', 'private'], default: 'public' },
            whoCanComment: { type: String, enum: ['everyone', 'followers', 'nobody'], default: 'everyone' },
            showTrips: { type: Boolean, default: true }
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
    }
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
    // Choosing your own password ends the temporary one (unless Plezar is issuing a new temporary one)
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