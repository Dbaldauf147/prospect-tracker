// Call Recordings — the record of what was said on every call, tagged to
// the company and the opportunity it belongs to.
//
// Three sources feed it, and they are not equals:
//
//   Granola (primary) — the AI notetaker sits in the meeting and hands
//     over a note that is ALREADY transcribed and summarised. There is no
//     file: a synced call is text from the moment it lands, so it can be
//     tagged, summarised, and pushed onto an opp without waiting on a
//     transcription job. This is the default source and where call data
//     is meant to come from.
//
//   OneDrive / this computer — the older media-first paths, kept for
//     calls Granola wasn't in: a dialer recording, a forwarded file. They
//     list audio, play it, and have to transcribe before any of the rest
//     of the page can do anything with it.
//
// All three converge on the same stored record (callRecordingsStore.js),
// so tagging, the AI summary, transcript search, and the push onto an
// opp are written once and work whatever the call came from.
//
// Connection model for OneDrive: this deliberately uses its own Microsoft sign-in
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
  loadCallRecords, loadCallRecordsResult, saveCallRecordResult, deleteCallRecordResult, migrateSettingsLinks,
  oppLabel, summaryForOpp, mergeIntoNotes,
} from '../../utils/callRecordingsStore';
import {
  probeGranola, syncGranolaCalls, recordPatchFor, recordingFromStored,
  matchCompanyForCall, daysAgoIso, describeMissingKey, diagnoseEmptySync, DEFAULT_BACKFILL_DAYS,
} from '../../utils/granolaCalls';
import { talkTimeSplit, talkTimeSides, formatShare, formatTalkValue } from '../../utils/talkTime';
import {
  callHistoryRows, filterHistoryRows, historyTotals, STAGE_LABELS,
  cacheableHistoryRows, shouldReplaceCache,
} from '../../utils/callHistory';
import { loadCallHistoryCache, saveCallHistoryCache } from '../../utils/callHistoryCache';
import { describeReadFailure, describeWriteFailure, describeDeleteFailure } from '../../utils/callStoreError';
import {
  callBreakdownRows, filterBreakdownRows, breakdownAverages,
} from '../../utils/callBreakdown';
import { DataTable } from '../common/DataTable';
import { buildCompanyGuessIndex } from '../../utils/companyGuess';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { buildActiveOppsIndex, activeOppsForCompany } from '../../utils/targetAccountOpps';
import { setOppField } from '../../utils/opps2Store';
import {
  tagOppPatch, markOppNaPatch, clearOppTagPatch, oppTagStateOf, oppTagLabelOf,
  filterByOppTag, oppTagCounts, OPP_TAG_FILTERS,
} from '../../utils/callOppTag';
import styles from './CallRecordingsView.module.css';

const TOKEN_KEY = 'onedrive-access-token';
const REFRESH_KEY = 'onedrive-refresh-token';
const EXPIRY_KEY = 'onedrive-token-expiry';
const DEFAULT_FOLDER = '/Recordings';
// The subtabs, as a guard on the persisted setting: a value from an older
// build (or a hand-edited settings doc) must fall back to the card list
// rather than leaving the page rendering nothing.
const SUBTABS = new Set(['calls', 'history', 'breakdown']);
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
              No opps are loaded in this browser yet. Open the Opps 2 tab once and come back,
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

// How a transcript turn is labelled. AssemblyAI numbers its speakers
// ("A", "B"), which only reads as a person with the word in front;
// Granola names them ("You", "Them", "Rita Chen"), which doesn't.
function speakerName(label) {
  // Calls synced before the label fix have the literal "[object Object]"
  // stored as their speaker, from a Granola field that arrived as an
  // object and was stringified. Nothing can recover the real name from
  // that here — a re-sync does — but it should not be printed over every
  // turn in the meantime.
  const s = (label && typeof label === 'object') ? '' : String(label ?? '').trim();
  if (!s || s === '[object Object]') return 'Speaker ?';
  return /^[A-Za-z0-9]$/.test(s) ? `Speaker ${s}` : s;
}

