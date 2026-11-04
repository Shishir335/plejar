const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const AppError = require('./appError');
const { isCloudinaryConfigured, isPrivateRef, uploadPrivateFile, streamPrivateFile, deletePrivateFile, deletePrivateFolder } = require('./cloudinary');

// Photos and documents sent in chats. Authenticated on Cloudinary, or outside /public without it: only people in the chat can open them.

const CHAT_DIR = path.join(__dirname, '..', 'uploads', 'private', 'chat');
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const FILE_TYPES = ['application/pdf'];
const MAX_FILES = 4;
const MAX_SIZE = 5 * 1024 * 1024;

const chatUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if ([...IMAGE_TYPES, ...FILE_TYPES].includes(file.mimetype)) return cb(null, true);
    cb(new AppError('You can send photos (JPG, PNG, WebP) and PDF files.', 400), false);
  },
  limits: { fileSize: MAX_SIZE, files: MAX_FILES }
}).array('files', MAX_FILES);

const roomDir = roomId => path.join(CHAT_DIR, String(roomId));

/** Save one upload for a room. Photos are resized; PDFs are kept as they are. */
const saveChatFile = async (file, roomId) => {
  const name = String(file.originalname || '').slice(0, 150);
  const isImage = IMAGE_TYPES.includes(file.mimetype);
  const photo = isImage && sharp(file.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 });
  if (isCloudinaryConfigured()) {
    if (!isImage) {
      const saved = await uploadPrivateFile(file.buffer, { folder: `chat/${roomId}`, mimeType: file.mimetype });
      return { kind: 'file', file: saved.ref, name, mimeType: file.mimetype, size: file.size };
    }
    const { data, info } = await photo.toBuffer({ resolveWithObject: true });
    const saved = await uploadPrivateFile(data, { folder: `chat/${roomId}`, mimeType: 'image/jpeg' });
    return { kind: 'image', file: saved.ref, name, mimeType: 'image/jpeg', size: info.size, width: info.width, height: info.height };
  }
  const dir = roomDir(roomId);
  await fs.promises.mkdir(dir, { recursive: true });
  const base = crypto.randomBytes(12).toString('hex');
  if (isImage) {
    const filename = `${base}.jpg`;
    const info = await photo.toFile(path.join(dir, filename));
    return { kind: 'image', file: `${roomId}/${filename}`, name, mimeType: 'image/jpeg', size: info.size, width: info.width, height: info.height };
  }
  const filename = `${base}.pdf`;
  await fs.promises.writeFile(path.join(dir, filename), file.buffer, { mode: 0o600 });
  return { kind: 'file', file: `${roomId}/${filename}`, name, mimeType: file.mimetype, size: file.size };
};

/** Absolute path of a stored chat file, or null if the name tries to leave the chat folder */
const chatFilePath = relative => {
  const target = path.resolve(CHAT_DIR, relative || '');
  return target.startsWith(CHAT_DIR + path.sep) ? target : null;
};

const hasChatFile = stored => {
  if (isPrivateRef(stored)) return true;
  const target = chatFilePath(stored);
  return Boolean(target && fs.existsSync(target));
};

/** Send a chat file to someone the route has already checked, with its headers already set */
const sendChatFile = async (stored, res) => {
  if (isPrivateRef(stored)) return streamPrivateFile(stored, res);
  fs.createReadStream(chatFilePath(stored)).pipe(res);
};

const removeChatFiles = files => Promise.all(files.map(f => {
  if (isPrivateRef(f.file)) return deletePrivateFile(f.file);
  const target = chatFilePath(f.file);
  return target ? fs.promises.unlink(target).catch(() => {}) : null;
}));

/** Everything sent in a chat, when the chat itself is deleted */
const removeChatFolder = async roomId => {
  await deletePrivateFolder(`chat/${roomId}`);
  const target = roomDir(roomId);
  if (target.startsWith(CHAT_DIR + path.sep)) await fs.promises.rm(target, { recursive: true, force: true });
};

module.exports = { chatUpload, saveChatFile, hasChatFile, sendChatFile, removeChatFiles, removeChatFolder, CHAT_DIR };
