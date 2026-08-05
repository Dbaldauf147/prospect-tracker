#!/usr/bin/env node
// Write a meeting recap into Prospect Tracker from outside the browser.
//
// This is the write-back end of the meeting-notes plugin
// (plugins/meeting-notes). The plugin reads a meeting out of Granola via
// the Granola connector, writes the recap, and calls this script to land
// it as a call record at `callRecordings/{uid}/items/{docId}` — the same
// document the Call Recordings page writes, so a pushed recap shows up on
// that page and in the Calls section of the tagged opp's popup.
//
// It uses the record shape from src/utils/callRecordShape.js rather than
// its own copy, so a field added to the page's record is a field this
// writes too.
//
//   node scripts/pushGranolaRecap.mjs --list-opps [query]
//   node scripts/pushGranolaRecap.mjs --notes recap.json
//   node scripts/pushGranolaRecap.mjs --push  recap.json [--dry-run]
//
// Auth: FIREBASE_SERVICE_ACCOUNT_KEY (the whole service-account JSON, or
// a base64 of it) — the same variable the API functions use. The user is
// named with --email (resolved to a uid through Firebase Auth) or --uid.
//
// WHAT IT DELIBERATELY DOES NOT DO: it never edits an opp's Notes field.
// Notes live inside the chunked opps2Data blob, which the browser
// read-modify-writes whole; a second writer racing the open tab could
// drop an edit made in the app. So the recap lands as a call record and
// the Notes block is PRINTED for review — push it onto the deal from the
// Call Recordings page, where the existing merge handles de-duplication.

import { readFileSync } from 'node:fs';
import {
  docIdFor, emptyRecord, withinDocBudget, summaryForOpp, oppLabel,
} from '../src/utils/callRecordShape.js';

// firebase-admin is imported lazily, inside the commands that talk to
// Firestore. Formatting a recap for an opp's Notes needs no credentials
// and no database, so --notes has to work on a checkout where `npm
// install` has never run — and so do the tests, which only exercise the
// pure mapping below.

const CALL_COLLECTION = 'callRecordings';
const CALL_ITEMS = 'items';
const OPPS_COLLECTION = 'opps2Data';

// ---- argv -------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { out._.push(arg); continue; }
    const name = arg.slice(2);
    // Flags take the next token unless it is another flag; the boolean
    // ones below never consume one.
    if (['dry-run', 'help', 'list-opps'].includes(name)) {
      out[name] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[name] = true; continue; }
    out[name] = next;
    i += 1;
  }
  return out;
}

const USAGE = `Write a Granola meeting recap into Prospect Tracker.

  node scripts/pushGranolaRecap.mjs --list-opps [query] --email you@example.com
  node scripts/pushGranolaRecap.mjs --notes recap.json
  node scripts/pushGranolaRecap.mjs --push recap.json --email you@example.com [--dry-run]

Options
  --push <file>     Write the recap as a call record.
  --notes <file>    Print the opp Notes block only. No credentials needed.
  --list-opps [q]   List opportunities (optionally filtered) so a recap can be tagged.
  --email <addr>    Whose tracker to write to. Resolved to a uid via Firebase Auth.
  --uid <uid>       Use this uid directly instead of --email.
  --dry-run         Print the document that would be written, write nothing.

The recap file is JSON:
  {
    "noteId":      "not_abc",              // Granola note id (required)
    "name":        "Acme - pricing review",
    "recordedAt":  "2026-08-04T15:00:00Z",
    "granolaUrl":  "https://notes.granola.ai/d/...",
    "meetingType": "sales | client | internal",
    "company":     "Acme Corp",
    "prospectId":  "...",                  // from --list-opps
    "oppId":       "...",                  // from --list-opps
    "oppLabel":    "Acme Corp - Quoting",
    "summary":     "...",                  // required
    "keyItems":    ["..."],
    "followUps":   [{ "text": "...", "owner": "Dan", "due": "Friday" }],
    "nextSteps":   "...",
    "sentiment":   "positive | neutral | cautious | negative",
    "risks":       ["..."],
    "granolaSummary": "...",               // Granola's own notes, kept separate
    "transcript":  "..."                   // optional; stored for transcript search
  }`;

// ---- firebase ---------------------------------------------------------------

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY is not set. Export it (the whole service-account JSON, '
      + 'or a base64 of it) before pushing. Use --notes to format a recap without credentials.',
    );
  }
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(json);
}

async function importAdmin(module) {
  try {
    return await import(`firebase-admin/${module}`);
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('firebase-admin is not installed. Run `npm install` in the repo first, or use --notes, which needs neither it nor credentials.');
    }
    throw err;
  }
}

