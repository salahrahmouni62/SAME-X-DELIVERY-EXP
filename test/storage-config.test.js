/* Unit tests of the Upstash Redis configuration resolution (lib/redis.js → resolve), i.e. which environment variables
 * make the CRM use Redis on Vercel, and what it says when they are missing or wrong. No network.
 * Run: node test/storage-config.test.js */
const assert = require('assert');
const { resolve } = require('../lib/redis');

const URL1 = 'https://eu1-proud-cat-12345.upstash.io';
const TOK = 'AYJkASQgNjk2ZTRhOGMtZmFrZS10b2tlbg';
let passed = 0, failed = 0;
const out = [];
function test(name, fn) { try { fn(); passed++; out.push('  ✔ ' + name); } catch (e) { failed++; out.push('  ✘ ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 3).join('\n      ')); } }
const secretFree = (r) => { const pub = JSON.stringify({ source: r.source, problems: r.problems, detected: r.detected }); assert(!pub.includes(TOK) && !pub.includes('upstash.io'), 'public fields contain no secret value: ' + pub); };

test('Vercel Marketplace names KV_REST_API_URL + KV_REST_API_TOKEN', () => {
  const r = resolve({ KV_REST_API_URL: URL1, KV_REST_API_TOKEN: TOK, KV_REST_API_READ_ONLY_TOKEN: 'ro', KV_URL: 'rediss://x', REDIS_URL: 'rediss://x' });
  assert.strictEqual(r.configured, true); assert.strictEqual(r.url, URL1); assert.strictEqual(r.token, TOK);
  assert.deepStrictEqual(r.source, { url: 'KV_REST_API_URL', token: 'KV_REST_API_TOKEN' }); secretFree(r);
});
test('Upstash console names UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN', () => {
  const r = resolve({ UPSTASH_REDIS_REST_URL: URL1 + '/', UPSTASH_REDIS_REST_TOKEN: TOK });
  assert.strictEqual(r.configured, true); assert.strictEqual(r.url, URL1, 'trailing slash removed');
});
test('KV_* wins over UPSTASH_* when both are set (previous behaviour kept)', () => {
  const r = resolve({ KV_REST_API_URL: URL1, KV_REST_API_TOKEN: TOK, UPSTASH_REDIS_REST_URL: 'https://other.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'other' });
  assert.strictEqual(r.source.url, 'KV_REST_API_URL');
});
test('custom prefix from Vercel "Connect Project" (STORAGE_KV_REST_API_*) is found', () => {
  const r = resolve({ STORAGE_KV_REST_API_URL: URL1, STORAGE_KV_REST_API_TOKEN: TOK, STORAGE_KV_REST_API_READ_ONLY_TOKEN: 'ro' });
  assert.strictEqual(r.configured, true); assert.strictEqual(r.token, TOK, 'read-only token never used');
  assert.deepStrictEqual(r.source, { url: 'STORAGE_KV_REST_API_URL', token: 'STORAGE_KV_REST_API_TOKEN' });
});
test('prefixed Upstash names (SAMEX_UPSTASH_REDIS_REST_*) are found', () => {
  assert.strictEqual(resolve({ SAMEX_UPSTASH_REDIS_REST_URL: URL1, SAMEX_UPSTASH_REDIS_REST_TOKEN: TOK }).configured, true);
});
test('two different prefixed databases → refused with a hint, unless REDIS_ENV_PREFIX chooses', () => {
  const env = { A_KV_REST_API_URL: URL1, A_KV_REST_API_TOKEN: TOK, B_KV_REST_API_URL: 'https://b.upstash.io', B_KV_REST_API_TOKEN: 'tb' };
  const r = resolve(env);
  assert.strictEqual(r.configured, false); assert(/REDIS_ENV_PREFIX/.test(r.problems.join(' ')), r.problems.join(' '));
  const r2 = resolve({ ...env, REDIS_ENV_PREFIX: 'B' });
  assert.strictEqual(r2.configured, true); assert.strictEqual(r2.source.url, 'B_KV_REST_API_URL');
  assert.strictEqual(resolve({ ...env, REDIS_ENV_PREFIX: 'C' }).configured, false);
});
test('unprefixed pair wins over prefixed ones', () => {
  const r = resolve({ KV_REST_API_URL: URL1, KV_REST_API_TOKEN: TOK, X_KV_REST_API_URL: 'https://x.upstash.io', X_KV_REST_API_TOKEN: 'x' });
  assert.strictEqual(r.source.url, 'KV_REST_API_URL');
});
test('values pasted with quotes, spaces or a trailing newline are cleaned', () => {
  const r = resolve({ KV_REST_API_URL: `  "${URL1}"  `, KV_REST_API_TOKEN: `'${TOK}'\n` });
  assert.strictEqual(r.configured, true); assert.strictEqual(r.url, URL1); assert.strictEqual(r.token, TOK);
});
test('nothing set → not configured, problem names the expected variables, no related variable detected', () => {
  const r = resolve({ PATH: '/bin', NODE_ENV: 'production', REDIS_PREFIX: 'samex' });
  assert.strictEqual(r.configured, false); assert(/KV_REST_API_URL/.test(r.problems[0])); assert.deepStrictEqual(r.detected, []);
});
test('URL without token, token without URL, and empty values are each explained', () => {
  assert(/KV_REST_API_TOKEN est absent ou vide/.test(resolve({ KV_REST_API_URL: URL1 }).problems.join(' ')));
  assert(/KV_REST_API_URL est absent ou vide/.test(resolve({ KV_REST_API_TOKEN: TOK }).problems.join(' ')));
  const e = resolve({ KV_REST_API_URL: ' ', KV_REST_API_TOKEN: '' });
  assert.strictEqual(e.configured, false); assert(/vides/.test(e.problems.join(' '))); assert(e.detected.every((d) => d.empty));
});
test('a redis:// TCP URL in place of the REST URL is rejected with an explanation (password not echoed)', () => {
  const r = resolve({ KV_REST_API_URL: 'rediss://default:pass123@eu1.upstash.io:6379', KV_REST_API_TOKEN: TOK });
  assert.strictEqual(r.configured, false); assert(/https:\/\//.test(r.problems[0])); assert(!r.problems.join(' ').includes('pass123'));
  const t = resolve({ REDIS_URL: 'rediss://default:pass123@eu1.upstash.io:6379' });
  assert(/REDIS_URL/.test(t.problems[0]) && /REST/.test(t.problems[0])); assert(!JSON.stringify(t.problems).includes('pass123'));
});
test('plain http is refused except for localhost (tests); malformed URL refused', () => {
  assert.strictEqual(resolve({ KV_REST_API_URL: 'http://eu1.upstash.io', KV_REST_API_TOKEN: TOK }).configured, false);
  assert.strictEqual(resolve({ KV_REST_API_URL: 'http://127.0.0.1:9999', KV_REST_API_TOKEN: TOK }).configured, true);
  assert.strictEqual(resolve({ KV_REST_API_URL: 'not a url', KV_REST_API_TOKEN: TOK }).configured, false);
});
test('token containing inner whitespace is refused', () => {
  assert.strictEqual(resolve({ KV_REST_API_URL: URL1, KV_REST_API_TOKEN: 'abc def' }).configured, false);
});
test('diagnostic fields never contain secret values', () => {
  for (const env of [{ KV_REST_API_URL: URL1, KV_REST_API_TOKEN: TOK }, { KV_REST_API_URL: URL1 }, { STORAGE_KV_REST_API_TOKEN: TOK }, { A_KV_REST_API_URL: URL1, A_KV_REST_API_TOKEN: TOK, B_KV_REST_API_URL: URL1, B_KV_REST_API_TOKEN: 'z' }]) secretFree(resolve(env));
});

console.log(out.join('\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
