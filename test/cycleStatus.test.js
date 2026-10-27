import { describe, it, expect } from 'vitest';
import { cycleText, sameCycle, yearOptions } from '../src/lib/cycle.js';
import { buildMasterIndex } from '../src/lib/validate.js';
import { buildStatus } from '../src/lib/demandService.js';

describe('planning cycle text', () => {
  it('formats month + year', () => {
    expect(cycleText(10, 2026)).toBe("OCT'26");
    expect(cycleText(1, 2027, 'Mon YYYY')).toBe('Jan 2027');
    expect(cycleText(3, 2026, 'MM-YYYY')).toBe('03-2026');
  });
  it('compares loosely', () => {
    expect(sameCycle("Oct'26", "OCT’26")).toBe(true);
    expect(sameCycle("OCT'26", "NOV'26")).toBe(false);
  });
  it('year options around the current year', () => {
    expect(yearOptions(new Date(2026, 9, 1))).toEqual([2025, 2026, 2027]);
  });
});

describe('status matching uses lookup IDs', () => {
  const index = buildMasterIndex({
    sites: [{ ID: 'S1', Site_Name: '1100', Planning_Type: [{ ID: 'T1', display_value: 'IOL' }, { ID: 'T2', display_value: 'CTR' }] }],
    planningTypes: [{ ID: 'T1', Type_Name: 'IOL' }, { ID: 'T2', Type_Name: 'CTR' }],
    markets: [],
  });
  it('counts records even when the report display text differs', () => {
    // one FG code, two country records; Dist 1 repeated on both → counted once
    const rec = (id, x3, x1) => ({ ID: id, Plant: { ID: 'S1', display_value: '1100' }, Type_field: { ID: 'T1', display_value: 'IOL - true' }, FG_Code_1: 'FGX', X3: x3, X2: '0', X1: x1, Zero: '0', Dist_Shortages: '1' });
    const rows = buildStatus([rec('D1', '2', '0'), rec('D2', '0', '1')], index);
    expect(rows.map((r) => [r.plant, r.type, r.fgCodes, r.records, r.x3, r.x1, r.dist, r.total, r.ready])).toEqual([
      ['1100', 'CTR', 0, 0, 0, 0, 0, 0, false],
      ['1100', 'IOL', 1, 2, 2, 1, 1, 4, true],
    ]);
  });
});

import { yearFromCycle, yearOptions as yo } from '../src/lib/cycle.js';
describe('years with saved demand', () => {
  it('reads the year from cycle text', () => {
    expect(yearFromCycle("OCT'21")).toBe(2021);
    expect(yearFromCycle('Oct 2026')).toBe(2026);
    expect(yearFromCycle('10-2027')).toBe(2027);
    expect(yearFromCycle('junk')).toBeNull();
  });
  it('adds old data years to the picker', () => {
    expect(yo(new Date('2026-10-27'), [2021, 2026])).toEqual([2021, 2025, 2026, 2027]);
  });
});
