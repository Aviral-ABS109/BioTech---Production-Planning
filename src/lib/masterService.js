// Adds / edits records in the three master forms (Sites, Planning Type, Country)
// from inside the widget, and creates new countries found in an uploaded file.
import { MASTER_FORMS, REPORTS, F } from '../config.js';
import { addRecordsBatched, updateRecordById } from '../api/creator.js';

const REPORT_OF = { site: () => REPORTS.siteMaster, planningType: () => REPORTS.planningTypes, country: () => REPORTS.markets };
const workingForm = {}; // kind → the form link name the app accepted
const looksLikeMissingForm = (msg) => /unknown form|form.*(not|n't).*(exist|found)|invalid form|no such form|2945/i.test(String(msg));

/** Add one record to a master form; tries each configured link name until one works. */
export async function addMasterRecord(kind, data) {
  const names = workingForm[kind] ? [workingForm[kind]] : MASTER_FORMS[kind];
  let realError = '';
  let lastError = '';
  for (const name of names) {
    const [res] = await addRecordsBatched(name, [data], 1);
    if (res?.ok) {
      workingForm[kind] = name;
      return { ok: true, id: String(res.id) };
    }
    lastError = res?.error || 'Not saved';
    if (!looksLikeMissingForm(lastError)) realError = realError || lastError;
  }
  return { ok: false, error: realError || `${lastError} (form link names tried: ${names.join(', ')})` };
}

/** Update one master record through its report. */
export async function updateMasterRecord(kind, id, data) {
  try {
    await updateRecordById(REPORT_OF[kind](), id, data);
    return { ok: true };
  } catch (e) {
    const msg = e?.message || e?.error?.alert_message?.join?.('; ') || JSON.stringify(e);
    return { ok: false, error: msg };
  }
}

/** Record payloads for each master. */
export const masterPayload = {
  site: ({ code, typeIds, active }) => {
    const d = { [F.site.code]: code.trim(), [F.site.types]: typeIds };
    if (F.site.active) d[F.site.active] = active;
    return d;
  },
  planningType: ({ name, active }) => {
    const d = { [F.planningType.name]: name.trim() };
    if (F.planningType.active) d[F.planningType.active] = active;
    return d;
  },
  country: ({ name, active }) => {
    const d = { [F.market.name]: name.trim() };
    if (F.market.active) d[F.market.active] = active;
    return d;
  },
};

/**
 * Creates the new countries an upload needs (Active). Returns Map(norm name → { id } | { error }).
 */
export async function createCountries(names) {
  const out = new Map();
  for (const name of names) {
    const r = await addMasterRecord('country', masterPayload.country({ name, active: true }));
    out.set(name.trim().toLowerCase().replace(/\s+/g, ' '), r.ok ? { id: r.id, name } : { error: r.error });
  }
  return out;
}
