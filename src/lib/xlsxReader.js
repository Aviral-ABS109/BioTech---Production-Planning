// Minimal .xlsx reader: returns one worksheet as a 2-D array of cell values
// (strings / numbers / booleans / null). An .xlsx file is a zip of XML files;
// we read workbook.xml → the chosen sheet → its cells, resolving shared and
// inline strings. No styles; formulas are read as their cached values.
import JSZip from 'jszip';

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
// match on localName so namespaces/prefixes in the XML don't matter
const kids = (el, name) => Array.from(el?.getElementsByTagName('*') || []).filter((n) => n.localName === name);
const first = (el, name) => kids(el, name)[0] || null;

// ── fast text scanners for the two big parts (shared strings, sheet cells) ──
// A DOM parse of these is slow on large workbooks; plain regex scanning is
// enough because their structure is fixed by the file format.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const P = '(?:[\\w-]+:)?'; // optional namespace prefix, e.g. <x:c>
const runText = (xml) => {
  // phonetic runs (<rPh>) are not part of the visible text
  const body = xml.replace(new RegExp(`<${P}rPh\\b[\\s\\S]*?</${P}rPh>`, 'g'), '');
  let out = '';
  const re = new RegExp(`<${P}t(?:\\s[^>]*)?>([\\s\\S]*?)</${P}t>`, 'g');
  for (let m; (m = re.exec(body)); ) out += m[1];
  return decodeXml(out);
};
export function parseSharedStrings(xml) {
  const out = [];
  const re = new RegExp(`<${P}si(?:\\s[^>]*)?>([\\s\\S]*?)</${P}si>|<${P}si\\s*/>`, 'g');
  for (let m; (m = re.exec(xml)); ) out.push(m[1] === undefined ? '' : runText(m[1]));
  return out;
}
function* scanCells(xml) {
  const re = new RegExp(`<${P}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}c>)`, 'g');
  const vRe = new RegExp(`<${P}v(?:\\s[^>]*)?>([\\s\\S]*?)</${P}v>`);
  const isRe = new RegExp(`<${P}is(?:\\s[^>]*)?>([\\s\\S]*?)</${P}is>`);
  for (let m; (m = re.exec(xml)); ) {
    const attrs = m[1];
    const ref = /\br="([^"]+)"/.exec(attrs)?.[1];
    const t = /\bt="([^"]+)"/.exec(attrs)?.[1] || null;
    const inner = m[2] || '';
    const v = vRe.exec(inner)?.[1];
    const is = t === 'inlineStr' ? isRe.exec(inner)?.[1] : undefined;
    yield { ref, t, v: v === undefined ? null : decodeXml(v), inline: is === undefined ? null : runText(is) };
  }
}

/** "AB12" → { col: 27, row: 11 } (zero-based) */
export function decodeRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref || '');
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

/**
 * Reads the first sheet whose name matches one of `preferredNames`
 * (case-insensitive), otherwise the first sheet. Returns { name, rows }.
 */
export async function readSheet(arrayBuffer, preferredNames = []) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const read = async (p) => (zip.file(p) ? zip.file(p).async('string') : null);

  const wb = await read('xl/workbook.xml');
  if (!wb) throw new Error('Not a valid .xlsx file (workbook.xml missing).');
  const sheets = kids(parseXml(wb), 'sheet');
  if (!sheets.length) throw new Error('The workbook has no sheets.');
  const wanted = preferredNames.map((n) => n.trim().toLowerCase());
  const sheetEl = sheets.find((s) => wanted.includes((s.getAttribute('name') || '').trim().toLowerCase())) || sheets[0];
  const sheetName = sheetEl.getAttribute('name') || 'Sheet1';
  const rid = sheetEl.getAttribute('r:id') || Array.from(sheetEl.attributes).find((a) => a.localName === 'id')?.value;

  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rels = await read('xl/_rels/workbook.xml.rels');
  if (rels && rid) {
    const rel = kids(parseXml(rels), 'Relationship').find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }

  const sst = await read('xl/sharedStrings.xml');
  const shared = sst ? parseSharedStrings(sst) : [];

  const sheetXml = await read(sheetPath);
  if (!sheetXml) throw new Error(`Worksheet not found (${sheetPath}).`);
  const grid = [];
  let maxCol = 0;
  for (const { ref, t, v, inline } of scanCells(sheetXml)) {
    const pos = decodeRef(ref);
    if (!pos) continue;
    let value = null;
    if (t === 's') value = v != null ? shared[Number(v)] ?? '' : null;
    else if (t === 'inlineStr') value = inline ?? '';
    else if (t === 'str') value = v ?? '';
    else if (t === 'b') value = v === '1';
    else if (t === 'e') value = null; // #N/A, #REF! etc.
    else if (v != null && v !== '') value = Number(v);
    if (value === '') value = null;
    (grid[pos.row] ||= [])[pos.col] = value;
    if (pos.col + 1 > maxCol) maxCol = pos.col + 1;
  }
  // fill holes so every row has the same length
  const out = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    out.push(Array.from({ length: maxCol }, (_, i) => (row[i] === undefined ? null : row[i])));
  }
  return { name: sheetName, rows: out };
}

/** Backwards-compatible helper: first sheet as a 2-D array. */
export async function readFirstSheet(arrayBuffer) {
  return (await readSheet(arrayBuffer)).rows;
}
