// "Download everything" — the Backups page's top section.
//
// The rest of this page backs up one dataset each: Opps, then the settings
// document. This is the one that answers the question those two don't —
// what happens if this browser, or the account behind it, is gone. It
// writes a single JSON file holding every localStorage key, every
// IndexedDB record and the cloud-side collections, and reads one back.
//
// The nudge at the top is the point of the panel as much as the button is:
// a backup nobody remembers to take is not a backup, and the failure it
// guards against (clearing site data) gives no warning.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { userLsGet, userLsSet } from '../utils/userLs';
import {
  backupFileName, collectFullBackup, downloadBackupFile,
  isFullBackupEnvelope, restoreFullBackup, summarizeBackup,
} from '../utils/fullBackup';

const LAST_BACKUP_KEY = 'full-backup:last-at';
// Past this, the panel says so in amber. A month is roughly how much
// typing a re-import can't put back.
const STALE_AFTER_DAYS = 30;

const BTN = {
  padding: '0.45rem 0.85rem', background: 'transparent',
  border: '1px solid #CBD5E1', borderRadius: 6,
  fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
  color: '#1E293B', cursor: 'pointer',
};
const PRIMARY = { ...BTN, background: '#009530', borderColor: '#009530', color: '#fff' };

function fmtBytes(n) {
  if (!(n > 0)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function daysSince(ts) {
  if (!(ts > 0)) return null;
  return Math.floor((Date.now() - ts) / 86400000);
}

function readLastBackupAt() {
  const n = Number(userLsGet(LAST_BACKUP_KEY));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// What a file holds, in the words the confirm dialog needs.
function describe(summary) {
  const bits = [];
  if (summary.localKeys) bits.push(`${summary.localKeys} browser keys`);
  if (summary.idbRecords) bits.push(`${summary.idbRecords} stored records`);
  if (summary.prospects) bits.push(`${summary.prospects} companies`);
  if (summary.opps2Records) bits.push(`${summary.opps2Records} opps`);
  if (summary.contractLanguage) bits.push(`${summary.contractLanguage} contract-language services`);
  if (summary.hasSettings) bits.push('settings');
  return bits.join(', ') || 'nothing';
}

export function FullBackupPanel() {
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [lastAt, setLastAt] = useState(readLastBackupAt);
  const [note, setNote] = useState(null);
  const [includeFiles, setIncludeFiles] = useState(true);
  const [includeCloud, setIncludeCloud] = useState(true);

  useEffect(() => { setLastAt(readLastBackupAt()); }, [user?.uid]);

  const handleDownload = useCallback(async () => {
    setNote(null);
    setBusy('Starting…');
    try {
      const { env, json } = await collectFullBackup({
        uid: user?.uid || '',
        email: user?.email || '',
        includeFiles,
        includeCloud,
        onProgress: setBusy,
      });
      setBusy('Writing the file…');
      downloadBackupFile(env, json);
      const summary = summarizeBackup(env);
      const at = Date.now();
      try { userLsSet(LAST_BACKUP_KEY, String(at)); } catch { /* quota */ }
      setLastAt(at);
      setNote({
        tone: 'ok',
        text: `Saved ${backupFileName(env)} — ${fmtBytes(summary.bytes)}, ${describe(summary)}.`
          + (summary.skipped ? ` ${summary.skipped} item(s) couldn't be written to a file; see manifest.skipped inside it.` : ''),
      });
    } catch (err) {
      console.error('Full backup failed', err);
      setNote({ tone: 'bad', text: `Backup failed: ${err?.message || err}` });
    } finally {
      setBusy('');
    }
  }, [user?.uid, user?.email, includeFiles, includeCloud]);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setNote(null);
    let env;
    try {
      env = JSON.parse(await file.text());
    } catch (err) {
      setNote({ tone: 'bad', text: `That file isn't readable JSON: ${err?.message || err}` });
      return;
    }
    if (!isFullBackupEnvelope(env)) {
      setNote({ tone: 'bad', text: 'That is not a Prospect Tracker full backup. (Settings-only backups restore from the list below.)' });
      return;
    }
    const summary = summarizeBackup(env);
    const taken = summary.createdAt ? new Date(summary.createdAt).toLocaleString() : 'an unknown date';
    const otherAccount = summary.email && user?.email && summary.email !== user.email;
    const ok = window.confirm(
      `Restore the backup taken ${taken}?\n\n`
      + `It holds: ${describe(summary)}.\n`
      + (otherAccount ? `\nHEADS UP: it was taken by ${summary.email}, and you are signed in as ${user.email}. Its data will be restored into YOUR account.\n` : '')
      + '\nThis overwrites the matching data in this browser. '
      + 'Anything not in the file is left alone — nothing is deleted.\n\n'
      + 'The page reloads when it finishes.'
    );
    if (!ok) return;
    // Asked second, and separately: writing this browser back is local and
    // undoable by restoring another file. Writing the cloud reaches every
    // other device signed into the account, which is a different decision.
    const restoreCloud = !!env.firestore && window.confirm(
      `This backup also holds cloud data (${describe(summary)}).\n\n`
      + 'OK — restore the cloud data too: companies are written back under their original ids, '
      + 'Opps 2 is replaced, and your settings document is merged over (a snapshot of the current '
      + 'one is taken first, so this is reversible from the list below).\n\n'
      + 'Cancel — restore only this browser\'s data and leave the cloud alone.'
    );

    setBusy('Restoring…');
    try {
      const result = await restoreFullBackup(env, { uid: user?.uid || '', includeCloud: restoreCloud, onProgress: setBusy });
      const lines = [
        `Restored ${result.localKeys} browser keys and ${result.idbRecords} stored records.`,
        result.mirrors ? `${result.mirrors} of them were published back to the cloud, so this restore wins on your other devices too.` : '',
        result.cloud.length ? `Cloud: ${result.cloud.join(', ')}.` : '',
        result.failures.length ? `\n${result.failures.length} item(s) failed:\n- ${result.failures.slice(0, 8).join('\n- ')}` : '',
        '\nThe page will reload now.',
      ].filter(Boolean);
      window.alert(lines.join('\n'));
      window.location.reload();
    } catch (err) {
      console.error('Restore failed', err);
      setNote({ tone: 'bad', text: `Restore failed: ${err?.message || err}` });
      setBusy('');
    }
  }, [user?.uid, user?.email]);

  const age = daysSince(lastAt);
  const stale = age === null || age >= STALE_AFTER_DAYS;

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem',
        padding: '0.5rem 0.65rem', borderRadius: 6,
        background: stale ? '#FFFBEB' : '#F0FDF4',
        border: `1px solid ${stale ? '#FDE68A' : '#BBF7D0'}`,
        fontSize: '0.75rem', color: '#334155',
      }}>
        <span>{stale ? '⚠️' : '✅'}</span>
        <span>
          {age === null
            ? 'You have never downloaded a full backup on this browser.'
            : age === 0
              ? 'Full backup downloaded today.'
              : `Last full backup: ${age} day${age === 1 ? '' : 's'} ago${stale ? ' — worth taking a fresh one.' : '.'}`}
        </span>
      </div>

      <div style={{ fontSize: '0.72rem', color: '#64748B', marginBottom: '0.6rem', lineHeight: 1.45 }}>
        One file with everything: deals, clients, commissions, timelines and every other
        typed-in field from this browser, plus your companies, settings and Opps 2 from the
        cloud. Keep it somewhere off this laptop. It is plain, unencrypted JSON holding client
        data, so treat the file the way you would the tracker workbook itself.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.6rem', fontSize: '0.72rem', color: '#475569' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeCloud} onChange={e => setIncludeCloud(e.target.checked)} />
          Include cloud data (companies, settings, Opps 2)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeFiles} onChange={e => setIncludeFiles(e.target.checked)} />
          Include uploaded lists &amp; attachments (bigger file)
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button style={PRIMARY} onClick={handleDownload} disabled={!!busy}>
          {busy ? busy : 'Download full backup'}
        </button>
        <button style={BTN} onClick={() => fileRef.current?.click()} disabled={!!busy}>
          Restore from a backup file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';   // so picking the same file twice still fires
            handleFile(file);
          }}
        />
      </div>

      {note && (
        <div style={{
          marginTop: '0.6rem', fontSize: '0.72rem', lineHeight: 1.45,
          color: note.tone === 'bad' ? '#B91C1C' : '#166534',
        }}>{note.text}</div>
      )}
    </div>
  );
}
