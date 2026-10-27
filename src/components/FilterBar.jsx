import React from 'react';

export const EMPTY_FILTERS = { type: '', plant: '', country: '', model: '' };
const FIELDS = [['type', 'Planning type'], ['plant', 'Planning site'], ['country', 'Country'], ['model', 'Model']];

export const uniqSorted = (list) =>
  [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

/** Planning type / site / country / model dropdowns shared by the records and status tabs. */
export default function FilterBar({ idPrefix, options, value, onChange, onClear, active, count }) {
  return (
    <div className="filters">
      {FIELDS.map(([k, label]) => (
        <div className="field" key={k}>
          <label htmlFor={`${idPrefix}-${k}`}>{label}</label>
          <select id={`${idPrefix}-${k}`} value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })}>
            <option value="">All</option>
            {options[k].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      ))}
      <button className="btn" onClick={onClear} disabled={!active}>Clear filters</button>
      <span className="muted filter-count">{count}</span>
    </div>
  );
}
