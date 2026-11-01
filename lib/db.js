/* Document store with two interchangeable back-ends behind the same synchronous in-memory API:
 *  - "file"  (VPS / Docker / local): JSON file with atomic writes + snapshot files            (default)
 *  - "redis" (Vercel): Upstash Redis over REST, when KV_REST_API_URL/_TOKEN (or UPSTASH_REDIS_REST_URL/_TOKEN) are set
 * Every API request runs inside `transaction()`. In Redis mode the transaction loads the current data (cached by
 * revision), runs the handler, then writes the collections that changed with an atomic compare-and-set on the
 * revision; if another server instance wrote in between, the request is replayed on fresh data. No write is lost.
 * Collections: agencies, users, leads, sessions, audit, throttle, meta. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const redis = require('./redis');

/* Storage mode, decided on first use (not at require time) from the environment of this process / deployment:
 *  'redis'        — a valid Upstash REST configuration was found (lib/redis.js)
 *  'unconfigured' — running on Vercel (no durable disk) without a valid Redis configuration: every API call fails
 *                   with a clear diagnostic instead of silently writing to a disk that disappears
 *  'file'         — everywhere else (VPS / Docker / local) */
let mode_ = null;
function mode() {
  if (mode_) return mode_;
  const onVercel = !!process.env.VERCEL;
  const r = redis.status();
  mode_ = r.configured ? 'redis' : onVercel ? 'unconfigured' : 'file';
  if (!onVercel && !r.configured && r.detected.some((d) => !d.empty) && r.problems.length)
    console.warn('[db] Variables Redis présentes mais invalides, stockage fichier utilisé : ' + r.problems.join(' '));
  return mode_;
}
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'samex-db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_SNAPSHOTS = Number(process.env.KEEP_SNAPSHOTS || 30);
const COLLECTIONS = ['agencies', 'users', 'leads', 'sessions', 'audit', 'throttle', 'meta'];
const APP_ID = 'samex-delivery-crm';
const PREFIX = (process.env.REDIS_PREFIX || 'samex') + ':';

let state = null;
let writeTimer = null;
let writing = Promise.resolve();

function empty() {
  const s = { version: 1 };
  COLLECTIONS.forEach((c) => (s[c] = []));
  return s;
}
const UNCONFIGURED_MSG = 'Stockage non configuré sur Vercel : ajoutez une base Upstash Redis (variables KV_REST_API_URL et KV_REST_API_TOKEN). Vercel n’a pas de disque durable.';
/** Error thrown by every API call while storage is unconfigured. `problems` / `detected` contain variable NAMES only. */
function unconfiguredError() {
  const r = redis.status();
  return Object.assign(new Error(UNCONFIGURED_MSG + ' Détail : ' + r.problems.join(' ')), { code: 'storage_not_configured', problems: r.problems, detected: r.detected.map((d) => d.name + (d.empty ? ' (vide)' : '')) });
}
/** One log line describing the storage of this instance (cold start). Never contains secret values. */
function describe() {
  const r = redis.status();
  const where = [process.env.VERCEL_ENV && 'environnement ' + process.env.VERCEL_ENV, process.env.VERCEL_GIT_COMMIT_SHA && 'commit ' + process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)].filter(Boolean).join(', ');
  if (mode() === 'redis') return `[db] Stockage : Upstash Redis (${r.source.url} / ${r.source.token})${where ? ' — ' + where : ''}`;
  if (mode() === 'file') return `[db] Stockage : fichier ${DB_FILE}`;
  return `[db] ${UNCONFIGURED_MSG}${where ? ' (' + where + ')' : ''}\n[db] Problème : ${r.problems.join(' ')}\n[db] Variables liées visibles par la fonction : ${r.detected.length ? r.detected.map((d) => d.name + (d.empty ? ' (vide)' : '')).join(', ') : 'aucune'}`;
}

/* ======================= file mode ======================= */
/* Data files hold password hashes and prospect data: owner-only permissions (dirs 700, files 600). */
function secure(p, mode) { try { fs.chmodSync(p, mode); } catch {} }
function load() {
  if (mode() === 'redis') { console.log(describe()); return null; } // loaded lazily, per request, by transaction()
  if (mode() === 'unconfigured') { console.error(describe()); return null; }
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  secure(DATA_DIR, 0o700); secure(BACKUP_DIR, 0o700);
  if (fs.existsSync(DB_FILE)) secure(DB_FILE, 0o600);
  fs.readdirSync(BACKUP_DIR).forEach((f) => secure(path.join(BACKUP_DIR, f), 0o600));
  if (fs.existsSync(DB_FILE)) {
    state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    COLLECTIONS.forEach((c) => (state[c] = state[c] || []));
  } else {
    state = empty();
    flushSync();
  }
  return state;
}

