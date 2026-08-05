// Backup actions for the Opps dataset, shown on the Backups page that
// opens from the sidebar gear (Settings). These used to live as four
// separate buttons on the Opps page toolbar. Restores run standalone
// against the canonical Opps store (IndexedDB + Firestore) and reload
// the page afterwards so an open Opps view rehydrates instead of
// autosaving its stale in-memory copy over the restored data.
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../utils/apiFetch';
import { loadOpps2Newest, saveOpps2Cache, trySaveOpps2ToFirestore } from '../utils/opps2Store';
import { pushOpps2Backup, listOpps2Backups, getOpps2Backup } from '../utils/opps2Backup';

const BTN_STYLE = {
  padding: '0.45rem 0.85rem', background: 'transparent',
  border: '1px solid #CBD5E1', borderRadius: 6,
  fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
  color: '#1E293B', cursor: 'pointer',
};

// Re-stamps every restored row to "now" so the snapshot decisively wins
// the per-row merge against any newer-looking copy, snapshots the data
// it's about to replace (so the restore is itself reversible from the
// local Backups list), then persists through the normal cache +
// Firestore path. Mirrors the restore the Opps page used to do inline.
async function applyOpps2Snapshot(uid, snapshot, label) {
  if (!snapshot || !Array.isArray(snapshot.records)) {
    window.alert('That backup has no Opps records to restore.');
    return false;
  }
  const current = await loadOpps2Newest(uid);
  const now = Date.now();
  const restored = {
    ...snapshot,
    records: snapshot.records.map(r => ({ ...r, _rowUpdatedAt: now })),
    _updatedAt: now,
  };
  await pushOpps2Backup(current, 'pre-restore', { force: true });
  await saveOpps2Cache(restored);
  if (uid) await trySaveOpps2ToFirestore(uid, restored);
  window.alert(
    `Restored ${restored.records.length} rows from ${label}. ` +
    'The page will reload to show the restored data.'
  );
  window.location.reload();
  return true;
}

// Local rolling backups (session-load / autosave / pre-import) kept on
// this device, so recovering a clobbered dataset is a click instead of
// a forensic dig through Chrome blobs.
function LocalBackupsModal({ onRestore, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    listOpps2Backups().then(r => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, []);

  const downloadOne = useCallback(async (ts) => {
    const entry = await getOpps2Backup(ts);
    if (!entry?.data) { window.alert('That backup could not be loaded.'); return; }
    const payload = JSON.stringify(entry.data, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `opps-backup-${new Date(ts).toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, []);

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface, #fff)', color: 'var(--color-text)', borderRadius: 8, padding: '1.25rem', width: 'min(680px, 92vw)', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Opps backups</h3>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
        <p style={{ marginTop: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          Local snapshots kept on this device (newest first). Restoring re-stamps every row so the snapshot wins the next sync and replaces the current data everywhere.
        </p>
        {rows == null ? <div style={{ padding: '1rem' }}>Loading…</div>
          : rows.length === 0 ? <div style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>No backups captured yet.</div>
          : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '0.4rem 0.5rem' }}>When</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Reason</th>
                <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Rows</th>
                <th style={{ padding: '0.4rem 0.5rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(b => (
                <tr key={b.timestamp} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' }}>{new Date(b.timestamp).toLocaleString()}</td>
                  <td style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)' }}>{b.reason || '-'}</td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{b.recordCount ?? '?'}</td>
                  <td style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button type="button" onClick={() => downloadOne(b.timestamp)} style={{ marginRight: 8, cursor: 'pointer' }}>Download</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Restore the ${new Date(b.timestamp).toLocaleString()} backup (${b.recordCount ?? '?'} rows)? This replaces the current Opps data on every device.`)) {
                          onRestore(b.timestamp);
                        }
                      }}
                      style={{ cursor: 'pointer', fontWeight: 600 }}
                    >Restore</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>,
    document.body
  );
}

