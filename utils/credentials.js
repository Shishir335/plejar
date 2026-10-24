const crypto = require('crypto');

// Letters and digits that can't be mistaken for each other when read from an email
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// A temporary password like "Kq7m-x3Tf-9pRw" (14 characters, about 71 bits)
const temporaryPassword = () => {
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
};

// The email the admin copies and sends to a vendor.
// kind 'new': a just-accepted agency; 'changed': Plezar set a new password on an existing account.
// temporary: they must choose their own at the next sign-in.
const credentialsEmail = ({ name, agencyName, email, password, loginURL, kind = 'new', temporary = true }) => {
  const opening = kind === 'new'
    ? `Good news: ${agencyName} has been accepted as a Plezar member agency.`
    : `Here are your new sign-in details for the ${agencyName} vendor panel on Plezar. Any password you used before no longer works.`;
  const closing = kind === 'new'
    ? ['From the panel you can create tour events, publish announcements, see who registered and send updates to your travelers.', '', 'Welcome aboard,']
    : ['If you did not ask for this, reply to this email straight away.', '', 'Thanks,'];
  return {
    subject: kind === 'new' ? `Your Plezar vendor account for ${agencyName}` : `Your new Plezar sign-in details (${agencyName})`,
    body: [
      `Hi ${String(name || '').split(' ')[0] || 'there'},`,
      '',
      opening,
      '',
      'Sign in to your vendor panel here:',
      loginURL,
      '',
      `Email: ${email}`,
      `${temporary ? 'Temporary password' : 'Password'}: ${password}`,
      '',
      temporary ? 'You will be asked to choose your own password when you sign in.' : 'You can change it any time from the sign-in page with "Forgot your password?".',
      ...closing,
      'The Plezar team'
    ].join('\n')
  };
};

module.exports = { temporaryPassword, credentialsEmail };
