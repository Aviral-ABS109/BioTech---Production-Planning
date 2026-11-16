// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { getZoho, addRecordsBatched, getAllRecords } from '../src/api/creator.js';
import { deleteUpload, applyChanges, idCriteria } from '../src/lib/recordEdit.js';
import { buildXlsx } from '../src/lib/xlsxWriter.js';
import { readSheet } from '../src/lib/xlsxReader.js';
import { REPORTS } from '../src/config.js';

const row = (fg, country, x3, upload) => ({
  Planning_Cycle: "OCT'26", Plant: 'P1', Type_field: 'T1', Country: country, FG_Code_1: fg,
  X3: x3, X2: 0, X1: 0, Zero: 0, Open_Orders: 0, Dist_Shortages: 2, Demand_Upload: upload,
});

describe('bulk delete (mock platform)', () => {
  let u1; let u2;
  beforeAll(async () => {
    expect(getZoho().__mock).toBe(true);
    [{ id: u1 }] = await addRecordsBatched('Demand_Upload', [{ Upload_Name: "OCT'26 – a.xlsx", Status: 'Completed' }], 1);
    [{ id: u2 }] = await addRecordsBatched('Demand_Upload', [{ Upload_Name: "OCT'26 – b.xlsx", Status: 'Completed' }], 1);
    // 250 rows from file 1 (more than one 200-row delete call); FG "A" is shared with file 2
    const first = [row('A', 'C1', 3, u1), ...Array.from({ length: 249 }, (_, i) => row(`F${i}`, 'C1', 1, u1))];
    await addRecordsBatched('Demand', first, 100);
    await addRecordsBatched('Demand', [row('A', 'C2', 5, u2)], 1);
  });

  it('builds an OR criteria from IDs', () => {
    expect(idCriteria(['1', '2'])).toBe('(ID == 1 || ID == 2)');
  });

  it('deletes every record of one upload and recalculates shared FG totals', async () => {
    const steps = [];
    const res = await deleteUpload(u1, (p) => steps.push(p));
    expect(steps[0].step).toBe('find');
    expect(steps.at(-1)).toMatchObject({ step: 'done', pct: 100 });
    expect(steps.some((p) => p.step === 'delete' && p.done === 200 && p.total === 250)).toBe(true);
    for (let i = 1; i < steps.length; i++) expect(steps[i].pct).toBeGreaterThanOrEqual(steps[i - 1].pct);
    expect(res.deleted).toBe(250);
    expect(res.errors).toEqual([]);
    expect(res.statusSaved).toBe(true);
    const left = await getAllRecords(REPORTS.demands);
    expect(left).toHaveLength(1);
    expect(Number(left[0].X3_Total)).toBe(5);
    expect(Number(left[0].Total)).toBe(7); // 5 + Dist 2
    const ups = await getAllRecords(REPORTS.demandUploads);
    expect(ups.find((u) => u.ID === u1).Status).toBe('Deleted');
  });

  it('deleting selected records uses the bulk call', async () => {
    const recs = await getAllRecords(REPORTS.demands);
    const r = await applyChanges(recs, null, new Set([recs[0].ID]));
    expect(r.deletedOk).toEqual([recs[0].ID]);
    expect(await getAllRecords(REPORTS.demands)).toHaveLength(0);
  });
});

describe('xlsx export', () => {
  it('writes a sheet that reads back with numbers kept', async () => {
    const buf = await buildXlsx([{ name: 'Demand OCT 2026', header: ['Country', '3X', 'Note'], rows: [['India', 1.5, 'a & <b>'], ['Brazil', 0, '']] }], 'arraybuffer');
    const sheet = await readSheet(buf);
    const rows = sheet.rows ?? sheet;
    expect(JSON.stringify(rows)).toContain('India');
    expect(JSON.stringify(rows)).toContain('a & <b>');
    expect(JSON.stringify(rows)).toContain('1.5');
  });
});
