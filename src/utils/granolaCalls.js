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

import { apiFetch } from './apiFetch';
import {
  buildCompanyGuessIndex, guessCompanyForContact, FREE_MAIL_DOMAINS,
} from './companyGuess';

// How far back a first-ever sync reaches. Everything after that is
// incremental (updated_after the last sync), so this only bites once.
export const DEFAULT_BACKFILL_DAYS = 90;

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

/**
 * Turn the probe's hint into the sentence shown under the setup message.
 * Each case points at a different fix, which is the whole reason the
 * hint exists.
 */
export function describeMissingKey(hint) {
  if (!hint) return '';
  const where = hint.environment && hint.environment !== 'unknown'
    ? `The ${hint.environment} deployment`
    : 'This deployment';
  const build = hint.commit ? ` (build ${hint.commit})` : '';
  const named = (hint.granolaVars || []).filter(n => n !== 'GRANOLA_API_KEY');

  if ((hint.granolaVars || []).includes('GRANOLA_API_KEY')) {
    // Present but empty: the variable exists with a blank or
    // whitespace-only value, which is a re-paste rather than a re-scope.
    return `${where}${build} has a GRANOLA_API_KEY, but it is empty. Re-paste the key value and redeploy.`;
  }
  if (named.length === 1 && named[0] === 'GRANOLA_API_BASE') {
    // The two names sit next to each other in .env.example, so this is
    // usually the key pasted into the wrong row rather than a deliberate
    // host override.
    return `${where}${build} can see GRANOLA_API_BASE but no GRANOLA_API_KEY. GRANOLA_API_BASE is an optional override for the API's address, not the key: if you pasted the key into it, delete that variable and add the key as GRANOLA_API_KEY instead.`;
  }
  if (named.length > 0) {
    return `${where}${build} can see ${named.join(', ')} but no GRANOLA_API_KEY: check the variable's name.`;
  }
  return `${where}${build} has no environment variable mentioning Granola at all. The most common cause is the variable being saved for a different environment than this one, or against a different Vercel project.`;
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
  if (!r.ok) throw new Error(data.error || `Granola list failed (HTTP ${r.status})`);
  return { calls: data.calls || [], cursor: data.cursor || '', hasMore: !!data.hasMore };
}

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
  const result = { imported: 0, updated: 0, skipped: 0, errors: [], latest: updatedAfter || '' };
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
    for (const summary of page.calls) {
      if (!summary.noteId) continue;
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

/** ISO timestamp for `days` ago, used as the first sync's floor. */
export function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}
