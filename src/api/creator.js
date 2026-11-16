// Thin wrapper over the platform JS API v2 (ZOHO.CREATOR.*).
// Everything else in the widget talks to the platform only through this file,
// so swapping to a custom API later only touches this module.
import { APP_NAME, USER_API } from '../config.js';
import { createMockZoho } from './mock.js';

let zoho = null;

/** Real SDK inside the application; in-memory mock when running `npm run dev` locally. */
export function getZoho() {
  if (zoho) return zoho;
  const params = new URLSearchParams(window.location.search);
  const forceLive = params.get('live') === '1';
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  // import.meta.env.DEV is false in `vite build`, so the mock is dropped from the widget zip
  if (import.meta.env.DEV && isLocal && !forceLive) {
    zoho = createMockZoho();
    console.info('[demand-widget] Using MOCK data (local dev). Add ?live=1 to use the real SDK.');
  } else if (window.ZOHO?.CREATOR) {
    zoho = window.ZOHO;
  } else {
    throw new Error('The application SDK did not load. Open this page from inside the application.');
  }
  return zoho;
}

export const isMock = () => Boolean(getZoho().__mock);

const withApp = (cfg) => (APP_NAME ? { app_name: APP_NAME, ...cfg } : cfg);

/**
 * The API rejects with different shapes (plain object, JSON string, XHR-like
 * object with responseText, Error). Pull out { code, message, raw } from any of them.
 */
export function unwrapError(e) {
  let obj = e;
  const tryJson = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
  if (typeof e === 'string') obj = tryJson(e) || { message: e };
  else if (e && typeof e === 'object') {
    obj = tryJson(e.responseText) || tryJson(e.response) || tryJson(e.data) || e;
  }
  const code = obj?.code ?? obj?.status ?? e?.status;
  const message =
    obj?.message || obj?.description || (typeof obj?.error === 'string' ? obj.error : '') ||
    (e instanceof Error ? e.message : '');
  let raw = '';
  try { raw = JSON.stringify(e && typeof e === 'object' && !(e instanceof Error) ? e : obj); } catch { raw = String(e); }
  return { code, message, raw: (raw || '').slice(0, 400) };
}

/** The parsed body of a rejected call, so per-record results/errors can be read. */
export function errorBody(e) {
  const tryJson = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
  if (typeof e === 'string') return tryJson(e) || { message: e };
  if (e instanceof Error) return { message: e.message };
  return tryJson(e?.responseText) || tryJson(e?.response) || e;
}

/** "No records" response: code 3100, HTTP 404, or the text. */
export const isNoRecords = (u) =>
  u.code === 3100 || u.code === '3100' || u.code === 404 || /no record/i.test(`${u.message} ${u.raw}`);

function assertOk(res, what) {
  if (!res || (res.code !== 3000 && res.code !== undefined)) {
    const msg = res?.message || res?.error || JSON.stringify(res);
    throw new Error(`${what} failed: ${msg}`);
  }
  return res;
}

/** Fetch every record of a report, following record_cursor past 1000 rows. */
export async function getAllRecords(report_name, { criteria, fields, onPage } = {}) {
  const Z = getZoho();
  const out = [];
  let record_cursor;
  // safety stop at 50 pages = 50,000 rows
  for (let page = 0; page < 50; page++) {
    const cfg = withApp({ report_name, max_records: 1000 });
    if (criteria) cfg.criteria = criteria;
    if (fields) {
      cfg.field_config = 'custom';
      cfg.fields = fields.join(',');
    } else {
      cfg.field_config = 'all';
    }
    if (record_cursor) cfg.record_cursor = record_cursor;
    let res;
    try {
      res = await Z.CREATOR.DATA.getRecords(cfg);
    } catch (e) {
      // "No records found" (code 3100) comes back as a rejected promise
      const u = unwrapError(e);
      if (isNoRecords(u)) break;
      console.error(`[widget] getRecords ${report_name} failed`, e);
      throw new Error(`Reading ${report_name}: ${u.message || 'error'} (code ${u.code ?? '?'}) ${u.message ? '' : u.raw}`.trim());
    }
    if (res?.code === 3100 || res?.code === '3100') break;
    assertOk(res, `Reading ${report_name}`);
    out.push(...(res.data || []));
    onPage?.(out.length);
    record_cursor = res.record_cursor;
    if (!record_cursor) break;
  }
  return out;
}

/**
 * Add records in batches. Returns one result per input row:
 * { ok: true, id } or { ok: false, error }.
 */
export async function addRecordsBatched(form_name, rows, batchSize, onProgress) {
  const Z = getZoho();
  const results = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    let res;
    try {
      res = await Z.CREATOR.DATA.addRecords(withApp({ form_name, payload: { data: chunk } }));
    } catch (e) {
      console.error(`[widget] addRecords ${form_name} rejected`, e);
      res = errorBody(e);
    }
    results.push(...parseAddResult(res, chunk.length));
    onProgress?.(Math.min(i + batchSize, rows.length), rows.length);
  }
  return results;
}

/** Multi-record response shapes vary slightly; normalise them. */
export function parseAddResult(res, expected) {
  const list = Array.isArray(res?.result) ? res.result : Array.isArray(res?.data) ? res.data : null;
  if (list) {
    return list.map((r) =>
      r?.code === 3000
        ? { ok: true, id: r.data?.ID ?? r.ID }
        : { ok: false, error: errorText(r) }
    );
  }
  // single-object response for the whole batch
  if (res?.code === 3000 && res?.data?.ID && expected === 1) return [{ ok: true, id: res.data.ID }];
  const err = errorText(res);
  return Array.from({ length: expected }, () => ({ ok: false, error: err }));
}

