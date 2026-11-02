/* Lead domain logic: sanitising, scoping, stats, import/export mapping. */
const C = require('./constants');
const db = require('./db');
const P = require('./prospects');

const STR = (v, max = 500) => (v === undefined || v === null ? '' : String(v).slice(0, max).trim());
const URL_OK = (v) => { const s = STR(v, 1000); return /^https?:\/\//i.test(s) ? s : ''; };
const DATE_OK = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
const INT = (v, min, max) => { const n = Number(v); return isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : null; };

const CATEGORY_ALIASES = {
  accessoire: 'Accessories', accessor: 'Accessories', cadeau: 'Accessories', gift: 'Accessories',
  fashion: 'Fashion', mode: 'Fashion', apparel: 'Fashion', vetement: 'Fashion',
  cosmetic: 'Cosmetics', skincare: 'Cosmetics', beaute: 'Cosmetics',
  perfume: 'Perfumes', parfum: 'Perfumes', oud: 'Perfumes',
  footwear: 'Footwear', shoe: 'Footwear', chaussure: 'Footwear', bag: 'Footwear', sneaker: 'Footwear',
  jewel: 'Jewelry', watch: 'Jewelry', bijou: 'Jewelry', montre: 'Jewelry',
  electronic: 'Electronics', tech: 'Electronics', phone: 'Electronics',
  home: 'Home', craft: 'Home', maison: 'Home', deco: 'Home', electromenager: 'Home',
  sweet: 'Sweets', gourmet: 'Sweets', gateau: 'Sweets', food: 'Food', aliment: 'Food', epicerie: 'Food',
  sport: 'Sport', autre: 'Other', other: 'Other',
  baby: 'Baby', toy: 'Baby', bebe: 'Baby', enfant: 'Baby',
  health: 'Health', sante: 'Health', nutrition: 'Health',
};
/** Category id from an id, a label (FR/AR, from the CRM settings) or free text. Unknown → 'Other'. */
function mapCategory(v) {
  const cats = db.ready() ? P.getSettings().categories : C.DEFAULT_SETTINGS.categories;
  if (cats.some((c) => c.id === v) || C.CATEGORIES.includes(v)) return v;
  const n = C.norm(v);
  if (!n) return 'Other';
  const byLabel = cats.find((c) => C.norm(c.fr) === n || C.norm(c.ar) === n);
  if (byLabel) return byLabel.id;
  for (const k of Object.keys(CATEGORY_ALIASES)) if (n.includes(k)) return CATEGORY_ALIASES[k];
  return 'Other';
}
function mapStoreType(v) {
  const n = C.norm(v);
  if (n.includes('physi') || n.includes('boutique') || n.includes('showroom')) return 'Physical Store';
  if (n.includes('hybri')) return 'Hybrid';
  return 'Online Only';
}
function mapPlatform(v) {
  const n = C.norm(v);
  if (n.includes('insta')) return 'instagram';
  if (n.includes('tiktok')) return 'tiktok';
  if (n.includes('face') || n.includes('meta')) return 'facebook';
  if (n.includes('web') || n.includes('site')) return 'website';
  return C.PLATFORMS.includes(v) ? v : 'other';
}

/** Whitelist + normalise editable lead fields. `partial` keeps absent keys absent. */
function cleanLeadFields(input, partial) {
  const out = {};
  const set = (k, v) => { if (!partial || input[k] !== undefined) out[k] = v; };
  set('platform', mapPlatform(input.platform || 'facebook'));
  set('storeName', STR(input.storeName, 160));
  set('handle', STR(input.handle, 120));
  set('profileUrl', URL_OK(input.profileUrl));
  set('postUrl', URL_OK(input.postUrl));
  set('postImageUrl', URL_OK(input.postImageUrl));
  set('postCaption', STR(input.postCaption, 3000));
  set('postType', oneOf(input.postType, ['Image / Ad', 'Reel / Video', 'Story', 'Post'], 'Post'));
  set('category', mapCategory(input.category));
  set('storeType', mapStoreType(input.storeType));
  set('wilayaCode', C.WILAYAS.some((w) => w.code === input.wilayaCode) ? input.wilayaCode : '');
  set('wilayaConfirmed', input.wilayaConfirmed === true);
  set('city', STR(input.city, 120));
  set('neighborhood', STR(input.neighborhood, 120));
  set('address', STR(input.address, 300));
  set('googleMapsUrl', URL_OK(input.googleMapsUrl));
  set('ownerName', STR(input.ownerName, 120));
  set('ownerRole', STR(input.ownerRole, 80));
  set('phonePrimary', C.normalizePhone(input.phonePrimary) || '');
  set('phoneSecondary', C.normalizePhone(input.phoneSecondary) || '');
  set('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(STR(input.email, 160)) ? STR(input.email, 160) : '');
  set('estimatedVolume', oneOf(input.estimatedVolume, C.VOLUMES, 'Unknown'));
  set('currentCourier', STR(input.currentCourier, 120));
  set('preferredPickupTime', oneOf(input.preferredPickupTime, C.PICKUP_TIMES, 'Flexible'));
  set('codRequired', input.codRequired !== false);
  set('painPoints', Array.isArray(input.painPoints) ? input.painPoints.filter((p) => C.PAIN_POINTS.includes(p)) : []);
  set('tags', Array.isArray(input.tags) ? input.tags.map((t) => STR(t, 40)).filter(Boolean).slice(0, 20) : []);
  set('stage', oneOf(input.stage, C.STAGE_IDS, 'NEW_DISCOVERED'));
  set('priority', oneOf(input.priority, C.PRIORITIES, 'medium'));
  set('nextFollowUpDate', DATE_OK(input.nextFollowUpDate));
  // Prospects CRM fields
  set('productType', STR(input.productType, 200));
  set('facebookUrl', URL_OK(input.facebookUrl));
  set('instagramUrl', URL_OK(input.instagramUrl));
  set('tiktokUrl', URL_OK(input.tiktokUrl));
  set('whatsappStatus', oneOf(input.whatsappStatus, ['confirmed', 'unverified'], ''));
  set('sellsOnline', input.sellsOnline === true);
  set('open7', input.open7 === true);
  set('googleReviews', INT(input.googleReviews, 0, 1000000) ?? 0);
  set('sourceUrl', URL_OK(input.sourceUrl));
  set('sourceUrl2', URL_OK(input.sourceUrl2));
  set('activityIndex', STR(input.activityIndex, 300));
  set('remarks', STR(input.remarks, 2000));
  set('refusalReason', STR(input.refusalReason, 300));
  if (!partial || input.score !== undefined) {
    const sc = input.score === null || input.score === '' ? null : INT(input.score, 0, 100);
    out.score = sc;
    out.scoreSource = sc === null ? '' : oneOf(input.scoreSource, ['excel', 'manual', 'auto'], 'manual');
  }
  return out;
}

function note(user, fields) {
  return {
    id: db.id('n'), createdAt: new Date().toISOString(), authorId: user ? user.id : 'system',
    authorName: user ? user.name : 'Système', kind: fields.kind || 'interaction',
    channel: oneOf(fields.channel, C.CHANNELS, 'Internal Note'), outcome: oneOf(fields.outcome, C.OUTCOMES, 'Note'),
    content: STR(fields.content, 4000),
  };
}
const sysNote = (user, content) => note(user, { kind: 'system', channel: 'Internal Note', outcome: 'Note', content });

/** Leads the user may see. Agents: only their own. Supervisor: all. */
function visibleLeads(user) {
  if (user.role === 'supervisor') return db.col('leads');
  return db.col('leads').filter((l) => l.ownerId === user.id);
}
function canAccessLead(user, lead) { return !!lead && (user.role === 'supervisor' || lead.ownerId === user.id); }

const today = () => new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 10); // Algeria is UTC+1, no DST

function isPriority(l) {
  const t = today();
  return l.priority === 'high' || (l.nextFollowUpDate && l.nextFollowUpDate < t && !C.CLOSED_STAGES.includes(l.stage))
    || (C.HOT_STAGES.includes(l.stage) && !!l.phonePrimary);
}

const has = (v) => v && v !== 'ALL';
function applyFilters(leads, q) {
  const s = C.norm(q.search || '');
  const t = today();
  const settings = db.ready() ? P.getSettings() : C.DEFAULT_SETTINGS;
  const ids = q.ids ? new Set(String(q.ids).split(',').slice(0, 5000)) : null;
  const scoreMin = q.scoreMin !== undefined && q.scoreMin !== '' ? Number(q.scoreMin) : null;
  const scoreMax = q.scoreMax !== undefined && q.scoreMax !== '' ? Number(q.scoreMax) : null;
  return leads.filter((l) => {
    if (ids && !ids.has(l.id)) return false;
    if (has(q.commune) && C.norm(l.city || '') !== C.norm(q.commune === 'NONE' ? '' : q.commune)) return false;
    if (has(q.tier) || scoreMin !== null || scoreMax !== null) {
      const sc = C.effectiveScore(l, settings);
      if (has(q.tier) && C.tierOf(sc, settings) !== q.tier) return false;
      if (scoreMin !== null && isFinite(scoreMin) && sc < scoreMin) return false;
      if (scoreMax !== null && isFinite(scoreMax) && sc > scoreMax) return false;
    }
    if (has(q.whatsapp)) {
      const w = l.whatsappStatus || '';
      if (q.whatsapp === 'confirmed' && w !== 'confirmed') return false;
      if (q.whatsapp === 'unverified' && w !== 'unverified') return false;
      if (q.whatsapp === 'any' && !w) return false;
      if (q.whatsapp === 'none' && w) return false;
    }
    if (q.facebook === '1' || q.instagram === '1' || q.tiktok === '1') {
      const so = C.socialLinks(l);
      if (q.facebook === '1' && !so.facebook) return false;
      if (q.instagram === '1' && !so.instagram) return false;
      if (q.tiktok === '1' && !so.tiktok) return false;
    }
    if (q.online === '1' && !l.sellsOnline) return false;
    if (q.phone === 'yes' && !l.phonePrimary) return false;
    if (q.phone === 'no' && l.phonePrimary) return false;
    if (q.contact === 'contacted' && !C.CONTACTED_STAGES.includes(l.stage)) return false;
    if (q.contact === 'not' && C.CONTACTED_STAGES.includes(l.stage)) return false;
    if (q.stage && q.stage !== 'ALL' && l.stage !== q.stage) return false;
    if (q.agencyId && q.agencyId !== 'ALL' && (l.agencyId || 'NONE') !== q.agencyId) return false;
    if (q.ownerId && q.ownerId !== 'ALL' && l.ownerId !== q.ownerId) return false;
    if (q.wilaya && q.wilaya !== 'ALL' && (l.wilayaCode || 'NONE') !== q.wilaya) return false;
    if (q.category && q.category !== 'ALL' && l.category !== q.category) return false;
    if (q.platform && q.platform !== 'ALL' && l.platform !== q.platform) return false;
    if (q.storeType && q.storeType !== 'ALL' && l.storeType !== q.storeType) return false;
    if (q.priority && q.priority !== 'ALL' && l.priority !== q.priority) return false;
    if (q.due === '1' && !(l.nextFollowUpDate && l.nextFollowUpDate <= t && !C.CLOSED_STAGES.includes(l.stage))) return false;
    if (q.hot === '1' && !isPriority(l)) return false;
    if (s) {
      const hay = C.norm([l.storeName, l.handle, l.phonePrimary, l.phoneSecondary, l.ownerName, l.city, l.neighborhood, l.productType, (l.tags || []).join(' ')].join(' '));
      const digits = s.replace(/\D/g, '');
      if (!hay.includes(s) && !(digits.length >= 4 && hay.includes(digits.replace(/^0/, '')))) return false;
    }
    return true;
  });
}

/* ---------- stats ---------- */
function summarise(leads) {
  const t = today();
  const month = t.slice(0, 7);
  const byStage = Object.fromEntries(C.STAGE_IDS.map((s) => [s, 0]));
  let enriched = 0, contacted = 0, won = 0, wonThisMonth = 0, dueToday = 0, overdue = 0, hot = 0, newThisMonth = 0;
  for (const l of leads) {
    byStage[l.stage] = (byStage[l.stage] || 0) + 1;
    if (l.phonePrimary) enriched++;
    if (C.CONTACTED_STAGES.includes(l.stage)) contacted++;
    if (l.stage === 'WON_EXPEDITEUR') { won++; if ((l.wonAt || '').startsWith(month)) wonThisMonth++; }
    if ((l.discoveredAt || '').startsWith(month)) newThisMonth++;
    const open = !C.CLOSED_STAGES.includes(l.stage);
    if (open && l.nextFollowUpDate === t) dueToday++;
    if (open && l.nextFollowUpDate && l.nextFollowUpDate < t) overdue++;
    if (isPriority(l)) hot++;
  }
  const total = leads.length;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return { total, enriched, contacted, won, wonThisMonth, newThisMonth, dueToday, overdue, hot, byStage,
    qualifiedRate: pct(enriched, total), conversionRate: pct(won, total), contactedConversionRate: pct(won, contacted) };
}

function stats(user, leads) {
  const agencies = db.col('agencies');
  const users = db.col('users');
  const overall = summarise(leads);
  const byAgency = [];
  const agencyIds = user.role === 'supervisor' ? agencies.map((a) => a.id) : [user.agencyId];
  for (const aid of agencyIds) {
    const a = agencies.find((x) => x.id === aid);
    if (!a) continue;
    byAgency.push({ id: a.id, name: a.name, code: a.code, wilayaCode: a.wilayaCode, active: a.active, ...summarise(leads.filter((l) => l.agencyId === a.id)) });
  }
  const unassigned = leads.filter((l) => !l.agencyId);
  if (user.role === 'supervisor' && unassigned.length) byAgency.push({ id: 'NONE', name: null, code: '', ...summarise(unassigned) });
  const ownerIds = user.role === 'supervisor' ? users.map((u) => u.id) : [user.id];
  const byAgent = ownerIds.map((uid) => {
    const u = users.find((x) => x.id === uid);
    const mine = leads.filter((l) => l.ownerId === uid);
    if (!u || (!mine.length && u.role === 'supervisor')) return null;
    return { id: u.id, name: u.name, role: u.role, agencyId: u.agencyId || '', active: u.active, ...summarise(mine) };
  }).filter(Boolean);
  // Activity over the last 8 weeks: interactions logged + wins
  const weeks = [];
  const t = today();
  const now = new Date(t + 'T00:00:00Z');
  for (let i = 7; i >= 0; i--) {
    const start = new Date(now); start.setUTCDate(start.getUTCDate() - now.getUTCDay() - 7 * i + 1);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
    weeks.push({ start: start.toISOString().slice(0, 10), interactions: 0, won: 0, _s: start.getTime(), _e: end.getTime() });
  }
  for (const l of leads) {
    for (const n of l.notes || []) {
      if (n.kind === 'system') continue;
      const ts = Date.parse(n.createdAt);
      const w = weeks.find((x) => ts >= x._s && ts < x._e);
      if (w) w.interactions++;
    }
    if (l.wonAt) { const ts = Date.parse(l.wonAt); const w = weeks.find((x) => ts >= x._s && ts < x._e); if (w) w.won++; }
  }
  weeks.forEach((w) => { delete w._s; delete w._e; });
  return { overall, byAgency, byAgent, weeks, today: t };
}

/* ---------- export ---------- */
const EXPORT_HEADERS = ['Boutique', 'Identifiant', 'Plateforme', 'Catégorie', 'Modèle de vente', 'Code wilaya', 'Wilaya', 'Wilaya confirmée',
  'Ville / Commune', 'Quartier', 'Adresse ramassage', 'Décideur', 'Poste', 'Téléphone', 'Téléphone 2', 'Email', 'Étape', 'Priorité',
  'Prochaine relance', 'Volume estimé', 'Prestataire actuel', 'Créneau ramassage', 'COD', 'Agent', 'Agence', 'URL profil', 'URL post',
  'Découvert le', 'Gagné le', 'Mis à jour le', 'Nb interactions', 'Dernière interaction',
  // Prospects CRM columns (appended: older exports stay importable)
  'Score /100', 'Niveau', 'Origine du score', 'Statut WhatsApp', 'Facebook', 'Instagram', 'TikTok', 'Vente en ligne', 'Type de produits',
  'Indice d’activité', 'Avis Google', 'Ouvert 7j/7', 'Source', 'Source complémentaire', 'Remarques', 'Motif de refus', 'Tentatives de contact', 'Dernier contact', 'Étiquettes'];
const WA_LABEL = { confirmed: 'Confirmé', unverified: 'À vérifier' };
const SCORE_SRC = { excel: 'Fichier Excel', manual: 'Manuel', auto: 'Barème' };
function exportRows(leads) {
  const users = db.col('users'), agencies = db.col('agencies');
  const settings = P.getSettings();
  const catLabel = (id) => (settings.categories.find((c) => c.id === id) || {}).fr || id;
  return leads.map((l) => {
    const sc = C.effectiveScore(l, settings);
    const so = C.socialLinks(l);
    const extra = [sc, C.tierOf(sc, settings), typeof l.score === 'number' ? SCORE_SRC[l.scoreSource] || 'Manuel' : 'Barème', WA_LABEL[l.whatsappStatus] || 'Non disponible',
      so.facebook, so.instagram, so.tiktok, l.sellsOnline ? 'Oui' : 'Non', l.productType || catLabel(l.category), l.activityIndex || '', l.googleReviews || 0,
      l.open7 ? 'Oui' : 'Non', l.sourceUrl || '', l.sourceUrl2 || '', l.remarks || '', l.refusalReason || '', C.contactNotes(l).length,
      (C.lastContactAt(l) || '').slice(0, 10), (l.tags || []).join(', ')];
    const w = C.WILAYAS.find((x) => x.code === l.wilayaCode);
    const inter = (l.notes || []).filter((n) => n.kind !== 'system');
    return [l.storeName, l.handle, l.platform, l.category, l.storeType, l.wilayaCode, w ? w.fr : '', l.wilayaConfirmed ? 'Oui' : 'Non',
      l.city, l.neighborhood, l.address, l.ownerName, l.ownerRole, C.formatPhone(l.phonePrimary), C.formatPhone(l.phoneSecondary), l.email,
      l.stage, l.priority, l.nextFollowUpDate, l.estimatedVolume, l.currentCourier, l.preferredPickupTime, l.codRequired ? 'Oui' : 'Non',
      (users.find((u) => u.id === l.ownerId) || {}).name || '', (agencies.find((a) => a.id === l.agencyId) || {}).name || '',
      l.profileUrl, l.postUrl, (l.discoveredAt || '').slice(0, 10), (l.wonAt || '').slice(0, 10), (l.updatedAt || '').slice(0, 10),
      inter.length, inter[0] ? `${inter[0].createdAt.slice(0, 10)} ${inter[0].channel}: ${inter[0].content}` : '', ...extra];
  });
}

/* ---------- import ---------- */
const HEADER_MAP = {
  boutique: 'storeName', storename: 'storeName', nom: 'storeName', identifiant: 'handle', handle: 'handle', plateforme: 'platform', platform: 'platform',
  categorie: 'category', category: 'category', modeledevente: 'storeType', storetype: 'storeType', codewilaya: 'wilayaCode', wilayacode: 'wilayaCode',
  wilaya: 'wilaya', villecommune: 'city', ville: 'city', city: 'city', quartier: 'neighborhood', neighborhood: 'neighborhood',
  adresseramassage: 'address', address: 'address', decideur: 'ownerName', ownername: 'ownerName', poste: 'ownerRole', telephone: 'phonePrimary',
  phone: 'phonePrimary', phoneprimary: 'phonePrimary', telephone2: 'phoneSecondary', phonesecondary: 'phoneSecondary', email: 'email',
  etape: 'stage', stage: 'stage', priorite: 'priority', priority: 'priority', prochainerelance: 'nextFollowUpDate', nextfollowupdate: 'nextFollowUpDate',
  volumeestime: 'estimatedVolume', estimatedvolume: 'estimatedVolume', prestataireactuel: 'currentCourier', currentcourier: 'currentCourier',
  urlprofil: 'profileUrl', profileurl: 'profileUrl', urlpost: 'postUrl', posturl: 'postUrl', legende: 'postCaption', postcaption: 'postCaption',
  wilayaconfirmee: 'wilayaConfirmed',
  score100: 'score', statutwhatsapp: 'whatsappStatus', facebook: 'facebookUrl', instagram: 'instagramUrl', tiktok: 'tiktokUrl',
  venteenligne: 'sellsOnline', typedeproduits: 'productType', indicedactivite: 'activityIndex', avisgoogle: 'googleReviews', ouvert7j7: 'open7',
  source: 'sourceUrl', sourcecomplementaire: 'sourceUrl2', remarques: 'remarks', motifderefus: 'refusalReason', originedescore: 'scoreOrigin',
};
function rowFromCSV(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) { const key = HEADER_MAP[C.norm(k)]; if (key) o[key] = v; }
  if (o.wilayaConfirmed !== undefined) o.wilayaConfirmed = /^(oui|yes|true|1)$/i.test(o.wilayaConfirmed);
  for (const k of ['sellsOnline', 'open7']) if (o[k] !== undefined) o[k] = /^(oui|yes|true|1)$/i.test(o[k]);
  if (o.whatsappStatus !== undefined) o.whatsappStatus = /^confirm/i.test(o.whatsappStatus) ? 'confirmed' : /v[ée]rifier|unverified/i.test(o.whatsappStatus) ? 'unverified' : '';
  if (o.score !== undefined) {
    // CRM exports say where the score came from: an automatic (barème) score is not frozen on re-import
    if (String(o.score).trim() === '' || /bar[eè]me/i.test(o.scoreOrigin || '')) delete o.score;
    else o.scoreSource = /manuel/i.test(o.scoreOrigin || '') ? 'manual' : 'excel';
  }
  delete o.scoreOrigin;
  return o;
}

