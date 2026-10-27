// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readSheet } from '../src/lib/xlsxReader.js';
import { rowsToDemand } from '../src/lib/parseDemand.js';
import { buildMasterIndex, validateRows, fileErrors, existingKeys, summarise, parseQty } from '../src/lib/validate.js';
import seed from '../src/api/mockSeed.json';

let n = 1;
const types = seed.planningTypes.map((name) => ({ ID: String(n++), Type_Name: name }));
const tId = Object.fromEntries(types.map((t) => [t.Type_Name, t.ID]));
const sites = seed.sites.map((s) => ({ ID: `S${s.Site_Name}`, Site_Name: s.Site_Name, Planning_Type: s.types.map((t) => ({ ID: tId[t], display_value: t })) }));
const markets = seed.markets.map((m) => ({ ID: `M${m}`, Country_Name: m, Active: 'true' }));
const index = buildMasterIndex({ sites, planningTypes: types, markets });
const C = "OCT'26";

const line = (o = {}) => ({
  excelRow: 2, plant: '1100', type: 'IOL', model: 'DIHFY600', fg1: 'FGX', fg2: '', range: 'Running', power: 21, cyl: '0',
  country: 'Morocco', x3: 0, x2: 0, x1: 0, zero: 0, open: 0, hasOpen: true, dist: 0, fileTotal: null, ...o,
});
const fg = (o = {}, countries = [['Morocco', { x1: 2 }], ['Brazil', { zero: 1, open: 5 }], ['India', { hasOpen: false, open: null }]]) =>
  countries.map(([c, q], i) => line({ excelRow: 2 + i, country: c, ...o, ...q }));
const parseFile = async (f) => rowsToDemand((await readSheet(new Uint8Array(readFileSync(resolve(process.cwd(), 'sample-data', f))).buffer, ['Demand'])).rows);

