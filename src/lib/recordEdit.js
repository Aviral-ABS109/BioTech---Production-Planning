// Editing / deleting saved Demand records.
// A Demand record = one FG code + one country. Dist. Shortages and the
// X3/X2/X1/Zero totals + Total belong to the FG code (cycle + site + FG code 1)
// and are repeated on every country record of it — so a change to one record
// (or a delete) recalculates and rewrites those fields on all its siblings.
import { F, QTY_DECIMALS, RANGE_VALUES, RANGE_MAX_LENGTH } from '../config.js';
import { displayOf, idOf } from './validate.js';
import { normCycle } from './cycle.js';
import { REPORTS, UPLOAD_DELETED } from '../config.js';
import { updateRecordById, deleteRecordById, deleteRecordsWhere, getAllRecords, mapLimit } from '../api/creator.js';
import { loadDemandsForCycle } from './demandService.js';

const FACTOR = 10 ** QTY_DECIMALS;
const round = (n) => Math.round((n + Number.EPSILON) * FACTOR) / FACTOR;
export const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Records that share totals with each other: same cycle + site + FG code 1. */
export const groupKey = (d) => {
  const D = F.demand;
  return `${normCycle(displayOf(d[D.cycle]))}|${idOf(d[D.plant]) || displayOf(d[D.plant])}|${displayOf(d[D.fg1]).toLowerCase()}`;
};

/** Fields a user can edit on one record (keys of F.demand). Cycle, site, type, country and FG code 1 identify the record and stay fixed. */
export const EDITABLE = ['model', 'fg2', 'range', 'power', 'cyl', 'x3', 'x2', 'x1', 'zero', 'open', 'dist'];
const QTY = ['x3', 'x2', 'x1', 'zero', 'open', 'dist'];

/** Checks a form patch ({ x3: '12', range: 'Low', … }) → { data, errors } with values cleaned. */
export function cleanPatch(patch) {
  const data = {};
  const errors = {};
  for (const [k, raw] of Object.entries(patch)) {
    const s = String(raw ?? '').trim();
    if (QTY.includes(k)) {
      const n = s === '' ? 0 : Number(s.replace(/,/g, ''));
      if (!Number.isFinite(n)) errors[k] = 'Enter a number';
      else if (n < 0) errors[k] = 'Can’t be negative';
      else data[k] = round(n);
    } else if (k === 'power') {
      if (s === '' || /^na$/i.test(s)) data[k] = '';
      else if (!Number.isFinite(Number(s))) errors[k] = 'Enter a number or leave blank';
      else data[k] = Number(s);
    } else if (k === 'range') {
      if (s.length > RANGE_MAX_LENGTH) errors[k] = `At most ${RANGE_MAX_LENGTH} characters`;
      else data[k] = RANGE_VALUES.find((v) => v.toLowerCase() === s.toLowerCase()) || s;
    } else {
      data[k] = s;
    }
  }
  return { data, errors };
}

/** Value of a field (F.demand key) on a record, as stored. */
export const valueOf = (d, k) => (QTY.includes(k) || ['x3Total', 'x2Total', 'x1Total', 'zeroTotal', 'total'].includes(k) ? num(d[F.demand[k]]) : displayOf(d[F.demand[k]]));

/**
 * Plans the writes for an edit and/or deletes inside ONE FG-code group.
 * @param group    all records of the group (as read from the report)
 * @param edit     { id, data } cleaned patch for one record, or null
 * @param deleted  Set of record IDs being deleted
 * @returns [{ id, data: {link_name: value}, fields: [keys changed] }] for every remaining record that changes
 */