/** Turn an external record (Samex export, Swift localStorage export, CSV row) into a lead body. */
function normaliseImported(raw) {
  const r = { ...raw };
  const notesText = (Array.isArray(r.notes) ? r.notes.map((n) => n && n.content).join(' ') : '') + ' ' + (r.postCaption || '');
  if (!r.phonePrimary) {
    const phones = (notesText.match(/(?:\+213|0)\s?[5-7](?:[\s.-]?\d){8}/g) || []).map(C.normalizePhone).filter(Boolean);
    if (phones[0]) r.phonePrimary = phones[0];
    if (phones[1] && !r.phoneSecondary) r.phoneSecondary = phones[1];
  }
  if (!r.wilayaCode) r.wilayaCode = C.wilayaFromText(r.wilaya || r.city || '');
  if (r.wilayaConfirmed === undefined) r.wilayaConfirmed = false;
  if (C.STAGE_IDS.indexOf(r.stage) < 0) r.stage = 'NEW_DISCOVERED';
  if (r.estimatedVolume && !C.VOLUMES.includes(r.estimatedVolume)) {
    const n = C.norm(r.estimatedVolume);
    r.estimatedVolume = n.includes('veryhigh') ? C.VOLUMES[4] : n.includes('high') ? C.VOLUMES[3] : n.includes('medium') ? C.VOLUMES[2] : n.includes('low') ? C.VOLUMES[1] : 'Unknown';
  }
  const body = cleanLeadFields(r, false);
  if (!body.storeName) body.storeName = body.handle || '';
  const notes = Array.isArray(r.notes) ? r.notes.filter((n) => n && n.content).slice(0, 200).map((n) => ({
    id: db.id('n'), createdAt: Date.parse(n.createdAt) ? new Date(n.createdAt).toISOString() : new Date().toISOString(),
    authorId: 'import', authorName: STR(n.authorName || n.author || 'Import', 80), kind: n.kind === 'system' ? 'system' : 'interaction',
    channel: oneOf(n.channel, C.CHANNELS, 'Internal Note'), outcome: oneOf(n.outcome, C.OUTCOMES, 'Note'), content: STR(n.content, 4000),
  })) : [];
  const discoveredAt = Date.parse(r.discoveredAt) ? new Date(r.discoveredAt).toISOString() : new Date().toISOString();
  return { body, notes, discoveredAt };
}
function dedupeKey(l) {
  if (l.profileUrl) return 'u:' + l.profileUrl.toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/(www\.|m\.)?/, '');
  if (l.handle) return 'h:' + l.platform + ':' + l.handle.toLowerCase().replace(/^@/, '');
  if (l.phonePrimary) return 'p:' + l.phonePrimary;
  return 'n:' + C.norm(l.storeName);
}

module.exports = { cleanLeadFields, note, sysNote, visibleLeads, canAccessLead, applyFilters, stats, summarise, isPriority, today, mapCategory,
  EXPORT_HEADERS, exportRows, rowFromCSV, normaliseImported, dedupeKey, STR };
