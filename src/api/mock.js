// In-memory stand-in for the platform SDK so the widget runs with `npm run dev`
// outside the application. It mimics JS API v2 response shapes and replays the
// field limits (2 decimal places). Only loaded in dev builds (see creator.js); never shipped in the zip.
import seed from './mockSeed.json';
import { REPORTS, FORMS, F } from '../config.js';

let nextId = 4100000000000001;
const newId = () => String(nextId++);
const lookup = (id, display) => ({ ID: String(id), display_value: display });
// local testing only: localStorage.mockSlow = 10 makes every call 10× slower (to see loaders)
const slow = () => { try { return Number(localStorage.getItem('mockSlow')) || 1; } catch { return 1; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms * slow()));

export function createMockZoho() {
  const types = seed.planningTypes.map((n) => ({ ID: newId(), [F.planningType.name]: n }));
  const typeByName = Object.fromEntries(types.map((t) => [t[F.planningType.name], t]));
  const db = {
    [REPORTS.planningTypes]: types,
    [REPORTS.siteMaster]: seed.sites.map((s) => ({
      ID: newId(),
      [F.site.code]: s.Site_Name,
      [F.site.types]: s.types.map((n) => lookup(typeByName[n].ID, n)),
    })),
    [REPORTS.markets]: seed.markets.map((n) => ({ ID: newId(), [F.market.name]: n, [F.market.active]: 'true' })),
    [REPORTS.demands]: [],
    [REPORTS.demandUploads]: [],
    [REPORTS.sitePlanStatus]: [],
  };
  const byId = (report, id) => db[report].find((r) => r.ID === String(id));
  const files = {};

  // supports "Field == value" joined by && or || (one level of parentheses)
  function matches(rec, criteria) {
    if (!criteria) return true;
    const one = (part) => {
      const m = part.trim().replace(/^\(+|\)+$/g, '').trim().match(/^(\w+)\s*==\s*"?([^"]*)"?$/);
      if (!m) return true;
      const v = rec[m[1]];
      const actual = v && typeof v === 'object' ? v.ID : String(v);
      return actual === m[2].trim();
    };
    return criteria.split('&&').every((p) => (p.includes('||') ? p.split('||').some(one) : one(p)));
  }

  function saveDemand(d) {
    const D = F.demand;
    if (!d[D.plant] || !d[D.type] || !d[D.cycle] || !d[D.country]) return { error: 'Plant, Type, Country and Planning Cycle are mandatory.' };
    if (typeof d[D.cycle] !== 'string') return { error: 'Planning_Cycle must be text' };
    const decimals = (x) => (String(x).split('.')[1] || '').length;
    for (const k of [D.x3, D.x2, D.x1, D.zero, D.open, D.dist, D.x3Total, D.x2Total, D.x1Total, D.zeroTotal, D.total]) {
      if (d[k] !== undefined && decimals(d[k]) > 2) return { error: `${k} has exceeded its maximum digits.` };
    }
    const site = byId(REPORTS.siteMaster, d[D.plant]);
    const type = byId(REPORTS.planningTypes, d[D.type]);
    const market = byId(REPORTS.markets, d[D.country]);
    const rec = {
      ...d,
      ID: newId(),
      [D.plant]: lookup(d[D.plant], site?.[F.site.code]),
      // display differs on purpose (like the live app): matching must use IDs
      [D.type]: lookup(d[D.type], `${type?.[F.planningType.name]} - true`),
      [D.country]: lookup(d[D.country], market?.[F.market.name]),
    };
    for (const k of [D.x3, D.x2, D.x1, D.zero, D.open, D.dist, D.x3Total, D.x2Total, D.x1Total, D.zeroTotal, D.total]) {
      if (rec[k] !== undefined) rec[k] = Number(rec[k]).toFixed(2);
    }
    if (D.upload && d[D.upload]) rec[D.upload] = lookup(d[D.upload], d[D.upload]);
    db[REPORTS.demands].push(rec);
    return { id: rec.ID };
  }

  const DATA = {
    async getRecords({ report_name, criteria }) {
      await wait(120);
      const rows = (db[report_name] || []).filter((r) => matches(r, criteria));
      if (!rows.length) return { code: 3100, message: 'No records found' };
      return { code: 3000, data: structuredClone(rows) };
    },
    async addRecords({ form_name, payload }) {
      await wait(200);
      const list = payload.data;
      if (form_name === FORMS.demandUpload) {
        const rec = { ID: newId(), ...list[0] };
        db[REPORTS.demandUploads].push(rec);
        return { code: 3000, result: [{ code: 3000, data: { ID: rec.ID }, message: 'success' }] };
      }
      if (form_name === FORMS.sitePlanStatus) {
        const d = { ...list[0] };
        const site = byId(REPORTS.siteMaster, d[F.planStatus.site]);
        if (!site) return { code: 3002, error: { alert_message: ['Site is mandatory'] } };
        d[F.planStatus.site] = lookup(site.ID, site[F.site.code]);
        const rec = { ID: newId(), ...d, Modified_Time: new Date().toISOString() };
        db[REPORTS.sitePlanStatus].push(rec);
        return { code: 3000, result: [{ code: 3000, data: { ID: rec.ID }, message: 'success' }] };
      }
      // master forms (only these link names exist in the mock, to exercise the fallbacks)
      const master = { Site_Master: REPORTS.siteMaster, Planning_Type: REPORTS.planningTypes, Country: REPORTS.markets }[form_name];
      if (master) {
        const d = { ...list[0] };
        if (master === REPORTS.siteMaster) {
          d[F.site.types] = (d[F.site.types] || []).map((id) => lookup(id, byId(REPORTS.planningTypes, id)?.[F.planningType.name]));
        }
        if (master === REPORTS.markets && d[F.market.active] !== undefined) d[F.market.active] = String(d[F.market.active]);
        const keyField = { [REPORTS.siteMaster]: F.site.code, [REPORTS.planningTypes]: F.planningType.name, [REPORTS.markets]: F.market.name }[master];
        if (!String(d[keyField] ?? '').trim()) return { code: 3002, error: { alert_message: ['Enter a value for the name field'] } };
        const rec = { ID: newId(), ...d };
        db[master].push(rec);
        return { code: 3000, result: [{ code: 3000, data: { ID: rec.ID }, message: 'success' }] };
      }
      if (form_name === FORMS.demand) {
        const result = list.map((d) => {
          const r = saveDemand(d);
          return r.error
            ? { code: 3002, error: { alert_message: [r.error] } }
            : { code: 3000, data: { ID: r.id }, message: 'success' };
        });
        return { code: 3000, result };
      }
      return { code: 2945, message: `Unknown form ${form_name}` };
    },
    async deleteRecordById({ report_name, id }) {
      await wait(60);
      const list = db[report_name] || [];
      const i = list.findIndex((r) => r.ID === String(id));
      if (i < 0) return { code: 3100, message: 'No records found' };
      list.splice(i, 1);
      return { code: 3000, message: 'success' };
    },
    async deleteRecords({ report_name, process_until_limit, payload }) {
      await wait(150);
      const list = db[report_name] || [];
      const hit = list.filter((r) => matches(r, payload?.criteria));
      if (!hit.length) return { code: 3100, message: 'No records found' };
      if (hit.length > 200 && process_until_limit !== 'true') return { code: 3020, message: 'More than 200 records match' };
      const now = hit.slice(0, 200);
      for (const r of now) list.splice(list.indexOf(r), 1);
      const res = { code: 3000, result: now.map((r) => ({ code: 3000, data: { ID: r.ID }, message: 'success' })) };
      if (hit.length > 200) res.more_records = 'mock-more';
      return res;
    },
    async invokeCustomApi({ api_name }) {
      await wait(60);
      if (api_name === 'get_current_user') return { code: 3000, result: { name: 'aviral.srivastava', email: 'aviral@local.test', role: 'Planner', profile: 'Administrator' } };
      return { code: 3100, message: 'No such API' };
    },
    async updateRecordById({ report_name, id, payload }) {
      await wait(80);
      const rec = byId(report_name, id);
      if (!rec) return { code: 3100, message: 'No records found' };
      const d = { ...payload.data };
      if (report_name === REPORTS.siteMaster && d[F.site.types]) {
        d[F.site.types] = d[F.site.types].map((tid) => lookup(tid, byId(REPORTS.planningTypes, tid)?.[F.planningType.name]));
      }
      if (report_name === REPORTS.markets && d[F.market.active] !== undefined) d[F.market.active] = String(d[F.market.active]);
      if (report_name === REPORTS.demands) {
        const decimals = (x) => (String(x).split('.')[1] || '').length;
        for (const [k, v] of Object.entries(d)) if (typeof v === 'number' && decimals(v) > 2) return { code: 3002, error: { alert_message: [`${k} has exceeded its maximum digits.`] } };
      }
      Object.assign(rec, d);
      return { code: 3000, data: { ID: id }, message: 'success' };
    },
  };

  const FILE = {
    async uploadFile({ id, field_name, file }) {
      await wait(100);
      files[`${id}:${field_name}`] = file?.name;
      return { code: 3000, data: { filename: file?.name, message: 'success' } };
    },
  };

  const UTIL = {
    async getInitParams() {
      return { scope: 'mock', appLinkName: 'production-planning', loginUser: 'aviral@local.test', envUrlFragment: '' };
    },
    async getQueryParams() { return {}; },
    getWidgetParams() { return {}; },
  };

  return { __mock: true, __db: db, CREATOR: { DATA, FILE, UTIL } };
}
