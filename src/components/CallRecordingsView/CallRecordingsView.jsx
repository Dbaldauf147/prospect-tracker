// Call Recordings — lists media files from a folder in the user's
// PERSONAL OneDrive, plays them inline, links one to a company, and
// transcribes it.
//
// Connection model: this deliberately uses its own Microsoft sign-in
// (/api/onedrive-auth) and its own token keys, separate from the
// `outlook-*` ones the calendar/mail integration uses. The recordings
// live in a personal Microsoft account, which is normally not the work
// account Outlook is signed into — sharing one token would mean
// connecting one feature disconnects the other.
//
// Nothing here streams media through our own server: Graph hands out a
// short-lived pre-authenticated download URL per file, the <audio> /
// <video> element plays straight from it, and the transcription service
// fetches it directly too.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { secureGet, secureSet, secureClear } from '../../utils/secureStorage';
import styles from './CallRecordingsView.module.css';

const TOKEN_KEY = 'onedrive-access-token';
const REFRESH_KEY = 'onedrive-refresh-token';
const EXPIRY_KEY = 'onedrive-token-expiry';
const DEFAULT_FOLDER = '/Recordings';
// Refresh a little early so a long page session doesn't hit a 401 mid-click.
const EXPIRY_SKEW_MS = 120000;
const POLL_MS = 5000;

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fmtDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'wmv', 'avi', 'mkv', 'webm']);
const isVideo = (rec) => VIDEO_EXT.has(rec.extension) || String(rec.mimeType).startsWith('video/');

