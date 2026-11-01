/* Redis (Vercel) mode tests, against a local fake of the Upstash REST API shared by two server instances.
 * Run: node test/redis.test.js */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Readable } = require('stream');

const ROOT = path.join(__dirname, '..');
const RPORT = 4100 + Math.floor(Math.random() * 400);
const RTOKEN = 'test-token-' + Date.now();
const PORTS = [RPORT + 1000, RPORT + 1001, RPORT + 1002];
const EMPTY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'samex-redis-'));
const SETUP = 'f00dbabe12345678';
let redis, procs = [], passed = 0, failed = 0;
const out = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startRedis() {
  redis = spawn(process.execPath, [path.join(__dirname, 'fake-upstash.js'), String(RPORT), RTOKEN], { stdio: ['pipe', 'pipe', 'inherit'] });
  await new Promise((r) => redis.stdout.once('data', r));
}
async function startServer(port, extra = {}, probe = '/api/health') {
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), DATA_DIR: EMPTY_DIR, TRUST_PROXY: 'true', COOKIE_SECURE: 'true',
    SETUP_TOKEN: SETUP, KV_REST_API_URL: `http://127.0.0.1:${RPORT}`, KV_REST_API_TOKEN: RTOKEN, ...extra };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.logs = ''; p.stderr.on('data', (d) => (p.logs += d));
  procs.push(p);
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}${probe}`)).ok) return p; } catch {} await sleep(100); }
  throw new Error('server did not start\n' + p.logs);
}
async function test(name, fn) { try { await fn(); passed++; out.push('  ✔ ' + name); } catch (e) { failed++; out.push('  ✘ ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 4).join('\n      ')); } }
function client(port) {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Samex': '1', 'X-Real-IP': '10.0.0.9', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  };
  return { call, login: (username, password) => call('POST', '/api/login', { username, password }) };
}

(async () => {
  await startRedis();
  const [A, B] = [client(PORTS[0]), client(PORTS[1])];

  await test('two instances share one Redis database (setup on A, login on B)', async () => {
    await startServer(PORTS[0]); await startServer(PORTS[1]);
    const s = await A.call('POST', '/api/setup', { name: 'Superviseur', username: 'boss', password: 'Samex2026x', setupToken: SETUP, seedAgencies: true });
    assert.strictEqual(s.status, 200, JSON.stringify(s.data));
    const l = await B.login('boss', 'Samex2026x');
    assert.strictEqual(l.status, 200);
    assert.strictEqual((await B.call('GET', '/api/directory')).data.agencies.length, 2);
    assert.deepStrictEqual(fs.readdirSync(EMPTY_DIR), [], 'nothing is written to the (read-only on Vercel) disk');
  });

  await test('40 simultaneous writes spread over both instances: none is lost', async () => {
    await A.login('boss', 'Samex2026x');
    const jobs = [];
    for (let i = 0; i < 40; i++) jobs.push((i % 2 ? A : B).call('POST', '/api/leads', { storeName: `Boutique ${i}`, phonePrimary: `0550${String(100000 + i)}`, wilayaCode: '05' }));
    const res = await Promise.all(jobs);
    assert(res.every((r) => r.status === 200), res.map((r) => r.status).join(','));
    for (const C of [A, B]) assert.strictEqual((await C.call('GET', '/api/leads')).data.total, 40);
  });

  await test('login brute-force lock is shared between instances', async () => {
    for (let i = 0; i < 5; i++) assert.strictEqual((await (i % 2 ? A : B).login('boss', 'wrong-pass1')).status, 401);
    const r = await A.login('boss', 'Samex2026x');
    assert.strictEqual(r.status, 429, 'locked on A after failures on A and B');
    assert.strictEqual((await B.login('boss', 'Samex2026x')).status, 429);
  });

  await test('daily automatic snapshot + manual snapshot visible and restorable from the other instance', async () => {
    const C = client(PORTS[0]);
    // new session needs a fresh IP (the lock is per username + IP)
    const ok = await C.call('POST', '/api/login', { username: 'boss', password: 'Samex2026x' }, { 'X-Real-IP': '10.0.0.77' });
    assert.strictEqual(ok.status, 200);
    const D = { call: (m, u, b) => C.call(m, u, b, { 'X-Real-IP': '10.0.0.77' }) };
    const mk = await D.call('POST', '/api/backups');
    assert.strictEqual(mk.status, 200);
    const E = client(PORTS[1]);
    await E.call('POST', '/api/login', { username: 'boss', password: 'Samex2026x' }, { 'X-Real-IP': '10.0.0.78' });
    const list = (await E.call('GET', '/api/backups', null, { 'X-Real-IP': '10.0.0.78' })).data.snapshots;
    assert(list.some((s) => s.name === mk.data.name && s.size > 100), JSON.stringify(list));
    assert(list.some((s) => /-auto\.json$/.test(s.name)), 'automatic daily snapshot taken on first request of the day');
    await D.call('POST', '/api/leads', { storeName: 'Après instantané' });
    assert.strictEqual((await D.call('GET', '/api/leads')).data.total, 41);
    const r = await E.call('POST', `/api/backups/${mk.data.name}/restore`, { mode: 'merge' }, { 'X-Real-IP': '10.0.0.78' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await D.call('GET', '/api/leads')).data.total, 41, 'merge keeps newer data');
  });

  await test('data survives restart of every instance (stored only in Redis)', async () => {
    for (const p of procs.splice(0)) await new Promise((r) => { p.on('exit', r); p.kill('SIGKILL'); });
    await startServer(PORTS[0]);
    const C = client(PORTS[0]);
    assert.strictEqual((await C.call('POST', '/api/login', { username: 'boss', password: 'Samex2026x' }, { 'X-Real-IP': '10.0.0.80' })).status, 200);
    assert.strictEqual((await C.call('GET', '/api/leads', null, { 'X-Real-IP': '10.0.0.80' })).data.total, 41);
  });

  await test('Redis outage → clean error, no crash; works again when Redis is back', async () => {
    const C = client(PORTS[0]);
    await C.call('POST', '/api/login', { username: 'boss', password: 'Samex2026x' }, { 'X-Real-IP': '10.0.0.81' });
    redis.stdin.write('down\n'); await sleep(100);
    const r = await C.call('POST', '/api/leads', { storeName: 'Pendant la panne' }, { 'X-Real-IP': '10.0.0.81' });
    assert.strictEqual(r.status, 500); assert.strictEqual(r.data.error, 'server_error');
    redis.stdin.write('up\n'); await sleep(100);
    const list = (await C.call('GET', '/api/leads', null, { 'X-Real-IP': '10.0.0.81' })).data;
    assert.strictEqual(list.total, 41, 'the failed write was not half-applied');
    assert.strictEqual((await C.call('POST', '/api/leads', { storeName: 'Après la panne' }, { 'X-Real-IP': '10.0.0.81' })).status, 200);
  });

  await test('wrong Redis token → API error, pages still served, token never shown to the browser', async () => {
    await startServer(PORTS[2], { KV_REST_API_TOKEN: 'bad-token' }, '/');
    assert.strictEqual((await fetch(`http://127.0.0.1:${PORTS[2]}/api/health`)).status, 500, 'health reports the storage failure');
    const page = await fetch(`http://127.0.0.1:${PORTS[2]}/`);
    assert.strictEqual(page.status, 200);
    const r = await client(PORTS[2]).call('GET', '/api/setup-status');
    assert.strictEqual(r.status, 500);
    assert(!JSON.stringify(r.data).includes('bad-token'));
  });

  await test('on Vercel without Redis variables: clear log message, pages served, no disk write', async () => {
    const p = await startServer(PORTS[2] + 1, { VERCEL: '1', KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined }, '/');
    assert.strictEqual((await fetch(`http://127.0.0.1:${PORTS[2] + 1}/`)).status, 200);
    assert.strictEqual((await client(PORTS[2] + 1).call('GET', '/api/setup-status')).status, 500);
    await sleep(100);
    assert(/KV_REST_API_URL/.test(p.logs), p.logs);
    assert.deepStrictEqual(fs.readdirSync(EMPTY_DIR), []);
  });

  await test('api/index.js (Vercel entry) works with NODEJS_HELPERS on (pre-parsed body) and off', async () => {
    const env = { ...process.env, KV_REST_API_URL: `http://127.0.0.1:${RPORT}`, KV_REST_API_TOKEN: RTOKEN, COOKIE_SECURE: 'true' };
    const code = `
      const fn = require(${JSON.stringify(path.join(ROOT, 'api', 'index.js'))});
      const { Readable } = require('stream');
      function call(useHelpers) {
        return new Promise((resolve) => {
          const body = JSON.stringify({ username: 'boss', password: 'Samex2026x' });
          const req = Readable.from(useHelpers ? [] : [Buffer.from(body)]);
          Object.assign(req, { method: 'POST', url: '/api/login', headers: { 'content-type': 'application/json', 'x-samex': '1', 'x-real-ip': '10.0.0.' + (useHelpers ? 90 : 91), host: 'crm.test' }, socket: { remoteAddress: '1.1.1.1' } });
          if (useHelpers) Object.defineProperty(req, 'body', { get: () => JSON.parse(body) });
          const res = { status: 0, writeHead(s) { this.status = s; }, end(d) { resolve(this.status + ' ' + d); } };
          fn(req, res);
        });
      }
      (async () => { process.env.NODEJS_HELPERS = '1'; console.log(await call(true)); process.env.NODEJS_HELPERS = '0'; console.log(await call(false)); process.exit(0); })();`;
    const o = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', code], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let s = ''; p.stdout.on('data', (d) => (s += d)); p.stderr.on('data', (d) => (s += d));
      p.on('exit', () => resolve(s)); setTimeout(() => { p.kill(); reject(new Error('timeout: ' + s)); }, 15000);
    });
    const lines = o.trim().split('\n');
    assert.strictEqual(lines.length, 2, o);
    for (const l of lines) assert(/^200 .*"username":"boss"/.test(l), o);
  });

  for (const p of procs) p.kill('SIGKILL');
  redis.kill();
  console.log(out.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
