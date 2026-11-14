/**
 * Which payment gateways are switched on, and whether they take real money.
 *
 * A gateway is on once its credentials are in the environment (see .env.example). Payments are
 * real only with PAYMENTS_LIVE=true on a production server; anywhere else they go to the
 * gateways' sandboxes, so a dev or test server can never charge anyone.
 * BKASH_BASE_URL / SSLCOMMERZ_BASE_URL override the address (used by the tests).
 */
const isLive = () => process.env.NODE_ENV === 'production' && process.env.PAYMENTS_LIVE === 'true';

const bkash = () => {
  const c = {
    appKey: process.env.BKASH_APP_KEY,
    appSecret: process.env.BKASH_APP_SECRET,
    username: process.env.BKASH_USERNAME,
    password: process.env.BKASH_PASSWORD
  };
  if (!c.appKey || !c.appSecret || !c.username || !c.password) return null;
  const base = process.env.BKASH_BASE_URL || (isLive() ? 'https://tokenized.pay.bka.sh/v1.2.0-beta' : 'https://tokenized.sandbox.bka.sh/v1.2.0-beta');
  return { ...c, base: base.replace(/\/+$/, ''), sandbox: !isLive() };
};

const sslcommerz = () => {
  const c = { storeId: process.env.SSLCOMMERZ_STORE_ID, storePassword: process.env.SSLCOMMERZ_STORE_PASSWORD };
  if (!c.storeId || !c.storePassword) return null;
  const base = process.env.SSLCOMMERZ_BASE_URL || (isLive() ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com');
  return { ...c, base: base.replace(/\/+$/, ''), sandbox: !isLive() };
};

/** The gateways a vendor can pay with right now, in the order they're offered */
const enabledMethods = () => [bkash() && 'bkash', sslcommerz() && 'sslcommerz'].filter(Boolean);

module.exports = { isLive, bkash, sslcommerz, enabledMethods };
