import { describe, it, expect } from 'vitest';
import { buildTracker, indexStatus, stageIndex, creatorDateTime } from '../src/lib/planStatus.js';

const index = { siteByCode: new Map([['1100', { id: 'S1', code: '1100' }], ['2100', { id: 'S2', code: '2100' }], ['5100', { id: 'S5', code: '5100' }]]), siteById: new Map([['S1', {}], ['S2', {}], ['S5', {}]]) };
const rec = (cycle, site, stage) => ({ ID: `R${site}`, Planning_Cycle: cycle, Site: { ID: site, display_value: site }, Stage: stage, Updated_By: 'Aviral', Stage_Updated_On: '05-Nov-2026 14:20:00' });

describe('site plan status', () => {
  it('stage names map to their order', () => {
    expect(stageIndex('Production Planning')).toBe(1);
    expect(stageIndex('signed off')).toBe(6);
    expect(stageIndex('')).toBe(0);
  });
  it('sites with demand and no record are at Demand Collection; started ones count per stage', () => {
    const idx = indexStatus([rec("NOV'26", 'S1', 'Production Planning'), rec("DEC'26", 'S2', 'Signed Off')], index);
    const t = buildTracker(['1100', '2100', '1100', '5100'], idx.get("NOV'26"), index);
    expect(t.n).toBe(3);
    expect(t.started).toBe(1);
    expect(t.sites.map((s) => [s.code, s.stage, s.started])).toEqual([['1100', 1, true], ['2100', 0, false], ['5100', 0, false]]);
    expect(t.stages.map((s) => [s.done, s.current])).toEqual([[3, 0], [0, 1], [0, 0], [0, 0], [0, 0], [0, 0]]);
    const dec = buildTracker(['2100'], idx.get("DEC'26"), index);
    expect(dec.signedOff).toBe(1);
    expect(dec.stages.every((s) => s.done === 1)).toBe(true);
  });
  it('writes Creator date-time text', () => {
    expect(creatorDateTime(new Date(2026, 10, 5, 9, 4, 7))).toBe('05-Nov-2026 09:04:07');
  });
});
