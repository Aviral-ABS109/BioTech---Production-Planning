import { describe, it, expect } from 'vitest';
import { summarise, sumLines } from '../src/lib/summary.js';

const r = (country, fg1, model, x3, dist = 0, x1 = 0) => ({ plant: '1100', type: 'IOL', model, fg1, fg2: '', range: 'Running', power: 21.5, cyl: 'HFY-20', country, x3, x2: 0, x1, zero: 0, open: 1, dist });
const rows = [
  r('India', 'A', 'TORIC', 146.66, 8.22), r('Brazil', 'A', 'TORIC', 0, 8.22, 3), r('Egypt', 'A', 'TORIC', 6, 8.22),
  r('India', 'B', 'TORIC', 10, 2), r('India', 'C', 'PHAKIC', 1, 0),
];

describe('summaries', () => {
  it('by FG code: one line per FG code, markets clubbed, Dist once', () => {
    const l = summarise(rows, 'fg');
    expect(l).toHaveLength(3);
    const a = l.find((x) => x.fg1 === 'A');
    expect(a).toMatchObject({ markets: 3, x3: 152.66, x1: 3, open: 3, dist: 8.22, qty: 155.66, total: 163.88 });
  });
  it('by model: FG codes of a model added, Dist once per FG code', () => {
    const l = summarise(rows, 'model');
    expect(l.map((x) => [x.model, x.fgCodes, x.markets, x.x3, x.dist, x.total])).toEqual([
      ['PHAKIC', 1, 1, 1, 0, 1],
      ['TORIC', 2, 3, 162.66, 10.22, 175.88],
    ]);
  });
  it('totals of lines match the records', () => {
    const t = sumLines(summarise(rows, 'fg'));
    expect(t).toMatchObject({ x3: 163.66, x1: 3, dist: 10.22, total: 176.88, fgCodes: 3 });
    expect(sumLines(summarise(rows, 'model')).total).toBe(176.88);
  });
});

describe('by site + Distributor as a market', () => {
  const d = (country, plant, type, model, fg1, x3) => ({ plant, type, model, fg1, country, x3, x2: 0, x1: 0, zero: 0, open: 0, dist: 0 });
  const rows = [d('India', '1100', 'IOL', 'M1', 'A', 5), d('Distributor', '1100', 'IOL', 'M1', 'A', 2), d('India', '1100', 'CTR', 'M2', 'B', 1), d('Distributor', '2100', 'SOL', 'M3', 'C', 4)];
  it('one line per site with type / model / market counts', () => {
    const l = summarise(rows, 'site');
    expect(l.map((x) => [x.plant, x.types, x.models, x.fgCodes, x.markets, x.x3, x.total])).toEqual([['1100', 2, 2, 2, 2, 8, 8], ['2100', 1, 1, 1, 1, 4, 4]]);
    expect(l[0].marketList).toEqual(['Distributor', 'India']);
  });
});
