const multer = require('multer');
const sharp = require('sharp');
const User = require("../models/userModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const factory = require("./handlerFactory");
const Email = require("../utils/email");
const { savePrivateDocument, removePrivateDocument } = require('../utils/uploads');
const { logActivity } = require('../utils/activity');

const multerStorage = multer.memoryStorage();

const multerFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image')) {
        cb(null, true);
    } else {
        cb(new AppError('Not an image! please upload only image.', 400), false);
    }
}

const upload = multer({
    storage: multerStorage,
    fileFilter: multerFilter
});

exports.uploadUserPhoto = upload.single('photo');

exports.resizeUserPhoto = catchAsync(async (req, res, next) => {
    if (!req.file) return next();

    req.file.filename = `user-${req.user.id}-${Date.now()}.jpeg`;

    await sharp(req.file.buffer)
        .resize(500, 500)
        .toFormat('jpeg')
        .jpeg({ quality: 90 })
        .toFile(`public/img/users/${req.file.filename}`);

    next();
});

const filterObj = (obj, ...allowedFields) => {
    const newObj = {};
    Object.keys(obj).forEach(item => {
        if (allowedFields.includes(item)) {
            newObj[item] = obj[item];
        }
    });

    return newObj;
}

exports.updateMe = catchAsync(async (req, res, next) => {
    // 1) Create error if user Posts password data
    if (req.body.password || req.body.confirmPassword) {
        return next(new AppError('This route is not for password update', 400));
    }

    // 2) filtered out unwanted fields that are not allowed to update
    const filteredBody = filterObj(req.body, 'name', 'email', 'phone', 'address');
    if (req.file) filteredBody.photo = req.file.filename;

    // 3) Update user document
    const updateUser =
        await User.findByIdAndUpdate(req.user.id, filteredBody,
            { new: true, runValidators: true });

    res.status(200).json({
        status: 'success',
        data: updateUser
    });
});

exports.deleteMe = catchAsync(async (req, res, next) => {
    await User.findByIdAndUpdate(req.user.id, { active: false });

    res.status(204).json({
        status: 'success'
    });
})

// ---------- Traveler identity verification ----------

const DOC_FIELDS = { nid: 'nid', passport: 'passport', drivingLicense: 'driving_license', selfie: 'selfie' };

const verificationView = user => ({
    status: user.verification.status,
    note: user.verification.note,
    submittedAt: user.verification.submittedAt,
    reviewedAt: user.verification.reviewedAt,
    documents: user.verification.documents.map(d => ({
        id: d._id, kind: d.kind, originalName: d.originalName, uploadedAt: d.uploadedAt
    }))
});

exports.getMyVerification = catchAsync(async (req, res, next) => {
    res.status(200).json({ status: 'success', data: { verification: verificationView(req.user) } });
});

exports.submitMyVerification = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('+verification.documents.file');
    const files = req.files || {};
    const uploads = Object.entries(DOC_FIELDS)
        .map(([field, kind]) => ({ kind, file: files[field] && files[field][0] }))
        .filter(u => u.file);

    if (!uploads.length) {
        return next(new AppError('Upload at least one ID document: NID, passport or driving license.', 400));
    }
    const kindsAfter = new Set([...user.verification.documents.map(d => d.kind), ...uploads.map(u => u.kind)]);
    if (!['nid', 'passport', 'driving_license'].some(k => kindsAfter.has(k))) {
        return next(new AppError('Include an ID document: NID, passport or driving license.', 400));
    }

    const stored = await Promise.all(uploads.map(u => savePrivateDocument(u.file, `u-${user.id}`)));
    const toRemove = [];
    uploads.forEach(({ kind, file }, i) => {
        user.verification.documents.filter(d => d.kind === kind).forEach(d => toRemove.push(d.file));
        user.verification.documents = user.verification.documents.filter(d => d.kind !== kind);
        user.verification.documents.push({ kind, file: stored[i], originalName: file.originalname.slice(0, 120), mimeType: file.mimetype });
    });

    user.verification.status = 'pending';
    user.verification.note = '';
    user.verification.submittedAt = new Date();
    await user.save({ validateBeforeSave: false });
    await Promise.all(toRemove.map(removePrivateDocument));

    await logActivity(req, { action: 'verification.submitted', summary: 'Submitted identity documents for verification', user: user._id });

    res.status(200).json({
        status: 'success',
        message: 'Documents received. Plezar will review them and update your status.',
        data: { verification: verificationView(user) }
    });
});

exports.verificationView = verificationView;

exports.getProfile = (req, res, next) => {
    req.params.id = req.user.id;
    next();
};

exports.getAllUsers = factory.getAll(User);
exports.getUser = factory.getOne(User);

// Get detailed user profile (Admin)
exports.getUserDetails = catchAsync(async (req, res, next) => {
    const userId = req.params.id;
    const user = await User.findById(userId).select('+active');

    if (!user) {
        return next(new AppError('No user found with that ID', 404));
    }

    res.status(200).json({
        status: 'success',
        data: {
            user
        }
    });
});

