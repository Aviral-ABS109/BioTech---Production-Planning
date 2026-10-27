import React, { useMemo, useRef, useState } from 'react';
import { parseDemandFile } from '../lib/parseDemand.js';
import { validateRows, summarise, fileErrors } from '../lib/validate.js';
import { runUpload } from '../lib/demandService.js';
import { PAGE_SIZE } from '../config.js';

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const STATUS_LABEL = { ok: 'Ready', skip: 'Skip', error: 'Error', added: 'Saved', failed: 'Failed' };

export default function UploadPanel({ cycle, index, existing, hasDemand, onNeedMonth, onUploaded, onGoToRecords }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [parseError, setParseError] = useState('');
  const [parsed, setParsed] = useState(null);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [frozen, setFrozen] = useState(null); // lines as they were when saved
  const [uploadError, setUploadError] = useState('');

  const fErrors = useMemo(() => (parsed ? fileErrors(parsed, index) : []), [parsed, index]);
  const live = useMemo(
    () => (parsed ? validateRows(parsed.lines, index, { cycle, existing, fileErrors: fErrors }) : []),
    [parsed, index, cycle, existing, fErrors]
  );
  const validated = frozen || live;
  // after saving, counts come from the frozen snapshot so they don't change when the data refreshes
  const summary = useMemo(() => summarise(validated), [validated]);

  const filtered = validated.filter((v) => {
    if (filter === 'all') return true;
    if (filter === 'warn') return v.warnings.some((w) => !w.startsWith('Already uploaded'));
    return v.status === filter;
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const busy = Boolean(progress) && !result;

  // month is mandatory before a file can be chosen
  function needMonth() {
    if (cycle) return false;
    onNeedMonth?.();
    setParseError('');
    return true;
  }
  function chooseFile() {
    if (needMonth()) return;
    inputRef.current?.click();
  }

  async function pick(f) {
    if (!f) return;
    if (needMonth()) { if (inputRef.current) inputRef.current.value = ''; return; }
    setFile(f);
    setParsed(null);
    setParseError('');
    setResult(null);
    setFrozen(null);
    setProgress(null);
    setUploadError('');
    setFilter('all');
    setPage(0);
    try {
      const p = await parseDemandFile(f);
      if (!p.lines.length) throw new Error(`No data rows found under the header row (sheet "${p.sheetName}").`);
      setParsed(p);
    } catch (e) {
      setParseError(e.message);
    }
  }

  async function save() {
    setUploadError('');
    const snapshot = live;
    setFrozen(snapshot);
    setProgress({ done: 0, total: summary.ok });
    try {
      const r = await runUpload({
        file,
        cycle,
        validated: snapshot,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const byKey = new Map(r.rowResults.map((x) => [x.key, x]));
      setFrozen(snapshot.map((v) => {
        const res = byKey.get(v.key);
        if (!res) return v;
        return res.ok
          ? { ...v, status: 'added' }
          : { ...v, status: 'failed', errors: [...v.errors, `Not saved: ${res.error}`] };
      }));
      setResult(r);
      onUploaded?.(r);
    } catch (e) {
      setFrozen(null);
      setUploadError(e.message);
      setProgress(null);
    }
  }

  function reset() {
    setFile(null);
    setParsed(null);
    setResult(null);
    setFrozen(null);
    setProgress(null);
    setParseError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const chips = result
    ? [['all', `All ${validated.length}`, ''], ['added', `Saved ${summary.added}`, 'ok'], ['failed', `Failed ${summary.failed}`, 'error'], ['skip', `Skipped ${summary.skip}`, 'skip'], ['error', `Not sent ${summary.error}`, 'error']]
    : [['all', `All ${summary.total}`, ''], ['ok', `Ready ${summary.ok}`, 'ok'], ['skip', `Already uploaded ${summary.skip}`, 'skip'], ['error', `Errors ${summary.error}`, 'error'], ['warn', `Warnings ${summary.warnings}`, 'warn']];

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>{cycle ? `Upload demand for ${cycle}` : 'Upload demand'}</h2>
          <p>Upload the demand plan Excel (sheet "Demand"): one row per FG code per country — Plant, Type, Model, FG Code 1/2, Range, Power, Cyl, Country, 3X, 2X, 1X, ZERO, Open Orders, Dist. Shortages. Every row is checked before anything is saved.</p>
        </div>
      </div>
      <div className="panel-body">
        {!parsed && !cycle && (
          <div className="notice info month-hint">
            <b>Step 1:</b> select the <b>month</b> (and year) this demand is for, at the top right. Then choose the Excel file.
          </div>
        )}
        {!parsed && cycle && hasDemand && (
          <div className="notice info month-hint">
            Demand is already saved for <b>{cycle}</b>. You can review it, or upload another file (rows already saved are skipped).
            <button className="btn small" style={{ marginLeft: 10 }} onClick={onGoToRecords}>View demand records →</button>
          </div>
        )}
        {!parsed && (
          <div
            className={`drop ${over ? 'over' : ''} ${cycle ? '' : 'disabled'}`}
            onDragOver={(e) => { e.preventDefault(); setOver(Boolean(cycle)); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
          >
            <div className="drop-icon" aria-hidden="true">⬆</div>
            <strong>{cycle ? `Drop the ${cycle} demand Excel here` : 'Select a month to upload demand'}</strong>
            <span>{cycle ? 'or' : 'The month is required before a file can be chosen'}</span>
            <div style={{ marginTop: 10 }}>
              <button className="btn blue" onClick={chooseFile}>Choose file</button>
              <input ref={inputRef} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => pick(e.target.files[0])} />
            </div>
            {file && <div className="file">{file.name}</div>}
          </div>
        )}
        {parseError && <div className="notice error"><b>Could not read the file.</b> {parseError}</div>}

        {parsed && (
          <>
            <div className="toolbar">
              <div className="chips">
                {chips.map(([k, label, cls]) => (
                  <button key={k} className={`chip ${cls} ${filter === k ? 'selected' : ''}`} onClick={() => { setFilter(k); setPage(0); }}>{label}</button>
                ))}
              </div>
              <div className="row-actions">
                <span className="file-meta">{file?.name} · sheet "{parsed.sheetName}" · header row {parsed.headerRow}</span>
                <button className="btn" onClick={reset} disabled={busy}>Choose another file</button>
                {!result && (
                  <button className="btn primary" onClick={save} disabled={busy || summary.ok === 0}>
                    {busy ? 'Saving…' : `Save ${summary.ok} row${summary.ok === 1 ? '' : 's'} →`}
                  </button>
                )}
                {(result || summary.ok === 0) && hasDemand && (
                  <button className="btn blue" onClick={onGoToRecords}>Go to demand records →</button>
                )}
              </div>
            </div>

            <div className="countries-line">
              {parsed.format === 'wide' ? 'Old layout (countries side by side) — split into one row per country. ' : ''}
              Countries: {parsed.countries.map((c) => c.name || '?').join(' · ')}
              {' · '}{new Set(validated.map((v) => `${v.display.plant}|${v.display.fg1}`)).size} FG codes
              {parsed.hasDist ? '' : ' · no Dist. Shortages column'}
            </div>

            {fErrors.length > 0 && (
              <div className="notice error">
                <b>The file layout needs fixing before anything can be saved.</b>
                <ul>{fErrors.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            {parsed.ignoredColumns.length > 0 && (
              <div className="notice info">Not imported (totals are recalculated): {parsed.ignoredColumns.join(', ')}</div>
            )}
            {!fErrors.length && summary.error > 0 && !result && (
              <div className="notice error">
                {summary.error} row{summary.error === 1 ? '' : 's'} have errors and will not be saved. Fix them in Excel and upload again, or save the ready rows now.
              </div>
            )}

            {progress && !result && (
              <div style={{ margin: '12px 0' }}>
                <div className="progress"><div style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} /></div>
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Saved {progress.done} of {progress.total}</div>
              </div>
            )}
            {uploadError && <div className="notice error"><b>Upload stopped.</b> {uploadError}</div>}
            {result && <ResultNotice result={result} />}

            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Row</th><th>Status</th><th>Plant</th><th>Type</th><th className="col-model">Model</th><th>FG Code 1</th>
                    <th className="num">Power</th><th>Cyl</th><th>Country</th>
                    <th className="num">3X</th><th className="num">2X</th><th className="num">1X</th><th className="num">ZERO</th>
                    <th className="num">Open Orders</th><th className="num">Dist.</th><th className="num">FG Total</th><th className="col-msg">Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((v) => (
                    <tr key={v.key}>
                      <td className="nowrap">{v.excelRow}</td>
                      <td><span className={`pill ${v.status}`}>{STATUS_LABEL[v.status]}</span></td>
                      <td>{v.display.plant}</td>
                      <td>{v.display.type}</td>
                      <td className="col-model">{v.display.model}</td>
                      <td className="nowrap">{v.display.fg1}</td>
                      <td className="num">{v.display.power ?? '—'}</td>
                      <td>{v.display.cyl}</td>
                      <td>{v.display.country}</td>
                      <td className="num">{fmt(v.display.x3)}</td>
                      <td className="num">{fmt(v.display.x2)}</td>
                      <td className="num">{fmt(v.display.x1)}</td>
                      <td className="num">{fmt(v.display.zero)}</td>
                      <td className="num">{fmt(v.display.open)}</td>
                      <td className="num">{fmt(v.display.dist)}</td>
                      <td className="num"><b>{fmt(v.display.fgTotal)}</b></td>
                      <td className="col-msg">
                        {v.errors.map((m, i) => <div key={i} className="msg err">{m}</div>)}
                        {v.warnings.map((m, i) => <div key={`w${i}`} className="msg warn">{m}</div>)}
                      </td>
                    </tr>
                  ))}
                  {!shown.length && <tr><td colSpan={17} className="empty">No rows in this filter.</td></tr>}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="pager">
                <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
                Page {page + 1} of {pages} · {filtered.length} rows
                <button className="btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ResultNotice({ result }) {
  const { success, failed, skipped, blocked } = result;
  const ok = failed.length === 0;
  return (
    <div className={`notice ${ok ? 'ok' : 'error'}`}>
      <b>{ok ? '✓ Upload complete.' : 'Upload finished with errors.'}</b>{' '}
      {success} saved · {skipped} skipped (already uploaded) · {blocked} not sent (errors) · {failed.length} failed while saving
      {failed.length > 0 && (
        <ul>
          {failed.slice(0, 20).map((f) => <li key={f.key}>Row {f.excelRow} ({f.country}): {f.error}</li>)}
          {failed.length > 20 && <li>…and {failed.length - 20} more (see the error log of this upload in Demand Upload)</li>}
        </ul>
      )}
    </div>
  );
}
