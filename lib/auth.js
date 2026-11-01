/* Password hashing (scrypt), server-side sessions, login rate limiting. */
const crypto = require('crypto');
const db = require('./db');

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 12) * 3600 * 1000;
const COOKIE = 'samex_sid';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const got = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(expected, got);
  } catch { return false; }
}
// Constant-ish time dummy check for unknown usernames
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'password_too_short';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'password_too_weak';
  return null;
}

/* ---- sessions: random token in an httpOnly cookie, only its SHA-256 stored ---- */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId, meta = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.insert('sessions', { id: sha(token), userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, ip: meta.ip || '', ua: (meta.ua || '').slice(0, 160) });
  return token;
}
function destroySession(token) { if (token) db.remove('sessions', sha(token)); }
function destroyUserSessions(userId) { db.removeWhere('sessions', (s) => s.userId === userId); }

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function cookieHeader(token, req) {
  const secure = process.env.COOKIE_SECURE === 'false' ? false : (process.env.COOKIE_SECURE === 'true' || req.headers['x-forwarded-proto'] === 'https');
  const parts = [`${COOKIE}=${token || ''}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  parts.push(token ? `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}` : 'Max-Age=0');
  return parts.join('; ');
}

/** Resolve the logged-in user, enforcing active user + active agency on every request. */
function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = db.get('sessions', sha(token));
  if (!s) return null;
  if (s.expiresAt < Date.now()) { db.remove('sessions', s.id); return null; }
  const u = db.get('users', s.userId);
  if (!u || !u.active) return null;
  if (u.role === 'agent') {
    const a = db.get('agencies', u.agencyId);
    if (!a || !a.active) return null;
  }
  return { user: u, token };
}

/* ---- login throttling: 5 failures / 15 min per username+ip ----
 * Stored in the database ("throttle" collection) so the lock is shared by every server instance (Vercel) and survives restarts. */
const LOCK_MS = 15 * 60 * 1000;
function throttleKey(username, ip) { return `${String(username).toLowerCase()}|${ip}`; }
function isThrottled(username, ip) {
  const a = db.get('throttle', throttleKey(username, ip));
  if (!a) return 0;
  if (a.until && a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 1000);
  return 0;
}
function recordFailure(username, ip) {
  const k = throttleKey(username, ip);
  let a = db.get('throttle', k);
  if (!a) a = db.insert('throttle', { id: k, count: 0, until: 0, at: Date.now() });
  if (a.until && a.until <= Date.now()) { a.until = 0; a.count = 0; }
  a.count += 1;
  a.at = Date.now();
  if (a.count >= 5) { a.until = Date.now() + LOCK_MS; a.count = 0; }
  db.persist();
}
function clearFailures(username, ip) { db.remove('throttle', throttleKey(username, ip)); }

function pruneSessions() {
  if (!db.ready()) return; // Redis mode: data is loaded per request; the daily maintenance prunes instead
  db.removeWhere('sessions', (s) => s.expiresAt < Date.now());
  db.removeWhere('throttle', (t) => (t.until || 0) < Date.now() && Date.now() - (t.at || 0) > LOCK_MS);
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, passwordProblem, createSession, destroySession,
  destroyUserSessions, currentUser, cookieHeader, parseCookies, isThrottled, recordFailure, clearFailures, pruneSessions, COOKIE };
