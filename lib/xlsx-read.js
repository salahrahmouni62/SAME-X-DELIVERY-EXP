/* Minimal XLSX reader (no dependencies): unzip with zlib, then read the workbook, shared strings and sheet cells.
 * Supports shared strings, inline strings, formula results (cached values), numbers and booleans.
 * Guards: file size, number of zip entries, total uncompressed size (zip bombs), only the parts that are needed. */
const zlib = require('zlib');

const MAX_FILE = 8 * 1024 * 1024;
const MAX_UNZIPPED = 60 * 1024 * 1024;
const MAX_ENTRIES = 2000;

class XlsxError extends Error { constructor(msg) { super(msg); this.code = 'xlsx_invalid'; } }

function unzip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new XlsxError('not a zip file');
  if (buf.length > MAX_FILE) throw new XlsxError('file too large');
  // End of central directory: scan the last 64 KB backwards
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new XlsxError('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new XlsxError('too many entries');
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError('corrupt zip directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    entries.set(name, { method, csize, usize, off });
    p += 46 + nlen + xlen + clen;
  }
  let total = 0;
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.off + 30 > buf.length || buf.readUInt32LE(e.off) !== 0x04034b50) throw new XlsxError('corrupt zip entry');
      const start = e.off + 30 + buf.readUInt16LE(e.off + 26) + buf.readUInt16LE(e.off + 28);
      const data = buf.slice(start, start + e.csize);
      total += e.usize;
      if (total > MAX_UNZIPPED) throw new XlsxError('uncompressed content too large');
      let out;
      if (e.method === 0) out = data;
      else if (e.method === 8) out = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, Math.min(MAX_UNZIPPED, e.usize || MAX_UNZIPPED)) });
      else throw new XlsxError('unsupported compression');
      return out.toString('utf8');
    },
  };
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]);
const attr = (tag, name) => { const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"')); return m ? decode(m[1]) : null; };
/** Text of every <t> inside a string item (rich text runs included, phonetic runs excluded). */
const itemText = (xml) => decode((xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').match(/<t\b[^>]*>[\s\S]*?<\/t>|<t\b[^>]*\/>/g) || [])
  .map((t) => t.replace(/^<t\b[^>]*>|<\/t>$/g, '').replace(/^<t\b[^>]*\/>$/, '')).join(''));
function colIndex(ref) { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }

/** Read a workbook → [{ name, rows: [[cell, …], …] }] (cells: string | number | boolean | ''). */
function readWorkbook(buf) {
  const z = unzip(buf);
  const wb = z.read('xl/workbook.xml');
  if (!wb) throw new XlsxError('not an Excel workbook');
  const relsXml = z.read('xl/_rels/workbook.xml.rels') || '';
  const rels = {};
  for (const r of relsXml.match(/<Relationship\b[^>]*>/g) || []) rels[attr(r, 'Id')] = attr(r, 'Target');
  const ssXml = z.read('xl/sharedStrings.xml') || '';
  const shared = (ssXml.match(/<si\b[^>]*>[\s\S]*?<\/si>|<si\b[^>]*\/>/g) || []).map(itemText);
  const sheets = [];
  for (const tag of wb.match(/<sheet\b[^>]*>/g) || []) {
    const name = attr(tag, 'name');
    const rid = attr(tag, 'r:id');
    let target = rels[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const xml = z.read(target);
    if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const rIdx = Number(attr('<row' + (rm[1] || rm[3] || '') + '>', 'r')) || rows.length + 1;
      const row = [];
      let next = 0;
      for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = '<c' + cm[1] + '>';
        const body = cm[2] || '';
        let ci = colIndex(attr(head, 'r'));
        if (ci < 0) ci = next;
        next = ci + 1;
        const type = attr(head, 't');
        const v = (body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (type === 's') val = v !== undefined ? shared[Number(v)] ?? '' : '';
        else if (type === 'inlineStr') val = itemText((body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/) || [])[1] || '');
        else if (type === 'str' || type === 'e') val = v !== undefined ? decode(v) : '';
        else if (type === 'b') val = v === '1';
        else if (v !== undefined) { const n = Number(v); val = isFinite(n) ? n : decode(v); }
        row[ci] = val;
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      rows[rIdx - 1] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    sheets.push({ name, rows });
  }
  return sheets;
}

/** Rows → objects using the first row whose cells match `isHeader` (or the first non-empty row) as headers. */
function sheetObjects(sheet, isHeader) {
  const rows = sheet.rows;
  let h = rows.findIndex((r) => r.some((c) => String(c).trim()) && (!isHeader || isHeader(r)));
  if (h < 0) return { headers: [], records: [] };
  const headers = rows[h].map((c) => String(c).trim());
  const records = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((c) => String(c).trim() !== '')) continue;
    const o = {};
    headers.forEach((k, j) => { if (k) o[k] = r[j] === undefined ? '' : r[j]; });
    o.__row = i + 1;
    records.push(o);
  }
  return { headers, records };
}

module.exports = { readWorkbook, sheetObjects, XlsxError, colIndex };
