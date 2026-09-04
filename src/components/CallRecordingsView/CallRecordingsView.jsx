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
  oppLabel,
} from '../../utils/callRecordingsStore';
import {
  probeGranola, recordingFromStored,
  matchCompanyForCall, describeMissingKey, DEFAULT_BACKFILL_DAYS,
} from '../../utils/granolaCalls';
import { talkTimeSplit, talkTimeSides, formatShare, formatTalkValue } from '../../utils/talkTime';
import {
  callHistoryRows, filterHistoryRows, historyTotals, STAGE_LABELS,
  cacheableHistoryRows, shouldReplaceCache,
} from '../../utils/callHistory';
import { loadCallHistoryCache, saveCallHistoryCache } from '../../utils/callHistoryCache';
import { describeReadFailure, describeWriteFailure, describeDeleteFailure } from '../../utils/callStoreError';
import {
  callBreakdownRows, filterBreakdownRows, breakdownAverages, withIgnoredFillers,
} from '../../utils/callBreakdown';
import {
  fillerTotals, formatRate, describeAgainstAverage, MIN_RATE_WORDS, fillerById,
} from '../../utils/fillerWords';
import {
  loadIgnoredFillers, saveIgnoredFillers, toggleIgnoredFiller,
} from '../../utils/fillerIgnoreStore';
import { DataTable } from '../common/DataTable';
import { buildCompanyGuessIndex } from '../../utils/companyGuess';
import { runGranolaSync } from '../../utils/runGranolaSync';
import { runCallSummary, pushSummaryToOpp, recordCallOnOpp } from '../../utils/runCallSummary';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { buildActiveOppsIndex, activeOppsForCompany } from '../../utils/targetAccountOpps';
import { setOppFields, bulkSetOppFields } from '../../utils/opps2Store';
import { backfillNextStepPatches } from '../../utils/nextSteps';
import { clearLastCallPatch, backfillLastCallPatches } from '../../utils/lastCallOnOpp';
import {
  tagOppPatch, markOppNaPatch, clearOppTagPatch, oppTagStateOf, oppTagLabelOf,
  filterByOppTag, oppTagCounts, isAutoNa, autoNaPatch, OPP_TAG_FILTERS,
} from '../../utils/callOppTag';
import {
  normalizeRules, normalizeRule, autoNaMatches, describeNaRules, MAX_NA_RULES,
} from '../../utils/callNaRules';
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
// How stale the call list is allowed to get before the tab re-pulls on its
// own. Every load — automatic or a button press — pushes this out, so the
// hour is measured from the last time the list was actually current.
const AUTO_REFRESH_MS = 60 * 60 * 1000;
// The ticker checks the clock rather than being the hour itself. A browser
// tab in the background has its timers throttled hard (and a sleeping
// laptop stops them altogether), so an interval set to an hour can land
// well past one; checking every minute means the first tick after the tab
// wakes up finds the refresh overdue and runs it straight away.
const AUTO_REFRESH_CHECK_MS = 60 * 1000;

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

