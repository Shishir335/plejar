const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const AppError = require('./appError');
const {
  isCloudinaryConfigured, isCloudinaryUrl, uploadBufferToCloudinary, deleteFromCloudinary, deleteCloudinaryFolder,
  isPrivateRef, uploadPrivateFile, streamPrivateFile, downloadPrivateFile, deletePrivateFile, deletePrivateFolder
} = require('./cloudinary');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const PUBLIC_AGENCY_DIR = path.join(__dirname, '..', 'public', 'img', 'agencies');
const PUBLIC_DESTINATION_DIR = path.join(__dirname, '..', 'public', 'img', 'destinations');
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

// Membership applications from the website: trade license, NID (front and back), tourism license, other
const applicationUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter(DOCUMENT_TYPES),
  limits: { fileSize: MAX_FILE_SIZE, files: 6 }
}).fields([
  { name: 'trade_license', maxCount: 1 },
  { name: 'nid', maxCount: 2 },
  { name: 'tourism_license', maxCount: 1 },
  { name: 'insurance', maxCount: 1 },
  { name: 'tax_id', maxCount: 1 },
  { name: 'other', maxCount: 2 }
]);

// The app's Travel Agency Application (step 3: three documents, PDF or image, 5 MB each)
const agencyApplicationUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter(DOCUMENT_TYPES),
  limits: { fileSize: MAX_FILE_SIZE, files: 3 }
}).fields([
  { name: 'businessLicense', maxCount: 1 },
  { name: 'insurance', maxCount: 1 },
  { name: 'taxId', maxCount: 1 }
]);

/**
 * Save a resized image (a sharp pipeline) to Cloudinary, or to public/img/<folder>/ without it.
 * Returns the URL to store: a full Cloudinary URL, or a path on this server.
 */
const storeImage = async (image, folder) => {
  const jpeg = image.jpeg({ quality: 82 });
  if (isCloudinaryConfigured()) {
    return (await uploadBufferToCloudinary(await jpeg.toBuffer(), { folder })).secure_url;
  }
  const dir = path.join(__dirname, '..', 'public', 'img', folder);
  await ensureDir(dir);
  const filename = `${randomName()}.jpg`;
  await jpeg.toFile(path.join(dir, filename));
  return `/img/${folder}/${filename}`;
};

/**
 * Resize an uploaded image and store it in the agency's folder. Returns its URL.
 */
const saveAgencyImage = (file, agencyId, { width = 1600, height } = {}) => storeImage(
  sharp(file.buffer).rotate().resize({ width, height, fit: height ? 'cover' : 'inside', withoutEnlargement: true }),
  `agencies/${agencyId}`
);

// Delete a previously saved public agency image (ignores missing files)
const removeAgencyImage = async urlPath => {
  if (isCloudinaryUrl(urlPath)) return deleteFromCloudinary(urlPath);
  if (!urlPath || !urlPath.startsWith('/img/agencies/')) return;
  const target = path.join(__dirname, '..', 'public', urlPath);
  if (!target.startsWith(PUBLIC_AGENCY_DIR)) return;
  await fs.promises.unlink(target).catch(() => {});
};

// Destination photos are stored per destination
const saveDestinationImage = (file, destinationId) => storeImage(
  sharp(file.buffer).rotate().resize({ width: 2000, fit: 'inside', withoutEnlargement: true }),
  `destinations/${destinationId}`
);

const removeDestinationImage = async urlPath => {
  if (isCloudinaryUrl(urlPath)) return deleteFromCloudinary(urlPath);
  if (!urlPath || !urlPath.startsWith('/img/destinations/')) return;
  const target = path.join(__dirname, '..', 'public', urlPath);
  if (!target.startsWith(PUBLIC_DESTINATION_DIR + path.sep)) return;
  await fs.promises.unlink(target).catch(() => {});
};

const removeDestinationFolder = async destinationId => {
  await deleteCloudinaryFolder(`destinations/${destinationId}`);
  const target = path.join(PUBLIC_DESTINATION_DIR, String(destinationId));
  if (!target.startsWith(PUBLIC_DESTINATION_DIR + path.sep)) return;
  await fs.promises.rm(target, { recursive: true, force: true });
};

// Hotel photos, promotion banners and voucher pictures are stored per item, in <hotels|promotions|vouchers>/<id>
const CONTENT_KINDS = ['hotels', 'promotions', 'vouchers'];
const contentDir = kind => path.join(__dirname, '..', 'public', 'img', kind);

