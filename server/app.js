'use strict';
try { require('dotenv').config(); } catch (e) { /* optional in production */ }

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const store = require('../lib/store');
const auth = require('../lib/auth');
const mailer = require('../lib/mailer');
const S = require('../lib/scope');

const PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: PROD ? '1h' : 0 }));

/* ---------- helpers ---------- */
const json = (res, code, body) => res.status(code).json(body);
/* keeps `next` intact so this can be used for middleware as well as handlers */
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
  console.error('[error]', err);
  if (!res.headersSent) json(res, 500, { error: err.message || 'Something went wrong on the server.' });
});
const cleanEmail = e => String(e || '').trim().toLowerCase();

/* a plain in-memory throttle; on serverless it resets often, which is why the
   codes themselves also count their own attempts */
const hits = new Map();
function throttle(key, limit, windowMs) {
  const t = Date.now();
  const rec = hits.get(key) || { n: 0, until: t + windowMs };
  if (t > rec.until) { rec.n = 0; rec.until = t + windowMs; }
  rec.n++; hits.set(key, rec);
  return rec.n <= limit;
}

async function currentUser(req) {
  const sess = await auth.readSession(req.cookies.tc_session);
  if (!sess) return null;
  const { state } = await store.readDoc();
  const person = S.personByEmail(state, sess.email);
  if (!person) return null;
  if (!S.maySignIn(state, person).ok) return null;
  return { person, state, email: sess.email };
}
const requireUser = wrap(async (req, res, next) => {
  const u = await currentUser(req);
  if (!u) return json(res, 401, { error: 'not signed in' });
  req.user = u.person; req.state = u.state; req.email = u.email;
  next();
});
function requireAdmin(req, res, next) {
  if (!S.isAdmin(req.user)) return json(res, 403, { error: 'administrators only' });
  next();
}
function setSessionCookie(res, token, days) {
  res.cookie('tc_session', token, {
    httpOnly: true, sameSite: 'lax', secure: PROD,
    maxAge: days * 86400000, path: '/'
  });
}
/* administrators sign in with a one-time code to their mailbox and never keep
   a password; everyone else sets their own password from an invite */
const usesCode = person => !!person.admin;

/* ===========================================================================
   SIGNING IN
=========================================================================== */

/* Step one: tell the browser which door this person goes through. */
app.post('/api/auth/start', wrap(async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!throttle('start:' + (req.ip || 'x'), 30, 15 * 60 * 1000)) {
    return json(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
  }
  const { state } = await store.readDoc();
  const person = S.personByEmail(state, email);
  const verdict = S.maySignIn(state, person);
  if (!verdict.ok) {
    return json(res, 403, {
      error: verdict.reason === 'not-in-directory'
        ? 'That email is not in the organisation directory. Ask the CEO to add you.'
        : 'Nothing has been assigned to you yet. Sign-in opens once a project, activity or task carries your name.'
    });
  }

  if (usesCode(person)) {
    if (!throttle('code:' + email, 5, 15 * 60 * 1000)) return json(res, 429, { error: 'Too many codes requested. Wait a few minutes.' });
    const { code, minutes } = await auth.issueCode(email);
    const out = await mailer.send({
      to: email,
      subject: 'Terra Clean — your sign-in code is ' + code,
      text: `Hello ${person.name},\n\nYour sign-in code is ${code}\n\nIt lasts ${minutes} minutes and works once.\nIf you did not ask for it, ignore this message.\n\n— Terra Clean control tower`
    });
    return json(res, 200, {
      mode: 'code', name: person.name, delivered: out.sent,
      hint: out.sent ? null : 'Mail is not set up yet, so the code was written to the server log instead.'
    });
  }

  const cred = await auth.getCredential(email);
  if (cred) return json(res, 200, { mode: 'password', name: person.name });

  const invited = await auth.hasInvite(email);
  return json(res, 200, {
    mode: 'invite', name: person.name, invited,
    hint: invited ? null : 'No invite code is waiting for you. Ask the CEO to issue one from the Organisation page.'
  });
}));

