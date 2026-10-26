// Earlier versions of a mirrored store: the copies the cloud kept each time
// it was replaced (utils/localMirrorSync keeps the last 20), and a Restore
// beside each. A restore saves like any edit and keeps what it replaces as
// a version too, so it can itself be undone.
//
// Shared by Commissions > Earlier versions and Pricing > Linked To > Earlier
// versions. `choices` lists the keys a caller offers ([{ key, label }]); one
// key is the usual case and shows no picker.
//
//   choices     [{ key: <mirror id>, label }]
//   noun        what one copy is called ("roster", "mapping")
//   unit        what its count counts ("rows", "entries")
//   currentCount(key)  the count on screen now, for the confirm
//   onRestore(key, json)  put the version back (throws to report a failure)
import { useEffect, useState } from 'react';
import { listMirrorVersions, readMirrorVersion } from '../../utils/localMirrorSync';
import { apiFetch } from '../../utils/apiFetch';

const REASONS = {
  auto: 'Saved',
  'before-delete': 'Before rows were removed or cleared',
  'before-restore': 'Before a restore',
  'not-saved': 'A change on a device whose copy was out of date (not saved)',
  recovered: 'Recovered from the database history',
  'restored-backup': 'Copied from a restored backup',
};

const fmtWhen = (ms) => (ms
  ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '-');

