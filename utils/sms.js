/**
 * Text messages to Bangladeshi mobile numbers.
 * Works with BulkSMSBD-style gateways: set SMS_API_URL, SMS_API_KEY and SMS_SENDER_ID in config.env.
 * Without them the message is only written to the server log, and sendSms reports it wasn't delivered.
 */
const smsConfigured = () => Boolean(process.env.SMS_API_URL && process.env.SMS_API_KEY);

const sendSms = async (number, message) => {
  const to = `88${String(number).replace(/^\+?88/, '')}`;
  if (!smsConfigured()) {
    console.log(`[SMS NOT SENT: no gateway configured] to ${to}: ${message}`);
    return { delivered: false };
  }
  const res = await fetch(process.env.SMS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: process.env.SMS_API_KEY, senderid: process.env.SMS_SENDER_ID || '', number: to, message })
  });
  if (!res.ok) throw new Error(`SMS gateway answered ${res.status}`);
  return { delivered: true };
};

module.exports = { sendSms, smsConfigured };
