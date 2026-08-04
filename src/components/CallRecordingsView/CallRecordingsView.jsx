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
import { useAuth } from '../../contexts/AuthContext';
import { secureGet, secureSet, secureClear } from '../../utils/secureStorage';
import {
  supportsDirectoryPicker, pickFolder, loadFolderHandle, forgetFolderHandle,
  folderPermission, listFolderRecordings, recordsFromFileList,
} from '../../utils/localRecordings';
import {
  loadCallRecords, saveCallRecord, deleteCallRecord, migrateSettingsLinks,
  oppLabel, summaryForOpp, mergeIntoNotes,
} from '../../utils/callRecordingsStore';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { buildActiveOppsIndex, activeOppsForCompany } from '../../utils/targetAccountOpps';
import { setOppField } from '../../utils/opps2Store';
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

// Opportunity picker. Opps for the recording's linked company come
// first, because that's the pick in almost every case; the search box
// below falls back to every active opp for the times the call was with
// someone whose company isn't the one on the opp (a parent, a broker).
function OppPicker({ oppsIndex, company, onPick, onClose }) {
  const [query, setQuery] = useState('');

  const suggested = useMemo(
    () => (company ? activeOppsForCompany(company, oppsIndex) : []),
    [company, oppsIndex],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const suggestedIds = new Set(suggested.map(o => String(o.raw?._id)));
    return (oppsIndex?.active || [])
      .filter(o => !suggestedIds.has(String(o.raw?._id)))
      .filter(o => oppLabel(o.raw).toLowerCase().includes(q))
      .slice(0, 40);
  }, [query, oppsIndex, suggested]);

  const noOppsAtAll = !oppsIndex || (oppsIndex.active || []).length === 0;

  return (
    <div className={styles.pickerBackdrop} onClick={onClose}>
      <div className={styles.pickerCard} onClick={e => e.stopPropagation()}>
        <div className={styles.pickerHead}>
          <span>Tag this call to an opportunity</span>
          <button type="button" className={styles.pickerClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.pickerBody}>
          {noOppsAtAll ? (
            <div className={styles.transcriptStatus}>
              No opps are loaded in this browser yet. Open the Opps 2 tab once and come back —
              that's what fills the local cache this picker reads.
            </div>
          ) : (
            <>
              {suggested.length > 0 && (
                <>
                  <div className={styles.pickerGroupLabel}>
                    Active opps for {company}
                  </div>
                  {suggested.map(o => (
                    <button
                      key={o.raw?._id}
                      type="button"
                      className={styles.pickerOption}
                      onClick={() => onPick(o.raw)}
                    >{oppLabel(o.raw)}</button>
                  ))}
                </>
              )}
              <div className={styles.pickerGroupLabel}>
                {suggested.length > 0 ? 'Or search every active opp' : 'Search active opps'}
              </div>
              <input
                className={styles.input}
                style={{ width: '100%', marginBottom: '0.5rem' }}
                type="text"
                placeholder="Search by account, stage, or scope…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoFocus={suggested.length === 0}
              />
              {query.trim() && matches.length === 0 && (
                <div className={styles.transcriptStatus}>No active opp matches “{query}”.</div>
              )}
              {matches.map(o => (
                <button
                  key={o.raw?._id}
                  type="button"
                  className={styles.pickerOption}
                  onClick={() => onPick(o.raw)}
                >{oppLabel(o.raw)}</button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Seconds → m:ss, for the jump-to links on transcript search results.
function fmtClock(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return '';
  const s = Math.max(0, Math.round(Number(sec)));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function CallRecordingsView({ prospects = [], settings = {}, updateSettings, onSelectProspect }) {
  const { user } = useAuth();
  // 'onedrive' | 'local'. Local reads a folder on this computer and needs
  // no Microsoft account at all.
  const [source, setSource] = useState(settings.callRecordingsSource || 'onedrive');
  const [connected, setConnected] = useState(false);
  const [checkedConnection, setCheckedConnection] = useState(false);
  // Local-folder state.
  const [folderHandle, setFolderHandle] = useState(null);
  const [folderName, setFolderName] = useState('');
  const [needsPermission, setNeedsPermission] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const fileInputRef = useRef(null);
  // itemId -> object URL, created on play and revoked when the player
  // closes. Without the revoke a few 200 MB recordings would sit in
  // memory for the life of the page.
  const objectUrls = useRef({});
  const [folder, setFolder] = useState(settings.callRecordingsFolder || DEFAULT_FOLDER);
  const [folderDraft, setFolderDraft] = useState(settings.callRecordingsFolder || DEFAULT_FOLDER);
  const [recordings, setRecordings] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(null);       // item id with an open player
  const [pickerFor, setPickerFor] = useState(null);   // item id awaiting a company
  const [oppPickerFor, setOppPickerFor] = useState(null); // item id awaiting an opp
  // itemId -> { status, text, utterances, error, id }
  const [transcripts, setTranscripts] = useState({});
  const pollTimers = useRef({});

  // recordingId -> stored record (transcript, summary, company/opp tag),
  // hydrated from Firestore and written back on every change. See
  // utils/callRecordingsStore.js for the shape.
  const [records, setRecords] = useState({});
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  // Active opps, read once from the Opps 2 cache the Opps tab fills.
  const [oppsIndex, setOppsIndex] = useState(null);
  // Per-recording in-flight flags and messages for the AI actions.
  const [busy, setBusy] = useState({});      // id -> 'summarizing' | 'pushing' | ''
  const [actionError, setActionError] = useState({}); // id -> message
  // id -> { question, answer, findings, loading, error }
  const [search, setSearch] = useState({});
  // id -> the <audio>/<video> element, so a search result can seek it.
  const mediaRefs = useRef({});

  // Write the AI summary into the tagged opp automatically instead of
  // waiting for the "Push to opp" button. Off by default — AI text
  // editing pipeline data unreviewed should be a deliberate choice.
  const autoPush = settings.callRecordingsAutoPush === true;

  const uid = user?.uid || null;

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

  // ---- local folder --------------------------------------------------------
  const readLocalFolder = useCallback(async (handle) => {
    setError('');
    setLoading(true);
    try {
      const { recordings: found, skipped: skip, truncated: cut } = await listFolderRecordings(handle);
      setRecordings(found);
      setSkipped(skip);
      setTruncated(cut);
    } catch (err) {
      setError(err?.message || String(err));
      setRecordings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  async function chooseFolder() {
    try {
      const handle = await pickFolder();
      setFolderHandle(handle);
      setFolderName(handle.name);
      setNeedsPermission(false);
      readLocalFolder(handle);
    } catch (err) {
      // AbortError = the user closed the picker; not worth an error banner.
      if (err?.name !== 'AbortError') setError(err?.message || String(err));
    }
  }

  // A handle restored from IndexedDB comes back needing permission again;
  // re-granting has to happen inside a user gesture, hence the button.
  async function regrantFolder() {
    if (!folderHandle) return;
    const state = await folderPermission(folderHandle, { request: true });
    if (state === 'granted') {
      setNeedsPermission(false);
      readLocalFolder(folderHandle);
    } else {
      setError('Permission to read that folder was declined. Choose the folder again to continue.');
    }
  }

  async function forgetFolder() {
    await forgetFolderHandle();
    setFolderHandle(null);
    setFolderName('');
    setNeedsPermission(false);
    setRecordings([]);
  }

  function onFolderInput(e) {
    const { recordings: found, skipped: skip, truncated: cut } = recordsFromFileList(e.target.files);
    const first = e.target.files?.[0];
    setFolderName(first?.webkitRelativePath?.split('/')[0] || 'Selected files');
    setRecordings(found);
    setSkipped(skip);
    setTruncated(cut);
    setError('');
  }

  function switchSource(next) {
    setSource(next);
    updateSettings?.({ callRecordingsSource: next });
    setRecordings([]);
    setSkipped(0);
    setTruncated(false);
    setError('');
    setPlaying(null);
  }

  // Initial load. OneDrive: check for a live token and pull the configured
  // folder. Local: restore the remembered folder handle, and list it
  // straight away when permission survived.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (source === 'local') {
        setCheckedConnection(true);
        if (!supportsDirectoryPicker()) return;
        const handle = await loadFolderHandle();
        if (cancelled || !handle) return;
        setFolderHandle(handle);
        setFolderName(handle.name);
        const state = await folderPermission(handle);
        if (cancelled) return;
        if (state === 'granted') readLocalFolder(handle);
        else setNeedsPermission(true);
        return;
      }
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
  }, [getToken, source, readLocalFolder]);

  // Release every object URL on unmount.
  useEffect(() => {
    const urls = objectUrls.current;
    return () => { for (const u of Object.values(urls)) URL.revokeObjectURL(u); };
  }, []);

  // The URL an <audio>/<video> plays from: OneDrive's pre-authenticated
  // link, or a blob URL minted from the local File.
  function mediaUrlFor(rec) {
    if (!rec.isLocal) return rec.downloadUrl;
    if (!objectUrls.current[rec.id]) {
      objectUrls.current[rec.id] = URL.createObjectURL(rec.file);
    }
    return objectUrls.current[rec.id];
  }

  function togglePlay(rec) {
    setPlaying(prev => {
      if (prev === rec.id) {
        const url = objectUrls.current[rec.id];
        if (url) { URL.revokeObjectURL(url); delete objectUrls.current[rec.id]; }
        return null;
      }
      return rec.id;
    });
  }

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

  // ---- stored records ------------------------------------------------------
  // Always-current view of `records` so the persist helper below stays
  // referentially stable (it's a dependency of the transcript polling).
  const recordsRef = useRef({});
  recordsRef.current = records;

  // Hydrate the stored transcripts / summaries / tags, then fold in any
  // company links left over from when they lived in user settings.
  useEffect(() => {
    // Clear first so a signed-in user never sees the previous account's
    // records in the gap before theirs arrive.
    setRecords({});
    setRecordsLoaded(false);
    if (!uid) return undefined;
    let cancelled = false;
    (async () => {
      const stored = await loadCallRecords(uid);
      if (cancelled) return;
      // Anything tagged or transcribed while this read was in flight has
      // already been written to Firestore, but isn't in `stored` — so
      // state wins on conflict rather than being clobbered by it.
      setRecords(prev => ({ ...stored, ...prev }));
      setRecordsLoaded(true);
      const legacy = settings.callRecordingLinks;
      if (legacy && Object.keys(legacy).length > 0) {
        const migrated = await migrateSettingsLinks(uid, legacy, stored);
        if (cancelled || migrated === 0) return;
        const refreshed = await loadCallRecords(uid);
        if (!cancelled) setRecords(prev => ({ ...refreshed, ...prev }));
      }
    })();
    return () => { cancelled = true; };
    // The legacy links are a one-time input: re-running when they change
    // would re-migrate links the user has since removed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Active opps for the picker, from the same IndexedDB cache the Opps 2
  // tab writes. Null until loaded; an empty index means the tab hasn't
  // been opened in this browser yet, which the picker explains.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cache = await loadOppsFromCache();
      if (cancelled) return;
      setOppsIndex(buildActiveOppsIndex(cache?.records || []));
    })();
    return () => { cancelled = true; };
  }, [uid]);

  // Metadata worth storing alongside the transcript so a record still
  // describes its recording when the folder isn't connected.
  function metaFor(rec) {
    return {
      source: rec.isLocal ? 'local' : 'onedrive',
      name: rec.name || '',
      path: rec.path || '',
      recordedAt: rec.modified || rec.created || null,
      durationSeconds: rec.durationSeconds ?? null,
    };
  }

  // Merge a patch into one stored record and save it. Updates state
  // optimistically so the UI never waits on Firestore, then reconciles
  // with what was actually written.
  const persist = useCallback(async (recordingId, patch) => {
    const id = String(recordingId);
    const base = recordsRef.current[id] || null;
    setRecords(r => ({ ...r, [id]: { ...(r[id] || {}), ...patch, id } }));
    const saved = await saveCallRecord(uid, id, patch, base);
    if (saved) setRecords(r => ({ ...r, [id]: saved }));
    return saved;
  }, [uid]);

  function setBusyFor(id, value) {
    setBusy(b => ({ ...b, [id]: value }));
  }

  function setErrorFor(id, message) {
    setActionError(e => ({ ...e, [id]: message || '' }));
  }

  // ---- company + opportunity tagging ---------------------------------------
  function linkTo(recordingId, prospect) {
    const rec = recordings.find(r => r.id === recordingId);
    persist(recordingId, {
      ...(rec ? metaFor(rec) : {}),
      prospectId: prospect.id,
      company: prospect.company,
    });
    setPickerFor(null);
  }

  function unlink(recordingId) {
    // Dropping the company drops the opp too: an opp tag is only
    // meaningful under the company it belongs to.
    persist(recordingId, { prospectId: '', company: '', oppId: '', oppLabel: '' });
  }

  function tagOpp(recordingId, opp) {
    const rec = recordings.find(r => r.id === recordingId);
    persist(recordingId, {
      ...(rec ? metaFor(rec) : {}),
      oppId: String(opp?._id || ''),
      oppLabel: oppLabel(opp),
      // Tagging an opp for a recording with no company yet adopts the
      // opp's account, so the two tags can't contradict each other.
      ...(recordsRef.current[recordingId]?.company ? {} : { company: String(opp?.Account || '').trim() }),
    });
    setOppPickerFor(null);
  }

  function untagOpp(recordingId) {
    persist(recordingId, { oppId: '', oppLabel: '' });
  }

  async function forgetRecord(recordingId) {
    if (!window.confirm('Delete the stored transcript, summary, and tags for this recording? The recording file itself is not touched.')) return;
    await deleteCallRecord(uid, recordingId);
    setRecords(r => {
      const next = { ...r };
      delete next[recordingId];
      return next;
    });
    setTranscripts(t => {
      const next = { ...t };
      delete next[recordingId];
      return next;
    });
  }

  // ---- summarize -----------------------------------------------------------
  const pushSummaryToOpp = useCallback(async (recordingId, record) => {
    const oppId = record?.oppId;
    if (!oppId) throw new Error('Tag this call to an opportunity first.');
    const block = summaryForOpp(record);
    if (!block) throw new Error('Nothing to push — summarize the call first.');

    // Read the opp's current Notes so the summary is appended to the
    // user's own text rather than replacing it.
    const cache = await loadOppsFromCache();
    const opp = (cache?.records || []).find(r => String(r?._id) === String(oppId));
    if (!opp) throw new Error('That opp is no longer in the Opps cache — open the Opps 2 tab and try again.');

    await setOppField(uid, oppId, 'Notes', mergeIntoNotes(opp['Notes'], block, recordingId));
    // "Last Spoke" is the date the call happened, not today — a call
    // transcribed a week late shouldn't read as a fresh conversation.
    const when = record?.recordedAt ? new Date(record.recordedAt) : null;
    if (when && !Number.isNaN(when.getTime())) {
      const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
      await setOppField(uid, oppId, 'Last Spoke', stamp);
    }
    return persist(recordingId, { pushedToOppAt: new Date().toISOString() });
  }, [uid, persist]);

  async function summarize(rec) {
    const id = rec.id;
    const stored = recordsRef.current[id] || {};
    const live = transcripts[id];
    const transcript = (live?.status === 'completed' ? live.text : '') || stored.transcript || '';
    if (!transcript.trim()) {
      setErrorFor(id, 'Transcribe this recording first — there is nothing to summarize.');
      return;
    }
    setErrorFor(id, '');
    setBusyFor(id, 'summarizing');
    try {
      const r = await apiFetch('/api/call-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          company: stored.company || '',
          oppContext: stored.oppLabel || '',
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErrorFor(id, data.error || `Summary failed (HTTP ${r.status})`);
        return;
      }
      const saved = await persist(id, {
        ...metaFor(rec),
        summary: data.summary || '',
        keyItems: data.keyItems || [],
        followUps: data.followUps || [],
        nextSteps: data.nextSteps || '',
        sentiment: data.sentiment || '',
        risks: data.risks || [],
        summarizedAt: new Date().toISOString(),
        summaryClipped: !!data.clipped,
      });
      // Auto-push is opt-in; a failure here is reported but never
      // discards the summary that was just saved.
      if (autoPush && saved?.oppId) {
        try {
          await pushSummaryToOpp(id, saved);
        } catch (err) {
          setErrorFor(id, `Summary saved, but the push to the opp failed: ${err?.message || err}`);
        }
      }
    } catch (err) {
      setErrorFor(id, err?.message || String(err));
    } finally {
      setBusyFor(id, '');
    }
  }

  async function pushToOpp(rec) {
    const id = rec.id;
    setErrorFor(id, '');
    setBusyFor(id, 'pushing');
    try {
      await pushSummaryToOpp(id, recordsRef.current[id]);
    } catch (err) {
      setErrorFor(id, err?.message || String(err));
    } finally {
      setBusyFor(id, '');
    }
  }

  // ---- transcript topic search ---------------------------------------------
  async function runSearch(rec, question) {
    const id = rec.id;
    const q = String(question || '').trim();
    if (!q) return;
    const stored = recordsRef.current[id] || {};
    const live = transcripts[id];
    const transcript = (live?.status === 'completed' ? live.text : '') || stored.transcript || '';
    const utterances = (live?.status === 'completed' ? live.utterances : null) || stored.utterances || [];
    if (!transcript.trim() && utterances.length === 0) {
      setSearch(s => ({ ...s, [id]: { ...(s[id] || {}), question: q, error: 'Transcribe this recording first.' } }));
      return;
    }
    setSearch(s => ({ ...s, [id]: { question: q, loading: true, answer: '', findings: [], error: '' } }));
    try {
      const r = await apiFetch('/api/call-transcript-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, utterances, question: q }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSearch(s => ({ ...s, [id]: { question: q, loading: false, error: data.error || `Search failed (HTTP ${r.status})` } }));
        return;
      }
      setSearch(s => ({
        ...s,
        [id]: {
          question: q,
          loading: false,
          error: '',
          answer: data.answer || '',
          findings: data.findings || [],
          hasTimestamps: !!data.hasTimestamps,
          truncated: !!data.truncated,
        },
      }));
    } catch (err) {
      setSearch(s => ({ ...s, [id]: { question: q, loading: false, error: err?.message || String(err) } }));
    }
  }

  // Open the player (if closed) and seek it to a search result. The
  // element mounts on the next render when the player was closed, so the
  // seek is deferred until the ref exists.
  function seekTo(rec, seconds) {
    if (seconds == null) return;
    const apply = () => {
      const el = mediaRefs.current[rec.id];
      if (!el) return false;
      try {
        el.currentTime = Math.max(0, Number(seconds));
        el.play?.().catch(() => { /* autoplay blocked — the seek still landed */ });
      } catch { /* element not ready for seeking yet */ }
      return true;
    };
    if (playing === rec.id && apply()) return;
    setPlaying(rec.id);
    // Two frames: one for the player to mount, one for the media element
    // to have metadata far enough along to accept a seek.
    requestAnimationFrame(() => requestAnimationFrame(() => { apply(); }));
  }

  // ---- transcription -------------------------------------------------------
  const pollTranscript = useCallback(async (recordingId, transcriptId) => {
    try {
      const r = await apiFetch(`/api/onedrive-transcribe?id=${encodeURIComponent(transcriptId)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const message = data.error || `HTTP ${r.status}`;
        setTranscripts(t => ({ ...t, [recordingId]: { status: 'error', error: message } }));
        persist(recordingId, { transcriptStatus: 'error', transcriptError: message });
        return;
      }
      setTranscripts(t => ({ ...t, [recordingId]: { ...data, id: transcriptId } }));
      if (data.status === 'queued' || data.status === 'processing') {
        pollTimers.current[recordingId] = setTimeout(() => pollTranscript(recordingId, transcriptId), POLL_MS);
        return;
      }
      if (data.status === 'completed') {
        // The transcript is the expensive artifact — save it the moment
        // it lands, so closing the tab mid-session can't lose a job the
        // user has already paid for.
        persist(recordingId, {
          transcriptId,
          transcriptStatus: 'completed',
          transcript: data.text || '',
          utterances: data.utterances || [],
          transcriptError: '',
          transcribedAt: new Date().toISOString(),
          ...(data.audioDuration ? { durationSeconds: Math.round(data.audioDuration) } : {}),
        });
      } else if (data.status === 'error') {
        persist(recordingId, { transcriptStatus: 'error', transcriptError: data.error || 'Transcription failed' });
      }
    } catch (err) {
      const message = err?.message || String(err);
      setTranscripts(t => ({ ...t, [recordingId]: { status: 'error', error: message } }));
      persist(recordingId, { transcriptStatus: 'error', transcriptError: message });
    }
  }, [persist]);

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
      persist(recording.id, {
        ...metaFor(recording),
        transcriptId: data.id,
        transcriptStatus: data.status || 'queued',
        transcriptError: '',
      });
      pollTranscript(recording.id, data.id);
    } catch (err) {
      setTranscripts(t => ({ ...t, [recording.id]: { status: 'error', error: err?.message || String(err) } }));
    }
  }

  const pickerRecording = pickerFor ? recordings.find(r => r.id === pickerFor) : null;
  const oppPickerRecording = oppPickerFor ? recordings.find(r => r.id === oppPickerFor) : null;

  // The fallback <input webkitdirectory> path never produces a handle, so
  // "have we been pointed at a folder yet?" is handle-or-name, not handle.
  const hasLocalSelection = !!folderHandle || !!folderName;

  // Which empty state (if any) stands in for the recording list. Returning
  // null here means "render the cards".
  const emptyState = (() => {
    if (loading || recordings.length > 0) return null;
    if (source === 'local') {
      if (!hasLocalSelection) {
        return (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Pick the folder your recordings are in</span>
            Anything on this machine works — Desktop, Documents, or the OneDrive folder your PC already syncs.
            The files are read straight from disk and played here; nothing is uploaded and nothing is copied.
            {supportsDirectoryPicker()
              ? ' Chrome and Edge remember the folder, so you only pick it once.'
              : ' This browser can’t remember the folder, so you’ll pick it each visit — Chrome or Edge can remember it.'}
          </div>
        );
      }
      if (needsPermission || error) return null;
      return (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>Nothing to play in {folderName || 'that folder'}</span>
          {skipped > 0
            ? `Found ${skipped} file${skipped === 1 ? '' : 's'}, but none are audio or video.`
            : 'That folder (and its subfolders, three deep) has no media files in it.'}
        </div>
      );
    }
    if (!connected) {
      return checkedConnection ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>Connect your personal OneDrive</span>
          You’ll be asked to sign in with Microsoft and grant read-only access to your files
          (<code>Files.Read</code>). Pick your <strong>personal</strong> account on the sign-in screen —
          the work account is the one Outlook already uses.
        </div>
      ) : null;
    }
    if (error) return null;
    return (
      <div className={styles.empty}>
        <span className={styles.emptyTitle}>Nothing to play in {folder}</span>
        {skipped > 0
          ? `The folder exists and holds ${skipped} file${skipped === 1 ? '' : 's'}, but none are audio or video.`
          : 'The folder is empty. Check the path above — it’s case-sensitive and relative to your OneDrive root.'}
      </div>
    );
  })();

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Call Recordings</h1>
          <div className={styles.subtitle}>
            {source === 'local'
              ? 'Recordings from a folder on this computer. Nothing is uploaded — the files are read and played locally, and only the company link is saved.'
              : 'Recordings from a folder in your personal OneDrive. This connection is separate from the work Outlook one — signing in here doesn’t touch your calendar or mail integration.'}
          </div>
        </div>
        <div className={styles.toolbar}>
          <label
            className={styles.autoPush}
            title="When on, a finished summary is written straight into the tagged opp's Notes without waiting for the Push button."
          >
            <input
              type="checkbox"
              checked={autoPush}
              onChange={e => updateSettings?.({ callRecordingsAutoPush: e.target.checked })}
            />
            Auto-push summaries to opps
          </label>
          <span className={styles.sourceToggle}>
            <button
              type="button"
              className={source === 'onedrive' ? styles.sourceOn : styles.sourceOff}
              onClick={() => switchSource('onedrive')}
            >OneDrive</button>
            <button
              type="button"
              className={source === 'local' ? styles.sourceOn : styles.sourceOff}
              onClick={() => switchSource('local')}
            >This computer</button>
          </span>
          {source === 'onedrive' ? (
            <>
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
            </>
          ) : (
            recordings.length > 0 && folderHandle && (
              <button type="button" className={styles.btn} onClick={() => readLocalFolder(folderHandle)} disabled={loading}>
                {loading ? 'Reading…' : 'Refresh'}
              </button>
            )
          )}
        </div>
      </div>

      {source === 'onedrive' ? (
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
      ) : (
        <div className={styles.controls}>
          <span className={styles.fieldLabel}>Folder</span>
          {supportsDirectoryPicker() ? (
            <>
              <button type="button" className={styles.btnPrimary} onClick={chooseFolder}>
                {folderHandle ? 'Choose a different folder' : 'Choose folder…'}
              </button>
              {folderHandle && (
                <>
                  <span className={styles.connected} title="Remembered — this folder reopens next time you visit">
                    📁 {folderName}
                  </span>
                  <button type="button" className={styles.btn} onClick={forgetFolder}>Forget folder</button>
                </>
              )}
            </>
          ) : (
            <>
              {/* Safari / Firefox have no directory picker, so fall back to
                  a folder-scoped file input. No persistence is possible. */}
              <button type="button" className={styles.btnPrimary} onClick={() => fileInputRef.current?.click()}>
                Choose folder…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                style={{ display: 'none' }}
                onChange={onFolderInput}
              />
              {folderName && <span className={styles.connected}>📁 {folderName}</span>}
            </>
          )}
          <span className={styles.transcriptStatus}>
            Any folder on this machine — Desktop, Documents, a synced OneDrive folder. Subfolders are included.
          </span>
        </div>
      )}

      <div className={styles.body}>
        {error && <div className={styles.error}>{error}</div>}
        {/* Tags and stored transcripts land a beat after the file list,
            so say so rather than letting a tagged call look untagged. */}
        {uid && !recordsLoaded && recordings.length > 0 && (
          <div className={styles.transcriptStatus} style={{ marginBottom: '0.6rem' }}>
            Loading saved transcripts and tags…
          </div>
        )}
        {truncated && (
          <div className={styles.notice}>
            Showing the first 500 recordings found. Point at a narrower folder to see the rest.
          </div>
        )}
        {source === 'local' && needsPermission && (
          <div className={styles.notice}>
            <strong>{folderName}</strong> is remembered, but the browser needs your permission again to read it
            this session.{' '}
            <button type="button" className={styles.btn} onClick={regrantFolder}>Reconnect folder</button>
          </div>
        )}

        {emptyState || (
          recordings.map(rec => {
            const stored = records[rec.id] || null;
            const tr = transcripts[rec.id];
            const video = isVideo(rec);
            const meta = [
              fmtWhen(rec.modified || rec.created),
              fmtDuration(rec.durationSeconds ?? stored?.durationSeconds),
              fmtSize(rec.size),
            ].filter(Boolean).join(' · ');

            // The live job (this session) wins over the stored copy, so a
            // re-transcribe shows its progress instead of the old text.
            const transcriptText = (tr?.status === 'completed' ? tr.text : '') || stored?.transcript || '';
            const utterances = (tr?.status === 'completed' ? tr.utterances : null) || stored?.utterances || [];
            const hasTranscript = !!transcriptText || utterances.length > 0;
            const inFlight = tr && (tr.status === 'starting' || tr.status === 'queued' || tr.status === 'processing');
            const state = busy[rec.id] || '';
            const problem = actionError[rec.id] || '';
            const found = search[rec.id];
            const company = stored?.company || '';

            return (
              <div key={rec.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.name} title={rec.name}>{rec.name}</span>
                  <span className={styles.meta}>{meta}</span>
                  {company && (
                    <span
                      className={styles.linkChip}
                      title={`Linked to ${company} — click to open the company`}
                      onClick={() => {
                        const p = prospects.find(x => x?.id === stored.prospectId);
                        if (p) onSelectProspect?.(p);
                      }}
                    >{company}</span>
                  )}
                  {stored?.oppId && (
                    <span
                      className={styles.oppChip}
                      title={`Tagged to ${stored.oppLabel || 'an opportunity'}`}
                    >◆ {stored.oppLabel || 'Opportunity'}</span>
                  )}
                  <span className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => togglePlay(rec)}
                    >{playing === rec.id ? 'Hide player' : '▶ Play'}</button>
                    {/* A local file is already on disk — there is nothing
                        to download, so the button only appears for OneDrive. */}
                    {!rec.isLocal && (
                      <a className={styles.btn} href={rec.downloadUrl} download={rec.name} target="_blank" rel="noopener noreferrer">⬇ Download</a>
                    )}
                    <button type="button" className={styles.btn} onClick={() => setPickerFor(rec.id)}>
                      {company ? 'Change company' : 'Link to company'}
                    </button>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => setOppPickerFor(rec.id)}
                      title="Tag this call to an opportunity so its summary can be pushed onto the deal"
                    >{stored?.oppId ? 'Change opp' : 'Tag to opp'}</button>
                    {stored?.oppId && (
                      <button type="button" className={styles.btn} onClick={() => untagOpp(rec.id)} title="Remove the opportunity tag">Untag opp</button>
                    )}
                    {company && (
                      <button type="button" className={styles.btn} onClick={() => unlink(rec.id)} title={`Remove the link to ${company}`}>Unlink</button>
                    )}
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => transcribe(rec)}
                      disabled={rec.isLocal || inFlight}
                      title={rec.isLocal
                        ? 'Transcription needs the file reachable by a URL, which a file on your computer is not. Only OneDrive-sourced recordings can be transcribed today.'
                        : undefined}
                    >
                      {hasTranscript ? 'Re-transcribe' : 'Transcribe'}
                    </button>
                    {hasTranscript && (
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => summarize(rec)}
                        disabled={state === 'summarizing'}
                      >{state === 'summarizing' ? 'Summarizing…' : stored?.summarizedAt ? 'Re-summarize' : '✨ Summarize'}</button>
                    )}
                    {stored?.summarizedAt && stored?.oppId && (
                      <button
                        type="button"
                        className={styles.btnPrimary}
                        onClick={() => pushToOpp(rec)}
                        disabled={state === 'pushing'}
                        title={`Append this summary to the Notes on ${stored.oppLabel || 'the tagged opp'}`}
                      >{state === 'pushing' ? 'Pushing…' : stored.pushedToOppAt ? 'Push again' : '→ Push to opp'}</button>
                    )}
                    {stored && (
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => forgetRecord(rec.id)}
                        title="Delete the stored transcript, summary, and tags for this recording"
                      >Forget</button>
                    )}
                  </span>
                </div>

                {problem && <div className={styles.error} style={{ margin: '0 0 0.5rem' }}>{problem}</div>}
                {stored?.pushedToOppAt && (
                  <div className={styles.pushedNote}>
                    Pushed to {stored.oppLabel || 'the opp'} on {fmtWhen(stored.pushedToOppAt)}.
                  </div>
                )}

                {playing === rec.id && (
                  <div className={styles.player}>
                    {video
                      ? <video ref={el => { mediaRefs.current[rec.id] = el; }} src={mediaUrlFor(rec)} controls preload="metadata" />
                      : <audio ref={el => { mediaRefs.current[rec.id] = el; }} src={mediaUrlFor(rec)} controls preload="metadata" />}
                  </div>
                )}

                {/* ---- AI summary ---- */}
                {stored?.summarizedAt && (
                  <div className={styles.summary}>
                    <div className={styles.summaryHead}>
                      <span className={styles.summaryTitle}>Call summary</span>
                      {stored.sentiment && (
                        <span className={styles.sentiment} data-tone={stored.sentiment}>{stored.sentiment}</span>
                      )}
                      <span className={styles.meta}>{fmtWhen(stored.summarizedAt)}</span>
                    </div>
                    {stored.summaryClipped && (
                      <div className={styles.notice} style={{ margin: '0 0 0.5rem' }}>
                        This call was long enough that the middle was left out of the summary — the opening and
                        the close were both included.
                      </div>
                    )}
                    {stored.summary && <p className={styles.summaryBody}>{stored.summary}</p>}
                    {stored.nextSteps && (
                      <p className={styles.summaryBody}><strong>Next step:</strong> {stored.nextSteps}</p>
                    )}
                    {stored.keyItems?.length > 0 && (
                      <>
                        <div className={styles.summaryLabel}>Key items</div>
                        <ul className={styles.summaryList}>
                          {stored.keyItems.map((k, i) => <li key={i}>{k}</li>)}
                        </ul>
                      </>
                    )}
                    {stored.followUps?.length > 0 && (
                      <>
                        <div className={styles.summaryLabel}>Follow-ups</div>
                        <ul className={styles.summaryList}>
                          {stored.followUps.map((f, i) => (
                            <li key={i}>
                              {f.text}
                              {f.owner && <span className={styles.followMeta}> — {f.owner}</span>}
                              {f.due && <span className={styles.followMeta}> ({f.due})</span>}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {stored.risks?.length > 0 && (
                      <>
                        <div className={styles.summaryLabel}>Risks</div>
                        <ul className={styles.summaryList}>
                          {stored.risks.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      </>
                    )}
                  </div>
                )}

                {/* ---- transcript topic search ---- */}
                {hasTranscript && (
                  <div className={styles.searchBox}>
                    <form
                      className={styles.searchRow}
                      onSubmit={(e) => {
                        e.preventDefault();
                        runSearch(rec, new FormData(e.currentTarget).get('q'));
                      }}
                    >
                      <input
                        className={styles.input}
                        name="q"
                        type="text"
                        placeholder="Ask this call a question — “what did they say about pricing?”"
                        defaultValue={found?.question || ''}
                      />
                      <button type="submit" className={styles.btn} disabled={found?.loading}>
                        {found?.loading ? 'Searching…' : 'Search'}
                      </button>
                    </form>
                    {found?.error && <div className={styles.error} style={{ margin: '0.5rem 0 0' }}>{found.error}</div>}
                    {found?.answer && <p className={styles.summaryBody}>{found.answer}</p>}
                    {found?.findings?.map((f, i) => (
                      <div key={i} className={styles.finding}>
                        {f.startSec != null ? (
                          <button
                            type="button"
                            className={styles.timeLink}
                            onClick={() => seekTo(rec, f.startSec)}
                            title="Jump the player to this moment"
                          >{fmtClock(f.startSec)}</button>
                        ) : <span className={styles.timeLink} data-disabled="true">–:––</span>}
                        <span>
                          <span className={styles.quote}>“{f.quote}”</span>
                          {f.note && <span className={styles.findingNote}>{f.note}</span>}
                        </span>
                      </div>
                    ))}
                    {found && !found.loading && !found.error && found.findings?.length === 0 && (
                      <div className={styles.transcriptStatus}>Nothing in this call addresses that.</div>
                    )}
                    {found?.findings?.length > 0 && !found.hasTimestamps && (
                      <div className={styles.transcriptStatus}>
                        This transcript has no speaker turns, so these moments have no timestamps to jump to.
                      </div>
                    )}
                  </div>
                )}

                {(tr || hasTranscript) && (
                  <div className={styles.transcript}>
                    {tr?.status === 'error' ? (
                      <div className={styles.error} style={{ margin: 0 }}>{tr.error}</div>
                    ) : inFlight ? (
                      <div className={styles.transcriptStatus}>
                        {tr.status === 'starting' ? 'Sending to the transcription service…'
                          : tr.status === 'queued' ? 'Queued — transcription usually takes a fraction of the recording’s length.'
                          : 'Transcribing…'}
                      </div>
                    ) : utterances.length ? (
                      utterances.map((u, i) => (
                        <div key={i} className={styles.utterance}>
                          <span className={styles.speaker}>Speaker {u.speaker}</span>
                          <span>{u.text}</span>
                        </div>
                      ))
                    ) : transcriptText ? (
                      <div>{transcriptText}</div>
                    ) : (
                      <div className={styles.transcriptStatus}>The transcription came back empty — there may be no speech in this file.</div>
                    )}
                    {stored?.utterancesDropped && utterances.length === 0 && transcriptText && (
                      <div className={styles.transcriptStatus}>
                        This transcript was too long to store its speaker turns — the text above is the whole
                        call, but jump-to-moment links aren’t available for it.
                      </div>
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

      {oppPickerRecording && (
        <OppPicker
          oppsIndex={oppsIndex}
          company={records[oppPickerRecording.id]?.company || ''}
          onPick={o => tagOpp(oppPickerRecording.id, o)}
          onClose={() => setOppPickerFor(null)}
        />
      )}
    </div>
  );
}

export default CallRecordingsView;
