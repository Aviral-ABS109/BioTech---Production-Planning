// Checks parsed demand LINES (one per FG code per country) against master data
// and builds the record payloads. One Demand record = one line.
// Dist. Shortages and the 3X/2X/1X/ZERO totals are per FG code and are written
// on every country record of that FG code.
// Status per line: 'ok' (will be saved) · 'skip' (already uploaded) · 'error'.
// Pure functions — unit-tested in test/validate.test.js.
import { F, RANGE_VALUES, DUPLICATE_POLICY, STATUS_VALIDATED, QTY_DECIMALS } from '../config.js';
import { normCycle } from './cycle.js';

const norm = (s) => String(s ?? '').replace(/ /g, ' ').trim().toLowerCase().replace(/\s+/g, ' ');
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
export const idOf = (v) => String(v?.ID ?? v?.id ?? v ?? '');
export const displayOf = (v) =>
  v && typeof v === 'object' ? str(v.display_value ?? v.zc_display_value ?? v.value ?? '') : str(v);
const asList = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v]);
const isActive = (v) => !['false', 'no', '0'].includes(norm(v));
const FACTOR = 10 ** QTY_DECIMALS;
export const round = (n) => Math.round((n + Number.EPSILON) * FACTOR) / FACTOR;

/** Lookup maps from master records. */
export function buildMasterIndex({ sites, planningTypes, markets }) {
  const typeById = new Map();
  const typeByName = new Map();
  for (const t of planningTypes) {
    const rec = { id: String(t.ID), name: str(t[F.planningType.name]) };
    typeById.set(rec.id, rec);
    if (rec.name) typeByName.set(norm(rec.name), rec);
  }
  const siteByCode = new Map();
  const siteById = new Map();
  for (const s of sites) {
    const code = displayOf(s[F.site.code]);
    const types = asList(s[F.site.types]).map((t) => typeById.get(idOf(t))?.name || displayOf(t));
    const rec = { id: String(s.ID), code, types: types.map(norm), typeNames: types };
    siteById.set(rec.id, rec);
    if (code) siteByCode.set(norm(code), rec);
  }
  const marketByName = new Map();
  const marketById = new Map();
  for (const m of markets) {
    const rec = { id: String(m.ID), name: str(m[F.market.name]), active: isActive(m[F.market.active]) };
    marketById.set(rec.id, rec);
    if (rec.name) marketByName.set(norm(rec.name), rec);
  }
  return { siteByCode, siteById, typeByName, typeById, marketByName, marketById };
}

/** Quantity cell → { value } or { error }. Blank, "-" and "NA" count as 0. */
export function parseQty(v, label) {
  if (v === null || v === undefined) return { value: 0 };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { error: `${label}: not a number` };
    if (v < 0) return { error: `${label}: negative quantity (${v})` };
    return { value: round(v) };
  }
  const s = str(v).replace(/,/g, '');
  if (s === '' || s === '-' || norm(s) === 'na') return { value: 0 };
  const n = Number(s);
  if (!Number.isFinite(n)) return { error: `${label}: "${v}" is not a number` };
  if (n < 0) return { error: `${label}: negative quantity (${n})` };
  return { value: round(n) };
}

function parsePower(v) {
  if (v === null || v === undefined) return { value: null };
  if (typeof v === 'number') return { value: v };
  const s = str(v);
  if (s === '' || norm(s) === 'na' || s === '-') return { value: null };
  const n = Number(s);
  return Number.isFinite(n) ? { value: n } : { error: `Power "${v}" is not a number` };
}

const fgKey = (plant, fg1) => `${norm(plant)}|${norm(fg1)}`;
const dupKey = (cycle, plant, fg1, country) => `${normCycle(cycle)}|${fgKey(plant, fg1)}|${norm(country)}`;

/** Plant / type / country of a saved Demand record — by lookup ID first, display text as fallback. */
export function recordPlant(d, index) {
  return index?.siteById.get(idOf(d[F.demand.plant]))?.code || displayOf(d[F.demand.plant]);
}
export function recordType(d, index) {
  return index?.typeById.get(idOf(d[F.demand.type]))?.name || displayOf(d[F.demand.type]);
}
export function recordCountry(d, index) {
  return index?.marketById.get(idOf(d[F.demand.country]))?.name || displayOf(d[F.demand.country]);
}

