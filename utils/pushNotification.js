const fs = require('fs');
const path = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const User = require('../models/userModel');

let isInitialized = false;
let initError = null;

/**
 * Initializes the Firebase Admin SDK if not already initialized.
 * Supports:
 *  1. Path to JSON service account file via FIREBASE_SERVICE_ACCOUNT
 *  2. Raw JSON string via FIREBASE_SERVICE_ACCOUNT_JSON
 *  3. Individual environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
 */
function initFirebaseAdmin() {
  if (isInitialized) return true;
  if (getApps().length > 0) {
    isInitialized = true;
    return true;
  }

  try {
    let credential = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const resolvedPath = path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT);
      if (fs.existsSync(resolvedPath)) {
        const fileContent = fs.readFileSync(resolvedPath, 'utf8');
        credential = cert(JSON.parse(fileContent));
      } else {
        console.warn(`[Firebase Admin] Service account file not found at: ${resolvedPath}`);
      }
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      credential = cert(parsed);
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      credential = cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      });
    }

    if (credential) {
      initializeApp({ credential });
      isInitialized = true;
      console.log('[Firebase Admin] Successfully initialized for FCM push notifications.');
      return true;
    }

    initError = 'No Firebase service account configured in config.env (FIREBASE_SERVICE_ACCOUNT).';
    return false;
  } catch (err) {
    initError = err.message;
    console.warn(`[Firebase Admin] Initialization failed: ${err.message}`);
    return false;
  }
}

/**
 * Register or update an FCM token for a user.
 */
async function registerUserToken(userId, { token, device = '', platform = 'android' }) {
  if (!userId || !token) return false;
  const cleanToken = String(token).trim();
  if (!cleanToken) return false;

  const validPlatform = ['android', 'ios', 'web', 'other'].includes(platform) ? platform : 'android';

  await User.updateOne(
    { _id: userId },
    {
      $pull: { fcmTokens: { token: cleanToken } }
    }
  );

  await User.updateOne(
    { _id: userId },
    {
      $push: {
        fcmTokens: {
          $each: [{
            token: cleanToken,
            device: String(device || '').slice(0, 100),
            platform: validPlatform,
            updatedAt: new Date()
          }],
          $slice: -10 // Keep at most 10 devices per user
        }
      }
    }
  );

  return true;
}

/**
 * Remove an FCM token from a user (e.g. on logout).
 */
async function removeUserToken(userId, token) {
  if (!userId || !token) return false;
  await User.updateOne(
    { _id: userId },
    {
      $pull: { fcmTokens: { token: String(token).trim() } }
    }
  );
  return true;
}

/**
 * Sends a push notification to one or multiple users.
 *
 * @param {Object} options
 * @param {string|Array<string>} options.userIds - Recipient user ID(s)
 * @param {string} options.title - Notification title
 * @param {string} options.body - Notification body
 * @param {Object} [options.data] - Key/value payload (strings only)
 * @param {string} [options.imageUrl] - Optional image URL for rich notification
 * @returns {Promise<{ sent: number, failed: number }>}
 */
async function sendPushNotification({ userIds, title, body, data = {}, imageUrl = null }) {
  if (!initFirebaseAdmin()) {
    return { sent: 0, failed: 0, status: 'unconfigured', reason: initError };
  }

  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const cleanIds = ids.map(id => (id && id._id ? id._id : id)).filter(Boolean);
  if (!cleanIds.length) return { sent: 0, failed: 0 };

  const users = await User.find({
    _id: { $in: cleanIds },
    'fcmTokens.0': { $exists: true }
  }).select('fcmTokens').lean();

  const tokenList = [];
  const tokenToUserMap = new Map();

  users.forEach(u => {
    (u.fcmTokens || []).forEach(t => {
      if (t && t.token) {
        tokenList.push(t.token);
        tokenToUserMap.set(t.token, String(u._id));
      }
    });
  });

  const uniqueTokens = Array.from(new Set(tokenList));
  if (!uniqueTokens.length) return { sent: 0, failed: 0 };

  // All data values for FCM must be strings
  const stringifiedData = {};
  if (data && typeof data === 'object') {
    Object.entries(data).forEach(([key, val]) => {
      stringifiedData[key] = typeof val === 'string' ? val : JSON.stringify(val);
    });
  }

  const message = {
    tokens: uniqueTokens,
    notification: {
      title: String(title || 'Plejar Update'),
      body: String(body || ''),
      ...(imageUrl ? { imageUrl } : {})
    },
    data: stringifiedData,
    android: {
      priority: 'high',
      notification: {
        channelId: 'plezar_notifications',
        sound: 'default'
      }
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1
        }
      }
    }
  };

  try {
    const response = await getMessaging().sendEachForMulticast(message);
    const staleTokens = [];

    response.responses.forEach((resp, index) => {
      if (!resp.success && resp.error) {
        const errCode = resp.error.code;
        if (
          errCode === 'messaging/invalid-registration-token' ||
          errCode === 'messaging/registration-token-not-registered'
        ) {
          staleTokens.push(uniqueTokens[index]);
        }
      }
    });

    // Prune stale / unregistered tokens from DB
    if (staleTokens.length > 0) {
      await User.updateMany(
        { 'fcmTokens.token': { $in: staleTokens } },
        { $pull: { fcmTokens: { token: { $in: staleTokens } } } }
      ).catch(() => {});
    }

    return {
      sent: response.successCount,
      failed: response.failureCount,
      total: uniqueTokens.length
    };
  } catch (err) {
    console.error('[Firebase Push Notification Error]:', err.message);
    return { sent: 0, failed: uniqueTokens.length, error: err.message };
  }
}

module.exports = {
  initFirebaseAdmin,
  registerUserToken,
  removeUserToken,
  sendPushNotification
};
