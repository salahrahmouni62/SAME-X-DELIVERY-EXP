/* Production-mode tests: setup token, localhost binding, proxy IP handling, file permissions,
 * persistence across restarts (clean and crash), server backup/restore scripts.
 * Run: node test/prod.test.js */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'samex-prod-'));
const BACKUPS = fs.mkdtempSync(path.join(os.tmpdir(), 'samex-bk-'));
const PORT = 3200 + Math.floor(Math.random() * 500);
const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2';
const BASE = `http://127.0.0.1:${PORT}`;
let proc = null, passed = 0, failed = 0;
const out = [];

const env = (extra = {}) => ({ ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATA_DIR: DATA, TRUST_PROXY: 'true', COOKIE_SECURE: 'true', ...extra });
async function start(extra) {
  proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
}
async function stop(signal = 'SIGTERM') {
  if (!proc) return;
  const p = proc; proc = null;
  await new Promise((r) => { p.on('exit', r); p.kill(signal); });
}
async function test(name, fn) { try { await fn(); passed++; out.push('  ✔ ' + name); } catch (e) { failed++; out.push('  ✘ ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 3).join('\n      ')); } }
async function req(method, url, body, headers = {}) {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', 'X-Samex': '1', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data, cookie: (r.headers.get('set-cookie') || '').split(';')[0], headers: r.headers };
}

(async () => {
  await test('production without SETUP_TOKEN: web setup is locked', async () => {
    await start({ SETUP_TOKEN: '' });
    const s = await req('GET', '/api/setup-status'); assert.strictEqual(s.data.locked, true);
    const r = await req('POST', '/api/setup', { name: 'X', username: 'attacker', password: 'Attack2026', setupToken: '' });
    assert.strictEqual(r.status, 403); assert.strictEqual(r.data.error, 'setup_locked');
    await stop();
  });
  await test('server listens on 127.0.0.1 only (not reachable on other interfaces)', async () => {
    await start({ SETUP_TOKEN: TOKEN });
    const ifaces = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
    if (!ifaces.length) return; // no external interface in this sandbox: nothing more to check
    let reached = false;
    try { await fetch(`http://${ifaces[0].address}:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) }); reached = true; } catch {}
    assert.strictEqual(reached, false);
  });
  await test('setup with wrong token is refused, then locked after 5 tries', async () => {
    for (let i = 0; i < 4; i++) assert.strictEqual((await req('POST', '/api/setup', { name: 'X', username: 'attacker', password: 'Attack2026', setupToken: 'nope' })).data.error, 'invalid_setup_token');
    assert.strictEqual((await req('POST', '/api/setup', { name: 'X', username: 'attacker', password: 'Attack2026', setupToken: 'nope' })).status, 403);
    const r = await req('POST', '/api/setup', { name: 'X', username: 'attacker', password: 'Attack2026', setupToken: TOKEN });
    assert.strictEqual(r.status, 429, 'even the right token waits after 5 failures');
    await stop(); await start({ SETUP_TOKEN: TOKEN }); // lockout is in memory; restart for the next test
  });
  let cookie = '';
  await test('setup with the right token creates the supervisor; cookie is Secure+HttpOnly+SameSite', async () => {
    const r = await req('POST', '/api/setup', { name: 'Salah', username: 'salah', password: 'Samex2026!', setupToken: TOKEN, seedAgencies: true });
    assert.strictEqual(r.status, 200);
    const sc = r.headers.get('set-cookie'); assert(/HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Strict/.test(sc), sc);
    cookie = r.cookie;
    assert.strictEqual((await req('POST', '/api/setup', { name: 'X', username: 'y', password: 'Attack2026', setupToken: TOKEN })).status, 409);
  });
  await test('anti brute-force uses the IP set by Nginx (X-Real-IP); spoofed X-Forwarded-For is ignored', async () => {
    const fails = async (ip, spoof) => req('POST', '/api/login', { username: 'salah', password: 'bad' }, { 'X-Real-IP': ip, 'X-Forwarded-For': spoof });
    for (let i = 0; i < 5; i++) await fails('203.0.113.7', `198.51.100.${i}`); // attacker rotates the spoofable header
    assert.strictEqual((await fails('203.0.113.7', '198.51.100.99')).status, 429, 'rotation must not bypass the lockout');
    const legit = await req('POST', '/api/login', { username: 'salah', password: 'Samex2026!' }, { 'X-Real-IP': '41.111.22.33' });
    assert.strictEqual(legit.status, 200, 'the real supervisor on another IP is not locked out');
  });
  let leadId = '';
  await test('create a lead + interaction, then data survives a clean restart (SIGTERM)', async () => {
    const r = await req('POST', '/api/leads', { storeName: 'Boutique Persistante', phonePrimary: '0661 11 22 33', wilayaCode: '07' }, { Cookie: cookie });
    assert.strictEqual(r.status, 200); leadId = r.data.id;
    await req('POST', `/api/leads/${leadId}/notes`, { channel: 'WhatsApp', outcome: 'Interested', content: 'Test persistance' }, { Cookie: cookie });
    await stop('SIGTERM'); await start({ SETUP_TOKEN: TOKEN });
    const g = await req('GET', '/api/leads/' + leadId, null, { Cookie: cookie });
    assert.strictEqual(g.status, 200, 'session and lead survive restart'); assert.strictEqual(g.data.stage, 'INTERESTED');
  });
  await test('data survives a crash (SIGKILL ~300 ms after the write)', async () => {
    const r = await req('POST', '/api/leads', { storeName: 'Avant Crash' }, { Cookie: cookie });
    await new Promise((x) => setTimeout(x, 300));
    await stop('SIGKILL'); await start({ SETUP_TOKEN: TOKEN });
    assert.strictEqual((await req('GET', '/api/leads/' + r.data.id, null, { Cookie: cookie })).status, 200);
  });
  await test('database and snapshots are owner-only (700 / 600)', async () => {
    await req('POST', '/api/backups', {}, { Cookie: cookie });
    const mode = (p) => (fs.statSync(p).mode & 0o777).toString(8);
    assert.strictEqual(mode(DATA), '700'); assert.strictEqual(mode(path.join(DATA, 'samex-db.json')), '600');
    assert.strictEqual(mode(path.join(DATA, 'backups')), '700');
    for (const f of fs.readdirSync(path.join(DATA, 'backups'))) assert.strictEqual(mode(path.join(DATA, 'backups', f)), '600', f);
  });
  await test('health endpoint and security headers', async () => {
    const h = await req('GET', '/api/health'); assert.strictEqual(h.data.ok, true);
    const r = await fetch(BASE + '/'); assert(r.headers.get('content-security-policy')); assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  });
  await test('public JavaScript contains no secrets or user data', async () => {
    const js = (await (await fetch(BASE + '/app.js')).text()) + (await (await fetch(BASE + '/constants.js')).text()) + (await (await fetch(BASE + '/i18n.js')).text());
    for (const bad of ['Samex2026!', TOKEN, 'scrypt$', 'Boutique Persistante', 'salah']) assert(!js.includes(bad), 'leak: ' + bad);
  });
  await test('server backup script: archive created, 600, restorable', async () => {
    await stop('SIGTERM');
    const outp = execFileSync('bash', [path.join(ROOT, 'deploy/samex-backup')], { env: { ...process.env, DATA_DIR: DATA, BACKUP_DIR: BACKUPS } }).toString();
    assert(/Sauvegarde créée/.test(outp), outp);
    const files = fs.readdirSync(BACKUPS).filter((f) => f.endsWith('.tar.gz')); assert.strictEqual(files.length, 1);
    assert.strictEqual((fs.statSync(path.join(BACKUPS, files[0])).mode & 0o777).toString(8), '600');
    // Damage the database, then restore from the archive
    const archive = path.join(BACKUPS, files[0]);
    const db = JSON.parse(fs.readFileSync(path.join(DATA, 'samex-db.json'), 'utf8')); db.leads = []; fs.writeFileSync(path.join(DATA, 'samex-db.json'), JSON.stringify(db));
    await new Promise((r) => setTimeout(r, 1100)); // distinct timestamp for the safety backup
    execFileSync('bash', [path.join(ROOT, 'deploy/samex-restore'), archive], { input: 'OUI\n', env: { ...process.env, DATA_DIR: DATA, BACKUP_DIR: BACKUPS, NO_SYSTEMD: '1' } });
    const restored = JSON.parse(fs.readFileSync(path.join(DATA, 'samex-db.json'), 'utf8'));
    assert(restored.leads.some((l) => l.id === leadId), 'lead restored');
    assert.strictEqual(fs.readdirSync(BACKUPS).filter((f) => f.endsWith('.tar.gz')).length, 2, 'safety backup taken before restore');
    let refused = false;
    try { execFileSync('bash', [path.join(ROOT, 'deploy/samex-restore'), archive], { input: 'non\n', env: { ...process.env, DATA_DIR: DATA, BACKUP_DIR: BACKUPS, NO_SYSTEMD: '1' }, stdio: 'pipe' }); } catch { refused = true; }
    assert(refused, 'restore requires typing OUI');
    await start({ SETUP_TOKEN: TOKEN });
    assert.strictEqual((await req('GET', '/api/leads/' + leadId, null, { Cookie: cookie })).status, 200);
    await stop();
  });

  console.log(out.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  await stop();
  process.exit(failed ? 1 : 0);
})();
