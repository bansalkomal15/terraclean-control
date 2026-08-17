'use strict';
try { require('dotenv').config(); } catch (e) { /* optional in production */ }

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const store = require('../lib/store');
const auth = require('../lib/auth');
const mailer = require('../lib/mailer');
const S = require('../lib/scope');
const renumber = require('../lib/renumber');

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
/* How someone signs in is set per person under Organisation, and is separate
   from whether they are an administrator. A one-time code needs working email;
   a password needs only an invite code, which can be passed on by hand. */
const usesCode = person => (person.signin || (person.admin ? 'code' : 'password')) === 'code';

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
  if (usesCode(target)) return json(res, 400, { error: target.name + ' signs in with a one-time code. Switch them to Password under Organisation first if you want to issue an invite.' });

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
  let { rev, state } = await store.readDoc();
  /* Older documents carry the spreadsheet's roman numerals and lowercase
     letters. Put them right the first time an administrator opens the app —
     logged changes and CEO items follow their activity to the new code. */
  if (S.isAdmin(req.user) && renumber.needsRenumber(state)) {
    renumber.renumberAll(state);
    const newRev = await store.writeDoc(rev, state);
    if (newRev !== null) { rev = newRev; console.log('[renumber] codes cleaned up'); }
  }
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

  let text = String(req.body.body || '').slice(0, 8000);
  const link = process.env.APP_URL || '';
  let issued = null;

  /* Somebody being given work for the first time has no way in yet. Rather than
     make them wait for a separate invite, put the sign-in details in the same
     message — one email, and they can act on it straight away. */
  /* only worth sending sign-in details to somebody who can actually get in —
     the gate needs work assigned against their name first */
  if (!usesCode(target) && S.maySignIn(state, target).ok) {
    const hasPassword = !!(await auth.getCredential(target.email));
    if (!hasPassword) {
      if (await auth.hasInvite(target.email)) {
        text += '\n\n— Signing in —\n' + (link ? link + '\n' : '') +
          'Your login is ' + target.email + '. Use the invite code you were already sent; if you no longer have it, ask for a new one.';
      } else {
        const inv = await auth.issueInvite(target.email);
        issued = inv.code;
        text += '\n\n— Signing in for the first time —\n' +
          (link ? 'Open ' + link + '\n' : '') +
          'Your login:  ' + target.email + '\n' +
          'Invite code: ' + inv.code + '\n\n' +
          'Enter the code once and choose your own password. It lasts ' + inv.days + ' days.';
      }
    }
  }

  const subject = String(req.body.subject || 'Terra Clean control tower').slice(0, 200);
  const body = text + (link ? '\n\n' + link : '');

  /* Compose only: hand the finished message back so it can be opened in the
     sender's own mail app. Their mailbox does the sending, which is the one
     route a corporate filter will always trust. */
  if (req.body.compose) {
    return json(res, 200, { composed: true, to: target.email, subject, text: body, invite: issued });
  }

  const out = await mailer.send({ to: target.email, subject, text: body });
  json(res, 200, Object.assign({}, out, { invite: issued, provider: mailer.provider }));
}));

/* Send a test message, so email can be proved to work before it matters. */
app.post('/api/mail/test', requireUser, requireAdmin, wrap(async (req, res) => {
  const to = String(req.body.to || req.user.email || '').trim();
  if (!to) return json(res, 400, { error: 'Give an address to send to.' });
  if (!throttle('mailtest:' + req.user.id, 10, 60 * 60 * 1000)) return json(res, 429, { error: 'Too many test messages. Wait an hour.' });
  const out = await mailer.send({
    to,
    subject: 'Terra Clean control tower — test message',
    text: 'This is a test from the Terra Clean control tower.\n\nIf you are reading it, assignment emails and invite codes will reach this address.\n\nSent via ' + mailer.provider + ', from ' + mailer.from + '.\n' + (process.env.APP_URL || '')
  });
  json(res, 200, Object.assign({}, out, { provider: mailer.provider, from: mailer.from, to }));
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

/* A quick look under the bonnet — useful when something looks empty and you
   need to know whether the data is there at all. */
app.get('/api/health', wrap(async (req, res) => {
  let projects = null, wbsPresent = null;
  try {
    const { state } = await store.readDoc();
    projects = (state.projects || []).map(p => {
      let items = 0;
      S.walkAll(p, () => items++);
      return { name: p.name, packages: (p.packages || []).length, items };
    });
    wbsPresent = (state.standardTemplate || []).length;
  } catch (e) { projects = 'error: ' + e.message; }
  json(res, 200, {
    ok: true,
    storage: store.driverKind(),
    mail: mailer.configured,
    mailProvider: mailer.provider,
    mailFrom: mailer.from,
    standardTemplatePackages: wbsPresent,
    projects
  });
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

module.exports = app;
