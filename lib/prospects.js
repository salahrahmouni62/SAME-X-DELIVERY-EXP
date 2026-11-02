/* Prospects CRM: editable settings (categories, scoring), Excel workbook import mapping, prospect statistics.
 * Uses the existing "leads" collection (no parallel store): imported merchants are ordinary leads with extra fields. */
const C = require('./constants');
const db = require('./db');
const xlsx = require('./xlsx-read');

const STR = (v, max = 500) => (v === undefined || v === null ? '' : String(v).slice(0, max).trim());

/* ---------------- settings ---------------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
/** Current settings = stored settings merged over the defaults (new default categories appear automatically). */
function getSettings() {
  const doc = db.get('meta', 'settings');
  const base = clone(C.DEFAULT_SETTINGS);
  if (!doc) return base;
  const scoring = { ...base.scoring };
  for (const k of C.SCORING_KEYS) if (typeof (doc.scoring || {})[k] === 'number') scoring[k] = doc.scoring[k];
  if (doc.scoring && typeof doc.scoring.homeCommune === 'string') scoring.homeCommune = doc.scoring.homeCommune;
  const stored = Array.isArray(doc.categories) ? doc.categories : [];
  const categories = stored.slice();
  for (const d of base.categories) if (!categories.some((c) => c.id === d.id)) categories.push(d);
  return { version: 1, categories, scoring, updatedAt: doc.updatedAt || '', updatedBy: doc.updatedBy || '' };
}
const slug = (s) => 'c_' + C.norm(s).replace(/[^a-z0-9]/g, '').slice(0, 30);
function num(v, min, max) { const n = Number(v); return isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : null; }

/** Validate a settings patch from the supervisor. Built-in categories can be renamed/disabled but never deleted. */
function cleanSettings(input, current) {
  const out = clone(current);
  if (input.scoring && typeof input.scoring === 'object') {
    for (const k of C.SCORING_KEYS) if (input.scoring[k] !== undefined) {
      const n = num(input.scoring[k], 0, 100); if (n === null) throw Object.assign(new Error('invalid_scoring'), { code: 'invalid_scoring' });
      out.scoring[k] = n;
    }
    if (input.scoring.homeCommune !== undefined) out.scoring.homeCommune = STR(input.scoring.homeCommune, 80);
    if (out.scoring.bMin > out.scoring.aMin) throw Object.assign(new Error('invalid_thresholds'), { code: 'invalid_thresholds' });
  }
  if (Array.isArray(input.categories)) {
    const seen = new Set();
    const cats = [];
    for (const c of input.categories.slice(0, 80)) {
      if (!c || typeof c !== 'object') continue;
      const fr = STR(c.fr, 60); const ar = STR(c.ar, 60);
      let id = STR(c.id, 40);
      const existing = current.categories.find((x) => x.id === id);
      if (!existing) { if (!fr) continue; id = slug(fr); }
      if (seen.has(id)) continue;
      seen.add(id);
      cats.push({ id, fr: fr || (existing && existing.fr) || id, ar: ar || (existing && existing.ar) || fr, weight: num(c.weight, 0, 100) ?? (existing ? existing.weight : 5),
        active: c.active !== false || id === 'Other' });
    }
    // categories are never deleted (leads may use them): those not sent are kept as they are; use active:false to hide one
    for (const c of current.categories) if (!seen.has(c.id)) cats.push(c);
    out.categories = cats;
  }
  return out;
}
function saveSettings(s, user) {
  const doc = { id: 'settings', categories: s.categories, scoring: s.scoring, updatedAt: new Date().toISOString(), updatedBy: user ? user.name : '' };
  const cur = db.get('meta', 'settings');
  if (cur) Object.assign(cur, doc); else db.insert('meta', doc);
  db.persist();
  return getSettings();
}

