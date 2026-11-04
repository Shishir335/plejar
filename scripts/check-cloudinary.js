/**
 * Checks the CLOUDINARY_* settings in config.env. Public: uploads a tiny image and confirms its URL
 * opens. Private: uploads an image and a PDF, confirms they don't open without a signature but do
 * with one. Everything is deleted again.
 *   npm run check-cloudinary
 */
const path = require('path');
const sharp = require('sharp');
require('dotenv').config({ path: path.join(__dirname, '..', 'config.env') });
const { Writable } = require('stream');
const {
  cloudinary, configure, isCloudinaryConfigured, isCloudinaryUrl, uploadBufferToCloudinary, deleteFromCloudinary,
  uploadPrivateFile, streamPrivateFile, deletePrivateFolder
} = require('../utils/cloudinary');

// The URL without a signature, as someone guessing or leaking the ID would try it
const plainUrl = ref => {
  const [, resourceType, format, publicId] = ref.split(':');
  configure();
  return cloudinary.url(publicId, { type: 'authenticated', resource_type: resourceType, format: format === '-' ? undefined : format, secure: true });
};

const readThroughServer = async ref => {
  let bytes = 0;
  const res = new Writable({ write(chunk, _, done) { bytes += chunk.length; done(); } });
  res.setHeader = () => {};
  await streamPrivateFile(ref, res);
  return bytes;
};

const checkPrivate = async (label, buffer, mimeType) => {
  const { ref } = await uploadPrivateFile(buffer, { folder: 'connection-check', mimeType });
  const plain = await fetch(plainUrl(ref));
  console.log(`${label} plain URL blocked:`, plain.ok ? 'NO, IT OPENED' : `yes (HTTP ${plain.status})`);
  const bytes = await readThroughServer(ref);
  console.log(`${label} read with signature:`, `${bytes} bytes`);
  return !plain.ok && bytes === buffer.length;
};

(async () => {
  if (!isCloudinaryConfigured()) {
    console.error('Not set up: add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to config.env.');
    process.exit(1);
  }
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#1677ff' } }).jpeg().toBuffer();
  const saved = await uploadBufferToCloudinary(image, { folder: 'connection-check' });
  console.log('Uploaded:', saved.secure_url);
  const opened = await fetch(saved.secure_url);
  console.log('Opens:', opened.ok ? 'yes' : `no (HTTP ${opened.status})`);
  if (!isCloudinaryUrl(saved.secure_url)) throw new Error('The URL is not on the configured cloud name.');
  const deleted = await deleteFromCloudinary(saved.secure_url);
  console.log('Deleted:', deleted && deleted.result === 'ok' ? 'yes' : JSON.stringify(deleted));
  if (!opened.ok || !deleted || deleted.result !== 'ok') process.exit(1);

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const privateOk = [await checkPrivate('Private image', image, 'image/jpeg'), await checkPrivate('Private PDF', pdf, 'application/pdf')];
  await deletePrivateFolder('connection-check');
  if (privateOk.includes(false)) process.exit(1);
  console.log('Cloudinary is ready.');
})().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
