import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isMock, getCurrentUser } from './api/creator.js';
import { loadMasters, loadDemandsForCycle, buildStatus } from './lib/demandService.js';
import { loadReportData, flatten, monthFromCycle } from './lib/reportService.js';
import { existingKeys } from './lib/validate.js';
import { MONTHS, cycleText, yearOptions, yearFromCycle } from './lib/cycle.js';
import { Sidebar, Topbar } from './app/Shell.jsx';
import { Toast } from './app/ui.jsx';
import Dashboard from './app/Dashboard.jsx';
import Upload from './app/Upload.jsx';
import Records from './app/Records.jsx';
import Planning from './app/Planning.jsx';
import Reports from './app/Reports.jsx';
import Masters from './app/Masters.jsx';
import DemandRecords from './app/DemandRecords.jsx';
import PlanTracker from './app/PlanTracker.jsx';
import Loader from './app/Loader.jsx';
import { loadPlanStatus, indexStatus, buildTracker, setSiteStage } from './lib/planStatus.js';
import { PLAN_STAGES } from './config.js';
import { recordPlant } from './lib/validate.js';
import { normCycle } from './lib/cycle.js';

const SIDEBAR_KEY = 'pp.sidebarCollapsed';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
/** Default cycle = the next month to plan (plans are made in the month before). */
function nextCycle(now = new Date()) {
  const m = now.getMonth() + 2; // getMonth is 0-based → +1 for this month, +1 for next
  return m > 12 ? { month: 1, year: now.getFullYear() + 1 } : { month: m, year: now.getFullYear() };
}
const CRUMBS = {
  dashboard: ['Dashboard'],
  upload: ['Demand', 'Upload'],
  records: ['Demand', 'Records'],
  planning: ['Demand', 'Start planning'],
  reports: ['Reports'],
  masters: ['Master data'],
};
const TAB_LABEL = { site: 'Sites', planningType: 'Planning types', country: 'Countries', analysis: 'Demand analysis', records: 'Demand records', uploads: 'Upload history' };
const TABS_OF = { masters: ['site', 'planningType', 'country'], reports: ['analysis', 'records', 'uploads'] };

