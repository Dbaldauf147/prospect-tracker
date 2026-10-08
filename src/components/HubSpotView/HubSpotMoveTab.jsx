// "Account move" tab: read-only comparison of the HubSpot portal the app
// uses today with the one it is moving to (api/hubspot-move.js). Nothing
// here writes to either portal; it answers "what would be missing or
// different if the app were switched over now?"
import { useState, useMemo, useRef } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { toCsv, downloadCsv } from '../../utils/csv';
import { MOVE_BUCKETS, moveBucket, summarizeMoveRows, describeDiffs } from '../../utils/hubspotMoveSummary';
import styles from './HubSpotMoveTab.module.css';

const DEFAULT_OWNER = 'daniel.baldauf@se.com';
const TYPE_LABELS = {
  contacts: 'Contacts', companies: 'Companies', deals: 'Deals', emails: 'Logged emails',
  calls: 'Calls', meetings: 'Meetings', notes: 'Notes', tasks: 'Tasks',
};
const PROP_STATUS = {
  ok: 'Matches',
  missing: 'Missing in new portal',
  'type-differs': 'Different type',
  'options-missing': 'Options missing',
};

async function getJson(url, signal) {
  const res = await apiFetch(url, { signal });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

const fmt = (n) => (n == null ? '' : Number(n).toLocaleString());
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : '');

function AccountCard({ title, side }) {
  if (!side) return null;
  const a = side.account;
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{title}</div>
      {side.configured === false && <div className={styles.muted}>Not connected yet. Set HUBSPOT_TARGET_ACCESS_TOKEN in Vercel.</div>}
      {side.error && <div className={styles.error}>{side.error}</div>}
      {a && (
        <dl className={styles.facts}>
          <dt>Portal ID</dt><dd>{a.portalId}</dd>
          <dt>Domain</dt><dd>{a.uiDomain}</dd>
          <dt>Type</dt><dd>{a.accountType}</dd>
          <dt>Time zone</dt><dd>{a.timeZone}</dd>
        </dl>
      )}
      {side.samePortal && <div className={styles.error}>Both tokens point at the same portal, so every comparison would look perfect. Check HUBSPOT_TARGET_ACCESS_TOKEN.</div>}
      {side.owner && (
        <div className={side.owner.id ? styles.ok : styles.error}>
          {side.owner.id
            ? `Owner found: ${side.owner.name || side.owner.email} (owner ID ${side.owner.id})`
            : side.owner.error || `No HubSpot user with the email ${side.owner.email} in this portal.`}
        </div>
      )}
    </div>
  );
}

