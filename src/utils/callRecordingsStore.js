// Persistence for the Call Recordings page.
//
// Everything the page derives from a recording — the transcript, the AI
// summary, and which company / opportunity it's tagged to — lives in
// Firestore at `callRecordings/{uid}/items/{docId}`, one document per
// recording. Same per-user scoping as opps2Data.
//
// The MEDIA never comes here. A recording is a file in the user's
// OneDrive or a folder on their PC; this store only ever holds text
// derived from it plus the tag. That's deliberate — the page's promise
// is "nothing is uploaded", and transcribing already streams the audio
// straight from Graph to the transcription service without touching our
// servers or our database.
//
// One document per recording rather than one blob for all of them: a
// two-hour call transcribes to ~100 KB of text and utterances, so a
// combined document would hit Firestore's 1 MB cap after a handful of
// calls. Per-recording documents also mean a save can't clobber a
// concurrent edit to a different recording.

import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';

const COLLECTION = 'callRecordings';
const ITEMS = 'items';

// Firestore caps a document at 1 MB. Utterances (speaker-labelled turns
// with timings) are the bulk of a long transcript and are the one part
// that can be rebuilt by re-transcribing, so they're what gets dropped
// when a recording is too big to store whole.
const DOC_BUDGET_BYTES = 900 * 1024;

function utf8ByteLength(str) {
  try { return new TextEncoder().encode(str).length; }
  catch { return String(str).length; }
}

// Recording ids are OneDrive item ids ("01ABC…") or local paths
// ("local:Calls/acme-2026-01-14.m4a"). Firestore document ids can't
// contain "/" and can't be "." or "..", so the id is percent-encoded.
// Encoding is reversible, which keeps the mapping debuggable — you can
// read a document id in the console and know which file it came from.
export function docIdFor(recordingId) {
  const raw = String(recordingId || '').trim();
  if (!raw) return '';
  const encoded = encodeURIComponent(raw);
  // Firestore's own limit is 1500 bytes; stay well clear. A path long
  // enough to trip this is pathological, but truncating with a hash of
  // the tail keeps it collision-free rather than merging two files.
  if (encoded.length <= 1400) return encoded;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `${encoded.slice(0, 1380)}~${(hash >>> 0).toString(36)}`;
}

