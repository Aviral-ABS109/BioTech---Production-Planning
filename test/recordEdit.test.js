import { describe, it, expect } from 'vitest';
import { planGroupUpdate, cleanPatch, groupKey } from '../src/lib/recordEdit.js';

const rec = (id, country, q, extra = {}) => ({
  ID: id, Planning_Cycle: "OCT'26", Plant: { ID: 'P1', display_value: '1100' }, FG_Code_1: 'FG1', Country: { ID: country, display_value: country },
  X3: q[0], X2: q[1], X1: q[2], Zero: q[3], Open_Orders: 0, Dist_Shortages: 5,
  X3_Total: 11, X2_Total: 2, X1_Total: 0, Zero_Total: 0, Total: 18, Model: 'M', Range: 'NA', ...extra,
});
const group = [rec('1', 'India', [10, 2, 0, 0]), rec('2', 'Brazil', [1, 0, 0, 0])];

describe('editing demand records', () => {
  it('groups by cycle + site + FG code', () => {
    expect(groupKey(group[0])).toBe(groupKey(group[1]));
  });
  it('an edited quantity updates the record and the FG totals on every country row', () => {
    const plan = planGroupUpdate(group, { id: '1', data: { x3: 20 } });
    expect(plan).toEqual([
      { id: '1', data: { X3_Total: 21, Total: 28, X3: 20 }, fields: ['x3Total', 'total', 'x3'] },
      { id: '2', data: { X3_Total: 21, Total: 28 }, fields: ['x3Total', 'total'] },
    ]);
  });
  it('Dist. shortages is FG-level: editing it rewrites every row', () => {
    const plan = planGroupUpdate(group, { id: '2', data: { dist: 7 } });
    expect(plan.map((p) => [p.id, p.data])).toEqual([['1', { Dist_Shortages: 7, Total: 20 }], ['2', { Dist_Shortages: 7, Total: 20 }]]);
  });
  it('deleting a row recalculates the totals of the rows left', () => {
    const plan = planGroupUpdate(group, null, new Set(['2']));
    expect(plan).toEqual([{ id: '1', data: { X3_Total: 10, Total: 17 }, fields: ['x3Total', 'total'] }]);
  });
  it('no change → nothing to write', () => {
    expect(planGroupUpdate(group, { id: '1', data: { x3: 10, model: 'M' } })).toEqual([]);
  });
  it('validates and cleans form values', () => {
    expect(cleanPatch({ x3: '1,200.456', power: 'NA', range: 'low', model: ' A ' })).toEqual({ data: { x3: 1200.46, power: '', range: 'Low', model: 'A' }, errors: {} });
    expect(cleanPatch({ x2: '-1', x1: 'abc', range: 'High' }).errors).toEqual({ x2: 'Can’t be negative', x1: 'Enter a number' });
    expect(cleanPatch({ range: ' Medium ' }).data).toEqual({ range: 'Medium' });
  });
});