let app;
async function adminApp() {
  if (app) return app;
  const { initializeApp, getApps, cert } = await importAdmin('app');
  app = getApps()[0] || initializeApp({ credential: cert(loadServiceAccount()) });
  return app;
}

async function adminDb() {
  const { getFirestore } = await importAdmin('firestore');
  return getFirestore(await adminApp());
}

async function resolveUid({ uid, email }) {
  if (uid) return String(uid);
  if (!email) throw new Error('Pass --email <address> or --uid <uid> to say whose tracker to write to.');
  const { getAuth } = await importAdmin('auth');
  const user = await getAuth(await adminApp()).getUserByEmail(String(email));
  return user.uid;
}

// ---- opps -------------------------------------------------------------------

/**
 * Read the user's Opps 2 dataset. It is stored as one JSON string, either
 * on the parent document (`json`) or split across a `chunks`
 * subcollection when it outgrew Firestore's 1 MB document cap — the same
 * two shapes loadOpps2FromFirestore reads in the browser.
 */
async function loadOpps(db, uid) {
  const ref = db.collection(OPPS_COLLECTION).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return [];
  const raw = snap.data() || {};

  let json = '';
  if (Number.isFinite(raw.chunkCount) && raw.chunkCount > 0) {
    const parts = new Array(raw.chunkCount).fill('');
    const chunks = await ref.collection('chunks').get();
    chunks.forEach((d) => {
      const idx = Number(d.id);
      if (Number.isFinite(idx) && idx >= 0 && idx < parts.length) parts[idx] = String(d.data()?.json || '');
    });
    json = parts.join('');
  } else if (raw.json) {
    json = String(raw.json);
  }
  if (!json) return [];

  const parsed = JSON.parse(json);
  return Array.isArray(parsed?.records) ? parsed.records : [];
}

function matchesQuery(opp, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return ['Account', 'Stage', 'Scope', 'Opportunity Name']
    .some(f => String(opp?.[f] || '').toLowerCase().includes(q));
}

async function listOpps(args) {
  const uid = await resolveUid(args);
  const opps = await loadOpps(await adminDb(), uid);
  const query = args['list-opps'] === true ? (args._[0] || '') : String(args['list-opps'] || '');
  const rows = opps
    .filter(o => matchesQuery(o, query))
    .map(o => ({ oppId: String(o?._id ?? ''), account: String(o?.Account || ''), label: oppLabel(o) }))
    .filter(r => r.oppId);

  if (rows.length === 0) {
    console.log(query ? `No opportunities match "${query}".` : 'No opportunities found for this user.');
    return;
  }
  // JSON out: the caller is usually the plugin picking a tag, not a human
  // reading a table.
  console.log(JSON.stringify(rows, null, 2));
}

// ---- recap ------------------------------------------------------------------

