/* SAME X DELIVERY — CRM Prospection Expéditeurs
 * Zero-dependency Node.js server: static SPA + JSON API with server-side auth and role/agency isolation. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const db = require('./lib/db');
const auth = require('./lib/auth');
const L = require('./lib/leads');
const C = require('./lib/constants');
const files = require('./lib/files');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 2 * 1024 * 1024;
const MAX_BIG_BODY = 25 * 1024 * 1024;

db.load();
db.startAutoSnapshots();
setInterval(auth.pruneSessions, 30 * 60 * 1000).unref();

/* ---------------- helpers ---------------- */
class HttpError extends Error { constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra; } }
const fail = (status, code, extra) => { throw new HttpError(status, code, extra); };

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store',
    'Content-Type': isBuf || typeof body === 'string' ? headers['Content-Type'] || 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'payload_too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'invalid_json')); }
    });
    req.on('error', reject);
  });
}

/* Behind Nginx (TRUST_PROXY=true) the real client IP comes from X-Real-IP, which Nginx always overwrites,
 * or else the LAST X-Forwarded-For entry (the one Nginx appended). The first XFF entry is client-controlled. */
function clientIp(req) {
  if (process.env.TRUST_PROXY === 'true') {
    const real = String(req.headers['x-real-ip'] || '').trim();
    if (real) return real;
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return req.socket.remoteAddress || '';
}

/* First-run setup protection: in production the supervisor can only be created with the secret SETUP_TOKEN
 * generated on the server. Without a token in production, web setup is locked (use the admin CLI instead). */
const IS_PROD = process.env.NODE_ENV === 'production';
const SETUP_TOKEN = process.env.SETUP_TOKEN || '';
function checkSetupToken(given) {
  if (!SETUP_TOKEN) { if (IS_PROD) fail(403, 'setup_locked'); return; }
  const a = Buffer.from(String(given || '').trim()), b = Buffer.from(SETUP_TOKEN);
  if (a.length !== b.length || !require('crypto').timingSafeEqual(a, b)) fail(403, 'invalid_setup_token');
}

function audit(user, action, detail = '') {
  db.insert('audit', { id: db.id('a'), at: new Date().toISOString(), userId: user ? user.id : '', userName: user ? user.name : '', action, detail: String(detail).slice(0, 300) });
  const a = db.col('audit');
  if (a.length > 3000) a.splice(0, a.length - 3000);
}

/* Public representation of records — never leak password hashes */
const publicUser = (u) => u && ({ id: u.id, username: u.username, name: u.name, role: u.role, agencyId: u.agencyId || '', active: u.active, color: u.color || '', createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || '' });
const publicAgency = (a) => a && ({ id: a.id, name: a.name, code: a.code, wilayaCode: a.wilayaCode, wilayas: a.wilayas || [], color: a.color, active: a.active, address: a.address || '', phone: a.phone || '', createdAt: a.createdAt });

function requireUser(req) {
  const s = auth.currentUser(req);
  if (!s) fail(401, 'unauthenticated');
  return s.user;
}
function requireSupervisor(user) { if (user.role !== 'supervisor') fail(403, 'forbidden'); }

/** CSRF defence for state-changing requests: custom header + same-origin check (plus SameSite=Strict cookie). */
function checkCsrf(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers['x-samex'] !== '1') fail(403, 'csrf');
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host; // Nginx forwards the original Host header
    try { if (new URL(origin).host !== host) fail(403, 'csrf'); } catch (e) { if (e instanceof HttpError) throw e; fail(403, 'csrf'); }
  }
}

/* ---------------- domain actions ---------------- */
function touch(lead) { lead.updatedAt = new Date().toISOString(); }

function ownerAndAgency(user, requestedOwnerId) {
  if (user.role !== 'supervisor') return { ownerId: user.id, agencyId: user.agencyId };
  if (!requestedOwnerId || requestedOwnerId === user.id) return { ownerId: user.id, agencyId: '' };
  const owner = db.get('users', requestedOwnerId);
  if (!owner || !owner.active) fail(400, 'invalid_owner');
  if (owner.role === 'agent') {
    const ag = db.get('agencies', owner.agencyId);
    if (!ag || !ag.active) fail(400, 'agency_inactive');
  }
  return { ownerId: owner.id, agencyId: owner.role === 'agent' ? owner.agencyId : '' };
}

