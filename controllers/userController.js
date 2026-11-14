const multer = require('multer');
const User = require("../models/userModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const factory = require("./handlerFactory");
const Email = require("../utils/email");
const { savePrivateDocument, removePrivateDocument, IMAGE_TYPES } = require('../utils/uploads');
const { ID_KINDS, FACE_KINDS, ageOn, idOptions } = require('../utils/identity');
const { saveProfileImage } = require('../utils/userImages');
const { logActivity } = require('../utils/activity');
const { STAFF, LABELS, hasRole, rolesOf, isTravelerOnly, setRoles } = require('../utils/roles');
const { linkVendorAgency } = require('../utils/vendorLink');

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

    req.file.filename = await saveProfileImage(req.file, req.user.id, 'user');

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

// Saves the uploaded ID documents and selfie (also used by the app's ID Verification steps)
const saveVerificationDocuments = async req => {
    const user = await User.findById(req.user.id).select('+verification.documents.file');
    const files = req.files || {};
    const uploads = Object.entries(DOC_FIELDS)
        .map(([field, kind]) => ({ kind, file: files[field] && files[field][0] }))
        .filter(u => u.file);

    if (!uploads.length) {
        throw new AppError('Upload at least one ID document: NID, passport or driving license.', 400);
    }
    const kindsAfter = new Set([...user.verification.documents.map(d => d.kind), ...uploads.map(u => u.kind)]);
    if (!['nid', 'passport', 'driving_license'].some(k => kindsAfter.has(k))) {
        throw new AppError('Include an ID document: NID, passport or driving license.', 400);
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
    return user;
};

exports.submitMyVerification = catchAsync(async (req, res, next) => {
    const user = await saveVerificationDocuments(req);
    res.status(200).json({
        status: 'success',
        message: 'Documents received. Plejar will review them and update your status.',
        data: { verification: verificationView(user) }
    });
});

// Saves the files, then hands over to the next handler (the app's own response)
exports.saveMyVerificationDocuments = catchAsync(async (req, res, next) => {
    await saveVerificationDocuments(req);
    next();
});

// ---------- ID and face check from the app (POST /me/verification/identity) ----------

// Multipart field -> document kind
const IDENTITY_FIELDS = {
    nidFront: 'nid_front',
    nidBack: 'nid_back',
    birthCertificate: 'birth_certificate',
    selfie: 'selfie',
    faceLeft: 'face_left',
    faceRight: 'face_right'
};
exports.IDENTITY_FIELDS = IDENTITY_FIELDS;

// A 400 the app can place next to the right photo: { code, message, errors: { field: message } }
const fieldError = (res, message, field, code) =>
    res.status(400).json({ status: 'fail', code, message, errors: { [field]: message } });

const num = v => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : undefined);

// The app's head-turn check: { order: ['left','right'], leftYaw, rightYaw, durationMs, platform }
const readLiveness = raw => {
    let l = raw;
    if (typeof raw === 'string') {
        try { l = JSON.parse(raw); } catch (e) { l = null; }
    }
    if (!l || typeof l !== 'object') return undefined;
    const order = (Array.isArray(l.order) ? l.order : []).filter(o => ['left', 'right', 'straight'].includes(o)).slice(0, 4);
    return {
        order,
        leftYaw: num(l.leftYaw),
        rightYaw: num(l.rightYaw),
        durationMs: num(l.durationMs),
        platform: String(l.platform || '').slice(0, 20)
    };
};

/**
 * Saves a complete submission: the ID (NID front and back from 18, a birth certificate below 18)
 * and three face photos (straight, left, right). Replaces anything sent before and waits for review.
 */
exports.submitIdentity = catchAsync(async (req, res, next) => {
    const user = await User.findById(req.user.id).select('+verification.documents.file');
    if (user.verification.status === 'approved') {
        return next(new AppError('Your identity is already verified.', 400));
    }
    const age = ageOn(user.dateOfBirth);
    if (age == null) {
        return fieldError(res, 'Add your date of birth to your profile first, so we know which ID to ask for.', 'dateOfBirth', 'date_of_birth_required');
    }

    const files = req.files || {};
    const file = field => files[field] && files[field][0];
    const allowed = idOptions(age);
    const documentType = String(req.body.documentType || (file('birthCertificate') ? 'birth_certificate' : 'nid'));
    if (!allowed.includes(documentType)) {
        return fieldError(res,
            allowed[0] === 'nid'
                ? 'You are 18 or older, so please use your National ID card (NID).'
                : 'You are under 18, so please use your birth certificate.',
            'documentType', 'wrong_document_type'
        );
    }

    const idFields = documentType === 'nid' ? ['nidFront', 'nidBack'] : ['birthCertificate'];
    const names = { nidFront: 'the front of your NID', nidBack: 'the back of your NID', birthCertificate: 'your birth certificate', selfie: 'a photo looking straight at the camera', faceLeft: 'a photo turning your head left', faceRight: 'a photo turning your head right' };
    const needed = [...idFields, 'selfie', 'faceLeft', 'faceRight'];
    const missing = needed.find(f => !file(f));
    if (missing) return fieldError(res, `Add ${names[missing]}.`, missing, 'missing_photo');
    // Face photos and NID sides must be photos the reviewer can see; a birth certificate may be a PDF
    const notImage = needed.find(f => f !== 'birthCertificate' && !IMAGE_TYPES.includes(file(f).mimetype));
    if (notImage) return fieldError(res, `Send ${names[notImage]} as a JPG, PNG or WebP photo.`, notImage, 'not_an_image');

    const stored = await Promise.all(needed.map(f => savePrivateDocument(file(f), `u-${user.id}`)));
    // A new submission replaces every earlier ID and face photo
    const replaced = user.verification.documents.filter(d => ID_KINDS.includes(d.kind) || FACE_KINDS.includes(d.kind));
    user.verification.documents = user.verification.documents.filter(d => !replaced.includes(d));
    needed.forEach((f, i) => {
        const upload = file(f);
        user.verification.documents.push({
            kind: IDENTITY_FIELDS[f],
            file: stored[i],
            originalName: String(upload.originalname || '').slice(0, 120),
            mimeType: upload.mimetype
        });
    });
    user.verification.liveness = readLiveness(req.body.liveness);
    user.verification.status = 'pending';
    user.verification.note = '';
    user.verification.submittedAt = new Date();
    user.verification.reviewedAt = undefined;
    user.verification.reviewedBy = undefined;
    await user.save({ validateBeforeSave: false });
    await Promise.all(replaced.map(d => removePrivateDocument(d.file)));

    await logActivity(req, {
        action: 'verification.submitted',
        summary: `Submitted ${documentType === 'nid' ? 'NID' : 'birth certificate'} and face check for verification`,
        user: user._id
    });
    next();
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

// Roles an admin can give or take away. System supports traveler, vendor, manager, admin, dev.
const GRANTABLE = ['user', 'agent', 'manager', 'admin', 'dev'];
const isFullAdmin = user => hasRole(user, 'admin', 'dev');

// { roles: [...] }, { addRole: 'admin' }, { removeRole: 'manager' }, or legacy { role: 'admin' }
const wantedRoles = (body, current) => {
    if (Array.isArray(body.roles)) return body.roles.map(String);
    if (body.addRole || body.roleToAdd) return [...current, String(body.addRole || body.roleToAdd).trim()];
    if (body.removeRole || body.roleToRemove) return current.filter(r => r !== String(body.removeRole || body.roleToRemove).trim());
    if (body.role) return [...current.filter(r => !STAFF.includes(r)), String(body.role).trim()];
    return null;
};

// Create User with Role-Based Permission Control
exports.createUser = catchAsync(async (req, res, next) => {
    const { name, email, password, confirmPassword } = req.body;

    const targetRoles = wantedRoles(req.body, []) || ['user'];
    if (!targetRoles.length || targetRoles.some(r => !GRANTABLE.includes(r))) {
        return next(new AppError(`Choose roles from: ${GRANTABLE.join(', ')}.`, 400));
    }

    // Manager can ONLY create traveler accounts
    if (!isFullAdmin(req.user) && targetRoles.some(r => r !== 'user')) {
        return next(new AppError('Managers are only permitted to create regular User accounts.', 403));
    }

    const newUser = setRoles(new User({
        name,
        email,
        password,
        confirmPassword: confirmPassword || password
    }), targetRoles);
    if (targetRoles.includes('agent')) {
        const problem = await linkVendorAgency(newUser, req.body);
        if (problem) return next(new AppError(problem, 400));
    }
    await newUser.save();
    const targetRole = targetRoles.map(r => LABELS[r] || r).join(' + ');

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

    const current = rolesOf(targetUser);
    const wanted = wantedRoles(req.body, current);

    // Manager constraints
    if (!isFullAdmin(req.user)) {
        if (!isTravelerOnly(targetUser)) {
            return next(new AppError('Managers can only modify standard User accounts.', 403));
        }
        if (wanted && wanted.some(r => r !== 'user')) {
            return next(new AppError('Managers cannot elevate account privileges.', 403));
        }
    }

    // Role validation & self-demotion protection
    let nextRoles = null;
    if (wanted) {
        if (wanted.some(r => !GRANTABLE.includes(r))) {
            return next(new AppError(`Choose roles from: ${GRANTABLE.join(', ')}.`, 400));
        }
        nextRoles = Array.from(new Set(wanted.filter(r => GRANTABLE.includes(r))));
        if (!nextRoles.length) return next(new AppError('An account needs at least one role.', 400));

        // Prevent accidental lockout: if modifying own account, cannot remove last admin/dev role
        if (String(req.user.id || req.user._id) === String(targetUser.id || targetUser._id)) {
            const wasAdmin = hasRole(req.user, 'admin', 'dev');
            const willBeAdmin = nextRoles.some(r => ['admin', 'dev'].includes(r));
            if (wasAdmin && !willBeAdmin) {
                return next(new AppError('You cannot remove your own administrator or developer role to prevent accidental lockout.', 400));
            }
        }
    }

    // Only allow profile fields and roles; password changes go through adminResetUserPassword
    const filteredBody = filterObj(req.body, 'name', 'email', 'phone', 'address', 'photo');
    Object.assign(targetUser, filteredBody);
    if (nextRoles) {
        if (nextRoles.includes('agent')) {
            const problem = await linkVendorAgency(targetUser, req.body);
            if (problem) return next(new AppError(problem, 400));
        }
        setRoles(targetUser, nextRoles);
        if (!nextRoles.includes('agent')) {
            targetUser.agency = null;
            targetUser.agencyRole = null;
        }
        await logActivity(req, {
            action: 'user.roles_changed',
            summary: `Roles changed from [${current.join(', ')}] to [${nextRoles.join(', ')}] by ${req.user.name || 'Admin'}`,
            user: targetUser._id
        });
    }
    await targetUser.save({ validateBeforeSave: false });
    const updatedUser = targetUser;

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

    // Manager can ONLY delete traveler accounts
    if (!isFullAdmin(req.user) && !isTravelerOnly(targetUser)) {
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
    if (!isFullAdmin(req.user) && !isTravelerOnly(targetUser)) {
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

    if (!isFullAdmin(req.user) && !isTravelerOnly(targetUser)) {
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

// ---------- Firebase Cloud Messaging (FCM) Device Tokens ----------

exports.registerFcmToken = catchAsync(async (req, res, next) => {
    const token = req.body.fcmToken || req.body.token;
    if (!token) {
        return next(new AppError('Please provide an FCM device token.', 400));
    }

    const { registerUserToken } = require('../utils/pushNotification');
    await registerUserToken(req.user._id, {
        token,
        device: req.body.device || req.headers['user-agent'] || '',
        platform: req.body.platform || 'android'
    });

    res.status(200).json({
        status: 'success',
        message: 'FCM device token registered successfully.'
    });
});

exports.removeFcmToken = catchAsync(async (req, res, next) => {
    const token = req.body.fcmToken || req.body.token;
    if (!token) {
        return next(new AppError('Please provide an FCM device token to remove.', 400));
    }

    const { removeUserToken } = require('../utils/pushNotification');
    await removeUserToken(req.user._id, token);

    res.status(200).json({
        status: 'success',
        message: 'FCM device token removed successfully.'
    });
});