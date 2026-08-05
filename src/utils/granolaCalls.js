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

function domainOf(email) {
  const at = String(email || '').lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase().trim() : '';
}

async function readJson(response) {
  try { return await response.json(); } catch { return {}; }
}

/**
 * Is Granola configured and is the key live? Resolves to
 * { configured, ok, error } and never throws — the page shows a setup
 * message rather than an error banner when it comes back unconfigured.
 */
export async function probeGranola() {
  try {
    const r = await apiFetch('/api/granola-calls?probe=1');
    const data = await readJson(r);
    if (r.status === 501) return { configured: false, ok: false, error: data.error || '' };
    if (!r.ok) return { configured: true, ok: false, error: data.error || `HTTP ${r.status}` };
    return { configured: true, ok: true, error: '' };
  } catch (err) {
    return { configured: true, ok: false, error: err?.message || String(err) };
  }
}

/** One page of note metadata. Throws with the API's own message. */
export async function fetchGranolaPage({ cursor = '', updatedAfter = '', createdAfter = '', limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  if (updatedAfter) params.set('updatedAfter', updatedAfter);
  if (createdAfter) params.set('createdAfter', createdAfter);
  const r = await apiFetch(`/api/granola-calls?${params.toString()}`);
  const data = await readJson(r);
  if (!r.ok) throw new Error(data.error || `Granola list failed (HTTP ${r.status})`);
  return { calls: data.calls || [], cursor: data.cursor || '', hasMore: !!data.hasMore };
}

/** One note in full, including its transcript. */
export async function fetchGranolaNote(noteId) {
  const r = await apiFetch(`/api/granola-calls?noteId=${encodeURIComponent(noteId)}`);
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
 * note. `shouldFetchDetail` decides that; returning false still reports
 * the note so its metadata stays current.
 *
 * Returns { imported, updated, skipped, errors, latest } where `latest`
 * is the newest updated_at seen — the watermark for the next sync.
 */
export async function syncGranolaCalls({
  updatedAfter = '',
  createdAfter = '',
  shouldFetchDetail = () => true,
  onCall,
  onProgress,
} = {}) {
  const result = { imported: 0, updated: 0, skipped: 0, errors: [], latest: updatedAfter || '' };
  let cursor = '';
  let pages = 0;

  do {
    const page = await fetchGranolaPage({ cursor, updatedAfter, createdAfter });
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
  return result;
}

/** ISO timestamp for `days` ago, used as the first sync's floor. */
export function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}
