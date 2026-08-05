// Ingest call data from Granola — the AI meeting notetaker — into the
// Call Recordings page.
//
//   GET ?limit=&cursor=&updatedAfter=   list notes (metadata only)
//   GET ?noteId=not_xxx                 one note, with its transcript
//   GET ?probe=1                        is the integration configured and
//                                       is the key live? (cheap 1-note list)
//
// Granola is a notetaker, not a recorder: a note arrives already
// transcribed and summarised, and there is no media file behind it. So
// this route is the mirror image of /api/onedrive-recordings — instead of
// listing audio the page then has to transcribe, it hands over text the
// page can tag, summarise, and push onto an opp straight away.
//
// The API key is a deployment secret (GRANOLA_API_KEY), like the
// AssemblyAI and HubSpot keys: every caller is an authenticated,
// allowlisted user, and per-user rate limiting sits in front of it.
//
// Everything Granola returns is normalised here rather than in the
// browser. Their public API is young and has already shipped more than
// one field spelling for the same thing, so the tolerant reads below are
// deliberate — a renamed field degrades one column instead of emptying
// the page.
import { withAuth } from './_lib/http.js';
import { enforceRateLimit } from './_lib/rateLimit.js';

const DEFAULT_BASE = 'https://public-api.granola.ai/v1';

// GRANOLA_API_BASE is an escape hatch for Granola moving the public API,
// not something to set day to day. Anything that isn't an http(s) URL is
// a mistake — most often the API KEY pasted into the wrong row, the two
// names being neighbours in .env.example — and honouring it would send
// every request to a nonsense host and fail in a way that looks like
// Granola being down. Ignore it and say so in the logs.
export function resolveApiBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_BASE;
  if (/^https?:\/\/[^\s/]+/i.test(raw)) return raw.replace(/\/+$/, '');
  console.warn('granola-calls: ignoring GRANOLA_API_BASE: not an http(s) URL. Did the API key go in this variable by mistake?');
  return DEFAULT_BASE;
}

const GRANOLA_BASE = resolveApiBase(process.env.GRANOLA_API_BASE);

// Granola documents 5 req/sec sustained with a 25 burst. A sync walks
// pages and then fetches one detail per changed note, so the ceiling here
// is on our side: enough for a full back-fill, not enough to hammer them.
const RATE_LIMIT = 240;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

// How long any one call to Granola may take. Well inside the function's
// own ceiling so a stall surfaces as a message rather than as a page
// that never finishes loading.
const GRANOLA_TIMEOUT_MS = 20000;

// The probe gets less. It has to answer inside the browser's own 30s
// ceiling for the status check, and the two steps ahead of it — verifying
// the token, then metering — can spend 15s between them before this one
// starts. One note is all it asks for, so 12s is already generous.
const PROBE_GRANOLA_TIMEOUT_MS = 12000;

function apiKey() {
  return String(process.env.GRANOLA_API_KEY || '').trim();
}

// ---- tolerant field reads ---------------------------------------------------