/* ---------------- Excel workbook → lead records ---------------- */
const NA = /^(non disponible|n\/a|na|-|—|aucun|none)$/i;
const val = (v) => { const s = STR(v, 3000); return NA.test(s) ? '' : s; };
const yes = (v) => /^(oui|yes|true|1|x|✔)/i.test(STR(v));
const keyOf = (h) => C.norm(h).replace(/^\d+/, '');
/* Column headers of the prospect workbook and of the CRM's own export */
const XL_MAP = {
  nomboutiquemarque: 'storeName', nom: 'storeName', boutique: 'storeName', storename: 'storeName', nomdelaboutique: 'storeName',
  proprietairesipublic: 'ownerName', proprietaire: 'ownerName', decideur: 'ownerName', ownername: 'ownerName',
  telephone: 'phonePrimary', numero: 'phonePrimary', phone: 'phonePrimary', telephone2: 'phoneSecondary',
  whatsapp: 'whatsappRaw', statutwhatsapp: 'whatsappRaw', facebook: 'facebookUrl', instagram: 'instagramUrl', tiktok: 'tiktokUrl',
  adresse: 'address', adresseramassage: 'address', typedeproduits: 'productType', indicedactivite: 'activityIndex',
  sourceexacte: 'sourceUrl', source: 'sourceUrl', sourcecomplementaire: 'sourceUrl2', avisgoogle: 'googleReviews', ouvert7j7: 'open7',
  preuveventeenlignelivraison: 'sellsOnline', venteenligne: 'sellsOnline', score100: 'score', score: 'score', niveau: 'tierExcel',
  remarques: 'remarks', commune: 'city', villecommune: 'city', categorie: 'category', codewilaya: 'wilayaCode', wilaya: 'wilaya',
  etape: 'stage', priorite: 'priority', prochainerelance: 'nextFollowUpDate', urlprofil: 'profileUrl', plateforme: 'platform',
  identifiant: 'handle', quartier: 'neighborhood', email: 'email', motifderefus: 'refusalReason',
};
function mapRecord(o) {
  const r = {};
  for (const [h, v] of Object.entries(o)) { if (h === '__row') continue; const k = XL_MAP[keyOf(h)]; if (k && r[k] === undefined) r[k] = v; }
  const out = {
    storeName: val(r.storeName), ownerName: val(r.ownerName), phonePrimary: val(r.phonePrimary), phoneSecondary: val(r.phoneSecondary),
    facebookUrl: val(r.facebookUrl), instagramUrl: val(r.instagramUrl), tiktokUrl: val(r.tiktokUrl), address: val(r.address),
    productType: val(r.productType), activityIndex: val(r.activityIndex), sourceUrl: val(r.sourceUrl), sourceUrl2: val(r.sourceUrl2),
    remarks: val(r.remarks), city: val(r.city), category: val(r.category), handle: val(r.handle), neighborhood: val(r.neighborhood), email: val(r.email),
    refusalReason: val(r.refusalReason),
  };
  const wa = val(r.whatsappRaw);
  out.whatsappStatus = /^oui|confirm|yes/i.test(wa) ? 'confirmed' : /v[ée]rifier|probable|unverified/i.test(wa) ? 'unverified' : '';
  if (r.googleReviews !== undefined && val(r.googleReviews) !== '') out.googleReviews = Math.max(0, Math.round(Number(r.googleReviews) || 0));
  if (r.open7 !== undefined) out.open7 = yes(r.open7);
  if (r.sellsOnline !== undefined) out.sellsOnline = yes(r.sellsOnline);
  const sc = Number(val(r.score));
  if (val(r.score) !== '' && isFinite(sc)) { out.score = Math.max(0, Math.min(100, Math.round(sc))); out.scoreSource = 'excel'; }
  if (val(r.tierExcel)) out.tierExcel = val(r.tierExcel).toUpperCase().slice(0, 1);
  if (/google\.[a-z.]+\/maps|maps\.app\.goo\.gl/i.test(out.sourceUrl)) out.googleMapsUrl = out.sourceUrl;
  // main platform / profile: first social link found (Facebook > Instagram > TikTok)
  const main = out.facebookUrl ? ['facebook', out.facebookUrl] : out.instagramUrl ? ['instagram', out.instagramUrl] : out.tiktokUrl ? ['tiktok', out.tiktokUrl] : ['other', ''];
  out.platform = val(r.platform) || main[0];
  out.profileUrl = val(r.profileUrl) || main[1];
  out.storeType = out.address ? (out.sellsOnline ? 'Hybrid' : 'Physical Store') : 'Online Only';
  out.wilayaCode = val(r.wilayaCode) || C.wilayaFromText(val(r.wilaya)) || '';
  if (val(r.stage)) out.stage = val(r.stage);
  if (val(r.priority)) out.priority = val(r.priority);
  if (val(r.nextFollowUpDate)) out.nextFollowUpDate = val(r.nextFollowUpDate);
  out.__row = o.__row;
  return out;
}