/** Keys of demand records already saved, to skip re-uploads. */
export function existingKeys(demands, index) {
  const D = F.demand;
  return new Set(demands.map((d) => dupKey(displayOf(d[D.cycle]), recordPlant(d, index), str(d[D.fg1]), recordCountry(d, index))));
}

/** Problems with the file as a whole. */
export function fileErrors(parsed, index) {
  const errors = [...(parsed.layoutErrors || [])];
  if (parsed.format === 'wide') {
    for (const c of parsed.countries || []) {
      if (!c.name) continue;
      const m = index.marketByName.get(norm(c.name));
      if (!m) errors.push(`Country "${c.name}" (columns ${c.columns}) is not in the country master.`);
      else if (!m.active) errors.push(`Country "${c.name}" is inactive in the country master.`);
    }
  }
  return errors;
}

/**
 * @param lines  output of rowsToDemand().lines
 * @param index  buildMasterIndex()
 * @param opts   { cycle: "OCT'26", existing: Set, fileErrors: [] }
 */
export function validateRows(lines, index, { cycle, existing = new Set(), fileErrors: fErrors = [] } = {}) {
  const D = F.demand;

  // 1. line-level checks
  const out = lines.map((l) => {
    const errors = [];
    const warnings = [];
    const site = l.plant ? index.siteByCode.get(norm(l.plant)) : null;
    if (!l.plant) errors.push('Plant is missing');
    else if (!site) errors.push(`Plant "${l.plant}" is not in Sites`);
    const type = l.type ? index.typeByName.get(norm(l.type)) : null;
    if (!l.type) errors.push('Type is missing');
    else if (!type) errors.push(`Type "${l.type}" is not a planning type`);
    else if (site && site.types.length && !site.types.includes(norm(type.name))) {
      errors.push(`Type "${type.name}" is not set up for plant ${site.code} in Sites`);
    }
    const market = l.country ? index.marketByName.get(norm(l.country)) : null;
    if (!l.country) errors.push('Country is missing');
    else if (!market) errors.push(`Country "${l.country}" is not in the country master`);
    else if (!market.active) errors.push(`Country "${l.country}" is inactive`);

    if (!l.fg1) errors.push('FG Code 1 is missing');
    if (!l.model) warnings.push('Model is blank');
    let range = '';
    if (l.range) {
      range = RANGE_VALUES.find((v) => norm(v) === norm(l.range)) || '';
      if (!range) errors.push(`Range "${l.range}" must be one of ${RANGE_VALUES.join(', ')}`);
    }
    const power = parsePower(l.power);
    if (power.error) errors.push(power.error);

    const q = {};
    for (const [k, label] of [['x3', '3X'], ['x2', '2X'], ['x1', '1X'], ['zero', 'ZERO'], ['open', 'Open Orders']]) {
      if (k === 'open' && !l.hasOpen) { q[k] = null; continue; }
      const p = parseQty(l[k], `${l.country || 'Country'} ${label}`);
      if (p.error) errors.push(p.error);
      q[k] = p.value ?? 0;
    }
    const dist = parseQty(l.dist, 'Dist. Shortages');
    if (dist.error) errors.push(dist.error);

    return { line: l, site, type, market, range, power: power.value, q, dist: dist.value ?? 0, errors, warnings };
  });

  // 2. group by FG code: totals, duplicates, consistency
  const groups = new Map();
  out.forEach((v) => {
    if (!v.line.fg1) return;
    const k = fgKey(v.line.plant, v.line.fg1);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  });
  for (const list of groups.values()) {
    const seenCountry = new Map();
    const t = { x3: 0, x2: 0, x1: 0, zero: 0 };
    for (const v of list) {
      const c = norm(v.line.country);
      if (c && seenCountry.has(c)) v.errors.push(`Duplicate of Excel row ${seenCountry.get(c)} (same Plant + FG Code 1 + Country)`);
      else if (c) seenCountry.set(c, v.line.excelRow);
      for (const k of Object.keys(t)) t[k] = round(t[k] + v.q[k]);
    }
    const dists = [...new Set(list.map((v) => v.dist))];
    if (dists.length > 1) list.forEach((v) => v.warnings.push(`Dist. Shortages differs between country rows of this FG code (${dists.join(', ')})`));
    const dist = Math.max(...list.map((v) => v.dist));
    const total = round(dist + t.x3 + t.x2 + t.x1 + t.zero);
    const tolerance = (0.5 / FACTOR) * (list.length * 4 + 1) + 1e-9;
    const bad = list.some((v) => v.errors.length);
    for (const v of list) {
      v.totals = { ...t, dist, total };
      if (typeof v.line.fileTotal === 'number' && Math.abs(v.line.fileTotal - total) > tolerance && !v.warnings.some((w) => w.startsWith('Total in file'))) {
        v.warnings.push(`Total in file is ${round(v.line.fileTotal)}, calculated ${total}`);
      }
      // keep an FG code together: if one country row fails, none of its rows are saved
      if (bad && !v.errors.length) v.errors.push('Another country row of this FG code has errors');
    }
  }

  // 3. status + payload
  return out.map((v) => {
    const l = v.line;
    const totals = v.totals || { x3: 0, x2: 0, x1: 0, zero: 0, dist: v.dist, total: v.dist };
    let status = v.errors.length || fErrors.length ? 'error' : 'ok';
    if (status === 'ok' && cycle && existing.has(dupKey(cycle, l.plant, l.fg1, v.market?.name || l.country))) {
      if (DUPLICATE_POLICY === 'error') {
        v.errors.push('Already uploaded for this cycle');
        status = 'error';
      } else {
        status = 'skip';
        v.warnings.push('Already uploaded for this cycle — will be skipped');
      }
    }

    let payload = null;
    if (status === 'ok') {
      payload = {
        [D.cycle]: cycle,
        [D.country]: v.market.id,
        [D.plant]: v.site.id,
        [D.type]: v.type.id,
        [D.model]: l.model,
        [D.fg1]: l.fg1,
        [D.fg2]: l.fg2,
        [D.cyl]: l.cyl,
        [D.x3]: v.q.x3,
        [D.x2]: v.q.x2,
        [D.x1]: v.q.x1,
        [D.zero]: v.q.zero,
        [D.dist]: totals.dist,
        [D.x3Total]: totals.x3,
        [D.x2Total]: totals.x2,
        [D.x1Total]: totals.x1,
        [D.zeroTotal]: totals.zero,
        [D.total]: totals.total,
        [D.status]: STATUS_VALIDATED,
      };
      if (v.q.open !== null) payload[D.open] = v.q.open;
      if (v.range) payload[D.range] = v.range;
      if (v.power !== null && v.power !== undefined) payload[D.power] = v.power;
    }

    return {
      excelRow: l.excelRow,
      key: `${l.excelRow}|${l.country}`,
      status,
      errors: v.errors,
      warnings: v.warnings,
      payload,
      display: {
        plant: l.plant,
        type: v.type?.name || l.type,
        model: l.model,
        fg1: l.fg1,
        power: v.power,
        cyl: l.cyl,
        country: v.market?.name || l.country,
        x3: v.q.x3,
        x2: v.q.x2,
        x1: v.q.x1,
        zero: v.q.zero,
        open: v.q.open,
        lineTotal: round(v.q.x3 + v.q.x2 + v.q.x1 + v.q.zero),
        dist: totals.dist,
        fgTotal: totals.total,
      },
    };
  });
}

export function summarise(validated) {
  const s = { total: validated.length, ok: 0, skip: 0, error: 0, added: 0, failed: 0, warnings: 0, qty: 0, fgCodes: 0 };
  const fg = new Map();
  for (const v of validated) {
    s[v.status] = (s[v.status] || 0) + 1;
    if (v.warnings.some((w) => !w.startsWith('Already uploaded'))) s.warnings++;
    if (v.status === 'ok') {
      s.qty += v.display.lineTotal;
      fg.set(`${v.display.plant}|${v.display.fg1}`, v.display.dist);
    }
  }
  // Dist. Shortages counts once per FG code
  s.qty = round(s.qty + [...fg.values()].reduce((a, b) => a + b, 0));
  s.fgCodes = fg.size;
  return s;
}
