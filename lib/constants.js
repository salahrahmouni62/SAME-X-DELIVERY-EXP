/* Shared constants — loaded by the server (require) and the browser (window.SAMEX_C). */
(function (root) {
  const STAGES = [
    { id: 'NEW_DISCOVERED', color: '#8A8A8A' },
    { id: 'ENRICHED', color: '#333333' },
    { id: 'CONTACTED', color: '#C99A00' },
    { id: 'REPLIED', color: '#B98F00' },
    { id: 'INTERESTED', color: '#E0A800' },
    { id: 'NEGOTIATION', color: '#F0B400' },
    { id: 'MEETING_SCHEDULED', color: '#FFC800' },
    { id: 'TRIAL_DELIVERY', color: '#2F6FED' },
    { id: 'WON_EXPEDITEUR', color: '#16A34A' },
    { id: 'FOLLOW_UP', color: '#7C5CBF' },
    { id: 'LOST', color: '#B91C1C' },
  ];
  const STAGE_IDS = STAGES.map((s) => s.id);
  // Stages that count as "contacted or later" for conversion maths
  const CONTACTED_STAGES = ['CONTACTED', 'REPLIED', 'INTERESTED', 'NEGOTIATION', 'MEETING_SCHEDULED', 'TRIAL_DELIVERY', 'WON_EXPEDITEUR', 'FOLLOW_UP', 'LOST'];
  const HOT_STAGES = ['INTERESTED', 'NEGOTIATION', 'MEETING_SCHEDULED', 'TRIAL_DELIVERY'];
  const CLOSED_STAGES = ['WON_EXPEDITEUR', 'LOST'];

  // Built-in category ids (kept for existing data). Labels, extra categories and their scoring weight live in the
  // editable CRM settings (DEFAULT_SETTINGS below); `CATEGORIES` stays as the fallback list.
  const CATEGORIES = ['Fashion', 'Footwear', 'Cosmetics', 'Perfumes', 'Electronics', 'Accessories', 'Jewelry', 'Home', 'Food', 'Sweets', 'Baby', 'Health', 'Sport', 'Other'];
  const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'website', 'other'];
  const STORE_TYPES = ['Online Only', 'Physical Store', 'Hybrid'];
  const VOLUMES = ['Unknown', 'Low (1-5 pkgs/day)', 'Medium (6-20 pkgs/day)', 'High (20-50 pkgs/day)', 'Very High (50+ pkgs/day)'];
  const PICKUP_TIMES = ['Morning (8h-12h)', 'Afternoon (14h-18h)', 'Flexible'];
  const PRIORITIES = ['high', 'medium', 'low'];
  const CHANNELS = ['WhatsApp', 'Phone Call', 'Instagram DM', 'Facebook Messenger', 'Store Visit', 'Email', 'Internal Note'];
  const OUTCOMES = ['Interested', 'Agreed on Trial', 'Needs Price Sheet', 'Follow-up Set', 'Busy / Call Later', 'No Answer', 'Not Interested', 'Note'];
  const PAIN_POINTS = ['cod_delay', 'damaged', 'fitting_refusal', 'no_pickup', 'slow_south', 'cancellations'];

  const WILAYAS = [
    ['01', 'Adrar', 'أدرار'], ['02', 'Chlef', 'الشلف'], ['03', 'Laghouat', 'الأغواط'], ['04', 'Oum El Bouaghi', 'أم البواقي'],
    ['05', 'Batna', 'باتنة'], ['06', 'Béjaïa', 'بجاية'], ['07', 'Biskra', 'بسكرة'], ['08', 'Béchar', 'بشار'],
    ['09', 'Blida', 'البليدة'], ['10', 'Bouira', 'البويرة'], ['11', 'Tamanrasset', 'تمنراست'], ['12', 'Tébessa', 'تبسة'],
    ['13', 'Tlemcen', 'تلمسان'], ['14', 'Tiaret', 'تيارت'], ['15', 'Tizi Ouzou', 'تيزي وزو'], ['16', 'Alger', 'الجزائر'],
    ['17', 'Djelfa', 'الجلفة'], ['18', 'Jijel', 'جيجل'], ['19', 'Sétif', 'سطيف'], ['20', 'Saïda', 'سعيدة'],
    ['21', 'Skikda', 'سكيكدة'], ['22', 'Sidi Bel Abbès', 'سيدي بلعباس'], ['23', 'Annaba', 'عنابة'], ['24', 'Guelma', 'قالمة'],
    ['25', 'Constantine', 'قسنطينة'], ['26', 'Médéa', 'المدية'], ['27', 'Mostaganem', 'مستغانم'], ['28', "M'Sila", 'المسيلة'],
    ['29', 'Mascara', 'معسكر'], ['30', 'Ouargla', 'ورقلة'], ['31', 'Oran', 'وهران'], ['32', 'El Bayadh', 'البيض'],
    ['33', 'Illizi', 'إليزي'], ['34', 'Bordj Bou Arréridj', 'برج بوعريريج'], ['35', 'Boumerdès', 'بومرداس'], ['36', 'El Tarf', 'الطارف'],
    ['37', 'Tindouf', 'تندوف'], ['38', 'Tissemsilt', 'تيسمسيلت'], ['39', 'El Oued', 'الوادي'], ['40', 'Khenchela', 'خنشلة'],
    ['41', 'Souk Ahras', 'سوق أهراس'], ['42', 'Tipaza', 'تيبازة'], ['43', 'Mila', 'ميلة'], ['44', 'Aïn Defla', 'عين الدفلى'],
    ['45', 'Naâma', 'النعامة'], ['46', 'Aïn Témouchent', 'عين تموشنت'], ['47', 'Ghardaïa', 'غرداية'], ['48', 'Relizane', 'غليزان'],
    ['49', 'Timimoun', 'تيميمون'], ['50', 'Bordj Badji Mokhtar', 'برج باجي مختار'], ['51', 'Ouled Djellal', 'أولاد جلال'],
    ['52', 'Béni Abbès', 'بني عباس'], ['53', 'In Salah', 'عين صالح'], ['54', 'In Guezzam', 'عين قزام'], ['55', 'Touggourt', 'تقرت'],
    ['56', 'Djanet', 'جانت'], ['57', "El M'Ghair", 'المغير'], ['58', 'El Meniaa', 'المنيعة'],
  ].map(([code, fr, ar]) => ({ code, fr, ar }));

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
  }
  function wilayaFromText(text) {
    const n = norm(text);
    if (!n) return '';
    const m = String(text).match(/\b(0?[1-9]|[1-4]\d|5[0-8])\b/);
    for (const w of WILAYAS) if (n === norm(w.fr) || n === norm(w.ar)) return w.code;
    for (const w of WILAYAS) if (norm(w.fr).length > 3 && n.includes(norm(w.fr))) return w.code;
    if (m && /^\d+$/.test(String(text).trim())) return m[1].padStart(2, '0');
    if (n === 'algiers' || n === 'algercentre') return '16';
    return '';
  }

  /** Normalise an Algerian number to +213XXXXXXXXX. Returns '' if invalid. */
  function normalizePhone(raw) {
    let d = String(raw || '').replace(/[^\d+]/g, '');
    if (!d) return '';
    if (d.startsWith('+213')) d = d.slice(4);
    else if (d.startsWith('00213')) d = d.slice(5);
    else if (d.startsWith('213') && d.length >= 11) d = d.slice(3);
    if (d.startsWith('0')) d = d.slice(1);
    d = d.replace(/\D/g, '');
    if (/^[567]\d{8}$/.test(d) || /^[234]\d{7}$/.test(d)) return '+213' + d;
    return '';
  }
  function formatPhone(p) {
    const n = normalizePhone(p);
    if (!n) return p || '';
    const d = n.slice(4);
    if (d.length === 9) return `+213 ${d[0]} ${d.slice(1, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7)}`;
    return `+213 ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 6)} ${d.slice(6)}`;
  }

  /* ---------- Prospects CRM: editable settings (stored server-side in meta/settings) ---------- */
  const DEFAULT_SETTINGS = {
    version: 1,
    categories: [
      { id: 'Fashion', fr: 'Vêtements & Mode', ar: 'ملابس وأزياء', weight: 15, active: true },
      { id: 'Footwear', fr: 'Chaussures', ar: 'أحذية', weight: 15, active: true },
      { id: 'Cosmetics', fr: 'Cosmétiques & Parfums', ar: 'مستحضرات تجميل وعطور', weight: 15, active: true },
      { id: 'Electronics', fr: 'Téléphones & Électronique', ar: 'هواتف وإلكترونيات', weight: 15, active: true },
      { id: 'Accessories', fr: 'Accessoires', ar: 'إكسسوارات', weight: 15, active: true },
      { id: 'Home', fr: 'Maison & Décoration', ar: 'منزل وديكور', weight: 8, active: true },
      { id: 'Food', fr: 'Alimentation', ar: 'مواد غذائية', weight: 8, active: true },
      { id: 'Baby', fr: 'Bébé & Enfants', ar: 'أطفال ورضع', weight: 15, active: true },
      { id: 'Sport', fr: 'Sport', ar: 'رياضة', weight: 8, active: true },
      { id: 'Perfumes', fr: 'Parfums & musc', ar: 'عطور ومسك', weight: 15, active: true },
      { id: 'Jewelry', fr: 'Bijoux & montres', ar: 'مجوهرات وساعات', weight: 15, active: true },
      { id: 'Sweets', fr: 'Gâteaux & gourmandises', ar: 'حلويات', weight: 8, active: true },
      { id: 'Health', fr: 'Santé & nutrition', ar: 'صحة وتغذية', weight: 8, active: true },
      { id: 'Other', fr: 'Autres', ar: 'أخرى', weight: 5, active: true },
    ],
    // Barème of the "Prospects_Batna_SAMEX.xlsx" file (sheet « Système de score »), unchanged.
    scoring: {
      mobile: 25, fixed: 10, perSocial: 10, socialCap: 20, online: 20,
      reviews20: 10, reviews8: 7, reviews3: 4, open7: 5, activityCap: 15,
      homeCommune: 'Batna', home: 5, other: 3, aMin: 55, bMin: 45,
    },
  };
  const SCORING_KEYS = Object.keys(DEFAULT_SETTINGS.scoring).filter((k) => k !== 'homeCommune');

  const isMobile = (p) => /^\+213[567]\d{8}$/.test(normalizePhone(p));
  /** Facebook / Instagram / TikTok links of a lead (dedicated fields, or the main profile URL of that platform). */
  function socialLinks(l) {
    const fromProfile = (pf) => (l.platform === pf && /^https?:\/\//i.test(l.profileUrl || '') ? l.profileUrl : '');
    return { facebook: l.facebookUrl || fromProfile('facebook'), instagram: l.instagramUrl || fromProfile('instagram'), tiktok: l.tiktokUrl || fromProfile('tiktok') };
  }
  /** Score /100 computed with the barème (same formula as the Excel file). */
  function autoScore(l, settings) {
    const sc = { ...DEFAULT_SETTINGS.scoring, ...((settings && settings.scoring) || {}) };
    const cats = (settings && settings.categories) || DEFAULT_SETTINGS.categories;
    const ph = normalizePhone(l.phonePrimary);
    let s = ph ? (isMobile(ph) ? sc.mobile : sc.fixed) : 0;
    const soc = socialLinks(l);
    s += Math.min(sc.socialCap, sc.perSocial * [soc.facebook, soc.instagram, soc.tiktok].filter(Boolean).length);
    if (l.sellsOnline) s += sc.online;
    const cat = cats.find((c) => c.id === l.category);
    s += cat ? Number(cat.weight) || 0 : 0;
    const r = Number(l.googleReviews) || 0;
    s += Math.min(sc.activityCap, (r >= 20 ? sc.reviews20 : r >= 8 ? sc.reviews8 : r >= 3 ? sc.reviews3 : 0) + (l.open7 ? sc.open7 : 0));
    s += norm(l.city) && norm(l.city) === norm(sc.homeCommune) ? sc.home : sc.other;
    return Math.max(0, Math.min(100, Math.round(s)));
  }
  /** Score used everywhere: the stored one (Excel import or manual) or else the automatic one. */
  function effectiveScore(l, settings) { return typeof l.score === 'number' && isFinite(l.score) ? l.score : autoScore(l, settings); }
  function tierOf(score, settings) {
    const sc = { ...DEFAULT_SETTINGS.scoring, ...((settings && settings.scoring) || {}) };
    return score >= sc.aMin ? 'A' : score >= sc.bMin ? 'B' : 'C';
  }
  /** Interactions with the merchant (internal notes and system entries excluded). */
  const contactNotes = (l) => (l.notes || []).filter((n) => n.kind !== 'system' && n.channel !== 'Internal Note');
  function lastContactAt(l) { const n = contactNotes(l); return n.length ? n.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).createdAt : ''; }

  const C = {
    STAGES, STAGE_IDS, CONTACTED_STAGES, HOT_STAGES, CLOSED_STAGES, CATEGORIES, DEFAULT_SETTINGS, SCORING_KEYS,
    isMobile, socialLinks, autoScore, effectiveScore, tierOf, contactNotes, lastContactAt, PLATFORMS, STORE_TYPES, VOLUMES,
    PICKUP_TIMES, PRIORITIES, CHANNELS, OUTCOMES, PAIN_POINTS, WILAYAS,
    wilayaFromText, normalizePhone, formatPhone, norm,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  else root.SAMEX_C = C;
})(typeof window !== 'undefined' ? window : globalThis);