const nameKey = (name, city) => C.norm(name) + '|' + C.norm(city);
/**
 * Parse a prospect workbook. Main sheet: « Base complète » (else « Prospects », else the first sheet with a store-name column).
 * The other sheets enrich the same merchants without creating records: Top 50 (rank, reason), WhatsApp, Actifs FB-IG, Par commune (check).
 */
function parseProspectWorkbook(buf, { wilayaCode = '' } = {}) {
  const sheets = xlsx.readWorkbook(buf);
  const isHeader = (r) => r.some((c) => ['nomboutiquemarque', 'boutique', 'nom', 'storename'].includes(keyOf(c)));
  const find = (re) => sheets.find((s) => re.test(C.norm(s.name)));
  const main = find(/^basecomplete$/) || find(/^prospects$/) || sheets.find((s) => s.rows.some(isHeader));
  if (!main) throw Object.assign(new Error('no prospect sheet'), { code: 'xlsx_no_sheet' });
  const base = xlsx.sheetObjects(main, isHeader);
  const records = base.records.map(mapRecord).filter((r) => r.storeName || r.phonePrimary);
  const report = { mainSheet: main.name, rows: base.records.length, sheets: sheets.map((s) => s.name), enrich: {}, warnings: [] };
  for (const r of records) if (!r.wilayaCode && wilayaCode) r.wilayaCode = wilayaCode;

  const byName = new Map(records.map((r) => [nameKey(r.storeName, r.city), r]));
  const byNameOnly = new Map(); records.forEach((r) => { const k = C.norm(r.storeName); byNameOnly.set(k, byNameOnly.has(k) ? null : r); });
  const lookup = (o) => byName.get(nameKey(o.Nom || o.nom || o['Nom'], o.Commune)) || byNameOnly.get(C.norm(o.Nom)) || null;

  const top = find(/^top\d+$/);
  if (top) {
    const t = xlsx.sheetObjects(top, (r) => r.some((c) => keyOf(c) === 'rang'));
    let n = 0;
    for (const o of t.records) {
      const r = lookup(o); if (!r) { report.warnings.push(`Top 50 : « ${o.Nom} » introuvable dans la base`); continue; }
      r.top50Rank = Number(o.Rang) || null; r.priorityReason = val(o['Pourquoi prioritaire']); n++;
    }
    report.enrich.top50 = n;
  }
  const wa = find(/^whatsapp$/);
  if (wa) {
    const w = xlsx.sheetObjects(wa, (r) => r.some((c) => keyOf(c) === 'nom'));
    let n = 0;
    for (const o of w.records) {
      const r = lookup(o); if (!r) { report.warnings.push(`WhatsApp : « ${o.Nom} » introuvable dans la base`); continue; }
      const st = val(o['Statut WhatsApp']);
      if (!r.whatsappStatus) r.whatsappStatus = /^oui|confirm/i.test(st) ? 'confirmed' : 'unverified';
      if (!r.phonePrimary && val(o['Numéro'])) r.phonePrimary = val(o['Numéro']);
      n++;
    }
    report.enrich.whatsapp = n;
  }
  const soc = find(/^actifsfbig$|^actifs/);
  if (soc) {
    const s = xlsx.sheetObjects(soc, (r) => r.some((c) => keyOf(c) === 'nom'));
    let n = 0;
    for (const o of s.records) {
      const r = lookup(o); if (!r) { report.warnings.push(`Actifs FB-IG : « ${o.Nom} » introuvable dans la base`); continue; }
      for (const [k, f] of [['Facebook', 'facebookUrl'], ['Instagram', 'instagramUrl'], ['TikTok', 'tiktokUrl']]) if (!r[f] && val(o[k])) r[f] = val(o[k]);
      r.socialActive = true; n++;
    }
    report.enrich.social = n;
  }
  const pc = find(/^parcommune$/);
  if (pc) {
    const p = xlsx.sheetObjects(pc, (r) => r.some((c) => keyOf(c) === 'commune'));
    const counts = {};
    records.forEach((r) => { counts[r.city] = (counts[r.city] || 0) + 1; });
    const check = [];
    for (const o of p.records) {
      const c = val(o.Commune); const expected = Number(o.Prospects);
      if (!c || /^total$/i.test(c) || !isFinite(expected)) continue;
      check.push({ commune: c, expected, found: counts[c] || 0 });
      if ((counts[c] || 0) !== expected) report.warnings.push(`Par commune : ${c} attendu ${expected}, trouvé ${counts[c] || 0}`);
    }
    report.enrich.communes = check;
  }
  return { records, report };
}

