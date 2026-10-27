// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readSheet } from '../src/lib/xlsxReader.js';
import { rowsToDemand, mapLayout, findHeaderRow, colLetter } from '../src/lib/parseDemand.js';

const load = (f) => new Uint8Array(readFileSync(resolve(process.cwd(), 'sample-data', f))).buffer;
const parse = async (f) => rowsToDemand((await readSheet(load(f), ['Demand'])).rows);

describe('long format (one row per FG code per country)', () => {
  it('reads the template', async () => {
    const p = await parse('Demand_Upload_Template_Oct26.xlsx');
    expect(p.format).toBe('long');
    expect(p.headerRow).toBe(1);
    expect(p.lines).toHaveLength(322);
    expect(p.layoutErrors).toEqual([]);
    expect(p.countries.map((c) => c.name)).toEqual(['Morocco', 'Egypt', 'Brazil', 'Colombia', 'Turkey', 'Iberia', 'India']);
    expect(p.lines[0]).toMatchObject({ excelRow: 2, plant: '1100', type: 'IOL', fg1: '12FLD00391N3.00', country: 'Morocco', x1: 2, open: 0, hasOpen: true });
  });
  it('reports missing quantity columns', () => {
    const p = rowsToDemand([['Plant', 'Type', 'FG Code 1', 'Country', '3X'], [1100, 'IOL', 'A', 'Morocco', 1]]);
    expect(p.layoutErrors).toEqual(['Column 2X not found.', 'Column 1X not found.', 'Column ZERO not found.']);
  });
});

describe('old wide format is still accepted', () => {
  it('splits each Excel row into one line per country', async () => {
    const p = await parse('Oct26_Demand_Plan_client.xlsx');
    expect(p.format).toBe('wide');
    expect(p.headerRow).toBe(4);
    expect(p.lines).toHaveLength(46 * 7);
    expect(p.countries.map((c) => [c.name, c.columns])).toEqual([
      ['Morocco', 'J–N'], ['Egypt', 'O–S'], ['Brazil', 'T–X'], ['Colombia', 'Y–AC'], ['Turkey', 'AD–AH'], ['Iberia', 'AI–AM'], ['India', 'AN–AQ'],
    ]);
    const india = p.lines.find((l) => l.country === 'India');
    expect(india.hasOpen).toBe(false);
  });
});

describe('layout helpers', () => {
  const rows = [
    [null, null, 'Morocco', null, null, null, null, 'India'],
    ['Plant', 'FG Code 1', '3X', '2X', '1X', 'ZERO', 'Open Orders', '3X', '2X', '1X', 'ZERO', 'Dist. Shortages', '3X Total', 'ZERO', 'Total', 'Type'],
  ];
  it('finds wide blocks, dist, ignores totals', () => {
    const l = mapLayout(rows, findHeaderRow(rows));
    expect(l.blocks.map((b) => [b.country, b.label])).toEqual([['Morocco', 'C–G'], ['India', 'H–K']]);
    expect(l.fixed).toMatchObject({ plant: 0, fg1: 1, dist: 11, fileTotal: 14, type: 15 });
    expect(l.ignored).toEqual(['M "3X Total"', 'N "ZERO"']);
  });
  it('column letters', () => {
    expect([colLetter(0), colLetter(25), colLetter(26), colLetter(48)]).toEqual(['A', 'Z', 'AA', 'AW']);
  });
});
