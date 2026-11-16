// Demand report: everything uploaded so far, across all cycles.
// Loading is separate from the (pure, unit-tested) aggregation.
import { REPORTS, F, FORMS } from '../config.js';
import { getAllRecords } from '../api/creator.js';
import { displayOf, idOf, recordPlant, recordType, recordCountry } from './validate.js';
import { MONTHS, normCycle, yearFromCycle } from './cycle.js';

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Month number (1–12) from cycle text: "OCT'26", "Oct 2026", "10-2026". */
export function monthFromCycle(text) {
  const s = normCycle(text);
  const mm = s.match(/^(\d{1,2})-/);
  if (mm) return Number(mm[1]);
  const i = MONTHS.findIndex((m) => s.startsWith(m.slice(0, 3).toUpperCase()));
  return i >= 0 ? i + 1 : 0;
}
/** Sort key so cycles list in calendar order (unknown formats last). */
export const cycleKey = (text) => (yearFromCycle(text) || 9999) * 100 + (monthFromCycle(text) || 99);

/** Reads every demand record (only the fields the report needs) and the upload log. */
export async function loadReportData() {
  const D = F.demand;
  const fields = [D.cycle, D.plant, D.type, D.country, D.model, D.fg1, D.x3, D.x2, D.x1, D.zero, D.open, D.dist, ...(D.upload ? [D.upload] : [])];
  let demands;
  try {
    demands = await getAllRecords(REPORTS.demands, { fields });
  } catch (e) {
    console.warn('[widget] field-limited read failed, reading all fields', e);
    demands = await getAllRecords(REPORTS.demands);
  }
  let uploads = [];
  if (FORMS.demandUpload && REPORTS.demandUploads) {
    try { uploads = await getAllRecords(REPORTS.demandUploads); } catch (e) { console.warn('[widget] upload log not loaded', e); }
  }
  return { demands, uploads };
}

/** One flat row per demand record, with names resolved. */
export function flatten(demands, index) {
  const D = F.demand;
  return demands.map((d) => {
    const x3 = num(d[D.x3]), x2 = num(d[D.x2]), x1 = num(d[D.x1]), zero = num(d[D.zero]);
    return {
      cycle: normCycle(displayOf(d[D.cycle])),
      plant: recordPlant(d, index) || '—',
      type: recordType(d, index) || '—',
      country: recordCountry(d, index) || '—',
      model: displayOf(d[D.model]),
      fg1: displayOf(d[D.fg1]),
      x3, x2, x1, zero,
      open: num(d[D.open]),
      dist: num(d[D.dist]),
      qty: x3 + x2 + x1 + zero,
      uploadId: D.upload ? String(idOf(d[D.upload]) || '') : '',
    };
  });
}

const empty = () => ({ records: 0, x3: 0, x2: 0, x1: 0, zero: 0, open: 0, qty: 0, dist: 0, total: 0, _fg: new Map(), _countries: new Set(), _plants: new Set() });
function add(acc, r) {
  acc.records++;
  acc.x3 += r.x3; acc.x2 += r.x2; acc.x1 += r.x1; acc.zero += r.zero; acc.open += r.open; acc.qty += r.qty;
  // Dist. Shortages is repeated on every country row of an FG code → once per cycle + plant + FG code
  acc._fg.set(`${r.cycle}|${r.plant}|${r.fg1}`.toLowerCase(), r.dist);
  acc._countries.add(r.country);
  acc._plants.add(r.plant);
}
// noDist: Dist. Shortages belong to an FG code, not a country → left out when one country is selected
function finish(acc, noDist = false) {
  const dist = [...acc._fg.values()].reduce((a, b) => a + b, 0);
  return {
    records: acc.records, fgCodes: acc._fg.size, countries: acc._countries.size, plants: acc._plants.size,
    x3: r2(acc.x3), x2: r2(acc.x2), x1: r2(acc.x1), zero: r2(acc.zero), open: r2(acc.open), qty: r2(acc.qty),
    dist: noDist ? null : r2(dist), total: r2(acc.qty + (noDist ? 0 : dist)),
  };
}
function groupBy(rows, keyFn, noDist) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, empty());
    add(m.get(k), r);
  }
  return [...m.entries()].map(([key, acc]) => ({ key, ...finish(acc, noDist) }));
}

