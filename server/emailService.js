require('dotenv').config();
const { Resend } = require('resend');
const { strings } = require('./strings.cjs');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@yourdomain.com';

async function sendVerificationEmail(email, username, verificationCode) {
  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: strings.email.verification.subject,
      text: strings.email.verification.body(username, verificationCode)
    });
    return true;
  } catch (error) {
    console.error('Failed to send verification email:', error);
    return false;
  }
}

async function sendPasswordResetEmail(email, username, resetCode) {
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: strings.email.passwordReset.subject,
      text: strings.email.passwordReset.body(username, resetCode)
    });
    return true;
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return false;
  }
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
};
