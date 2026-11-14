/**
 * bKash Tokenized Checkout, one-off payments (mode 0011, no saved agreement):
 * grant a token, create a payment, send the payer to bkashURL, then execute it when bKash
 * sends them back to our callback. Refunds go back to the payer's bKash account.
 */
const config = require('./config');

const TIMEOUT_MS = 30 * 1000;
let token = null; // { value, until, key }

class BkashError extends Error {}

const post = async (cfg, path, body, headers) => {
  const res = await fetch(`${cfg.base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new BkashError(data.statusMessage || data.message || `bKash answered ${res.status}`);
  return data;
};

const settings = () => {
  const cfg = config.bkash();
  if (!cfg) throw new BkashError('bKash is not set up.');
  return cfg;
};

// A token lasts an hour; keep it until a minute before then
const grantToken = async cfg => {
  if (token && token.key === cfg.appKey && token.until > Date.now()) return token.value;
  const data = await post(cfg, '/tokenized/checkout/token/grant', { app_key: cfg.appKey, app_secret: cfg.appSecret }, { username: cfg.username, password: cfg.password });
  if (!data.id_token) throw new BkashError(data.statusMessage || 'bKash did not give a token.');
  token = { value: data.id_token, until: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000, key: cfg.appKey };
  return token.value;
};

const call = async (path, body) => {
  const cfg = settings();
  const idToken = await grantToken(cfg);
  return post(cfg, path, body, { Authorization: idToken, 'X-App-Key': cfg.appKey });
};

const money = amount => Number(amount).toFixed(2);

/** Start a payment. Returns { gatewayId, redirectUrl } */
exports.create = async ({ amount, invoice, payerReference, callbackURL }) => {
  const data = await call('/tokenized/checkout/create', {
    mode: '0011',
    payerReference: String(payerReference || invoice).slice(0, 50),
    callbackURL,
    amount: money(amount),
    currency: 'BDT',
    intent: 'sale',
    merchantInvoiceNumber: invoice
  });
  if (data.statusCode !== '0000' || !data.bkashURL || !data.paymentID) throw new BkashError(data.statusMessage || 'bKash could not start the payment.');
  return { gatewayId: data.paymentID, redirectUrl: data.bkashURL };
};

/**
 * Finish a payment after the payer approved it. Returns { paid, trxId, amount, reason }.
 * If the execute call fails on the way (a timeout), bKash's own record decides.
 */
exports.execute = async paymentID => {
  let data;
  try {
    data = await call('/tokenized/checkout/execute', { paymentID });
  } catch (err) {
    data = await call('/tokenized/checkout/payment/status', { paymentID });
  }
  const paid = data.transactionStatus === 'Completed' && Boolean(data.trxID);
  return { paid, trxId: data.trxID || '', amount: Number(data.amount), currency: data.currency, invoice: data.merchantInvoiceNumber, reason: paid ? '' : (data.statusMessage || data.transactionStatus || 'Not completed') };
};

/** Send the money back. Returns { done, ref, reason } */
exports.refund = async ({ gatewayId, trxId, amount, reason }) => {
  const data = await call('/tokenized/checkout/payment/refund', {
    paymentID: gatewayId,
    trxID: trxId,
    amount: money(amount),
    sku: 'ad',
    reason: String(reason || 'Refund').slice(0, 255)
  });
  const done = data.transactionStatus === 'Completed' && Boolean(data.refundTrxID);
  return { done, ref: data.refundTrxID || '', reason: done ? '' : (data.statusMessage || data.errorMessage || 'Refund not completed') };
};

exports.BkashError = BkashError;
// For the tests
exports.forgetToken = () => { token = null; };