function flushSync() {
  const tmp = DB_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  const fd = fs.openSync(tmp, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } // survive power loss
  fs.renameSync(tmp, DB_FILE);
}

/** Marks the state as changed. File mode: debounced atomic write. Redis mode: written at the end of the transaction. */
function persist() {
  if (mode() !== 'file') return;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writing = writing.then(() => new Promise((resolve) => {
      try { flushSync(); } catch (e) { console.error('[db] write failed', e); }
      resolve();
    }));
  }, 50);
}

async function flush() {
  if (mode() !== 'file' || !state) return;
  clearTimeout(writeTimer);
  flushSync();
  await writing;
}

/* ======================= Redis mode ======================= */
const K = { rev: PREFIX + 'rev', col: (c) => PREFIX + 'col:' + c, snap: (n) => PREFIX + 'snap:' + n, snaps: PREFIX + 'snaps', snapSize: PREFIX + 'snapsize' };
/* Atomic compare-and-set: write the changed collections only if nobody else wrote since we read revision ARGV[1]. */
const COMMIT_LUA = `local cur = redis.call('GET', KEYS[1]) or '0'
if cur ~= ARGV[1] then return -1 end
for i = 2, #KEYS do redis.call('SET', KEYS[i], ARGV[i]) end
return redis.call('INCR', KEYS[1])`;

let loadedRev = null;   // revision of the cached state
let baseline = {};      // collection -> JSON as stored in Redis

async function refresh() {
  const rev = String((await redis.cmd(['GET', K.rev])) || '0');
  if (state && rev === loadedRev) return;
  const values = await redis.cmd(['MGET', K.rev, ...COLLECTIONS.map(K.col)]);
  state = empty();
  baseline = {};
  COLLECTIONS.forEach((c, i) => {
    const raw = values[i + 1];
    state[c] = raw ? JSON.parse(raw) : [];
    baseline[c] = raw || '[]';
  });
  loadedRev = String(values[0] || '0');
}

/* Requests on one instance run one at a time (state is shared in memory). */
let queue = Promise.resolve();
function exclusive(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/**
 * Run `fn` (an API request) atomically.
 * `commitOnError(e)`: when it returns true for a thrown error (e.g. a 401 after recording a failed login), the
 * changes made before the error are still saved, then the error is re-thrown.
 */
function transaction(fn, commitOnError = () => false) {
  if (mode() === 'unconfigured') return Promise.reject(unconfiguredError());
  if (mode() === 'file') return exclusive(fn);
  return exclusive(async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await refresh();
      let result, error, failed = false;
      try { result = await fn(); }
      catch (e) {
        if (!commitOnError(e)) { loadedRev = null; throw e; } // discard partial changes: reload next time
        failed = true; error = e;
      }
      const changed = {};
      for (const c of COLLECTIONS) { const json = JSON.stringify(state[c]); if (json !== baseline[c]) changed[c] = json; }
      const names = Object.keys(changed);
      if (names.length) {
        let rev;
        try {
          rev = await redis.cmd(['EVAL', COMMIT_LUA, names.length + 1, K.rev, ...names.map(K.col), loadedRev, ...names.map((c) => changed[c])]);
        } catch (e) { loadedRev = null; throw e; }
        if (Number(rev) === -1) { // another instance wrote first: replay this request on fresh data
          loadedRev = null;
          await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * (attempt + 1)));
          continue;
        }
        Object.assign(baseline, changed);
        loadedRev = String(rev);
      }
      if (failed) throw error;
      return result;
    }
    throw Object.assign(new Error('Trop d’écritures simultanées, réessayez.'), { code: 'write_conflict' });
  });
}