export function planGroupUpdate(group, edit = null, deleted = new Set()) {
  const D = F.demand;
  const remaining = group.filter((d) => !deleted.has(String(d.ID)));
  if (!remaining.length) return [];
  const eff = (d, k) => (edit && String(d.ID) === String(edit.id) && k in edit.data ? edit.data[k] : valueOf(d, k));
  // Dist belongs to the FG code: an edited value applies to all rows, otherwise keep the group's value
  const dist = edit && 'dist' in edit.data ? edit.data.dist : Math.max(0, ...remaining.map((d) => valueOf(d, 'dist')));
  const t = { x3: 0, x2: 0, x1: 0, zero: 0 };
  for (const d of remaining) for (const k of Object.keys(t)) t[k] = round(t[k] + num(eff(d, k)));
  const totals = { x3Total: t.x3, x2Total: t.x2, x1Total: t.x1, zeroTotal: t.zero, dist, total: round(dist + t.x3 + t.x2 + t.x1 + t.zero) };

  const out = [];
  for (const d of remaining) {
    const data = {};
    const fields = [];
    const target = { ...totals };
    if (edit && String(d.ID) === String(edit.id)) for (const [k, v] of Object.entries(edit.data)) if (k !== 'dist') target[k] = v;
    for (const [k, v] of Object.entries(target)) {
      const cur = valueOf(d, k);
      const same = typeof v === 'number' ? round(num(cur)) === round(v) : String(cur ?? '') === String(v ?? '');
      if (!same) { data[D[k]] = v; fields.push(k); }
    }
    if (fields.length) out.push({ id: String(d.ID), data, fields });
  }
  return out;
}

const ID_CHUNK = 50; // record IDs per bulk-delete criteria
const PARALLEL = 6; // writes in flight at once
export const idCriteria = (ids) => `(${ids.map((id) => `ID == ${id}`).join(' || ')})`;

/** Deletes records by ID: bulk (deleteRecords, ≤50 IDs per call), falling back to one call per record. */
export async function deleteIds(ids, onDone) {
  const deleted = [];
  const errors = [];
  let bulk = true;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK).map(String);
    if (bulk) {
      try {
        const base = deleted.length;
        const r = await deleteRecordsWhere(REPORTS.demands, idCriteria(chunk), { onBatch: (n) => onDone?.(base + n) });
        deleted.push(...r.deleted);
        onDone?.(deleted.length);
        errors.push(...r.errors);
        continue;
      } catch (e) {
        console.warn('[widget] bulk delete not available, deleting one by one', e);
        bulk = false;
      }
    }
    await mapLimit(chunk, PARALLEL, async (id) => {
      try { await deleteRecordById(REPORTS.demands, id); deleted.push(id); } catch (e) { errors.push(e.message); }
      onDone?.(deleted.length);
    });
  }
  return { deleted, errors };
}

/** Writes planned updates in parallel. Fills `changed` (id → fields) and `errors`. */
async function writePlans(plans, changed, errors, onDone) {
  let done = 0;
  await mapLimit(plans, PARALLEL, async (p) => {
    try { await updateRecordById(REPORTS.demands, p.id, p.data); changed.set(p.id, p.fields); } catch (e) { errors.push(e.message); }
    onDone?.(++done);
  });
}

/**
 * Progress reporter: onProgress({ step, done, total, pct }).
 * Steps share the bar: find 0–8 %, delete 8–80 %, totals 80–98 %, done 100 %.
 */
const SPAN = { find: [0, 8], delete: [8, 80], totals: [80, 98], done: [100, 100] };
const STEP_TEXT = { find: 'Finding the records', delete: 'Deleting records', totals: 'Recalculating FG totals', done: 'Done' };
function reporter(onProgress) {
  return (step, done = 0, total = 0) => {
    if (!onProgress) return;
    const [a, b] = SPAN[step];
    const pct = Math.round(a + (total ? Math.min(1, done / total) : 0) * (b - a));
    onProgress({ step, text: STEP_TEXT[step], done, total, pct });
  };
}

