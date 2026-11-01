/* Test-only stand-in for the Upstash Redis REST API (the subset used by lib/db.js), run as a separate HTTP server
 * so several CRM processes share one "Redis", like several Vercel instances share one Upstash database.
 * POST / with a JSON array command → { result } ; Bearer token required. Start: node test/fake-upstash.js PORT TOKEN
 * Writing "down" on stdin simulates an outage (HTTP 503), "up" ends it. */
const http = require('http');
const [PORT, TOKEN] = process.argv.slice(2);
const kv = new Map(); const zsets = new Map(); const hashes = new Map();
let down = false;
process.stdin.on('data', (d) => { const s = String(d).trim(); if (s === 'down') down = true; if (s === 'up') down = false; });

const COMMIT_SIG = "local cur = redis.call('GET', KEYS[1]) or '0'";
const range = (len, a, b) => { a = +a; b = +b; if (a < 0) a += len; if (b < 0) b += len; return [Math.max(0, a), Math.min(len - 1, b)]; };
const zsorted = (k) => [...(zsets.get(k) || new Map())].sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1));

function run([c, ...a]) {
  switch (c.toUpperCase()) {
    case 'GET': return kv.has(a[0]) ? kv.get(a[0]) : null;
    case 'SET': kv.set(a[0], a[1]); return 'OK';
    case 'MGET': return a.map((k) => (kv.has(k) ? kv.get(k) : null));
    case 'DEL': return a.reduce((n, k) => n + (kv.delete(k) ? 1 : 0), 0);
    case 'INCR': { const v = Number(kv.get(a[0]) || 0) + 1; kv.set(a[0], String(v)); return v; }
    case 'EVAL': {
      if (!a[0].startsWith(COMMIT_SIG)) throw new Error('ERR fake: unknown script');
      const n = +a[1]; const keys = a.slice(2, 2 + n); const argv = a.slice(2 + n);
      if ((kv.get(keys[0]) || '0') !== argv[0]) return -1;
      for (let i = 1; i < keys.length; i++) kv.set(keys[i], argv[i]);
      return run(['INCR', keys[0]]);
    }
    case 'ZADD': { const z = zsets.get(a[0]) || new Map(); z.set(a[2], +a[1]); zsets.set(a[0], z); return 1; }
    case 'ZREM': { const z = zsets.get(a[0]); return z && z.delete(a[1]) ? 1 : 0; }
    case 'ZRANGE': case 'ZREVRANGE': {
      let s = zsorted(a[0]); if (c.toUpperCase() === 'ZREVRANGE') s = s.reverse();
      const [i, j] = range(s.length, a[1], a[2]); const part = i > j ? [] : s.slice(i, j + 1);
      return a[3] === 'WITHSCORES' ? part.flatMap(([m, sc]) => [m, String(sc)]) : part.map(([m]) => m);
    }
    case 'HSET': { const h = hashes.get(a[0]) || new Map(); h.set(a[1], a[2]); hashes.set(a[0], h); return 1; }
    case 'HMGET': { const h = hashes.get(a[0]) || new Map(); return a.slice(1).map((f) => (h.has(f) ? h.get(f) : null)); }
    case 'HDEL': { const h = hashes.get(a[0]); return h && h.delete(a[1]) ? 1 : 0; }
    case 'KEYS': return [...kv.keys()];
    default: throw new Error('ERR fake: unsupported ' + c);
  }
}
http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const reply = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (down) return reply(503, { error: 'service unavailable' });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: 'Unauthorized' });
    try { const args = JSON.parse(body); if (!args.every((x) => typeof x === 'string')) throw new Error('ERR args must be strings'); reply(200, { result: run(args) }); }
    catch (e) { reply(400, { error: e.message }); }
  });
}).listen(+PORT, '127.0.0.1', () => console.log('ready'));
