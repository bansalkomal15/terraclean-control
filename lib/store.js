'use strict';
/* ---------------------------------------------------------------------------
   store.js — one small storage interface, two drivers.

   On Vercel the filesystem is thrown away after every request, so the database
   has to live elsewhere. The Redis driver talks to Upstash over plain HTTPS
   using fetch, which means no native modules and nothing to compile — the
   thing that most often breaks a serverless build.

   Locally (or in Docker) it falls back to a SQLite file.
--------------------------------------------------------------------------- */

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);

const DOC_KEY = 'tc:doc';

/* ---------------- Redis driver (Upstash REST) ---------------- */
async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!r.ok) throw new Error('storage error ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const out = await r.json();
  if (out.error) throw new Error('storage error: ' + out.error);
  return out.result;
}

/* Compare-and-set in one round trip, so two people saving at the same moment
   cannot overwrite one another. */
const CAS = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local ok, doc = pcall(cjson.decode, cur)
  if ok and tostring(doc.rev) ~= ARGV[1] then return -1 end
end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;

const redisDriver = {
  kind: 'redis',
  async init() { },
  async getDoc() {
    const raw = await redis(['GET', DOC_KEY]);
    return raw ? JSON.parse(raw) : null;
  },
  async setDoc(doc) { await redis(['SET', DOC_KEY, JSON.stringify(doc)]); return doc.rev; },
  async casDoc(expectedRev, doc) {
    const res = await redis(['EVAL', CAS, '1', DOC_KEY, String(expectedRev), JSON.stringify(doc)]);
    return Number(res) === 1;
  },
  async get(key) { const v = await redis(['GET', 'tc:' + key]); return v ? JSON.parse(v) : null; },
  async put(key, value, ttlSeconds) {
    const cmd = ['SET', 'tc:' + key, JSON.stringify(value)];
    if (ttlSeconds) cmd.push('EX', String(Math.round(ttlSeconds)));
    await redis(cmd);
  },
  async del(key) { await redis(['DEL', 'tc:' + key]); }
};

/* ---------------- SQLite driver (local and Docker) ---------------- */
function sqliteDriver() {
  const path = require('path');
  const fs = require('fs');
  let Database;
  try { Database = require('better-sqlite3'); }
  catch (e) {
    throw new Error(
      'No database configured.\n' +
      'For local use run `npm install` so better-sqlite3 is available,\n' +
      'or set KV_REST_API_URL and KV_REST_API_TOKEN to use Upstash Redis.'
    );
  }
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, 'terraclean.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc (id INTEGER PRIMARY KEY CHECK (id=1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv  (k TEXT PRIMARY KEY, v TEXT NOT NULL, expires INTEGER);
  `);
  const sweep = () => db.prepare('DELETE FROM kv WHERE expires IS NOT NULL AND expires < ?').run(Date.now());

  return {
    kind: 'sqlite',
    async init() { sweep(); },
    async getDoc() {
      const row = db.prepare('SELECT json FROM doc WHERE id = 1').get();
      return row ? JSON.parse(row.json) : null;
    },
    async setDoc(doc) {
      db.prepare('INSERT INTO doc (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json')
        .run(JSON.stringify(doc));
      return doc.rev;
    },
    async casDoc(expectedRev, doc) {
      const row = db.prepare('SELECT json FROM doc WHERE id = 1').get();
      if (row && JSON.parse(row.json).rev !== expectedRev) return false;
      db.prepare('INSERT INTO doc (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json')
        .run(JSON.stringify(doc));
      return true;
    },
    async get(key) {
      sweep();
      const row = db.prepare('SELECT v FROM kv WHERE k = ?').get(key);
      return row ? JSON.parse(row.v) : null;
    },
    async put(key, value, ttlSeconds) {
      db.prepare('INSERT INTO kv (k, v, expires) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, expires=excluded.expires')
        .run(key, JSON.stringify(value), ttlSeconds ? Date.now() + ttlSeconds * 1000 : null);
    },
    async del(key) { db.prepare('DELETE FROM kv WHERE k = ?').run(key); }
  };
}

let driver = null;
function store() {
  if (!driver) driver = USE_REDIS ? redisDriver : sqliteDriver();
  return driver;
}

/* ---------------- what the rest of the app uses ---------------- */
async function readDoc() {
  const s = store();
  let doc = await s.getDoc();
  if (!doc) {
    const state = require('../seed/seed')();
    doc = { rev: 1, state };
    await s.setDoc(doc);
    console.log('[store] seeded a fresh document (' + s.kind + ')');
  }
  return doc;
}
async function writeDoc(expectedRev, state) {
  const doc = { rev: expectedRev + 1, state };
  const ok = await store().casDoc(expectedRev, doc);
  return ok ? doc.rev : null;
}
async function forceWrite(state) {
  const cur = await readDoc();
  const doc = { rev: cur.rev + 1, state };
  await store().setDoc(doc);
  return doc.rev;
}
const kvGet = k => store().get(k);
const kvPut = (k, v, ttl) => store().put(k, v, ttl);
const kvDel = k => store().del(k);
const driverKind = () => store().kind;

module.exports = { readDoc, writeDoc, forceWrite, kvGet, kvPut, kvDel, driverKind, USE_REDIS };
