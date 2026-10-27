// "Back up the current portal" on the Account move tab: a full copy of the
// HubSpot portal the app uses today, saved to the private backup bucket
// (api/hubspot-backup.js). Read only on the HubSpot side.
//
// The browser drives it: start, then one short chunk request per slice of
// each object type, then finish, which checks the saved files against
// HubSpot's own counts. Closing the tab stops it; a stopped run shows as
// unfinished in the list and a new run starts over.
import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import styles from './HubSpotMoveTab.module.css';

const TYPE_LABELS = {
  contacts: 'Contacts', companies: 'Companies', deals: 'Deals', tickets: 'Tickets',
  products: 'Products', line_items: 'Line items', emails: 'Logged emails', notes: 'Notes',
  calls: 'Calls', meetings: 'Meetings', tasks: 'Tasks', communications: 'Messages (SMS, LinkedIn, WhatsApp)',
};
const label = (t) => TYPE_LABELS[t] || `Custom object ${t}`;

// A chunk that fails is tried this many more times before its type is
// marked as failed and the backup moves on to the next type.
const CHUNK_RETRIES = 2;

async function call(action, body, signal) {
  const res = await apiFetch(`/api/hubspot-backup?action=${action}`, body === undefined
    ? { signal }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

const fmt = (n) => (n == null ? '' : Number(n).toLocaleString());
const fmtBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round((n || 0) / 1e3)} KB`);
const fmtRun = (runId) => {
  const iso = String(runId).replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3Z');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? runId : d.toLocaleString();
};

// The run in progress (or the last one that fell short), kept so a retry
// can carry on from each unfinished type's cursor instead of starting over,
// even after a reload. Per-browser convenience only: the files themselves
// are in the bucket either way.
const RUN_KEY = 'hubspotBackupRun';
function loadSavedRun() {
  try { return JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); } catch { return null; }
}
function saveRun(run) {
  try {
    if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY);
  } catch { /* storage unavailable: retry just won't survive a reload */ }
}

export function HubSpotBackupSection() {
  const [runs, setRuns] = useState(null);
  const [runsError, setRunsError] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(() => loadSavedRun());
  const abortRef = useRef(null);

  const loadRuns = async () => {
    setRunsError('');
    try { setRuns((await call('runs')).runs || []); }
    catch (err) { setRunsError(err.message); }
  };
  useEffect(() => { loadRuns(); }, []);

  // Back up every type in `run` that isn't done yet, from where it stopped,
  // then check the whole run. `run` is mutated as chunks land and saved
  // after each one.
  const drive = async (run, ctrl) => {
    const label2 = (t) => label(t).toLowerCase();
    for (const type of run.objectTypes) {
      const r = run.reported[type] || (run.reported[type] = { records: 0, parts: 0, done: false });
      if (r.done) continue;
      delete run.typeErrors[type];
      const cur = run.cursors[type] || (run.cursors[type] = { after: '', part: 1 });
      for (;;) {
        setProgress({ step: `Saving ${label2(type)}...`, current: type, reported: { ...run.reported } });
        let chunk = null;
        for (let attempt = 0; ; attempt += 1) {
          try {
            chunk = await call('chunk', { portalId: run.portalId, runId: run.runId, type, after: cur.after, part: cur.part }, ctrl.signal);
            break;
          } catch (err) {
            if (err?.name === 'AbortError') throw err;
            // Out of retries: usually a type the token has no scope for.
            // It is reported as failed (finish flags it as unfinished) and
            // the backup carries on with the next type.
            if (attempt >= CHUNK_RETRIES) { run.typeErrors[type] = err.message; break; }
          }
        }
        if (!chunk) break;
        r.records += chunk.records;
        r.parts = cur.part;
        for (const [to, msg] of Object.entries(chunk.associationErrors || {})) run.assocErrors[`${type} -> ${to}`] = msg;
        if (!chunk.next) { r.done = true; }
        else { cur.after = chunk.next; cur.part += 1; }
        saveRun(run);
        if (r.done) break;
      }
    }
    setProgress({ step: 'Checking the saved files against HubSpot...', reported: { ...run.reported } });
    const manifest = await call('finish', {
      portalId: run.portalId, runId: run.runId, objectTypes: run.objectTypes, reported: run.reported, typeErrors: run.typeErrors,
    }, ctrl.signal);
    setProgress(null);
    setResult({ ...manifest, schemaErrors: run.schemaErrors, assocErrors: run.assocErrors });
    const next = manifest.complete ? null : run;
    saveRun(next);
    setPending(next);
  };

  const go = async (resume) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true); setError(''); setResult(null);
    let run = resume ? pending : null;
    try {
      if (!run) {
        setProgress({ step: 'Reading the portal set-up (properties, pipelines, owners, lists)...', reported: {} });
        const start = await call('start', {}, ctrl.signal);
        run = {
          portalId: start.portalId, runId: start.runId, objectTypes: start.objectTypes, schemaErrors: start.schemaErrors || {},
          reported: {}, cursors: {}, typeErrors: {}, assocErrors: {},
        };
        saveRun(run);
        setPending(run);
      }
      await drive(run, ctrl);
    } catch (err) {
      if (run) { saveRun(run); setPending({ ...run }); }
      const tail = run ? 'What was saved is kept; Retry carries on from where it stopped.' : '';
      setError(err?.name === 'AbortError' ? `Stopped. ${tail}` : `${err.message} ${tail}`);
    } finally {
      setRunning(false);
      loadRuns();
    }
  };

  const unfinished = pending ? pending.objectTypes.filter(t => !pending.reported[t]?.done) : [];
  const shown = progress?.reported || null;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Back up the current portal</h3>
        <button className={styles.btn} onClick={() => go(false)} disabled={running}>
          {running ? 'Backing up...' : 'Start full backup'}
        </button>
        {!running && pending && (
          <button className={styles.btnGhost} onClick={() => go(true)}
            title="Carries on with the record types that did not finish, in the same backup, from where each one stopped.">
            {unfinished.length
              ? `Retry ${unfinished.map(t => label(t).toLowerCase()).join(', ')}`
              : 'Re-check this backup'}
          </button>
        )}
        {running && <button className={styles.btnGhost} onClick={() => abortRef.current?.abort()}>Stop</button>}
      </div>
      <p className={styles.muted}>
        Saves every record in the current portal with all of its properties and associations, plus its set-up
        (property definitions, pipelines, owners, lists), to the private backup storage. Nothing in HubSpot is
        changed. Keep this tab open until it finishes; a large portal takes several minutes.
      </p>
      {error && <div className={styles.error}>{error}</div>}
      {progress && <div className={styles.muted}>{progress.step}</div>}

      {shown && Object.keys(shown).length > 0 && (
        <table className={styles.table}>
          <thead><tr><th>Record type</th><th className={styles.num}>Saved</th><th>Status</th></tr></thead>
          <tbody>
            {Object.entries(shown).map(([type, r]) => (
              <tr key={type}>
                <td>{label(type)}</td>
                <td className={styles.num}>{fmt(r.records)}</td>
                <td>{r.done ? 'Done' : progress?.current === type ? 'In progress' : 'Failed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {result && <BackupVerdict manifest={result} />}

      <h4 className={styles.sectionTitle}>Saved backups</h4>
      {runsError && <div className={styles.error}>{runsError}</div>}
      {runs && runs.length === 0 && <div className={styles.muted}>No HubSpot backups yet.</div>}
      {runs && runs.length > 0 && (
        <table className={styles.table}>
          <thead><tr><th>Taken</th><th>Portal</th><th className={styles.num}>Records</th><th className={styles.num}>Size</th><th>Result</th></tr></thead>
          <tbody>
            {runs.map(r => (
              <tr key={`${r.portalId}/${r.runId}`}>
                <td>{fmtRun(r.runId)}</td>
                <td className={styles.mono}>{r.portalId}</td>
                <td className={styles.num}>{r.manifest ? fmt(r.manifest.rows.reduce((s, x) => s + x.records, 0)) : ''}</td>
                <td className={styles.num}>{fmtBytes(r.bytes)}</td>
                <td className={r.manifest?.complete ? styles.okText : styles.errText}>
                  {!r.manifest ? 'Unfinished' : r.manifest.complete ? 'Complete and checked' : 'Finished with gaps'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function BackupVerdict({ manifest }) {
  const schemaErrors = Object.entries(manifest.schemaErrors || {});
  const assocErrors = Object.entries(manifest.assocErrors || {});
  return (
    <>
      <div className={manifest.complete ? styles.ok : styles.error}>
        {manifest.complete
          ? `Backup complete: every record type matches HubSpot's own count. Saved ${fmtBytes(manifest.bytes)} in ${fmt(manifest.files)} files.`
          : 'The backup finished, but some record types fell short of HubSpot\'s count. See below.'}
      </div>
      <table className={styles.table}>
        <thead><tr><th>Record type</th><th className={styles.num}>Saved</th><th className={styles.num}>In HubSpot</th><th>Check</th></tr></thead>
        <tbody>
          {manifest.rows.map(r => (
            <tr key={r.type}>
              <td>{label(r.type)}</td>
              <td className={styles.num}>{fmt(r.records)}</td>
              <td className={styles.num}>{r.expected == null ? <span className={styles.muted}>not countable</span> : fmt(r.expected)}</td>
              <td className={r.ok ? styles.okText : styles.errText}>{r.ok ? 'OK' : r.problems.join('; ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(schemaErrors.length > 0 || assocErrors.length > 0) && (
        <div className={styles.muted}>
          <b>Not readable with this token</b> (usually a missing scope on the HubSpot private app):
          <ul>
            {schemaErrors.map(([k, v]) => <li key={k}><span className={styles.mono}>{k}</span>: {v}</li>)}
            {assocErrors.map(([k, v]) => <li key={k}><span className={styles.mono}>{k} links</span>: {v}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}