const saveContentImage = async (file, kind, id, { width = 2000 } = {}) => {
  if (!CONTENT_KINDS.includes(kind)) throw new Error(`Unknown image kind ${kind}`);
  return storeImage(sharp(file.buffer).rotate().resize({ width, fit: 'inside', withoutEnlargement: true }), `${kind}/${id}`);
};

const removeContentImage = async urlPath => {
  if (isCloudinaryUrl(urlPath)) return deleteFromCloudinary(urlPath);
  const kind = CONTENT_KINDS.find(k => urlPath && urlPath.startsWith(`/img/${k}/`));
  if (!kind) return;
  const target = path.join(__dirname, '..', 'public', urlPath);
  if (!target.startsWith(contentDir(kind) + path.sep)) return;
  await fs.promises.unlink(target).catch(() => {});
};

const removeContentFolder = async (kind, id) => {
  if (!CONTENT_KINDS.includes(kind)) return;
  await deleteCloudinaryFolder(`${kind}/${id}`);
  const target = path.join(contentDir(kind), String(id));
  if (!target.startsWith(contentDir(kind) + path.sep)) return;
  await fs.promises.rm(target, { recursive: true, force: true });
};

/**
 * Store a verification document privately: as an authenticated file on Cloudinary, or in the private
 * dir without it. Returns what to save in the database, which is only ever read by the functions below.
 */
const savePrivateDocument = async (file, agencyId) => {
  if (isCloudinaryConfigured()) {
    return (await uploadPrivateFile(file.buffer, { folder: `verification/${agencyId}`, mimeType: file.mimetype })).ref;
  }
  const dir = path.join(PRIVATE_DOCS_DIR, String(agencyId));
  await ensureDir(dir);
  const ext = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.jpg';
  const filename = `${randomName()}${ext}`;
  await fs.promises.writeFile(path.join(dir, filename), file.buffer, { mode: 0o600 });
  return path.join(String(agencyId), filename);
};

// Absolute path of a private document on disk, refusing anything outside the private dir
const privateDocumentPath = relative => {
  const target = path.resolve(PRIVATE_DOCS_DIR, relative || '');
  if (!target.startsWith(PRIVATE_DOCS_DIR + path.sep)) return null;
  return target;
};

const hasPrivateDocument = stored => isPrivateRef(stored) || Boolean(stored && privateDocumentPath(stored));

// Send a private document to a viewer the route has already checked, with its headers already set
const sendPrivateDocument = (stored, res, next) => {
  const notFound = () => next(new AppError('Document not found.', 404));
  if (!isPrivateRef(stored)) {
    return res.sendFile(privateDocumentPath(stored), err => {
      if (err && !res.headersSent) notFound();
    });
  }
  return streamPrivateFile(stored, res).catch(err => {
    console.error('[CLOUDINARY] Private read failed:', err.message);
    if (res.headersSent) res.destroy();
    else notFound();
  });
};

const removePrivateDocument = async stored => {
  if (isPrivateRef(stored)) return deletePrivateFile(stored);
  const target = privateDocumentPath(stored);
  if (target) await fs.promises.unlink(target).catch(() => {});
};

// Copy a private document into another folder (an approved application's files become the agency's)
const copyPrivateDocument = async (stored, folder) => {
  if (isPrivateRef(stored)) {
    const mimeType = stored.startsWith('cloudinary:image:') ? 'image/jpeg' : 'application/pdf';
    return (await uploadPrivateFile(await downloadPrivateFile(stored), { folder: `verification/${folder}`, mimeType })).ref;
  }
  const source = privateDocumentPath(stored);
  if (!source) return null;
  const dir = path.join(PRIVATE_DOCS_DIR, String(folder));
  await ensureDir(dir);
  const filename = `${randomName()}${path.extname(source)}`;
  await fs.promises.copyFile(source, path.join(dir, filename));
  return path.join(String(folder), filename);
};

// Remove a whole private folder (used when an application is deleted)
const removePrivateFolder = async folder => {
  await deletePrivateFolder(`verification/${folder}`);
  const target = path.resolve(PRIVATE_DOCS_DIR, String(folder));
  if (!target.startsWith(PRIVATE_DOCS_DIR + path.sep)) return;
  await fs.promises.rm(target, { recursive: true, force: true });
};

module.exports = {
  imageUpload,
  documentUpload,
  userDocumentUpload,
  applicationUpload,
  agencyApplicationUpload,
  saveAgencyImage,
  removeAgencyImage,
  saveDestinationImage,
  removeDestinationImage,
  removeDestinationFolder,
  saveContentImage,
  removeContentImage,
  removeContentFolder,
  savePrivateDocument,
  hasPrivateDocument,
  sendPrivateDocument,
  removePrivateDocument,
  copyPrivateDocument,
  removePrivateFolder
};
