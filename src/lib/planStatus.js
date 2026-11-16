// Site-wise planning progress: one Site Plan Status record per planning cycle + site.
// A site with demand but no record yet is at "Demand Collection" (demand is in, planning not started).
import { REPORTS, FORMS, F, PLAN_STAGES } from '../config.js';
import { getAllRecords, addRecordsBatched, updateRecordById, getLoginUser, nameFromEmail } from '../api/creator.js';
import { displayOf, idOf } from './validate.js';
import { normCycle } from './cycle.js';

const P = F.planStatus;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
/** Creator's default date-time text: 05-Nov-2026 14:20:00 */
export const creatorDateTime = (d = new Date()) => `${pad(d.getDate())}-${MON[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export const stageIndex = (name) => {
  const i = PLAN_STAGES.findIndex((s) => s.toLowerCase() === String(name || '').trim().toLowerCase());
  return i < 0 ? 0 : i;
};

/** Every status record (the table is small: cycles × sites). */
export async function loadPlanStatus() {
  if (!FORMS.sitePlanStatus || !REPORTS.sitePlanStatus) return [];
  try {
    return await getAllRecords(REPORTS.sitePlanStatus);
  } catch (e) {
    console.warn('[widget] Site Plan Status not loaded', e);
    return [];
  }
}

/** Status records → Map(cycle → Map(siteId → { recordId, stage, by, at })). */
export function indexStatus(records, index) {
  const out = new Map();
  for (const r of records) {
    const cycle = normCycle(displayOf(r[P.cycle]));
    let siteId = idOf(r[P.site]);
    if (!index?.siteById.has(siteId)) siteId = index?.siteByCode.get(displayOf(r[P.site]).toLowerCase())?.id || siteId;
    if (!out.has(cycle)) out.set(cycle, new Map());
    out.get(cycle).set(siteId, {
      recordId: String(r.ID),
      stage: stageIndex(displayOf(r[P.stage])),
      by: displayOf(r[P.updatedBy]),
      at: displayOf(r[P.updatedOn]) || displayOf(r.Modified_Time) || displayOf(r.Added_Time),
    });
  }
  return out;
}

/**
 * Tracker for one cycle.
 * @param plants  site codes that have demand in the cycle
 * @returns { sites: [{ code, id, stage, started, by, at, recordId }], stages: [{ name, done, current }], n, started, signedOff }
 */
export function buildTracker(plants, cycleStatus, index) {
  const sites = [...new Set(plants)].filter(Boolean)
    .map((code) => {
      const site = index?.siteByCode.get(String(code).toLowerCase());
      const st = site ? cycleStatus?.get(site.id) : null;
      const stage = st?.stage ?? 0;
      return { code, id: site?.id || '', stage, started: stage >= 1, by: st?.by || '', at: st?.at || '', recordId: st?.recordId || '' };
    })
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const n = sites.length;
  const last = PLAN_STAGES.length - 1; // "Signed Off" = every visible stage done
  const stages = PLAN_STAGES.slice(0, last).map((name, i) => ({
    name,
    // Demand Collection is done for every site that has demand
    done: i === 0 ? n : sites.filter((s) => s.stage > i).length,
    current: i === 0 ? 0 : sites.filter((s) => s.stage === i).length,
  }));
  return { sites, stages, n, started: sites.filter((s) => s.started).length, signedOff: sites.filter((s) => s.stage >= last).length };
}

/** Moves a site to a stage for a cycle: updates its record, or creates one. Returns the record ID. */
export async function setSiteStage({ cycle, site, stage, existingId }) {
  const user = await getLoginUser();
  const base = { [P.stage]: stage, [P.updatedBy]: nameFromEmail(user) || user };
  const withTime = P.updatedOn ? { ...base, [P.updatedOn]: creatorDateTime() } : base;
  const write = async (data) => {
    if (existingId) {
      await updateRecordById(REPORTS.sitePlanStatus, existingId, data);
      return existingId;
    }
    const [res] = await addRecordsBatched(FORMS.sitePlanStatus, [{ [P.cycle]: cycle, [P.site]: site.id, ...data }], 1);
    if (!res?.ok) throw new Error(res?.error || 'Could not save the planning status');
    return res.id;
  };
  try {
    return await write(withTime);
  } catch (e) {
    if (withTime === base) throw e;
    // the date-time text may not match the app's date format: save without it (Modified time still shows when)
    console.warn('[widget] Stage_Updated_On rejected, saving without it', e);
    return write(base);
  }
}