/**
 * Aggregates flat rows for the report.
 * filters: { year, cycle, plant, type, country } — '' means all.
 */
export function aggregate(rows, filters = {}) {
  const f = filters;
  const sel = rows.filter((r) =>
    (!f.year || yearFromCycle(r.cycle) === Number(f.year)) &&
    (!f.cycle || r.cycle === normCycle(f.cycle)) &&
    (!f.plant || r.plant === f.plant) &&
    (!f.type || r.type === f.type) &&
    (!f.country || r.country === f.country));

  const noDist = Boolean(f.country);
  const all = empty();
  sel.forEach((r) => add(all, r));
  const totals = finish(all, noDist);
  const cycles = new Set(sel.map((r) => r.cycle));

  const byCycle = groupBy(sel, (r) => r.cycle, noDist).sort((a, b) => cycleKey(b.key) - cycleKey(a.key));
  const byPlant = groupBy(sel, (r) => r.plant, noDist).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  // per country only the country's own quantities: Dist is per FG code, not per country
  const byCountry = groupBy(sel, (r) => r.country).map((c) => ({ ...c, dist: null, total: c.qty })).sort((a, b) => b.qty - a.qty);
  const byType = groupBy(sel, (r) => `${r.plant}|${r.type}`, noDist).map((t) => ({ ...t, plant: t.key.split('|')[0], type: t.key.split('|')[1] }))
    .sort((a, b) => a.plant.localeCompare(b.plant, undefined, { numeric: true }) || a.type.localeCompare(b.type));

  // plant × country matrix of 3X + 2X + 1X + ZERO
  const plants = byPlant.map((p) => p.key);
  const countries = [...new Set(sel.map((r) => r.country))].sort();
  const cell = new Map();
  for (const r of sel) {
    const k = `${r.plant}|${r.country}`;
    cell.set(k, (cell.get(k) || 0) + r.qty);
  }
  const matrix = {
    countries,
    rows: plants.map((p) => ({
      plant: p,
      cells: countries.map((c) => r2(cell.get(`${p}|${c}`) || 0)),
      total: r2(countries.reduce((a, c) => a + (cell.get(`${p}|${c}`) || 0), 0)),
    })),
    colTotals: countries.map((c) => r2(plants.reduce((a, p) => a + (cell.get(`${p}|${c}`) || 0), 0))),
  };

  return { totals: { ...totals, cycles: cycles.size, noDist }, byCycle, byPlant, byCountry, byType, matrix, count: sel.length };
}

/** Upload log rows, newest first. */
export function uploadHistory(uploads) {
  const U = F.upload;
  const when = (u) => displayOf(u.Added_Time ?? u.Added_Time_Stamp ?? u.Modified_Time ?? '');
  const name = (u) => displayOf(u[U.name]);
  return uploads.map((u) => {
    const nm = name(u);
    const cycle = displayOf(u[U.cycle]) || (nm.includes(' – ') ? nm.split(' – ')[0] : '');
    return {
      id: String(u.ID),
      when: when(u),
      cycle: normCycle(cycle),
      file: nm.includes(' – ') ? nm.split(' – ').slice(1).join(' – ') : nm,
      total: num(u[U.totalRows]),
      success: num(u[U.successRows]),
      failed: num(u[U.failedRows]),
      skipped: num(u[U.skippedRows]),
      status: displayOf(u[U.status]),
      by: displayOf(u[U.uploadedBy]),
    };
  }).sort((a, b) => Number(b.id) - Number(a.id) || cycleKey(b.cycle) - cycleKey(a.cycle));
}