function createLead(user, input, extra = {}) {
  const body = L.cleanLeadFields(input, false);
  if (!body.storeName) fail(400, 'store_name_required');
  const { ownerId, agencyId } = ownerAndAgency(user, input.ownerId);
  const now = new Date().toISOString();
  const lead = { id: db.id('lead'), ...body, ownerId, agencyId, createdBy: user.id, discoveredAt: extra.discoveredAt || now, updatedAt: now,
    wonAt: body.stage === 'WON_EXPEDITEUR' ? now : '', notes: extra.notes || [] };
  if (lead.phonePrimary && lead.stage === 'NEW_DISCOVERED' && !extra.keepStage) lead.stage = 'ENRICHED';
  if (input.initialNote && String(input.initialNote).trim()) lead.notes.unshift(L.note(user, { channel: 'Internal Note', outcome: 'Note', content: input.initialNote }));
  if (!extra.notes) lead.notes.push(L.sysNote(user, `Prospect créé par ${user.name}.`));
  return db.insert('leads', lead);
}

function patchLead(user, lead, input) {
  const before = { ...lead };
  const body = L.cleanLeadFields(input, true);
  Object.assign(lead, body);
  const users = db.col('users');
  // Reassignment — supervisor only
  if (input.ownerId !== undefined && input.ownerId !== lead.ownerId) {
    if (user.role !== 'supervisor') fail(403, 'forbidden');
    const { ownerId, agencyId } = ownerAndAgency(user, input.ownerId);
    lead.ownerId = ownerId; lead.agencyId = agencyId;
    const name = (users.find((u) => u.id === ownerId) || {}).name || '';
    lead.notes.unshift(L.sysNote(user, `Prospect réaffecté à ${name}.`));
  }
  if (body.stage && body.stage !== before.stage) {
    lead.notes.unshift(L.sysNote(user, `Étape : ${before.stage} → ${body.stage}`));
    if (body.stage === 'WON_EXPEDITEUR') lead.wonAt = new Date().toISOString();
    else if (before.stage === 'WON_EXPEDITEUR') lead.wonAt = '';
  }
  if (body.priority && body.priority !== before.priority) lead.notes.unshift(L.sysNote(user, `Priorité : ${before.priority} → ${body.priority}`));
  if (body.nextFollowUpDate !== undefined && body.nextFollowUpDate !== before.nextFollowUpDate)
    lead.notes.unshift(L.sysNote(user, body.nextFollowUpDate ? `Relance planifiée le ${body.nextFollowUpDate}` : 'Relance retirée'));
  if (body.wilayaConfirmed !== undefined && body.wilayaConfirmed !== before.wilayaConfirmed)
    lead.notes.unshift(L.sysNote(user, body.wilayaConfirmed ? "Wilaya d'expédition confirmée." : "Wilaya d'expédition marquée NON CONFIRMÉE."));
  if (!lead.storeName) lead.storeName = before.storeName;
  touch(lead);
  db.persist();
  return lead;
}

/* ---------------- router ---------------- */
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, opts });
};

/* --- setup & auth --- */
route('GET', '/api/setup-status', () => ({ needsSetup: db.col('users').length === 0, tokenRequired: !!SETUP_TOKEN || IS_PROD, locked: IS_PROD && !SETUP_TOKEN }));
const RELEASE = (() => { try { return path.basename(fs.realpathSync(__dirname)); } catch { return ''; } })();
route('GET', '/api/health', () => ({ ok: true, release: RELEASE, uptime: Math.round(process.uptime()), time: new Date().toISOString() }));

