const Email = require('./email');

/**
 * Create (or refresh) an invite token for a user, save it, and try to email the link.
 * Returns the link too, so an admin can share it another way if email isn't set up.
 * `approved: true` sends the "your application was accepted" wording instead of a plain invite.
 */
const sendInvite = async (user, agency, req, { approved = false } = {}) => {
  const token = user.createInviteToken();
  await user.save({ validateBeforeSave: false });

  const inviteURL = `${req.protocol}://${req.get('host')}/accept-invite?token=${token}`;

  let emailSent = false;
  try {
    const mail = new Email(user, inviteURL, { agencyName: agency ? agency.name : '' });
    await (approved ? mail.sendApplicationApproved() : mail.sendAgentInvite());
    emailSent = true;
  } catch (err) {
    console.warn(`[MAIL WARNING] Invite email to ${user.email} not sent:`, err.message);
  }

  return { inviteURL, emailSent };
};

module.exports = { sendInvite };