describe('validateRows (one record per FG code + country)', () => {
  it('builds flat payloads with FG-level totals and Dist on every row', () => {
    const out = validateRows(fg({ dist: 4 }), index, { cycle: C });
    expect(out.map((v) => v.status)).toEqual(['ok', 'ok', 'ok']);
    expect(out[0].payload).toEqual({
      Planning_Cycle: C, Country: 'MMorocco', Plant: 'S1100', Type_field: tId.IOL, Model: 'DIHFY600', FG_Code_1: 'FGX', FG_Code_2: '', Cyl: '0',
      X3: 0, X2: 0, X1: 2, Zero: 0, Open_Orders: 0, Dist_Shortages: 4,
      X3_Total: 0, X2_Total: 0, X1_Total: 2, Zero_Total: 1, Total: 7, Status: 'Validated', Range: 'Running', Power: 21,
    });
    expect(out[2].payload.Open_Orders).toBeUndefined(); // India: no Open Orders column
    expect(out.map((v) => v.payload.Total)).toEqual([7, 7, 7]);
    expect(summarise(out)).toMatchObject({ ok: 3, qty: 7, fgCodes: 1 }); // Dist counted once
  });

  it('flags master data problems and holds back the whole FG code', () => {
    const out = validateRows([
      ...fg({ plant: '9999', fg1: 'A' }, [['Morocco', {}], ['Brazil', {}]]),
      line({ excelRow: 10, plant: '2100', fg1: 'B' }),
      line({ excelRow: 11, type: 'Unknown', fg1: 'C' }),
      line({ excelRow: 12, fg1: '' }),
      line({ excelRow: 13, range: 'High', fg1: 'D' }),
      line({ excelRow: 14, power: 'abc', fg1: 'E' }),
      line({ excelRow: 15, country: 'Japan', fg1: 'F' }),
    ], index, { cycle: C });
    expect(out.map((v) => v.status)).toEqual(Array(8).fill('error'));
    expect(out[0].errors).toContain('Plant "9999" is not in Sites');
    expect(out[2].errors).toContain('Type "IOL" is not set up for plant 2100 in Sites');
    expect(out[3].errors).toContain('Type "Unknown" is not a planning type');
    expect(out[4].errors).toContain('FG Code 1 is missing');
    expect(out[5].errors[0]).toMatch(/Range "High" must be one of/);
    expect(out[6].errors).toContain('Power "abc" is not a number');
    expect(out[7].errors).toContain('Country "Japan" is not in the country master');
  });

  it('one bad country row blocks the other rows of the same FG code', () => {
    const out = validateRows(fg({}, [['Morocco', { x3: -20 }], ['Brazil', {}]]), index, { cycle: C });
    expect(out[0].errors).toContain('Morocco 3X: negative quantity (-20)');
    expect(out[1].errors).toEqual(['Another country row of this FG code has errors']);
  });

  it('flags duplicate country rows and differing Dist', () => {
    const out = validateRows(fg({}, [['Morocco', { dist: 1 }], ['Morocco', { dist: 2 }]]), index, { cycle: C });
    expect(out[1].errors).toContain('Duplicate of Excel row 2 (same Plant + FG Code 1 + Country)');
    expect(out[0].warnings[0]).toMatch(/Dist. Shortages differs/);
  });

  it('skips country rows already uploaded for the cycle', () => {
    const existing = existingKeys([{ Planning_Cycle: "Oct'26", Plant: { ID: 'S1100' }, FG_Code_1: 'FGX', Country: { ID: 'MMorocco', display_value: 'x' } }], index);
    const out = validateRows(fg(), index, { cycle: C, existing });
    expect(out.map((v) => v.status)).toEqual(['skip', 'ok', 'ok']);
    expect(validateRows(fg(), index, { cycle: "NOV'26", existing }).map((v) => v.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('quantities are rounded to 2 decimals', () => {
    expect(parseQty(20884.983326286452, 'x')).toEqual({ value: 20884.98 });
    expect(parseQty('1,019.5', 'x')).toEqual({ value: 1019.5 });
    expect(parseQty(null, 'x')).toEqual({ value: 0 });
  });
});

describe('client data end to end', () => {
  for (const f of ['Demand_Upload_Template_Oct26.xlsx', 'Oct26_Demand_Plan_client.xlsx']) {
    it(`${f}: 322 valid rows, total matches the client's grand total`, async () => {
      const parsed = await parseFile(f);
      expect(fileErrors(parsed, index)).toEqual([]);
      const out = validateRows(parsed.lines, index, { cycle: C });
      expect(out.filter((v) => v.status !== 'ok').map((v) => [v.excelRow, v.errors])).toEqual([]);
      expect(out.filter((v) => v.warnings.some((w) => w.startsWith('Total in file')))).toEqual([]);
      const s = summarise(out);
      expect([s.ok, s.fgCodes]).toEqual([322, 46]);
      expect(Math.abs(s.qty - 137462.965)).toBeLessThan(0.5);
      const decimals = (x) => (String(x).split('.')[1] || '').length;
      for (const v of out) for (const [k, val] of Object.entries(v.payload)) if (typeof val === 'number') expect(decimals(val), k).toBeLessThanOrEqual(2);
    });
  }

  it('errors sample', async () => {
    const out = validateRows((await parseFile('Demand_Upload_TEST_with_errors.xlsx')).lines, index, { cycle: C });
    const s = summarise(out);
    // row 2 has a wrong plant, so it no longer belongs to the other 6 rows of its FG code (those stay valid)
    expect([s.total, s.ok, s.error]).toEqual([30, 6, 24]);
    const first = (row) => out.find((v) => v.excelRow === row).errors[0];
    expect(first(2)).toBe('Plant "9100" is not in Sites');
    expect(first(10)).toBe('Egypt 3X: negative quantity (-20)');
    expect(first(17)).toBe('Egypt 2X: "abc" is not a number');
    expect(first(24)).toBe('Country "Japan" is not in the country master');
    expect(first(31)).toBe('Duplicate of Excel row 30 (same Plant + FG Code 1 + Country)');
  });
});
