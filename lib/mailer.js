'use strict';
/* ---------------------------------------------------------------------------
   mailer.js — four ways to send, tried in order. All but SMTP are plain HTTPS
   calls, so they work from a serverless function with nothing to install.

   1. Brevo   — free, 300 a day, and lets you verify a single Gmail address as
                the sender. No domain needed, so this is the one to use first.
   2. Resend  — free, but without a verified domain it will only deliver to the
                address that owns the account.
   3. SMTP    — a normal mail server, e.g. Gmail with an app password.
   4. Console — prints the message to the server log so nothing is ever lost.
--------------------------------------------------------------------------- */

const BREVO_KEY = process.env.BREVO_API_KEY || '';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const HAS_SMTP = !!(process.env.SMTP_HOST && process.env.SMTP_USER);
const FROM_RAW = process.env.MAIL_FROM || 'Terra Clean <onboarding@resend.dev>';

/* accepts either "someone@x.com" or "Name <someone@x.com>" */
function parseFrom(raw) {
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(raw);
  if (m) return { name: m[1] || 'Terra Clean', email: m[2] };
  return { name: process.env.MAIL_FROM_NAME || 'Terra Clean', email: raw.trim() };
}
const FROM = parseFrom(FROM_RAW);

let smtp = null;
if (!BREVO_KEY && !RESEND_KEY && HAS_SMTP) {
  try {
    const nodemailer = require('nodemailer');
    smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: +(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || '') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  } catch (e) { console.log('[mail] nodemailer is not installed — falling back to the log'); }
}

const provider = BREVO_KEY ? 'brevo' : RESEND_KEY ? 'resend' : smtp ? 'smtp' : 'console';

function printIt(msg, why) {
  console.log('\n──────── email not sent (' + why + ') ────────');
  console.log('To:      ' + msg.to);
  console.log('Subject: ' + msg.subject);
  console.log(msg.text);
  console.log('────────────────────────────────────────────────\n');
}

async function send(msg) {
  if (!msg || !msg.to) return { sent: false, reason: 'no address on file' };

  if (BREVO_KEY) {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: FROM.name, email: FROM.email },
          to: [{ email: msg.to }],
          subject: msg.subject,
          textContent: msg.text
        })
      });
      if (r.ok) return { sent: true, via: 'brevo' };
      const detail = (await r.text()).slice(0, 300);
      console.log('[mail] Brevo refused the message:', detail);
      printIt(msg, 'Brevo refused it');
      return { sent: false, reason: 'brevo refused', detail: detail, hint: senderHint(detail) };
    } catch (e) {
      printIt(msg, 'Brevo unreachable');
      return { sent: false, reason: String(e.message) };
    }
  }

  if (RESEND_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_RAW, to: [msg.to], subject: msg.subject, text: msg.text })
      });
      if (r.ok) return { sent: true, via: 'resend' };
      const detail = (await r.text()).slice(0, 300);
      console.log('[mail] Resend refused the message:', detail);
      printIt(msg, 'Resend refused it');
      return {
        sent: false, reason: 'resend refused', detail: detail,
        hint: /testing emails|own email address|verify a domain/i.test(detail)
          ? 'Resend will only deliver to your own address until you verify a domain. Switch to Brevo, which allows a single verified Gmail sender.'
          : senderHint(detail)
      };
    } catch (e) {
      printIt(msg, 'Resend unreachable');
      return { sent: false, reason: String(e.message) };
    }
  }

  if (smtp) {
    try {
      await smtp.sendMail({ from: FROM_RAW, to: msg.to, subject: msg.subject, text: msg.text });
      return { sent: true, via: 'smtp' };
    } catch (e) {
      printIt(msg, 'SMTP failed');
      return { sent: false, reason: String(e.message) };
    }
  }

  printIt(msg, 'no mail service configured');
  return { sent: false, reason: 'no mail service', printed: true };
}

function senderHint(detail) {
  if (/sender|from|not valid|unrecognised|unrecognized/i.test(detail)) {
    return 'The From address has not been verified with the mail provider. Verify ' + FROM.email + ' as a sender, or change MAIL_FROM to an address you have verified.';
  }
  return null;
}

module.exports = { send: send, configured: provider !== 'console', provider: provider, from: FROM.email };