/* Administrators: the six-digit code. */
app.post('/api/auth/code', wrap(async (req, res) => {
  const email = cleanEmail(req.body.email);
  const { state } = await store.readDoc();
  const person = S.personByEmail(state, email);
  if (!person || !S.maySignIn(state, person).ok) return json(res, 403, { error: 'Not allowed to sign in.' });
  const check = await auth.checkCode(email, req.body.code);
  if (!check.ok) return json(res, 400, { error: check.error });
  const { token, days } = await auth.createSession(email);
  setSessionCookie(res, token, days);
  json(res, 200, { ok: true });
}));

/* Everyone else: email and the password they chose. */
app.post('/api/auth/password', wrap(async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!throttle('pw:' + email, 10, 15 * 60 * 1000)) return json(res, 429, { error: 'Too many attempts. Wait a few minutes.' });
  const { state } = await store.readDoc();
  const person = S.personByEmail(state, email);
  if (!person || !S.maySignIn(state, person).ok) return json(res, 403, { error: 'Not allowed to sign in.' });
  const cred = await auth.getCredential(email);
  if (!cred || !auth.verifyPassword(req.body.password, cred)) {
    return json(res, 400, { error: 'That email and password do not match.' });
  }
  const { token, days } = await auth.createSession(email);
  setSessionCookie(res, token, days);
  json(res, 200, { ok: true });
}));

/* First time in: invite code from the CEO, then choose a password. */
app.post('/api/auth/invite', wrap(async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!throttle('inv:' + email, 12, 30 * 60 * 1000)) return json(res, 429, { error: 'Too many attempts. Wait a few minutes.' });
  const { state } = await store.readDoc();
  const person = S.personByEmail(state, email);
  if (!person || !S.maySignIn(state, person).ok) return json(res, 403, { error: 'Not allowed to sign in.' });

  const check = await auth.checkInvite(email, req.body.invite);
  if (!check.ok) return json(res, 400, { error: check.error });

  const problem = auth.passwordProblem(req.body.password);
  if (problem) return json(res, 400, { error: problem });

  await auth.setCredential(email, req.body.password);
  await auth.clearInvite(email);
  const { token, days } = await auth.createSession(email);
  setSessionCookie(res, token, days);
  json(res, 200, { ok: true });
}));

/* Changing a password from inside the app. */
app.post('/api/auth/change-password', requireUser, wrap(async (req, res) => {
  if (usesCode(req.user)) return json(res, 400, { error: 'Your account signs in with a one-time code, so there is no password to change.' });
  const cred = await auth.getCredential(req.email);
  if (!cred || !auth.verifyPassword(req.body.current, cred)) return json(res, 400, { error: 'Your current password is not right.' });
  const problem = auth.passwordProblem(req.body.next);
  if (problem) return json(res, 400, { error: problem });
  await auth.setCredential(req.email, req.body.next);
  json(res, 200, { ok: true });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  await auth.endSession(req.cookies.tc_session);
  res.clearCookie('tc_session', { path: '/' });
  json(res, 200, { ok: true });
}));

app.get('/api/me', wrap(async (req, res) => {
  const u = await currentUser(req);
  if (!u) return json(res, 401, { error: 'not signed in' });
  json(res, 200, {
    id: u.person.id, name: u.person.name, email: u.person.email,
    admin: !!u.person.admin, usesCode: usesCode(u.person)
  });
}));

/* ---------- the CEO hands out invite codes ---------- */
app.post('/api/org/invite', requireUser, requireAdmin, wrap(async (req, res) => {
  const { state } = await store.readDoc();
  const target = S.personById(state, String(req.body.personId || ''));
  if (!target) return json(res, 404, { error: 'no such person' });
  if (!target.email) return json(res, 400, { error: 'Give them an email address first — that is their login.' });
  if (target.admin) return json(res, 400, { error: 'Administrators sign in with a one-time code, so they do not need an invite.' });

  const { code, days } = await auth.issueInvite(target.email);
  await auth.clearCredential(target.email);      /* also serves as a password reset */

  const out = await mailer.send({
    to: target.email,
    subject: 'Terra Clean control tower — your invite code',
    text: `Hello ${target.name},\n\nYou have been given access to the Terra Clean control tower.\n\n  Address:     ${process.env.APP_URL || 'the link your CEO sent you'}\n  Your login:  ${target.email}\n  Invite code: ${code}\n\nOpen the link, type your email, then enter the invite code and choose your own password. The code lasts ${days} days and is used once.\n\n— Terra Clean control tower`
  });
  json(res, 200, { code, days, emailed: out.sent });
}));