const setupAttempts = { count: 0, until: 0 };
route('POST', '/api/setup', async (req, res, { body }) => {
  if (db.col('users').length) fail(409, 'already_setup');
  if (setupAttempts.until > Date.now()) fail(429, 'too_many_attempts', { retryAfter: Math.ceil((setupAttempts.until - Date.now()) / 1000) });
  try { checkSetupToken(body.setupToken); }
  catch (e) { if (e.code === 'invalid_setup_token' && ++setupAttempts.count >= 5) { setupAttempts.until = Date.now() + 15 * 60 * 1000; setupAttempts.count = 0; } throw e; }
  const name = L.STR(body.name, 80), username = L.STR(body.username, 40).toLowerCase();
  if (!name || !/^[a-z0-9._-]{3,40}$/.test(username)) fail(400, 'invalid_username');
  const p = auth.passwordProblem(body.password); if (p) fail(400, p);
  const now = new Date().toISOString();
  if (body.seedAgencies) {
    [['Hub Biskra', 'BSK', '07', ['07', '51']], ['Hub Alger', 'ALG', '16', ['16']]].forEach(([n, code, w, ws], i) =>
      db.insert('agencies', { id: db.id('ag'), name: n, code, wilayaCode: w, wilayas: ws, color: ['#FFC800', '#111111'][i], active: true, address: '', phone: '', createdAt: now }));
  }
  const u = db.insert('users', { id: db.id('u'), username, name, role: 'supervisor', agencyId: '', passwordHash: auth.hashPassword(body.password), active: true, color: '#FFC800', createdAt: now });
  audit(u, 'setup', 'Superviseur initial créé');
  const token = auth.createSession(u.id, { ip: clientIp(req), ua: req.headers['user-agent'] });
  return { status: 200, body: { user: publicUser(u) }, headers: { 'Set-Cookie': auth.cookieHeader(token, req) } };
});

route('POST', '/api/login', async (req, res, { body }) => {
  const username = L.STR(body.username, 40).toLowerCase();
  const ip = clientIp(req);
  const wait = auth.isThrottled(username, ip);
  if (wait) fail(429, 'too_many_attempts', { retryAfter: wait });
  const u = db.col('users').find((x) => x.username === username);
  const ok = auth.verifyPassword(body.password || '', u ? u.passwordHash : auth.DUMMY_HASH);
  if (!u || !ok) { auth.recordFailure(username, ip); audit(null, 'login_failed', username); fail(401, 'invalid_credentials'); }
  if (!u.active) fail(403, 'account_disabled');
  if (u.role === 'agent') { const a = db.get('agencies', u.agencyId); if (!a || !a.active) fail(403, 'agency_disabled'); }
  auth.clearFailures(username, ip);
  u.lastLoginAt = new Date().toISOString(); db.persist();
  audit(u, 'login');
  const token = auth.createSession(u.id, { ip, ua: req.headers['user-agent'] });
  return { status: 200, body: { user: publicUser(u) }, headers: { 'Set-Cookie': auth.cookieHeader(token, req) } };
});

route('POST', '/api/logout', async (req) => {
  const token = auth.parseCookies(req)[auth.COOKIE];
  auth.destroySession(token);
  return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': auth.cookieHeader('', req) } };
});

route('GET', '/api/me', (req) => {
  const user = requireUser(req);
  const agency = user.agencyId ? publicAgency(db.get('agencies', user.agencyId)) : null;
  return { user: publicUser(user), agency };
}, { auth: true });

route('POST', '/api/me/password', async (req, res, { body, user }) => {
  if (!auth.verifyPassword(body.currentPassword || '', user.passwordHash)) fail(400, 'wrong_current_password');
  const p = auth.passwordProblem(body.newPassword); if (p) fail(400, p);
  user.passwordHash = auth.hashPassword(body.newPassword);
  auth.destroyUserSessions(user.id);
  const token = auth.createSession(user.id, { ip: clientIp(req), ua: req.headers['user-agent'] });
  audit(user, 'password_changed');
  return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': auth.cookieHeader(token, req) } };
}, { auth: true });

/* --- reference data --- */
route('GET', '/api/directory', (req, res, { user }) => {
  // Agents see only their agency and themselves; supervisor sees everything
  if (user.role === 'supervisor') return { agencies: db.col('agencies').map(publicAgency), users: db.col('users').map(publicUser) };
  return { agencies: [publicAgency(db.get('agencies', user.agencyId))].filter(Boolean), users: [publicUser(user)] };
}, { auth: true });

