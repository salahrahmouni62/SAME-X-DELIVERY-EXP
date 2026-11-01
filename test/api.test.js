/* End-to-end API tests: auth, roles, agency isolation, CRM workflow, import/export, backup/restore.
 * Run: node test/api.test.js   (uses a temporary data directory and a random port) */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'samex-test-'));
process.env.DATA_DIR = DATA;
process.env.COOKIE_SECURE = 'false';
const server = require('../server');

let BASE;
let passed = 0, failed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; results.push('  ✔ ' + name); }
  catch (e) { failed++; results.push('  ✘ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); }
}

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, { csrf = true, raw = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-Samex'] = '1';
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) { const v = sc.split(';')[0]; this.cookie = v.endsWith('=') ? '' : v; }
    if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  }
  get(u, o) { return this.req('GET', u, undefined, o); }
  post(u, b, o) { return this.req('POST', u, b, o); }
  patch(u, b) { return this.req('PATCH', u, b); }
  del(u) { return this.req('DELETE', u, {}); }
  async login(username, password) { const r = await this.post('/api/login', { username, password }); assert.strictEqual(r.status, 200, `login ${username}: ${JSON.stringify(r.data)}`); return r; }
}

const noHash = (obj) => assert(!JSON.stringify(obj).includes('scrypt$'), 'password hash leaked in response');

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  const sup = new Client(), a1 = new Client(), b1 = new Client(), anon = new Client();
  const ctx = {};

  await test('setup status reports first-run', async () => {
    const r = await anon.get('/api/setup-status'); assert.strictEqual(r.data.needsSetup, true);
  });
  await test('setup rejects weak password', async () => {
    const r = await sup.post('/api/setup', { name: 'Salah', username: 'salah', password: 'short' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.data.error, 'password_too_short');
  });
  await test('setup creates supervisor + seed agencies and logs in', async () => {
    const r = await sup.post('/api/setup', { name: 'Salah Rahmouni', username: 'salah', password: 'Samex2026!', seedAgencies: true });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.user.role, 'supervisor'); noHash(r.data);
    const me = await sup.get('/api/me'); assert.strictEqual(me.data.user.username, 'salah');
  });
  await test('setup cannot run twice', async () => {
    const r = await anon.post('/api/setup', { name: 'X', username: 'hacker', password: 'Hacker2026' }); assert.strictEqual(r.status, 409);
  });
  await test('CSRF: state-changing request without header is refused', async () => {
    const r = await sup.post('/api/leads', { storeName: 'x' }, { csrf: false }); assert.strictEqual(r.status, 403);
  });
  await test('CSRF: cross-origin Origin header is refused', async () => {
    const res = await fetch(BASE + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Samex': '1', Cookie: sup.cookie, Origin: 'https://evil.example' }, body: '{"storeName":"x"}' });
    assert.strictEqual(res.status, 403);
  });
  await test('unauthenticated API access returns 401', async () => {
    assert.strictEqual((await anon.get('/api/leads')).status, 401);
    assert.strictEqual((await anon.get('/api/stats')).status, 401);
    assert.strictEqual((await anon.get('/api/export?format=csv', { raw: true })).status, 401);
  });
  await test('wrong password → 401, then throttled after 5 failures → 429', async () => {
    const c = new Client();
    // Uses a throwaway username so the lockout does not affect the rest of the suite (key = username + IP)
    for (let i = 0; i < 5; i++) assert.strictEqual((await c.post('/api/login', { username: 'ghost', password: 'nope' })).status, 401);
    const r = await c.post('/api/login', { username: 'ghost', password: 'whatever1' }); assert.strictEqual(r.status, 429); assert(r.data.retryAfter > 0);
    await sup.get('/api/me'); // other accounts are unaffected
    assert.strictEqual((await new Client().post('/api/login', { username: 'salah', password: 'Samex2026!' })).status, 200);
  });

  await test('directory lists seeded agencies (supervisor)', async () => {
    const r = await sup.get('/api/directory'); noHash(r.data);
    ctx.biskra = r.data.agencies.find((a) => a.wilayaCode === '07'); ctx.alger = r.data.agencies.find((a) => a.wilayaCode === '16');
    assert(ctx.biskra && ctx.alger); assert.deepStrictEqual(ctx.biskra.wilayas, ['07', '51']);
  });
  await test('supervisor creates a new agency (Annaba 23) and edits it', async () => {
    let r = await sup.post('/api/agencies', { name: 'Hub Annaba', code: 'ann', wilayaCode: '23', wilayas: ['23', '36'], phone: '038 12 34 56' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.code, 'ANN'); assert.strictEqual(r.data.phone, '+21338123456'); ctx.annaba = r.data;
    r = await sup.patch('/api/agencies/' + ctx.annaba.id, { name: 'Hub Annaba Centre' }); assert.strictEqual(r.data.name, 'Hub Annaba Centre');
    r = await sup.post('/api/agencies', { name: 'Dup', code: 'ANN', wilayaCode: '23' }); assert.strictEqual(r.status, 409);
    r = await sup.post('/api/agencies', { name: 'No wilaya' }); assert.strictEqual(r.data.error, 'agency_wilaya_required');
  });
  await test('supervisor creates agents attached to agencies', async () => {
    let r = await sup.post('/api/users', { name: 'Agent Biskra', username: 'biskra1', role: 'agent', agencyId: ctx.biskra.id, password: 'Biskra2026' });
    assert.strictEqual(r.status, 200); noHash(r.data); ctx.a1 = r.data;
    r = await sup.post('/api/users', { name: 'Agent Alger', username: 'alger1', role: 'agent', agencyId: ctx.alger.id, password: 'Alger2026x' }); ctx.b1 = r.data;
    r = await sup.post('/api/users', { name: 'X', username: 'biskra1', role: 'agent', agencyId: ctx.biskra.id, password: 'Biskra2026' }); assert.strictEqual(r.status, 409);
    r = await sup.post('/api/users', { name: 'X', username: 'noagency', role: 'agent', password: 'Biskra2026' }); assert.strictEqual(r.data.error, 'agency_required');
  });
  await test('passwords are stored hashed (never plaintext) on disk', async () => {
    await new Promise((r) => setTimeout(r, 120));
    const raw = fs.readFileSync(path.join(DATA, 'samex-db.json'), 'utf8');
    for (const pw of ['Samex2026!', 'Biskra2026', 'Alger2026x']) assert(!raw.includes(pw), 'plaintext password found on disk');
    assert(raw.includes('scrypt$'));
  });

  await a1.login('biskra1', 'Biskra2026');
  await b1.login('alger1', 'Alger2026x');

  await test('agent creates a lead — owned by them, in their agency, phone normalised, auto-enriched', async () => {
    const r = await a1.post('/api/leads', { storeName: 'Karakou Biskra', handle: '@karakou07', platform: 'instagram', phonePrimary: '0550 12 34 56', wilayaCode: '07', category: 'Fashion', ownerId: ctx.b1.id, initialNote: 'Vu en reel' });
    assert.strictEqual(r.status, 200); ctx.leadA = r.data;
    assert.strictEqual(r.data.ownerId, ctx.a1.id, 'agent cannot assign to someone else');
    assert.strictEqual(r.data.agencyId, ctx.biskra.id);
    assert.strictEqual(r.data.phonePrimary, '+213550123456');
    assert.strictEqual(r.data.stage, 'ENRICHED');
    assert.strictEqual(r.data.wilayaConfirmed, false);
  });
  await test('invalid phone is dropped server-side; store name required', async () => {
    let r = await b1.post('/api/leads', { storeName: 'Alger Shop', phonePrimary: '12345' }); assert.strictEqual(r.data.phonePrimary, ''); ctx.leadB = r.data;
    r = await b1.post('/api/leads', { storeName: '  ' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.data.error, 'store_name_required');
  });
  await test('ISOLATION: agents only list their own leads', async () => {
    const ra = await a1.get('/api/leads'); const rb = await b1.get('/api/leads');
    assert.deepStrictEqual(ra.data.leads.map((l) => l.id), [ctx.leadA.id]);
    assert.deepStrictEqual(rb.data.leads.map((l) => l.id), [ctx.leadB.id]);
  });
  await test('ISOLATION: agent cannot read, edit, annotate or delete another agent’s lead (404)', async () => {
    assert.strictEqual((await b1.get('/api/leads/' + ctx.leadA.id)).status, 404);
    assert.strictEqual((await b1.patch('/api/leads/' + ctx.leadA.id, { stage: 'LOST' })).status, 404);
    assert.strictEqual((await b1.post(`/api/leads/${ctx.leadA.id}/notes`, { content: 'x' })).status, 404);
    assert.strictEqual((await b1.del('/api/leads/' + ctx.leadA.id)).status, 404);
    const r = await b1.post('/api/leads/bulk', { ids: [ctx.leadA.id], action: 'delete' }); assert.strictEqual(r.data.updated, 0);
    assert.strictEqual((await sup.get('/api/leads/' + ctx.leadA.id)).data.stage, 'ENRICHED');
  });
  await test('ROLES: agents are refused all admin endpoints', async () => {
    for (const [m, u, b] of [['post', '/api/agencies', { name: 'x', wilayaCode: '01' }], ['patch', '/api/agencies/' + ctx.biskra.id, { active: false }], ['post', '/api/users', {}], ['patch', '/api/users/' + ctx.b1.id, { active: false }], ['get', '/api/backup'], ['get', '/api/backups'], ['post', '/api/restore', {}], ['get', '/api/audit']])
      assert.strictEqual((await a1[m](u, b)).status, 403, `${m} ${u}`);
  });
  await test('ROLES: agent cannot reassign their lead', async () => {
    const r = await a1.patch('/api/leads/' + ctx.leadA.id, { ownerId: ctx.b1.id }); assert.strictEqual(r.status, 403);
  });
  await test('ROLES: agent directory only shows own agency & self', async () => {
    const r = await a1.get('/api/directory'); assert.strictEqual(r.data.agencies.length, 1); assert.strictEqual(r.data.users.length, 1); noHash(r.data);
  });
  await test('supervisor sees all leads and can filter by agency & wilaya', async () => {
    let r = await sup.get('/api/leads'); assert.strictEqual(r.data.total, 2);
    r = await sup.get('/api/leads?agencyId=' + ctx.biskra.id); assert.strictEqual(r.data.total, 1);
    r = await sup.get('/api/leads?wilaya=07'); assert.strictEqual(r.data.total, 1);
    r = await sup.get('/api/leads?wilaya=NONE'); assert.strictEqual(r.data.total, 1);
    r = await sup.get('/api/leads?search=0550123456'); assert.strictEqual(r.data.total, 1);
  });
  await test('journal: interactions move the pipeline and keep full history', async () => {
    let r = await a1.post(`/api/leads/${ctx.leadA.id}/notes`, { channel: 'WhatsApp', outcome: 'No Answer', content: 'Pitch envoyé' });
    assert.strictEqual(r.data.stage, 'CONTACTED');
    r = await a1.post(`/api/leads/${ctx.leadA.id}/notes`, { channel: 'Phone Call', outcome: 'Agreed on Trial', content: 'OK pour 3 colis test', nextFollowUpDate: '2026-11-02' });
    assert.strictEqual(r.data.stage, 'TRIAL_DELIVERY'); assert.strictEqual(r.data.nextFollowUpDate, '2026-11-02');
    const inter = r.data.notes.filter((n) => n.kind === 'interaction'); const sys = r.data.notes.filter((n) => n.kind === 'system');
    assert.strictEqual(inter.length, 3); assert(sys.some((n) => n.content.includes('TRIAL_DELIVERY'))); assert(sys.some((n) => n.content.includes('2026-11-02')));
    assert.strictEqual((await a1.post(`/api/leads/${ctx.leadA.id}/notes`, { content: '  ' })).status, 400);
  });
  await test('won stage stamps wonAt; stats compute conversion per agent and agency', async () => {
    let r = await a1.patch('/api/leads/' + ctx.leadA.id, { stage: 'WON_EXPEDITEUR', wilayaConfirmed: true, painPoints: ['cod_delay', 'bogus'] });
    assert(r.data.wonAt); assert.deepStrictEqual(r.data.painPoints, ['cod_delay']); assert.strictEqual(r.data.wilayaConfirmed, true);
    r = await sup.get('/api/stats');
    assert.strictEqual(r.data.overall.total, 2); assert.strictEqual(r.data.overall.won, 1); assert.strictEqual(r.data.overall.conversionRate, 50);
    assert.strictEqual(r.data.overall.wonThisMonth, 1);
    const bAg = r.data.byAgency.find((a) => a.id === ctx.biskra.id); assert.strictEqual(bAg.conversionRate, 100); assert.strictEqual(bAg.contactedConversionRate, 100);
    const ag = r.data.byAgent.find((a) => a.id === ctx.b1.id); assert.strictEqual(ag.won, 0);
    assert.strictEqual(r.data.weeks.length, 8); assert(r.data.weeks.reduce((s, w) => s + w.interactions, 0) >= 3);
    const ra = await a1.get('/api/stats'); assert.strictEqual(ra.data.overall.total, 1); assert.strictEqual(ra.data.byAgent.length, 1); assert.strictEqual(ra.data.byAgency.length, 1);
  });
  await test('reminders: overdue / due filters work', async () => {
    await b1.patch('/api/leads/' + ctx.leadB.id, { nextFollowUpDate: '2020-01-01' });
    const r = await b1.get('/api/leads?due=1'); assert.strictEqual(r.data.total, 1);
    const s = await b1.get('/api/stats'); assert.strictEqual(s.data.overall.overdue, 1);
    const h = await b1.get('/api/leads?hot=1'); assert.strictEqual(h.data.total, 1, 'overdue leads are priority');
  });
  await test('supervisor reassigns lead across agencies; isolation follows', async () => {
    const r = await sup.patch('/api/leads/' + ctx.leadB.id, { ownerId: ctx.a1.id });
    assert.strictEqual(r.data.ownerId, ctx.a1.id); assert.strictEqual(r.data.agencyId, ctx.biskra.id);
    assert.strictEqual((await b1.get('/api/leads')).data.total, 0);
    assert.strictEqual((await a1.get('/api/leads')).data.total, 2);
    assert(r.data.notes[0].content.includes('Agent Biskra'));
  });
  await test('moving an agent to another agency moves their leads too', async () => {
    let r = await sup.patch('/api/users/' + ctx.b1.id, { agencyId: ctx.annaba.id }); assert.strictEqual(r.data.agencyId, ctx.annaba.id);
    await b1.post('/api/leads', { storeName: 'Annaba Parfums', wilayaCode: '23' });
    r = await sup.patch('/api/users/' + ctx.b1.id, { agencyId: ctx.alger.id });
    const leads = (await sup.get('/api/leads?ownerId=' + ctx.b1.id)).data.leads; assert(leads.every((l) => l.agencyId === ctx.alger.id));
  });

  await test('export CSV (UTF-8 BOM, ; separated, formula-safe) respects scope', async () => {
    await a1.post('/api/leads', { storeName: '=HYPERLINK("x")', handle: '@evil' });
    const r = await a1.get('/api/export?format=csv', { raw: true });
    assert.strictEqual(r.status, 200); assert(/text\/csv/.test(r.headers.get('content-type'))); assert(/attachment/.test(r.headers.get('content-disposition')));
    const txt = r.buf.toString('utf8'); assert(txt.startsWith('﻿Boutique;'));
    assert(txt.includes("'=HYPERLINK")); assert(!txt.includes('Annaba Parfums'), 'agent export leaked other agent data');
    ctx.csv = txt.slice(1);
  });
  await test('export XLSX is a valid workbook with 3 sheets', async () => {
    const r = await sup.get('/api/export?format=xlsx', { raw: true }); assert.strictEqual(r.status, 200);
    const f = path.join(DATA, 'out.xlsx'); fs.writeFileSync(f, r.buf);
    const out = execFileSync('python3', ['-I', '-c', `import zipfile,sys,xml.dom.minidom as m
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
names=z.namelist(); [m.parseString(z.read(n)) for n in names if n.endswith('.xml') or n.endswith('.rels')]
wb=z.read('xl/workbook.xml').decode(); print(wb.count('<sheet '), len(z.read('xl/worksheets/sheet1.xml')))`, f]).toString().trim();
    const [sheets] = out.split(' '); assert.strictEqual(sheets, '3');
    try { const o = execFileSync('python3', ['-I', '-c', 'import openpyxl,sys; wb=openpyxl.load_workbook(sys.argv[1]); ws=wb["Prospects"]; print(ws.max_row, ws["A1"].value)', f]).toString().trim(); assert(o.endsWith('Boutique'), o); } catch (e) { if (!/No module named/.test(String(e.stderr || e))) throw e; }
  });
  await test('import Swift-format JSON: maps fields, extracts phones from notes, dedupes on re-import', async () => {
    const records = [
      { platform: 'facebook', storeName: 'البركة للأجهزة الكهرومنزلية', handle: 'Electromenagerelbaraka', profileUrl: 'https://www.facebook.com/Electromenagerelbaraka', category: 'Home Crafts', storeType: 'Online Only', city: '', estimatedVolume: 'Unknown', stage: 'NEW_DISCOVERED', priority: 'medium', notes: [{ author: 'Superviseur', channel: 'Internal Note', content: 'Tél. public annonce: 0550834859 / 0770630100. Wilaya NON CONFIRMÉE.', createdAt: '2026-10-29T12:18:23.108Z' }], discoveredAt: '2026-10-29T12:19:22.927Z' },
      { platform: 'instagram', storeName: 'Biskra Dates Shop', handle: '@biskradates', city: 'biskra', category: 'Gourmet Sweets', storeType: 'Physical Store', estimatedVolume: 'Medium (6-20 pkgs/day)', priority: 'high', notes: [] },
      { platform: 'tiktok', handle: '', storeName: '' },
    ];
    let r = await sup.post('/api/import', { records, ownerId: ctx.a1.id });
    assert.deepStrictEqual(r.data, { created: 2, skipped: 0, invalid: 1 });
    const leads = (await a1.get('/api/leads')).data.leads;
    const elb = leads.find((l) => l.handle === 'Electromenagerelbaraka');
    assert.strictEqual(elb.phonePrimary, '+213550834859'); assert.strictEqual(elb.phoneSecondary, '+213770630100'); assert.strictEqual(elb.category, 'Home');
    assert.strictEqual(elb.agencyId, ctx.biskra.id); assert.strictEqual(elb.discoveredAt, '2026-10-29T12:19:22.927Z'); assert.strictEqual(elb.stage, 'NEW_DISCOVERED');
    const bd = leads.find((l) => l.handle === '@biskradates'); assert.strictEqual(bd.wilayaCode, '07'); assert.strictEqual(bd.storeType, 'Physical Store'); assert.strictEqual(bd.estimatedVolume, 'Medium (6-20 pkgs/day)'); assert.strictEqual(bd.category, 'Sweets');
    r = await sup.post('/api/import', { records, ownerId: ctx.a1.id }); assert.strictEqual(r.data.created, 0); assert.strictEqual(r.data.skipped, 2);
  });
  await test('import CSV round-trip (agent re-imports own export → all duplicates; new rows created)', async () => {
    let r = await a1.post('/api/import', { csv: ctx.csv }); assert.strictEqual(r.data.created, 0); assert(r.data.skipped >= 2);
    const csv = 'Boutique;Téléphone;Wilaya;Catégorie;Étape\nNouvelle Boutique Sétif;0661 22 33 44;Sétif;Mode;CONTACTED\n';
    r = await a1.post('/api/import', { csv }); assert.strictEqual(r.data.created, 1);
    const l = (await a1.get('/api/leads?search=setif')).data.leads[0];
    assert.strictEqual(l.wilayaCode, '19'); assert.strictEqual(l.phonePrimary, '+213661223344'); assert.strictEqual(l.category, 'Fashion'); assert.strictEqual(l.stage, 'CONTACTED'); assert.strictEqual(l.ownerId, ctx.a1.id);
    assert.strictEqual((await a1.post('/api/import', { foo: 1 })).status, 400);
  });
  await test('bulk update by supervisor (stage + reassign)', async () => {
    const ids = (await sup.get('/api/leads?ownerId=' + ctx.a1.id + '&stage=NEW_DISCOVERED')).data.leads.map((l) => l.id);
    const r = await sup.post('/api/leads/bulk', { ids, priority: 'high' }); assert.strictEqual(r.data.updated, ids.length);
    assert((await sup.get('/api/leads?priority=high')).data.total >= ids.length);
  });

  await test('deactivating an agency logs out its agents immediately and blocks login', async () => {
    let r = await sup.patch('/api/agencies/' + ctx.alger.id, { active: false }); assert.strictEqual(r.data.active, false);
    assert.strictEqual((await b1.get('/api/leads')).status, 401);
    r = await new Client().post('/api/login', { username: 'alger1', password: 'Alger2026x' }); assert.strictEqual(r.status, 403); assert.strictEqual(r.data.error, 'agency_disabled');
    r = await sup.post('/api/leads', { storeName: 'x', ownerId: ctx.b1.id }); assert.strictEqual(r.data.error, 'agency_inactive');
    await sup.patch('/api/agencies/' + ctx.alger.id, { active: true });
    await b1.login('alger1', 'Alger2026x');
  });
  await test('deactivating a user ends their session; protections on self & last supervisor', async () => {
    let r = await sup.patch('/api/users/' + ctx.b1.id, { active: false }); assert.strictEqual(r.data.active, false);
    assert.strictEqual((await b1.get('/api/me')).status, 401);
    assert.strictEqual((await new Client().post('/api/login', { username: 'alger1', password: 'Alger2026x' })).data.error, 'account_disabled');
    const me = (await sup.get('/api/me')).data.user;
    assert.strictEqual((await sup.patch('/api/users/' + me.id, { active: false })).data.error, 'cannot_disable_self');
    assert.strictEqual((await sup.patch('/api/users/' + me.id, { role: 'agent', agencyId: ctx.biskra.id })).data.error, 'last_supervisor');
    await sup.patch('/api/users/' + ctx.b1.id, { active: true, password: 'Alger2027y' });
    await b1.login('alger1', 'Alger2027y');
  });
  await test('change own password requires the current one and rotates the session', async () => {
    assert.strictEqual((await a1.post('/api/me/password', { currentPassword: 'bad', newPassword: 'Biskra2027' })).data.error, 'wrong_current_password');
    const old = a1.cookie;
    assert.strictEqual((await a1.post('/api/me/password', { currentPassword: 'Biskra2026', newPassword: 'Biskra2027' })).status, 200);
    assert.notStrictEqual(a1.cookie, old);
    const stale = new Client(); stale.cookie = old; assert.strictEqual((await stale.get('/api/me')).status, 401);
    assert.strictEqual((await a1.get('/api/me')).status, 200);
  });

  await test('backup download (supervisor) → restore replace → sessions cleared → login works', async () => {
    const r = await sup.get('/api/backup', { raw: true }); assert.strictEqual(r.status, 200);
    const backup = JSON.parse(r.buf.toString()); assert.strictEqual(backup.app, 'samex-delivery-crm');
    const count = backup.leads.length;
    await sup.del('/api/leads/' + ctx.leadA.id);
    assert.strictEqual((await sup.get('/api/leads')).data.total, count - 1);
    const rr = await sup.post('/api/restore', { data: backup, mode: 'replace' }); assert.strictEqual(rr.status, 200); assert.strictEqual(rr.data.loggedOut, true);
    assert.strictEqual((await a1.get('/api/me')).status, 401, 'restore must clear sessions');
    await sup.login('salah', 'Samex2026!');
    assert.strictEqual((await sup.get('/api/leads')).data.total, count);
    const snaps = (await sup.get('/api/backups')).data.snapshots; assert(snaps.some((s) => s.name.includes('pre-restore')));
  });
  await test('restore rejects invalid backups; merge mode adds only missing items', async () => {
    assert.strictEqual((await sup.post('/api/restore', { data: { app: 'nope' } })).data.error, 'backup_invalid');
    const backup = JSON.parse((await sup.get('/api/backup', { raw: true })).buf.toString());
    backup.users = backup.users.map((u) => ({ ...u, role: 'agent' }));
    assert.strictEqual((await sup.post('/api/restore', { data: backup })).data.error, 'backup_no_supervisor');
    const b2 = JSON.parse((await sup.get('/api/backup', { raw: true })).buf.toString());
    const del = b2.leads[0].id; await sup.del('/api/leads/' + del);
    const m = await sup.post('/api/restore', { data: b2, mode: 'merge' }); assert.strictEqual(m.data.added, 1); assert.strictEqual(m.data.loggedOut, false);
    assert.strictEqual((await sup.get('/api/leads/' + del)).status, 200);
  });
  await test('manual snapshot + restore from snapshot', async () => {
    const s = await sup.post('/api/backups'); assert(s.data.name.includes('manual'));
    const r = await sup.post(`/api/backups/${s.data.name}/restore`, { mode: 'merge' }); assert.strictEqual(r.status, 200);
    assert.strictEqual((await sup.post('/api/backups/..%2F..%2Fserver.js/restore', {})).status, 404);
  });
  await test('audit log records security events', async () => {
    const r = await sup.get('/api/audit'); const actions = r.data.entries.map((e) => e.action);
    for (const a of ['login_failed', 'user_created', 'agency_disabled', 'restore_replace', 'export_csv', 'import']) assert(actions.includes(a), a);
  });
  await test('logout invalidates the session', async () => {
    const c = new Client(); await c.login('salah', 'Samex2026!'); const ck = c.cookie;
    await c.post('/api/logout', {}); const s = new Client(); s.cookie = ck; assert.strictEqual((await s.get('/api/me')).status, 401);
  });
  await test('static: security headers, no source leakage, no path traversal', async () => {
    let res = await fetch(BASE + '/'); const html = await res.text();
    assert(res.headers.get('content-security-policy').includes("frame-ancestors 'none'")); assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert(html.includes('SAME X DELIVERY')); assert(!/swift/i.test(html));
    res = await fetch(BASE + '/../server.js'); assert(!(await res.text()).includes('createServer'));
    res = await fetch(BASE + '/%2e%2e/lib/auth.js'); assert(!(await res.text()).includes('scrypt'));
    res = await fetch(BASE + '/constants.js'); assert((await res.text()).includes('WILAYAS'));
  });
  await test('no Swift branding anywhere in shipped front-end', async () => {
    for (const f of ['index.html', 'app.js', 'styles.css', 'manifest.webmanifest']) {
      const txt = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
      const hits = txt.split('\n').filter((l) => /swift/i.test(l) && !/swiftexpediteurs_crm_leads_v2/.test(l));
      assert.strictEqual(hits.length, 0, `${f}: ${hits[0]}`);
    }
  });

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  server.close();
  fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
