import React, { useMemo, useState } from 'react';
import { F, PAGE_SIZE } from '../config.js';
import { displayOf, recordPlant, recordType, recordCountry } from '../lib/validate.js';
import FilterBar, { EMPTY_FILTERS, uniqSorted } from './FilterBar.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// Every Demand record already saved for the selected cycle (opened from the FG codes card).
export default function RecordsPanel({ demands, index, cycle, loading, onRefresh }) {
  const D = F.demand;
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [flt, setFlt] = useState(EMPTY_FILTERS);

  const rows = useMemo(() => {
    const list = demands.map((d) => {
      const x3 = num(d[D.x3]);
      const x2 = num(d[D.x2]);
      const x1 = num(d[D.x1]);
      const zero = num(d[D.zero]);
      const dist = num(d[D.dist]);
      return {
        id: String(d.ID),
        country: recordCountry(d, index),
        open: num(d[D.open]),
        plant: recordPlant(d, index),
        type: recordType(d, index),
        model: displayOf(d[D.model]),
        fg1: displayOf(d[D.fg1]),
        fg2: displayOf(d[D.fg2]),
        range: displayOf(d[D.range]),
        power: displayOf(d[D.power]),
        cyl: displayOf(d[D.cyl]),
        x3, x2, x1, zero, dist,
        fgTotal: num(d[D.total]),
        status: displayOf(d[D.status]),
      };
    });
    list.sort((a, b) => a.plant.localeCompare(b.plant) || a.type.localeCompare(b.type) || a.fg1.localeCompare(b.fg1) || a.country.localeCompare(b.country));
    return list;
  }, [demands, index, D]);

  // dropdown options = values present in this cycle's records
  const options = useMemo(() => {
    const uniq = (k) => uniqSorted(rows.map((r) => r[k]));
    return { type: uniq('type'), plant: uniq('plant'), country: uniq('country'), model: uniq('model') };
  }, [rows]);
  const changeFilters = (f) => { setFlt(f); setPage(0); };
  const active = Object.values(flt).some(Boolean) || q.trim();
  const clearAll = () => { setFlt(EMPTY_FILTERS); setQ(''); setPage(0); };

  const term = q.trim().toLowerCase();
  const filtered = rows.filter((r) =>
    (!flt.type || r.type === flt.type) &&
    (!flt.plant || r.plant === flt.plant) &&
    (!flt.country || r.country === flt.country) &&
    (!flt.model || r.model === flt.model) &&
    (!term || [r.plant, r.type, r.model, r.fg1, r.fg2, r.cyl, r.country].some((v) => v.toLowerCase().includes(term)))
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const sum = (k) => filtered.reduce((a, r) => a + r[k], 0);
  const fgCount = (list) => new Set(list.map((r) => `${r.plant}|${r.fg1}`)).size;
  // Dist. Shortages is repeated on every country row of an FG code → count once per FG code
  const distOnce = () => {
    const m = new Map();
    for (const r of filtered) m.set(`${r.plant}|${r.fg1}`, r.dist);
    return [...m.values()].reduce((a, b) => a + b, 0);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Demand records · {cycle}</h2>
          <p>{rows.length} record{rows.length === 1 ? '' : 's'} ({fgCount(rows)} FG codes × countries) already saved for this cycle.</p>
        </div>
        <div className="row-actions">
          <input
            className="search"
            placeholder="Search plant, type, model, FG code, country…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
          />
          <button className="btn" onClick={onRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>
      <FilterBar idPrefix="f" options={options} value={flt} onChange={changeFilters} onClear={clearAll} active={active} count={`Showing ${filtered.length} of ${rows.length}`} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plant</th><th>Type</th><th className="col-model">Model</th><th>FG Code 1</th><th>FG Code 2</th>
              <th>Range</th><th className="num">Power</th><th>Cyl</th><th>Country</th>
              <th className="num">3X</th><th className="num">2X</th><th className="num">1X</th><th className="num">ZERO</th>
              <th className="num">Open Orders</th><th className="num">Dist.</th><th className="num">FG Total</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td><b>{r.plant}</b></td>
                <td>{r.type}</td>
                <td className="col-model">{r.model}</td>
                <td className="nowrap">{r.fg1}</td>
                <td className="nowrap">{r.fg2}</td>
                <td>{r.range}</td>
                <td className="num">{r.power || '—'}</td>
                <td>{r.cyl}</td>
                <td>{r.country}</td>
                <td className="num">{fmt(r.x3)}</td>
                <td className="num">{fmt(r.x2)}</td>
                <td className="num">{fmt(r.x1)}</td>
                <td className="num">{fmt(r.zero)}</td>
                <td className="num">{fmt(r.open)}</td>
                <td className="num">{fmt(r.dist)}</td>
                <td className="num"><b>{fmt(r.fgTotal)}</b></td>
                {/* saved value stays "Validated"; shown to users as "Uploaded" */}
                <td>{r.status && <span className={`pill ${r.status === 'Validated' ? 'ok' : 'skip'}`}>{r.status === 'Validated' ? 'Uploaded' : r.status}</span>}</td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={17} className="empty">{rows.length ? 'No records match the filters.' : 'No demand saved for this cycle yet.'}</td></tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr>
                <th colSpan={9}>Total ({filtered.length} rows · {fgCount(filtered)} FG codes)</th>
                <th className="num">{fmt(sum('x3'))}</th><th className="num">{fmt(sum('x2'))}</th>
                <th className="num">{fmt(sum('x1'))}</th><th className="num">{fmt(sum('zero'))}</th>
                <th className="num">{fmt(sum('open'))}</th><th className="num">{fmt(distOnce())}</th>
                <th className="num">{fmt(sum('x3') + sum('x2') + sum('x1') + sum('zero') + distOnce())}</th><th />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pages > 1 && (
        <div className="pager" style={{ padding: '10px 18px' }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
          Page {page + 1} of {pages} · {filtered.length} records
          <button className="btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