// Off-site restore: lists the user's cloud-storage backups (daily +
// manual) and restores the Opps slice of a chosen one. The full data
// lives in the bucket; this fetches just opps2Data for the selected file.
function CloudRestoreModal({ onRestore, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    apiFetch('/api/backups-list')
      .then(async r => { const o = await r.json().catch(() => ({})); if (!r.ok) throw new Error(o?.error || `HTTP ${r.status}`); return o; })
      .then(o => { if (alive) setRows(o.files || []); })
      .catch(e => { if (alive) setErr(String(e.message || e)); });
    return () => { alive = false; };
  }, []);

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface, #fff)', color: 'var(--color-text)', borderRadius: 8, padding: '1.25rem', width: 'min(680px, 92vw)', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Restore from backup</h3>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
        <p style={{ marginTop: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          Off-site daily + manual backups. Restoring pulls the Opps data from the chosen file, re-stamps it to win the next sync, and replaces the current Opps data everywhere.
        </p>
        {err ? <div style={{ padding: '1rem', color: 'var(--color-danger, #b91c1c)' }}>Couldn’t list backups: {err}</div>
          : rows == null ? <div style={{ padding: '1rem' }}>Loading…</div>
          : rows.length === 0 ? <div style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>No backups found yet.</div>
          : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '0.4rem 0.5rem' }}>When</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>File</th>
                <th style={{ padding: '0.4rem 0.5rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(f => (
                <tr key={f.name} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' }}>{f.createdTime ? new Date(f.createdTime).toLocaleString() : '-'}{/manual/.test(f.name) ? ' (manual)' : ''}</td>
                  <td style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>{f.name}</td>
                  <td style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Restore Opps from "${f.name}"? This replaces the current Opps data on every device.`)) {
                          onRestore(f.name, f.name);
                        }
                      }}
                      style={{ cursor: 'pointer', fontWeight: 600 }}
                    >Restore Opps</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>,
    document.body
  );
}

export function OppsBackupPanel() {
  const { user } = useAuth();
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [cloudRestoreOpen, setCloudRestoreOpen] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const exportBackup = useCallback(async () => {
    try {
      const data = await loadOpps2Newest(user?.uid);
      if (!data?.records?.length) {
        window.alert('No Opps data to export yet.');
        return;
      }
      const payload = JSON.stringify(data, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `opps-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(`Export failed: ${err?.message || err}`);
    }
  }, [user?.uid]);

  // Fire an immediate off-site backup to cloud storage (server-side, all
  // collections — not just Opps). Handy to click right before a risky
  // edit so there's a fresh cloud copy independent of this browser.
  const backupNow = useCallback(async () => {
    if (backingUp) return;
    setBackingUp(true);
    try {
      const resp = await apiFetch('/api/backup-now', { method: 'POST' });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        window.alert(`Backup failed: ${out?.error || resp.status}`);
        return;
      }
      if (out.status === 'empty') {
        window.alert('Nothing to back up yet.');
        return;
      }
      const counts = out.counts || {};
      const lines = Object.keys(counts).map(k => `  • ${k}: ${counts[k]}`).join('\n');
      const warn = out.errors?.length ? `\n\nSome sections failed: ${out.errors.join('; ')}` : '';
      window.alert(`Backed up to cloud storage:\n${out.file}\n\n${lines}${warn}`);
    } catch (err) {
      window.alert(`Backup failed: ${err?.message || err}`);
    } finally {
      setBackingUp(false);
    }
  }, [backingUp]);

  const restoreLocalBackup = useCallback(async (timestamp) => {
    const entry = await getOpps2Backup(timestamp);
    if (!entry?.data) { window.alert('That backup could not be loaded.'); return; }
    await applyOpps2Snapshot(user?.uid, entry.data, `the ${new Date(timestamp).toLocaleString()} local backup`);
  }, [user?.uid]);

  const restoreFromCloud = useCallback(async (objectName, displayName) => {
    try {
      const resp = await apiFetch(`/api/backup-fetch?name=${encodeURIComponent(objectName)}&part=opps2Data`);
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok) { window.alert(`Couldn't fetch that backup: ${out?.error || resp.status}`); return; }
      if (!out.value || !Array.isArray(out.value.records)) {
        window.alert('That backup has no Opps data in it.');
        return;
      }
      await applyOpps2Snapshot(user?.uid, out.value, `the backup "${displayName}"`);
    } catch (err) {
      window.alert(`Restore failed: ${err?.message || err}`);
    }
  }, [user?.uid]);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
      <button
        type="button"
        onClick={exportBackup}
        style={BTN_STYLE}
        title="Download all Opps rows as a JSON backup file"
      >Export backup</button>
      <button
        type="button"
        onClick={() => setBackupsOpen(true)}
        style={BTN_STYLE}
        title="Browse and restore local rolling backups of the Opps dataset"
      >Backups</button>
      <button
        type="button"
        onClick={backupNow}
        disabled={backingUp}
        style={{ ...BTN_STYLE, cursor: backingUp ? 'progress' : 'pointer' }}
        title="Save an immediate off-site backup of all your data to cloud storage"
      >{backingUp ? 'Backing up…' : 'Back up now'}</button>
      <button
        type="button"
        onClick={() => setCloudRestoreOpen(true)}
        style={BTN_STYLE}
        title="Restore Opps from one of your off-site backups"
      >Restore from backup</button>

      {backupsOpen && (
        <LocalBackupsModal
          onRestore={restoreLocalBackup}
          onClose={() => setBackupsOpen(false)}
        />
      )}
      {cloudRestoreOpen && (
        <CloudRestoreModal
          onRestore={restoreFromCloud}
          onClose={() => setCloudRestoreOpen(false)}
        />
      )}
    </div>
  );
}