export function MirrorVersionsModal({
  choices, noun = 'copy', unit = 'rows', currentCount = () => null, onRestore, onClose,
  defaultDatabase = 'mirror-recovery',
}) {
  const [key, setKey] = useState(choices[0]?.key);
  const label = choices.find(c => c.key === key)?.label || noun;
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setVersions(null);
    listMirrorVersions(key)
      .then(v => { if (!cancelled) setVersions(v); })
      .catch(err => { if (!cancelled) { setError(String(err?.message || err)); setVersions([]); } });
    return () => { cancelled = true; };
  }, [key, reloadTick]);

  // Firestore point-in-time recovery, when the database has it on, keeps 7
  // days of every document's history. The server reads the copy back
  // through it hour by hour and files each one it finds as a version here
  // (api/mirror-recover).
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState('');
  // A Firestore scheduled backup restores into a NEW database (never over
  // the live one); this copies just this key out of it as a version here.
  const [restoredDb, setRestoredDb] = useState(defaultDatabase);
  const [copying, setCopying] = useState(false);
  async function copyFromRestoredDatabase() {
    setCopying(true);
    setSearchNote('');
    setError('');
    try {
      const resp = await apiFetch('/api/mirror-recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, fromDatabase: restoredDb.trim() }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(out.error || `The copy failed (${resp.status}).`);
      if (!out.found?.length) {
        setSearchNote(`The database "${restoredDb.trim()}" has no ${label} for your account.`);
      } else {
        const f = out.found[0];
        setSearchNote(`Found the ${label} in "${restoredDb.trim()}" (${f.rows} ${unit}, last saved ${fmtWhen(f.asOf)})${out.added ? ' and added it below' : ', already listed below'}. Click Restore beside it.`);
        setReloadTick(t => t + 1);
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setCopying(false);
    }
  }

  async function lookForOlderCopies() {
    setSearching(true);
    setSearchNote('');
    setError('');
    try {
      const resp = await apiFetch('/api/mirror-recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(out.error || `The search failed (${resp.status}).`);
      if (!out.pitr) {
        setSearchNote('The database does not keep a history of past copies (point-in-time recovery is off), so there is nothing older to find. It can be turned on in Google Cloud, under Firestore > Disaster recovery.');
      } else if (!out.found?.length) {
        setSearchNote(`No copies of the ${label} in the last 7 days of history.`);
      } else {
        const biggest = Math.max(...out.found.map(f => f.rows || 0));
        setSearchNote(`Found ${out.found.length} cop${out.found.length === 1 ? 'y' : 'ies'} in the last 7 days (largest ${biggest} ${unit})${out.added ? `; ${out.added} added below` : ', already listed below'}. Restore the one you want.`);
        setReloadTick(t => t + 1);
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setSearching(false);
    }
  }

  async function restore(v) {
    const n = v.rows ?? '?';
    const now = currentCount(key);
    const nowText = now == null ? '' : ` (${now} ${unit})`;
    if (!window.confirm(`Replace the current ${label}${nowText} with this version from ${fmtWhen(v.archivedAt)} (${n} ${unit})? The current one is kept as an earlier version, so this can be undone.`)) return;
    setBusy(v.slot);
    try {
      const json = await readMirrorVersion(key, v.slot);
      if (!json) throw new Error('That version could not be read.');
      await onRestore(key, json);
      onClose?.();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        role="dialog"
        aria-label={`Earlier versions of the ${label}`}
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, width: 'min(640px, 94vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(15, 23, 42, 0.25)' }}
      >
        <div style={{ padding: '0.9rem 1.1rem 0.5rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>Earlier versions</div>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            The {noun} as it stood before each time it was replaced, newest first. Every save that removes {unit} keeps one; routine edits keep one at most every 10 minutes. The last 20 are kept.
          </div>
          {choices.length > 1 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
              Show
              <select
                value={key}
                onChange={e => { setKey(e.target.value); setSearchNote(''); setError(''); }}
                style={{ padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.75rem', fontFamily: 'inherit' }}
              >
                {choices.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
          )}
        </div>
        <div style={{ overflow: 'auto', padding: '0.4rem 1.1rem 0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={lookForOlderCopies}
              disabled={searching}
              title={`Search the database's own history (the last 7 days, if point-in-time recovery is on) for earlier copies of the ${label}`}
              style={{ padding: '0.3rem 0.7rem', border: '1px solid #16A34A', background: '#F0FDF4', color: '#166534', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: searching ? 'wait' : 'pointer', fontFamily: 'inherit' }}
            >{searching ? 'Searching the last 7 days...' : 'Look for older copies'}</button>
            <span style={{ fontSize: '0.7rem', color: '#64748B' }}>Searches the database&apos;s history for copies from before they were replaced. Can take a minute.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.2rem 0 0.4rem', flexWrap: 'wrap' }}>
            <input
              value={restoredDb}
              onChange={e => setRestoredDb(e.target.value)}
              aria-label="Restored database ID"
              placeholder="restored database ID"
              style={{ padding: '0.28rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.75rem', fontFamily: 'inherit', width: 190 }}
            />
            <button
              type="button"
              onClick={copyFromRestoredDatabase}
              disabled={copying || !restoredDb.trim()}
              title={`Copy the ${label} out of a database restored from a Firestore scheduled backup, as an earlier version here. Nothing else is read or changed.`}
              style={{ padding: '0.3rem 0.7rem', border: '1px solid #2563EB', background: '#EFF6FF', color: '#1D4ED8', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: copying ? 'wait' : 'pointer', fontFamily: 'inherit' }}
            >{copying ? 'Copying...' : 'Copy from restored database'}</button>
            <span style={{ fontSize: '0.7rem', color: '#64748B' }}>For a Firestore backup restored into its own database.</span>
          </div>
          {searchNote && <div style={{ color: '#166534', fontSize: '0.75rem', padding: '0.2rem 0 0.4rem' }}>{searchNote}</div>}
          {error && <div style={{ color: '#B91C1C', fontSize: '0.75rem', padding: '0.4rem 0' }}>{error}</div>}
          {versions == null ? (
            <div style={{ color: '#94A3B8', fontSize: '0.75rem', padding: '0.8rem 0' }}>Loading...</div>
          ) : versions.length === 0 ? (
            <div style={{ color: '#64748B', fontSize: '0.75rem', padding: '0.8rem 0' }}>
              No earlier versions of the {label}. They are kept each time it is replaced. To look further back, use Look for older copies above.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748B' }}>
                  {['Kept', unit[0].toUpperCase() + unit.slice(1), 'Why', ''].map(h => <th key={h} style={{ padding: '6px 6px', borderBottom: '1px solid #E2E8F0', fontWeight: 700 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {versions.map(v => (
                  <tr key={`${v.slot}-${v.archivedAt}`} style={{ color: '#1E293B' }}>
                    <td style={{ padding: '6px', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }}>{fmtWhen(v.archivedAt)}</td>
                    <td style={{ padding: '6px', borderBottom: '1px solid #F1F5F9' }}>{v.rows ?? '-'}</td>
                    <td style={{ padding: '6px', borderBottom: '1px solid #F1F5F9', color: v.reason === 'not-saved' ? '#B45309' : '#475569' }}>{REASONS[v.reason] || v.reason}</td>
                    <td style={{ padding: '6px', borderBottom: '1px solid #F1F5F9', textAlign: 'right' }}>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => restore(v)}
                        style={{ padding: '0.25rem 0.6rem', border: '1px solid #2563EB', background: '#EFF6FF', color: '#1D4ED8', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600, cursor: busy != null ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                      >{busy === v.slot ? 'Restoring...' : 'Restore'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ padding: '0.6rem 1.1rem', borderTop: '1px solid #E2E8F0', textAlign: 'right' }}>
          <button type="button" onClick={onClose} style={{ padding: '0.35rem 0.8rem', border: '1px solid #CBD5E1', background: '#fff', borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
        </div>
      </div>
    </div>
  );
}
