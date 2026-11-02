/* Prospects CRM tests: Excel import (all sheets, no duplicates, re-import), scores & tiers, filters, editing, pipeline,
 * follow-ups, settings (categories / barème), exports, permissions, audit, persistence (file + Redis mode).
 * Real file: test/fixtures/Prospects_Batna_SAMEX.xlsx (or SAMEX_XLSX=path). Without it, a synthetic workbook is used.
 * Run: node test/prospects.test.js */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawn } = require('child_process');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'samex-prospects-'));
process.env.DATA_DIR = DATA;
process.env.COOKIE_SECURE = 'false';
const server = require('../server');
const db = require('../lib/db');
const files = require('../lib/files');
const xlsx = require('../lib/xlsx-read');
const C = require('../lib/constants');

const REAL = process.env.SAMEX_XLSX || path.join(__dirname, 'fixtures', 'Prospects_Batna_SAMEX.xlsx');
const HAS_REAL = fs.existsSync(REAL);

/* Synthetic workbook with the same structure as the real file (sheets + headers) */
function syntheticWorkbook() {
  const H = ['N°', 'Commune', 'Catégorie', '1. Nom boutique / marque', '2. Propriétaire (si public)', '3. Téléphone', 'WhatsApp', '4. Facebook', '5. Instagram', '6. TikTok',
    '7. Adresse', '8. Type de produits', "9. Indice d'activité", '10. Source exacte', 'Source complémentaire', 'Avis Google', 'Ouvert 7j/7', 'Preuve vente en ligne / livraison', 'Score /100', 'Niveau', 'Remarques'];
  const rows = [
    [1, 'Batna', 'Vêtements & mode', 'Bella Boutique', 'Non disponible', '+213 559 33 98 70', 'Oui (affiché publiquement)', 'Non disponible', 'Non disponible', 'https://www.tiktok.com/@bella', 'Route de Biskra', 'Vêtements', 'Google : 4.2★ / 5 avis', 'https://www.google.com/maps/place/?q=place_id:A1', 'Non disponible', 5, 'Non', 'Oui', 79, 'A', ''],
    [2, 'Batna', 'Chaussures', 'Real Shoes Batna', 'Non disponible', '+213 554 37 20 26', 'Probable — à vérifier', 'https://www.facebook.com/realshoesbatna', 'https://www.instagram.com/real_shoes_batna/', 'Non disponible', 'Batna', 'Chaussures', 'Google : 4.5★ / 10 avis', 'https://www.google.com/maps/place/?q=place_id:A2', 'Non disponible', 10, 'Non', 'Non', 72, 'A', ''],
    [3, 'Barika', 'Cosmétiques & parfums', 'Aura Beauty Barika', 'Non disponible', '+213 676 00 69 52', 'Probable — à vérifier', 'Non disponible', 'Non disponible', 'Non disponible', 'Barika', 'Cosmétiques', 'Google : 4.0★ / 3 avis', 'https://www.google.com/maps/place/?q=place_id:A3', 'Non disponible', 3, 'Non', 'Non', 47, 'B', 'Barika : rattachement à vérifier.'],
    [4, 'Arris', 'Autre', 'Boutique Fixe', 'Non disponible', '+213 33 85 10 20', 'Non (fixe)', 'Non disponible', 'Non disponible', 'Non disponible', 'Arris', 'Divers', 'Google : – / 0 avis', 'https://www.google.com/maps/place/?q=place_id:A4', 'Non disponible', 0, 'Non', 'Non', 18, 'C', ''],
    [5, 'Batna', 'Vêtements & mode', 'Trendy Store Batna', 'Non disponible', 'Non disponible', 'Non disponible', 'Non disponible', 'https://www.instagram.com/trendy_store_batna/', 'Non disponible', 'Non disponible', 'Vêtements (à confirmer)', 'Compte Instagram', 'https://www.instagram.com/trendy_store_batna/', 'Non disponible', 0, 'Non', 'Non', 30, 'C', ''],
  ];
  return files.toXLSX([
    { name: 'Lisez-moi', headers: ['Prospects e-commerce — Wilaya de Batna'], rows: [] },
    { name: 'Base complète', headers: H, rows },
    { name: 'Top 50', headers: ['Rang', 'Score', 'Niveau', 'Nom', 'Commune', 'Pourquoi prioritaire'], rows: [[1, 79, 'A', 'Bella Boutique', 'Batna', 'mobile publié'], [2, 72, 'A', 'Real Shoes Batna', 'Batna', 'réseaux sociaux']] },
    { name: 'WhatsApp', headers: ['Nom', 'Commune', 'Catégorie', 'Numéro', 'Lien WhatsApp direct', 'Statut WhatsApp'], rows: [['Bella Boutique', 'Batna', 'Vêtements & mode', '+213 559 33 98 70', 'https://wa.me/213559339870', 'Oui (affiché publiquement)']] },
    { name: 'Actifs FB-IG', headers: ['Nom', 'Commune', 'Facebook', 'Instagram', 'TikTok'], rows: [['Real Shoes Batna', 'Batna', 'https://www.facebook.com/realshoesbatna', 'https://www.instagram.com/real_shoes_batna/', 'Non disponible']] },
    { name: 'Par commune', headers: ['Commune', 'Prospects'], rows: [['Batna', 3], ['Barika', 1], ['Arris', 1], ['Total', 5]] },
  ]);
}

