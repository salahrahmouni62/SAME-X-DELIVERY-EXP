/* Minimal Upstash Redis REST client (Vercel mode). No npm dependency: uses the global fetch of Node 18+.
 *
 * Configuration is read from the environment only (never hard-coded, never sent to the browser or written to logs).
 * Accepted variable pairs, in this order:
 *   1. KV_REST_API_URL         + KV_REST_API_TOKEN          (Vercel Marketplace "Upstash for Redis")
 *   2. UPSTASH_REDIS_REST_URL  + UPSTASH_REDIS_REST_TOKEN   (Upstash console / manual setup)
 *   3. The same names with a prefix, e.g. STORAGE_KV_REST_API_URL + STORAGE_KV_REST_API_TOKEN. Vercel adds such a
 *      prefix when a store is connected with a "Custom Prefix". If several prefixed pairs exist, set REDIS_ENV_PREFIX
 *      (e.g. REDIS_ENV_PREFIX=STORAGE) to choose one.
 * The read-only token (…_READ_ONLY_TOKEN) is never used: the CRM must write.
 * Values are trimmed and surrounding quotes removed (a common copy-paste mistake in the Vercel dashboard). */

const PAIRS = [
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
];
const RELATED = /(KV|REDIS|UPSTASH)/i;
const OWN = new Set(['REDIS_PREFIX', 'REDIS_ENV_PREFIX']); // this app's own settings, not credentials

function clean(v) {
  if (v === undefined || v === null) return '';
  let s = String(v).trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) s = s.slice(1, -1).trim();
  return s;
}

