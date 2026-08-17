'use strict';
const crypto = require('crypto');
const { kvGet, kvPut, kvDel } = require('./store');

/* Passwords are hashed with scrypt, which is built into Node — no native
   module to compile, and deliberately slow so a stolen hash is not worth
   much. Salt is per person; comparison is constant time. */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, key, algo: 'scrypt' };
}
function verifyPassword(password, rec) {
  if (!rec || !rec.salt || !rec.key) return false;
  const key = crypto.scryptSync(String(password), rec.salt, 64, { N: 16384, r: 8, p: 1 });
  const stored = Buffer.from(rec.key, 'hex');
  return key.length === stored.length && crypto.timingSafeEqual(key, stored);
}
function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 8) return 'Use at least 8 characters.';
  if (/^\d+$/.test(s)) return 'Use more than just numbers.';
  if (['password', '12345678', 'terraclean'].includes(s.toLowerCase())) return 'That password is too easy to guess.';
  return null;
}

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const sixDigits = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
/* invite codes avoid characters that are easy to misread aloud or in a message */
function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[crypto.randomInt(0, alphabet.length)];
  return s.slice(0, 4) + '-' + s.slice(4);
}
const normaliseCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* A password that can be read down a phone line without confusion, and still
   long enough to be sound: a word, a dash, four digits. */
const PW_WORDS = ['Solar', 'Turbine', 'Grid', 'Monsoon', 'Substation', 'Kilowatt',
  'Corridor', 'Bayside', 'Feeder', 'Tariff', 'Inverter', 'Transformer'];
function generatePassword() {
  return PW_WORDS[crypto.randomInt(0, PW_WORDS.length)] + '-' +
    String(crypto.randomInt(1000, 10000));
}

const key = {
  cred: e => 'cred:' + e,
  code: e => 'code:' + e,
  invite: e => 'invite:' + e,
  session: t => 'sess:' + t
};

/* ---------- credentials ---------- */
const getCredential = email => kvGet(key.cred(email));
const setCredential = (email, password) => kvPut(key.cred(email), Object.assign(hashPassword(password), { setAt: Date.now() }));
const clearCredential = email => kvDel(key.cred(email));

/* ---------- one-time email codes (used by administrators) ---------- */
const CODE_TTL_MIN = 10;
async function issueCode(email) {
  const code = sixDigits();
  await kvPut(key.code(email), { hash: sha(code), expires: Date.now() + CODE_TTL_MIN * 60000, attempts: 0 }, CODE_TTL_MIN * 60);
  return { code, minutes: CODE_TTL_MIN };
}
async function checkCode(email, code) {
  const rec = await kvGet(key.code(email));
  if (!rec || rec.expires < Date.now()) return { ok: false, error: 'That code has expired. Ask for a new one.' };
  if (rec.attempts >= 5) return { ok: false, error: 'Too many wrong codes. Ask for a new one.' };
  if (rec.hash !== sha(String(code).trim())) {
    rec.attempts++;
    await kvPut(key.code(email), rec, CODE_TTL_MIN * 60);
    return { ok: false, error: 'That code is not right.' };
  }
  await kvDel(key.code(email));
  return { ok: true };
}

/* ---------- invite codes (how everyone else gets their first password) ---------- */
const INVITE_TTL_DAYS = 14;
async function issueInvite(email) {
  const code = inviteCode();
  await kvPut(key.invite(email), { hash: sha(normaliseCode(code)), expires: Date.now() + INVITE_TTL_DAYS * 86400000, attempts: 0 },
    INVITE_TTL_DAYS * 86400);
  return { code, days: INVITE_TTL_DAYS };
}
async function checkInvite(email, code) {
  const rec = await kvGet(key.invite(email));
  if (!rec || rec.expires < Date.now()) return { ok: false, error: 'That invite code has expired. Ask the CEO for a new one.' };
  if (rec.attempts >= 8) return { ok: false, error: 'Too many attempts. Ask the CEO for a new invite code.' };
  if (rec.hash !== sha(normaliseCode(code))) {
    rec.attempts++;
    await kvPut(key.invite(email), rec, INVITE_TTL_DAYS * 86400);
    return { ok: false, error: 'That invite code is not right.' };
  }
  return { ok: true };
}
const clearInvite = email => kvDel(key.invite(email));
const hasInvite = async email => {
  const rec = await kvGet(key.invite(email));
  return !!(rec && rec.expires > Date.now());
};

/* ---------- sessions ---------- */
const SESSION_DAYS = 14;
async function createSession(email) {
  const token = crypto.randomBytes(32).toString('hex');
  await kvPut(key.session(sha(token)), { email, expires: Date.now() + SESSION_DAYS * 86400000 }, SESSION_DAYS * 86400);
  return { token, days: SESSION_DAYS };
}
async function readSession(token) {
  if (!token) return null;
  const rec = await kvGet(key.session(sha(token)));
  if (!rec || rec.expires < Date.now()) return null;
  return rec;
}
const endSession = token => token ? kvDel(key.session(sha(token))) : Promise.resolve();

module.exports = {
  hashPassword, verifyPassword, passwordProblem, generatePassword,
  getCredential, setCredential, clearCredential,
  issueCode, checkCode,
  issueInvite, checkInvite, clearInvite, hasInvite,
  createSession, readSession, endSession,
  SESSION_DAYS
};