/** Records grouped by FG code (cycle + site + FG code 1). */
function groupMap(records) {
  const groups = new Map();
  for (const d of records) {
    const k = groupKey(d);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  return groups;
}

/**
 * Applies an edit and/or deletes to the platform, group by group.
 * Deletes go in bulk; the FG-total rewrites of the remaining rows run in parallel.
 * @param records  every loaded record (to find each group's siblings)
 * @param edit     { id, data } or null · deleted: Set of IDs
 * @returns { changed: Map(id → fields[]), deletedOk: [ids], errors: [text] }
 */
export async function applyChanges(records, edit, deleted = new Set(), onProgress) {
  const report = reporter(onProgress);
  const changed = new Map();
  const errors = [];
  const byId = new Map(records.map((d) => [String(d.ID), d]));
  const groups = groupMap(records);
  const touched = new Set([...(edit ? [edit.id] : []), ...deleted].map((id) => byId.get(String(id))).filter(Boolean).map(groupKey));
  if (deleted.size) report('delete', 0, deleted.size);
  const del = deleted.size ? await deleteIds([...deleted], (n) => report('delete', n, deleted.size)) : { deleted: [], errors: [] };
  errors.push(...del.errors);
  const gone = new Set(del.deleted);
  const plans = [];
  for (const k of touched) {
    plans.push(...planGroupUpdate(groups.get(k) || [], edit && groupKey(byId.get(String(edit.id))) === k ? edit : null, gone));
  }
  report('totals', 0, plans.length);
  await writePlans(plans, changed, errors, (n) => report('totals', n, plans.length));
  report('done');
  return { changed, deletedOk: del.deleted, errors };
}

/**
 * Deletes every Demand record saved from one uploaded file (linked through Demand_Upload),
 * recalculates FG totals on rows of the same FG codes that came from other files,
 * and marks the upload as Deleted.
 * @returns { deleted, changed, errors, statusSaved }
 */
export async function deleteUpload(uploadId, onProgress, { expected = 0 } = {}) {
  const report = reporter(onProgress);
  report('find', 0, expected);
  const D = F.demand;
  if (!D.upload) throw new Error('Demand records are not linked to uploads (F.demand.upload is off).');
  const id = String(uploadId).replace(/[^0-9]/g, '');
  const crit = `${D.upload} == ${id}`;
  let linked;
  try {
    linked = await getAllRecords(REPORTS.demands, { criteria: crit, onPage: (n) => report('find', n / 2, expected || n * 2) });
  } catch (e) {
    console.warn('[widget] upload criteria read failed, filtering locally', e);
    linked = (await getAllRecords(REPORTS.demands)).filter((d) => String(idOf(d[D.upload]) || '') === id);
  }
  if (!linked.length) return { deleted: 0, changed: new Map(), errors: [], statusSaved: await markUploadDeleted(id), none: true };

  // other records of the same cycles, to rewrite FG totals of groups this file shared with other files
  const cycles = [...new Set(linked.map((d) => displayOf(d[D.cycle])))];
  const pool = [];
  report('find', 1, 2);
  for (const c of cycles) pool.push(...(await loadDemandsForCycle(c)));
  const linkedIds = new Set(linked.map((d) => String(d.ID)));
  const touched = new Set(linked.map(groupKey));
  const total = linkedIds.size;
  report('delete', 0, total);

  let del;
  try {
    del = await deleteRecordsWhere(REPORTS.demands, crit, { onBatch: (n) => report('delete', n, total) });
    // anything the criteria call missed (e.g. a per-row error) is retried by ID
    const missed = [...linkedIds].filter((x) => !del.deleted.includes(x));
    if (missed.length && del.errors.length === 0) {
      const base = del.deleted.length;
      const again = await deleteIds(missed, (n) => report('delete', base + n, total));
      del = { deleted: [...del.deleted, ...again.deleted], errors: again.errors };
    }
  } catch (e) {
    console.warn('[widget] bulk delete by upload failed, deleting by ID', e);
    del = await deleteIds([...linkedIds], (n) => report('delete', n, total));
  }
  const gone = new Set(del.deleted);
  const errors = [...del.errors];
  const changed = new Map();
  const groups = groupMap(pool.filter((d) => touched.has(groupKey(d))));
  const plans = [];
  for (const [, group] of groups) plans.push(...planGroupUpdate(group, null, new Set([...gone, ...linkedIds])));
  report('totals', 0, plans.length);
  await writePlans(plans, changed, errors, (n) => report('totals', n, plans.length));
  const statusSaved = gone.size === linkedIds.size ? await markUploadDeleted(id) : false;
  report('done');
  return { deleted: gone.size, expected: linkedIds.size, changed, errors, statusSaved };
}

async function markUploadDeleted(id) {
  const U = F.upload;
  try {
    await updateRecordById(REPORTS.demandUploads, id, { [U.status]: UPLOAD_DELETED });
    return true;
  } catch (e) {
    console.warn(`[widget] upload status not set to ${UPLOAD_DELETED} (add it to the Status options)`, e);
    return false;
  }
}
