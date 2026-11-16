// Summaries of one cycle's demand rows (one row = one FG code + one country).
// Countries are clubbed together: the same FG code across every market becomes one line.
// Dist. Shortages belongs to the FG code (repeated on each country row) → counted once per FG code.

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const QTY = ['x3', 'x2', 'x1', 'zero', 'open'];

function finish(g) {
  const dist = [...g._dist.values()].reduce((a, b) => a + b, 0);
  const out = { ...g, dist: r2(dist), markets: g._markets.size, fgCodes: g._dist.size, marketList: [...g._markets].sort() };
  for (const k of QTY) out[k] = r2(g[k]);
  out.qty = r2(out.x3 + out.x2 + out.x1 + out.zero);
  out.total = r2(out.qty + out.dist);
  if (g._types) { out.types = g._types.size; out.models = g._models.size; out.typeList = [...g._types].sort(); delete out._types; delete out._models; }
  delete out._dist; delete out._markets;
  return out;
}

/**
 * @param rows  flat rows: { plant, type, model, fg1, fg2, range, power, cyl, country, x3, x2, x1, zero, open, dist }
 * @param by    'fg'    → one line per site + FG code 1 (all markets clubbed)
 *              'model' → one line per site + planning type + model
 *              'site'  → one line per site
 */
export function summarise(rows, by) {
  const m = new Map();
  for (const r of rows) {
    const fgKey = `${r.plant}|${String(r.fg1).toLowerCase()}`;
    const key = by === 'fg' ? fgKey : by === 'site' ? String(r.plant) : `${r.plant}|${r.type}|${r.model}`.toLowerCase();
    if (!m.has(key)) {
      m.set(key, {
        key, plant: r.plant, ...(by === 'site' ? { _types: new Set(), _models: new Set() } : { type: r.type, model: r.model }),
        ...(by === 'fg' ? { fg1: r.fg1, fg2: r.fg2, range: r.range, power: r.power, cyl: r.cyl } : {}),
        rows: 0, x3: 0, x2: 0, x1: 0, zero: 0, open: 0, _dist: new Map(), _markets: new Set(),
      });
    }
    const g = m.get(key);
    g.rows++;
    for (const k of QTY) g[k] += Number(r[k]) || 0;
    g._dist.set(fgKey, Number(r.dist) || 0);
    if (r.country) g._markets.add(r.country);
    if (by === 'site') { g._types.add(r.type); g._models.add(r.model); }
  }
  const cmp = (a, b) => String(a.plant).localeCompare(String(b.plant), undefined, { numeric: true })
    || String(a.type).localeCompare(String(b.type)) || String(a.model).localeCompare(String(b.model))
    || String(a.fg1 ?? '').localeCompare(String(b.fg1 ?? ''), undefined, { numeric: true });
  return [...m.values()].map(finish).sort(cmp);
}

/** Footer totals of summary lines (Dist. already once per FG code inside each line). */
export function sumLines(lines) {
  const t = { x3: 0, x2: 0, x1: 0, zero: 0, open: 0, dist: 0, qty: 0, total: 0, fgCodes: 0 };
  for (const l of lines) for (const k of Object.keys(t)) t[k] += l[k] || 0;
  for (const k of Object.keys(t)) t[k] = r2(t[k]);
  return t;
}
