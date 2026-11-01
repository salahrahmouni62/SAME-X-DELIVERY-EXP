/* Minimal Upstash Redis REST client (Vercel mode). No npm dependency: uses the global fetch of Node 18+.
 * Configured by KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Marketplace) or UPSTASH_REDIS_REST_URL + _TOKEN.
 * The token is read from the environment only; it is never sent to the browser. */
const URL_ = () => (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

const configured = () => !!(URL_() && TOKEN());

/** Run one Redis command, e.g. cmd(['GET', 'key']). Throws on HTTP or Redis errors. */
async function cmd(args) {
  if (!configured()) throw new Error('Redis non configuré (KV_REST_API_URL / KV_REST_API_TOKEN manquants)');
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(URL_(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args.map(String)),
        signal: AbortSignal.timeout(10000),
      });
      break;
    } catch (e) {
      if (attempt >= 2) throw new Error(`Redis injoignable : ${e.message}`);
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  let json;
  try { json = await res.json(); } catch { throw new Error(`Redis : réponse invalide (HTTP ${res.status})`); }
  if (!res.ok || json.error) throw new Error(`Redis : ${json.error || 'HTTP ' + res.status}`);
  return json.result;
}

module.exports = { cmd, configured };
