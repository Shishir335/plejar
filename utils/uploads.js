const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const AppError = require('./appError');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const PUBLIC_AGENCY_DIR = path.join(__dirname, '..', 'public', 'img', 'agencies');
// Verification documents (trade license, NID) must never be reachable as static files
const PRIVATE_DOCS_DIR = path.join(__dirname, '..', 'uploads', 'private', 'verification');

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];

const ensureDir = dir => fs.promises.mkdir(dir, { recursive: true });
const randomName = () => `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;

const fileFilter = allowed => (req, file, cb) => {
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new AppError(`Unsupported file type. Upload ${allowed === IMAGE_TYPES ? 'a JPG, PNG or WebP image' : 'a JPG, PNG, WebP or PDF file'}.`, 400), false);
};

// Public images (logos, package photos): kept in memory, then resized with sharp
const imageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter(IMAGE_TYPES),
  limits: { fileSize: MAX_FILE_SIZE, files: 6 }
});

// Private documents: kept in memory so we can choose the final private path ourselves
const documentUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter(DOCUMENT_TYPES),
  limits: { fileSize: MAX_FILE_SIZE, files: 2 }
});

// Traveler identity documents: up to four files (ID, passport, driving license, selfie)
const userDocumentUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter(DOCUMENT_TYPES),
  limits: { fileSize: MAX_FILE_SIZE, files: 4 }
});

/**
 * Resize an uploaded image and store it under /public/img/agencies/<agencyId>/.
 * Returns the public URL path.
 */
const saveAgencyImage = async (file, agencyId, { width = 1600, height } = {}) => {
  const dir = path.join(PUBLIC_AGENCY_DIR, String(agencyId));
  await ensureDir(dir);
  const filename = `${randomName()}.jpg`;

  await sharp(file.buffer)
    .rotate()
    .resize({ width, height, fit: height ? 'cover' : 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(path.join(dir, filename));

  return `/img/agencies/${agencyId}/${filename}`;
};

// Delete a previously saved public agency image (ignores missing files)
const removeAgencyImage = async urlPath => {
  if (!urlPath || !urlPath.startsWith('/img/agencies/')) return;
  const target = path.join(__dirname, '..', 'public', urlPath);
  if (!target.startsWith(PUBLIC_AGENCY_DIR)) return;
  await fs.promises.unlink(target).catch(() => {});
};

/**
 * Store a verification document privately. Returns the path relative to the private dir.
 */
const savePrivateDocument = async (file, agencyId) => {
  const dir = path.join(PRIVATE_DOCS_DIR, String(agencyId));
  await ensureDir(dir);
  const ext = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.jpg';
  const filename = `${randomName()}${ext}`;
  await fs.promises.writeFile(path.join(dir, filename), file.buffer, { mode: 0o600 });
  return path.join(String(agencyId), filename);
};

// Absolute path of a private document, refusing anything outside the private dir
const privateDocumentPath = relative => {
  const target = path.resolve(PRIVATE_DOCS_DIR, relative || '');
  if (!target.startsWith(PRIVATE_DOCS_DIR + path.sep)) return null;
  return target;
};

const removePrivateDocument = async relative => {
  const target = privateDocumentPath(relative);
  if (target) await fs.promises.unlink(target).catch(() => {});
};

module.exports = {
  imageUpload,
  documentUpload,
  userDocumentUpload,
  saveAgencyImage,
  removeAgencyImage,
  savePrivateDocument,
  privateDocumentPath,
  removePrivateDocument
};
