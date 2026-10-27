// Thin wrapper over the platform JS API v2 (ZOHO.CREATOR.*).
// Everything else in the widget talks to the platform only through this file,
// so swapping to a custom API later only touches this module.
import { APP_NAME } from '../config.js';
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
export async function getAllRecords(report_name, { criteria, fields } = {}) {
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
