// Client side of the Granola ingest.
//
// Granola is the primary way call data reaches the Call Recordings page:
// a note arrives already transcribed and summarised by Granola, so there
// is no file to play, nothing to upload, and no transcription job to
// wait on. The page's job is to store it, work out which company and
// opportunity it belongs to, and let the existing summarise / push-to-opp
// machinery run on top.
//
// Everything here is pure fetch + mapping. /api/granola-calls has already
// normalised Granola's payloads; this module turns them into the record
// shape callRecordingsStore.js persists, and works out the company link.

import { apiFetch, isStalled } from './apiFetch';
import {
  buildCompanyGuessIndex, guessCompanyForContact, FREE_MAIL_DOMAINS,
} from './companyGuess';
import { diagnoseEmptySync, describeGranolaCalendar } from './granolaShape';

// Re-exported so callers importing the Granola client get the wording
// helpers alongside it, wherever they actually live.
export { describeMissingKey, describeGranolaConnection } from './granolaShape';

// How far back a first-ever sync reaches. Everything after that is
// incremental (updated_after the last sync), so this only bites once.
export const DEFAULT_BACKFILL_DAYS = 90;

// How far back the Activity page's meeting import reaches. Shorter than
// the call back-fill on purpose: that one is building an archive of
// calls to summarise, this one is filling a calendar view whose whole
// point is the last few weeks and today.
export const DEFAULT_MEETING_WINDOW_DAYS = 30;

// Stop a runaway back-fill from paging forever on a large workspace.
const MAX_PAGES = 20;

// A ceiling on any one request to our own route. The route already
// bounds its call to Granola, so this only catches the layers below it
// — a cold function that never wakes, a connection that drops. Without
// it the page can sit on "Checking Granola…" forever, which reads as
// broken with nothing to act on.
const REQUEST_TIMEOUT_MS = 45000;

// The probe gets a tighter one. It runs on every visit to the tab and
// blocks the status pill, and the route bounds its own call to Granola at
// 20s — so anything past this is a stall below that, not a slow answer on
// its way.
const PROBE_TIMEOUT_MS = 30000;

// Marker resolved by the deadline below. A sentinel rather than a
// rejection so the race can tell "the clock won" from "the request threw".
const TIMED_OUT = Symbol('granola-timeout');

/**
 * A wall-clock deadline for one request.
 *
 * An abort signal alone isn't enough here for two reasons:
 * AbortSignal.timeout doesn't exist on every browser we run in (older
 * Safari), and even where it does it only reaches the fetch — apiFetch
 * first awaits a Firebase ID token, and a token refresh that never
 * settles is outside any signal's reach. So callers get both: a signal
 * that aborts the request, and `expired`, which resolves no matter which
 * layer stalled. Call `done()` to stop the timer once the work settles.
 */
function deadline(ms = REQUEST_TIMEOUT_MS) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const expired = new Promise(resolve => {
    timer = setTimeout(() => {
      try { controller?.abort(); } catch { /* already gone */ }
      resolve(TIMED_OUT);
    }, ms);
  });
  return {
    signal: controller?.signal,
    expired,
    done() { if (timer !== null) { clearTimeout(timer); timer = null; } },
  };
}

