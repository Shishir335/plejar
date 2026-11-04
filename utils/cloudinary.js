const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const cloudinary = require('cloudinary').v2;
const AppError = require('./appError');

/**
 * Public images and videos live on Cloudinary, because a host like Render wipes its disk on every
 * deploy. Without the three CLOUDINARY_* settings, utils/uploads.js and friends save to local disk,
 * which is fine for development. Once they are set a failed upload is an error: falling back to the
 * disk would look like it worked and then lose the file on the next deploy.
 *
 * Private files (identity documents, contracts, chat attachments) are stored as "authenticated":
 * their plain URLs don't open. The server fetches them with a signed URL and streams them to whoever
 * its own routes allow, so a signed URL never leaves this server.
 */

const isCloudinaryConfigured = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  return Boolean(
    CLOUDINARY_CLOUD_NAME &&
    CLOUDINARY_API_KEY &&
    CLOUDINARY_API_SECRET &&
    !CLOUDINARY_CLOUD_NAME.includes('your_') &&
    !CLOUDINARY_API_KEY.includes('your_')
  );
};

const configure = () => cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const randomId = () => crypto.randomBytes(16).toString('hex');

// Development uploads stay apart from the live site's
const rootFolder = () => (process.env.NODE_ENV === 'production' ? 'plezar' : 'plezar-dev');
const cloudFolder = folder => `${rootFolder()}/${folder}`;

/** Upload a buffer. `folder` is relative to the root, such as "hotels/<id>". Returns Cloudinary's answer. */
const uploadBufferToCloudinary = (buffer, { folder, resourceType = 'image' }) => new Promise((resolve, reject) => {
  configure();
  // The folder goes in the ID, so deleting by prefix works in both of Cloudinary's folder modes
  const stream = cloudinary.uploader.upload_stream({ public_id: `${cloudFolder(folder)}/${randomId()}`, resource_type: resourceType }, (error, result) => {
    if (!error) return resolve(result);
    console.error('[CLOUDINARY] Upload failed:', error.message);
    reject(new AppError("That file couldn't be saved right now. Please try again.", 502));
  });
  stream.end(buffer);
});

const isCloudinaryUrl = url => {
  if (typeof url !== 'string' || !isCloudinaryConfigured()) return false;
  return url.startsWith(`https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/`);
};

/** Delete a file by its URL. Other URLs are ignored; a failure is logged, not thrown. */
const deleteFromCloudinary = async url => {
  if (!isCloudinaryUrl(url)) return null;
  // .../<image|video>/upload/v12345/<public id>.<ext>
  const match = url.match(/\/(image|video)\/upload\/(?:v\d+\/)?(.+)\.[^./]+$/);
  if (!match) return null;
  try {
    configure();
    return await cloudinary.uploader.destroy(match[2], { resource_type: match[1] });
  } catch (err) {
    console.error('[CLOUDINARY] Delete failed:', err.message);
    return null;
  }
};

/** Delete everything in a folder, when what owned it is deleted. */
const deleteCloudinaryFolder = async folder => {
  if (!isCloudinaryConfigured()) return;
  try {
    configure();
    await cloudinary.api.delete_resources_by_prefix(`${cloudFolder(folder)}/`);
  } catch (err) {
    console.error('[CLOUDINARY] Folder delete failed:', err.message);
  }
};

// ---------- Private files ----------

// What the database stores for a private file: cloudinary:<image|raw>:<format or ->:<public id>
const PRIVATE_REF = /^cloudinary:(image|raw):([a-z0-9]+|-):([\w/.-]+)$/;
const isPrivateRef = ref => typeof ref === 'string' && PRIVATE_REF.test(ref) && !ref.includes('..');

const parsePrivateRef = ref => {
  const [, resourceType, format, publicId] = ref.match(PRIVATE_REF);
  return { resourceType, format: format === '-' ? undefined : format, publicId };
};

/**
 * Store a private file. Images stay images; anything else (PDFs) is stored as raw, which isn't
 * affected by Cloudinary's PDF delivery setting and keeps its extension in the ID.
 */
const uploadPrivateFile = (buffer, { folder, mimeType }) => new Promise((resolve, reject) => {
  configure();
  const isImage = mimeType.startsWith('image/');
  const id = `${cloudFolder(`private/${folder}`)}/${randomId()}${isImage ? '' : '.pdf'}`;
  const stream = cloudinary.uploader.upload_stream({ public_id: id, type: 'authenticated', resource_type: isImage ? 'image' : 'raw' }, (error, result) => {
    if (error) {
      console.error('[CLOUDINARY] Private upload failed:', error.message);
      return reject(new AppError("That file couldn't be saved right now. Please try again.", 502));
    }
    resolve({ ref: `cloudinary:${result.resource_type}:${result.format || '-'}:${result.public_id}`, bytes: result.bytes, width: result.width, height: result.height });
  });
  stream.end(buffer);
});

// Only ever used by this server, never sent to a client
const signedUrl = ref => {
  configure();
  const { resourceType, format, publicId } = parsePrivateRef(ref);
  return cloudinary.url(publicId, { type: 'authenticated', resource_type: resourceType, format, sign_url: true, secure: true });
};

const fetchPrivateFile = async ref => {
  const response = await fetch(signedUrl(ref), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Cloudinary answered ${response.status}`);
  return response;
};

/** Send a private file down `res`, which already has its headers set. Throws if it can't be read. */
const streamPrivateFile = async (ref, res) => {
  const response = await fetchPrivateFile(ref);
  const length = response.headers.get('content-length');
  if (length) res.setHeader('Content-Length', length);
  await pipeline(Readable.fromWeb(response.body), res);
};

const downloadPrivateFile = async ref => Buffer.from(await (await fetchPrivateFile(ref)).arrayBuffer());

/** Delete a private file. A failure is logged, not thrown. */
const deletePrivateFile = async ref => {
  if (!isPrivateRef(ref)) return;
  const { resourceType, publicId } = parsePrivateRef(ref);
  try {
    configure();
    // Also from the CDN, so a deleted ID document is gone straight away
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: 'authenticated', invalidate: true });
  } catch (err) {
    console.error('[CLOUDINARY] Private delete failed:', err.message);
  }
};

/** Delete a whole private folder, such as an application's documents. */
const deletePrivateFolder = async folder => {
  if (!isCloudinaryConfigured()) return;
  const prefix = `${cloudFolder(`private/${folder}`)}/`;
  try {
    configure();
    await Promise.all(['image', 'raw'].map(resource_type => cloudinary.api.delete_resources_by_prefix(prefix, { resource_type, type: 'authenticated', invalidate: true })));
  } catch (err) {
    console.error('[CLOUDINARY] Private folder delete failed:', err.message);
  }
};

module.exports = {
  cloudinary,
  configure,
  isCloudinaryConfigured,
  isCloudinaryUrl,
  uploadBufferToCloudinary,
  deleteFromCloudinary,
  deleteCloudinaryFolder,
  isPrivateRef,
  uploadPrivateFile,
  streamPrivateFile,
  downloadPrivateFile,
  deletePrivateFile,
  deletePrivateFolder
};
