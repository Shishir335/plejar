const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

// Check if Cloudinary credentials are validly supplied
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

// Initialize Cloudinary config
if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

/**
 * Upload a memory buffer stream directly to Cloudinary
 * Applies auto-format, auto-quality, and caps max width at 1600px to conserve free-tier credits.
 */
const uploadBufferToCloudinary = (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    // Refresh config if credentials were provided after startup
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });

    const uploadOptions = {
      folder: options.folder || 'plezar/uploads',
      resource_type: 'image',
      transformation: [
        { width: 1600, crop: 'limit' },
        { quality: 'auto', fetch_format: 'auto' }
      ],
      ...options
    };

    const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });

    uploadStream.end(buffer);
  });

/**
 * Helper to upload a multer file (memory buffer).
 * If Cloudinary is configured, uploads to Cloudinary CDN with optimization.
 * If not configured, gracefully falls back to local disk storage.
 */
const uploadMediaFile = async (file, { folder = 'plezar/uploads', localDir, localUrlPrefix } = {}) => {
  if (isCloudinaryConfigured()) {
    try {
      const result = await uploadBufferToCloudinary(file.buffer, { folder });
      return result.secure_url;
    } catch (err) {
      console.error('[Cloudinary Upload Error]', err.message);
      // Fallback to local storage if Cloudinary upload encounters an issue
    }
  }

  // Graceful local disk fallback
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
  const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const filename = `specimen-${cleanName}-${uniqueSuffix}${ext}`;
  const targetPath = path.join(localDir, filename);

  fs.writeFileSync(targetPath, file.buffer);
  return `${localUrlPrefix}/${filename}`;
};

/**
 * Extract public_id and delete image from Cloudinary if needed
 */
const deleteFromCloudinary = async (imageUrl) => {
  if (!imageUrl || !imageUrl.includes('cloudinary.com') || !isCloudinaryConfigured()) {
    return null;
  }

  try {
    // Cloudinary URLs: .../upload/(v12345/)?(folder/subfolder/public_id).(ext)
    const matches = imageUrl.match(/\/upload\/(?:v\d+\/)?([^.]+)/);
    if (matches && matches[1]) {
      const publicId = matches[1];
      return await cloudinary.uploader.destroy(publicId);
    }
  } catch (err) {
    console.error('[Cloudinary Delete Error]', err.message);
  }
  return null;
};

module.exports = {
  cloudinary,
  isCloudinaryConfigured,
  uploadBufferToCloudinary,
  uploadMediaFile,
  deleteFromCloudinary
};
