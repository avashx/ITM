/**
 * Email alert dispatch via Nodemailer SMTP. Disabled gracefully when SMTP is
 * not configured - alerts still reach the dashboard via Socket.io and are
 * stored in the Alert collection either way.
 */
const nodemailer = require('nodemailer');
const config = require('../config');
const log = require('../utils/logger')('mailer');

let transporter = null;

function getTransporter() {
  if (!config.mail.enabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user
        ? { user: config.mail.user, pass: config.mail.pass }
        : undefined,
    });
  }
  return transporter;
}

/**
 * Send an alert email. Returns { attempted, sent, error } which callers
 * persist onto the Alert document. Never throws.
 */
async function sendAlertEmail(subject, html) {
  const t = getTransporter();
  if (!t) {
    log.debug(`SMTP not configured - skipping email "${subject}"`);
    return { attempted: false, sent: false, error: '' };
  }
  try {
    await t.sendMail({
      from: config.mail.from,
      to: config.mail.to.join(', '),
      subject: `[IT Monitor] ${subject}`,
      html,
    });
    log.info(`Alert email sent: ${subject}`);
    return { attempted: true, sent: true, error: '' };
  } catch (err) {
    log.error(`Alert email failed: ${err.message}`);
    return { attempted: true, sent: false, error: err.message };
  }
}

/** Simple shared HTML wrapper for alert emails. */
function alertTemplate({ heading, lines, color = '#c0392b' }) {
  const rows = lines
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><strong>${v}</strong></td></tr>`
    )
    .join('');
  return `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px">
    <h2 style="color:${color};margin-bottom:4px">${heading}</h2>
    <table style="border-collapse:collapse;font-size:14px">${rows}</table>
    <p style="color:#999;font-size:12px;margin-top:16px">
      IT Monitor - GNCTD Service Health &amp; Grievance Intelligence Platform
    </p>
  </div>`;
}

module.exports = { sendAlertEmail, alertTemplate };