const WB = HAS_REAL ? fs.readFileSync(REAL) : syntheticWorkbook();
/* Expected values read independently from the workbook itself (Base complète) */
const EXP = (() => {
  const sheets = xlsx.readWorkbook(WB);
  const base = sheets.find((s) => s.name === 'Base complète');
  const h = base.rows.findIndex((r) => r.includes('1. Nom boutique / marque'));
  const H = base.rows[h];
  const col = (n) => H.indexOf(n);
  const rows = base.rows.slice(h + 1).filter((r) => String(r[col('1. Nom boutique / marque')] || '').trim());
  const nd = (v) => v && v !== 'Non disponible';
  const top = sheets.find((s) => s.name === 'Top 50');
  return {
    total: rows.length,
    byName: Object.fromEntries(rows.map((r) => [r[col('1. Nom boutique / marque')], { score: r[col('Score /100')], tier: r[col('Niveau')], commune: r[col('Commune')] }])),
    tiers: rows.reduce((a, r) => ((a[r[col('Niveau')]] = (a[r[col('Niveau')]] || 0) + 1), a), {}),
    withPhone: rows.filter((r) => nd(r[col('3. Téléphone')])).length,
    waConfirmed: rows.filter((r) => /^Oui/.test(r[col('WhatsApp')])).length,
    waUnverified: rows.filter((r) => /vérifier/.test(r[col('WhatsApp')])).length,
    fb: rows.filter((r) => nd(r[col('4. Facebook')])).length, ig: rows.filter((r) => nd(r[col('5. Instagram')])).length, tt: rows.filter((r) => nd(r[col('6. TikTok')])).length,
    online: rows.filter((r) => /^Oui/.test(r[col('Preuve vente en ligne / livraison')])).length,
    communes: rows.reduce((a, r) => ((a[r[col('Commune')]] = (a[r[col('Commune')]] || 0) + 1), a), {}),
    top50: top ? top.rows.filter((r, i) => i > 0 && typeof r[0] === 'number').length : 0,
  };
})();

