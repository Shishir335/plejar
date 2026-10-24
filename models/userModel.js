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

    // Invited accounts have no password until the invite is accepted
    accountStatus: {
        type: String,
        enum: ['invited', 'active'],
        default: 'active'
    },
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
    next();
});

userSchema.pre(/^find/, function (next) {
    // this points to current query
    this.find({ active: { $ne: false } });
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