function errorText(r) {
  if (!r) return 'No response';
  if (typeof r.error === 'string') return r.error;
  if (Array.isArray(r.error)) return r.error.join('; ');
  if (r.error && typeof r.error === 'object') {
    // workflow alerts ("alert ...; cancel submit;") arrive as alert_message
    if (r.error.alert_message) return [].concat(r.error.alert_message).join('; ');
    return Object.entries(r.error).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join('; ');
  }
  return r.message || `Error code ${r.code}`;
}

function normaliseError(e, what) {
  if (e instanceof Error) return new Error(`${what}: ${e.message}`);
  return new Error(`${what}: ${errorText(e)}`);
}

export async function updateRecordById(report_name, id, data) {
  const Z = getZoho();
  const res = await Z.CREATOR.DATA.updateRecordById(withApp({ report_name, id, payload: { data } }));
  return assertOk(res, `Updating ${report_name}`);
}

export async function deleteRecordById(report_name, id) {
  const Z = getZoho();
  let res;
  try {
    res = await Z.CREATOR.DATA.deleteRecordById(withApp({ report_name, id }));
  } catch (e) {
    throw normaliseError(e, `Deleting record ${id}`);
  }
  return assertOk(res, `Deleting record ${id}`);
}

/**
 * Bulk delete by criteria (JS API v2 deleteRecords): up to 200 records per call,
 * repeated until nothing matches. One call per 200 rows instead of one per row.
 * @returns { deleted: [ids], errors: [text] }
 */
export async function deleteRecordsWhere(report_name, criteria, { skipWorkflow, onBatch } = {}) {
  const Z = getZoho();
  if (typeof Z.CREATOR.DATA.deleteRecords !== 'function') throw new Error('deleteRecords is not available in this SDK');
  if (!criteria || !String(criteria).trim()) throw new Error('A criteria is required to delete records');
  const deleted = [];
  const errors = [];
  let more;
  // safety stop: 500 × 200 = 100,000 rows
  for (let i = 0; i < 500; i++) {
    const payload = { criteria };
    if (skipWorkflow) payload.skip_workflow = skipWorkflow;
    const cfg = withApp({ report_name, process_until_limit: 'true', payload });
    if (more) cfg.more_records = more;
    let res;
    try {
      res = await Z.CREATOR.DATA.deleteRecords(cfg);
    } catch (e) {
      const u = unwrapError(e);
      if (isNoRecords(u)) break;
      throw normaliseError(e, 'Deleting records');
    }
    if (res?.code === 3100 || res?.code === '3100') break;
    const list = Array.isArray(res?.result) ? res.result : [];
    if (res?.code !== 3000 && !list.length) throw new Error(`Deleting records: ${errorText(res)}`);
    for (const r of list) {
      if (r?.code === 3000) deleted.push(String(r.data?.ID ?? r.ID ?? ''));
      else errors.push(errorText(r));
    }
    onBatch?.(deleted.length);
    more = res?.more_records;
    // stop when the platform says there is nothing more, or a round deleted nothing (avoid looping on errors)
    if (!more || !list.some((r) => r?.code === 3000)) break;
  }
  return { deleted, errors };
}

/** Runs fn over items with at most `limit` calls in flight. Keeps input order in the results. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function uploadFile(report_name, id, field_name, file) {
  const Z = getZoho();
  const res = await Z.CREATOR.FILE.uploadFile(withApp({ report_name, id, field_name, file }));
  return assertOk(res, 'Uploading file');
}

export async function getLoginUser() {
  try {
    const p = await getZoho().CREATOR.UTIL.getInitParams();
    return p?.loginUser || '';
  } catch {
    return '';
  }
}

/** "aviral.srivastava@x.com" → "Aviral Srivastava" (fallback when no name is available). */
export function nameFromEmail(email) {
  const local = String(email || '').split('@')[0];
  return local.split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Logged-in user for the sidebar: { email, name, role }.
 * Email comes from getInitParams (name is built from it); role from the optional custom API.
 */
export async function getCurrentUser() {
  const Z = getZoho();
  let email = '';
  try { email = (await Z.CREATOR.UTIL.getInitParams())?.loginUser || ''; } catch { /* not available */ }
  const user = { email, name: '', role: '' };
  if (USER_API?.api_name && Z.CREATOR.DATA.invokeCustomApi) {
    try {
      const cfg = withApp({ api_name: USER_API.api_name, http_method: 'GET' });
      if (USER_API.public_key) cfg.public_key = USER_API.public_key;
      const res = await Z.CREATOR.DATA.invokeCustomApi(cfg);
      // response shape varies: { result: {...} } · { data: {...} } · the map itself
      let d = res?.result ?? res?.data ?? res;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
      if (d && typeof d === 'object') {
        user.email = d.email || user.email;
        user.role = d.role || d.profile || '';
      }
    } catch (e) {
      console.info('[widget] current-user API not available, using the email only', e);
    }
  }
  // The platform gives scripts the login username (e.g. "sfadoption_biotechhealthc"),
  // not the profile display name, so the name shown is built from the email.
  user.name = nameFromEmail(user.email) || 'Signed-in user';
  return user;
}