export default function App() {
  const [masters, setMasters] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [user, setUser] = useState(null);
  const [route, setRoute] = useState({ page: 'dashboard', tab: 'site' });
  const [collapsed, setCollapsed] = useState(() => store.get(SIDEBAR_KEY) === '1');
  const [cycle, setCycle] = useState(nextCycle);
  const [demands, setDemands] = useState([]);
  const [loadingDemands, setLoadingDemands] = useState(false);
  const [demandsFor, setDemandsFor] = useState(''); // cycle the loaded demands belong to
  const [all, setAll] = useState(null); // every cycle (light fields) + upload log
  const [toast, setToast] = useState('');
  const [planStatus, setPlanStatus] = useState([]); // Site Plan Status records, every cycle
  const [busySite, setBusySite] = useState('');
  const cycleName = cycleText(cycle.month, cycle.year);
  const cycleLabel = `${MONTHS[cycle.month - 1].slice(0, 3).toUpperCase()} ${cycle.year}`;

  useEffect(() => {
    loadMasters().then(setMasters).catch((e) => setLoadError(e.message));
    getCurrentUser().then(setUser).catch(() => setUser({ name: 'Signed-in user', role: '', email: '' }));
    loadPlanStatus().then(setPlanStatus);
  }, []);

  const [allLoading, setAllLoading] = useState(false);
  const refreshAll = useCallback(async () => {
    setAllLoading(true);
    try { setAll(await loadReportData()); } catch (e) { console.warn('[widget] report data not loaded', e); setAll({ demands: [], uploads: [] }); } finally { setAllLoading(false); }
  }, []);
  // demand per cycle, kept for this session: switching back to a cycle already opened is instant.
  // Any save / edit / delete calls refreshDemands() without useCache, which clears it.
  const cycleCache = useRef(new Map());
  const refreshDemands = useCallback(async ({ useCache = false } = {}) => {
    if (useCache && cycleCache.current.has(cycleName)) {
      const list = cycleCache.current.get(cycleName);
      setDemands(list);
      setDemandsFor(cycleName);
      return list;
    }
    if (!useCache) cycleCache.current.clear();
    setLoadingDemands(true);
    try {
      const list = await loadDemandsForCycle(cycleName);
      cycleCache.current.set(cycleName, list);
      setDemands(list);
      setDemandsFor(cycleName);
      return list;
    } catch (e) {
      setLoadError(e.message);
      return [];
    } finally {
      setLoadingDemands(false);
    }
  }, [cycleName]);
  useEffect(() => { refreshAll(); }, [refreshAll]);
  useEffect(() => { if (masters) refreshDemands({ useCache: true }); }, [masters, refreshDemands]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // a cycle without demand has nothing to review or plan → back to Upload
  useEffect(() => {
    if (demandsFor === cycleName && !loadingDemands && demands.length === 0 && (route.page === 'records' || route.page === 'planning')) {
      setRoute((r) => ({ ...r, page: 'upload' }));
    }
  }, [demandsFor, cycleName, loadingDemands, demands, route.page]);

  const rows = useMemo(() => (all && masters ? flatten(all.demands, masters.index) : []), [all, masters]);
  const status = useMemo(() => (masters ? buildStatus(demands, masters.index) : []), [masters, demands]);
  const existing = useMemo(() => existingKeys(demands, masters?.index), [demands, masters]);
  const statusIdx = useMemo(() => indexStatus(planStatus, masters?.index), [planStatus, masters]);
  const tracker = useMemo(() => (masters ? buildTracker(demands.map((d) => recordPlant(d, masters.index)), statusIdx.get(normCycle(cycleName)), masters.index) : null), [demands, statusIdx, cycleName, masters]);
  const emptySites = useMemo(() => {
    if (!masters || !tracker) return [];
    const have = new Set(tracker.sites.map((s) => s.code));
    return [...masters.index.siteByCode.values()].map((s) => s.code).filter((c) => !have.has(c));
  }, [masters, tracker]);

  async function startPlanning(site) {
    setBusySite(site.code);
    try {
      await setSiteStage({ cycle: cycleName, site: { id: site.id }, stage: PLAN_STAGES[1], existingId: site.recordId });
      setPlanStatus(await loadPlanStatus());
      setToast(`✓ Site ${site.code} moved to ${PLAN_STAGES[1]} for ${cycleLabel}`);
    } catch (e) {
      setToast(`Could not start planning for site ${site.code}: ${e.message}`);
    } finally {
      setBusySite('');
    }
  }

  const cyclesWithData = useMemo(() => new Set(rows.map((r) => `${yearFromCycle(r.cycle)}-${monthFromCycle(r.cycle)}`)), [rows]);
  const cycleYears = useMemo(() => yearOptions(new Date(), [...new Set(rows.map((r) => yearFromCycle(r.cycle)).filter(Boolean)), cycle.year]), [rows, cycle.year]);

  // each section remembers its own tab; a tab from another section falls back to the first one
  const go = (page, tab) => setRoute((r) => {
    const tabs = TABS_OF[page];
    if (!tabs) return { ...r, page };
    const t = tab || r[`tab_${page}`] || tabs[0];
    return { ...r, page, tab: t, [`tab_${page}`]: t };
  });
  const toggle = () => { const v = !collapsed; setCollapsed(v); store.set(SIDEBAR_KEY, v ? '1' : '0'); };
  const changeCycle = (c) => setCycle(c);

  async function onSaved(result) {
    if (result.addedCountries?.length) {
      try { setMasters(await loadMasters()); } catch (e) { console.warn('[widget] masters not reloaded', e); }
    }
    await Promise.all([refreshDemands(), refreshAll()]);
    if (result.failed.length === 0 && result.success > 0) {
      const extra = result.addedCountries?.length ? ` · ${result.addedCountries.join(', ')} added to Countries` : '';
      setToast(`✓ ${result.success} rows saved to ${cycleLabel}${extra}`);
      go('records');
    }
  }

  if (loadError) {
    return (
      <div className="page"><div className="notice error"><b>Could not load data.</b> {loadError}
        <div style={{ marginTop: 6 }}>Check that the report names in the widget settings exist and that your profile can read them.</div></div></div>
    );
  }

  const crumbs = TABS_OF[route.page] ? [...CRUMBS[route.page], TAB_LABEL[route.tab]] : CRUMBS[route.page];
  const showCycle = ['dashboard', 'upload', 'records', 'planning'].includes(route.page);
  const hasDemand = demands.length > 0;
  const plannable = status.filter((r) => r.inMaster);
  const readyText = `${plannable.filter((r) => r.ready).length} of ${plannable.length} ready`;
  const common = { cycle, cycleName, cycleLabel, go, hasDemand, records: demands.length, readyText, user };
  const trackerProps = { tracker, cycleLabel, onStart: startPlanning, busySite, hiddenSites: emptySites, go };

  if (!masters) {
    return <div className="boot"><Loader kind="bars" label="Loading Production Planning…" /></div>;
  }
  // the selected cycle is still loading: cover the page (old cycle's numbers stay hidden, no "nothing uploaded" flash)
  const cycleLoading = showCycle && (loadingDemands || demandsFor !== cycleName);

  let page = null;
  {
    switch (route.page) {
      case 'upload':
        page = <Upload {...common} index={masters.index} existing={existing} loading={loadingDemands} onSaved={onSaved} />;
        break;
      case 'records':
        page = <Records {...common} demands={demands} index={masters.index} loading={loadingDemands} onRefresh={refreshDemands} />;
        break;
      case 'planning':
        page = <Planning {...common} demands={demands} index={masters.index} status={status} loading={loadingDemands} onRefresh={() => { refreshDemands(); loadPlanStatus().then(setPlanStatus); }} trackerProps={trackerProps} />;
        break;
      case 'reports':
        page = route.tab === 'records'
          ? <DemandRecords index={masters.index} onDataChanged={() => { refreshAll(); refreshDemands(); }} />
          : <Reports view={route.tab} rows={rows} uploads={all?.uploads || []} loading={!all || allLoading} onRefresh={refreshAll} onDataChanged={() => Promise.all([refreshAll(), refreshDemands()])} />;
        break;
      case 'masters':
        page = <Masters index={masters.index} tab={route.tab} setTab={(t) => go('masters', t)} onChanged={async () => setMasters(await loadMasters())} />;
        break;
      default:
        page = <Dashboard {...common} rows={rows} uploads={all?.uploads || []} index={masters.index} loading={!all} setCycle={changeCycle} statusIdx={statusIdx} />;
    }
  }

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <Sidebar route={route} go={go} user={user} collapsed={collapsed} hasDemand={hasDemand || loadingDemands || demandsFor !== cycleName} />
      <div className="main">
        <Topbar crumbs={crumbs} collapsed={collapsed} onToggle={toggle} mock={isMock()}
          cycle={showCycle ? cycle : null} onCycle={changeCycle} cycleYears={cycleYears} cyclesWithData={cyclesWithData} />
        <div className="page-wrap">
          {showCycle && hasDemand && !cycleLoading && <PlanTracker {...trackerProps} go={route.page === 'planning' ? null : go} mode="strip" />}
          {page}
          {cycleLoading && (
            <div className="page-overlay">
              <Loader kind="bars" label={`Loading ${cycleLabel} demand…`} />
            </div>
          )}
        </div>
      </div>
      <Toast text={toast} />
    </div>
  );
}
