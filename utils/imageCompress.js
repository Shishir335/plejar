const sharp = require('sharp');
const AppError = require('./appError');

/**
 * Every uploaded image goes through here before it is stored, so files stay small and still look good.
 *
 *  - Turned upright from the camera's orientation, then scaled down to fit the preset (never up).
 *  - Photos become WebP: at quality 80 it looks as good as or better than the JPEG at quality 82 the
 *    site used before, in roughly 10-30% fewer bytes (measured on 12 MP phone photos). Every browser
 *    and the Flutter app show WebP, and no email or PDF embeds uploaded pictures.
 *  - Transparency (logos, cut-outs) is kept, at full alpha quality, so it doesn't turn black.
 *  - Documents (ID cards, licenses) stay JPEG (mozjpeg) at 2400 px, because staff download and print them:
 *    a 2 MB phone photo of a licence comes out around 370 KB with every line of text still sharp.
 *  - Converted to sRGB, and camera metadata (including GPS location) is dropped.
 */

const PRESETS = {
  // Profile photos are cropped square, covers to a banner
  avatar: { width: 500, height: 500, fit: 'cover', quality: 82 },
  cover: { width: 1500, height: 500, fit: 'cover', quality: 80 },
  // Posts, chat photos, logos and package photos
  photo: { width: 1600, height: 1600, fit: 'inside', quality: 80 },
  // Hotel, destination and promotion pictures shown large
  large: { width: 2000, height: 2000, fit: 'inside', quality: 80 },
  // ID cards, trade licenses and contracts: JPEG at a higher resolution, so small print stays readable
  document: { width: 2400, height: 2400, fit: 'inside', quality: 80, format: 'jpeg' }
};

// Memory guard for small servers: refuse pictures over 60 megapixels (a 48 MP phone photo is fine),
// keep only a small cache, and limit how many threads each image uses.
const MAX_PIXELS = 60 * 1000 * 1000;
sharp.cache({ memory: 32, files: 0, items: 50 });
sharp.concurrency(Math.min(2, require('os').cpus().length || 1));

const unreadable = () => new AppError("That image couldn't be read. Try a different photo (JPG, PNG or WebP).", 400);

/**
 * Compress an image buffer. options: a PRESETS name, or { width, height, fit, quality, format, chroma }.
 * Returns { buffer, ext, mimeType, width, height, size }.
 */
const compressImage = async (input, options = 'photo') => {
  const o = { ...PRESETS.photo, ...(typeof options === 'string' ? PRESETS[options] : options) };
  let meta;
  try {
    meta = await sharp(input, { failOn: 'error', limitInputPixels: MAX_PIXELS }).metadata();
  } catch (err) {
    throw unreadable();
  }
  if ((meta.width || 0) * (meta.height || 0) > MAX_PIXELS) {
    throw new AppError('That photo is too large to process. Use one under 60 megapixels.', 400);
  }

  const base = () => sharp(input, { failOn: 'none', limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: o.width, height: o.height, fit: o.fit, position: 'attention', withoutEnlargement: true })
    .toColourspace('srgb');

  const jpeg = o.format === 'jpeg';
  // Only keep an alpha channel that is actually used (JPEG has none: transparency becomes white)
  let transparent = false;
  if (meta.hasAlpha && !jpeg) {
    const { isOpaque } = await sharp(input, { limitInputPixels: MAX_PIXELS }).stats();
    transparent = !isOpaque;
  }

  let out;
  try {
    if (jpeg) {
      out = await base()
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: o.quality, mozjpeg: true, chromaSubsampling: o.chroma || '4:2:0' })
        .toBuffer({ resolveWithObject: true });
    } else {
      const image = transparent ? base() : base().flatten({ background: '#ffffff' });
      out = await image.webp({ quality: o.quality, alphaQuality: 100, effort: 5, smartSubsample: true }).toBuffer({ resolveWithObject: true });
    }
  } catch (err) {
    throw unreadable();
  }

  const result = jpeg
    ? { buffer: out.data, ext: '.jpg', mimeType: 'image/jpeg' }
    : { buffer: out.data, ext: '.webp', mimeType: 'image/webp' };
  return { ...result, width: out.info.width, height: out.info.height, size: result.buffer.length };
};

const isImageType = mimeType => ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType);

module.exports = { compressImage, isImageType, PRESETS };
