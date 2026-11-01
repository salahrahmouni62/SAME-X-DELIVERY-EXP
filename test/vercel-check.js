/* Pre-deployment check for Vercel, without the Vercel CLI:
 *  1. vercel.json is valid and its function file exists;
 *  2. every require('./...') reachable from api/index.js resolves to a file that is actually uploaded
 *     (not excluded by .vercelignore / .gitignore) with the exact same letter case (Vercel runs on Linux);
 *  3. the uploaded file set alone boots and serves the app (page, constants, API) in Vercel mode.
 * Run: node test/vercel-check.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const problems = [];
const ok = (m) => console.log('  ✔ ' + m);

function patterns(file) {
  if (!fs.existsSync(path.join(ROOT, file))) return [];
  return fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}
function globToRe(p) {
  const dir = p.endsWith('/'); const core = p.replace(/\/$/, '').replace(/^\//, '');
  const re = core.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp('(^|/)' + re + (dir ? '(/|$)' : '$'));
}
function ignoredBy(rules, rel) {
  let ign = false;
  for (const r of rules) { const neg = r.startsWith('!'); if (globToRe(neg ? r.slice(1) : r).test(rel)) ign = !neg; }
  return ign;
}
function walk(dir, base = '') {
  return fs.readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const rel = base ? `${base}/${n}` : n;
    if (rel === '.git' || rel === 'node_modules') return [];
    return fs.statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel, rel) : [rel];
  });
}
const gitRules = patterns('.gitignore'), vercelRules = patterns('.vercelignore');
const uploaded = new Set(walk('').filter((f) => !ignoredBy(gitRules, f) && !ignoredBy(vercelRules, f)));

// 1. vercel.json
const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
for (const fn of Object.keys(vj.functions || {})) if (!uploaded.has(fn)) problems.push(`vercel.json: fonction ${fn} absente du déploiement`);
if (vj.routes && (vj.rewrites || vj.headers || vj.redirects || vj.cleanUrls || vj.trailingSlash)) problems.push('vercel.json: "routes" ne peut pas être combiné avec rewrites/headers/redirects');
if (!problems.length) ok('vercel.json valide, fonctions présentes : ' + Object.keys(vj.functions || {}).join(', '));
for (const f of ['.env.local', '.env', '.vercel']) if (uploaded.has(f)) problems.push(`${f} serait publié : il ne doit jamais être dans le dépôt`);

// 2. require graph (exact case)
const seen = new Set();
function resolveRel(fromRel, spec) {
  const baseDir = path.posix.dirname(fromRel);
  const target = path.posix.normalize(path.posix.join(baseDir, spec));
  for (const c of [target, target + '.js', target + '.json', target + '/index.js']) if (uploaded.has(c)) return c;
  return null;
}
function visit(rel) {
  if (seen.has(rel)) return; seen.add(rel);
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    const r = resolveRel(rel, m[1]);
    if (!r) problems.push(`${rel} : require('${m[1]}') introuvable dans les fichiers publiés (vérifiez dossier et majuscules/minuscules)`);
    else visit(r);
  }
}
for (const fn of Object.keys(vj.functions || {})) if (uploaded.has(fn)) visit(fn);
ok(`${seen.size} modules résolus depuis api/index.js : ${[...seen].join(', ')}`);
for (const need of ['public/index.html', 'public/app.js', 'public/i18n.js', 'public/styles.css', 'lib/constants.js']) if (!uploaded.has(need)) problems.push(`${need} manquant`);

if (problems.length) { console.log('\n✘ Problèmes :\n  - ' + problems.join('\n  - ')); process.exit(1); }

// 3. boot the uploaded set alone, as Vercel would
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'samex-vercel-'));
for (const f of uploaded) { fs.mkdirSync(path.join(TMP, path.dirname(f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f)); }
const RPORT = 4900 + Math.floor(Math.random() * 90);
const redis = spawn(process.execPath, [path.join(__dirname, 'fake-upstash.js'), String(RPORT), 'tok'], { stdio: ['pipe', 'pipe', 'inherit'] });
redis.stdout.once('data', () => {
  const code = `
    const fn = require('./api/index.js');
    const { Readable } = require('stream');
    const get = (url) => new Promise((resolve) => {
      const req = Readable.from([]); Object.assign(req, { method: 'GET', url, headers: { host: 'x.vercel.app' }, socket: { remoteAddress: '1.1.1.1' } });
      const chunks = []; const { Writable } = require('stream');
      const res = new Writable({ write(c, e, cb) { chunks.push(Buffer.from(c)); cb(); } });
      res.writeHead = (s, h) => { res.status = s; res.h = h; };
      const end = res.end.bind(res); res.end = (d) => { if (d) chunks.push(Buffer.from(d)); resolve({ status: res.status, body: Buffer.concat(chunks).toString(), h: res.h }); end(); };
      res.on('finish', () => resolve({ status: res.status, body: Buffer.concat(chunks).toString(), h: res.h }));
      fn(req, res);
    });
    (async () => {
      const page = await get('/'); const cst = await get('/constants.js'); const api = await get('/api/setup-status'); const deep = await get('/prospects/123');
      console.log(JSON.stringify({ page: [page.status, /<html/i.test(page.body)], cst: [cst.status, cst.body.includes('WILAYAS')], api: [api.status, api.body], deep: [deep.status, /<html/i.test(deep.body)], csp: !!(page.h && page.h['Content-Security-Policy']) }));
      process.exit(0);
    })();`;
  const p = spawn(process.execPath, ['-e', code], { cwd: TMP, env: { PATH: process.env.PATH, VERCEL: '1', NODE_ENV: 'production', NODEJS_HELPERS: '0', SETUP_TOKEN: 'abc123abc123', KV_REST_API_URL: `http://127.0.0.1:${RPORT}`, KV_REST_API_TOKEN: 'tok' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d));
  p.on('exit', () => {
    redis.kill();
    try {
      const r = JSON.parse(o.trim().split('\n').pop());
      assert.deepStrictEqual(r.page, [200, true]); assert.deepStrictEqual(r.cst, [200, true]); assert.deepStrictEqual(r.deep, [200, true]);
      assert.strictEqual(r.api[0], 200); assert.deepStrictEqual(JSON.parse(r.api[1]), { needsSetup: true, tokenRequired: true, locked: false });
      assert.strictEqual(r.csp, true);
      ok(`copie isolée des ${uploaded.size} fichiers publiés : page (200), /constants.js (200), route SPA (200), API /api/setup-status (200), en-têtes de sécurité`);
      console.log('\nPrêt pour Vercel.');
      process.exit(0);
    } catch (e) { console.log('✘ Démarrage en mode Vercel :\n' + o + '\n' + e.message); process.exit(1); }
  });
});