// The shared-portal guard's settings, as the server sees them. The pin is
// what stops a token swap from quietly pointing the app at another portal.
function GuardStatus({ guard, sourcePortalId }) {
  if (!guard) return null;
  const pinMatches = guard.portalId && guard.portalId === sourcePortalId;
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Safety settings</h3>
      <table className={styles.table}>
        <tbody>
          <tr>
            <td className={styles.mono}>HUBSPOT_PORTAL_ID</td>
            <td>{guard.portalId || <i>not set</i>}</td>
            <td className={pinMatches ? styles.okText : styles.errText}>
              {!guard.portalId && sourcePortalId && `Set it to ${sourcePortalId} (the current portal) so a swapped token is refused instead of used.`}
              {guard.portalId && (pinMatches ? 'Matches the portal in use.' : 'Does not match the portal in use: HubSpot calls are being refused.')}
            </td>
          </tr>
          <tr>
            <td className={styles.mono}>HUBSPOT_OWNER_EMAIL</td>
            <td>{guard.ownerEmail || <i>not set</i>}</td>
            <td className={styles.muted}>
              {guard.ownerEmail
                ? 'The app only shows and edits records this HubSpot user owns, and delete and merge are off.'
                : 'Not needed for a personal portal. Set it with the new token on switch-over day.'}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function CompareSection({ kind, ownerEmail, recentDays }) {
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [filter, setFilter] = useState('problems');
  const abortRef = useRef(null);
  const noun = kind === 'contacts' ? 'contacts' : 'companies';

  const run = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRows([]); setError(''); setDone(false); setRunning(true);
    let after = '';
    const all = [];
    try {
      for (;;) {
        const params = new URLSearchParams({ action: `compare-${kind}`, ownerEmail, recentDays: String(recentDays) });
        if (after) params.set('after', after);
        const json = await getJson(`/api/hubspot-move?${params}`, ctrl.signal);
        all.push(...(json.rows || []));
        setRows([...all]);
        if (!json.next) break;
        after = json.next;
      }
      setDone(true);
    } catch (err) {
      if (err?.name !== 'AbortError') setError(`${err.message} The ${all.length} checked so far are shown; run it again to start over.`);
    } finally {
      setRunning(false);
    }
  };

  const summary = useMemo(() => summarizeMoveRows(rows), [rows]);
  const shown = useMemo(() => rows.filter(r => {
    if (filter === 'all') return true;
    if (filter === 'diffs') return r.diffs?.length > 0;
    if (filter === 'problems') return moveBucket(r) !== 'mine' || r.diffs?.length > 0;
    return moveBucket(r) === filter;
  }), [rows, filter]);

  const exportCsv = () => {
    const headers = kind === 'contacts'
      ? ['Name', 'Email', 'Created', 'Result', 'Current ID', 'New ID', 'Company (current)', 'Differences']
      : ['Name', 'Domain', 'Created', 'Result', 'Matched by', 'Candidates', 'Current ID', 'New ID', 'Differences'];
    const label = (r) => MOVE_BUCKETS.find(b => b.key === moveBucket(r))?.label || '';
    const body = shown.map(r => (kind === 'contacts'
      ? [r.name, r.email, fmtDate(r.createdate), label(r), r.id, r.targetId, r.sourceCompany, describeDiffs(r.diffs)]
      : [r.name, r.domain, fmtDate(r.createdate), label(r), r.matchedBy, r.candidates, r.id, r.targetId, describeDiffs(r.diffs)]));
    downloadCsv(`hubspot-move-${kind}.csv`, toCsv(headers, body));
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{kind === 'contacts' ? 'Contacts' : 'Companies'}</h3>
        <button className={styles.btn} onClick={run} disabled={running}>
          {running ? `Checking ${noun}... ${rows.length}` : `Compare ${noun}`}
        </button>
        {running && <button className={styles.btnGhost} onClick={() => abortRef.current?.abort()}>Stop</button>}
        {rows.length > 0 && <button className={styles.btnGhost} onClick={exportCsv}>Download CSV ({shown.length})</button>}
      </div>
      <p className={styles.muted}>
        {kind === 'contacts'
          ? 'Matched by email. Every custom property that exists in both portals is compared, plus the standard fields and the linked company.'
          : 'Matched by domain, then by exact name. A big company can have several records in a shared portal; the one you own is preferred.'}
      </p>
      {error && <div className={styles.error}>{error}</div>}
      {rows.length > 0 && (
        <>
          <div className={styles.chips}>
            <button className={filter === 'problems' ? styles.chipActive : styles.chip} onClick={() => setFilter('problems')}>
              Needs a look <b>{rows.filter(r => moveBucket(r) !== 'mine' || r.diffs?.length).length}</b>
            </button>
            {MOVE_BUCKETS.filter(b => kind === 'contacts' || b.key !== 'no-email').map(b => (
              <button key={b.key} title={b.help}
                className={`${filter === b.key ? styles.chipActive : styles.chip} ${styles['tone_' + b.tone]}`}
                onClick={() => setFilter(b.key)}>
                {b.label} <b>{summary.counts[b.key]}</b>
              </button>
            ))}
            <button className={filter === 'diffs' ? styles.chipActive : styles.chip} onClick={() => setFilter('diffs')}
              title="Matched, but at least one value in the current portal is blank or different in the new one.">
              Values differ <b>{summary.withDiffs}</b>
            </button>
            <button className={filter === 'all' ? styles.chipActive : styles.chip} onClick={() => setFilter('all')}>
              All <b>{summary.total}</b>
            </button>
          </div>
          {done && <div className={styles.ok}>Checked all {summary.total} {noun} in the current portal.</div>}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>{kind === 'contacts' ? 'Email' : 'Domain'}</th>
                  <th>Created</th>
                  <th>Result</th>
                  <th>Differences</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map(r => (
                  <tr key={r.id}>
                    <td>{r.name || '(no name)'}</td>
                    <td>{kind === 'contacts' ? r.email : r.domain}</td>
                    <td>{fmtDate(r.createdate)}</td>
                    <td>
                      {MOVE_BUCKETS.find(b => b.key === moveBucket(r))?.label}
                      {kind === 'companies' && r.candidates > 1 && <span className={styles.muted}> ({r.candidates} records)</span>}
                    </td>
                    <td className={styles.diffs}>
                      {(r.diffs || []).map(d => (
                        <div key={d.field}><b>{d.field}</b>: {d.source} <span className={styles.muted}>{'->'}</span> {d.target || <i>blank</i>}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 500 && <div className={styles.muted}>Showing the first 500 of {shown.length}. The CSV has all of them.</div>}
          </div>
        </>
      )}
    </section>
  );
}

export function HubSpotMoveTab() {
  const [ownerEmail, setOwnerEmail] = useState(DEFAULT_OWNER);
  const [recentDays, setRecentDays] = useState(5);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadOverview = async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ action: 'overview', ownerEmail, recentDays: String(recentDays) });
      setOverview(await getJson(`/api/hubspot-move?${params}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const countsByType = (side) => Object.fromEntries((side?.counts || []).map(r => [r.type, r]));
  const src = countsByType(overview?.source);
  const tgt = countsByType(overview?.target);

  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        Compares the HubSpot portal the app uses now with the one it is moving to. <b>Read only:</b> nothing is
        written to either portal.
      </div>
      <div className={styles.controls}>
        <label>Your email in the new portal
          <input className={styles.input} value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} />
        </label>
        <label>Recent window (days)
          <input className={styles.inputSm} type="number" min="0" max="60" value={recentDays}
            onChange={e => setRecentDays(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <button className={styles.btn} onClick={loadOverview} disabled={loading}>
          {loading ? 'Reading both portals...' : 'Run overview'}
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}

      {overview && (
        <>
          <div className={styles.cards}>
            <AccountCard title="Current portal (in use)" side={overview.source} />
            <AccountCard title="New portal" side={overview.target} />
          </div>

          <GuardStatus guard={overview.guard} sourcePortalId={overview.source?.account?.portalId} />

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>What each portal holds</h3>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Record type</th>
                  <th className={styles.num}>Current portal</th>
                  <th className={styles.num}>Created in last {recentDays} days</th>
                  <th className={styles.num}>New portal, all users</th>
                  <th className={styles.num}>New portal, yours</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(TYPE_LABELS).map(type => (
                  <tr key={type}>
                    <td>{TYPE_LABELS[type]}</td>
                    <td className={styles.num}>{src[type]?.error ? <span className={styles.errText} title={src[type].error}>no access</span> : fmt(src[type]?.total)}</td>
                    <td className={styles.num}>{fmt(src[type]?.recent)}</td>
                    <td className={styles.num}>{tgt[type]?.error ? <span className={styles.errText} title={tgt[type].error}>no access</span> : fmt(tgt[type]?.total)}</td>
                    <td className={styles.num}>{fmt(tgt[type]?.owned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.muted}>
              &quot;No access&quot; means the token is missing the read scope for that record type. Hover it for HubSpot&apos;s message.
            </p>
          </section>

          {overview.properties && ['contacts', 'companies'].map(type => {
            const rows = overview.properties[type];
            return (
              <section key={type} className={styles.section}>
                <h3 className={styles.sectionTitle}>Custom {type === 'contacts' ? 'contact' : 'company'} properties</h3>
                {rows?.error && <div className={styles.error}>{rows.error}</div>}
                {Array.isArray(rows) && rows.length === 0 && <div className={styles.muted}>The current portal has no custom properties here.</div>}
                {Array.isArray(rows) && rows.length > 0 && (
                  <table className={styles.table}>
                    <thead><tr><th>Property</th><th>Internal name</th><th>Type</th><th>New portal</th><th>Missing options</th></tr></thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.name}>
                          <td>{r.label}</td>
                          <td className={styles.mono}>{r.name}</td>
                          <td>{r.type}{r.targetType ? ` (new: ${r.targetType})` : ''}</td>
                          <td className={r.status === 'ok' ? styles.okText : styles.errText}>{PROP_STATUS[r.status]}</td>
                          <td>{(r.missingOptions || []).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}

          {overview.target?.configured && (
            <>
              <CompareSection kind="contacts" ownerEmail={ownerEmail} recentDays={recentDays} />
              <CompareSection kind="companies" ownerEmail={ownerEmail} recentDays={recentDays} />
            </>
          )}
        </>
      )}
    </div>
  );
}
