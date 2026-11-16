import { describe, it, expect } from 'vitest';
import { aggregate, monthFromCycle, cycleKey, uploadHistory } from '../src/lib/reportService.js';

const row = (o) => ({ cycle: "OCT'26", plant: '1100', type: 'IOL', country: 'India', model: 'M', fg1: 'FG1', x3: 0, x2: 0, x1: 0, zero: 0, open: 0, dist: 0, ...o, qty: (o.x3 || 0) + (o.x2 || 0) + (o.x1 || 0) + (o.zero || 0) });

describe('demand report', () => {
  const rows = [
    row({ country: 'India', x3: 10, dist: 5 }),
    row({ country: 'Brazil', x2: 4, open: 2, dist: 5 }), // same FG code → Dist counted once
    row({ fg1: 'FG2', plant: '2100', type: 'Solution', country: 'India', x1: 6, dist: 1 }),
    row({ cycle: "SEP'26", country: 'India', x3: 3, dist: 2 }),
  ];
  it('totals count Dist once per cycle + plant + FG code', () => {
    const a = aggregate(rows);
    expect(a.totals).toMatchObject({ records: 4, cycles: 2, qty: 23, dist: 8, total: 31, open: 2, plants: 2, countries: 2 });
  });
  it('groups by cycle (newest first), plant, country and plant × country', () => {
    const a = aggregate(rows);
    expect(a.byCycle.map((c) => [c.key, c.total])).toEqual([["OCT'26", 26], ["SEP'26", 5]]);
    expect(a.byPlant.map((p) => [p.key, p.qty, p.dist])).toEqual([['1100', 17, 7], ['2100', 6, 1]]);
    expect(a.byCountry.map((c) => [c.key, c.qty, c.dist])).toEqual([['India', 19, null], ['Brazil', 4, null]]);
    expect(a.matrix.countries).toEqual(['Brazil', 'India']);
    expect(a.matrix.rows).toEqual([{ plant: '1100', cells: [4, 13], total: 17 }, { plant: '2100', cells: [0, 6], total: 6 }]);
    expect(a.matrix.colTotals).toEqual([4, 19]);
  });
  it('filters by year, cycle, plant, country', () => {
    expect(aggregate(rows, { cycle: "oct'26" }).totals.records).toBe(3);
    expect(aggregate(rows, { year: 2026, plant: '2100' }).totals.total).toBe(7);
    expect(aggregate(rows, { country: 'Brazil' }).totals).toMatchObject({ qty: 4, dist: null, total: 4, noDist: true });
    expect(aggregate(rows, { year: 2025 }).count).toBe(0);
  });
  it('reads months and orders cycles', () => {
    expect([monthFromCycle("OCT'26"), monthFromCycle('Oct 2026'), monthFromCycle('10-2026'), monthFromCycle('x')]).toEqual([10, 10, 10, 0]);
    expect(cycleKey("JAN'27") > cycleKey("DEC'26")).toBe(true);
  });
  it('upload history falls back to the cycle in the upload name', () => {
    const h = uploadHistory([{ ID: '5', Upload_Name: "OCT'26 – Demand.xlsx", Total_Rows: '322', Success_Rows: '322', Failed_Rows: '0', Skipped_Rows: '0', Status: 'Completed' }]);
    expect(h[0]).toMatchObject({ cycle: "OCT'26", file: 'Demand.xlsx', total: 322, success: 322, status: 'Completed' });
  });
});