/* --- agencies (supervisor) --- */
function cleanAgency(b, partial) {
  const o = {};
  const set = (k, v) => { if (!partial || b[k] !== undefined) o[k] = v; };
  set('name', L.STR(b.name, 80));
  set('code', L.STR(b.code, 12).toUpperCase());
  set('wilayaCode', C.WILAYAS.some((w) => w.code === b.wilayaCode) ? b.wilayaCode : '');
  set('wilayas', Array.isArray(b.wilayas) ? [...new Set(b.wilayas.filter((c) => C.WILAYAS.some((w) => w.code === c)))] : []);
  set('color', /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#FFC800');
  set('address', L.STR(b.address, 200));
  set('phone', C.normalizePhone(b.phone) || '');
  if (b.active !== undefined) o.active = b.active === true;
  return o;
}
route('POST', '/api/agencies', async (req, res, { user, body }) => {
  requireSupervisor(user);
  const a = cleanAgency(body, false);
  if (!a.name) fail(400, 'agency_name_required');
  if (!a.wilayaCode) fail(400, 'agency_wilaya_required');
  if (a.code && db.col('agencies').some((x) => x.code === a.code)) fail(409, 'agency_code_taken');
  if (!a.wilayas.length) a.wilayas = [a.wilayaCode];
  const doc = db.insert('agencies', { id: db.id('ag'), ...a, active: true, createdAt: new Date().toISOString() });
  audit(user, 'agency_created', doc.name);
  return publicAgency(doc);
}, { auth: true });
route('PATCH', '/api/agencies/:id', async (req, res, { user, body, params }) => {
  requireSupervisor(user);
  const a = db.get('agencies', params.id); if (!a) fail(404, 'not_found');
  const patch = cleanAgency(body, true);
  if (patch.name === '') fail(400, 'agency_name_required');
  if (patch.wilayaCode === '') delete patch.wilayaCode;
  if (patch.code && db.col('agencies').some((x) => x.code === patch.code && x.id !== a.id)) fail(409, 'agency_code_taken');
  Object.assign(a, patch); db.persist();
  if (patch.active === false) db.col('users').filter((u) => u.agencyId === a.id).forEach((u) => auth.destroyUserSessions(u.id));
  audit(user, patch.active === false ? 'agency_disabled' : 'agency_updated', a.name);
  return publicAgency(a);
}, { auth: true });

/* --- users (supervisor) --- */
route('POST', '/api/users', async (req, res, { user, body }) => {
  requireSupervisor(user);
  const username = L.STR(body.username, 40).toLowerCase();
  const name = L.STR(body.name, 80);
  if (!name) fail(400, 'name_required');
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail(400, 'invalid_username');
  if (db.col('users').some((u) => u.username === username)) fail(409, 'username_taken');
  const role = body.role === 'supervisor' ? 'supervisor' : 'agent';
  let agencyId = '';
  if (role === 'agent') { const a = db.get('agencies', body.agencyId); if (!a) fail(400, 'agency_required'); agencyId = a.id; }
  const p = auth.passwordProblem(body.password); if (p) fail(400, p);
  const doc = db.insert('users', { id: db.id('u'), username, name, role, agencyId, passwordHash: auth.hashPassword(body.password), active: true,
    color: /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#FFC800', createdAt: new Date().toISOString() });
  audit(user, 'user_created', `${name} (${role})`);
  return publicUser(doc);
}, { auth: true });
route('PATCH', '/api/users/:id', async (req, res, { user, body, params }) => {
  requireSupervisor(user);
  const u = db.get('users', params.id); if (!u) fail(404, 'not_found');
  const activeSupervisors = () => db.col('users').filter((x) => x.role === 'supervisor' && x.active);
  if (body.name !== undefined) { const n = L.STR(body.name, 80); if (!n) fail(400, 'name_required'); u.name = n; }
  if (body.username !== undefined) {
    const un = L.STR(body.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(un)) fail(400, 'invalid_username');
    if (db.col('users').some((x) => x.username === un && x.id !== u.id)) fail(409, 'username_taken');
    u.username = un;
  }
  if (body.role !== undefined) {
    const role = body.role === 'supervisor' ? 'supervisor' : 'agent';
    if (u.role === 'supervisor' && role === 'agent' && activeSupervisors().length <= 1) fail(400, 'last_supervisor');
    u.role = role;
  }
  if (body.agencyId !== undefined || u.role === 'agent') {
    if (u.role === 'agent') {
      const a = db.get('agencies', body.agencyId !== undefined ? body.agencyId : u.agencyId); if (!a) fail(400, 'agency_required');
      if (a.id !== u.agencyId) {
        // Move the agent's leads with them so isolation stays consistent
        db.col('leads').filter((l) => l.ownerId === u.id).forEach((l) => { l.agencyId = a.id; });
      }
      u.agencyId = a.id;
    } else u.agencyId = '';
  }
  if (body.active !== undefined) {
    if (body.active === false && u.id === user.id) fail(400, 'cannot_disable_self');
    if (body.active === false && u.role === 'supervisor' && activeSupervisors().length <= 1) fail(400, 'last_supervisor');
    u.active = body.active === true;
    if (!u.active) auth.destroyUserSessions(u.id);
  }
  if (body.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(body.color)) u.color = body.color;
  if (body.password) {
    const p = auth.passwordProblem(body.password); if (p) fail(400, p);
    u.passwordHash = auth.hashPassword(body.password);
    if (u.id !== user.id) auth.destroyUserSessions(u.id);
  }
  db.persist();
  audit(user, 'user_updated', u.name);
  return publicUser(u);
}, { auth: true });

/* --- leads --- */
route('GET', '/api/leads', (req, res, { user, query }) => {
  const leads = L.applyFilters(L.visibleLeads(user), query);
  return { leads, total: leads.length, today: L.today() };
}, { auth: true });
route('POST', '/api/leads', async (req, res, { user, body }) => createLead(user, body), { auth: true });
route('GET', '/api/leads/:id', (req, res, { user, params }) => {
  const l = db.get('leads', params.id);
  if (!L.canAccessLead(user, l)) fail(404, 'not_found'); // 404, not 403: don't reveal existence
  return l;
}, { auth: true });
route('PATCH', '/api/leads/:id', async (req, res, { user, params, body }) => {
  const l = db.get('leads', params.id);
  if (!L.canAccessLead(user, l)) fail(404, 'not_found');
  return patchLead(user, l, body);
}, { auth: true });
route('DELETE', '/api/leads/:id', async (req, res, { user, params }) => {
  const l = db.get('leads', params.id);
  if (!L.canAccessLead(user, l)) fail(404, 'not_found');
  db.remove('leads', l.id);
  audit(user, 'lead_deleted', l.storeName);
  return { ok: true };
}, { auth: true });
route('POST', '/api/leads/:id/notes', async (req, res, { user, params, body }) => {
  const l = db.get('leads', params.id);
  if (!L.canAccessLead(user, l)) fail(404, 'not_found');
  const n = L.note(user, body);
  if (!n.content) fail(400, 'note_required');
  l.notes.unshift(n);
  // Interaction outcomes can move the pipeline forward automatically
  const auto = { 'Interested': 'INTERESTED', 'Needs Price Sheet': 'INTERESTED', 'Agreed on Trial': 'TRIAL_DELIVERY', 'Not Interested': 'LOST' }[n.outcome];
  const order = C.STAGE_IDS;
  const patch = {};
  if (n.kind !== 'system' && n.channel !== 'Internal Note' && ['NEW_DISCOVERED', 'ENRICHED'].includes(l.stage)) patch.stage = 'CONTACTED';
  if (auto && body.autoStage !== false && (auto === 'LOST' || order.indexOf(auto) > order.indexOf(patch.stage || l.stage))) patch.stage = auto;
  if (body.nextFollowUpDate !== undefined) patch.nextFollowUpDate = body.nextFollowUpDate;
  if (Object.keys(patch).length) patchLead(user, l, patch); else { touch(l); db.persist(); }
  return l;
}, { auth: true });
route('POST', '/api/leads/bulk', async (req, res, { user, body }) => {
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 2000) : [];
  let n = 0;
  for (const id of ids) {
    const l = db.get('leads', id);
    if (!L.canAccessLead(user, l)) continue;
    if (body.action === 'delete') { db.remove('leads', id); n++; continue; }
    const patch = {};
    if (body.stage) patch.stage = body.stage;
    if (body.priority) patch.priority = body.priority;
    if (body.ownerId) patch.ownerId = body.ownerId;
    patchLead(user, l, patch); n++;
  }
  audit(user, 'bulk_' + (body.action || 'update'), `${n} prospects`);
  return { updated: n };
}, { auth: true });

/* --- stats --- */
route('GET', '/api/stats', (req, res, { user, query }) => L.stats(user, L.applyFilters(L.visibleLeads(user), query)), { auth: true });

/* --- export --- */
route('GET', '/api/export', (req, res, { user, query }) => {
  const leads = L.applyFilters(L.visibleLeads(user), query);
  const stamp = L.today();
  if (query.format === 'xlsx') {
    const s = L.stats(user, leads);
    const ag = db.col('agencies');
    const sheets = [
      { name: 'Prospects', headers: L.EXPORT_HEADERS, rows: L.exportRows(leads) },
      { name: 'Stats agents', headers: ['Agent', 'Rôle', 'Agence', 'Prospects', 'Numéro vérifié', 'Contactés', 'Gagnés', 'Gagnés ce mois', 'Conversion %', 'Conversion contactés %', 'Relances dues', 'En retard'],
        rows: s.byAgent.map((a) => [a.name, a.role, (ag.find((x) => x.id === a.agencyId) || {}).name || '', a.total, a.enriched, a.contacted, a.won, a.wonThisMonth, a.conversionRate, a.contactedConversionRate, a.dueToday, a.overdue]) },
      { name: 'Stats agences', headers: ['Agence', 'Code', 'Wilaya', 'Prospects', 'Numéro vérifié', 'Contactés', 'Gagnés', 'Gagnés ce mois', 'Conversion %', 'Conversion contactés %', 'Relances dues', 'En retard'],
        rows: s.byAgency.map((a) => [a.name || 'Non affecté (national)', a.code, a.wilayaCode || '', a.total, a.enriched, a.contacted, a.won, a.wonThisMonth, a.conversionRate, a.contactedConversionRate, a.dueToday, a.overdue]) },
    ];
    audit(user, 'export_xlsx', `${leads.length} prospects`);
    return { raw: files.toXLSX(sheets), headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="samex-prospects-${stamp}.xlsx"` } };
  }
  audit(user, 'export_csv', `${leads.length} prospects`);
  return { raw: files.toCSV(L.EXPORT_HEADERS, L.exportRows(leads)), headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="samex-prospects-${stamp}.csv"` } };
}, { auth: true });

/* --- import (JSON array / Swift export / CSV text) --- */
route('POST', '/api/import', async (req, res, { user, body }) => {
  let records = [];
  if (typeof body.csv === 'string') records = files.parseCSV(body.csv).map(L.rowFromCSV);
  else if (Array.isArray(body.records)) records = body.records;
  else if (body.records && Array.isArray(body.records.leads)) records = body.records.leads;
  else fail(400, 'import_format');
  if (records.length > 20000) fail(400, 'import_too_large');
  if (user.role === 'supervisor' && body.ownerId) ownerAndAgency(user, body.ownerId); // validates
  const existing = new Set(L.visibleLeads(user).map(L.dedupeKey));
  let created = 0, skipped = 0, invalid = 0;
  for (const raw of records) {
    if (!raw || typeof raw !== 'object') { invalid++; continue; }
    const { body: b, notes, discoveredAt } = L.normaliseImported(raw);
    if (!b.storeName) { invalid++; continue; }
    const key = L.dedupeKey(b);
    if (existing.has(key) && body.skipDuplicates !== false) { skipped++; continue; }
    existing.add(key);
    notes.unshift(L.sysNote(user, `Importé par ${user.name}.`));
    createLead(user, { ...b, ownerId: user.role === 'supervisor' ? body.ownerId || user.id : user.id }, { notes, discoveredAt, keepStage: true });
    created++;
  }
  audit(user, 'import', `${created} créés, ${skipped} doublons, ${invalid} invalides`);
  return { created, skipped, invalid };
}, { auth: true, big: true });

/* --- backup & restore (supervisor) --- */
route('GET', '/api/backup', (req, res, { user }) => {
  requireSupervisor(user);
  const data = { app: 'samex-delivery-crm', version: 1, createdAt: new Date().toISOString(), createdBy: user.name,
    agencies: db.col('agencies'), users: db.col('users'), leads: db.col('leads') };
  audit(user, 'backup_downloaded');
  return { raw: JSON.stringify(data, null, 1), headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="samex-backup-${L.today()}.json"` } };
}, { auth: true });
route('GET', '/api/backups', async (req, res, { user }) => { requireSupervisor(user); return { snapshots: await db.listSnapshots() }; }, { auth: true });
route('POST', '/api/backups', async (req, res, { user }) => { requireSupervisor(user); const name = await db.snapshot('manual'); audit(user, 'snapshot_created', name); return { name }; }, { auth: true });

function validateBackup(data) {
  if (!data || data.app !== 'samex-delivery-crm' || !Array.isArray(data.users) || !Array.isArray(data.leads) || !Array.isArray(data.agencies)) fail(400, 'backup_invalid');
  if (!data.users.some((u) => u.role === 'supervisor' && u.active && /^scrypt\$/.test(u.passwordHash || ''))) fail(400, 'backup_no_supervisor');
  for (const u of data.users) if (!u.id || !u.username || !/^scrypt\$/.test(u.passwordHash || '')) fail(400, 'backup_invalid');
}
async function restore(user, data, mode) {
  validateBackup(data);
  await db.snapshot('pre-restore');
  if (mode === 'merge') {
    let added = 0;
    for (const c of ['agencies', 'users', 'leads']) for (const d of data[c]) {
      if (!d.id || db.get(c, d.id)) continue;
      if (c === 'users' && db.col('users').some((u) => u.username === d.username)) continue;
      db.insert(c, d); added++;
    }
    audit(user, 'restore_merge', `${added} documents`);
    return { mode, added, loggedOut: false };
  }
  db.replaceAll(data);
  audit(user, 'restore_replace', `${data.leads.length} prospects`);
  return { mode: 'replace', leads: data.leads.length, loggedOut: true };
}
route('POST', '/api/restore', async (req, res, { user, body }) => {
  requireSupervisor(user);
  const result = await restore(user, body.data, body.mode === 'merge' ? 'merge' : 'replace');
  return result.loggedOut ? { status: 200, body: result, headers: { 'Set-Cookie': auth.cookieHeader('', req) } } : result;
}, { auth: true, big: true });
route('POST', '/api/backups/:name/restore', async (req, res, { user, params, body }) => {
  requireSupervisor(user);
  const data = await db.readSnapshot(params.name); if (!data) fail(404, 'not_found');
  const result = await restore(user, data, body.mode === 'merge' ? 'merge' : 'replace');
  return result.loggedOut ? { status: 200, body: result, headers: { 'Set-Cookie': auth.cookieHeader('', req) } } : result;
}, { auth: true });

route('GET', '/api/audit', (req, res, { user }) => { requireSupervisor(user); return { entries: db.col('audit').slice(-300).reverse() }; }, { auth: true });

/* ---------------- static files ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/constants.js') return serveFile(res, path.join(__dirname, 'lib', 'constants.js'));
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file);
  return serveFile(res, path.join(PUBLIC, 'index.html')); // SPA fallback
}
function serveFile(res, file) {
  const ext = path.extname(file);
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
  fs.createReadStream(file).pipe(res);
}

/* ---------------- server ---------------- */
const handler = async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
  try {
    const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
    if (!r) fail(404, 'not_found');
    checkCsrf(req);
    const m = pathname.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req, r.opts.big ? MAX_BIG_BODY : MAX_BODY) : {};
    const out = await db.transaction(async () => {
      if (db.dailyMaintenanceDue()) { auth.pruneSessions(); await db.snapshot('auto'); }
      const user = r.opts.auth ? requireUser(req) : null;
      return r.handler(req, res, { params, body, user, query: Object.fromEntries(url.searchParams) });
    }, (e) => e instanceof HttpError);
    if (out && out.raw !== undefined) return send(res, 200, Buffer.isBuffer(out.raw) ? out.raw : Buffer.from(out.raw), out.headers);
    if (out && out.status && out.body !== undefined) return send(res, out.status, out.body, out.headers);
    return send(res, 200, out === undefined ? { ok: true } : out);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.code, ...(e.extra || {}) }, e.status === 429 && e.extra ? { 'Retry-After': String(e.extra.retryAfter) } : {});
    console.error('[api]', req.method, pathname, e);
    return send(res, 500, { error: 'server_error' });
  }
};
const server = http.createServer(handler);

if (require.main === module) {
  // Listen on localhost only by default: in production Nginx is the only public entry point (HTTPS).
  const HOST = process.env.HOST || '127.0.0.1';
  server.listen(PORT, HOST, () => console.log(`SAME X DELIVERY CRM — http://${HOST}:${PORT}  (data: ${db.DATA_DIR}, mode: ${IS_PROD ? 'production' : 'development'})`));
  const stop = async () => { await db.flush(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
module.exports = server;
module.exports.handler = handler;
