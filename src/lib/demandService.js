// Use-case layer: what the screens call. Knows the workflow, not the UI.
import { REPORTS, FORMS, F, BATCH_SIZE } from '../config.js';
import { getAllRecords, addRecordsBatched, updateRecordById, uploadFile, getLoginUser } from '../api/creator.js';
import { buildMasterIndex, displayOf, recordPlant, recordType, recordCountry } from './validate.js';
import { sameCycle, yearFromCycle } from './cycle.js';
import { createCountries } from './masterService.js';

export async function loadMasters() {
  const [sites, planningTypes, markets] = await Promise.all([
    getAllRecords(REPORTS.siteMaster),
    getAllRecords(REPORTS.planningTypes),
    getAllRecords(REPORTS.markets),
  ]);
  const index = buildMasterIndex({ sites, planningTypes, markets });
  return {
    markets: [...index.marketByName.values()].filter((m) => m.active),
    index,
  };
}

/** Years that already have demand saved (reads only the Planning Cycle field). */
export async function loadDemandYears() {
  const list = await getAllRecords(REPORTS.demands, { fields: [F.demand.cycle] });
  return [...new Set(list.map((d) => yearFromCycle(displayOf(d[F.demand.cycle]))).filter(Boolean))];
}

export async function loadDemandsForCycle(cycle) {
  const keep = (list) => list.filter((d) => sameCycle(displayOf(d[F.demand.cycle]), cycle));
  try {
    const safe = String(cycle).replace(/"/g, '');
    return keep(await getAllRecords(REPORTS.demands, { criteria: `${F.demand.cycle} == "${safe}"` }));
  } catch (e) {
    // Fallback if the criteria is rejected: read all and filter here.
    console.warn('[widget] criteria read failed, retrying without criteria', e);
    return keep(await getAllRecords(REPORTS.demands));
  }
}

/**
 * Saves the rows marked 'ok':
 * 1. creates a Demand Upload record (history of the file)
 * 2. adds Demand records (one per FG code + country) in batches, linked to it
 * 3. updates the upload record with counts + error log and attaches the file
 * Returns per-row results so the preview can show what happened to each row.
 */
export async function runUpload({ file, cycle, validated, onProgress }) {
  let toSend = validated.filter((v) => v.status === 'ok');
  // 0. create countries that are new in this file (Active), then point their rows at them
  const newNames = [...new Map(toSend.filter((v) => v.newCountry).map((v) => [v.newCountry.toLowerCase(), v.newCountry])).values()];
  const created = newNames.length ? await createCountries(newNames) : new Map();
  const countryFailed = [];
  if (created.size) {
    toSend = toSend.flatMap((v) => {
      if (!v.newCountry) return [v];
      const c = created.get(v.newCountry.trim().toLowerCase().replace(/\s+/g, ' '));
      if (c?.id) return [{ ...v, payload: { ...v.payload, [F.demand.country]: c.id } }];
      countryFailed.push({ key: v.key, excelRow: v.excelRow, country: v.display.country, ok: false, error: `Country "${v.newCountry}" could not be added: ${c?.error || 'unknown error'}` });
      return [];
    });
  }
  const addedCountries = [...created.values()].filter((c) => c.id).map((c) => c.name);
  const skipped = validated.filter((v) => v.status === 'skip').length;
  const blocked = validated.filter((v) => v.status === 'error').length;
  const U = F.upload;
  let uploadId = null;

  if (FORMS.demandUpload) {
    const user = await getLoginUser();
    const base = {
      [U.name]: `${cycle} – ${file.name}`,
      [U.totalRows]: validated.length,
      [U.status]: 'In Progress',
      [U.uploadedBy]: user,
    };
    let [res] = await addRecordsBatched(FORMS.demandUpload, [U.cycle ? { ...base, [U.cycle]: cycle } : base], 1);
    if (!res?.ok && U.cycle) {
      // Planning_Cycle on Demand Upload may still be a lookup → save without it
      console.warn('[widget] upload record rejected with cycle text, retrying without it:', res?.error);
      [res] = await addRecordsBatched(FORMS.demandUpload, [base], 1);
    }
    if (!res?.ok) throw new Error(`Could not create the upload record: ${res?.error}`);
    uploadId = res.id;
  }

  const payloads = toSend.map((v) =>
    uploadId && F.demand.upload ? { ...v.payload, [F.demand.upload]: uploadId } : v.payload
  );
  const results = await addRecordsBatched(FORMS.demand, payloads, BATCH_SIZE, onProgress);

  const rowResults = [...toSend.map((v, i) => ({ key: v.key, excelRow: v.excelRow, country: v.display.country, ...results[i] })), ...countryFailed];
  const success = rowResults.filter((r) => r.ok).length;
  const failed = rowResults.filter((r) => !r.ok);

  if (uploadId) {
    const log = failed.map((f) => `Row ${f.excelRow} (${f.country}): ${f.error}`).join('\n');
    const status = failed.length === 0 ? 'Completed' : success === 0 ? 'Failed' : 'Completed with Errors';
    await updateRecordById(REPORTS.demandUploads, uploadId, {
      [U.successRows]: success,
      [U.failedRows]: failed.length + blocked,
      [U.skippedRows]: skipped,
      [U.status]: status,
      [U.log]: log.slice(0, 30000),
    });
    try {
      await uploadFile(REPORTS.demandUploads, uploadId, U.file, file);
    } catch (e) {
      console.warn('[widget] source file not attached:', e); // non-fatal
    }
  }

  return { uploadId, sent: toSend.length, success, failed, skipped, blocked, rowResults, addedCountries };
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Status per Plant + Type for a cycle. Records are one FG code + one country:
 * country quantities are added record by record; Dist. Shortages is repeated
 * on every country record of an FG code, so it is counted once per FG code.
 * Plant + Type pairs come from Sites (each plant's planning types).
 */
export function buildStatus(demands, index) {
  const D = F.demand;
  const rows = [];
  const byKey = new Map();
  const add = (plant, type, inMaster) => {
    const key = `${plant.toLowerCase()}|${type.toLowerCase()}`;
    if (!byKey.has(key)) {
      const row = { key, plant, type, inMaster, fgCodes: 0, records: 0, x3: 0, x2: 0, x1: 0, zero: 0, open: 0, dist: 0, total: 0, _fg: new Map() };
      byKey.set(key, row);
      rows.push(row);
    }
    return byKey.get(key);
  };
  for (const s of index.siteByCode.values()) {
    for (const t of s.typeNames) add(s.code, t, true);
  }
  for (const d of demands) {
    const r = add(recordPlant(d, index) || '—', recordType(d, index) || '—', false);
    r.records++;
    r.x3 += num(d[D.x3]);
    r.x2 += num(d[D.x2]);
    r.x1 += num(d[D.x1]);
    r.zero += num(d[D.zero]);
    r.open += num(d[D.open]);
    r._fg.set(displayOf(d[D.fg1]).toLowerCase(), num(d[D.dist]));
  }
  for (const r of rows) {
    r.fgCodes = r._fg.size;
    r.dist = [...r._fg.values()].reduce((a, b) => a + b, 0);
    r.total = r.x3 + r.x2 + r.x1 + r.zero + r.dist;
    r.ready = r.records > 0;
    delete r._fg;
  }
  rows.sort((a, b) => a.plant.localeCompare(b.plant) || a.type.localeCompare(b.type));
  return rows;
}

/**
 * Country breakdown for the status tab: for each Plant + Type key (same keys as
 * buildStatus) a list of countries with their FG codes and 3X/2X/1X/ZERO/Open.
 * Dist. Shortages is per FG code, so it stays on the Plant + Type level.
 */
export function buildCountryBreakdown(demands, index) {
  const D = F.demand;
  const byKey = new Map();
  for (const d of demands) {
    const plant = recordPlant(d, index) || '—';
    const type = recordType(d, index) || '—';
    const key = `${plant.toLowerCase()}|${type.toLowerCase()}`;
    const country = recordCountry(d, index) || '—';
    if (!byKey.has(key)) byKey.set(key, new Map());
    const m = byKey.get(key);
    if (!m.has(country)) m.set(country, { country, fg: new Set(), x3: 0, x2: 0, x1: 0, zero: 0, open: 0 });
    const c = m.get(country);
    c.fg.add(displayOf(d[D.fg1]).toLowerCase());
    c.x3 += num(d[D.x3]);
    c.x2 += num(d[D.x2]);
    c.x1 += num(d[D.x1]);
    c.zero += num(d[D.zero]);
    c.open += num(d[D.open]);
  }
  const out = new Map();
  for (const [key, m] of byKey) {
    out.set(key, [...m.values()]
      .map(({ fg, ...c }) => ({ ...c, fgCodes: fg.size, total: c.x3 + c.x2 + c.x1 + c.zero }))
      .sort((a, b) => a.country.localeCompare(b.country)));
  }
  return out;
}
