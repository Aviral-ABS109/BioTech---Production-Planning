// Reads the client's demand plan sheet. New long format:
//   Plant | Type | Model | FG Code 1 | FG Code 2 | Range | Power | Cyl | Country | 3X | 2X | 1X | ZERO | Open Orders | Dist. Shortages
// Old wide format (still accepted):
//   Plant | Type | Model | FG Code 1 | FG Code 2 | Range | Power | Cyl. |
//   <Country A: 3X 2X 1X ZERO Open Orders> <Country B: …> … | Dist. Shortages | totals…
// Country names sit in a row above the header row and are not always aligned
// with their block, so a block is detected from the "3X" header and its name is
// the text found above any of the block's columns. Pure functions (unit-tested).
import { readSheet } from './xlsxReader.js';
import { FIXED_HEADERS, REQUIRED_HEADERS, BUCKET_HEADERS } from '../config.js';

export const norm = (h) => String(h ?? '').toLowerCase().replace(/[\s._\-]+/g, '');
const clean = (v) => (v === null || v === undefined ? '' : String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim());

/** 0 → "A", 26 → "AA" */
export function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const FIXED_INDEX = Object.fromEntries(
  Object.entries(FIXED_HEADERS).flatMap(([key, aliases]) => aliases.map((a) => [norm(a), key]))
);
const BUCKET_INDEX = Object.fromEntries(
  Object.entries(BUCKET_HEADERS).flatMap(([key, aliases]) => aliases.map((a) => [norm(a), key]))
);

/** First row (within the first 30) that has Plant + FG Code 1 headers. */
export function findHeaderRow(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const keys = new Set((rows[r] || []).map((c) => FIXED_INDEX[norm(c)]).filter(Boolean));
    if (REQUIRED_HEADERS.every((k) => keys.has(k))) return r;
  }
  return -1;
}

/**
 * Works out the column layout from the header row.
 * Returns { fixed: {key: colIndex}, blocks: [{country, from, to, cols: {x3: i, …}}], ignored: [..], errors: [..] }
 */
export function mapLayout(rows, headerIdx) {
  const header = rows[headerIdx] || [];
  const fixed = {};
  const blocks = [];
  const ignored = [];
  const errors = [];
  let open = null; // block being filled

  header.forEach((cell, i) => {
    const h = norm(cell);
    if (!h) { open = null; return; }
    const bucket = BUCKET_INDEX[h];
    if (bucket === 'x3') {
      open = { from: i, to: i, cols: { x3: i } };
      blocks.push(open);
      return;
    }
    if (bucket && open && open.cols[bucket] === undefined) {
      open.cols[bucket] = i;
      open.to = i;
      return;
    }
    open = null;
    const key = FIXED_INDEX[h];
    if (key && fixed[key] === undefined) fixed[key] = i;
    else ignored.push(`${colLetter(i)} "${clean(cell)}"`);
  });

  // country label: nearest non-empty text above the header within the block's columns
  for (const b of blocks) {
    let name = '';
    for (let r = headerIdx - 1; r >= 0 && !name; r--) {
      for (let c = b.from; c <= b.to && !name; c++) {
        const v = rows[r]?.[c];
        if (typeof v === 'string' && clean(v)) name = clean(v);
      }
    }
    b.country = name;
    b.label = `${colLetter(b.from)}–${colLetter(b.to)}`;
    if (!name) errors.push(`No country name found above columns ${b.label}.`);
    for (const [k, label] of [['x2', '2X'], ['x1', '1X'], ['zero', 'ZERO']]) {
      if (b.cols[k] === undefined) errors.push(`${name || b.label}: column ${label} not found.`);
    }
  }
  for (const k of REQUIRED_HEADERS) {
    if (fixed[k] === undefined) errors.push(`Required column "${FIXED_HEADERS[k][0]}" not found.`);
  }
  if (!blocks.length) errors.push('No country columns found (expected 3X, 2X, 1X, ZERO, Open Orders under each country).');
  const seen = new Set();
  for (const b of blocks) {
    const k = norm(b.country);
    if (k && seen.has(k)) errors.push(`Country "${b.country}" appears twice in the header.`);
    seen.add(k);
  }
  return { fixed, blocks, ignored, errors };
}