function readRecap(path) {
  if (!path || path === true) throw new Error('Point --push / --notes at a recap JSON file.');
  let recap;
  try {
    recap = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${path} as JSON: ${err.message}`);
  }
  if (!String(recap?.noteId || '').trim()) {
    throw new Error('The recap needs a "noteId" — the Granola note it came from. It is what keeps a re-push updating the same record instead of creating a second one.');
  }
  if (!String(recap?.summary || '').trim()) {
    throw new Error('The recap needs a "summary". Nothing else is worth storing without it.');
  }
  return recap;
}

function str(v) { return v == null ? '' : String(v).trim(); }

function stringList(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .map(v => (typeof v === 'string' ? v : v?.text))
    .filter(v => typeof v === 'string')
    .map(v => v.trim())
    .filter(Boolean)
    .slice(0, limit);
}

// Follow-ups keep owner and due as null rather than '' when unstated —
// the page renders them conditionally and null is what the summarize
// route already produces, so a pushed record and a summarized one look
// the same in the database.
function followUpList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((f) => {
      const text = typeof f === 'string' ? f.trim() : str(f?.text);
      if (!text) return null;
      return {
        text,
        owner: typeof f === 'object' && str(f?.owner) ? str(f.owner) : null,
        due: typeof f === 'object' && str(f?.due) ? str(f.due) : null,
      };
    })
    .filter(Boolean)
    .slice(0, 15);
}

const SENTIMENTS = ['positive', 'neutral', 'cautious', 'negative'];

/** The recording id for a Granola note — the prefix api/granola-calls.js uses. */
export function recordIdFor(noteId) {
  const raw = str(noteId);
  return raw.startsWith('granola:') ? raw : `granola:${raw}`;
}

/**
 * Recap JSON → the fields written onto the call record.
 *
 * `now` is injected so the tests can pin the timestamps. Only fields the
 * recap actually carries are written: a re-push that omits the transcript
 * must not blank the one a Granola sync already stored, which is the same
 * rule recordPatchFor follows in the browser.
 */
export function patchFromRecap(recap, now = new Date().toISOString()) {
  const sentiment = str(recap.sentiment).toLowerCase();
  const patch = {
    source: 'granola',
    name: str(recap.name) || 'Granola call',
    granolaNoteId: str(recap.noteId).replace(/^granola:/, ''),
    granolaUrl: str(recap.granolaUrl),
    recordedAt: str(recap.recordedAt) || null,
    prospectId: str(recap.prospectId),
    company: str(recap.company),
    oppId: str(recap.oppId),
    oppLabel: str(recap.oppLabel),
    summary: str(recap.summary),
    keyItems: stringList(recap.keyItems, 12),
    followUps: followUpList(recap.followUps),
    nextSteps: str(recap.nextSteps),
    sentiment: SENTIMENTS.includes(sentiment) ? sentiment : '',
    risks: stringList(recap.risks, 8),
    summarizedAt: now,
  };

  if (str(recap.granolaSummary)) patch.granolaSummary = str(recap.granolaSummary);
  if (str(recap.transcript)) {
    patch.transcript = str(recap.transcript);
    patch.transcriptStatus = 'completed';
    patch.transcribedAt = now;
  }
  if (Array.isArray(recap.attendees)) patch.attendees = recap.attendees;
  return patch;
}

/**
 * The document to write, merged over whatever is already stored. Mirrors
 * saveCallRecord: full record every time, `createdAt` preserved, capped
 * to fit Firestore.
 */
export function documentFor(recordId, current, patch, now = new Date().toISOString()) {
  return withinDocBudget({
    ...emptyRecord(recordId),
    ...(current || {}),
    ...patch,
    id: recordId,
    createdAt: current?.createdAt || now,
    updatedAt: now,
  });
}

// ---- commands ---------------------------------------------------------------

/**
 * The recap as text for an opp's Notes field, ready to paste.
 *
 * The trailing marker is added here rather than left to mergeIntoNotes,
 * because this text is pasted by hand — there is no merge to add it. It
 * matters that it is present: the marker is how the Call Recordings page
 * later recognises this block as belonging to this call, so a push from
 * the app REPLACES a hand-pasted block instead of stacking a second copy
 * underneath it.
 *
 * Which also means this output must not be fed to mergeIntoNotes — that
 * function stamps the marker itself, and would leave two.
 */
export function notesBlock(recap, now = undefined) {
  const recordId = recordIdFor(recap.noteId);
  const block = summaryForOpp(patchFromRecap(recap, now));
  return `${block}\n[call:${recordId}]`;
}

function printNotes(args) {
  const recap = readRecap(args.notes);
  console.log(notesBlock(recap));
}

async function push(args) {
  const recap = readRecap(args.push);
  const recordId = recordIdFor(recap.noteId);
  const now = new Date().toISOString();
  const patch = patchFromRecap(recap, now);

  if (args['dry-run'] && !args.email && !args.uid) {
    // Nothing to merge over without a user, so show the record as it
    // would be created fresh. Lets the shape be checked with no secrets.
    console.log(JSON.stringify(documentFor(recordId, null, patch, now), null, 2));
    return;
  }

  const uid = await resolveUid(args);
  const db = await adminDb();
  const ref = db.collection(CALL_COLLECTION).doc(uid).collection(CALL_ITEMS).doc(docIdFor(recordId));

  const snap = await ref.get();
  const current = snap.exists ? snap.data() : null;
  const next = documentFor(recordId, current, patch, now);

  if (args['dry-run']) {
    console.log(JSON.stringify(next, null, 2));
    console.log(`\n(dry run: nothing written. Would ${current ? 'update' : 'create'} ${CALL_COLLECTION}/${uid}/${CALL_ITEMS}/${docIdFor(recordId)}.)`);
    return;
  }

  await ref.set(next);

  console.log(`${current ? 'Updated' : 'Created'} call record ${recordId} for ${args.email || uid}.`);
  if (!next.oppId) {
    console.log('Not tagged to an opportunity — tag it on the Call Recordings page to link it to a deal.');
  } else {
    console.log(`Tagged to ${next.oppLabel || next.oppId}. Open the Call Recordings page and use Push to add this to the deal's Notes:\n`);
    console.log(notesBlock(recap));
  }
}

// ---- main -------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.push && !args.notes && !args['list-opps'])) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }
  if (args['list-opps']) return listOpps(args);
  if (args.notes) return printNotes(args);
  return push(args);
}

// Only run when invoked directly, so the tests can import the pure parts.
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