function pick(obj, ...names) {
  for (const name of names) {
    const v = obj?.[name];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function str(value) {
  return value == null ? '' : String(value).trim();
}

// An ISO string, an epoch number, or "01:02:03" / "2:03" — whatever it
// is, come back with milliseconds (absolute for a timestamp, an offset
// for a clock). Null when it is none of those.
function toMillis(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (!s) return null;
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(s);
  if (clock) {
    const h = Number(clock[1] || 0);
    const m = Number(clock[2]);
    const sec = Number(clock[3]);
    return Math.round(((h * 3600) + (m * 60) + sec) * 1000);
  }
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return parsed;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Turn a call's raw start and end values into milliseconds from the
// start of the call, which is what the player seeks with.
//
// What comes in varies: absolute timestamps (epoch ms past 1e11, epoch
// seconds in 1e8–1e11) or an offset already relative to the start. For a
// plain offset the unit is decided per call — no meeting runs past ten
// hours, so a maximum under 36000 can only be seconds.
//
// Starts and ends are converted TOGETHER against one origin. Rebasing
// each list against its own minimum would silently shift every end by
// the length of the first turn.
function rebaseTimings(starts, ends) {
  const known = [...starts, ...ends].filter(v => v != null);
  if (known.length === 0) return { starts, ends };
  const min = Math.min(...known);
  const max = Math.max(...known);

  let convert;
  if (min >= 1e11) convert = v => Math.round(v - min);
  else if (min >= 1e8) convert = v => Math.round((v - min) * 1000);
  else if (max <= 36000) convert = v => Math.round(v * 1000);
  else convert = v => Math.round(v);

  const apply = list => list.map(v => (v == null ? null : convert(v)));
  return { starts: apply(starts), ends: apply(ends) };
}

// Granola labels a transcript line by where the audio came from:
// "microphone" is the person running Granola, anything else is the other
// side of the call. The page renders "Speaker <label>", so the labels are
// written to read correctly there.
function speakerLabel(segment) {
  const named = str(pick(segment, 'speaker', 'speaker_name', 'speaker_label', 'participant'));
  if (named && !/^(microphone|system|speaker)$/i.test(named)) return named;
  const source = str(pick(segment, 'source', 'audio_source', 'channel')).toLowerCase();
  if (source === 'microphone' || source === 'mic') return 'You';
  if (source) return 'Them';
  return named || '?';
}

// Turn whatever shape the transcript came back in into the
// { speaker, text, start, end } turns the rest of the app already speaks
// (start/end in milliseconds, same as the AssemblyAI path).
function normalizeTranscript(raw) {
  if (!raw) return { text: '', utterances: [] };
  if (typeof raw === 'string') return { text: raw.trim(), utterances: [] };

  const list = Array.isArray(raw)
    ? raw
    : (pick(raw, 'segments', 'transcript_segments', 'entries', 'data', 'utterances') || []);
  if (!Array.isArray(list) || list.length === 0) {
    const text = str(pick(raw, 'text', 'transcript', 'content'));
    return { text, utterances: [] };
  }

  const { starts, ends } = rebaseTimings(
    list.map(s => toMillis(pick(s, 'start_timestamp', 'start', 'start_time', 'timestamp', 'offset'))),
    list.map(s => toMillis(pick(s, 'end_timestamp', 'end', 'end_time'))),
  );

  const utterances = list.map((segment, i) => ({
    speaker: speakerLabel(segment),
    text: str(pick(segment, 'text', 'content', 'value')),
    start: starts[i] ?? null,
    end: ends[i] ?? null,
  })).filter(u => u.text);

  // A flat transcript alongside the turns: the summary route and the
  // stored record both fall back to it when turns get dropped for size.
  const text = utterances.map(u => `${u.speaker}: ${u.text}`).join('\n');
  return { text, utterances };
}

function normalizePerson(person) {
  if (!person) return null;
  if (typeof person === 'string') {
    const s = person.trim();
    if (!s) return null;
    return s.includes('@') ? { name: '', email: s.toLowerCase() } : { name: s, email: '' };
  }
  const email = str(pick(person, 'email', 'email_address', 'emailAddress')).toLowerCase();
  const name = str(pick(person, 'name', 'display_name', 'full_name'));
  if (!email && !name) return null;
  return { name, email };
}

function normalizePeople(...sources) {
  const out = [];
  const seen = new Set();
  for (const source of sources) {
    const list = Array.isArray(source) ? source : (source ? [source] : []);
    for (const entry of list) {
      const person = normalizePerson(entry);
      if (!person) continue;
      const key = person.email || person.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(person);
    }
  }
  return out;
}

// Granola's AI summary. The public API returns it as text; older/other
// shapes hand back ProseMirror-ish panels, so a nested object is walked
// for its text nodes rather than JSON.stringify'd into the record.
function summaryText(note) {
  const direct = pick(note, 'summary_text', 'summary', 'ai_summary', 'notes_markdown', 'notes');
  if (typeof direct === 'string') return direct.trim();
  if (direct && typeof direct === 'object') {
    const parts = [];
    const walk = (node) => {
      if (!node) return;
      if (typeof node === 'string') { parts.push(node); return; }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node.text === 'string') parts.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    walk(direct);
    return parts.join('\n').trim();
  }
  return '';
}

function durationSeconds(note, utterances) {
  const event = pick(note, 'calendar_event', 'event') || {};
  const start = toMillis(pick(event, 'start_time', 'start', 'starts_at', 'start_at'));
  const end = toMillis(pick(event, 'end_time', 'end', 'ends_at', 'end_at'));
  if (start != null && end != null && end > start && end - start < 24 * 3600 * 1000) {
    return Math.round((end - start) / 1000);
  }
  const last = utterances.length ? (utterances[utterances.length - 1].end ?? utterances[utterances.length - 1].start) : null;
  return last != null && last > 0 ? Math.round(last / 1000) : null;
}

// One Granola note → the record shape the Call Recordings page renders.
// `id` carries the "granola:" prefix for the same reason local files
// carry "local:": the page keys stored transcripts and tags on it, and
// the prefix keeps three sources from ever colliding on an id.
// Exported alongside the handler so the mapping can be exercised
// directly — it is the part of this route most likely to need adjusting
// when Granola renames a field, and the part with no HTTP in it.
export function normalizeNote(note, { withTranscript = false } = {}) {
  const noteId = str(pick(note, 'id', 'note_id', 'document_id'));
  const event = pick(note, 'calendar_event', 'event') || {};
  const transcript = withTranscript
    ? normalizeTranscript(pick(note, 'transcript', 'transcript_segments', 'segments'))
    : { text: '', utterances: [] };

  const recordedAt = str(pick(event, 'start_time', 'start', 'starts_at')
    || pick(note, 'created_at', 'createdAt', 'created'));

  return {
    id: `granola:${noteId}`,
    noteId,
    isGranola: true,
    name: str(pick(note, 'title', 'name') || pick(event, 'title', 'summary')) || 'Untitled Granola note',
    recordedAt: recordedAt || null,
    updatedAt: str(pick(note, 'updated_at', 'updatedAt')) || null,
    createdAt: str(pick(note, 'created_at', 'createdAt')) || null,
    durationSeconds: durationSeconds(note, transcript.utterances),
    owner: normalizePerson(pick(note, 'owner', 'created_by')) || null,
    attendees: normalizePeople(
      pick(note, 'attendees', 'participants', 'people'),
      pick(event, 'invitees', 'attendees'),
      pick(event, 'organiser', 'organizer'),
    ),
    folders: (Array.isArray(pick(note, 'folder_membership', 'folders')) ? pick(note, 'folder_membership', 'folders') : [])
      .map(f => str(pick(f, 'name', 'title'))).filter(Boolean),
    granolaSummary: summaryText(note),
    granolaUrl: str(pick(note, 'url', 'share_url', 'web_url', 'html_url'))
      || (noteId ? `https://notes.granola.ai/d/${noteId}` : ''),
    transcript: transcript.text,
    utterances: transcript.utterances,
    hasTranscript: !!transcript.text || transcript.utterances.length > 0,
  };
}

// "Not configured" has several causes that look identical from the
// browser: the variable saved against Preview but not Production, a
// near-miss on the name, or the wrong project entirely. This reports
// enough for the page to say which — the NAMES of the variables that
// mention Granola, never a value, plus which deployment answered.
function missingKeyHint() {
  let names = [];
  try {
    names = Object.keys(process.env).filter(k => /granola/i.test(k)).sort();
  } catch {
    names = [];
  }
  return {
    environment: str(process.env.VERCEL_ENV) || 'unknown',
    commit: str(process.env.VERCEL_GIT_COMMIT_SHA).slice(0, 7),
    // GRANOLA_API_BASE is ours and optional, so seeing only that still
    // means the key itself never arrived.
    granolaVars: names,
  };
}

// ---- Granola calls ----------------------------------------------------------

async function granolaFetch(path, timeoutMs = GRANOLA_TIMEOUT_MS) {
  let resp;
  try {
    resp = await fetch(`${GRANOLA_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        Accept: 'application/json',
      },
      // Without this, an unresponsive Granola holds the function open to
      // its 300s ceiling and the page sits on "Checking Granola…" with
      // nothing to show for it. Fail in seconds with a reason instead.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const failure = new Error(timedOut
      ? `Granola didn't respond within ${Math.round(timeoutMs / 1000)}s. Calls already synced are unaffected: try again shortly.`
      : `Couldn't reach Granola at ${GRANOLA_BASE} (${err?.message || err}). If GRANOLA_API_BASE is set, unset it.`);
    failure.httpStatus = timedOut ? 504 : 502;
    throw failure;
  }
  let body = null;
  try { body = await resp.json(); } catch { body = null; }
  return { resp, body };
}

// Map Granola's failures onto messages that tell the user what to do,
// because every one of them has a different fix.
function errorFor(resp, body) {
  const detail = str(body?.error?.message || body?.error || body?.message);
  if (resp.status === 401) {
    return { status: 401, error: 'Granola rejected the API key. Generate a new key in Granola (Settings → API) and update GRANOLA_API_KEY.' };
  }
  if (resp.status === 403) {
    return { status: 403, error: detail || 'That Granola key is missing the scope this needs. It must be able to read notes and transcripts (Business or Enterprise plan).' };
  }
  if (resp.status === 404) {
    return { status: 404, error: 'Granola has no note with that id: it may have been deleted, or it has no AI summary yet (Granola only serves summarised notes over the API).' };
  }
  if (resp.status === 429) {
    return { status: 429, error: 'Granola is rate-limiting this sync. Wait a minute and sync again: already-imported calls are kept.' };
  }
  return { status: 502, error: detail ? `Granola API error: ${detail}` : `Granola API error (HTTP ${resp.status})` };
}

async function listNotes(req, res) {
  const limit = Math.min(MAX_PAGE, Math.max(1, Number(req.query?.limit) || DEFAULT_PAGE));
  const params = new URLSearchParams({ limit: String(limit) });
  const cursor = str(req.query?.cursor);
  if (cursor) params.set('cursor', cursor);
  const updatedAfter = str(req.query?.updatedAfter);
  if (updatedAfter) params.set('updated_after', updatedAfter);
  const createdAfter = str(req.query?.createdAfter);
  if (createdAfter) params.set('created_after', createdAfter);

  const { resp, body } = await granolaFetch(`/notes?${params.toString()}`);
  if (!resp.ok) {
    const e = errorFor(resp, body);
    return res.status(e.status).json({ error: e.error });
  }

  const rows = Array.isArray(body)
    ? body
    : (pick(body, 'data', 'notes', 'items', 'results') || []);
  const page = pick(body, 'pagination', 'page_info') || body || {};

  return res.status(200).json({
    calls: (Array.isArray(rows) ? rows : []).map(n => normalizeNote(n)),
    cursor: str(pick(page, 'next_cursor', 'cursor', 'nextCursor')) || '',
    hasMore: !!(pick(page, 'has_more', 'hasMore') ?? false),
  });
}

async function getNote(req, res, noteId) {
  const { resp, body } = await granolaFetch(`/notes/${encodeURIComponent(noteId)}?include=transcript`);
  if (!resp.ok) {
    const e = errorFor(resp, body);
    return res.status(e.status).json({ error: e.error });
  }
  const note = (body && typeof body === 'object' && !Array.isArray(body))
    ? (pick(body, 'data', 'note') || body)
    : body;
  return res.status(200).json({ call: normalizeNote(note, { withTranscript: true }) });
}

async function handler(req, res, auth) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!apiKey()) {
    return res.status(501).json({
      error: 'Granola is not configured. Set GRANOLA_API_KEY in the deployment environment to ingest calls from Granola.',
      configured: false,
      hint: missingKeyHint(),
    });
  }
  if (!(await enforceRateLimit(res, auth.uid, 'granola-calls', RATE_LIMIT, RATE_WINDOW_MS))) return undefined;

  try {
    const noteId = str(req.query?.noteId);
    if (noteId) return await getNote(req, res, noteId);
    if (str(req.query?.probe)) {
      const { resp, body } = await granolaFetch('/notes?limit=1', PROBE_GRANOLA_TIMEOUT_MS);
      if (!resp.ok) {
        const e = errorFor(resp, body);
        return res.status(e.status).json({ error: e.error, configured: true });
      }
      return res.status(200).json({ configured: true, ok: true });
    }
    return await listNotes(req, res);
  } catch (err) {
    // granolaFetch tags timeouts and unreachable hosts with the status
    // that describes them; anything else is genuinely ours.
    return res.status(err?.httpStatus || 500).json({ error: err?.message || String(err) });
  }
}

export default withAuth(handler);