/* ======================= common API ======================= */
const id = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
function st() { if (!state) throw (mode() === 'unconfigured' ? unconfiguredError() : new Error('database not loaded')); return state; }
const ready = () => !!state;
const col = (name) => st()[name];
function find(name, pred) { return st()[name].filter(pred || (() => true)); }
function get(name, docId) { return st()[name].find((d) => d.id === docId) || null; }
function insert(name, doc) { st()[name].push(doc); persist(); return doc; }
function update(name, docId, patch) {
  const d = get(name, docId);
  if (!d) return null;
  Object.assign(d, patch);
  persist();
  return d;
}
function remove(name, docId) {
  const i = st()[name].findIndex((d) => d.id === docId);
  if (i < 0) return false;
  state[name].splice(i, 1);
  persist();
  return true;
}
function removeWhere(name, pred) {
  const before = st()[name].length;
  state[name] = state[name].filter((d) => !pred(d));
  if (state[name].length !== before) persist();
}
function replaceAll(data) {
  ['agencies', 'users', 'leads'].forEach((c) => (st()[c] = Array.isArray(data[c]) ? data[c] : []));
  state.sessions = [];
  state.throttle = [];
  persist();
}

/** True once per calendar day (UTC) — the caller then prunes sessions and takes the automatic snapshot. */
function dailyMaintenanceDue() {
  const today = new Date().toISOString().slice(0, 10);
  const m = get('meta', 'maintenance');
  if (m && m.day === today) return false;
  if (!st().users.length) return false; // nothing to back up before the first supervisor exists
  if (m) m.day = today; else insert('meta', { id: 'maintenance', day: today });
  persist();
  return true;
}

/* ---------- snapshots ---------- */
function snapshotData(reason) {
  return { app: APP_ID, version: 1, createdAt: new Date().toISOString(), reason, agencies: st().agencies, users: state.users, leads: state.leads };
}
async function snapshot(reason = 'auto') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `snapshot-${stamp}-${reason}.json`;
  const json = JSON.stringify(snapshotData(reason));
  if (mode() === 'redis') {
    await redis.cmd(['SET', K.snap(name), json]);
    await redis.cmd(['ZADD', K.snaps, Date.now(), name]);
    await redis.cmd(['HSET', K.snapSize, name, Buffer.byteLength(json)]);
    const old = await redis.cmd(['ZRANGE', K.snaps, 0, -(KEEP_SNAPSHOTS + 1)]);
    for (const n of old || []) {
      await redis.cmd(['DEL', K.snap(n)]); await redis.cmd(['ZREM', K.snaps, n]); await redis.cmd(['HDEL', K.snapSize, n]);
    }
    return name;
  }
  if (mode() !== 'file') throw unconfiguredError();
  fs.writeFileSync(path.join(BACKUP_DIR, name), json, { mode: 0o600 });
  fileSnapshots().slice(KEEP_SNAPSHOTS).forEach((f) => { try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch {} });
  return name;
}
function fileSnapshots() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => /^snapshot-.*\.json$/.test(f))
    .map((name) => ({ name, size: fs.statSync(path.join(BACKUP_DIR, name)).size, createdAt: fs.statSync(path.join(BACKUP_DIR, name)).mtime.toISOString() }))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}
async function listSnapshots() {
  if (mode() !== 'redis') return fileSnapshots();
  const flat = (await redis.cmd(['ZREVRANGE', K.snaps, 0, -1, 'WITHSCORES'])) || [];
  const sizes = flat.length ? await redis.cmd(['HMGET', K.snapSize, ...flat.filter((_, i) => i % 2 === 0)]) : [];
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ name: flat[i], size: Number(sizes[i / 2] || 0), createdAt: new Date(Number(flat[i + 1])).toISOString() });
  return out;
}
async function readSnapshot(name) {
  if (!/^snapshot-[\w-]+\.json$/.test(name)) return null;
  if (mode() === 'redis') { const raw = await redis.cmd(['GET', K.snap(name)]); return raw ? JSON.parse(raw) : null; }
  const f = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** File mode: also run the daily maintenance hourly, even when nobody uses the CRM. (Redis/Vercel: on the first request of the day.) */
function startAutoSnapshots() {
  if (mode() !== 'file') return null;
  const tick = () => transaction(async () => {
    if (dailyMaintenanceDue()) { removeWhere('sessions', (s) => s.expiresAt < Date.now()); await snapshot('auto'); }
  }).catch((e) => console.error('[db] snapshot failed', e));
  tick();
  return setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { get MODE() { return mode(); }, describe, APP_ID, load, flush, persist, transaction, ready, id, col, find, get, insert, update, remove, removeWhere, replaceAll,
  dailyMaintenanceDue, snapshot, listSnapshots, readSnapshot, startAutoSnapshots, DATA_DIR };
