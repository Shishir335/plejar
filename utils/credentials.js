const crypto = require('crypto');

// Letters and digits that can't be mistaken for each other when read from an email
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// A temporary password like "Kq7m-x3Tf-9pRw" (14 characters, about 71 bits)
const temporaryPassword = () => {
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
};

// The email the admin copies and sends to a newly accepted vendor
const credentialsEmail = ({ name, agencyName, email, password, loginURL }) => ({
  subject: `Your Plezar vendor account for ${agencyName}`,
  body: [
    `Hi ${String(name || '').split(' ')[0] || 'there'},`,
    '',
    `Good news: ${agencyName} has been accepted as a Plezar member agency.`,
    '',
    'Sign in to your vendor panel here:',
    loginURL,
    '',
    `Email: ${email}`,
    `Temporary password: ${password}`,
    '',
    'You will be asked to choose your own password the first time you sign in.',
    'From the panel you can create tour events, publish announcements, see who registered and send updates to your travelers.',
    '',
    'Welcome aboard,',
    'The Plezar team'
  ].join('\n')
});

module.exports = { temporaryPassword, credentialsEmail };
