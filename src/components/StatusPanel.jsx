import React, { useMemo, useState } from 'react';
import { buildStatus, buildCountryBreakdown } from '../lib/demandService.js';
import { displayOf, recordCountry } from '../lib/validate.js';
import { F } from '../config.js';
import FilterBar, { EMPTY_FILTERS, uniqSorted } from './FilterBar.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Rows per Plant + Type + country, grouped by site. Each site ends with a site row
// (site totals incl. Dist. Shortages, which are per FG code) and its Start planning button.
// Country / Model filters narrow the records before summing; Planning type / site pick rows.
export default function StatusPanel({ demands, index, loading, onRefresh, cycleName }) {
  const [flt, setFlt] = useState(EMPTY_FILTERS);
  const allRows = useMemo(() => buildStatus(demands, index), [demands, index]);
  const options = useMemo(() => ({
    type: uniqSorted(allRows.map((r) => r.type)),
    plant: uniqSorted(allRows.map((r) => r.plant)),
    country: uniqSorted(demands.map((d) => recordCountry(d, index))),
    model: uniqSorted(demands.map((d) => displayOf(d[F.demand.model]))),
  }), [allRows, demands, index]);

  const { rows, breakdown } = useMemo(() => {
    const narrowing = Boolean(flt.country || flt.model);
    const narrowed = narrowing
      ? demands.filter((d) =>
          (!flt.country || recordCountry(d, index) === flt.country) &&
          (!flt.model || displayOf(d[F.demand.model]) === flt.model))
      : demands;
    return {
      rows: buildStatus(narrowed, index).filter((r) =>
        (!flt.type || r.type === flt.type) && (!flt.plant || r.plant === flt.plant) &&
        // with a country/model filter, hide Plant + Type blocks that have nothing for it
        (!narrowing || r.records > 0)),
      breakdown: buildCountryBreakdown(narrowed, index),
    };
  }, [demands, index, flt]);

  const active = Object.values(flt).some(Boolean);
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const pill = (r) => (!r.inMaster
    ? <span className="pill warn">Type not in Sites</span>
    : r.ready ? <span className="pill ok">✓ Ready</span> : <span className="pill error">No demand</span>);

  // group the Plant + Type rows by site, keeping their order
  const sites = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.plant)) m.set(r.plant, []);
      m.get(r.plant).push(r);
    }
    return [...m.entries()].map(([plant, types]) => {
      const t = (k) => types.reduce((a, r) => a + r[k], 0);
      const plannable = types.filter((r) => r.inMaster);
      return {
        plant, types,
        readyCount: plannable.filter((r) => r.ready).length,
        typeCount: plannable.length,
        fgCodes: t('fgCodes'), x3: t('x3'), x2: t('x2'), x1: t('x1'), zero: t('zero'), open: t('open'), dist: t('dist'), total: t('total'),
      };
    });
  }, [rows]);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Demand status · {cycleName}</h2>
          <p>Demand per site, planning type and country. Dist. shortages are per FG code, so they are shown on the site row. Start planning from each site's row.</p>
        </div>
        <button className="btn" onClick={onRefresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <FilterBar idPrefix="s" options={options} value={flt} onChange={setFlt} onClear={() => setFlt(EMPTY_FILTERS)} active={active} count={`Showing ${sites.length} site${sites.length === 1 ? '' : 's'} · ${rows.length} of ${allRows.length} Plant + Type`} />
      <div className="table-wrap">
        <table className="status-table">
          <thead>
            <tr>
              <th>Plant</th><th>Type</th><th>Country</th><th className="num">FG codes</th>
              <th className="num">3X</th><th className="num">2X</th><th className="num">1X</th><th className="num">ZERO</th>
              <th className="num">Open Orders</th><th className="num">Dist.</th><th className="num">Total</th><th>Planning</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site) => (
              <React.Fragment key={site.plant}>
                {site.types.map((r, ti) => {
                  const countries = breakdown.get(r.key) || [];
                  const lead = (i) => (ti === 0 && i === 0 ? <b>{r.plant}</b> : '');
                  if (!countries.length) {
                    return (
                      <tr key={r.key} className={ti === 0 ? 'site-start' : 'type-start'}>
                        <td>{lead(0)}</td><td>{r.type}</td><td className="muted">—</td>
                        <td className="num">0</td><td className="num">0</td><td className="num">0</td><td className="num">0</td>
                        <td className="num">0</td><td className="num">0</td><td className="num muted">—</td><td className="num">0</td>
                        <td>{pill(r)}</td>
                      </tr>
                    );
                  }
                  return countries.map((c, i) => (
                    <tr key={`${r.key}|${c.country}`} className={i === 0 ? (ti === 0 ? 'site-start' : 'type-start') : ''}>
                      <td>{lead(i)}</td>
                      <td>{i === 0 ? r.type : ''}</td>
                      <td>{c.country}</td>
                      <td className="num">{c.fgCodes}</td>
                      <td className="num">{fmt(c.x3)}</td>
                      <td className="num">{fmt(c.x2)}</td>
                      <td className="num">{fmt(c.x1)}</td>
                      <td className="num">{fmt(c.zero)}</td>
                      <td className="num">{fmt(c.open)}</td>
                      <td className="num muted">—</td>
                      <td className="num">{fmt(c.total)}</td>
                      <td>{i === 0 ? pill(r) : null}</td>
                    </tr>
                  ));
                })}
                <tr className="site-row">
                  <td colSpan={3}>
                    <b>Site {site.plant}</b>
                    <span className="muted"> · {site.readyCount} of {site.typeCount} type{site.typeCount === 1 ? '' : 's'} with demand</span>
                  </td>
                  <td className="num">{site.fgCodes}</td>
                  <td className="num">{fmt(site.x3)}</td>
                  <td className="num">{fmt(site.x2)}</td>
                  <td className="num">{fmt(site.x1)}</td>
                  <td className="num">{fmt(site.zero)}</td>
                  <td className="num">{fmt(site.open)}</td>
                  <td className="num">{fmt(site.dist)}</td>
                  <td className="num"><b>{fmt(site.total)}</b></td>
                  <td>
                    {/* placeholder: wired to the production planning stage (SAP data) later */}
                    <button className="btn small blue" disabled={!site.readyCount} onClick={() => {}}
                      title={site.readyCount ? `Start production planning for site ${site.plant}` : 'No demand uploaded for this site'}>
                      Start planning for site {site.plant} →
                    </button>
                  </td>
                </tr>
              </React.Fragment>
            ))}
            {!rows.length && <tr><td colSpan={12} className="empty">{allRows.length ? 'Nothing matches the filters.' : 'No plants found in Sites.'}</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <th colSpan={3}>Grand total</th>
                <th className="num">{sum('fgCodes')}</th>
                <th className="num">{fmt(sum('x3'))}</th><th className="num">{fmt(sum('x2'))}</th>
                <th className="num">{fmt(sum('x1'))}</th><th className="num">{fmt(sum('zero'))}</th>
                <th className="num">{fmt(sum('open'))}</th>
                <th className="num">{fmt(sum('dist'))}</th><th className="num">{fmt(sum('total'))}</th><th />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