// How often the user reached for a filler word on the picked call.
//
// The rate leads and the raw count follows it, because the count on its
// own mostly measures how long the rep talked — a 40-minute call will
// always beat a 10-minute one. Both are shown, and the rate is the one
// compared against the user's own other calls: notetakers differ in how
// much of the "um" they keep, so a rate from this page is only honestly
// compared with other calls captured the same way.
function FillerWords({ use, totals, ignored, onToggleIgnored, onRestoreAll }) {
  // Nothing said, or nothing attributed: the talk-time notice above
  // already explains why, and a second empty panel would read as a
  // second problem.
  if (!use) return null;

  // Empty until there are at least two measured calls: with one, the
  // "average" is this call's own number staring back.
  const comparison = describeAgainstAverage(use.per100Words, totals?.per100Words, totals?.measured || 0);

  // Built from the saved ids rather than from this call's hidden counts,
  // so a word the user ignored is still listed — and still restorable —
  // on a call where they never said it.
  const ignoredList = (ignored || []).map((id) => {
    const def = fillerById(id);
    return {
      id,
      label: def?.label || id,
      count: use.ignored.find(f => f.id === id)?.count || 0,
    };
  });

  return (
    <div className={styles.fillerBlock}>
      <div className={styles.breakdownLabel}>Filler words — in your turns only</div>

      {use.words === 0 ? (
        <div className={styles.breakdownCaveat}>
          Your turns on this call carry timings but no text, so there are no words to count fillers in.
        </div>
      ) : (
        <>
          <div className={styles.tiles}>
            <div className={styles.tile} data-filler="true">
              <span className={styles.tileLabel}>Per 100 words</span>
              <span className={styles.tileValue}>{formatRate(use.per100Words)}</span>
              <span className={styles.tileSub}>
                {comparison
                  ? <>{comparison} of {formatRate(totals.per100Words)}</>
                  : `across the ${use.words.toLocaleString()} words you spoke`}
              </span>
            </div>
            <div className={styles.tile} data-filler="true">
              <span className={styles.tileLabel}>Filler words</span>
              <span className={styles.tileValue}>{use.fillers.toLocaleString()}</span>
              <span className={styles.tileSub}>
                {use.fillers === 0
                  ? `none in your ${use.turns} turn${use.turns === 1 ? '' : 's'}`
                  : `${use.hesitations} hesitation${use.hesitations === 1 ? '' : 's'}`
                    + ` · ${use.crutches} crutch word${use.crutches === 1 ? '' : 's'}`}
              </span>
            </div>
            {/* Only when every one of the user's turns was timed — a
                per-minute rate off a partly-timed transcript would be
                divided by less time than the rep actually spent. */}
            {use.perMinute != null && (
              <div className={styles.tile} data-filler="true">
                <span className={styles.tileLabel}>Per minute</span>
                <span className={styles.tileValue}>{formatRate(use.perMinute)}</span>
                <span className={styles.tileSub}>
                  of the {formatTalkValue(use.talkMs, 'time')} you were talking
                </span>
              </div>
            )}
          </div>

          {use.byFiller.length > 0 && (
            <div className={styles.speakerList}>
              {use.byFiller.map(f => (
                <div key={f.id} className={styles.fillerRow}>
                  <span className={styles.fillerWord} data-kind={f.kind}>{f.label}</span>
                  <span
                    className={styles.speakerTrack}
                    title={`${f.label}: ${f.count} of your ${use.fillers} fillers`}
                  >
                    <span
                      className={styles.fillerFill}
                      style={{ width: `${Math.max(f.share * 100, 0.6)}%` }}
                    />
                  </span>
                  <span className={styles.speakerPct}>{f.count}</span>
                  <span className={styles.speakerValue}>{formatShare(f.share)}</span>
                  {/* Per word rather than one settings panel: the moment a
                      rep disagrees with a rule is the moment they are
                      looking at the row it produced. */}
                  <button
                    type="button"
                    className={styles.fillerIgnore}
                    onClick={() => onToggleIgnored?.(f.id)}
                    title={`Ignore “${f.label}” — take it out of every filler number on this tab`}
                  >
                    Ignore
                  </button>
                </div>
              ))}
            </div>
          )}

          {use.moments.length > 0 && (
            <>
              <div className={styles.breakdownLabel}>
                Where they cluster — your {use.moments.length === 1 ? 'turn' : `${use.moments.length} turns`} with the most
              </div>
              {use.moments.map((m, i) => (
                <div key={`${m.start ?? 'x'}-${i}`} className={styles.fillerMoment}>
                  <span className={styles.fillerMomentHead}>
                    {m.start != null && (
                      <span className={styles.fillerStamp}>{fmtClock(m.start / 1000)}</span>
                    )}
                    <span className={styles.fillerCount}>
                      {m.count} filler{m.count === 1 ? '' : 's'} · {m.labels.join(', ')}
                    </span>
                  </span>
                  <span className={styles.fillerQuote}>“{m.text}”</span>
                </div>
              ))}
            </>
          )}

          {use.fillers > 0 && (
            <div className={styles.breakdownCaveat}>
              Counted from the transcript as it was stored, so it is only as complete as the notetaker that
              wrote it — some clean up hesitations before you ever see them. Compare this with your own other
              calls rather than a published benchmark. “So” and “well” count only when they open a sentence,
              and “right” only as a tag question, so ordinary uses of those words aren’t held against you.
              Any word you don’t count as filler can be ignored, and every number here drops it.
            </div>
          )}
        </>
      )}

      {/* Kept outside the branch above so an ignored word can always be
          brought back — including on a call with no words of yours to
          count, where the rest of this block has nothing to show. */}
      {ignoredList.length > 0 && (
        <div className={styles.fillerIgnoredBlock}>
          <div className={styles.fillerIgnoredRow}>
            <span className={styles.fillerIgnoredLabel}>Ignored</span>
            {ignoredList.map(f => (
              <button
                key={f.id}
                type="button"
                className={styles.fillerIgnoredChip}
                onClick={() => onToggleIgnored?.(f.id)}
                title={`Count “${f.label}” again`}
              >
                {/* Struck through on the word alone: it is still in the
                    transcript, it is just not being counted. */}
                <span className={styles.fillerIgnoredWord}>{f.label}</span>
                {/* What ignoring it costs on THIS call, so the number it
                    was taken out of is still knowable. */}
                {f.count > 0 && <span className={styles.fillerIgnoredCount}>{f.count}</span>}
                <span aria-hidden="true">↺</span>
              </button>
            ))}
            {ignoredList.length > 1 && (
              <button type="button" className={styles.fillerIgnoredAll} onClick={onRestoreAll}>
                Count all again
              </button>
            )}
          </div>
          <div className={styles.breakdownCaveat}>
            Left out of every filler number on this tab — this call, the columns beside it and the average
            above them{use.hidden > 0 ? `, which drops ${use.hidden} filler${use.hidden === 1 ? '' : 's'} from this call` : ''}.
            {' '}Click one to count it again.
          </div>
        </div>
      )}
    </div>
  );
}