// Company picker — searches the loaded prospects by name.
function CompanyPicker({ prospects, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const named = prospects.filter(p => p?.id && String(p.company || '').trim());
    const list = q
      ? named.filter(p => String(p.company).toLowerCase().includes(q))
      : named;
    return list
      .slice()
      .sort((a, b) => String(a.company).localeCompare(String(b.company)))
      .slice(0, 50);
  }, [prospects, query]);

  return (
    <div className={styles.pickerBackdrop} onClick={onClose}>
      <div className={styles.pickerCard} onClick={e => e.stopPropagation()}>
        <div className={styles.pickerHead}>
          <span>Link recording to a company</span>
          <button type="button" className={styles.pickerClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.pickerBody}>
          <input
            className={styles.input}
            style={{ width: '100%', marginBottom: '0.5rem' }}
            type="text"
            placeholder="Search companies…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          {matches.length === 0 ? (
            <div className={styles.transcriptStatus}>No company matches “{query}”.</div>
          ) : matches.map(p => (
            <button key={p.id} type="button" className={styles.pickerOption} onClick={() => onPick(p)}>
              {p.company}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CallRecordingsView({ prospects = [], settings = {}, updateSettings, onSelectProspect }) {
  const [connected, setConnected] = useState(false);
  const [checkedConnection, setCheckedConnection] = useState(false);
  const [folder, setFolder] = useState(settings.callRecordingsFolder || DEFAULT_FOLDER);
  const [folderDraft, setFolderDraft] = useState(settings.callRecordingsFolder || DEFAULT_FOLDER);
  const [recordings, setRecordings] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(null);       // item id with an open player
  const [pickerFor, setPickerFor] = useState(null);   // item id awaiting a company
  // itemId -> { status, text, utterances, error, id }
  const [transcripts, setTranscripts] = useState({});
  const pollTimers = useRef({});

  // recordingId -> { prospectId, company, linkedAt }, persisted in user settings.
  const links = settings.callRecordingLinks || {};

  // ---- token handling ------------------------------------------------------
  // Returns a live access token, silently refreshing when the stored one
  // has expired. Null means "no usable connection" — the caller shows the
  // Connect button rather than an error.
  const getToken = useCallback(async () => {
    const token = await secureGet(TOKEN_KEY);
    const expiry = Number(await secureGet(EXPIRY_KEY)) || 0;
    if (token && (!expiry || Date.now() < expiry - EXPIRY_SKEW_MS)) return token;

    const refresh = await secureGet(REFRESH_KEY);
    if (!refresh) return null;
    try {
      const r = await apiFetch('/api/onedrive-refresh', {
        method: 'POST',
        headers: { 'X-MS-Refresh-Token': refresh },
      });
      if (!r.ok) {
        // Refresh token is dead — clear it so the UI stops pretending
        // there's a connection.
        secureClear(TOKEN_KEY);
        secureClear(REFRESH_KEY);
        secureClear(EXPIRY_KEY);
        return null;
      }
      const data = await r.json();
      await secureSet(TOKEN_KEY, data.accessToken);
      if (data.refreshToken) await secureSet(REFRESH_KEY, data.refreshToken);
      await secureSet(EXPIRY_KEY, String(Date.now() + (data.expiresIn || 3600) * 1000));
      return data.accessToken;
    } catch {
      return null;
    }
  }, []);

  const loadRecordings = useCallback(async (folderPath) => {
    setError('');
    const token = await getToken();
    if (!token) {
      setConnected(false);
      setRecordings([]);
      return;
    }
    setConnected(true);
    setLoading(true);
    try {
      const r = await apiFetch(`/api/onedrive-recordings?folder=${encodeURIComponent(folderPath)}`, {
        headers: { 'X-MS-Token': token },
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setConnected(false);
        setRecordings([]);
        return;
      }
      if (!r.ok) {
        setError(data.error || `Could not read OneDrive (HTTP ${r.status})`);
        setRecordings([]);
        return;
      }
      setRecordings(data.recordings || []);
      setSkipped(data.skipped || 0);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  // Initial load: figure out whether there's a live connection, and if so
  // pull the configured folder.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (cancelled) return;
      setCheckedConnection(true);
      if (!token) { setConnected(false); return; }
      setConnected(true);
      loadRecordings(folder);
    })();
    return () => { cancelled = true; };
    // Folder changes go through applyFolder, which reloads explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken]);

  // Sign-in popup result.
  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'onedrive-auth-success') {
        (async () => {
          await secureSet(TOKEN_KEY, e.data.accessToken);
          if (e.data.refreshToken) await secureSet(REFRESH_KEY, e.data.refreshToken);
          await secureSet(EXPIRY_KEY, String(Date.now() + (e.data.expiresIn || 3600) * 1000));
          setConnected(true);
          setError('');
          loadRecordings(folder);
        })();
      } else if (e.data?.type === 'onedrive-auth-error') {
        setError(e.data.error || 'Microsoft sign-in failed.');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [folder, loadRecordings]);

  // Stop every in-flight transcript poll on unmount.
  useEffect(() => {
    const timers = pollTimers.current;
    return () => { for (const t of Object.values(timers)) clearTimeout(t); };
  }, []);

  function connect() {
    window.open('/api/onedrive-auth', 'onedrive-auth', 'width=520,height=720,left=200,top=100');
  }

  function disconnect() {
    secureClear(TOKEN_KEY);
    secureClear(REFRESH_KEY);
    secureClear(EXPIRY_KEY);
    setConnected(false);
    setRecordings([]);
  }

  function applyFolder() {
    const next = folderDraft.trim() || DEFAULT_FOLDER;
    setFolder(next);
    setFolderDraft(next);
    updateSettings?.({ callRecordingsFolder: next });
    loadRecordings(next);
  }

  // ---- company links -------------------------------------------------------
  function linkTo(recordingId, prospect) {
    const next = {
      ...links,
      [recordingId]: { prospectId: prospect.id, company: prospect.company, linkedAt: new Date().toISOString() },
    };
    updateSettings?.({ callRecordingLinks: next });
    setPickerFor(null);
  }

  function unlink(recordingId) {
    const next = { ...links };
    delete next[recordingId];
    updateSettings?.({ callRecordingLinks: next });
  }

  // ---- transcription -------------------------------------------------------
  const pollTranscript = useCallback(async (recordingId, transcriptId) => {
    try {
      const r = await apiFetch(`/api/onedrive-transcribe?id=${encodeURIComponent(transcriptId)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTranscripts(t => ({ ...t, [recordingId]: { status: 'error', error: data.error || `HTTP ${r.status}` } }));
        return;
      }
      setTranscripts(t => ({ ...t, [recordingId]: { ...data, id: transcriptId } }));
      if (data.status === 'queued' || data.status === 'processing') {
        pollTimers.current[recordingId] = setTimeout(() => pollTranscript(recordingId, transcriptId), POLL_MS);
      }
    } catch (err) {
      setTranscripts(t => ({ ...t, [recordingId]: { status: 'error', error: err?.message || String(err) } }));
    }
  }, []);

  async function transcribe(recording) {
    setTranscripts(t => ({ ...t, [recording.id]: { status: 'starting' } }));
    const token = await getToken();
    if (!token) {
      setConnected(false);
      setTranscripts(t => ({ ...t, [recording.id]: { status: 'error', error: 'OneDrive connection expired — reconnect and try again.' } }));
      return;
    }
    try {
      const r = await apiFetch(`/api/onedrive-transcribe?itemId=${encodeURIComponent(recording.id)}`, {
        method: 'POST',
        headers: { 'X-MS-Token': token },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTranscripts(t => ({ ...t, [recording.id]: { status: 'error', error: data.error || `HTTP ${r.status}` } }));
        return;
      }
      setTranscripts(t => ({ ...t, [recording.id]: { status: data.status || 'queued', id: data.id } }));
      pollTranscript(recording.id, data.id);
    } catch (err) {
      setTranscripts(t => ({ ...t, [recording.id]: { status: 'error', error: err?.message || String(err) } }));
    }
  }

  const pickerRecording = pickerFor ? recordings.find(r => r.id === pickerFor) : null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Call Recordings</h1>
          <div className={styles.subtitle}>
            Recordings from a folder in your personal OneDrive. Play them here, link one to a company,
            or transcribe it. This connection is separate from the work Outlook one — signing in here
            doesn’t touch your calendar or mail integration.
          </div>
        </div>
        <div className={styles.toolbar}>
          <span className={connected ? styles.connected : styles.disconnected}>
            {connected ? '● OneDrive connected' : '○ Not connected'}
          </span>
          {connected ? (
            <>
              <button type="button" className={styles.btn} onClick={() => loadRecordings(folder)} disabled={loading}>
                {loading ? 'Loading…' : 'Refresh'}
              </button>
              <button type="button" className={styles.btn} onClick={disconnect}>Disconnect</button>
            </>
          ) : (
            <button type="button" className={styles.btnPrimary} onClick={connect}>Connect OneDrive</button>
          )}
        </div>
      </div>

      <div className={styles.controls}>
        <span className={styles.fieldLabel}>Folder</span>
        <input
          className={styles.input}
          type="text"
          value={folderDraft}
          placeholder={DEFAULT_FOLDER}
          onChange={e => setFolderDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') applyFolder(); }}
          title="Path relative to your OneDrive root, e.g. /Recordings or /Documents/Calls. Case-sensitive."
        />
        <button
          type="button"
          className={styles.btn}
          onClick={applyFolder}
          disabled={!connected || folderDraft.trim() === folder}
        >Load folder</button>
        <span className={styles.transcriptStatus}>
          Relative to your OneDrive root. Leave as <code>/</code> to list the root itself.
        </span>
      </div>

      <div className={styles.body}>
        {error && <div className={styles.error}>{error}</div>}

        {!connected && checkedConnection ? (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Connect your personal OneDrive</span>
            You’ll be asked to sign in with Microsoft and grant read-only access to your files
            (<code>Files.Read</code>). Pick your <strong>personal</strong> account on the sign-in screen —
            the work account is the one Outlook already uses.
          </div>
        ) : connected && !loading && recordings.length === 0 && !error ? (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Nothing to play in {folder}</span>
            {skipped > 0
              ? `The folder exists and holds ${skipped} file${skipped === 1 ? '' : 's'}, but none are audio or video.`
              : 'The folder is empty. Check the path above — it’s case-sensitive and relative to your OneDrive root.'}
          </div>
        ) : (
          recordings.map(rec => {
            const link = links[rec.id];
            const tr = transcripts[rec.id];
            const video = isVideo(rec);
            const meta = [
              fmtWhen(rec.modified || rec.created),
              fmtDuration(rec.durationSeconds),
              fmtSize(rec.size),
            ].filter(Boolean).join(' · ');
            return (
              <div key={rec.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.name} title={rec.name}>{rec.name}</span>
                  <span className={styles.meta}>{meta}</span>
                  {link && (
                    <span
                      className={styles.linkChip}
                      title={`Linked to ${link.company} — click to open the company`}
                      onClick={() => {
                        const p = prospects.find(x => x?.id === link.prospectId);
                        if (p) onSelectProspect?.(p);
                      }}
                    >{link.company}</span>
                  )}
                  <span className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => setPlaying(p => (p === rec.id ? null : rec.id))}
                    >{playing === rec.id ? 'Hide player' : '▶ Play'}</button>
                    <a className={styles.btn} href={rec.downloadUrl} download={rec.name} target="_blank" rel="noopener noreferrer">⬇ Download</a>
                    <button type="button" className={styles.btn} onClick={() => setPickerFor(rec.id)}>
                      {link ? 'Change company' : 'Link to company'}
                    </button>
                    {link && (
                      <button type="button" className={styles.btn} onClick={() => unlink(rec.id)} title={`Remove the link to ${link.company}`}>Unlink</button>
                    )}
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => transcribe(rec)}
                      disabled={tr && (tr.status === 'starting' || tr.status === 'queued' || tr.status === 'processing')}
                    >
                      {tr?.status === 'completed' ? 'Re-transcribe' : 'Transcribe'}
                    </button>
                  </span>
                </div>

                {playing === rec.id && (
                  <div className={styles.player}>
                    {video
                      ? <video src={rec.downloadUrl} controls preload="metadata" />
                      : <audio src={rec.downloadUrl} controls preload="metadata" />}
                  </div>
                )}

                {tr && (
                  <div className={styles.transcript}>
                    {tr.status === 'error' ? (
                      <div className={styles.error} style={{ margin: 0 }}>{tr.error}</div>
                    ) : tr.status !== 'completed' ? (
                      <div className={styles.transcriptStatus}>
                        {tr.status === 'starting' ? 'Sending to the transcription service…'
                          : tr.status === 'queued' ? 'Queued — transcription usually takes a fraction of the recording’s length.'
                          : 'Transcribing…'}
                      </div>
                    ) : tr.utterances?.length ? (
                      tr.utterances.map((u, i) => (
                        <div key={i} className={styles.utterance}>
                          <span className={styles.speaker}>Speaker {u.speaker}</span>
                          <span>{u.text}</span>
                        </div>
                      ))
                    ) : tr.text ? (
                      <div>{tr.text}</div>
                    ) : (
                      <div className={styles.transcriptStatus}>The transcription came back empty — there may be no speech in this file.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {pickerRecording && (
        <CompanyPicker
          prospects={prospects}
          onPick={p => linkTo(pickerRecording.id, p)}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}

export default CallRecordingsView;
