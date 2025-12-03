require('dotenv').config();
const { Resend } = require('resend');
const { strings } = require('./strings.cjs');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@type.alfaoz.dev';

async function sendVerificationEmail(email, username, verificationCode) {
  try {
    console.log(`Attempting to send verification email to: ${email}`);
    console.log(`From: ${FROM_EMAIL}`);
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: strings.email.verification.subject,
      text: strings.email.verification.body(username, verificationCode)
    });
    console.log('Email sent successfully:', result);
    return true;
  } catch (error) {
    console.error('Failed to send verification email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
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
