'use strict';
/* Three ways to send, tried in order:
   1. Resend  — an HTTP API, so it works from a serverless function with no
                extra packages. This is the one to use on Vercel.
   2. SMTP    — for a normal server, if nodemailer is installed.
   3. Console — prints the message instead. Fine while you are setting up:
                the sign-in code appears in the Vercel logs.                   */

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.MAIL_FROM || 'Terra Clean <onboarding@resend.dev>';
const HAS_SMTP = !!(process.env.SMTP_HOST && process.env.SMTP_USER);

let smtp = null;
if (!RESEND_KEY && HAS_SMTP) {
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

function printIt(msg, why) {
  console.log('\n──────── email not sent (' + why + ') ────────');
  console.log('To:      ' + msg.to);
  console.log('Subject: ' + msg.subject);
  console.log(msg.text);
  console.log('────────────────────────────────────────────────\n');
}

async function send(msg) {
  if (!msg.to) return { sent: false, reason: 'no address' };

  if (RESEND_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [msg.to], subject: msg.subject, text: msg.text })
      });
      if (r.ok) return { sent: true, via: 'resend' };
      const detail = (await r.text()).slice(0, 300);
      console.log('[mail] Resend refused the message:', detail);
      printIt(msg, 'Resend refused it');
      return { sent: false, reason: 'resend refused', detail: detail };
    } catch (e) {
      printIt(msg, 'Resend unreachable');
      return { sent: false, reason: String(e.message) };
    }
  }

  if (smtp) {
    try { await smtp.sendMail({ from: FROM, to: msg.to, subject: msg.subject, text: msg.text }); return { sent: true, via: 'smtp' }; }
    catch (e) { printIt(msg, 'SMTP failed'); return { sent: false, reason: String(e.message) }; }
  }

  printIt(msg, 'no mail service configured');
  return { sent: false, reason: 'no mail service', printed: true };
}

module.exports = { send: send, configured: !!(RESEND_KEY || smtp) };