function checkUrl(raw, name) {
  if (/^rediss?:\/\//i.test(raw)) return { problem: `${name} contient une URL de connexion TCP (redis://…). Il faut l'URL REST qui commence par https:// (variable KV_REST_API_URL de l'intégration Upstash).` };
  let u;
  try { u = new URL(raw); } catch { return { problem: `${name} n'est pas une URL valide (elle doit commencer par https://).` }; }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { problem: `${name} doit commencer par https://.` };
  return { url: raw.replace(/\/+$/, '') };
}

/**
 * Work out the Redis configuration from an environment object.
 * Returns { configured, url, token, source: { url, token }, problems: [..], detected: [{ name, empty }] }.
 * `url` and `token` are secrets: only `source`, `problems` and `detected` (variable NAMES) may be shown or logged.
 */
function resolve(env = process.env) {
  const names = Object.keys(env);
  const detected = names.filter((n) => RELATED.test(n) && !OWN.has(n)).sort().map((name) => ({ name, empty: !clean(env[name]) }));
  const forced = clean(env.REDIS_ENV_PREFIX).replace(/_+$/, '');

  // Every (prefix, url var, token var) candidate present in the environment.
  const cands = [];
  for (const name of names) for (const [u, t] of PAIRS) {
    if (name === u || name.endsWith('_' + u)) {
      const prefix = name.slice(0, name.length - u.length);
      cands.push({ prefix, urlName: name, tokenName: prefix + t, url: clean(env[name]), token: clean(env[prefix + t]) });
    }
  }
  // Token present without its URL (e.g. only KV_REST_API_TOKEN) is reported too.
  for (const name of names) for (const [u, t] of PAIRS) {
    if ((name === t || name.endsWith('_' + t)) && !(name.slice(0, name.length - t.length) + u in env)) {
      const prefix = name.slice(0, name.length - t.length);
      cands.push({ prefix, urlName: prefix + u, tokenName: name, url: '', token: clean(env[name]) });
    }
  }

  const base = { configured: false, url: '', token: '', source: null, problems: [], detected };
  let pool = cands;
  if (forced) {
    pool = cands.filter((c) => c.prefix === forced + '_');
    if (!pool.length) base.problems.push(`REDIS_ENV_PREFIX=${forced} mais aucune variable ${forced}_KV_REST_API_URL / ${forced}_UPSTASH_REDIS_REST_URL n'existe.`);
  }
  const complete = pool.filter((c) => c.url && c.token);

  let pick = null;
  const unprefixed = complete.filter((c) => c.prefix === '');
  if (unprefixed.length) pick = unprefixed[0]; // KV_* first, then UPSTASH_* (PAIRS order)
  else {
    const prefixes = [...new Set(complete.map((c) => c.prefix))];
    if (prefixes.length === 1) pick = complete[0];
    else if (prefixes.length > 1) {
      base.problems.push(`Plusieurs bases Redis trouvées (${complete.map((c) => c.urlName).join(', ')}). Ajoutez la variable REDIS_ENV_PREFIX avec le préfixe à utiliser (par exemple ${prefixes[0].replace(/_$/, '')}).`);
    }
  }
  if (pick) pick = PAIRS.map(([u]) => complete.find((c) => c.prefix === pick.prefix && c.urlName === pick.prefix + u)).find(Boolean);

  if (!pick) {
    for (const c of pool) {
      if (c.url && !c.token) base.problems.push(`${c.urlName} est défini mais ${c.tokenName} est absent ou vide.`);
      else if (!c.url && c.token) base.problems.push(`${c.tokenName} est défini mais ${c.urlName} est absent ou vide.`);
      else if (!c.url && !c.token) base.problems.push(`${c.urlName} et ${c.tokenName} existent mais sont vides.`);
    }
    if (!pool.length && !forced) {
      const tcp = detected.filter((d) => /^(.*_)?(KV_URL|REDIS_URL)$/.test(d.name)).map((d) => d.name);
      base.problems.push(tcp.length
        ? `Seule une URL TCP est présente (${tcp.join(', ')}). L'application utilise l'API REST : il faut KV_REST_API_URL et KV_REST_API_TOKEN.`
        : "Aucune variable KV_REST_API_URL / KV_REST_API_TOKEN (ni UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) n'est visible par la fonction.");
    }
    return base;
  }

  const u = checkUrl(pick.url, pick.urlName);
  if (u.problem) { base.problems.push(u.problem); base.source = { url: pick.urlName, token: pick.tokenName }; return base; }
  if (/\s/.test(pick.token)) { base.problems.push(`${pick.tokenName} contient des espaces ou des retours à la ligne.`); base.source = { url: pick.urlName, token: pick.tokenName }; return base; }
  return { ...base, configured: true, url: u.url, token: pick.token, source: { url: pick.urlName, token: pick.tokenName } };
}

/* The environment of a running process (or a Vercel deployment) does not change: resolve once, on first use. */
let cached = null;
const config = () => cached || (cached = resolve(process.env));
const reset = () => { cached = null; };
const configured = () => config().configured;
/** Safe description (names only, no values) for logs and the health endpoint. */
function status() { const c = config(); return { configured: c.configured, source: c.source, problems: c.problems, detected: c.detected }; }

class RedisError extends Error { constructor(message, code) { super(message); this.code = code; } }

/** Run one Redis command, e.g. cmd(['GET', 'key']). Throws RedisError (code storage_unavailable / storage_auth). */
async function cmd(args) {
  const c = config();
  if (!c.configured) throw new RedisError('Redis non configuré : ' + c.problems.join(' '), 'storage_not_configured');
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(c.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args.map(String)),
        signal: AbortSignal.timeout(10000),
      });
      break;
    } catch (e) {
      if (attempt >= 2) throw new RedisError(`Redis injoignable (${c.source.url}) : ${e.name === 'TimeoutError' ? 'délai dépassé' : e.message}`, 'storage_unavailable');
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  if (res.status === 401 || res.status === 403) throw new RedisError(`Redis a refusé le jeton (HTTP ${res.status}) : vérifiez ${c.source.token}.`, 'storage_auth');
  let json;
  try { json = await res.json(); } catch { throw new RedisError(`Redis : réponse invalide (HTTP ${res.status}) — vérifiez que ${c.source.url} est l'URL REST Upstash.`, 'storage_unavailable'); }
  if (!res.ok || json.error) {
    const msg = String(json.error || 'HTTP ' + res.status);
    throw new RedisError(`Redis : ${msg}`, /NOPERM|READONLY|permission/i.test(msg) ? 'storage_auth' : 'storage_unavailable');
  }
  return json.result;
}

/** Round-trip check used by /api/health. Never throws; returns { ok, ms } or { ok: false, error }. */
async function ping() {
  const t = Date.now();
  try { const r = await cmd(['PING']); return { ok: r === 'PONG', ms: Date.now() - t }; }
  catch (e) { return { ok: false, error: e.code || 'storage_unavailable', message: e.message }; }
}

module.exports = { cmd, ping, configured, status, resolve, reset, RedisError };
