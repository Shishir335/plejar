/**
 * A small reader for .xlsx spreadsheets (Excel, Google Sheets, Numbers exports), with no extra
 * packages: an .xlsx file is a zip of XML files. Reads every sheet's cell values as text, in order.
 * Formulas give their last calculated value; formatting, merged cells and dates-as-dates are ignored.
 *
 *   readXlsx(buffer) -> [{ name: 'Sheet1', rows: [['Division', 'District', ...], ...] }, ...]
 */
const zlib = require('zlib');

// ---- zip ----
const unzip = buffer => {
  // The end of central directory record sits in the last 64 KB
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('This is not an .xlsx file (no zip directory found).');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('The .xlsx file is damaged.');
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataAt, dataAt + size);
    files.set(name, () => (method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8'));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
};

// ---- xml ----
const decode = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
};
// All the text in <t> elements (a shared string can be split into formatted runs)
const textOf = xml => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m => decode(m[1])).join('');
const columnIndex = ref => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

const readXlsx = buffer => {
  const files = unzip(buffer);
  const read = name => (files.has(name) ? files.get(name)() : null);
  const shared = [...(read('xl/sharedStrings.xml') || '').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m => textOf(m[1]));
  const workbook = read('xl/workbook.xml');
  if (!workbook) throw new Error('This .xlsx file has no workbook.');
  const rels = new Map([...(read('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)].map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  return [...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map(m => {
    const target = rels.get(attr(m[0], 'r:id')) || '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = read(path) || '';
    const rows = [...xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)].map(row => {
      const cells = [];
      for (const c of row[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const tag = `<c ${c[1]}>`;
        const body = c[2] || '';
        const type = attr(tag, 't');
        const v = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
        let value = '';
        if (type === 's' && v) value = shared[Number(v[1])] || '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (v) value = decode(v[1]);
        cells[columnIndex(attr(tag, 'r') || 'A1')] = value.trim();
      }
      return Array.from(cells, x => x || '');
    }).filter(r => r.some(Boolean));
    return { name: attr(m[0], 'name') || 'Sheet', rows };
  });
};

module.exports = { readXlsx };