/* ===========================================================================
   STATE — reads are pruned, writes are merged. The browser never decides.
=========================================================================== */
app.get('/api/state', requireUser, wrap(async (req, res) => {
  const { rev, state } = await store.readDoc();
  json(res, 200, { rev, state: S.pruneForUser(state, req.user) });
}));

app.put('/api/state', requireUser, wrap(async (req, res) => {
  const clientRev = +req.body.rev;
  const incoming = req.body.state;
  if (!incoming || typeof incoming !== 'object') return json(res, 400, { error: 'no state supplied' });

  const { rev, state } = await store.readDoc();
  if (clientRev !== rev) {
    return json(res, 409, { error: 'stale', rev, state: S.pruneForUser(state, req.user) });
  }
  const merged = S.mergeForUser(state, incoming, req.user);
  const newRev = await store.writeDoc(rev, merged);
  if (newRev === null) {
    const fresh = await store.readDoc();
    return json(res, 409, { error: 'stale', rev: fresh.rev, state: S.pruneForUser(fresh.state, req.user) });
  }
  json(res, 200, { rev: newRev, state: S.pruneForUser(merged, req.user) });
}));

/* ---------- assignment notifications ---------- */
app.post('/api/notify', requireUser, wrap(async (req, res) => {
  const { state } = await store.readDoc();
  const target = S.personById(state, String(req.body.personId || ''));
  if (!target) return json(res, 404, { error: 'no such person' });
  if (!target.email) return json(res, 200, { sent: false, reason: 'no address on file' });

  const allowed = S.isAdmin(req.user) || target.id === req.user.id ||
    state.projects.some(p => p.head === req.user.id);
  if (!allowed) return json(res, 403, { error: 'not allowed to send that' });
  if (!throttle('mail:' + req.user.id, 60, 60 * 60 * 1000)) return json(res, 429, { error: 'Too many emails in the last hour.' });

  const out = await mailer.send({
    to: target.email,
    subject: String(req.body.subject || 'Terra Clean control tower').slice(0, 200),
    text: String(req.body.body || '').slice(0, 8000) + '\n\n' + (process.env.APP_URL || '')
  });
  json(res, 200, out);
}));

/* ---------- backup, restore, reset ---------- */
app.get('/api/export', requireUser, requireAdmin, wrap(async (req, res) => {
  const { rev, state } = await store.readDoc();
  res.setHeader('Content-Disposition', 'attachment; filename="terraclean-' + new Date().toISOString().slice(0, 10) + '.json"');
  json(res, 200, { rev, state });
}));
app.post('/api/import', requireUser, requireAdmin, wrap(async (req, res) => {
  const state = req.body.state;
  if (!state || !Array.isArray(state.projects) || !Array.isArray(state.org)) {
    return json(res, 400, { error: 'That does not look like a Terra Clean backup.' });
  }
  if (!state.org.some(p => p.admin && p.email)) {
    return json(res, 400, { error: 'That backup has no administrator with an email address — importing it would lock everyone out.' });
  }
  const rev = await store.forceWrite(state);
  json(res, 200, { rev, state: S.pruneForUser(state, req.user) });
}));
app.post('/api/reset', requireUser, requireAdmin, wrap(async (req, res) => {
  const fresh = require('../seed/seed')();
  const admin = fresh.org.find(p => p.admin);
  if (admin) admin.email = req.user.email;     /* keep whoever reset it able to get back in */
  const rev = await store.forceWrite(fresh);
  json(res, 200, { rev, state: S.pruneForUser(fresh, req.user) });
}));

app.get('/api/health', wrap(async (req, res) => {
  json(res, 200, { ok: true, storage: store.driverKind(), mail: mailer.configured });
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

module.exports = app;
