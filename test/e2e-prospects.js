/* Browser test of the Prospects & CRM interface (Chromium via Playwright, preinstalled in the dev container).
 * Run: node test/e2e-prospects.js   (needs test/fixtures/Prospects_Batna_SAMEX.xlsx; screenshots in $SHOTS or /tmp) */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const FILE = process.env.SAMEX_XLSX || path.join(__dirname, 'fixtures', 'Prospects_Batna_SAMEX.xlsx');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'samex-shots-'));
const PORT = 4700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0; const out = [];
async function step(name, fn) { try { await fn(); passed++; out.push('  ✔ ' + name); } catch (e) { failed++; out.push('  ✘ ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 3).join('\n      ')); } }

(async () => {
  if (!fs.existsSync(FILE)) { console.log('Fichier Excel réel absent : test navigateur ignoré.'); process.exit(0); }
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'samex-e2e-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, COOKIE_SECURE: 'false' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await sleep(100); }
  const api = async (cookie, method, url, body) => { const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', 'X-Samex': '1', Cookie: cookie || '' }, body: body && JSON.stringify(body) }); return { r, data: await r.json().catch(() => null) }; };
  const setup = await api('', 'POST', '/api/setup', { name: 'Salah Rahmouni', username: 'salah', password: 'Samex2026!', seedAgencies: true });
  const cookie = setup.r.headers.get('set-cookie').split(';')[0];
  const ag = (await api(cookie, 'GET', '/api/directory')).data.agencies[0];
  await api(cookie, 'POST', '/api/users', { name: 'Agent Batna', username: 'agent.batna', password: 'Agent2026x', role: 'agent', agencyId: ag.id });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Network messages are not script errors: Google Fonts is unreachable from the test sandbox, and /api/me answers 401 before login
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const count = async () => Number(await page.textContent('#count-n'));

  await step('login and open « Prospects & CRM » (empty state)', async () => {
    await page.goto(BASE);
    await page.fill('#login-user', 'salah'); await page.fill('#login-pass', 'Samex2026!'); await page.click('#login-form button[type=submit]');
    await page.waitForSelector('.nav-item[data-nav="prospects"]');
    await page.click('.nav-item[data-nav="prospects"]');
    await page.waitForSelector('text=Aucun commerçant pour le moment');
  });

  await step('import the Excel file through the interface → report 144 created, checks OK', async () => {
    await page.click('.page-head [data-action="import-xlsx"]');
    await page.setInputFiles('#im-file', FILE);
    assert.strictEqual(await page.inputValue('#im-wilaya'), '05', 'wilaya preset from the file name (still editable)');
    await page.click('#im-go');
    await page.waitForSelector('text=Importation terminée');
    const txt = await page.textContent('.modal');
    assert(/Commerçants créés\s*144/.test(txt), txt); assert(/Contrôles OK/.test(txt), txt);
    await page.screenshot({ path: path.join(SHOTS, '1-import-report.png') });
    await page.click('.modal [data-close]');
  });

  await step('dashboard KPIs come from the database (144 / 105 phones / 1 WhatsApp confirmed / A=13)', async () => {
    await page.waitForSelector('.kpis-10');
    const kpis = await page.$$eval('.kpis-10 .kpi', (els) => els.map((e) => [e.querySelector('.label').textContent, e.querySelector('.value').textContent]));
    const k = Object.fromEntries(kpis);
    assert.strictEqual(k['Commerçants'], '144'); assert.strictEqual(k['Avec téléphone'], '105'); assert.strictEqual(k['WhatsApp confirmé'], '1');
    assert.strictEqual(k['Pas encore contactés'], '144');
    assert(/A · 13/.test(await page.textContent('.tierbar')));
    await page.screenshot({ path: path.join(SHOTS, '2-prospects-dashboard.png'), fullPage: true });
  });

  await step('filter by commune (click on the chart) and by tier; sort by score', async () => {
    await page.click('.hbar[data-pf="commune"][data-val="Barika"]');
    assert.strictEqual(await count(), 16);
    await page.click('.hbar[data-pf="commune"][data-val="Barika"]'); // toggle off
    assert.strictEqual(await count(), 144);
    await page.selectOption('.pf-grid select[data-filter="tier"]', 'A');
    assert.strictEqual(await count(), 13);
    const first = await page.textContent('.ptbl tbody tr:first-child .store b');
    assert.strictEqual(first, 'Bella Boutique', 'highest score first');
    await page.click('.pf-toggles [data-action="reset-filters"]');
    assert.strictEqual(await count(), 144);
  });

  await step('quick search by phone number and by name', async () => {
    await page.fill('#search', '0559339870'); await sleep(350);
    assert.strictEqual(await count(), 1);
    await page.fill('#search', 'shoes'); await sleep(350);
    assert(await count() >= 1);
    await page.fill('#search', ''); await sleep(350);
  });

  await step('merchant card: score A/79, WhatsApp confirmed, contact buttons (call, WhatsApp, TikTok, copy)', async () => {
    await page.fill('#search', 'Bella Boutique'); await sleep(350);
    await page.click('.ptbl tbody tr:first-child .store');
    await page.waitForSelector('.drawer .score-box');
    assert(/A\s*79/.test(await page.textContent('.drawer .score-box .tier')));
    const bar = await page.$$eval('.drawer .contact-bar > *', (els) => els.map((e) => (e.getAttribute('href') || e.dataset.action || '') + '|' + e.textContent.trim()));
    assert(bar.some((b) => b.startsWith('tel:+213559339870')), bar.join(' '));
    assert(bar.some((b) => b.startsWith('pitch|'))); assert(bar.some((b) => b.startsWith('https://www.tiktok.com/'))); assert(bar.some((b) => b.startsWith('copy-phone|')));
    assert(/WhatsApp confirmé/.test(await page.textContent('.drawer .drawer-badges')));
    await page.screenshot({ path: path.join(SHOTS, '3-merchant-card.png') });
  });

  await step('WhatsApp message in darja with the store name, not sent automatically', async () => {
    await page.click('.drawer .contact-bar [data-action="pitch"]');
    await page.selectOption('#p-tpl', 'dz-intro');
    const msg = await page.inputValue('#p-msg');
    assert(msg.includes('Bella Boutique') && msg.includes('السلام عليكم'), msg);
    assert(/wa\.me\/213559339870\?text=/.test(await page.getAttribute('#p-wa', 'href')));
    await page.click('.modal [data-close]');
  });

  await step('edit the card (status, manual score, Instagram) and log a refusal with its reason', async () => {
    await page.selectOption('.drawer-meta select[data-field="stage"]', 'NEGOTIATION');
    await page.waitForSelector('.toast:has-text("Négociation")');
    await page.fill('.drawer input[data-field="instagramUrl"]', 'https://www.instagram.com/bella_test/');
    await page.press('.drawer input[data-field="instagramUrl"]', 'Tab'); await sleep(400);
    await page.click('.drawer .tab[data-tab="journal"]');
    await page.selectOption('#n-channel', 'Phone Call'); await page.selectOption('#n-outcome', 'Not Interested');
    assert(await page.isVisible('#n-refusal'));
    await page.fill('#n-refusal', 'Prix trop élevé'); await page.fill('#n-content', 'Appel : pas intéressé pour le moment.');
    await page.click('#note-form button[type=submit]'); await page.waitForSelector('.toast:has-text("Refusé")');
    await page.click('.drawer .tab[data-tab="prospect"]');
    assert.strictEqual(await page.inputValue('.drawer input[data-field="refusalReason"]'), 'Prix trop élevé');
    assert(/1/.test(await page.textContent('.drawer .stat-mini b')), 'one contact attempt');
    await page.click('[data-action="close-lead"]');
    await page.fill('#search', ''); await sleep(350);
  });

  await step('bulk: select 3 merchants and change their status', async () => {
    for (let i = 0; i < 3; i++) await page.locator('.ptbl tbody input[data-select]').nth(i).check(); // the table re-renders after each click
    await page.waitForSelector('.bulkbar');
    await page.selectOption('.bulkbar select[data-bulk="stage"]', 'ENRICHED');
    await page.waitForSelector('.toast:has-text("3 ✓")');
  });

  await step('download Excel of tier A (file returned by the server)', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { const s = document.querySelector('select[data-dl="tier"]'); s.value = 'A'; s.dispatchEvent(new Event('change', { bubbles: true })); })]);
    const p = await dl.path();
    const sheets = require('../lib/xlsx-read').readWorkbook(fs.readFileSync(p));
    assert.strictEqual(sheets[0].rows.length - 1, 13);
  });

  await step('settings: add an activity, it appears in the filters', async () => {
    await page.click('.nav-item[data-nav="settings"]');
    await page.click('[data-action="add-category"]');
    await page.fill('#cat-table tbody tr:last-child input[data-k="fr"]', 'Bijoux artisanaux');
    await page.fill('#cat-table tbody tr:last-child input[data-k="ar"]', 'حلي تقليدية');
    await page.click('[data-action="save-settings"]'); await page.waitForSelector('.toast:has-text("Enregistré")');
    await page.screenshot({ path: path.join(SHOTS, '4-settings.png'), fullPage: true });
    await page.click('.nav-item[data-nav="prospects"]');
    assert((await page.textContent('.pf-grid select[data-filter="category"]')).includes('Bijoux artisanaux'));
  });

  await step('Arabic interface (RTL)', async () => {
    await page.click('.user-card [data-action="lang"]');
    assert.strictEqual(await page.getAttribute('html', 'dir'), 'rtl');
    assert((await page.textContent('.nav-item[data-nav="prospects"]')).includes('التجار والمتابعة'));
    await page.screenshot({ path: path.join(SHOTS, '5-arabic.png') });
    await page.click('.user-card [data-action="lang"]');
  });

  await step('data still there after a server restart', async () => {
    srv.kill(); await sleep(300);
    const srv2 = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, COOKIE_SECURE: 'false' }, stdio: 'ignore' });
    process.on('exit', () => srv2.kill());
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await sleep(100); }
    await page.reload(); await page.waitForSelector('.kpis-10');
    assert.strictEqual(await count(), 144);
  });

  await step('mobile (390 px): no horizontal scroll, KPIs and table usable', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    mp.on('pageerror', (e) => errors.push(e.message));
    await mp.goto(BASE); await mp.fill('#login-user', 'salah'); await mp.fill('#login-pass', 'Samex2026!'); await mp.click('#login-form button[type=submit]');
    await mp.waitForSelector('.bottom-nav'); await mp.click('.bottom-nav [data-nav="prospects"]'); await mp.waitForSelector('.kpis-10');
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(over <= 1, 'horizontal overflow ' + over);
    await mp.screenshot({ path: path.join(SHOTS, '6-mobile.png'), fullPage: false });
    await m.close();
  });

  await step('agent: no settings, no Excel import, only his own merchants', async () => {
    const a = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ap = await a.newPage();
    ap.on('pageerror', (e) => errors.push(e.message));
    await ap.goto(BASE); await ap.fill('#login-user', 'agent.batna'); await ap.fill('#login-pass', 'Agent2026x'); await ap.click('#login-form button[type=submit]');
    await ap.waitForSelector('.nav-item[data-nav="prospects"]');
    assert.strictEqual(await ap.$('.nav-item[data-nav="settings"]'), null);
    await ap.click('.nav-item[data-nav="prospects"]'); await ap.waitForSelector('.kpis-10');
    assert.strictEqual(await ap.$('.page-head [data-action="import-xlsx"]'), null);
    assert.strictEqual(Number(await ap.textContent('#count-n')), 0);
    await a.close();
  });

  await step('no JavaScript error in the browser', async () => { assert.deepStrictEqual(errors, [], errors.join(' | ')); });

  await browser.close(); srv.kill();
  console.log(out.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed — captures : ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})();
