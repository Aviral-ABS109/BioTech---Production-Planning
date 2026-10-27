import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isMock } from './api/creator.js';
import { loadMasters, loadDemandsForCycle, loadDemandYears, buildStatus } from './lib/demandService.js';
import { existingKeys, recordCountry } from './lib/validate.js';
import { MONTHS, cycleText, yearOptions } from './lib/cycle.js';
import UploadPanel from './components/UploadPanel.jsx';
import StatusPanel from './components/StatusPanel.jsx';
import RecordsPanel from './components/RecordsPanel.jsx';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const STAGES = [
  { id: 'upload', label: 'Upload demand', hint: 'Choose the month and upload the Excel' },
  { id: 'records', label: 'Demand records', hint: 'Review what was saved' },
  { id: 'status', label: 'Demand status', hint: 'Check sites and start planning' },
];

export default function App() {
  const [masters, setMasters] = useState(null);
  const [loadError, setLoadError] = useState('');
  // month starts empty (user must pick it), year starts at the current year
  const [period, setPeriod] = useState(() => ({ month: 0, year: new Date().getFullYear() }));
  const [dataYears, setDataYears] = useState([]);
  const [demands, setDemands] = useState([]);
  const [loadingDemands, setLoadingDemands] = useState(false);
  const [stage, setStage] = useState('upload');
  const [monthError, setMonthError] = useState(false);
  const [savedNotice, setSavedNotice] = useState(null);
  const [uploadKey, setUploadKey] = useState(0);
  const cycle = period.month ? cycleText(period.month, period.year) : '';

  useEffect(() => {
    loadMasters().then(setMasters).catch((e) => setLoadError(e.message));
    loadDemandYears().then(setDataYears).catch((e) => console.warn('[widget] years not loaded', e));
  }, []);

  const refreshDemands = useCallback(async () => {
    if (!cycle) { setDemands([]); return []; }
    setLoadingDemands(true);
    try {
      const list = await loadDemandsForCycle(cycle);
      setDemands(list);
      return list;
    } catch (e) {
      setLoadError(e.message);
      return [];
    } finally {
      setLoadingDemands(false);
    }
  }, [cycle]);

  useEffect(() => { if (masters) refreshDemands(); }, [masters, refreshDemands]);

  const status = useMemo(() => (masters ? buildStatus(demands, masters.index) : []), [masters, demands]);
  const existing = useMemo(() => existingKeys(demands, masters?.index), [demands, masters]);
  const years = useMemo(() => yearOptions(new Date(), dataYears), [dataYears]);

  const hasDemand = demands.length > 0;
  // blueprint: records / status open only once the chosen month has demand saved
  const canOpen = (id) => id === 'upload' || (Boolean(cycle) && hasDemand && !loadingDemands);
  const lockReason = !cycle ? 'Select a month first' : loadingDemands ? 'Loading…' : 'Upload demand for this month first';
  useEffect(() => { if (stage !== 'upload' && !canOpen(stage)) setStage('upload'); });

  function changePeriod(p) {
    const next = { ...period, ...p };
    setPeriod(next);
    setDemands([]);
    setSavedNotice(null);
    if (next.month) setMonthError(false);
  }

  async function handleUploaded(result) {
    const list = await refreshDemands();
    if (result.success > 0 && !dataYears.includes(period.year)) setDataYears((y) => [...y, period.year]);
    if (result.failed.length === 0 && list.length > 0) {
      setSavedNotice({ cycle, saved: result.success, skipped: result.skipped, blocked: result.blocked });
      setUploadKey((k) => k + 1); // fresh upload screen next time
      setStage('records');
    }
  }

  if (loadError) {
    return (
      <div className="shell">
        <div className="notice error">
          <b>Could not load data.</b> {loadError}
          <div className="muted" style={{ marginTop: 6 }}>Check that the report names in the widget settings exist and that your profile can read them.</div>
        </div>
      </div>
    );
  }
  if (!masters) return <div className="shell"><div className="empty">Loading master data…</div></div>;

  const plannable = status.filter((r) => r.inMaster);
  const ready = plannable.filter((r) => r.ready).length;
  const totalQty = status.reduce((a, r) => a + r.total, 0);
  // countries that actually have demand saved for this month
  const countriesWithDemand = [...new Set(demands.map((d) => recordCountry(d, masters.index)).filter(Boolean))].sort();
  const stageIndex = STAGES.findIndex((s) => s.id === stage);

  return (
    <div className="shell">
      <div className="header">
        <div>
          <h1>Demand Collection</h1>
          <p>Upload the monthly demand plan, review it and hand it over for planning</p>
        </div>
        <div className="row-actions period">
          {isMock() && <span className="tag mock">LOCAL TEST DATA</span>}
          <div className={`field ${monthError ? 'invalid' : ''}`}>
            <label htmlFor="month">Month <span className="req">*</span></label>
            <select id="month" value={period.month} onChange={(e) => changePeriod({ month: Number(e.target.value) })}>
              <option value={0}>Select month</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            {monthError && <div className="field-error">Please select a month</div>}
          </div>
          <div className="field">
            <label htmlFor="year">Year</label>
            <select id="year" value={period.year} onChange={(e) => changePeriod({ year: Number(e.target.value) })} style={{ minWidth: 110 }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      <ol className="stepper">
        {STAGES.map((s, i) => {
          const open = canOpen(s.id);
          const state = s.id === stage ? 'current' : i < stageIndex || (s.id === 'upload' && hasDemand) ? 'done' : '';
          return (
            <li key={s.id} className={`step ${state} ${open ? '' : 'locked'}`}>
              <button onClick={() => open && setStage(s.id)} disabled={!open} title={open ? s.hint : lockReason}>
                <span className="step-num">{state === 'done' ? '✓' : i + 1}</span>
                <span className="step-text">
                  <span className="step-label">{s.label}{s.id === 'records' && hasDemand ? ` (${demands.length})` : ''}</span>
                  <span className="step-hint">{open ? s.hint : lockReason}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {stage !== 'upload' && (
        <div className="grid3">
          <div className="kpi"><div className="label">Countries</div><div className="value">{countriesWithDemand.length}</div><div className="sub">{countriesWithDemand.join(' • ')}</div></div>
          <div className="kpi"><div className="label">Total demand</div><div className="value">{loadingDemands ? '…' : fmt(totalQty)}</div><div className="sub">3X + 2X + 1X + ZERO + Dist. shortages · {cycle}</div></div>
          <div className="kpi"><div className="label">Ready for planning</div><div className={`value ${plannable.length && ready === plannable.length ? 'green' : 'amber'}`}>{ready} / {plannable.length}</div><div className="sub">Plant + Type with demand</div></div>
        </div>
      )}

      {/* kept mounted so a chosen file / preview survives switching stages */}
      <div hidden={stage !== 'upload'}>
        <UploadPanel
          key={`${cycle}|${uploadKey}`}
          cycle={cycle}
          index={masters.index}
          existing={existing}
          hasDemand={hasDemand}
          onNeedMonth={() => setMonthError(true)}
          onUploaded={handleUploaded}
          onGoToRecords={() => setStage('records')}
        />
      </div>
      {stage === 'records' && (
        <>
          {savedNotice && savedNotice.cycle === cycle && (
            <div className="notice ok saved-banner">
              <b>✓ Demand saved for {cycle}.</b> {savedNotice.saved} record{savedNotice.saved === 1 ? '' : 's'} added
              {savedNotice.skipped ? ` · ${savedNotice.skipped} already uploaded (skipped)` : ''}
              {savedNotice.blocked ? ` · ${savedNotice.blocked} with errors (not saved)` : ''}. Review them below, then continue to Demand status.
              <button className="link-btn" onClick={() => setSavedNotice(null)} aria-label="Dismiss">✕</button>
            </div>
          )}
          <RecordsPanel demands={demands} index={masters.index} cycle={cycle} loading={loadingDemands} onRefresh={refreshDemands} />
          <div className="stage-nav">
            <button className="btn" onClick={() => setStage('upload')}>← Back to upload</button>
            <button className="btn blue" onClick={() => setStage('status')}>Continue to demand status →</button>
          </div>
        </>
      )}
      {stage === 'status' && (
        <>
          <StatusPanel demands={demands} index={masters.index} loading={loadingDemands} onRefresh={refreshDemands} cycleName={cycle} />
          <div className="stage-nav">
            <button className="btn" onClick={() => setStage('records')}>← Back to demand records</button>
          </div>
        </>
      )}
    </div>
  );
}
