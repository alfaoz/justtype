require('dotenv').config();
const { Resend } = require('resend');
const { strings } = require('./strings.cjs');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@yourdomain.com';

// Resend v6 does not throw when the API refuses a send (bad key, unverified
// domain, rate limit, network down): it resolves with { data, error }. So a
// send only counts when no error comes back, and every caller keeps getting
// a plain true or false, never a throw.
async function deliver(emailData, what) {
  try {
    const result = await resend.emails.send(emailData);
    const error = result ? result.error : { message: 'empty response' };
    if (error) {
      const code = error.statusCode ? ` (${error.statusCode})` : '';
      console.error(`Failed to send ${what}${code}:`, error.name || 'error', error.message || '');
      return false;
    }
    return true;
  } catch (error) {
    console.error(`Failed to send ${what}:`, error);
    return false;
  }
}

async function sendVerificationEmail(email, username, verificationCode) {
  return deliver({
    from: FROM_EMAIL,
    to: email,
    subject: strings.email.verification.subject,
    text: strings.email.verification.body(username, verificationCode)
  }, 'verification email');
}

async function sendPasswordResetEmail(email, username, resetCode) {
  return deliver({
    from: FROM_EMAIL,
    to: email,
    subject: strings.email.passwordReset.subject,
    text: strings.email.passwordReset.body(username, resetCode)
  }, 'password reset email');
}

async function sendEmail({ to, subject, text, html }) {
  const emailData = {
    from: FROM_EMAIL,
    to,
    subject
  };

  if (html) {
    emailData.html = html;
  } else if (text) {
    emailData.text = text;
  }

  return deliver(emailData, 'email');
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendEmail,
};
