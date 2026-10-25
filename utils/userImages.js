const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const AppError = require('./appError');

// Traveler profile photos and covers, stored in public/img/users

const USER_IMG_DIR = path.join(__dirname, '..', 'public', 'img', 'users');
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const imageFilter = (req, file, cb) => (IMAGE_TYPES.includes(file.mimetype) ? cb(null, true) : cb(new AppError('Use a JPG, PNG or WebP photo.', 400), false));

// Registration: one optional profile photo in the field "photo"
const signupPhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 }, fileFilter: imageFilter }).single('photo');

// Settings: profile photo and cover
const profileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 2 }, fileFilter: imageFilter })
  .fields([{ name: 'photo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]);

// Square-cropped (or banner for covers) and re-encoded, which also strips camera location data
const saveProfileImage = async (file, userId, kind) => {
  await fs.promises.mkdir(USER_IMG_DIR, { recursive: true });
  const name = `${kind}-${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  const size = kind === 'cover' ? { width: 1500, height: 500 } : { width: 500, height: 500 };
  await sharp(file.buffer).rotate().resize({ ...size, fit: 'cover' }).jpeg({ quality: 85 }).toFile(path.join(USER_IMG_DIR, name));
  return name;
};

const removeProfileImage = async name => {
  if (!name || name === 'profile.png' || name.includes('/') || name.includes('..')) return;
  await fs.promises.unlink(path.join(USER_IMG_DIR, name)).catch(() => {});
};

module.exports = { signupPhotoUpload, profileUpload, saveProfileImage, removeProfileImage };
