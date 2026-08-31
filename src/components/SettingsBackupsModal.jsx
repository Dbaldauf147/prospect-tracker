import { useEffect, useState } from 'react';
import { listBackups, getBackup, deleteBackup } from '../utils/settingsBackup';
import { OppsBackupPanel } from './OppsBackupPanel';
import { FullBackupPanel } from './FullBackupPanel';

function fmtTime(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function summarize(data) {
  if (!data) return '';
  const parts = [];
  const co = data.companyOpportunities;
  if (co && typeof co === 'object') {
    const companyCount = Object.keys(co).length;
    let noteCount = 0;
    for (const slug of Object.keys(co)) {
      noteCount += (co[slug]?.opportunities || []).length;
    }
    parts.push(`${companyCount} companies, ${noteCount} notes`);
  }
  const drafts = data.emailDrafts;
  if (drafts && typeof drafts === 'object') {
    parts.push(`${Object.keys(drafts).length} email drafts`);
  }
  const topKeys = Object.keys(data).filter(k => !k.startsWith('_')).length;
  parts.push(`${topKeys} total keys`);
  return parts.join(' · ');
}

export function SettingsBackupsModal({ open, onClose, onRestore }) {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const rows = await listBackups();
    setBackups(rows);
    setLoading(false);
  }

  useEffect(() => { if (open) refresh(); }, [open]);

  if (!open) return null;

  async function handleRestore(ts) {
    const b = await getBackup(ts);
    if (!b) { alert('Backup not found.'); return; }
    const confirmed = window.confirm(
      'Restore this backup?\n\n' +
      'This will OVERWRITE your current settings (notes, buckets, drafts, etc.) ' +
      'with the snapshot from ' + fmtTime(ts) + '.\n\n' +
      'A fresh backup of your current state will be pushed first, so you can roll back.'
    );
    if (!confirmed) return;
    await onRestore(b.data);
    alert('Restored. You may need to refresh the page to see everything.');
    refresh();
  }

  async function handleDelete(ts) {
    if (!window.confirm('Delete this backup permanently?')) return;
    await deleteBackup(ts);
    refresh();
  }

  function handleDownload(b) {
    const blob = new Blob([JSON.stringify(b.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prospect-tracker-settings-${b.timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, width: 'min(720px, 92vw)',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'auto',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Backups</h3>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ fontSize: '0.85rem', padding: '0.3rem 0.6rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748B' }}
          >Close</button>
        </div>
        <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 2 }}>Everything</div>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.6rem' }}>
            One file you can keep off this machine, and restore from.
          </div>
          <FullBackupPanel />
        </div>
        <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 2 }}>Opps data</div>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.6rem' }}>
            Export, back up, and restore the Opps dataset.
          </div>
          <OppsBackupPanel />
        </div>
        <div style={{ padding: '0.85rem 1.25rem 0.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>Settings backups</div>
            <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
              Saved locally in this browser before every settings write.
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={async () => {
              if (backups.length === 0) { alert('No backups to restore.'); return; }
              const newest = backups[0];
              const confirmed = window.confirm(
                'Restore the most recent backup from this laptop?\n\n' +
                'Taken: ' + fmtTime(newest.timestamp) + '\n' +
                summarize(newest.data) + '\n\n' +
                'This will overwrite your current settings with that snapshot. ' +
                'A fresh backup of your current state is taken first, so you can roll back.'
              );
              if (!confirmed) return;
              await onRestore(newest.data);
              alert('Restored the latest backup. You may need to refresh the page.');
              refresh();
            }}
            title="Restore the most recent backup in one click"
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem', border: 'none', background: '#009530', color: '#fff', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
          >Restore latest</button>
          <button
            onClick={refresh}
            style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', border: '1px solid #CBD5E1', background: '#fff', borderRadius: 4, cursor: 'pointer' }}
          >Refresh</button>
        </div>
        <div style={{ overflow: 'auto', padding: '0.5rem 1.25rem 1.25rem' }}>
          {loading && <div style={{ padding: '1rem', color: '#64748B' }}>Loading…</div>}
          {!loading && backups.length === 0 && (
            <div style={{ padding: '1rem', color: '#64748B' }}>
              No backups yet. As you make changes in the app, pre-save snapshots will appear here.
            </div>
          )}
          {!loading && backups.map(b => (
            <div
              key={b.timestamp}
              style={{
                padding: '0.75rem 0', borderBottom: '1px solid #F1F5F9',
                display: 'flex', alignItems: 'center', gap: '0.75rem',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{fmtTime(b.timestamp)}</div>
                <div style={{ fontSize: '0.72rem', color: '#64748B' }}>{summarize(b.data)}</div>
                {b.reason && <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>reason: {b.reason}</div>}
              </div>
              <button
                onClick={() => handleDownload(b)}
                style={{ fontSize: '0.72rem', padding: '0.3rem 0.55rem', border: '1px solid #CBD5E1', background: '#fff', borderRadius: 4, cursor: 'pointer' }}
              >Download</button>
              <button
                onClick={() => handleRestore(b.timestamp)}
                style={{ fontSize: '0.72rem', padding: '0.3rem 0.55rem', border: 'none', background: '#009530', color: '#fff', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
              >Restore</button>
              <button
                onClick={() => handleDelete(b.timestamp)}
                style={{ fontSize: '0.72rem', padding: '0.3rem 0.55rem', border: '1px solid #FCA5A5', background: '#fff', color: '#DC2626', borderRadius: 4, cursor: 'pointer' }}
              >Delete</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
