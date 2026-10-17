// Commissions > Earlier versions: the copies of the roster the cloud kept
// each time it was replaced (utils/localMirrorSync keeps the last 20), and
// a Restore beside each. A restore saves like any edit and keeps the
// roster it replaces as a version too, so it can itself be undone.
import { useEffect, useState } from 'react';
import { listMirrorVersions, readMirrorVersion } from '../../utils/localMirrorSync';
import { COMMISSIONS_MIRROR_KEY, restoreCommissions } from '../../utils/commissionsStore';

const REASONS = {
  auto: 'Saved',
  'before-delete': 'Before rows were removed or cleared',
  'before-restore': 'Before a restore',
  'not-saved': 'A change on a device whose copy was out of date (not saved)',
};

const fmtWhen = (ms) => (ms
  ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '-');

export function CommissionsVersionsModal({ currentRows = 0, onClose }) {
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listMirrorVersions(COMMISSIONS_MIRROR_KEY)
      .then(v => { if (!cancelled) setVersions(v); })
      .catch(err => { if (!cancelled) { setError(String(err?.message || err)); setVersions([]); } });
    return () => { cancelled = true; };
  }, []);

  async function restore(v) {
    const n = v.rows ?? '?';
    if (!window.confirm(`Replace the current roster (${currentRows} rows) with this version from ${fmtWhen(v.archivedAt)} (${n} rows)? The current roster is kept as an earlier version, so this can be undone.`)) return;
    setBusy(v.slot);
    try {
      const json = await readMirrorVersion(COMMISSIONS_MIRROR_KEY, v.slot);
      const rows = json ? JSON.parse(json) : null;
      if (!Array.isArray(rows)) throw new Error('That version could not be read.');
      restoreCommissions(rows);
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
        aria-label="Earlier versions of the commissions roster"
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, width: 'min(640px, 94vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(15, 23, 42, 0.25)' }}
      >
        <div style={{ padding: '0.9rem 1.1rem 0.5rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>Earlier versions</div>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            The roster as it stood before each time it was replaced, newest first. Every save that removes rows keeps one; routine edits keep one at most every 10 minutes. The last 20 are kept.
          </div>
        </div>
        <div style={{ overflow: 'auto', padding: '0.4rem 1.1rem 0.8rem' }}>
          {error && <div style={{ color: '#B91C1C', fontSize: '0.75rem', padding: '0.4rem 0' }}>{error}</div>}
          {versions == null ? (
            <div style={{ color: '#94A3B8', fontSize: '0.75rem', padding: '0.8rem 0' }}>Loading...</div>
          ) : versions.length === 0 ? (
            <div style={{ color: '#64748B', fontSize: '0.75rem', padding: '0.8rem 0' }}>
              No earlier versions yet. They are kept from now on, each time the roster is replaced.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748B' }}>
                  {['Kept', 'Rows', 'Why', ''].map(h => <th key={h} style={{ padding: '6px 6px', borderBottom: '1px solid #E2E8F0', fontWeight: 700 }}>{h}</th>)}
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
