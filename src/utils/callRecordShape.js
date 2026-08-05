// The shape of a stored call record, and the pure functions that build,
// bound, and format one.
//
// Split out of callRecordingsStore.js so this half can be imported
// without Firebase. The store pulls in `firebase/firestore` and
// `../firebase`, which initialise on import and throw outside a browser
// with a real config — so anything running under plain Node (the
// write-back script in scripts/, and its tests) could not touch the
// record shape at all without duplicating it. A second copy of
// `docIdFor` or the notes-block format is exactly the kind of drift that
// silently writes documents the page can't find, so there is one copy
// and both sides import it.
//
// Everything here is pure: no I/O, no clock beyond what callers pass in.

// Firestore caps a document at 1 MB. Utterances (speaker-labelled turns
// with timings) are the bulk of a long transcript and are the one part
// that can be rebuilt by re-transcribing, so they're what gets dropped
// when a recording is too big to store whole.
export const DOC_BUDGET_BYTES = 900 * 1024;

export function utf8ByteLength(str) {
  try { return new TextEncoder().encode(str).length; }
  catch { return String(str).length; }
}

// Recording ids are OneDrive item ids ("01ABC…"), local paths
// ("local:Calls/acme-2026-01-14.m4a"), or Granola note ids
// ("granola:not_abc"). Firestore document ids can't contain "/" and
// can't be "." or "..", so the id is percent-encoded. Encoding is
// reversible, which keeps the mapping debuggable — you can read a
// document id in the console and know which call it came from.
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

// Keep a record under Firestore's per-document cap. Utterances go first
// (re-derivable by transcribing again), then the transcript is clipped
// as a last resort so an enormous call still saves its summary and tag
// rather than failing the write outright.
export function withinDocBudget(record) {
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
