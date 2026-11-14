/**
 * SSLCommerz (cards, mobile banking and internet banking), API v4:
 * open a session, send the payer to GatewayPageURL, and when SSLCommerz posts back (to the
 * success URL or the IPN) check the val_id with its validation API before trusting anything.
 */
const config = require('./config');

const TIMEOUT_MS = 30 * 1000;

class SslcommerzError extends Error {}

const settings = () => {
  const cfg = config.sslcommerz();
  if (!cfg) throw new SslcommerzError('SSLCommerz is not set up.');
  return cfg;
};

const getJson = async url => {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SslcommerzError(`SSLCommerz answered ${res.status}`);
  return data;
};

/**
 * Start a payment. urls: { success, fail, cancel, ipn }; customer: { name, email, phone }.
 * Returns { gatewayId, redirectUrl }
 */
exports.create = async ({ amount, invoice, urls, customer, product }) => {
  const cfg = settings();
  const form = new URLSearchParams({
    store_id: cfg.storeId,
    store_passwd: cfg.storePassword,
    total_amount: Number(amount).toFixed(2),
    currency: 'BDT',
    tran_id: invoice,
    success_url: urls.success,
    fail_url: urls.fail,
    cancel_url: urls.cancel,
    ipn_url: urls.ipn,
    cus_name: String(customer.name || 'Plejar vendor').slice(0, 50),
    cus_email: customer.email || 'payments@plejar.com',
    cus_phone: customer.phone || 'N/A',
    cus_add1: 'Bangladesh',
    cus_city: 'Dhaka',
    cus_postcode: '1000',
    cus_country: 'Bangladesh',
    shipping_method: 'NO',
    num_of_item: '1',
    product_name: String(product || 'Plejar ad').slice(0, 100),
    product_category: 'Advertising',
    product_profile: 'non-physical-goods'
  });
  const res = await fetch(`${cfg.base}/gwprocess/v4/api.php`, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await res.json().catch(() => ({}));
  if (data.status !== 'SUCCESS' || !data.GatewayPageURL) throw new SslcommerzError(data.failedreason || 'SSLCommerz could not start the payment.');
  return { gatewayId: data.sessionkey || '', redirectUrl: data.GatewayPageURL };
};

/** Ask SSLCommerz whether a val_id is a real, completed payment. Returns { paid, trxId, amount, currency, invoice, reason } */
exports.validate = async valId => {
  const cfg = settings();
  const q = new URLSearchParams({ val_id: valId, store_id: cfg.storeId, store_passwd: cfg.storePassword, format: 'json', v: '1' });
  const data = await getJson(`${cfg.base}/validator/api/validationserverAPI.php?${q}`);
  const paid = data.status === 'VALID' || data.status === 'VALIDATED';
  return {
    paid,
    trxId: data.bank_tran_id || '',
    amount: Number(data.amount),
    currency: data.currency || data.currency_type,
    invoice: data.tran_id,
    // SSLCommerz flags some card payments as risky; those wait for a person to look
    risky: String(data.risk_level) === '1',
    reason: paid ? '' : (data.status || 'Not valid')
  };
};

/** Send the money back. Returns { done, ref, reason }. SSLCommerz may take a while ("processing"). */
exports.refund = async ({ trxId, amount, reason, refundId }) => {
  const cfg = settings();
  const q = new URLSearchParams({
    bank_tran_id: trxId,
    refund_trans_id: refundId,
    refund_amount: Number(amount).toFixed(2),
    refund_remarks: String(reason || 'Refund').slice(0, 255),
    store_id: cfg.storeId,
    store_passwd: cfg.storePassword,
    format: 'json'
  });
  const data = await getJson(`${cfg.base}/validator/api/merchantTransIDvalidationAPI.php?${q}`);
  const done = data.APIConnect === 'DONE' && (data.status === 'success' || data.status === 'processing');
  return { done, ref: data.refund_ref_id || '', reason: done ? '' : (data.errorReason || data.APIConnect || 'Refund not accepted') };
};

exports.SslcommerzError = SslcommerzError;