let BASE;
let passed = 0, failed = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); passed++; results.push('  ✔ ' + name); }
  catch (e) { failed++; results.push('  ✘ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e)); }
}
class Client {
  constructor(base) { this.cookie = ''; this.base = base; }
  async req(method, url, body, { raw = false } = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Samex': '1' };
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch((this.base || BASE) + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) { const v = sc.split(';')[0]; this.cookie = v.endsWith('=') ? '' : v; }
    if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  get(u, o) { return this.req('GET', u, undefined, o); }
  post(u, b) { return this.req('POST', u, b); }
  patch(u, b) { return this.req('PATCH', u, b); }
  async login(u, p) { const r = await this.post('/api/login', { username: u, password: p }); assert.strictEqual(r.status, 200, JSON.stringify(r.data)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  const sup = new Client(), agent = new Client();
  const b64 = WB.toString('base64');
  let leads = [];
  const reload = async (q = '') => { const r = await sup.get('/api/leads' + (q ? '?' + q : '')); assert.strictEqual(r.status, 200); return r.data.leads; };
  const byName = (n) => leads.find((l) => l.storeName === n);

  await test('setup supervisor + agent', async () => {
    assert.strictEqual((await sup.post('/api/setup', { name: 'Salah', username: 'salah', password: 'Samex2026!', seedAgencies: true })).status, 200);
    const ag = (await sup.get('/api/directory')).data.agencies[0];
    const u = await sup.post('/api/users', { name: 'Agent Batna', username: 'agent.batna', password: 'Agent2026x', role: 'agent', agencyId: ag.id });
    assert.strictEqual(u.status, 200);
    await agent.login('agent.batna', 'Agent2026x');
  });

  await test(`Excel import (${HAS_REAL ? 'real file' : 'synthetic workbook'}): every merchant of « Base complète » imported once`, async () => {
    const r = await sup.post('/api/import', { xlsx: b64, wilayaCode: '05' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.created, EXP.total); assert.strictEqual(r.data.invalid, 0); assert.strictEqual(r.data.updated, 0);
    assert.strictEqual(r.data.report.mainSheet, 'Base complète');
    assert.deepStrictEqual(r.data.report.warnings, [], 'all enrichment rows found + Par commune counts match');
    if (HAS_REAL) { assert.strictEqual(r.data.created, 144); assert.strictEqual(r.data.report.enrich.top50, 50); assert.strictEqual(r.data.report.enrich.whatsapp, 103); assert.strictEqual(r.data.report.enrich.social, 16); }
    leads = await reload();
    assert.strictEqual(leads.length, EXP.total);
  });

  await test('no duplicates: names (per commune), phones and sources are unique', async () => {
    const k = (l) => C.norm(l.storeName) + '|' + C.norm(l.city);
    assert.strictEqual(new Set(leads.map(k)).size, leads.length);
    const phones = leads.map((l) => l.phonePrimary).filter(Boolean);
    assert.strictEqual(new Set(phones).size, phones.length);
    assert.strictEqual(phones.length, EXP.withPhone);
    const src = leads.map((l) => l.sourceUrl).filter(Boolean);
    assert.strictEqual(new Set(src).size, src.length); assert.strictEqual(src.length, EXP.total, 'every merchant keeps its source link');
  });

  await test('re-importing the same file creates nothing', async () => {
    const r = await sup.post('/api/import', { xlsx: b64, wilayaCode: '05' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.created, 0); assert.strictEqual(r.data.unchanged + r.data.updated, EXP.total);
    assert.strictEqual((await reload()).length, EXP.total);
  });

  await test('scores /100 and A/B/C tiers are exactly those of the file; the barème reproduces every Excel score', async () => {
    const settings = (await sup.get('/api/settings')).data;
    for (const l of leads) {
      const e = EXP.byName[l.storeName];
      assert(e, l.storeName);
      assert.strictEqual(l.score, e.score, l.storeName); assert.strictEqual(l.scoreSource, 'excel');
      assert.strictEqual(C.tierOf(l.score, settings), e.tier, l.storeName);
      assert.strictEqual(C.autoScore(l, settings), e.score, `barème ≠ Excel for ${l.storeName}`);
    }
    const st = (await sup.get('/api/prospects/stats')).data;
    assert.deepStrictEqual(st.tiers, { A: EXP.tiers.A || 0, B: EXP.tiers.B || 0, C: EXP.tiers.C || 0 });
    if (HAS_REAL) assert.deepStrictEqual(st.tiers, { A: 13, B: 57, C: 74 });
  });

  await test('original data preserved: communes, links, WhatsApp « À vérifier », remarks, top 50, wilaya not guessed as confirmed', async () => {
    const st = (await sup.get('/api/prospects/stats')).data;
    assert.strictEqual(st.total, EXP.total); assert.strictEqual(st.withPhone, EXP.withPhone);
    assert.strictEqual(st.whatsappConfirmed, EXP.waConfirmed); assert.strictEqual(st.whatsappUnverified, EXP.waUnverified);
    assert.strictEqual(st.facebook, EXP.fb); assert.strictEqual(st.instagram, EXP.ig); assert.strictEqual(st.tiktok, EXP.tt);
    assert.strictEqual(st.sellsOnline, EXP.online); assert.deepStrictEqual(st.byCommune, EXP.communes);
    assert.strictEqual(st.contacted, 0); assert.strictEqual(st.notContacted, EXP.total); assert.strictEqual(st.activeClients, 0);
    const bella = byName('Bella Boutique');
    assert.strictEqual(bella.whatsappStatus, 'confirmed'); assert.strictEqual(bella.phonePrimary, '+213559339870');
    assert(bella.tiktokUrl.startsWith('https://www.tiktok.com/@bella')); assert(bella.tags.includes('Top 50 #1'));
    assert.strictEqual(bella.wilayaCode, '05'); assert.strictEqual(bella.wilayaConfirmed, false);
    assert.strictEqual(leads.filter((l) => (l.tags || []).some((t) => /^Top 50 #/.test(t))).length, EXP.top50);
    const barika = leads.filter((l) => l.city === 'Barika');
    assert(barika.length && barika.every((l) => /rattachement/.test(l.remarks)), 'Barika remark kept');
    assert(leads.every((l) => !l.ownerName || l.ownerName !== 'Non disponible'), '« Non disponible » never stored as a value');
    const fixed = leads.find((l) => l.phonePrimary && !C.isMobile(l.phonePrimary));
    if (fixed) assert.notStrictEqual(fixed.whatsappStatus, 'confirmed');
  });

  await test('categories mapped to the CRM list (no merchant left uncategorised by mistake)', async () => {
    const settings = (await sup.get('/api/settings')).data;
    const ids = settings.categories.map((c) => c.id);
    assert(leads.every((l) => ids.includes(l.category)));
    assert.strictEqual(byName('Bella Boutique').category, 'Fashion');
    assert.strictEqual(byName('Real Shoes Batna').category, 'Footwear');
    for (const want of ['Vêtements & Mode', 'Chaussures', 'Cosmétiques & Parfums', 'Téléphones & Électronique', 'Accessoires', 'Maison & Décoration', 'Alimentation', 'Autres'])
      assert(settings.categories.some((c) => c.fr === want), want);
  });

  await test('filters: commune, tier, score range, WhatsApp, social networks, online, phone, contact status, search', async () => {
    const n = async (q) => (await reload(q)).length;
    assert.strictEqual(await n('commune=Batna'), EXP.communes.Batna);
    if (EXP.communes.Barika) assert.strictEqual(await n('commune=Barika'), EXP.communes.Barika);
    assert.strictEqual(await n('tier=A'), EXP.tiers.A);
    assert.strictEqual(await n('whatsapp=confirmed'), EXP.waConfirmed);
    assert.strictEqual(await n('whatsapp=unverified'), EXP.waUnverified);
    assert.strictEqual(await n('facebook=1'), EXP.fb); assert.strictEqual(await n('instagram=1'), EXP.ig); assert.strictEqual(await n('tiktok=1'), EXP.tt);
    assert.strictEqual(await n('online=1'), EXP.online);
    assert.strictEqual(await n('phone=yes'), EXP.withPhone); assert.strictEqual(await n('phone=no'), EXP.total - EXP.withPhone);
    assert.strictEqual(await n('contact=not'), EXP.total);
    const hi = Object.values(EXP.byName).filter((e) => e.score >= 60).length;
    assert.strictEqual(await n('scoreMin=60'), hi);
    assert.strictEqual(await n('search=0559339870'), 1);
    assert.strictEqual(await n('search=bella'), (await reload()).filter((l) => /bella/i.test(l.storeName + (l.tags || []))).length);
    assert.strictEqual(await n('category=Footwear&commune=Batna'), leads.filter((l) => l.category === 'Footwear' && l.city === 'Batna').length);
  });

  await test('edit a merchant: manual score, social links, refusal reason; bad values rejected', async () => {
    const l = byName('Real Shoes Batna');
    const r = await sup.patch('/api/leads/' + l.id, { score: 88, ownerName: 'Propriétaire public', instagramUrl: 'javascript:alert(1)', remarks: 'Vu en boutique' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.score, 88); assert.strictEqual(r.data.scoreSource, 'manual'); assert.strictEqual(r.data.instagramUrl, '');
    assert(r.data.notes.some((n) => /^Score : \d+ → 88 \(manuel\)$/.test(n.content)));
    const back = await sup.patch('/api/leads/' + l.id, { score: null, instagramUrl: 'https://www.instagram.com/real_shoes_batna/' });
    assert.strictEqual(back.data.score, null); assert.strictEqual(back.data.scoreSource, '');
    const settings = (await sup.get('/api/settings')).data;
    assert.strictEqual(C.effectiveScore(back.data, settings), C.autoScore(back.data, settings));
  });

  await test('CRM pipeline: 9 requested statuses exist, interactions count attempts and last contact, refusal reason', async () => {
    for (const s of ['NEW_DISCOVERED', 'ENRICHED', 'CONTACTED', 'REPLIED', 'INTERESTED', 'NEGOTIATION', 'WON_EXPEDITEUR', 'LOST', 'FOLLOW_UP']) assert(C.STAGE_IDS.includes(s), s);
    const l = byName('Bella Boutique');
    assert.strictEqual(l.stage, 'ENRICHED', 'merchant with a phone starts in « À contacter »');
    let r = await sup.post(`/api/leads/${l.id}/notes`, { channel: 'Phone Call', outcome: 'No Answer', content: 'Pas de réponse' });
    assert.strictEqual(r.data.stage, 'CONTACTED');
    r = await sup.post(`/api/leads/${l.id}/notes`, { channel: 'WhatsApp', outcome: 'Follow-up Set', content: 'Rappeler jeudi', nextFollowUpDate: '2020-01-01' });
    assert.strictEqual(r.data.stage, 'REPLIED');
    assert.strictEqual(C.contactNotes(r.data).length, 2); assert(C.lastContactAt(r.data));
    for (const s of ['NEGOTIATION', 'FOLLOW_UP', 'WON_EXPEDITEUR']) { r = await sup.patch('/api/leads/' + l.id, { stage: s }); assert.strictEqual(r.data.stage, s); }
    assert(r.data.wonAt, 'won date recorded');
    const lost = byName('Aura Beauty Barika') || leads.find((x) => x.id !== l.id);
    r = await sup.post(`/api/leads/${lost.id}/notes`, { channel: 'Phone Call', outcome: 'Not Interested', content: 'Déjà client ailleurs', refusalReason: 'Fidèle à son livreur actuel' });
    assert.strictEqual(r.data.stage, 'LOST'); assert.strictEqual(r.data.refusalReason, 'Fidèle à son livreur actuel');
    const st = (await sup.get('/api/prospects/stats')).data;
    assert.strictEqual(st.activeClients, 1); assert.strictEqual(st.contacted, 2); assert.strictEqual(st.notContacted, EXP.total - 2);
  });

  await test('follow-ups: overdue merchants listed (due filter), done after snooze', async () => {
    const l = byName('Bella Boutique');
    await sup.patch('/api/leads/' + l.id, { stage: 'FOLLOW_UP', nextFollowUpDate: '2020-01-01' });
    assert((await reload('due=1')).some((x) => x.id === l.id));
    await sup.patch('/api/leads/' + l.id, { nextFollowUpDate: '2099-01-01' });
    assert(!(await reload('due=1')).some((x) => x.id === l.id));
  });

  await test('bulk: change status and assign to an agent; agent sees only his merchants', async () => {
    const all = await reload('commune=Batna&tier=A');
    const ids = all.map((x) => x.id);
    const agentId = (await sup.get('/api/directory')).data.users.find((u) => u.username === 'agent.batna').id;
    const r = await sup.post('/api/leads/bulk', { ids, ownerId: agentId, stage: 'CONTACTED' });
    assert.strictEqual(r.data.updated, ids.length);
    const mine = (await agent.get('/api/leads')).data.leads;
    assert.strictEqual(mine.length, ids.length);
    assert(mine.every((x) => x.ownerId === agentId));
    const st = (await agent.get('/api/prospects/stats')).data;
    assert.strictEqual(st.total, ids.length, 'agent statistics limited to his own merchants');
    const other = leads.find((x) => !ids.includes(x.id));
    assert.strictEqual((await agent.get('/api/leads/' + other.id)).status, 404);
  });

  await test('permissions: agents cannot import Excel, change settings or recalculate scores', async () => {
    assert.strictEqual((await agent.post('/api/import', { xlsx: b64 })).status, 403);
    assert.strictEqual((await agent.patch('/api/settings', { scoring: { aMin: 1 } })).status, 403);
    assert.strictEqual((await agent.post('/api/settings/recalculate-scores', {})).status, 403);
    assert.strictEqual((await agent.get('/api/settings')).status, 200, 'agents can read labels and the barème');
    assert.strictEqual((await new Client().get('/api/prospects/stats')).status, 401);
  });

  await test('invalid Excel files are refused cleanly', async () => {
    assert.strictEqual((await sup.post('/api/import', { xlsx: Buffer.from('not a zip').toString('base64') })).data.error, 'xlsx_invalid');
    const noSheet = files.toXLSX([{ name: 'Feuil1', headers: ['a', 'b'], rows: [['1', '2']] }]).toString('base64');
    assert.strictEqual((await sup.post('/api/import', { xlsx: noSheet })).data.error, 'xlsx_no_sheet');
  });

  await test('settings: new category, renamed label, thresholds; invalid barème refused', async () => {
    const s = (await sup.get('/api/settings')).data;
    const r = await sup.patch('/api/settings', { categories: [...s.categories, { fr: 'Bijoux artisanaux', ar: 'حلي تقليدية', weight: 12 }] });
    assert.strictEqual(r.status, 200);
    const cat = r.data.categories.find((c) => c.fr === 'Bijoux artisanaux'); assert(cat && cat.id.startsWith('c_'));
    const l = leads[3];
    assert.strictEqual((await sup.patch('/api/leads/' + l.id, { category: cat.id })).data.category, cat.id);
    assert.strictEqual((await sup.patch('/api/leads/' + l.id, { category: 'n’importe quoi' })).data.category, 'Other');
    const missing = await sup.patch('/api/settings', { categories: [{ id: 'Fashion', fr: 'Mode', ar: 'أزياء', weight: 15 }] });
    assert(missing.data.categories.some((c) => c.id === 'Footwear') && missing.data.categories.some((c) => c.id === cat.id), 'categories not sent are kept (never deleted)');
    assert.strictEqual((await sup.patch('/api/settings', { scoring: { aMin: 40, bMin: 60 } })).data.error, 'invalid_thresholds');
    assert.strictEqual((await sup.patch('/api/settings', { scoring: { mobile: 'abc' } })).data.error, 'invalid_scoring');
    const t = await sup.patch('/api/settings', { scoring: { aMin: 60, bMin: 45 } });
    assert.strictEqual(t.data.scoring.aMin, 60);
    const aNow = (await reload('tier=A')).length;
    assert.strictEqual(aNow, (await reload()).filter((x) => C.effectiveScore(x, t.data) >= 60).length);
    await sup.patch('/api/settings', { scoring: { aMin: 55 } });
  });

  await test('recalculation: Excel scores kept unless asked, manual scores always kept, snapshot taken first', async () => {
    const l = leads[0];
    await sup.patch('/api/leads/' + l.id, { score: 99 });
    let r = await sup.post('/api/settings/recalculate-scores', {});
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.changed, 0);
    r = await sup.post('/api/settings/recalculate-scores', { includeExcel: true });
    const after = await reload();
    assert.strictEqual(after.find((x) => x.id === l.id).score, 99, 'manual score kept');
    assert(after.filter((x) => x.id !== l.id).every((x) => x.score === null || x.scoreSource === 'manual'));
    const snaps = (await sup.get('/api/backups')).data.snapshots;
    assert(snaps.some((s) => /pre-recalc/.test(s.name)) && snaps.some((s) => /pre-import/.test(s.name)));
  });

  await test('exports: Excel by tier (parsed back), CSV by commune, merchants with phone, selection by ids', async () => {
    const x = await sup.get('/api/export?format=xlsx&tier=A', { raw: true });
    assert.strictEqual(x.status, 200);
    const sheets = xlsx.readWorkbook(x.buf);
    assert.deepStrictEqual(sheets.map((s) => s.name), ['Prospects', 'Stats agents', 'Stats agences', 'Par commune']);
    const settings = (await sup.get('/api/settings')).data;
    const expectA = (await reload()).filter((l) => C.tierOf(C.effectiveScore(l, settings), settings) === 'A').length;
    assert.strictEqual(sheets[0].rows.length - 1, expectA);
    const hdr = sheets[0].rows[0];
    for (const h of ['Score /100', 'Niveau', 'Statut WhatsApp', 'Facebook', 'Instagram', 'TikTok', 'Source', 'Tentatives de contact']) assert(hdr.includes(h), h);
    const csv = await sup.get('/api/export?format=csv&commune=Batna', { raw: true });
    assert.strictEqual(files.parseCSV(csv.buf.toString('utf8')).length, EXP.communes.Batna);
    const ph = await sup.get('/api/export?format=csv&phone=yes', { raw: true });
    assert.strictEqual(files.parseCSV(ph.buf.toString('utf8')).length, EXP.withPhone);
    const ids = leads.slice(0, 3).map((l) => l.id).join(',');
    const sel = await sup.get('/api/export?format=csv&ids=' + ids, { raw: true });
    assert.strictEqual(files.parseCSV(sel.buf.toString('utf8')).length, 3);
  });

  await test('CRM export → Excel re-import is recognised (no duplicates)', async () => {
    const x = await sup.get('/api/export?format=xlsx', { raw: true });
    const r = await sup.post('/api/import', { xlsx: x.buf.toString('base64') });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.strictEqual(r.data.report.mainSheet, 'Prospects');
    assert.strictEqual(r.data.created, 0); assert.strictEqual((await reload()).length, EXP.total);
  });

  await test('audit log records import, settings, recalculation and exports', async () => {
    const a = (await sup.get('/api/audit')).data.entries.map((e) => e.action);
    for (const k of ['import_xlsx', 'settings_updated', 'scores_recalculated', 'export_xlsx', 'export_csv', 'bulk_update']) assert(a.includes(k), k);
  });

  await test('backups include the CRM settings (download + restore)', async () => {
    const b = await sup.get('/api/backup');
    assert(b.data.settings && b.data.settings.categories.some((c) => c.fr === 'Bijoux artisanaux'));
    const broken = JSON.parse(JSON.stringify(b.data)); broken.settings.scoring.aMin = 70;
    const r = await sup.post('/api/restore', { data: broken, mode: 'replace' });
    assert.strictEqual(r.status, 200);
    await sup.login('salah', 'Samex2026!');
    assert.strictEqual((await sup.get('/api/settings')).data.scoring.aMin, 70);
    assert.strictEqual((await reload()).length, EXP.total);
    await sup.patch('/api/settings', { scoring: { aMin: 55 } });
  });

  await test('data survives a restart (file storage)', async () => {
    await db.flush();
    const port = 4600 + Math.floor(Math.random() * 300);
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, DATA_DIR: DATA, PORT: String(port), COOKIE_SECURE: 'false' }, stdio: 'ignore' });
    try {
      const c = new Client(`http://127.0.0.1:${port}`);
      for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {} await sleep(100); }
      await c.login('salah', 'Samex2026!');
      const all = (await c.get('/api/leads')).data.leads;
      assert.strictEqual(all.length, EXP.total);
      assert(all.some((l) => l.stage === 'LOST' && l.refusalReason === 'Fidèle à son livreur actuel'), 'pipeline status + refusal reason persisted');
      assert((await c.get('/api/settings')).data.categories.some((x) => x.fr === 'Bijoux artisanaux'));
    } finally { p.kill(); }
  });

  await test('Redis (Vercel) mode: import, restart every instance, data still there', async () => {
    const RPORT = 5200 + Math.floor(Math.random() * 300), port = RPORT + 400;
    const redis = spawn(process.execPath, [path.join(__dirname, 'fake-upstash.js'), String(RPORT), 'tok'], { stdio: ['pipe', 'pipe', 'inherit'] });
    await new Promise((r) => redis.stdout.once('data', r));
    const env = { PATH: process.env.PATH, PORT: String(port), COOKIE_SECURE: 'false', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'samex-pr-')), KV_REST_API_URL: `http://127.0.0.1:${RPORT}`, KV_REST_API_TOKEN: 'tok' };
    const start = async () => {
      const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: 'ignore' });
      for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return p; } catch {} await sleep(100); }
      throw new Error('no start');
    };
    let p = await start();
    try {
      const c = new Client(`http://127.0.0.1:${port}`);
      assert.strictEqual((await c.post('/api/setup', { name: 'S', username: 'boss', password: 'Samex2026x' })).status, 200);
      const r = await c.post('/api/import', { xlsx: b64, wilayaCode: '05' });
      assert.strictEqual(r.data.created, EXP.total);
      p.kill('SIGKILL'); await sleep(200); p = await start();
      const c2 = new Client(`http://127.0.0.1:${port}`); await c2.login('boss', 'Samex2026x');
      assert.strictEqual((await c2.get('/api/leads')).data.leads.length, EXP.total);
      assert.strictEqual((await c2.post('/api/import', { xlsx: b64, wilayaCode: '05' })).data.created, 0);
    } finally { p.kill(); redis.kill(); }
  });

  server.close();
  console.log(`Fichier : ${HAS_REAL ? REAL : 'classeur synthétique (fichier réel absent)'}`);
  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