// One call's talk-time breakdown, for the Breakdown subtab.
//
// The headline is deliberately two numbers and not a chart: "was that
// call me or them" is a single comparison, and a per-speaker chart makes
// the reader do the summing that the question is about. The speaker list
// under it is the detail behind those two numbers, in the same order the
// bar draws them.
function BreakdownDetail({ row }) {
  // Null whenever the transcript can't say which turns were the user's —
  // then the notice explains why instead of a bar implying it can.
  const sides = talkTimeSides(row.split);
  const speakers = row.split?.speakers || [];
  const basis = row.basis;
  const total = row.split?.total || 0;
  const meta = [fmtWhen(row.recordedAt), fmtDuration(row.durationSeconds), row.sourceLabel]
    .filter(Boolean).join(' · ');
  // "3:58 of 20:00", or "17 of 19 words" — the unit is said once, on the
  // total, so a words split still can't be mistaken for a clock.
  const ofTotal = value => (basis === 'words'
    ? `${Math.round(value).toLocaleString()} of ${formatTalkValue(total, basis)}`
    : `${formatTalkValue(value, basis)} of ${formatTalkValue(total, basis)}`);

  return (
    <>
      <div className={styles.breakdownHead}>
        <span className={styles.breakdownTitle} title={row.name}>{row.name}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </div>
      <div className={styles.breakdownChips}>
        {row.company && <span className={styles.linkChip} data-static="true">{row.company}</span>}
        {/* Titled because the chip truncates a long opp name. */}
        {row.oppLabel && <span className={styles.oppChip} title={row.oppLabel}>◆ {row.oppLabel}</span>}
        {row.attendees && (
          <span className={styles.meta} title={row.attendees}>with {row.attendees}</span>
        )}
        {row.granolaUrl && (
          <a className={styles.historyLink} href={row.granolaUrl} target="_blank" rel="noopener noreferrer">
            Open in Granola ↗
          </a>
        )}
      </div>

      {sides ? (
        <>
          <div className={styles.tiles}>
            <div className={styles.tile} data-you="true">
              <span className={styles.tileLabel}>You spoke</span>
              <span className={styles.tileValue}>{formatShare(sides.you.share)}</span>
              <span className={styles.tileSub}>
                {ofTotal(sides.you.value)}
                {sides.you.turns > 0 && ` · ${sides.you.turns} turn${sides.you.turns === 1 ? '' : 's'}`}
              </span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileLabel}>
                {sides.others.speakers === 1 ? 'They spoke' : 'Everyone else'}
              </span>
              <span className={styles.tileValue}>{formatShare(sides.others.share)}</span>
              <span className={styles.tileSub}>
                {sides.others.speakers === 0
                  ? 'Nobody else spoke on this transcript'
                  : <>
                      {ofTotal(sides.others.value)}
                      {` · ${sides.others.speakers} ${sides.others.speakers === 1 ? 'person' : 'people'}`}
                    </>}
              </span>
            </div>
          </div>

          {/* Two segments, not a stack of speakers: the bar is the same
              comparison the tiles state, drawn to scale. */}
          <div className={styles.sidesBar}>
            <div
              className={styles.sidesSegment}
              data-you="true"
              style={{ flexGrow: sides.you.share }}
              title={`You: ${formatShare(sides.you.share)}`}
            />
            <div
              className={styles.sidesSegment}
              style={{ flexGrow: sides.others.share }}
              title={`Everyone else: ${formatShare(sides.others.share)}`}
            />
          </div>
        </>
      ) : (
        <div className={styles.notice}>{row.blockedReason}</div>
      )}

      {/* Shown even when the user's own share is unknown: who spoke is
          still worth reading, and it is the evidence for the notice
          above it. */}
      {speakers.length > 0 && (
        <div className={styles.speakerList}>
          <div className={styles.breakdownLabel}>
            Speaker by speaker
            {basis === 'words'
              ? ' — share of words spoken'
              : ' — share of talking time'}
          </div>
          {speakers.map(s => (
            <div key={s.name} className={styles.speakerRow}>
              <span className={styles.speakerName} data-you={s.isYou ? 'true' : 'false'}>{s.name}</span>
              <span
                className={styles.speakerTrack}
                title={`${s.name}: ${formatShare(s.share)} of the call`}
              >
                <span
                  className={styles.speakerFill}
                  data-you={s.isYou ? 'true' : 'false'}
                  style={{ width: `${Math.max(s.share * 100, 0.6)}%` }}
                />
              </span>
              <span className={styles.speakerPct}>{formatShare(s.share)}</span>
              <span className={styles.speakerValue}>{formatTalkValue(s.value, basis)}</span>
              <span className={styles.speakerTurns}>
                {s.turns} turn{s.turns === 1 ? '' : 's'} · longest {formatTalkValue(s.longest, basis)}
              </span>
            </div>
          ))}
          {/* A words split is a different measurement, so it never passes
              silently as talk time. */}
          {basis === 'words' && (
            <div className={styles.breakdownCaveat}>
              This transcript carried no timings, so every share here is a share of words — someone who
              talks fast and says little will look quieter than they were.
            </div>
          )}
        </div>
      )}
    </>
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
  // 'granola' | 'onedrive' | 'local'. Granola is the default because it is
  // where call data is supposed to come from; the other two need a
  // Microsoft account or a folder on this particular machine.
  const [source, setSource] = useState(settings.callRecordingsSource || 'granola');
  // 'calls' is the card list, which shows what the ACTIVE source can see
  // right now. 'history' is every call ever stored, whatever it came from
  // and whether or not that source is still reachable. 'breakdown' picks
  // one stored call and reports who did the talking on it.
  const [tab, setTab] = useState(SUBTABS.has(settings.callRecordingsTab) ? settings.callRecordingsTab : 'calls');
  const [historyQuery, setHistoryQuery] = useState('');
  // Which triage pile the History table is showing: all / untagged /
  // tagged / na. Not persisted — it is how you are working through the
  // list right now, not a setting.
  const [oppTagFilter, setOppTagFilter] = useState('all');
  const [breakdownQuery, setBreakdownQuery] = useState('');
  // Which call the Breakdown subtab is showing. Empty means "the newest
  // one", resolved below against the filtered list rather than stored, so
  // a filter that hides the pick lands on a call that is actually there.
  const [breakdownPick, setBreakdownPick] = useState('');
  const [connected, setConnected] = useState(false);
  const [checkedConnection, setCheckedConnection] = useState(false);
  // Granola: { configured, ok, error, timedOut } from the probe, plus
  // sync state. `checking` is the probe being in flight — including a
  // re-check after one failed, which is why it isn't just
  // !checkedConnection. `probeRun` discards a probe whose answer arrived
  // after the source moved on, since `connected` is shared with OneDrive.
  const [granolaStatus, setGranolaStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const probeRun = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const autoSynced = useRef(false);
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
  // Whether the Firestore read actually worked. A failed read returns no
  // records, which is indistinguishable from having none — the History
  // tab needs to tell those apart before it decides what to show and
  // what to cache.
  const [recordsReadOk, setRecordsReadOk] = useState(true);
  const [recordsReadError, setRecordsReadError] = useState('');
  // Firestore's own code for that failure, kept beside the message
  // because it — not the prose — decides whether reloading can help.
  const [recordsReadCode, setRecordsReadCode] = useState('');
  // recordingId -> { error, code } for calls whose last write did NOT
  // reach Firestore. The change stays on screen (see `persist`), so this
  // is what stops it reading as saved. Not persisted anywhere: a reload
  // re-reads Firestore, and what it comes back with is the truth.
  const [unsaved, setUnsaved] = useState({});
  // The last history this browser drew, read back from IndexedDB. It is
  // what makes the tab fill in on refresh: it paints before Firestore
  // answers, and stands in for it when it doesn't.
  const [historyCache, setHistoryCache] = useState(null);
  const [historyCacheLoaded, setHistoryCacheLoaded] = useState(false);
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
    setSyncNote('');
  }

  // Ask the API whether Granola is configured and the key is live. Also
  // the handler behind "Check again": a probe that timed out says nothing
  // about Granola, so re-running it is the first thing to try.
  const checkGranola = useCallback(async () => {
    const run = probeRun.current + 1;
    probeRun.current = run;
    setChecking(true);
    const status = await probeGranola();
    // A newer probe (or a switch to another source) has taken over.
    if (probeRun.current !== run) return status;
    setGranolaStatus(status);
    setConnected(!!(status.configured && status.ok));
    setCheckedConnection(true);
    setChecking(false);
    return status;
  }, []);

  // Initial load. Granola: probe the API (the calls themselves come from
  // the stored records, so the list is already on screen). OneDrive:
  // check for a live token and pull the configured folder. Local: restore
  // the remembered folder handle, and list it straight away when
  // permission survived.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (source === 'granola') {
        checkGranola();
        return;
      }
      // Leaving Granola: drop any probe still in flight, so its answer
      // can't overwrite this source's connection state.
      probeRun.current += 1;
      setChecking(false);
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
  }, [getToken, source, readLocalFolder, checkGranola]);

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
    // A different account gets its own first-visit Granola sync.
    autoSynced.current = false;
    if (!uid) return undefined;
    let cancelled = false;
    (async () => {
      const { records: stored, ok, error: readError, code: readCode } = await loadCallRecordsResult(uid);
      if (cancelled) return;
      // A read that failed comes back empty, which draws exactly like
      // having no calls. Say which it was, and let the cached history
      // stand rather than replacing it with nothing.
      setRecordsReadOk(ok);
      setRecordsReadError(ok ? '' : readError);
      setRecordsReadCode(ok ? '' : readCode || '');
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
      source: rec.isGranola ? 'granola' : rec.isLocal ? 'local' : 'onedrive',
      name: rec.name || '',
      path: rec.path || '',
      recordedAt: rec.modified || rec.created || null,
      durationSeconds: rec.durationSeconds ?? null,
    };
  }

  // Merge a patch into one stored record and save it. Updates state
  // optimistically so the UI never waits on Firestore, then reconciles
  // with what was actually written.
  //
  // A failed write keeps the optimistic state rather than rolling it
  // back: the change is often expensive to recreate — an AI summary costs
  // a real API call — and throwing the user's work away on top of not
  // storing it would be the worse of the two failures. What it must NOT
  // do is let that state read as saved, so the id is recorded as unsaved
  // and the page says so until a later write for the same call succeeds.
  const persist = useCallback(async (recordingId, patch) => {
    const id = String(recordingId);
    const base = recordsRef.current[id] || null;
    setRecords(r => ({ ...r, [id]: { ...(r[id] || {}), ...patch, id } }));
    const { record, ok, error, code } = await saveCallRecordResult(uid, id, patch, base);
    if (ok) {
      setRecords(r => ({ ...r, [id]: record }));
      setUnsaved((u) => {
        if (!u[id]) return u;
        const next = { ...u };
        delete next[id];
        return next;
      });
    } else {
      setUnsaved(u => ({ ...u, [id]: { error, code } }));
    }
    return ok ? record : null;
  }, [uid]);

  function setBusyFor(id, value) {
    setBusy(b => ({ ...b, [id]: value }));
  }

  function setErrorFor(id, message) {
    setActionError(e => ({ ...e, [id]: message || '' }));
  }

  // ---- Granola ingest ------------------------------------------------------
  // Granola calls are listed from the stored records, not from a live
  // fetch: the note IS the record once it has been synced, so the list
  // survives a dead key, a lapsed plan, and being offline. Syncing adds
  // to it; it never has to run for the page to work.
  const granolaRecordings = useMemo(() => (
    Object.values(records)
      .filter(r => r?.source === 'granola')
      .map(recordingFromStored)
      .sort((a, b) => String(b.recordedAt || '').localeCompare(String(a.recordedAt || '')))
  ), [records]);

  // What the body renders. Granola comes from the stored records; the two
  // media sources from whatever the last listing returned.
  const visible = source === 'granola' ? granolaRecordings : recordings;

  function chooseTab(next) {
    setTab(next);
    updateSettings?.({ callRecordingsTab: next });
  }

  // ---- History ---------------------------------------------------------
  // Every call ever stored, not just the ones the active source can see.
  // A OneDrive call whose folder is disconnected, or a file since
  // deleted, still has its transcript, summary and tag in Firestore —
  // the cards drop it, this keeps it.
  const liveHistoryRows = useMemo(() => callHistoryRows(records), [records]);

  // What the table draws. The live rows win the moment Firestore has
  // answered successfully; until then — and permanently, if that read
  // failed — the cache stands in. This is what makes the history survive
  // a refresh without a Granola sync: nothing here waits on one.
  // What to tell the user about a failed read. A denied read and a
  // dropped connection both land here, and only one of them is fixed by
  // reloading — see utils/callStoreError.js.
  const readFailure = useMemo(
    () => describeReadFailure({ ok: recordsReadOk, code: recordsReadCode, error: recordsReadError }),
    [recordsReadOk, recordsReadCode, recordsReadError],
  );

  // Calls whose last write didn't land. They all failed for the same
  // reason in practice — the database is either refusing writes or it
  // isn't — so the banner takes its advice from one of them rather than
  // repeating the same sentence per call.
  const unsavedIds = useMemo(() => Object.keys(unsaved), [unsaved]);
  const unsavedCount = unsavedIds.length;
  const unsavedAdvice = useMemo(() => {
    const first = unsavedIds.length ? unsaved[unsavedIds[0]] : null;
    return describeWriteFailure(first ? { ok: false, ...first } : null);
  }, [unsaved, unsavedIds]);

  const usingCachedHistory = !recordsLoaded || !recordsReadOk;
  const historyRows = usingCachedHistory && historyCache?.rows?.length
    ? historyCache.rows
    : liveHistoryRows;

  const filteredHistory = useMemo(
    () => filterByOppTag(filterHistoryRows(historyRows, historyQuery), oppTagFilter),
    [historyRows, historyQuery, oppTagFilter],
  );

  // Counted before the tag filter, so the chips keep showing how big
  // each pile is while you're standing inside one of them.
  const tagCounts = useMemo(
    () => oppTagCounts(filterHistoryRows(historyRows, historyQuery)),
    [historyRows, historyQuery],
  );
  const totals = useMemo(() => historyTotals(filteredHistory), [filteredHistory]);

  // Read the cache once per account, as early as possible: this is the
  // paint that beats Firestore to the screen.
  useEffect(() => {
    let cancelled = false;
    setHistoryCache(null);
    setHistoryCacheLoaded(false);
    if (!uid) { setHistoryCacheLoaded(true); return undefined; }
    loadCallHistoryCache().then((cached) => {
      if (cancelled) return;
      setHistoryCache(cached);
      setHistoryCacheLoaded(true);
    });
    return () => { cancelled = true; };
  }, [uid]);

  // Keep it current. Every tag, summary and sync lands in `records`, so
  // writing from the derived rows means the cache tracks the page rather
  // than only ever holding what the last full read returned.
  useEffect(() => {
    if (!uid || !recordsLoaded || !historyCacheLoaded) return;
    if (!shouldReplaceCache({
      ok: recordsReadOk,
      rowCount: liveHistoryRows.length,
      cachedCount: historyCache?.rows?.length || 0,
    })) return;
    const rows = cacheableHistoryRows(liveHistoryRows);
    saveCallHistoryCache(rows).then((saved) => {
      if (saved) setHistoryCache({ rows, savedAt: new Date().toISOString() });
    });
  }, [uid, recordsLoaded, recordsReadOk, historyCacheLoaded, liveHistoryRows, historyCache]);
  const [expandedHistory, setExpandedHistory] = useState([]);

  // ---- Breakdown -------------------------------------------------------
  // One call at a time: how much of it was the user talking, and how much
  // was everyone else. Every number is derived from the turns already
  // stored, so nothing is fetched and nothing can go stale against the
  // transcript it describes.
  const breakdownRows = useMemo(() => callBreakdownRows(records), [records]);
  const filteredBreakdown = useMemo(
    () => filterBreakdownRows(breakdownRows, breakdownQuery),
    [breakdownRows, breakdownQuery],
  );
  // The average is over everything transcribed, not the filtered list: it
  // is what the picked call is being compared against, and a mean that
  // moved with the search box would compare it against a moving target.
  const breakdownStats = useMemo(() => breakdownAverages(breakdownRows), [breakdownRows]);
  // Falls back to the newest match so the panel is never blank while
  // there is something to show — including right after a filter drops
  // whatever was picked.
  const pickedBreakdown = useMemo(() => (
    filteredBreakdown.find(r => r.id === breakdownPick) || filteredBreakdown[0] || null
  ), [filteredBreakdown, breakdownPick]);

  function toggleHistoryRow(row) {
    setExpandedHistory(ids => (
      ids.includes(row.id) ? ids.filter(i => i !== row.id) : [...ids, row.id]
    ));
  }

  // The tagging handlers, reachable from inside the memoised columns.
  // They are defined further down (they need `visible` and `persist`),
  // and a memo can neither list them as dependencies before they exist
  // nor safely capture the copy from the render it last ran in. A ref
  // refreshed every render sidesteps both: the column calls whichever
  // handler is current when the button is actually clicked.
  const tagActionsRef = useRef({ tagOpp: () => {}, markOppNa: () => {} });

  const historyColumns = useMemo(() => [
    {
      key: 'recordedAt',
      label: 'Date',
      defaultWidth: 150,
      // Sorted on the epoch, not the formatted text, so the column runs
      // chronologically rather than alphabetically by month name.
      getSortValue: r => r.recordedAtMs,
      render: r => (r.recordedAt
        ? <span className={styles.historyDate}>{fmtWhen(r.recordedAt)}</span>
        : <span className={styles.transcriptStatus}>No date</span>),
    },
    {
      key: 'name',
      label: 'Call',
      defaultWidth: 280,
      render: r => (
        <button
          type="button"
          className={styles.historyName}
          onClick={e => { e.stopPropagation(); toggleHistoryRow(r); }}
          title="Show what was said and what came out of it"
        >
          {expandedHistory.includes(r.id) ? '▾ ' : '▸ '}{r.name}
        </button>
      ),
    },
    { key: 'sourceLabel', label: 'Source', defaultWidth: 110 },
    {
      key: 'company',
      label: 'Company',
      defaultWidth: 170,
      render: r => (r.company
        ? <span className={styles.historyStrong}>{r.company}</span>
        : <span className={styles.transcriptStatus}>Untagged</span>),
    },
    {
      key: 'oppLabel',
      label: 'Opportunity',
      defaultWidth: 260,
      // Sorted by decision, then by name: the queue collects at one end
      // rather than scattering through the alphabet.
      getSortValue: r => `${{ none: 0, na: 1, tagged: 2 }[r.oppTag] ?? 0}${r.oppLabel || ''}`,
      render: (r) => {
        if (r.oppTag === 'tagged') return <span title={r.oppLabel}>{r.oppLabel}</span>;
        if (r.oppTag === 'na') {
          return (
            <span
              className={styles.historyNa}
              title={r.oppNaAt ? `Marked N/A ${fmtWhen(r.oppNaAt)}` : 'Belongs to no opportunity'}
            >N/A</span>
          );
        }
        // The queue. Both decisions are one click from here, so the
        // backlog can be worked through in the view that shows it —
        // rather than card by card on another tab.
        return (
          <span className={styles.historyTagActions}>
            <button
              type="button"
              className={styles.historyTagBtn}
              onClick={(e) => { e.stopPropagation(); setOppPickerFor(r.id); }}
              title="Tag this call to an opportunity"
            >Tag</button>
            <button
              type="button"
              className={styles.historyTagBtn}
              onClick={(e) => { e.stopPropagation(); tagActionsRef.current.markOppNa(r.id); }}
              title="This call belongs to no opportunity"
            >N/A</button>
          </span>
        );
      },
    },
    {
      key: 'durationSeconds',
      label: 'Duration',
      defaultWidth: 90,
      getSortValue: r => r.durationSeconds,
      render: r => fmtDuration(r.durationSeconds) || <span className={styles.transcriptStatus}>—</span>,
    },
    {
      key: 'attendees',
      label: 'Attendees',
      defaultWidth: 240,
      render: r => (r.attendees
        ? <span title={r.attendeeEmails || r.attendees}>{r.attendees}</span>
        : <span className={styles.transcriptStatus}>{r.attendeeCount === 0 ? 'None recorded' : '—'}</span>),
    },
    {
      key: 'stageLabel',
      label: 'Status',
      defaultWidth: 130,
      // Ranked along the pipeline, so sorting groups what still needs
      // doing rather than ordering the labels alphabetically.
      getSortValue: r => r.stageRank,
      render: r => <span className={styles[`stage_${r.stage}`] || styles.stage_stored}>{r.stageLabel}</span>,
    },
    {
      key: 'youShare',
      label: 'You spoke',
      defaultWidth: 100,
      getSortValue: r => r.youShare,
      render: (r) => {
        if (r.youShare == null) return <span className={styles.transcriptStatus}>—</span>;
        // The basis has to travel with the number: a words-based split is
        // a different measurement and would overstate a fast talker.
        return (
          <span title={r.talkBasis === 'words'
            ? 'Share of words spoken — this transcript carried no timings'
            : 'Share of talking time'}>
            {formatShare(r.youShare)}{r.talkBasis === 'words' ? ' (words)' : ''}
          </span>
        );
      },
    },
    { key: 'meetingType', label: 'Type', defaultWidth: 100 },
    {
      key: 'pushedToOppAt',
      label: 'Pushed',
      defaultWidth: 150,
      getSortValue: r => new Date(r.pushedToOppAt || 0).getTime() || null,
      render: r => (r.pushedToOppAt
        ? fmtWhen(r.pushedToOppAt)
        : <span className={styles.transcriptStatus}>—</span>),
    },
    { key: 'folders', label: 'Granola folders', defaultWidth: 150 },
  ], [expandedHistory]);

  function renderHistoryExpansion(row) {
    const rec = row._record || {};
    const followUps = Array.isArray(rec.followUps) ? rec.followUps : [];
    const keyItems = Array.isArray(rec.keyItems) ? rec.keyItems : [];
    const textOf = v => (typeof v === 'string' ? v : v?.text || '');
    return (
      <div className={styles.historyDetail}>
        {row.granolaUrl && (
          <a className={styles.historyLink} href={row.granolaUrl} target="_blank" rel="noopener noreferrer">
            Open in Granola ↗
          </a>
        )}
        {row.summary
          ? <p className={styles.historySummary}>{row.summary}</p>
          : row.granolaSummary
            ? (
              <>
                <div className={styles.historyLabel}>Granola’s notes</div>
                <p className={styles.historySummary}>{row.granolaSummary}</p>
              </>
            )
            : (
              <p className={styles.transcriptStatus}>
                {row.hasTranscript
                  ? 'Transcribed, but not summarised yet. Summarise it on the Calls tab.'
                  : 'Nothing was stored for this call beyond its details.'}
              </p>
            )}
        {keyItems.length > 0 && (
          <>
            <div className={styles.historyLabel}>Key items</div>
            <ul className={styles.historyList}>
              {keyItems.map((k, i) => <li key={i}>{textOf(k)}</li>)}
            </ul>
          </>
        )}
        {followUps.length > 0 && (
          <>
            <div className={styles.historyLabel}>Follow-ups</div>
            <ul className={styles.historyList}>
              {followUps.map((f, i) => {
                const owner = typeof f === 'object' && f?.owner ? ` — ${f.owner}` : '';
                const due = typeof f === 'object' && f?.due ? ` (${f.due})` : '';
                return <li key={i}>{textOf(f)}{owner}{due}</li>;
              })}
            </ul>
          </>
        )}
        {rec.nextSteps && (
          <>
            <div className={styles.historyLabel}>Next steps</div>
            <p className={styles.historySummary}>{rec.nextSteps}</p>
          </>
        )}
        {row.transcriptTrimmed && (
          <div className={styles.transcriptStatus}>
            This transcript was too long to store its speaker turns, so the talk-time split isn’t available for it.
          </div>
        )}
      </div>
    );
  }

  // Syncing needs the probe to have come back healthy — or to have told
  // us nothing at all. A check that timed out leaves the integration's
  // state unknown, and the sync is a better test of it than another
  // probe: it reports its own errors, and it is what the user came for.
  const canSync = !!granolaStatus && (granolaStatus.ok || granolaStatus.timedOut);

  // Which company a call was with, from who was on it. Only ever fills a
  // blank — a company the user set by hand is never overwritten by a
  // guess, on this sync or any later one.
  const autoLink = useCallback((call, stored, idx) => {
    if (stored?.prospectId || stored?.company) return null;
    const match = matchCompanyForCall(call, prospects, idx);
    return match ? { prospectId: match.prospectId, company: match.company } : null;
  }, [prospects]);

  /**
   * Pull calls from Granola into the stored records.
   *
   * Incremental by default: only notes changed since the last sync are
   * fetched in full, with the watermark kept in user settings so it holds
   * across devices. `full` re-reads everything in the back-fill window,
   * which is the repair path when a sync was interrupted.
   */
  const syncGranola = useCallback(async ({ full = false } = {}) => {
    if (!uid || syncing) return;
    // Any sync satisfies the once-per-session pull, including one the
    // user started by hand. Without this, a manual sync that clears a
    // timed-out status would let the auto-sync effect fire straight
    // after it and walk the same window twice.
    autoSynced.current = true;
    setSyncing(true);
    setError('');
    setSyncNote('Checking Granola for new calls…');
    const idx = buildCompanyGuessIndex(prospects || []);
    const watermark = full ? '' : String(settings.granolaSyncedThrough || '');
    const pendingLatest = full ? '' : String(settings.granolaSyncPendingLatest || '');
    try {
      const result = await syncGranolaCalls({
        updatedAfter: watermark,
        // No watermark means a first sync, which would otherwise pull the
        // whole workspace history; cap it at the back-fill window.
        createdAfter: watermark ? '' : daysAgoIso(DEFAULT_BACKFILL_DAYS),
        // Pick up where the last run stopped. A full re-read starts over.
        startCursor: full ? '' : String(settings.granolaSyncCursor || ''),
        shouldFetchDetail: (summary) => {
          if (full) return true;
          const stored = recordsRef.current[`granola:${summary.noteId}`];
          if (!stored) return true;
          // Changed in Granola since we stored it, or stored without its
          // transcript (synced before the plan allowed transcripts).
          if (!stored.transcript) return true;
          const seen = String(stored.granolaUpdatedAt || '');
          return !seen || String(summary.updatedAt || '') > seen;
        },
        onCall: async (call) => {
          const stored = recordsRef.current[call.id] || null;
          const saved = await persist(call.id, {
            ...recordPatchFor(call),
            ...(autoLink(call, stored, idx) || {}),
          });
          // Throwing is what keeps the watermark honest. A call that
          // wasn't stored has to land in result.errors, because a sync
          // with no errors banks its position — and banking a position
          // over calls that were never written puts them permanently
          // behind the cursor, where only a full re-sync would find them
          // again. Counting this as "imported" was how a wholly failed
          // sync reported success.
          if (!saved) throw new Error('could not be saved');
          return stored ? 'updated' : 'imported';
        },
        onProgress: (p) => setSyncNote(`Syncing… ${p.imported + p.updated} call${p.imported + p.updated === 1 ? '' : 's'} so far`),
      });

      // The high-water mark a resumed walk has to carry. Each leg of a
      // truncated sync only sees its own pages, so the newest updated_at
      // is the newest across all of them, not the newest in the last one.
      // Without this a resume that finished on older pages would move the
      // watermark backwards and re-read those calls on the next sync.
      const newest = result.latest > pendingLatest ? result.latest : pendingLatest;

      // Advance the watermark only when the sync ran clean AND reached the
      // end of the window. A partial sync that moved it would leave the
      // calls it failed on permanently behind the cursor.
      //
      // A clean-but-truncated run instead banks where it stopped, so the
      // next sync carries on from there rather than re-walking the pages
      // it just finished. Errors bank nothing: restarting the window is
      // what gives the notes that failed another go.
      if (result.errors.length === 0) {
        if (result.truncated) {
          updateSettings?.({ granolaSyncCursor: result.nextCursor || '', granolaSyncPendingLatest: newest });
        } else if (newest) {
          updateSettings?.({ granolaSyncedThrough: newest, granolaSyncCursor: '', granolaSyncPendingLatest: '' });
        }
      } else if (settings.granolaSyncCursor || pendingLatest) {
        updateSettings?.({ granolaSyncCursor: '', granolaSyncPendingLatest: '' });
      }

      const counts = [
        result.imported ? `${result.imported} new` : '',
        result.updated ? `${result.updated} updated` : '',
      ].filter(Boolean).join(', ');
      const more = result.truncated ? ' More remain: sync again to pick up where this stopped.' : '';
      // Worth saying: a stale cursor means this run re-covered calls the
      // last one had already done, so the counts read higher than the
      // number of genuinely new calls.
      const again = result.restarted ? ' The saved position had expired, so this read the window from the start.' : '';
      // The sync just did what the probe couldn't, so a status left
      // unknown by a timed-out check is now answered. Clearing it takes
      // the stale warning off a page that has visibly just worked.
      setGranolaStatus(prev => (prev?.timedOut ? { configured: true, ok: true, error: '' } : prev));
      // A sync that ran clean and imported nothing has two very different
      // causes that read identically: Granola had nothing new, or it
      // answered with something this build couldn't read. Say which.
      const diagnosis = counts ? '' : diagnoseEmptySync(result.shape);
      setSyncNote(
        counts
          ? `Synced ${counts} from Granola.${more}${again}`
          : diagnosis
            ? `No calls imported. ${diagnosis}`
            : `Already up to date with Granola.${again}`,
      );
      if (!counts && diagnosis) setError(diagnosis);
      if (result.errors.length > 0) {
        setError(`Some calls didn't import: ${result.errors.slice(0, 3).join(' · ')}`);
      }
    } catch (err) {
      setSyncNote('');
      setError(err?.message || String(err));
    } finally {
      setSyncing(false);
    }
  }, [uid, syncing, prospects, settings.granolaSyncedThrough, settings.granolaSyncCursor,
    settings.granolaSyncPendingLatest, updateSettings, persist, autoLink]);

  // Re-run attendee matching over every Granola call that still has no
  // company. Worth its own button because the prospect list can arrive
  // after a sync, or grow after one — a call that matched nothing in
  // January matches once the account is added in March.
  const linkCompanies = useCallback(async () => {
    const idx = buildCompanyGuessIndex(prospects || []);
    let linked = 0;
    for (const record of Object.values(recordsRef.current)) {
      if (record?.source !== 'granola' || record.prospectId || record.company) continue;
      const match = matchCompanyForCall(
        { owner: record.owner, attendees: record.attendees || [] },
        prospects,
        idx,
      );
      if (!match) continue;
      await persist(record.id, { prospectId: match.prospectId, company: match.company });
      linked += 1;
    }
    setSyncNote(linked
      ? `Linked ${linked} call${linked === 1 ? '' : 's'} to a company from their attendees.`
      : 'No unlinked call matched a company by attendee email.');
  }, [prospects, persist]);

  // First visit to the tab in this page session pulls anything new.
  // Waits for the stored records so the incremental check has something
  // to compare against — without it every note would be re-fetched.
  useEffect(() => {
    if (source !== 'granola' || !uid || !recordsLoaded) return;
    if (!granolaStatus?.ok || autoSynced.current) return;
    autoSynced.current = true;
    syncGranola({});
  }, [source, uid, recordsLoaded, granolaStatus, syncGranola]);

  // ---- company + opportunity tagging ---------------------------------------
  function linkTo(recordingId, prospect) {
    const rec = visible.find(r => r.id === recordingId);
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
    const rec = visible.find(r => r.id === recordingId);
    persist(recordingId, {
      ...(rec ? metaFor(rec) : {}),
      ...tagOppPatch(opp, {
        label: oppLabel(opp),
        company: recordsRef.current[recordingId]?.company || '',
      }),
    });
    setOppPickerFor(null);
  }

  /**
   * "This call belongs to no opportunity" — a decision, not a blank.
   *
   * Most calls are this: an internal 1:1, a training session, a
   * prospecting block Granola sat in. Without somewhere to put them they
   * stayed indistinguishable from the client call nobody had got to yet,
   * so the untagged pile only ever grew and never meant anything.
   *
   * `metaFor` goes on too, because this can be the FIRST thing ever
   * written for a call listed straight from OneDrive — without it the
   * record would be an N/A flag with no name or date attached to it.
   */
  function markOppNa(recordingId) {
    const rec = visible.find(r => r.id === recordingId);
    persist(recordingId, { ...(rec ? metaFor(rec) : {}), ...markOppNaPatch() });
    setOppPickerFor(null);
  }

  // Undoes either decision — back into the queue.
  function untagOpp(recordingId) {
    persist(recordingId, clearOppTagPatch());
  }

  // Refreshed every render so the History table's row buttons always
  // call the current closures rather than the ones from whenever the
  // column definitions were last memoised.
  tagActionsRef.current = { tagOpp, markOppNa };

  async function forgetRecord(recordingId) {
    // A Granola call has no file behind it, so forgetting it removes the
    // card outright — until the next sync pulls the note back in.
    const isGranola = String(recordingId).startsWith('granola:');
    const message = isGranola
      ? 'Delete the stored transcript, summary, and tags for this call? The note stays in Granola, and the next sync will pull it back in without its tags.'
      : 'Delete the stored transcript, summary, and tags for this recording? The recording file itself is not touched.';
    if (!window.confirm(message)) return;
    const { ok, error, code } = await deleteCallRecordResult(uid, recordingId);
    // Dropping it from state on a failed delete would make the call
    // vanish from the page and reappear on the next refresh — the same
    // lie a failed save used to tell, in the other direction. The card
    // stays, carrying why it's still there.
    if (!ok) {
      const failure = describeDeleteFailure({ ok, error, code });
      setErrorFor(recordingId, `Couldn’t delete this call: ${error}${failure ? ` ${failure.advice}` : ''}`);
      return;
    }
    setErrorFor(recordingId, '');
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
    if (!block) throw new Error('Nothing to push: summarize the call first.');

    // Read the opp's current Notes so the summary is appended to the
    // user's own text rather than replacing it.
    const cache = await loadOppsFromCache();
    const opp = (cache?.records || []).find(r => String(r?._id) === String(oppId));
    if (!opp) throw new Error('That opp is no longer in the Opps cache: open the Opps 2 tab and try again.');

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
      setErrorFor(id, 'Transcribe this recording first: there is nothing to summarize.');
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
          // Who was on the call is what tells an internal meeting from a
          // client one, and machine speaker labels ("A"/"B") don't carry
          // it. Only Granola records have attendees; the others send
          // nothing and the summariser classifies from the transcript.
          attendees: stored.attendees || null,
          owner: stored.owner || null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErrorFor(id, data.error || `Summary failed (HTTP ${r.status})`);
        return;
      }
      const saved = await persist(id, {
        ...metaFor(rec),
        meetingType: data.meetingType || '',
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
      setTranscripts(t => ({ ...t, [recording.id]: { status: 'error', error: 'OneDrive connection expired: reconnect and try again.' } }));
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

  const pickerRecording = pickerFor ? visible.find(r => r.id === pickerFor) : null;
  // The picker opens from the Calls cards AND from a History row, and
  // History covers every call ever stored — including ones the current
  // source can't see (a OneDrive call while Granola is selected, a file
  // since moved). Falling back to the stored record means the picker
  // opens for those too, instead of silently doing nothing.
  const oppPickerRecording = oppPickerFor
    ? (visible.find(r => r.id === oppPickerFor) || (records[oppPickerFor] ? { id: oppPickerFor } : null))
    : null;

  // The fallback <input webkitdirectory> path never produces a handle, so
  // "have we been pointed at a folder yet?" is handle-or-name, not handle.
  const hasLocalSelection = !!folderHandle || !!folderName;

  // Which empty state (if any) stands in for the recording list. Returning
  // null here means "render the cards".
  const emptyState = (() => {
    if (loading || visible.length > 0) return null;
    if (source === 'granola') {
      // Granola calls come out of Firestore, so "nothing here" isn't
      // knowable until that read lands — otherwise the empty state
      // flashes over a list that is about to appear.
      if (!checkedConnection || (uid && !recordsLoaded)) return null;
      if (granolaStatus && !granolaStatus.configured) {
        return (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Granola isn’t connected yet</span>
            Granola is the notetaker this page ingests calls from. Create an API key in Granola
            (Settings → API: it needs note and transcript access, which is a Business or Enterprise
            plan) and set it as <code>GRANOLA_API_KEY</code> in the deployment environment. Every call
            Granola has taken notes on then lands here, already transcribed.
            {/* Which deployment answered and what it could see. The three
                causes of "not configured" need three different fixes, so
                guessing between them is worth a line of diagnostics. */}
            {describeMissingKey(granolaStatus.hint) && (
              <div className={styles.notice} style={{ marginTop: '0.9rem', textAlign: 'left' }}>
                {describeMissingKey(granolaStatus.hint)}
                {' '}Vercel only injects environment variables at build time, so a redeploy is needed
                after saving one.
              </div>
            )}
          </div>
        );
      }
      if (granolaStatus && !granolaStatus.ok) return null;
      return (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>No Granola calls yet</span>
          {syncing
            ? 'Pulling your calls from Granola…'
            : `Nothing has been synced from Granola. Sync pulls the last ${DEFAULT_BACKFILL_DAYS} days the first time, then only what has changed. Granola only serves notes it has finished summarising, so a call from the last few minutes may not be there yet.`}
        </div>
      );
    }
    if (source === 'local') {
      if (!hasLocalSelection) {
        return (
          <div className={styles.empty}>
            <span className={styles.emptyTitle}>Pick the folder your recordings are in</span>
            Anything on this machine works: Desktop, Documents, or the OneDrive folder your PC already syncs.
            The files are read straight from disk and played here; nothing is uploaded and nothing is copied.
            {supportsDirectoryPicker()
              ? ' Chrome and Edge remember the folder, so you only pick it once.'
              : ' This browser can’t remember the folder, so you’ll pick it each visit: Chrome or Edge can remember it.'}
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
          (<code>Files.Read</code>). Pick your <strong>personal</strong> account on the sign-in screen.
          The work account is the one Outlook already uses.
        </div>
      ) : null;
    }
    if (error) return null;
    return (
      <div className={styles.empty}>
        <span className={styles.emptyTitle}>Nothing to play in {folder}</span>
        {skipped > 0
          ? `The folder exists and holds ${skipped} file${skipped === 1 ? '' : 's'}, but none are audio or video.`
          : 'The folder is empty. Check the path above: it’s case-sensitive and relative to your OneDrive root.'}
      </div>
    );
  })();

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Call Recordings</h1>
          <div className={styles.subtitle}>
            {source === 'granola'
              ? 'Calls from Granola, already transcribed and with Granola’s own notes attached. Tag one to a company and an opportunity, and its summary can be pushed straight onto the deal.'
              : source === 'local'
                ? 'Recordings from a folder on this computer. Nothing is uploaded: the files are read and played locally, and only the company link is saved.'
                : 'Recordings from a folder in your personal OneDrive. This connection is separate from the work Outlook one: signing in here doesn’t touch your calendar or mail integration.'}
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
              className={source === 'granola' ? styles.sourceOn : styles.sourceOff}
              onClick={() => switchSource('granola')}
              title="Calls Granola took notes on: the primary source"
            >Granola</button>
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
          {source === 'granola' ? (
            <>
              <span className={granolaStatus?.ok ? styles.connected : styles.disconnected}>
                {checking || !checkedConnection ? '○ Checking Granola…'
                  : granolaStatus?.ok ? '● Granola connected'
                  : granolaStatus?.configured === false ? '○ Granola not configured'
                  : granolaStatus?.timedOut ? '○ Granola check timed out'
                  : '○ Granola unavailable'}
              </span>
              {/* A failed check is not a dead end: it is usually the check
                  itself that failed, so offer the retry rather than
                  leaving the tab with nothing to press. */}
              {checkedConnection && !checking && !granolaStatus?.ok && (
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => checkGranola()}
                  title="Run the Granola connection check again"
                >Check again</button>
              )}
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => syncGranola({})}
                disabled={syncing || !canSync}
                title="Pull calls Granola has notes for that aren't here yet"
              >{syncing ? 'Syncing…' : '⟲ Sync calls'}</button>
            </>
          ) : source === 'onedrive' ? (
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

      <div className={styles.subtabs}>
        {[
          { key: 'calls', label: 'Calls', count: visible.length },
          { key: 'history', label: 'History', count: historyRows.length },
          { key: 'breakdown', label: 'Call breakdown', count: breakdownRows.length },
        ].map(t => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? styles.subtabOn : styles.subtabOff}
            onClick={() => chooseTab(t.key)}
            title={t.key === 'calls'
              ? 'The calls this source can see right now'
              : t.key === 'history'
                ? 'Every call ever stored, whatever it came from'
                : 'Pick a call and see how much of it was you talking'}
          >
            {t.label}
            <span className={styles.subtabCount}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Above the subtab content rather than inside it: a write can fail
          from a bulk sync as easily as from one button, and the user may
          well be on another tab when it does. One line, whatever the
          count — the per-call detail is on the cards. */}
      {unsavedCount > 0 && (
        <div className={styles.error} style={{ margin: '0 1.25rem 0.75rem' }}>
          <strong>{unsavedCount === 1 ? '1 call has changes' : `${unsavedCount} calls have changes`} that
          couldn’t be saved.</strong>{' '}
          They’re showing in this browser only and a refresh will lose them.
          {unsavedAdvice && ` ${unsavedAdvice.advice}`}
          {tab !== 'calls' && ' The Calls tab says which.'}
        </div>
      )}

      {tab === 'calls' && (source === 'granola' ? (
        <div className={styles.controls}>
          <span className={styles.fieldLabel}>Granola</span>
          <button
            type="button"
            className={styles.btn}
            onClick={() => syncGranola({ full: true })}
            disabled={syncing || !canSync}
            title={`Re-read every Granola note from the last ${DEFAULT_BACKFILL_DAYS} days, not just what changed since the last sync`}
          >Re-sync everything</button>
          <button
            type="button"
            className={styles.btn}
            onClick={linkCompanies}
            disabled={syncing || granolaRecordings.length === 0}
            title="Match calls that still have no company against your prospect list, using who was on the call"
          >Link companies from attendees</button>
          <span className={styles.transcriptStatus}>
            {syncNote
              || (settings.granolaSyncedThrough
                ? `Synced up to ${fmtWhen(settings.granolaSyncedThrough)}. New calls appear when you open this tab.`
                : 'Calls arrive already transcribed: there is nothing to upload or transcribe here.')}
          </span>
        </div>
      ) : source === 'onedrive' ? (
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
                  <span className={styles.connected} title="Remembered: this folder reopens next time you visit">
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
            Any folder on this machine: Desktop, Documents, a synced OneDrive folder. Subfolders are included.
          </span>
        </div>
      ))}

      {tab === 'history' && (
        <div className={styles.historyBody}>
          <div className={styles.historyBar}>
            <input
              className={styles.input}
              type="search"
              placeholder="Search calls, companies, attendees, summaries…"
              value={historyQuery}
              onChange={e => setHistoryQuery(e.target.value)}
            />
            {/* Triage, as four piles you can stand in. "Needs tagging"
                is the only one that names work still to do, so it
                carries its count even when empty — an empty queue is
                worth seeing. */}
            <span className={styles.historyFilters}>
              {OPP_TAG_FILTERS.map((f) => {
                const count = f.key === 'all' ? tagCounts.total : tagCounts[f.key === 'untagged' ? 'untagged' : f.key];
                return (
                  <button
                    key={f.key}
                    type="button"
                    className={oppTagFilter === f.key ? styles.historyFilterOn : styles.historyFilterOff}
                    onClick={() => setOppTagFilter(f.key)}
                    title={f.title}
                  >
                    {f.label}
                    <span className={styles.historyFilterCount}>{count}</span>
                  </button>
                );
              })}
            </span>
            <span className={styles.historyTotals}>
              <strong>{totals.calls}</strong> call{totals.calls === 1 ? '' : 's'}
              {totals.durationSeconds > 0 && <> · {fmtDuration(totals.durationSeconds)} recorded</>}
              {' · '}{totals.transcribed} transcribed
              {' · '}{totals.summarized} summarised
              {' · '}{totals.pushed} pushed to an opp
              {' · '}{totals.withCompany} tagged to a company
              {totals.needsOppTag > 0 && <> · <strong>{totals.needsOppTag}</strong> still need an opp or N/A</>}
            </span>
          </div>
          {recordsReadError && (
            <div className={styles.error}>
              Couldn’t read your saved calls: {recordsReadError}
              {/* The cache note comes before the advice: what you are
                  looking at right now, then what to do about it. */}
              {historyCache?.rows?.length
                ? ' Showing the copy this browser saved last time — it may be out of date.'
                : ''}
              {readFailure && ` ${readFailure.advice}`}
            </div>
          )}
          {usingCachedHistory && historyCache?.savedAt && (
            <div className={styles.transcriptStatus} style={{ marginBottom: '0.4rem' }}>
              {recordsReadOk
                ? `Showing this browser’s saved copy from ${fmtWhen(historyCache.savedAt)} while your calls load…`
                : `Saved on this browser ${fmtWhen(historyCache.savedAt)}.`}
            </div>
          )}
          {/* Only ever a wait when there is nothing cached to show. With
              a cache the table is already on screen and the Firestore
              read just refreshes it underneath. */}
          {uid && !recordsLoaded && !historyRows.length && historyCacheLoaded ? (
            <div className={styles.transcriptStatus}>Loading your saved calls…</div>
          ) : (
            <DataTable
              tableId="call-history"
              columns={historyColumns}
              rows={filteredHistory}
              alwaysVisible={[]}
              defaultSort={{ key: 'recordedAt', direction: 'desc' }}
              expandedRowIds={expandedHistory}
              renderExpansion={renderHistoryExpansion}
              onRowClick={toggleHistoryRow}
              exportFileName="call-history"
              emptyMessage={historyQuery
                ? `No stored call matches “${historyQuery}”.`
                : oppTagFilter === 'untagged'
                  ? 'Nothing left to triage: every stored call has an opportunity or an N/A on it.'
                  : oppTagFilter !== 'all'
                    ? `No calls are ${oppTagFilter === 'na' ? 'marked N/A' : 'tagged to an opportunity'} yet.`
                    : 'No calls have been stored yet. Sync from Granola, or transcribe a recording, and it lands here.'}
              settings={settings}
              updateSettings={updateSettings}
            />
          )}
        </div>
      )}

      {tab === 'breakdown' && (
        <div className={styles.breakdownBody}>
          <div className={styles.breakdownPicker}>
            <input
              className={styles.input}
              style={{ minWidth: 0, width: '100%' }}
              type="search"
              placeholder="Search calls, companies, attendees…"
              value={breakdownQuery}
              onChange={e => setBreakdownQuery(e.target.value)}
            />
            <div className={styles.breakdownSummary}>
              {/* Silent when the read failed: a count of nothing would
                  state as fact the very thing that isn't known. */}
              {recordsReadError ? null : breakdownStats.avgYouShare == null ? (
                <>{breakdownStats.calls} transcribed call{breakdownStats.calls === 1 ? '' : 's'}</>
              ) : (
                <>
                  You averaged <strong>{formatShare(breakdownStats.avgYouShare)}</strong> across{' '}
                  {breakdownStats.averaged} measured call{breakdownStats.averaged === 1 ? '' : 's'}
                  {breakdownStats.basis === 'words' && ' (by word count)'}
                  {/* Time and words are different measurements, so calls
                      measured the other way are named, not folded in. */}
                  {breakdownStats.otherBasis > 0 && (
                    <span className={styles.transcriptStatus}>
                      {' '}· {breakdownStats.otherBasis} more measured by word count, kept out of the average
                    </span>
                  )}
                </>
              )}
            </div>
            {/* A failed read comes back empty, which would otherwise draw
                as "you have no transcribed calls". The History tab can
                fall back to this browser's saved copy; a breakdown can't,
                because the cache drops the speaker turns it is computed
                from — so this says so instead of standing in. */}
            {recordsReadError && (
              <div className={styles.error}>
                Couldn’t read your saved calls: {recordsReadError}
                {/* Only worth saying when there IS a cached history to
                    contrast with — otherwise it explains a difference
                    the user can't see. */}
                {historyCache?.rows?.length
                  ? ' The History tab can fall back to the copy this browser saved, but a breakdown can’t:'
                    + ' that copy doesn’t keep each call’s speaker turns.'
                  : ''}
                {readFailure && ` ${readFailure.advice}`}
              </div>
            )}
            <div className={styles.breakdownScroll}>
              {/* Nothing to add when the read failed — the notice above
                  already says why the list is empty, and a second line
                  would read as a second problem. */}
              {recordsReadError ? null : uid && !recordsLoaded ? (
                <div className={styles.transcriptStatus}>Loading your saved calls…</div>
              ) : filteredBreakdown.length === 0 ? (
                <div className={styles.transcriptStatus}>
                  {breakdownQuery
                    ? `No transcribed call matches “${breakdownQuery}”.`
                    : 'No transcribed calls yet. Sync from Granola, or transcribe a recording, and it can be broken down here.'}
                </div>
              ) : filteredBreakdown.map(r => (
                <button
                  key={r.id}
                  type="button"
                  className={pickedBreakdown?.id === r.id ? styles.pickOn : styles.pick}
                  onClick={() => setBreakdownPick(r.id)}
                  title={r.measurable
                    ? `You spoke ${formatShare(r.youShare)} of this call`
                    : r.blockedReason}
                >
                  <span className={styles.pickTop}>
                    <span className={styles.pickName}>{r.name}</span>
                    <span className={styles.pickShare} data-measured={r.measurable ? 'true' : 'false'}>
                      {r.measurable ? formatShare(r.youShare) : '—'}
                    </span>
                  </span>
                  <span className={styles.pickMeta}>
                    {[fmtWhen(r.recordedAt) || 'No date', r.company].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.breakdownDetail}>
            {pickedBreakdown ? (
              <BreakdownDetail row={pickedBreakdown} />
            ) : breakdownRows.length > 0 ? (
              /* There ARE calls to break down — the search just hid them,
                 and blaming a missing transcript would send the user off
                 to fix a problem they don't have. */
              <div className={styles.empty}>
                <span className={styles.emptyTitle}>Nothing matches that search</span>
                None of your {breakdownRows.length} transcribed call{breakdownRows.length === 1 ? '' : 's'} match
                {' '}“{breakdownQuery}”. Clear the search to pick one.
              </div>
            ) : recordsReadError ? (
              /* The panel stays quiet about why: the notice beside the
                 list already says the read failed, and repeating it here
                 would read as two separate problems. */
              <div className={styles.empty}>
                <span className={styles.emptyTitle}>Nothing to show yet</span>
                Your saved calls haven’t loaded, so there is nothing to pick.
              </div>
            ) : (
              <div className={styles.empty}>
                <span className={styles.emptyTitle}>Nothing to break down yet</span>
                A call needs a transcript with speaker turns before its talking can be split up. Granola calls
                arrive that way; a OneDrive or local recording gets there once it’s transcribed on the Calls tab.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden rather than unmounted: a recording mid-playback and a
          transcription still running both live in this subtree, and
          tearing them down to glance at another subtab would lose them. */}
      <div className={styles.body} style={tab !== 'calls' ? { display: 'none' } : undefined}>
        {error && <div className={styles.error}>{error}</div>}
        {/* A dead key or a plan without transcript access stops new calls
            arriving, but everything already synced still reads — so this
            is a notice above the list, not an empty state replacing it. */}
        {source === 'granola' && granolaStatus?.configured && !granolaStatus.ok && granolaStatus.error && (
          <div className={styles.error}>{granolaStatus.error}</div>
        )}
        {/* Tags and stored transcripts land a beat after the file list,
            so say so rather than letting a tagged call look untagged. */}
        {uid && !recordsLoaded && visible.length > 0 && (
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
          visible.map(rec => {
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
            // Null whenever the turns can't answer it — a flat transcript,
            // or one whose turns were dropped to fit Firestore. The bar
            // then renders not at all, rather than as an empty split.
            const talkSplit = talkTimeSplit(utterances);
            const inFlight = tr && (tr.status === 'starting' || tr.status === 'queued' || tr.status === 'processing');
            const state = busy[rec.id] || '';
            const problem = actionError[rec.id] || '';
            const notStored = unsaved[rec.id] || null;
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
                      title={`Linked to ${company}: click to open the company`}
                      onClick={() => {
                        const p = prospects.find(x => x?.id === stored.prospectId);
                        if (p) onSelectProspect?.(p);
                      }}
                    >{company}</span>
                  )}
                  {oppTagStateOf(stored) === 'tagged' && (
                    <span
                      className={styles.oppChip}
                      title={`Tagged to ${stored.oppLabel || 'an opportunity'}`}
                    >◆ {oppTagLabelOf(stored)}</span>
                  )}
                  {oppTagStateOf(stored) === 'na' && (
                    <span
                      className={styles.oppChipNa}
                      title="Marked as belonging to no opportunity — this call is done being triaged"
                    >N/A</span>
                  )}
                  <span className={styles.cardActions}>
                    {/* A Granola call has no media behind it — the note is
                        the whole artifact — so there is nothing to play,
                        download, or transcribe. */}
                    {!rec.isGranola && (
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => togglePlay(rec)}
                      >{playing === rec.id ? 'Hide player' : '▶ Play'}</button>
                    )}
                    {/* A local file is already on disk — there is nothing
                        to download, so the button only appears for OneDrive. */}
                    {!rec.isLocal && !rec.isGranola && (
                      <a className={styles.btn} href={rec.downloadUrl} download={rec.name} target="_blank" rel="noopener noreferrer">⬇ Download</a>
                    )}
                    {rec.isGranola && rec.granolaUrl && (
                      <a
                        className={styles.btn}
                        href={rec.granolaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open this note in Granola"
                      >↗ Granola</a>
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
                    {/* The other half of the decision. Most calls are
                        this one — internal, training, a prospecting
                        block — and without it they sit in the untagged
                        pile forever looking like work still to do. */}
                    {oppTagStateOf(stored) !== 'na' && (
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => markOppNa(rec.id)}
                        title="This call belongs to no opportunity. It stops counting as needing tagging."
                      >N/A</button>
                    )}
                    {oppTagStateOf(stored) !== 'none' && (
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => untagOpp(rec.id)}
                        title={oppTagStateOf(stored) === 'na'
                          ? 'Put this call back in the queue'
                          : 'Remove the opportunity tag'}
                      >{oppTagStateOf(stored) === 'na' ? 'Clear N/A' : 'Untag opp'}</button>
                    )}
                    {company && (
                      <button type="button" className={styles.btn} onClick={() => unlink(rec.id)} title={`Remove the link to ${company}`}>Unlink</button>
                    )}
                    {!rec.isGranola && (
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
                    )}
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
                {/* This call is showing changes that never reached
                    Firestore. Said on the card itself because the card is
                    what looks up to date and isn't. */}
                {/* The fact only. The remedy is in the banner above the
                    list, which doesn't scroll away with the cards — and
                    the same long sentence on every affected card would
                    bury the one thing this line is for. */}
                {notStored && (
                  <div className={styles.error} style={{ margin: '0 0 0.5rem' }}>
                    <strong>Not saved.</strong> What you see here for this call is in this browser only —
                    a refresh will lose it. {notStored.error}
                  </div>
                )}
                {stored?.pushedToOppAt && (
                  <div className={styles.pushedNote}>
                    Pushed to {stored.oppLabel || 'the opp'} on {fmtWhen(stored.pushedToOppAt)}.
                  </div>
                )}

                {/* Who was on the call. This is what the company link is
                    guessed from, so showing it makes a wrong guess
                    self-explanatory rather than mysterious. */}
                {rec.isGranola && rec.attendees?.length > 0 && (
                  <div className={styles.attendees}>
                    <span className={styles.attendeeLabel}>On the call</span>
                    {rec.attendees.slice(0, 8).map((a, i) => (
                      <span key={i} className={styles.attendee} title={a.email || a.name}>
                        {a.name || a.email}
                      </span>
                    ))}
                    {rec.attendees.length > 8 && (
                      <span className={styles.attendee}>+{rec.attendees.length - 8} more</span>
                    )}
                  </div>
                )}

                {/* Granola's own notes, kept separate from our summary
                    below: this is what Granola wrote in the meeting, that
                    one is what Claude pulled out for the deal. */}
                {rec.isGranola && rec.granolaSummary && (
                  <div className={styles.granolaNote}>
                    <div className={styles.summaryHead}>
                      <span className={styles.summaryTitle}>Granola notes</span>
                    </div>
                    <div className={styles.granolaBody}>{rec.granolaSummary}</div>
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
                      {/* Which section set the summary was written to.
                          Absent on summaries made before the summariser
                          classified, and on ones where it couldn't tell. */}
                      {stored.meetingType && (
                        <span
                          className={styles.meetingType}
                          title="What the summariser decided this meeting was, which sets the sections it filled"
                        >{stored.meetingType}</span>
                      )}
                      {stored.sentiment && (
                        <span className={styles.sentiment} data-tone={stored.sentiment}>{stored.sentiment}</span>
                      )}
                      <span className={styles.meta}>{fmtWhen(stored.summarizedAt)}</span>
                    </div>
                    {stored.summaryClipped && (
                      <div className={styles.notice} style={{ margin: '0 0 0.5rem' }}>
                        This call was long enough that the middle was left out of the summary: the opening and
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
                              {f.owner && <span className={styles.followMeta}>: {f.owner}</span>}
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

                {/* Summarise and search both read the transcript, so a
                    Granola call that arrived without one can't use either.
                    Say why rather than silently hiding the buttons. */}
                {rec.isGranola && stored?.syncedAt && !hasTranscript && (
                  <div className={styles.transcriptStatus} style={{ marginBottom: '0.5rem' }}>
                    Granola sent its notes for this call but no transcript. Transcript access is a
                    Business/Enterprise feature: without it, Summarize and call search have nothing to read.
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
                        placeholder="Ask this call a question: “what did they say about pricing?”"
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
                    {/* Who did the talking. Above the turns because it is
                        the thing you can't get by scrolling them. */}
                    {talkSplit && (
                      <div className={styles.talkTime}>
                        <div className={styles.talkBar}>
                          {talkSplit.speakers.map(s => (
                            <div
                              key={s.name}
                              className={styles.talkSegment}
                              data-you={s.isYou ? 'true' : 'false'}
                              style={{ width: `${s.share * 100}%` }}
                              title={`${s.name}: ${formatShare(s.share)}`}
                            />
                          ))}
                        </div>
                        <div className={styles.talkLegend}>
                          {talkSplit.speakers.map(s => (
                            <span key={s.name} className={styles.talkKey} data-you={s.isYou ? 'true' : 'false'}>
                              {s.name} {formatShare(s.share)}
                            </span>
                          ))}
                          {/* A words split is a different measurement, so
                              it never passes silently as talk time. */}
                          {talkSplit.basis === 'words' && (
                            <span className={styles.talkBasis}>by word count: this transcript has no timings</span>
                          )}
                        </div>
                      </div>
                    )}
                    {tr?.status === 'error' ? (
                      <div className={styles.error} style={{ margin: 0 }}>{tr.error}</div>
                    ) : inFlight ? (
                      <div className={styles.transcriptStatus}>
                        {tr.status === 'starting' ? 'Sending to the transcription service…'
                          : tr.status === 'queued' ? 'Queued: transcription usually takes a fraction of the recording’s length.'
                          : 'Transcribing…'}
                      </div>
                    ) : utterances.length ? (
                      utterances.map((u, i) => (
                        <div key={i} className={styles.utterance}>
                          <span className={styles.speaker}>{speakerName(u.speaker)}</span>
                          <span>{u.text}</span>
                        </div>
                      ))
                    ) : transcriptText ? (
                      <div>{transcriptText}</div>
                    ) : (
                      <div className={styles.transcriptStatus}>The transcription came back empty: there may be no speech in this file.</div>
                    )}
                    {/* A transcript with no speaker turns can't say who
                        was talking, and until this said so the talk-time
                        bar just wasn't there — indistinguishable from a
                        feature that doesn't exist. */}
                    {utterances.length === 0 && transcriptText && (
                      <div className={styles.transcriptStatus}>
                        {stored?.utterancesDropped
                          ? 'This transcript was too long to store its speaker turns: the text above is the whole '
                            + 'call, but jump-to-moment links and the talk-time split aren’t available for it.'
                          : 'This transcript arrived as one block of text with no speaker turns, so there are no '
                            + 'jump-to-moment links and no talk-time split. Re-syncing may bring the turns back.'}
                      </div>
                    )}
                  </div>
                )}

                {/* A Granola note with no transcript behind it. The card
                    otherwise shows nothing here at all, which reads as a
                    missing feature rather than a missing transcript. */}
                {rec.isGranola && !hasTranscript && !inFlight && (
                  <div className={styles.transcript}>
                    <div className={styles.transcriptStatus}>
                      Granola sent this note without a transcript, so there is nothing to summarise and no
                      talk-time split. Meetings imported on the Activity page carry no transcript by design —
                      use Sync calls here to fetch them. If they still arrive empty, the Granola plan may not
                      include transcript access.
                    </div>
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