// One call's talk-time breakdown, for the Breakdown subtab.
//
// The headline is deliberately two numbers and not a chart: "was that
// call me or them" is a single comparison, and a per-speaker chart makes
// the reader do the summing that the question is about. The speaker list
// under it is the detail behind those two numbers, in the same order the
// bar draws them.
function BreakdownDetail({ row, fillerStats, ignoredFillers, onToggleIgnored, onRestoreAll }) {
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

      {/* Under the split on purpose: how much you talked is the first
          question, what it was padded with is the one after it. */}
      <FillerWords
        use={row.fillers}
        totals={fillerStats}
        ignored={ignoredFillers}
        onToggleIgnored={onToggleIgnored}
        onRestoreAll={onRestoreAll}
      />
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
  // The auto-N/A rules panel: open state, the text being typed, and
  // whether a bulk apply is running.
  const [showNaRules, setShowNaRules] = useState(false);
  const [naRuleDraft, setNaRuleDraft] = useState('');
  const [applyingNaRules, setApplyingNaRules] = useState(false);
  const [breakdownQuery, setBreakdownQuery] = useState('');
  // Which call the Breakdown subtab is showing. Empty means "the newest
  // one", resolved below against the filtered list rather than stored, so
  // a filter that hides the pick lands on a call that is actually there.
  const [breakdownPick, setBreakdownPick] = useState('');
  // Filler words the user has taken out of the KPIs. Persisted — unlike
  // the pick and the search box, this is a standing opinion about what
  // counts as a filler for them, not how they are working right now.
  const [ignoredFillers, setIgnoredFillers] = useState(() => loadIgnoredFillers());
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
  // When the visible call list was last brought up to date, for any
  // source and by any route (first load, the Refresh / Sync buttons, the
  // hourly ticker). 0 means "never on this account", which is what makes
  // the first visit pull immediately instead of waiting out the hour.
  const lastRefreshedAt = useRef(0);
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
  // Default ON: a transcript nobody has summarised is the state the user
  // asked us to stop leaving them in. Opting out is explicit, so an
  // account that never set it still gets summaries.
  const autoSummarize = settings.callRecordingsAutoSummarize !== false;

  // Meeting names that never belong to an opportunity. Stored in synced
  // settings rather than per-browser: a recurring 1:1 is one on every
  // machine, and re-typing the list is exactly the work this removes.
  const naRules = useMemo(
    () => normalizeRules(settings.callRecordingsNaRules || []),
    [settings.callRecordingsNaRules],
  );
  // Kept in a ref for the sync path, which runs inside a callback that
  // must not be rebuilt (and re-armed) every time the list is edited.
  const naRulesRef = useRef(naRules);
  useEffect(() => { naRulesRef.current = naRules; }, [naRules]);

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

  // `background` is the hourly ticker rather than a button: it draws no
  // spinner, and a failure leaves the list and the error banner exactly as
  // they were. A refresh nobody asked for should never blank the cards
  // someone is reading, or plant an error over a page that is working —
  // pressing Refresh is still there to surface the real state.
  const loadRecordings = useCallback(async (folderPath, { background = false } = {}) => {
    // Stamped on the first line — before any await, and whatever the
    // outcome — so the mount load and the Refresh button both push the
    // hour out. Waiting until after `await getToken()` would let the
    // ticker, which re-runs the moment `connected` flips, start a second
    // listing on top of the one already in flight.
    lastRefreshedAt.current = Date.now();
    if (!background) setError('');
    const token = await getToken();
    if (!token) {
      setConnected(false);
      if (!background) setRecordings([]);
      return;
    }
    setConnected(true);
    if (!background) setLoading(true);
    try {
      const r = await apiFetch(`/api/onedrive-recordings?folder=${encodeURIComponent(folderPath)}`, {
        headers: { 'X-MS-Token': token },
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) {
        // The token is genuinely dead, so the badge flips either way —
        // that's the prompt to reconnect. Only the list is spared.
        setConnected(false);
        if (!background) setRecordings([]);
        return;
      }
      if (!r.ok) {
        if (background) return;
        setError(data.error || `Could not read OneDrive (HTTP ${r.status})`);
        setRecordings([]);
        return;
      }
      setRecordings(data.recordings || []);
      setSkipped(data.skipped || 0);
    } catch (err) {
      if (!background) setError(err?.message || String(err));
    } finally {
      if (!background) setLoading(false);
    }
  }, [getToken]);

  // ---- local folder --------------------------------------------------------
  // Same background contract as loadRecordings: the hourly re-read is
  // silent, and a folder that has since been moved or had its permission
  // revoked leaves the listing alone rather than emptying it.
  const readLocalFolder = useCallback(async (handle, { background = false } = {}) => {
    lastRefreshedAt.current = Date.now();
    if (!background) { setError(''); setLoading(true); }
    try {
      const { recordings: found, skipped: skip, truncated: cut } = await listFolderRecordings(handle);
      setRecordings(found);
      setSkipped(skip);
      setTruncated(cut);
    } catch (err) {
      if (background) return;
      setError(err?.message || String(err));
      setRecordings([]);
    } finally {
      if (!background) setLoading(false);
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
    // The new source has never been loaded in this session, whatever the
    // old one's clock said — let it pull immediately.
    lastRefreshedAt.current = 0;
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
    // A different account gets its own first-visit pull rather than
    // inheriting the previous one's place in the hour.
    lastRefreshedAt.current = 0;
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

  // How many stored calls carry an opp tag, whatever source they came
  // from. It is what the backfill has to work with, so it decides
  // whether that button can do anything at all.
  const taggedToOppCount = useMemo(
    () => Object.values(records).filter(r => String(r?.oppId || '').trim()).length,
    [records],
  );

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

  // The totals line is a count of whatever is filtered in, so a search or
  // a tag chip quietly narrows it. This is the way back to the numbers
  // for every stored call — one press, both filters.
  const historyNarrowed = historyQuery.trim() !== '' || oppTagFilter !== 'all';
  const showAllHistory = useCallback(() => {
    setHistoryQuery('');
    setOppTagFilter('all');
  }, []);

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
  const countedRows = useMemo(() => callBreakdownRows(records), [records]);
  // Ignoring a word is a second pass over counts already in hand, never a
  // re-read of the transcripts: toggling one off re-adds up what is
  // already there instead of re-tokenising every call the user has.
  const breakdownRows = useMemo(
    () => withIgnoredFillers(countedRows, ignoredFillers),
    [countedRows, ignoredFillers],
  );
  const filteredBreakdown = useMemo(
    () => filterBreakdownRows(breakdownRows, breakdownQuery),
    [breakdownRows, breakdownQuery],
  );
  // The average is over everything transcribed, not the filtered list: it
  // is what the picked call is being compared against, and a mean that
  // moved with the search box would compare it against a moving target.
  const breakdownStats = useMemo(() => breakdownAverages(breakdownRows), [breakdownRows]);
  // Filler-word usage across everything transcribed, for the same reason:
  // the picked call's rate only means something beside the user's own.
  const fillerStats = useMemo(() => fillerTotals(breakdownRows), [breakdownRows]);
  // Falls back to the newest match so the panel is never blank while
  // there is something to show — including right after a filter drops
  // whatever was picked.
  const pickedBreakdown = useMemo(() => (
    filteredBreakdown.find(r => r.id === breakdownPick) || filteredBreakdown[0] || null
  ), [filteredBreakdown, breakdownPick]);

  // The saved list belongs to the signed-in account, and this component can
  // mount before auth has said which one that is — so it is read again once
  // the uid lands rather than leaving one account looking at another's.
  useEffect(() => { setIgnoredFillers(loadIgnoredFillers()); }, [uid]);

  // Ignore a filler word, or bring it back. Saved as it is toggled: the
  // page has no Save button, and a preference that only survived while the
  // tab was open would have to be re-set every morning.
  function toggleFillerIgnored(id) {
    setIgnoredFillers(prev => saveIgnoredFillers(toggleIgnoredFiller(prev, id)));
  }

  function restoreAllFillers() {
    setIgnoredFillers(saveIgnoredFillers([]));
  }

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
          // The ⟳ says a rule did this rather than the user. Without it,
          // a page that marked 200 calls N/A on its own would be
          // indistinguishable from 200 the user had worked through.
          return (
            <span
              className={styles.historyNa}
              title={[
                r.oppNaRule ? `Marked N/A automatically by the rule “${r.oppNaRule}”` : 'Belongs to no opportunity',
                r.oppNaAt ? fmtWhen(r.oppNaAt) : '',
              ].filter(Boolean).join(' · ')}
            >N/A{r.oppNaRule ? ' ⟳' : ''}</span>
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

  /**
   * Pull calls from Granola into the stored records, reporting into this
   * page's own sync banner.
   *
   * The walk itself lives in utils/runGranolaSync so the app-level hourly
   * hook can run the identical thing from any tab — see
   * hooks/useGranolaAutoSync. This wrapper is the UI half: it owns the
   * spinner, the progress note and the error banner.
   */
  const syncGranola = useCallback(async ({ full = false } = {}) => {
    if (!uid || syncing) return;
    // Any sync resets the hourly clock, including one the user started by
    // hand. Without this, a manual sync that clears a timed-out status
    // would let the ticker fire straight after it and walk the same
    // window twice.
    lastRefreshedAt.current = Date.now();
    setSyncing(true);
    setError('');
    setSyncNote('Checking Granola for new calls…');
    try {
      const outcome = await runGranolaSync({
        uid,
        full,
        prospects,
        settings,
        updateSettings,
        naRules: naRulesRef.current,
        getStored: (id) => recordsRef.current[id] || null,
        persist,
        onProgress: (p) => setSyncNote(`Syncing… ${p.imported + p.updated} call${p.imported + p.updated === 1 ? '' : 's'} so far`),
      });
      if (outcome.worked) {
        // The sync just did what the probe couldn't, so a status left
        // unknown by a timed-out check is now answered. Clearing it takes
        // the stale warning off a page that has visibly just worked.
        setGranolaStatus(prev => (prev?.timedOut ? { configured: true, ok: true, error: '' } : prev));
      }
      setSyncNote(outcome.note);
      if (outcome.error) setError(outcome.error);
    } finally {
      setSyncing(false);
    }
  }, [uid, syncing, prospects, settings, updateSettings, persist]);

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

  /**
   * Every opp already mapped to a call, told which call that was.
   *
   * Tagging stamps the opp with the call, but only from the day that
   * started happening — an opp mapped before then carries nothing, and
   * its notes name no conversation even though the mapping is sitting
   * right there on the call record. This reads the mappings already
   * loaded on this page and writes what tagging those same calls in date
   * order would have written.
   *
   * Only ever fills a blank or corrects a stamp to a newer call, and
   * only ever writes the opps that would actually change, so running it
   * again does nothing. It touches no other field on the opp: not the
   * notes, not the steps, not Last Spoke.
   */
  const backfillOppCallRefs = useCallback(async () => {
    setSyncNote('Looking for opps that don’t name their last call…');
    try {
      const cache = await loadOppsFromCache();
      const opps = cache?.records || [];
      if (opps.length === 0) {
        setSyncNote('No opps are loaded: open the Opps 2 tab once and try again.');
        return;
      }
      const { patches, opps: count, calls } = backfillLastCallPatches(recordsRef.current, opps);
      if (count === 0) {
        setSyncNote('Every opp with a mapped call already names it — nothing to backfill.');
        return;
      }
      // One load/save for the whole batch: a loop of single-opp writes
      // would rewrite the entire dataset once per opp, and could stop
      // halfway with the job half done.
      const written = await bulkSetOppFields(uid, patches);
      setSyncNote(
        `Named the most recent call on ${written} opp${written === 1 ? '' : 's'}`
        + `, from ${calls} mapped call${calls === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setSyncNote(`Couldn’t backfill the call references: ${err?.message || err}`);
    }
  }, [uid]);

  /**
   * The follow-ups every already-mapped call never got to give its opp.
   *
   * Same catch-up as the reference backfill, for the other half of what
   * tagging writes — but kept as its own button behind its own confirm,
   * because the two are not the same kind of write. A reference is one
   * field the opp didn't have; steps land in a checklist the user works
   * off and reads every day, and steps from a call last spring are as
   * likely to be already done as to be news.
   *
   * So it says exactly how much it is about to add, and to how many opps,
   * and does nothing unless that is accepted. Append-only and deduped
   * like every other path into this field: it can add lines, never edit
   * or remove one, and pressing it twice adds nothing the second time.
   */
  const backfillOppNextSteps = useCallback(async () => {
    setSyncNote('Looking for steps your mapped calls never sent…');
    try {
      const cache = await loadOppsFromCache();
      const opps = cache?.records || [];
      if (opps.length === 0) {
        setSyncNote('No opps are loaded: open the Opps 2 tab once and try again.');
        return;
      }
      const { patches, opps: count, steps, calls } = backfillNextStepPatches(recordsRef.current, opps);
      if (count === 0) {
        setSyncNote('Every opp already has the steps from the calls mapped to it — nothing to backfill.');
        return;
      }
      const ok = window.confirm(
        `Add ${steps} next step${steps === 1 ? '' : 's'} to ${count} opp${count === 1 ? '' : 's'}, `
        + `from ${calls} call${calls === 1 ? '' : 's'} already mapped to them?\n\n`
        + 'These are the follow-ups those calls would have sent when they were tagged. Older calls are '
        + 'included, so some may already be done.\n\n'
        + 'Steps are added to the end of each list. Nothing you have written is edited or removed.',
      );
      if (!ok) {
        setSyncNote('Left the notes alone.');
        return;
      }
      // One load/save for the whole batch, same as the reference
      // backfill: a loop of single-opp writes rewrites the entire dataset
      // once per opp and can stop halfway with the job half done.
      const written = await bulkSetOppFields(uid, patches);
      // The call records are deliberately NOT stamped with what they gave
      // here. `nextStepsPushed` is written per call by the live path; a
      // backfill would need one write per call to keep it honest, and the
      // steps are already on the opps either way.
      setSyncNote(
        `Added ${steps} next step${steps === 1 ? '' : 's'} to ${written} opp${written === 1 ? '' : 's'}`
        + `, from ${calls} mapped call${calls === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setSyncNote(`Couldn’t backfill the next steps: ${err?.message || err}`);
    }
  }, [uid]);

  // One re-list of whichever source is selected. Granola is deliberately
  // absent: its hourly sync runs at the app level (hooks/useGranolaAutoSync)
  // so it keeps working from any tab, and duplicating it here would have
  // the two clocks walking the same window.
  //
  // Returns whether a pull was actually started. A source that isn't ready
  // yet — OneDrive before its token check — must NOT count as a refresh, or
  // the first visit would stamp the clock without pulling and then sit out
  // the whole hour.
  const refreshNow = useCallback(() => {
    if (source === 'granola') return false;
    if (source === 'onedrive') {
      if (!connected) return false;
      loadRecordings(folder, { background: true });
      return true;
    }
    // The <input webkitdirectory> fallback leaves no handle to re-read,
    // and a folder whose permission has lapsed needs a user gesture — so
    // neither can be refreshed without the user, and both sit this out.
    if (!folderHandle || needsPermission) return false;
    readLocalFolder(folderHandle, { background: true });
    return true;
  }, [source, connected, folder, loadRecordings, folderHandle, needsPermission, readLocalFolder]);

  // Read through a ref so the ticker below doesn't have to list
  // refreshNow as a dependency: it changes identity on nearly every
  // render (syncGranola closes over `settings` and `syncing`), which
  // would tear down and re-arm the interval constantly.
  const refreshNowRef = useRef(refreshNow);
  refreshNowRef.current = refreshNow;

  // Keep the file-backed sources current for as long as the page is open:
  // both load on mount, which stamps the clock, so the first re-list lands
  // an hour later.
  //
  // The deps are the readiness signals rather than the callback, so a
  // source that becomes ready — OneDrive connecting, a local folder being
  // granted — gets its first pull the moment it can serve one instead of
  // waiting up to a minute for the next tick.
  useEffect(() => {
    const tick = () => {
      if (Date.now() - lastRefreshedAt.current < AUTO_REFRESH_MS) return;
      // Stamp when the pull starts, not when it lands: it is asynchronous
      // and the ticker runs again in a minute, so an unstamped in-flight
      // refresh would be started over and over until it finished. A pull
      // that failed still counts, which keeps a broken source from being
      // retried every minute for the rest of the session.
      if (refreshNowRef.current()) lastRefreshedAt.current = Date.now();
    };
    tick();
    const timer = setInterval(tick, AUTO_REFRESH_CHECK_MS);
    // Coming back to a tab that has been in the background is the moment
    // a stale list is most obvious, and the throttled ticker may not have
    // noticed yet.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [source, connected, folderHandle, needsPermission]);

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

  async function tagOpp(recordingId, opp) {
    const rec = visible.find(r => r.id === recordingId);
    setOppPickerFor(null);
    const saved = await persist(recordingId, {
      ...(rec ? metaFor(rec) : {}),
      ...tagOppPatch(opp, {
        label: oppLabel(opp),
        company: recordsRef.current[recordingId]?.company || '',
      }),
    });
    // Saying which deal this call belongs to is what makes its follow-ups
    // that deal's next steps, and what makes it that deal's last
    // conversation — so both go on now rather than waiting for a second
    // button. A call not yet summarised contributes no steps; the
    // reference still lands, and summarising it later sends the steps
    // then, on the tag this made.
    if (!saved?.oppId) return;
    try {
      await recordCallOnOpp({ uid, recordingId, record: saved, persist });
    } catch (err) {
      // The tag itself is saved; only the copy onto the opp failed. Say
      // which, so the user doesn't re-tag chasing a step that landed.
      setErrorFor(recordingId, `Tagged, but this call didn’t reach the opp’s notes: ${err?.message || err}`);
    }
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

  // Undoes either decision — back into the queue. Also marks the call as
  // the user's, so a rule that matches its name doesn't put it straight
  // back on the next sync.
  async function untagOpp(recordingId) {
    const previous = recordsRef.current[recordingId] || null;
    await persist(recordingId, clearOppTagPatch());
    // The opp may be naming this call as its last conversation. Left
    // alone it would keep doing so after the call stopped belonging to
    // it — a wrong answer where a blank is an honest one.
    //
    // The next steps it contributed are NOT taken back: they were
    // appended to a list the user works off and may have reworded,
    // reordered, or already done, and silently deleting lines out of a
    // checklist is the one thing this whole path has been careful not to
    // do. Untagging is a correction about which deal a call belongs to,
    // not an undo of the work it generated.
    if (!previous?.oppId) return;
    try {
      const cache = await loadOppsFromCache();
      const opp = (cache?.records || []).find(r => String(r?._id) === String(previous.oppId));
      const patch = opp ? clearLastCallPatch(opp, recordingId) : null;
      if (patch) await setOppFields(uid, previous.oppId, patch);
    } catch (err) {
      setErrorFor(recordingId, `Untagged, but the opp still names this call: ${err?.message || err}`);
    }
  }

  // ---- auto-N/A rules --------------------------------------------------------

  // Stored calls the current rules would newly mark N/A. Computed over
  // every record, not just the visible source: the backlog a rule is
  // written to clear is usually older than whatever is on screen.
  const naRuleMatches = useMemo(
    () => autoNaMatches(records, naRules),
    [records, naRules],
  );

  function saveNaRules(next) {
    updateSettings?.({ callRecordingsNaRules: normalizeRules(next).map(r => r.text) });
  }

  function addNaRule(text) {
    const rule = normalizeRule(text);
    if (!rule) return false;
    if (naRules.length >= MAX_NA_RULES) return false;
    // Already covered — by this exact rule or a broader one. Adding it
    // would be a no-op the user couldn't see, so say nothing changed.
    if (naRules.some(r => rule.key.includes(r.key))) return false;
    saveNaRules([...naRules.map(r => r.text), rule.text]);
    return true;
  }

  function removeNaRule(key) {
    saveNaRules(naRules.filter(r => r.key !== key).map(r => r.text));
  }

  /**
   * Apply the rules to everything already stored.
   *
   * A rule written today is usually about a meeting that has been
   * recurring for months, so the backlog is the point. Deliberately a
   * button rather than something that happens on its own: this writes
   * one record per call, and the count it will write is on the button.
   */
  async function applyNaRules() {
    const matches = naRuleMatches;
    if (matches.length === 0) return;
    const message = matches.length === 1
      ? `Mark 1 call as N/A?\n\n${matches[0].name}`
      : `Mark ${matches.length} calls as N/A?\n\n`
        + matches.slice(0, 8).map(m => `• ${m.name}`).join('\n')
        + (matches.length > 8 ? `\n…and ${matches.length - 8} more` : '');
    if (!window.confirm(message)) return;
    setApplyingNaRules(true);
    try {
      // Sequential, not in parallel: each write goes through the same
      // optimistic-state merge, and firing hundreds at once is how a
      // Firestore write queue starts refusing them.
      for (const match of matches) {
        await persist(match.id, autoNaPatch(match.rule));
      }
    } finally {
      setApplyingNaRules(false);
    }
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
  // The solve itself lives in utils/runCallSummary.js so the app-level
  // background pass (hooks/useGranolaAutoSync) can summarise a call from
  // wherever the user is, without this page being mounted. Both go through
  // the same function, so a summary means the same thing either way.
  const pushToOppFor = useCallback(
    (recordingId, record) => pushSummaryToOpp({ uid, recordingId, record, persist }),
    [uid, persist],
  );

  async function summarize(rec) {
    const id = rec.id;
    const stored = recordsRef.current[id] || {};
    const live = transcripts[id];
    const transcript = (live?.status === 'completed' ? live.text : '') || stored.transcript || '';
    setErrorFor(id, '');
    setBusyFor(id, 'summarizing');
    try {
      const { ok, error, oppError } = await runCallSummary({
        uid,
        recordingId: id,
        record: stored,
        transcript,
        meta: metaFor(rec),
        autoPush,
        persist,
      });
      if (!ok) {
        setErrorFor(id, error);
        return;
      }
      if (oppError) setErrorFor(id, oppError);
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
      await pushToOppFor(id, recordsRef.current[id]);
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
            title="When on, a transcribed call is summarized in the background — up to three per hourly check, newest first — so its summary is on the opp without anyone opening this page. Calls marked N/A are left alone."
          >
            <input
              type="checkbox"
              checked={autoSummarize}
              onChange={e => updateSettings?.({ callRecordingsAutoSummarize: e.target.checked })}
            />
            Auto-summarize transcribed calls
          </label>
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
          <button
            type="button"
            className={styles.btn}
            onClick={() => setShowNaRules(v => !v)}
            title="Meeting names that never belong to an opportunity: calls matching one are marked N/A automatically"
          >
            {showNaRules ? '▾' : '▸'} Auto-N/A rules
            {naRules.length > 0 && <span className={styles.naRuleBadge}>{naRules.length}</span>}
          </button>
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

      {/* Auto-N/A rules. A calendar is mostly recurrences, and every one
          of them asks the triage queue the same question it asked last
          week — so answer it once, by name. */}
      {showNaRules && (
        <div className={styles.naRules}>
          <div className={styles.naRulesHead}>
            Mark calls N/A automatically by meeting name
          </div>
          <form
            className={styles.naRuleAdd}
            onSubmit={(e) => {
              e.preventDefault();
              if (addNaRule(naRuleDraft)) setNaRuleDraft('');
            }}
          >
            <input
              className={styles.input}
              type="text"
              value={naRuleDraft}
              onChange={e => setNaRuleDraft(e.target.value)}
              placeholder="e.g. Prospecting Time, Weekly 1:1, Office Hours"
              maxLength={200}
              aria-label="Meeting name to mark N/A"
            />
            <button
              type="submit"
              className={styles.btn}
              disabled={!normalizeRule(naRuleDraft) || naRules.length >= MAX_NA_RULES}
              title={naRules.length >= MAX_NA_RULES
                ? `That's the limit of ${MAX_NA_RULES} rules`
                : 'Add this name as a rule'}
            >Add rule</button>
          </form>

          {/* What the draft would catch, before it is a rule. Matching on
              a substring is easy to get wrong in the direction that
              matters — a short word swallowing real client calls — so
              the count is shown while there is still nothing to undo. */}
          {normalizeRule(naRuleDraft) && (() => {
            const preview = autoNaMatches(records, [naRuleDraft]);
            return (
              <div className={styles.naRulePreview}>
                {preview.length === 0
                  ? 'No untagged call matches that name yet. It still applies to calls that arrive later.'
                  : `Matches ${preview.length} untagged call${preview.length === 1 ? '' : 's'}: ${preview.slice(0, 3).map(m => m.name).join(', ')}${preview.length > 3 ? `, +${preview.length - 3} more` : ''}`}
              </div>
            );
          })()}

          {naRules.length > 0 && (
            <div className={styles.naRuleList}>
              {naRules.map(rule => (
                <span key={rule.key} className={styles.naRuleChip}>
                  {rule.text}
                  <button
                    type="button"
                    className={styles.naRuleRemove}
                    onClick={() => removeNaRule(rule.key)}
                    title={`Stop marking “${rule.text}” N/A. Calls it already marked keep their N/A.`}
                    aria-label={`Remove rule ${rule.text}`}
                  >×</button>
                </span>
              ))}
            </div>
          )}

          <div className={styles.naRuleFoot}>
            <span className={styles.naRuleNote}>
              {describeNaRules({ rules: naRules, matches: naRuleMatches.length, total: Object.keys(records).length })}
            </span>
            {naRuleMatches.length > 0 && (
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={applyNaRules}
                disabled={applyingNaRules}
              >
                {applyingNaRules
                  ? 'Marking…'
                  : `Mark ${naRuleMatches.length} call${naRuleMatches.length === 1 ? '' : 's'} N/A`}
              </button>
            )}
          </div>
          <div className={styles.naRuleNote}>
            Rules never touch a call you tagged or cleared yourself, and matching ignores case,
            punctuation, and a “Canceled:” prefix.
          </div>
        </div>
      )}

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
          {/* A one-off catch-up for the opps tagged before their notes
              could name the call. Left as a button rather than run on
              load: it writes to opps, and a page opening shouldn't
              quietly edit a hundred deals. Safe to press twice — the
              second press finds nothing to do. */}
          <button
            type="button"
            className={styles.btn}
            onClick={backfillOppCallRefs}
            disabled={syncing || taggedToOppCount === 0}
            title={taggedToOppCount === 0
              ? 'No call is tagged to an opportunity yet'
              : `Give every opp already mapped to a call the reference its notes show. ${taggedToOppCount} call${taggedToOppCount === 1 ? ' is' : 's are'} tagged to an opp.`}
          >Backfill call refs on opps</button>
          {/* The other half of the same catch-up, kept separate because
              it writes into the checklist the user works off rather than
              a field they never filled in. It asks first. */}
          <button
            type="button"
            className={styles.btn}
            onClick={backfillOppNextSteps}
            disabled={syncing || taggedToOppCount === 0}
            title={taggedToOppCount === 0
              ? 'No call is tagged to an opportunity yet'
              : 'Add the follow-ups from calls already mapped to an opp onto that opp’s notes.'
                + ' Says how many before it writes anything, and only ever adds to the end of a list.'}
          >Backfill next steps on opps</button>
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
            {/* Only when something is actually narrowing the totals: with
                nothing filtered they already cover every call, and a
                button that does nothing reads as one that's broken. */}
            {historyNarrowed && (
              <button
                type="button"
                className={styles.showAllBtn}
                onClick={showAllHistory}
                title={`These numbers cover ${totals.calls} of your ${historyRows.length} stored call`
                  + `${historyRows.length === 1 ? '' : 's'}. Clear the search and the tag filter to count them all.`}
              >
                Show all {historyRows.length} calls
              </button>
            )}
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
            {/* The filler-word habit across every measured call. It sits
                beside the talk-time average because it is the same kind
                of fact — a property of how the user talks, not of the
                call they happen to have picked — and because the rate is
                only readable next to the calls it came from. */}
            {!recordsReadError && fillerStats.measured > 0 && (
              <div className={styles.breakdownSummary}>
                <strong>{formatRate(fillerStats.per100Words)}</strong> filler words per 100 you spoke —{' '}
                {fillerStats.fillers.toLocaleString()} in all, across {fillerStats.measured} call
                {fillerStats.measured === 1 ? '' : 's'}
                {fillerStats.byFiller[0] && <> · most often “{fillerStats.byFiller[0].label}”</>}
                {/* A rate that quietly excluded words would be the one
                    number on the page nobody could reproduce, so what is
                    being left out is named where the total is read. */}
                {fillerStats.hidden > 0 && (
                  <span className={styles.transcriptStatus}>
                    {' '}· not counting {fillerStats.ignored.map(f => `“${f.label}”`).join(', ')}
                    {' '}({fillerStats.hidden.toLocaleString()} left out)
                  </span>
                )}
                {/* Named rather than silently ranked: a 40-word call with
                    one "so" in it rates worse than any real call, so the
                    best/worst pair leaves short calls out and says so. */}
                {fillerStats.worst && (
                  <span className={styles.transcriptStatus}>
                    {' '}· cleanest {formatRate(fillerStats.cleanest.per100Words)}, heaviest{' '}
                    {formatRate(fillerStats.worst.per100Words)}
                    {fillerStats.shortCalls > 0
                      && ` (${fillerStats.shortCalls} call${fillerStats.shortCalls === 1 ? '' : 's'} under `
                        + `${MIN_RATE_WORDS} words left out of that range)`}
                  </span>
                )}
              </div>
            )}
            {/* The averages above are taken over every transcribed call,
                but the search narrows the list under them — so while one
                is on, the numbers and the calls you can see disagree.
                This puts the whole basis back on screen. */}
            {!recordsReadError && breakdownQuery.trim() !== '' && (
              <button
                type="button"
                className={styles.showAllBtn}
                onClick={() => setBreakdownQuery('')}
                title={`The numbers above cover all ${breakdownRows.length} transcribed call`
                  + `${breakdownRows.length === 1 ? '' : 's'}; the list is showing the `
                  + `${filteredBreakdown.length} that match your search. Clear it to see them all.`}
              >
                Show all {breakdownRows.length} calls
              </button>
            )}
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
              ) : (
                /* A table rather than a stack of cards: the filler-word
                   rates only mean anything read against each other, and
                   four numbers per call can't line up into columns unless
                   they are in columns. The picked call is still picked by
                   clicking its row. */
                <table className={styles.pickTable}>
                  <colgroup>
                    <col />
                    <col className={styles.pickColNum} />
                    <col className={styles.pickColCount} />
                    <col className={styles.pickColRate} />
                    <col className={styles.pickColNum} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Call</th>
                      <th scope="col" className={styles.pickNum} title="Share of the call you spoke">You</th>
                      <th scope="col" className={styles.pickNum} title="Filler words in your turns">Filler</th>
                      <th scope="col" className={styles.pickNum} title="Filler words per 100 words you spoke">/100w</th>
                      <th scope="col" className={styles.pickNum} title="Filler words per minute of your talk time — only for calls where every one of your turns was timed">/min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBreakdown.map(r => {
                      // words === 0 is a transcript with timings but no
                      // text of yours: nothing to count fillers in, which
                      // is a dash, not a zero.
                      const use = r.fillers && r.fillers.words > 0 ? r.fillers : null;
                      // A rate off a handful of words isn't comparable to
                      // the rest of the column — the summary above already
                      // holds these calls out of cleanest/heaviest, so the
                      // cell says the same thing rather than sitting in
                      // the column looking authoritative.
                      const thin = use ? use.words < MIN_RATE_WORDS : false;
                      const on = pickedBreakdown?.id === r.id;
                      return (
                        <tr
                          key={r.id}
                          className={on ? styles.pickRowOn : styles.pickRow}
                          onClick={() => setBreakdownPick(r.id)}
                          title={[
                            r.measurable
                              ? `You spoke ${formatShare(r.youShare)} of this call`
                              : r.blockedReason,
                            use
                              ? `${use.fillers} filler word${use.fillers === 1 ? '' : 's'}`
                                + ` in the ${use.words.toLocaleString()} words you spoke`
                              : '',
                          ].filter(Boolean).join(' · ')}
                        >
                          <td>
                            {/* The focusable element of the row: a click on
                                it bubbles to the row's handler, so Enter
                                and Space pick the call the same way the
                                old list of buttons did. */}
                            <button type="button" className={styles.pickName}>{r.name}</button>
                            <span className={styles.pickMeta}>
                              {[fmtWhen(r.recordedAt) || 'No date', r.company].filter(Boolean).join(' · ')}
                            </span>
                          </td>
                          <td className={styles.pickNum} data-measured={r.measurable ? 'true' : 'false'} data-share="true">
                            {r.measurable ? formatShare(r.youShare) : '—'}
                          </td>
                          <td className={styles.pickNum} data-measured={use ? 'true' : 'false'}>
                            {use ? use.fillers.toLocaleString() : '—'}
                          </td>
                          <td
                            className={styles.pickNum}
                            data-measured={use ? 'true' : 'false'}
                            data-thin={thin ? 'true' : 'false'}
                            title={thin
                              ? `Only ${use.words} words — too few for this rate to compare with the others`
                              : undefined}
                          >
                            {use ? formatRate(use.per100Words) : '—'}
                          </td>
                          <td className={styles.pickNum} data-measured={use?.perMinute != null ? 'true' : 'false'}>
                            {use?.perMinute != null ? formatRate(use.perMinute) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div className={styles.breakdownDetail}>
            {pickedBreakdown ? (
              <BreakdownDetail
                row={pickedBreakdown}
                fillerStats={fillerStats}
                ignoredFillers={ignoredFillers}
                onToggleIgnored={toggleFillerIgnored}
                onRestoreAll={restoreAllFillers}
              />
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
                      title={isAutoNa(stored)
                        ? `Marked N/A automatically by the rule “${stored.oppNaRule}”`
                        : 'Marked as belonging to no opportunity — this call is done being triaged'}
                    >N/A{isAutoNa(stored) ? ' ⟳' : ''}</span>
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
                {/* Steps appearing on an opp the user didn't type them
                    into should be traceable to the call that wrote them.
                    Shown on its own because it can happen at tag time,
                    with no summary push behind it. */}
                {stored?.nextStepsPushed > 0 && (
                  <div className={styles.pushedNote}>
                    {stored.nextStepsPushed} next step{stored.nextStepsPushed === 1 ? '' : 's'} added to
                    {' '}{stored.oppLabel || 'the opp'}’s Notes.
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
