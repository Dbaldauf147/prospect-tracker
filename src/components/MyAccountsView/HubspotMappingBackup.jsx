// The backup bar across the top of the Hubspot Mapping page, on every
// subtab: when the mapping and the activity history were last copied to the
// cloud, a button to copy them now, a download of the two as a file of
// their own, and a restore from a cloud backup or a file (any of the three
// shapes utils/hubspotMappingBackup reads). The restore is additive and
// says what it will add before it saves anything.
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { buildHubspotBackupFile, hubspotBackupFileName, readHubspotBackup, planHubspotRestore } from '../../utils/hubspotMappingBackup';

const btn = { padding: '0.15rem 0.6rem', borderRadius: 5, border: '1px solid #CBD5E1', background: '#fff', color: '#1E293B', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' };
const fmtWhen = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};
const fmt = (n) => Number(n || 0).toLocaleString();
// The kind of run a cloud backup's name says it was.
const kindOf = (name) => (/-manual-/.test(name) ? 'Back up now' : 'Nightly');

export function HubspotMappingBackup({ mapping, activity, loaded, onRestored }) {
  const [cloud, setCloud] = useState(null); // [{ name, createdTime }] newest first, or null while loading
  const [cloudError, setCloudError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState(null); // { ok, text }
  const [picking, setPicking] = useState(false);
  const fileRef = useRef(null);

  const loadList = async () => {
    try {
      const r = await apiFetch('/api/backups-list');
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || `HTTP ${r.status}`);
      setCloud(out.files || []);
      setCloudError('');
    } catch (err) {
      setCloud([]);
      setCloudError(String(err.message || err));
    }
  };
  useEffect(() => { loadList(); }, []);

  const backUpNow = async () => {
    setBusy('Backing up...'); setNote(null);
    try {
      const r = await apiFetch('/api/backup-now', { method: 'POST' });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || `HTTP ${r.status}`);
      const c = out.summary?.counts || {};
      setNote({ ok: true, text: `Backed up to the cloud: ${fmt(c.hubspotMappingLinks)} links, ${fmt(c.hubspotMappingCompanies)} HubSpot companies, ${fmt(c.hubspotActivities)} activities.` });
      loadList();
    } catch (err) {
      setNote({ ok: false, text: `Couldn't back up: ${err.message || err}` });
    } finally { setBusy(''); }
  };

  const download = () => {
    const now = new Date();
    const blob = new Blob([JSON.stringify(buildHubspotBackupFile({ mapping, activity, now }), null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = hubspotBackupFileName(now);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote({ ok: true, text: `Downloaded ${hubspotBackupFileName(now)}.` });
  };

  // Shared by both restore sources once the backup is read.
  const restore = async (backup, from) => {
    // Cloud backups only started carrying these on Nov 12, 2026.
    if (!backup) throw new Error(`${from} has no Hubspot mapping or activity in it. Backups from before Nov 12, 2026 didn't include them.`);
    const plan = planHubspotRestore({ mapping, activity }, backup);
    const when = fmtWhen(backup.createdAt);
    if (!plan.changes) {
      setNote({ ok: true, text: `Nothing to restore: everything in ${from}${when ? ` (${when})` : ''} is already here.` });
      return;
    }
    const lines = [
      plan.exportRestored && `the HubSpot company export (${fmt(plan.mapping.companies.length)} companies)`,
      plan.linksAdded && `${fmt(plan.linksAdded)} account link${plan.linksAdded === 1 ? '' : 's'}`,
      plan.activitiesAdded && `${fmt(plan.activitiesAdded)} activit${plan.activitiesAdded === 1 ? 'y' : 'ies'}`,
      plan.ignoredAdded && `${fmt(plan.ignoredAdded)} ignored activit${plan.ignoredAdded === 1 ? 'y' : 'ies'}`,
    ].filter(Boolean).map(s => `• ${s}`).join('\n');
    if (!window.confirm(`Restore from ${from}${when ? ` (${when})` : ''}?\n\nThis adds back what is missing here:\n${lines}\n\nNothing already here is changed or removed.`)) return;
    await onRestored(plan);
    setNote({ ok: true, text: `Restored from ${from}: ${lines.replace(/\n/g, ', ').replace(/• /g, '')}.` });
  };

  const restoreCloud = async (f) => {
    setPicking(false); setBusy('Reading backup...'); setNote(null);
    try {
      const r = await apiFetch(`/api/backup-fetch?name=${encodeURIComponent(f.name)}&part=lookupTables`);
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || `HTTP ${r.status}`);
      const backup = readHubspotBackup({ collections: { lookupTables: out.value || {} }, generatedAt: out.generatedAt || f.createdTime });
      await restore(backup, 'the cloud backup');
    } catch (err) {
      setNote({ ok: false, text: `Couldn't restore: ${err.message || err}` });
    } finally { setBusy(''); }
  };

  const restoreFile = async (file) => {
    if (!file) return;
    setPicking(false); setBusy('Reading file...'); setNote(null);
    try {
      let parsed;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error(`${file.name} isn't a backup file (not JSON).`); }
      await restore(readHubspotBackup(parsed), file.name);
    } catch (err) {
      setNote({ ok: false, text: `Couldn't restore: ${err.message || err}` });
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const latest = cloud?.[0];
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', fontSize: '0.72rem', color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.3rem 0.6rem', position: 'relative' }}>
      <span style={{ fontWeight: 700, color: '#1E293B' }}>Backup</span>
      <span title="The nightly backup copies the mapping, your links and the activity history to cloud storage, keeping the last 30.">
        {cloud == null ? 'Checking cloud backups...'
          : latest ? `Last cloud backup ${fmtWhen(latest.createdTime)} (${kindOf(latest.name)}), ${fmt(cloud.length)} kept`
          : cloudError ? `Cloud backups unavailable: ${cloudError}` : 'No cloud backup yet'}
      </span>
      <span style={{ flex: 1 }} />
      <button type="button" style={btn} disabled={!!busy} onClick={backUpNow} title="Copy the mapping, links and activity history (and the rest of your data) to cloud storage now">Back up now</button>
      <button type="button" style={btn} disabled={!!busy || !loaded} onClick={download} title="Download the mapping, links and activity history as a file">Download</button>
      <button type="button" style={btn} disabled={!!busy || !loaded} onClick={() => setPicking(p => !p)} title="Add back lost links or activity from a backup">Restore...</button>
      {busy && <span style={{ color: '#1D4ED8' }}>{busy}</span>}
      {note && <div style={{ flexBasis: '100%', color: note.ok ? '#15803D' : '#B91C1C' }}>{note.text}</div>}
      <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={e => restoreFile(e.target.files?.[0])} />
      {picking && (
        <div style={{ position: 'absolute', right: 8, top: '100%', marginTop: 4, zIndex: 50, background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.18)', width: 320, maxHeight: 340, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '0.5rem 0.65rem', borderBottom: '1px solid #E2E8F0', color: '#64748B', lineHeight: 1.4 }}>
            Adds back links and activity that are missing here. Nothing already here is changed or removed.
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {(cloud || []).length === 0 && <div style={{ padding: '0.5rem 0.65rem', color: '#94A3B8' }}>No cloud backups to restore from.</div>}
            {(cloud || []).map(f => (
              <button key={f.name} type="button" onClick={() => restoreCloud(f)}
                style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '0.35rem 0.65rem', border: 'none', borderBottom: '1px solid #F1F5F9', background: 'none', fontSize: '0.74rem', fontFamily: 'inherit', color: '#1E293B', cursor: 'pointer', textAlign: 'left' }}>
                <span>{fmtWhen(f.createdTime)}</span><span style={{ color: '#94A3B8' }}>{kindOf(f.name)}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', padding: '0.45rem 0.65rem', borderTop: '1px solid #E2E8F0' }}>
            <button type="button" style={btn} onClick={() => fileRef.current?.click()}>From a file...</button>
            <span style={{ flex: 1 }} />
            <button type="button" style={btn} onClick={() => setPicking(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