function isTimeout(err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

function domainOf(email) {
  const at = String(email || '').lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase().trim() : '';
}

async function readJson(response) {
  try { return await response.json(); } catch { return {}; }
}

/**
 * One request to our route, bounded by a deadline it cannot outlive.
 * Throws `whenSlow` if the clock wins, so a sync reports a stall rather
 * than hanging on a promise that never settles.
 */
async function request(url, whenSlow) {
  const clock = deadline();
  try {
    const result = await Promise.race([
      apiFetch(url, { signal: clock.signal }).catch(err => {
        if (isTimeout(err)) return TIMED_OUT;
        throw new Error(err?.message || String(err));
      }),
      clock.expired,
    ]);
    if (result === TIMED_OUT) throw new Error(whenSlow);
    return result;
  } finally {
    clock.done();
  }
}

// What a probe that never came back looks like. `timedOut` marks the
// status as unknown rather than bad: nothing was learned about Granola,
// so the page keeps the sync buttons live instead of locking the tab
// behind a check that failed on our side of the wire.
const PROBE_TIMED_OUT = {
  configured: true,
  ok: false,
  timedOut: true,
  error: 'The check for Granola timed out — that may be this page, not Granola. '
    + 'Calls already synced still show below: use Check again, or Sync calls to try anyway.',
};

async function runProbe(signal) {
  try {
    const r = await apiFetch('/api/granola-calls?probe=1', { signal });
    const data = await readJson(r);
    if (r.status === 501) {
      return { configured: false, ok: false, error: data.error || '', hint: data.hint || null };
    }
    if (!r.ok) return { configured: true, ok: false, error: data.error || `HTTP ${r.status}` };
    return { configured: true, ok: true, error: '' };
  } catch (err) {
    if (isTimeout(err)) return PROBE_TIMED_OUT;
    // A stall on our side of the wire says nothing about Granola either,
    // so it keeps the retry and the sync buttons live — but it carries
    // its own message, which names the layer that didn't answer.
    if (isStalled(err)) return { configured: true, ok: false, timedOut: true, error: err.message };
    return { configured: true, ok: false, error: err?.message || String(err) };
  }
}

/**
 * Is Granola configured and is the key live? Resolves to
 * { configured, ok, error, hint, timedOut } and never throws — the page
 * shows a setup message rather than an error banner when it comes back
 * unconfigured. `hint` carries which deployment answered and what it
 * could see, so "not configured" can name its own cause.
 *
 * Guaranteed to settle: the request races a deadline, so a stalled token
 * refresh or a request the browser never fails can no longer leave the
 * page on "Checking Granola…" with no way out.
 */
export async function probeGranola() {
  const clock = deadline(PROBE_TIMEOUT_MS);
  try {
    const status = await Promise.race([runProbe(clock.signal), clock.expired]);
    return status === TIMED_OUT ? PROBE_TIMED_OUT : status;
  } finally {
    clock.done();
  }
}


/** One page of note metadata. Throws with the API's own message. */
export async function fetchGranolaPage({ cursor = '', updatedAfter = '', createdAfter = '', limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  if (updatedAfter) params.set('updatedAfter', updatedAfter);
  if (createdAfter) params.set('createdAfter', createdAfter);
  const r = await request(
    `/api/granola-calls?${params.toString()}`,
    'Timed out listing calls from Granola.',
  );
  const data = await readJson(r);
  if (!r.ok) {
    const err = new Error(data.error || `Granola list failed (HTTP ${r.status})`);
    // Carried so a caller can tell "Granola isn't set up here" — which
    // wants a setup pointer — from "Granola said no", which wants an
    // error. Reading the message would work until someone reworded it.
    err.httpStatus = r.status;
    err.configured = data.configured !== false;
    throw err;
  }
  return {
    calls: data.calls || [],
    cursor: data.cursor || '',
    hasMore: !!data.hasMore,
    shape: data.shape || null,
  };
}

// Re-exported so callers keep one import for the Granola client. The
// function itself lives in a module with no imports, which is what lets
// it be tested under plain Node.
export { diagnoseEmptySync, describeGranolaCalendar };

/** One note in full, including its transcript. */
export async function fetchGranolaNote(noteId) {
  const r = await request(
    `/api/granola-calls?noteId=${encodeURIComponent(noteId)}`,
    'Timed out fetching this call from Granola.',
  );
  const data = await readJson(r);
  if (!r.ok) throw new Error(data.error || `Granola note fetch failed (HTTP ${r.status})`);
  return data.call || null;
}

// ---- company matching -------------------------------------------------------

/**
 * Work out which prospect a call was with, from who was on it.
 *
 * Granola records the meeting's invitees, so the other side's email
 * domain is usually enough. Attendees sharing the note owner's domain are
 * colleagues, and free-mail addresses say nothing about a company, so
 * both are skipped. Returns null when nothing matches — a wrong company
 * on a call is worse than no company, because the summary can be pushed
 * onto that company's opp.
 */
export function matchCompanyForCall(call, prospects, index) {
  const idx = index || buildCompanyGuessIndex(prospects || []);
  const ownDomain = domainOf(call?.owner?.email);

  for (const person of (call?.attendees || [])) {
    const domain = domainOf(person?.email);
    if (!domain || domain === ownDomain || FREE_MAIL_DOMAINS.has(domain)) continue;
    const company = guessCompanyForContact({ email: person.email, company: '' }, idx);
    if (!company) continue;
    const prospect = (prospects || []).find(p => String(p?.company || '') === company);
    if (prospect?.id) return { prospectId: prospect.id, company, matchedOn: person.email };
  }
  return null;
}

// ---- record mapping ---------------------------------------------------------

/**
 * The patch written to callRecordings for one Granola call.
 *
 * Granola's own summary is kept in its own field rather than in
 * `summary`: `summary` is what our Claude pass produces and what gets
 * pushed onto an opp, and overwriting it with Granola's would make a
 * re-sync silently replace text the user has already pushed.
 */
export function recordPatchFor(call) {
  const patch = {
    source: 'granola',
    name: call.name || '',
    path: '',
    recordedAt: call.recordedAt || null,
    durationSeconds: call.durationSeconds ?? null,
    granolaNoteId: call.noteId || '',
    granolaUrl: call.granolaUrl || '',
    granolaSummary: call.granolaSummary || '',
    granolaUpdatedAt: call.updatedAt || null,
    // The calendar meeting behind the note. Kept even on the Call
    // Recordings path: it costs nothing here and it is what the Activity
    // page's meeting rows are built from, so a call synced from either
    // page shows up on both.
    calendarEvent: call.calendarEvent || null,
    // Kept so attendee matching can be re-run later without a re-sync:
    // the owner's own domain is what tells colleagues from the other side.
    owner: call.owner || null,
    attendees: call.attendees || [],
    folders: call.folders || [],
    syncedAt: new Date().toISOString(),
  };

  // Granola transcribes as it records, so a synced note arrives in the
  // state the OneDrive path only reaches after a transcription job. The
  // transcript fields are only written when there IS one — a note served
  // without its transcript (a plan without transcript access, a note
  // still processing) must not blank the copy already stored.
  if (call.hasTranscript) {
    patch.transcript = call.transcript || '';
    patch.utterances = call.utterances || [];
    patch.transcriptStatus = 'completed';
    patch.transcriptError = '';
    patch.transcribedAt = new Date().toISOString();
  }
  return patch;
}

/**
 * A stored Granola record → the shape the recording cards render.
 * Lets the page list previously-synced calls without hitting Granola at
 * all, which is what makes the tab usable offline and on first paint.
 */
export function recordingFromStored(record) {
  return {
    id: record.id,
    noteId: record.granolaNoteId || String(record.id || '').replace(/^granola:/, ''),
    isGranola: true,
    name: record.name || 'Granola call',
    modified: record.recordedAt || null,
    created: record.recordedAt || null,
    recordedAt: record.recordedAt || null,
    durationSeconds: record.durationSeconds ?? null,
    size: 0,
    extension: '',
    mimeType: '',
    attendees: Array.isArray(record.attendees) ? record.attendees : [],
    folders: Array.isArray(record.folders) ? record.folders : [],
    granolaUrl: record.granolaUrl || '',
    granolaSummary: record.granolaSummary || '',
    syncedAt: record.syncedAt || null,
  };
}

// ---- sync -------------------------------------------------------------------

/**
 * Pull Granola notes and hand each one to `onCall`.
 *
 * Detail (the transcript) is fetched only for notes that are new or have
 * changed since they were last stored, so a routine sync of a workspace
 * with hundreds of notes costs a handful of requests rather than one per
 * note. `shouldFetchDetail` decides that; returning false skips the note
 * entirely and counts it in `skipped`. That only happens when nothing
 * about the note has changed, so there is no metadata to refresh either.
 *
 * `startCursor` resumes a walk that ran into MAX_PAGES last time. Without
 * it a workspace with more notes than MAX_PAGES pages can hold could
 * never finish: the watermark only advances on a complete sync, so every
 * retry re-walked the same first pages and stopped in the same place.
 *
 * Returns { imported, updated, skipped, errors, latest, truncated,
 * nextCursor, restarted }. `latest` is the newest updated_at seen — the
 * watermark for the next sync — and `nextCursor` is where to pick up when
 * `truncated` is set.
 */
export async function syncGranolaCalls({
  updatedAfter = '',
  createdAfter = '',
  startCursor = '',
  shouldFetchDetail = () => true,
  onCall,
  onProgress,
} = {}) {
  const result = { imported: 0, updated: 0, skipped: 0, errors: [], latest: updatedAfter || '', shape: null };
  let cursor = startCursor;
  let pages = 0;
  // Set when a stored cursor turned out to be stale and the window had to
  // be walked from the start instead.
  let restarted = false;

  do {
    let page;
    try {
      page = await fetchGranolaPage({ cursor, updatedAfter, createdAfter });
    } catch (err) {
      // Granola's cursors do not live forever. A stored one that has gone
      // stale would wedge every future sync on the same error, so give up
      // on it once and walk the window from the beginning — re-covering
      // ground is cheap next to a sync that can never run again.
      if (pages > 0 || !cursor) throw err;
      cursor = '';
      restarted = true;
      page = await fetchGranolaPage({ cursor, updatedAfter, createdAfter });
    }
    pages += 1;
    // Kept from the FIRST page: it describes the answer Granola gives
    // to this window, and a later page's shape would only overwrite it
    // with the same thing (or, on a walk that ended, with nothing).
    if (!result.shape) result.shape = page.shape || null;
    for (const summary of page.calls) {
      // No id means nothing to store this against. Counted rather than
      // dropped in silence — every note arriving this way is the whole
      // reason a sync can report success and import nothing.
      if (!summary.noteId) { result.skipped += 1; continue; }
      const stamp = summary.updatedAt || summary.createdAt || '';
      if (stamp > result.latest) result.latest = stamp;

      const mode = shouldFetchDetail(summary);
      if (!mode) { result.skipped += 1; continue; }

      try {
        const full = await fetchGranolaNote(summary.noteId);
        if (!full) { result.skipped += 1; continue; }
        const outcome = await onCall?.({ ...summary, ...full });
        if (outcome === 'updated') result.updated += 1;
        else result.imported += 1;
      } catch (err) {
        result.errors.push(`${summary.name || summary.noteId}: ${err?.message || err}`);
      }
      onProgress?.({ ...result, name: summary.name });
    }
    cursor = page.hasMore ? page.cursor : '';
  } while (cursor && pages < MAX_PAGES);

  result.truncated = !!cursor;
  result.nextCursor = cursor;
  result.restarted = restarted;
  return result;
}

/**
 * Pull the calendar meetings Granola took notes in, over a fixed window.
 *
 * This is the Activity page's import, and it is deliberately NOT the
 * call sync above. It wants the meeting, not the call: title, when it
 * ran, who was in it — all of which arrive in the list response. So it
 * never fetches a note in full, which is what makes it cheap enough to
 * run on a page the user opens all day.
 *
 * No watermark either. The window is re-read every time, and each note
 * is upserted onto the record it already has, so the import is
 * idempotent and carries no state that can drift out of step with the
 * Call Recordings sync — the two write to the same records and must be
 * able to run in any order.
 *
 * `onNote` stores one note and may return false to say it stored
 * nothing. Returns { seen, stored, errors, truncated }.
 */
export async function importGranolaMeetings({
  days = DEFAULT_MEETING_WINDOW_DAYS,
  onNote,
  onProgress,
} = {}) {
  const createdAfter = daysAgoIso(days);
  const result = { seen: 0, stored: 0, skipped: 0, errors: [], truncated: false, shape: null };
  let cursor = '';
  let pages = 0;

  do {
    const page = await fetchGranolaPage({ cursor, createdAfter, limit: 100 });
    pages += 1;
    if (!result.shape) result.shape = page.shape || null;
    for (const note of page.calls) {
      if (!note.noteId) { result.skipped += 1; continue; }
      result.seen += 1;
      try {
        const outcome = await onNote?.(note);
        if (outcome !== false) result.stored += 1;
      } catch (err) {
        result.errors.push(`${note.name || note.noteId}: ${err?.message || err}`);
      }
    }
    onProgress?.({ ...result });
    cursor = page.hasMore ? page.cursor : '';
  } while (cursor && pages < MAX_PAGES);

  result.truncated = !!cursor;
  return result;
}

/**
 * Ask Granola for the user's calendar — the Outlook sync behind its own
 * "Coming up" list.
 *
 * This is the only way a meeting that HASN'T HAPPENED can reach the
 * Activity page from Granola. The notes endpoints serve notes once they
 * have finished summarising, so by the time a meeting is in that list it
 * is over; a calendar endpoint would carry the schedule itself.
 *
 * Resolves to { events, supported, attempts } and never throws. When
 * `supported` is false, `attempts` says what every candidate path
 * answered — which is the whole point: it settles the question against
 * the user's own key instead of against a documentation page.
 */
export async function fetchGranolaCalendar({ from = '', to = '' } = {}) {
  const params = new URLSearchParams({ calendar: '1' });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  try {
    const r = await request(
      `/api/granola-calls?${params.toString()}`,
      'Timed out asking Granola for your calendar.',
    );
    const data = await readJson(r);
    if (!r.ok) {
      return {
        events: [],
        supported: false,
        attempts: [],
        error: data.error || `Granola calendar request failed (HTTP ${r.status})`,
        configured: data.configured !== false,
      };
    }
    return {
      events: data.events || [],
      supported: !!data.supported,
      attempts: data.attempts || [],
      error: '',
      configured: true,
    };
  } catch (err) {
    return { events: [], supported: false, attempts: [], error: err?.message || String(err), configured: true };
  }
}

/** ISO timestamp for `days` ago, used as the first sync's floor. */
export function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}
