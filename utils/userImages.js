const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { compressImage } = require('./imageCompress');
const AppError = require('./appError');
const { isCloudinaryConfigured, isCloudinaryUrl, uploadBufferToCloudinary, deleteFromCloudinary } = require('./cloudinary');

// Traveler profile photos and covers: on Cloudinary, or in public/img/users without it

const USER_IMG_DIR = path.join(__dirname, '..', 'public', 'img', 'users');
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const imageFilter = (req, file, cb) => (IMAGE_TYPES.includes(file.mimetype) ? cb(null, true) : cb(new AppError('Use a JPG, PNG or WebP photo.', 400), false));

// Registration: one optional profile photo in the field "photo"
const signupPhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 }, fileFilter: imageFilter }).single('photo');

// Settings: profile photo and cover
const profileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 2 }, fileFilter: imageFilter })
  .fields([{ name: 'photo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]);

// Square-cropped (or banner for covers) and re-encoded, which also strips camera location data
// Returns what to store: a full Cloudinary URL, or a file name in public/img/users
const saveProfileImage = async (file, userId, kind) => {
  const image = await compressImage(file.buffer, kind === 'cover' ? 'cover' : 'avatar');
  if (isCloudinaryConfigured()) {
    return (await uploadBufferToCloudinary(image.buffer, { folder: `users/${userId}` })).secure_url;
  }
  await fs.promises.mkdir(USER_IMG_DIR, { recursive: true });
  const name = `${kind}-${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${image.ext}`;
  await fs.promises.writeFile(path.join(USER_IMG_DIR, name), image.buffer);
  return name;
};

const removeProfileImage = async name => {
  if (isCloudinaryUrl(name)) return deleteFromCloudinary(name);
  if (!name || name === 'profile.png' || name.includes('/') || name.includes('..')) return;
  await fs.promises.unlink(path.join(USER_IMG_DIR, name)).catch(() => {});
};

module.exports = { signupPhotoUpload, profileUpload, saveProfileImage, removeProfileImage };