/** Tags derived from the workbook enrichment (shown as chips, filterable by search). */
function enrichmentTags(r) {
  const tags = [];
  if (r.top50Rank) tags.push(`Top 50 #${r.top50Rank}`);
  if (r.socialActive) tags.push('Actif FB/IG');
  return tags;
}

/* ---------------- statistics ---------------- */
function prospectStats(leads, settings) {
  const s = { total: leads.length, withPhone: 0, whatsappConfirmed: 0, whatsappUnverified: 0, facebook: 0, instagram: 0, tiktok: 0, sellsOnline: 0,
    contacted: 0, activeClients: 0, notContacted: 0, refused: 0, tiers: { A: 0, B: 0, C: 0 }, byCommune: {}, byCategory: {}, byStage: {}, avgScore: 0 };
  let sum = 0;
  for (const l of leads) {
    if (l.phonePrimary) s.withPhone++;
    if (l.whatsappStatus === 'confirmed') s.whatsappConfirmed++; else if (l.whatsappStatus === 'unverified') s.whatsappUnverified++;
    const so = C.socialLinks(l);
    if (so.facebook) s.facebook++; if (so.instagram) s.instagram++; if (so.tiktok) s.tiktok++;
    if (l.sellsOnline) s.sellsOnline++;
    if (C.CONTACTED_STAGES.includes(l.stage)) s.contacted++; else s.notContacted++;
    if (l.stage === 'WON_EXPEDITEUR') s.activeClients++;
    if (l.stage === 'LOST') s.refused++;
    const sc = C.effectiveScore(l, settings); sum += sc;
    s.tiers[C.tierOf(sc, settings)]++;
    const commune = l.city || '—';
    s.byCommune[commune] = (s.byCommune[commune] || 0) + 1;
    s.byCategory[l.category || 'Other'] = (s.byCategory[l.category || 'Other'] || 0) + 1;
    s.byStage[l.stage] = (s.byStage[l.stage] || 0) + 1;
  }
  s.avgScore = leads.length ? Math.round((sum / leads.length) * 10) / 10 : 0;
  return s;
}

module.exports = { getSettings, cleanSettings, saveSettings, parseProspectWorkbook, enrichmentTags, prospectStats, nameKey, mapRecord };