/** Column layout of the long format: fixed columns + one set of quantities + Country. */
export function mapLongLayout(rows, headerIdx) {
  const header = rows[headerIdx] || [];
  const cols = {};
  const ignored = [];
  header.forEach((cell, i) => {
    const h = norm(cell);
    if (!h) return;
    const key = FIXED_INDEX[h] || BUCKET_INDEX[h];
    if (key && cols[key] === undefined) cols[key] = i;
    else ignored.push(`${colLetter(i)} "${clean(cell)}"`);
  });
  const errors = [];
  for (const k of REQUIRED_HEADERS) {
    if (cols[k] === undefined) errors.push(`Required column "${FIXED_HEADERS[k][0]}" not found.`);
  }
  for (const [k, label] of [['x3', '3X'], ['x2', '2X'], ['x1', '1X'], ['zero', 'ZERO']]) {
    if (cols[k] === undefined) errors.push(`Column ${label} not found.`);
  }
  return { cols, ignored, errors };
}

const lineBase = (row, get, r) => ({
  excelRow: r + 1,
  plant: clean(get('plant')),
  type: clean(get('type')),
  model: clean(get('model')),
  fg1: clean(get('fg1')),
  fg2: clean(get('fg2')),
  range: clean(get('range')),
  power: get('power'),
  cyl: clean(get('cyl')),
  dist: get('dist'),
  fileTotal: get('fileTotal'),
});

/**
 * Turns sheet rows into demand LINES — one per FG code per country — from either
 *  - the long format (a Country column, one row per FG code per country), or
 *  - the old wide format (countries side by side), which is split into lines.
 */
export function rowsToDemand(rows) {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    throw new Error('Header row not found. The sheet needs columns Plant, Type and FG Code 1 in one row.');
  }
  const headerKeys = new Set((rows[headerIdx] || []).map((c) => FIXED_INDEX[norm(c)]).filter(Boolean));
  const lines = [];

  if (headerKeys.has('country')) {
    const { cols, ignored, errors } = mapLongLayout(rows, headerIdx);
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const get = (k) => (cols[k] === undefined ? null : row[cols[k]]);
      const base = lineBase(row, get, r);
      if (!base.plant && !base.fg1 && !clean(get('country'))) continue; // empty row
      lines.push({
        ...base,
        country: clean(get('country')),
        x3: get('x3'), x2: get('x2'), x1: get('x1'), zero: get('zero'), open: get('open'),
        hasOpen: cols.open !== undefined,
      });
    }
    const countries = [...new Set(lines.map((l) => l.country).filter(Boolean))].map((name) => ({ name, columns: 'Country column', hasOpen: cols.open !== undefined }));
    return { format: 'long', lines, headerRow: headerIdx + 1, countries, hasDist: cols.dist !== undefined, ignoredColumns: ignored, layoutErrors: errors };
  }

  // old wide format
  const layout = mapLayout(rows, headerIdx);
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const get = (k) => (layout.fixed[k] === undefined ? null : row[layout.fixed[k]]);
    const base = lineBase(row, get, r);
    if (!base.plant && !base.fg1) continue;
    for (const b of layout.blocks) {
      lines.push({
        ...base,
        country: b.country,
        x3: row[b.cols.x3],
        x2: b.cols.x2 === undefined ? null : row[b.cols.x2],
        x1: b.cols.x1 === undefined ? null : row[b.cols.x1],
        zero: b.cols.zero === undefined ? null : row[b.cols.zero],
        open: b.cols.open === undefined ? null : row[b.cols.open],
        hasOpen: b.cols.open !== undefined,
      });
    }
  }
  return {
    format: 'wide',
    lines,
    headerRow: headerIdx + 1,
    countries: layout.blocks.map((b) => ({ name: b.country, columns: b.label, hasOpen: b.cols.open !== undefined })),
    hasDist: layout.fixed.dist !== undefined,
    ignoredColumns: layout.ignored,
    layoutErrors: layout.errors,
  };
}

export async function parseDemandFile(file) {
  if (!/\.xls[xm]$/i.test(file.name)) {
    throw new Error('Please upload an .xlsx file (Excel 2007 or later). Old .xls and .csv are not supported.');
  }
  const sheet = await readSheet(await file.arrayBuffer(), ['Demand']);
  return { sheetName: sheet.name, ...rowsToDemand(sheet.rows) };
}