// Create User with Role-Based Permission Control
exports.createUser = catchAsync(async (req, res, next) => {
    const { name, email, password, confirmPassword, role } = req.body;

    const targetRole = role || 'user';

    // Manager can ONLY create 'user' accounts
    if (req.user.role === 'manager' && targetRole !== 'user') {
        return next(new AppError('Managers are only permitted to create regular User accounts.', 403));
    }

    // Admin can create 'admin', 'manager', or 'user'
    if (req.user.role === 'admin' && !['user', 'manager', 'admin'].includes(targetRole)) {
        return next(new AppError('Invalid role specified.', 400));
    }

    const newUser = await User.create({
        name,
        email,
        password,
        confirmPassword: confirmPassword || password,
        role: targetRole
    });

    newUser.password = undefined;

    res.status(201).json({
        status: 'success',
        message: `Account created successfully with role ${targetRole.toUpperCase()}`,
        data: {
            user: newUser
        }
    });
});

// Update User with Role-Based Permission Control
exports.updateUser = catchAsync(async (req, res, next) => {
    const targetUser = await User.findById(req.params.id);

    if (!targetUser) {
        return next(new AppError('No account found with that ID', 404));
    }

    // Manager constraints
    if (req.user.role === 'manager') {
        if (targetUser.role !== 'user') {
            return next(new AppError('Managers can only modify standard User accounts.', 403));
        }
        if (req.body.role && req.body.role !== 'user') {
            return next(new AppError('Managers cannot elevate account privileges.', 403));
        }
    }

    // Role validation & self-demotion protection
    if (req.body.role) {
        if (!['user', 'manager', 'admin'].includes(req.body.role)) {
            return next(new AppError('Invalid role specified.', 400));
        }
        if (req.user.id === req.params.id && req.body.role !== req.user.role) {
            return next(new AppError('You cannot change your own role to prevent accidental lockout.', 400));
        }
    }

    // Only allow profile fields and role; password changes go through adminResetUserPassword
    const filteredBody = filterObj(req.body, 'name', 'email', 'phone', 'address', 'photo', 'role');

    const updatedUser = await User.findByIdAndUpdate(req.params.id, filteredBody, {
        new: true,
        runValidators: true
    });

    res.status(200).json({
        status: 'success',
        data: {
            user: updatedUser
        }
    });
});

// Delete User with Role-Based Permission Control
exports.deleteUser = catchAsync(async (req, res, next) => {
    const targetId = req.params.id;

    if (req.user.id === targetId) {
        return next(new AppError('You cannot delete your currently authenticated account.', 400));
    }

    const targetUser = await User.findById(targetId);

    if (!targetUser) {
        return next(new AppError('No account found with that ID to delete', 404));
    }

    // Manager can ONLY delete 'user' accounts
    if (req.user.role === 'manager' && targetUser.role !== 'user') {
        return next(new AppError('Managers can only delete standard User accounts. Manager and Admin deletion requires Admin clearance.', 403));
    }

    // Admin can delete 'user', 'manager', and other 'admin' accounts
    await User.findByIdAndDelete(targetId);

    res.status(200).json({
        status: 'success',
        message: `Account (${targetUser.email}) purged successfully.`,
        data: null
    });
});

// Admin Reset User Password Directly
exports.adminResetUserPassword = catchAsync(async (req, res, next) => {
    const { password, confirmPassword } = req.body;

    if (!password || password.length < 8) {
        return next(new AppError('Password must contain at least 8 characters.', 400));
    }

    if (confirmPassword && password !== confirmPassword) {
        return next(new AppError('Passwords do not match.', 400));
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
        return next(new AppError('No account found with that ID.', 404));
    }

    // Role permission hierarchy
    if (req.user.role === 'manager' && targetUser.role !== 'user') {
        return next(new AppError('Managers can only reset passwords for standard Customer accounts.', 403));
    }

    targetUser.password = password;
    targetUser.confirmPassword = password;
    targetUser.passwordResetToken = undefined;
    targetUser.passwordResetExpire = undefined;
    await targetUser.save();

    res.status(200).json({
        status: 'success',
        message: `Password for ${targetUser.name} (${targetUser.email}) was successfully reset.`
    });
});

// Admin Send Password Reset Link to User
exports.adminSendResetEmail = catchAsync(async (req, res, next) => {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
        return next(new AppError('No account found with that ID.', 404));
    }

    if (req.user.role === 'manager' && targetUser.role !== 'user') {
        return next(new AppError('Managers can only request resets for standard Customer accounts.', 403));
    }

    const resetToken = targetUser.createPasswordResetToken();
    await targetUser.save({ validateBeforeSave: false });

    const resetURL = `${req.protocol}://${req.get('host')}/reset-password?token=${resetToken}`;

    let emailSent = false;
    try {
        await new Email(targetUser, resetURL).sendPasswordReset();
        emailSent = true;
    } catch (err) {
        console.warn(`Could not dispatch password reset email to ${targetUser.email}:`, err.message);
    }

    res.status(200).json({
        status: 'success',
        message: emailSent 
            ? `Password reset email dispatched to ${targetUser.email}.`
            : `Password reset link generated for ${targetUser.email}.`,
        emailSent,
        resetURL
    });
});