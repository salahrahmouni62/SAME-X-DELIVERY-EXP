/* Vercel entry point: every URL (pages and /api/*) is routed here by vercel.json and handled by server.js.
 * Data is stored in Upstash Redis on Vercel (see lib/db.js); secrets come only from Vercel environment variables. */
const { Readable } = require('stream');
const { handler } = require('../server');

module.exports = (req, res) => {
  // Recommended setting: NODEJS_HELPERS=0 (server.js reads the raw request body itself).
  // If Vercel's helpers are still enabled they pre-read the body into req.body: hand it back to server.js as a stream.
  if (process.env.NODEJS_HELPERS !== '0' && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && Object.getOwnPropertyDescriptor(req, 'body')) {
    let body;
    try { body = req.body; } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'invalid_json' }));
    }
    const raw = body === undefined || body === null ? '' : Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body);
    const stream = Readable.from(raw.length ? [Buffer.from(raw)] : []);
    Object.assign(stream, { method: req.method, url: req.url, headers: req.headers, socket: req.socket, connection: req.socket });
    return handler(stream, res);
  }
  return handler(req, res);
};