// The stored shape. Written out in full on every save so a document
// never carries a stale field from an older version of the page.
export function emptyRecord(recordingId) {
  return {
    id: String(recordingId || ''),
    // Where the recording came from — 'granola' | 'onedrive' | 'local' —
    // so the page can tell a stored record it can no longer see (folder
    // not picked yet) from one it can. A Granola record is the only one
    // that stands on its own: it carries the whole call as text, so it
    // renders with nothing connected.
    source: '',
    name: '',
    path: '',
    recordedAt: null,
    durationSeconds: null,
    // --- Granola ingest ---
    granolaNoteId: '',
    granolaUrl: '',
    // Granola's own AI notes, kept apart from `summary` (ours) so a
    // re-sync can refresh theirs without touching what we pushed to an opp.
    granolaSummary: '',
    granolaUpdatedAt: null,
    owner: null,
    attendees: [],
    folders: [],
    syncedAt: null,
    // --- tagging ---
    prospectId: '',
    company: '',
    oppId: '',
    oppLabel: '',
    // --- transcription ---
    transcriptId: '',
    transcriptStatus: '',   // '' | queued | processing | completed | error
    transcript: '',
    utterances: [],
    utterancesDropped: false,
    transcriptError: '',
    transcribedAt: null,
    // --- AI summary ---
    summary: '',
    keyItems: [],
    followUps: [],
    nextSteps: '',
    sentiment: '',
    risks: [],
    summarizedAt: null,
    // --- write-back ---
    pushedToOppAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

function itemsRef(userId) {
  return collection(db, COLLECTION, userId, ITEMS);
}

/**
 * Load every stored recording record for a user, keyed by recording id.
 * Returns {} rather than throwing when the read fails — the page must
 * still list and play recordings when Firestore is unreachable.
 */
export async function loadCallRecords(userId) {
  if (!userId) return {};
  try {
    const snap = await getDocs(itemsRef(userId));
    const out = {};
    snap.forEach((d) => {
      const data = d.data();
      if (data?.id) out[data.id] = data;
    });
    return out;
  } catch (err) {
    console.warn('callRecordings: load failed', err);
    return {};
  }
}

/**
 * Merge `patch` into the stored record for one recording and save it.
 * Returns the record as written (so callers can put it straight into
 * state), or null when the save failed.
 *
 * `base` is the record already in page state. Passing it avoids a read
 * before every write; when it's absent the current document is fetched
 * so a partial patch can't blank out fields it doesn't mention.
 */
export async function saveCallRecord(userId, recordingId, patch, base = null) {
  if (!userId || !recordingId) return null;
  const id = String(recordingId);
  const ref = doc(db, COLLECTION, userId, ITEMS, docIdFor(id));

  let current = base;
  if (!current) {
    try {
      const snap = await getDoc(ref);
      current = snap.exists() ? snap.data() : null;
    } catch {
      current = null;
    }
  }

  const now = new Date().toISOString();
  let next = {
    ...emptyRecord(id),
    ...(current || {}),
    ...patch,
    id,
    createdAt: current?.createdAt || now,
    updatedAt: now,
  };

  next = withinDocBudget(next);

  try {
    await setDoc(ref, next);
    return next;
  } catch (err) {
    console.warn('callRecordings: save failed', err);
    return null;
  }
}

// Keep a record under Firestore's per-document cap. Utterances go first
// (re-derivable by transcribing again), then the transcript is clipped
// as a last resort so an enormous call still saves its summary and tag
// rather than failing the write outright.
function withinDocBudget(record) {
  let out = record;
  if (utf8ByteLength(JSON.stringify(out)) <= DOC_BUDGET_BYTES) return out;

  if (Array.isArray(out.utterances) && out.utterances.length > 0) {
    out = { ...out, utterances: [], utterancesDropped: true };
    if (utf8ByteLength(JSON.stringify(out)) <= DOC_BUDGET_BYTES) return out;
  }

  const transcript = String(out.transcript || '');
  if (transcript) {
    // Byte budget minus what the rest of the document costs, with room
    // for the notice appended below.
    const overhead = utf8ByteLength(JSON.stringify({ ...out, transcript: '' }));
    const room = Math.max(0, DOC_BUDGET_BYTES - overhead - 200);
    // Characters are a safe proxy once the budget is in bytes: clipping
    // by character count can only ever undershoot the byte budget.
    out = {
      ...out,
      transcript: `${transcript.slice(0, room)}\n\n[Transcript truncated: too long to store in full.]`,
      utterancesDropped: true,
    };
  }
  return out;
}

/** Forget everything stored for one recording. */
export async function deleteCallRecord(userId, recordingId) {
  if (!userId || !recordingId) return false;
  try {
    await deleteDoc(doc(db, COLLECTION, userId, ITEMS, docIdFor(String(recordingId))));
    return true;
  } catch (err) {
    console.warn('callRecordings: delete failed', err);
    return false;
  }
}

/**
 * Migrate the company links that used to live in user settings
 * (`settings.callRecordingLinks`) into per-recording documents.
 *
 * Runs once per browser: the settings entry is the only record of those
 * links, so it is left in place rather than deleted — an older tab or a
 * second device still reading it keeps working, and re-running the
 * migration is a no-op because existing documents already carry the tag.
 * Returns the number of links migrated.
 */
export async function migrateSettingsLinks(userId, links, stored) {
  if (!userId || !links || typeof links !== 'object') return 0;
  let migrated = 0;
  for (const [recordingId, link] of Object.entries(links)) {
    if (!link?.prospectId) continue;
    // Already has a record with a tag on it — the migration has run, or
    // the user has since tagged it here.
    if (stored?.[recordingId]?.prospectId) continue;
    const saved = await saveCallRecord(
      userId,
      recordingId,
      {
        prospectId: link.prospectId,
        company: link.company || '',
        createdAt: link.linkedAt || null,
      },
      stored?.[recordingId] || null,
    );
    if (saved) migrated += 1;
  }
  return migrated;
}

// ---- opportunity tagging ---------------------------------------------------

/**
 * A short human label for an opp row, used on the recording card and in
 * the picker: "Acme Corp — Quoting · Lighting retrofit".
 */
export function oppLabel(opp) {
  if (!opp) return '';
  const account = String(opp['Account'] || '').trim();
  const stage = String(opp['Stage'] || '').trim();
  const scope = String(opp['Scope'] || '').trim();
  const tail = [stage, scope].filter(Boolean).join(' · ');
  return tail ? `${account || 'Untitled opp'} · ${tail}` : (account || 'Untitled opp');
}

/**
 * Format a call summary as the text pushed into an opp's Notes field.
 * Dated and marked so repeated pushes are recognisable in a field that
 * also holds hand-typed notes.
 */
export function summaryForOpp(record, { recordedAt } = {}) {
  const when = recordedAt || record?.recordedAt || record?.summarizedAt || new Date().toISOString();
  const d = new Date(when);
  const stamp = Number.isNaN(d.getTime())
    ? ''
    : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

  const lines = [`Call summary${stamp ? `: ${stamp}` : ''}`];
  if (record?.summary) lines.push(record.summary);

  const keyItems = Array.isArray(record?.keyItems) ? record.keyItems.filter(Boolean) : [];
  if (keyItems.length) {
    lines.push('', 'Key items:', ...keyItems.map(k => `• ${typeof k === 'string' ? k : k.text || ''}`.trim()));
  }

  const followUps = Array.isArray(record?.followUps) ? record.followUps : [];
  if (followUps.length) {
    lines.push('', 'Follow-ups:', ...followUps.map((f) => {
      const text = typeof f === 'string' ? f : f?.text || '';
      if (!text) return '';
      const owner = typeof f === 'object' && f?.owner ? `: ${f.owner}` : '';
      const due = typeof f === 'object' && f?.due ? ` (${f.due})` : '';
      return `• ${text}${owner}${due}`;
    }).filter(Boolean));
  }

  return lines.filter(l => l !== undefined).join('\n').trim();
}

/**
 * Append the call summary to an opp's existing Notes text rather than
 * replacing it — the field holds the user's own notes and a push must
 * never destroy them. A re-push of the SAME recording replaces just the
 * block it wrote before, so re-summarising doesn't stack duplicates.
 */
export function mergeIntoNotes(existingNotes, block, recordingId) {
  const marker = `[call:${recordingId}]`;
  const stamped = `${block}\n${marker}`;
  const existing = String(existingNotes || '').trim();
  if (!existing) return stamped;

  const at = existing.indexOf(marker);
  if (at === -1) return `${stamped}\n\n${existing}`;

  // Replace the previous block for this recording. It runs from the
  // start of its "Call summary" heading (or the top of the field) to the
  // end of its marker line.
  const before = existing.slice(0, at);
  const after = existing.slice(at + marker.length);
  const headingAt = before.lastIndexOf('Call summary');
  const head = headingAt === -1 ? before : before.slice(0, headingAt);
  return `${head.trimEnd()}${head.trim() ? '\n\n' : ''}${stamped}${after.trimStart() ? `\n\n${after.trim()}` : ''}`.trim();
}
