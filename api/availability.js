// Colleague free/busy for the opp popup's Availability tab.
//
// Two callers, told apart by how they identify themselves:
//
//  - The app (Authorization: Bearer <Firebase ID token>):
//      GET  -> { token, people, schedules, updatedAt, window }, minting the
//              user's flow token on first use.
//      POST { oppId, emails } -> saves who to check for that opp.
//
//  - The user's Power Automate flow (a token, no sign-in; it runs in
//    Microsoft's cloud, not in the browser):
//      GET  ?token=...  -> { emails, attendees, start, end, window }: who to
//              look up ("a;b" for Find meeting times' Required attendees)
//              and the window. getScheduleBody is still returned for a flow
//              built on the earlier raw-Graph steps.
//      POST { token, suggestions } -> stores Find meeting times' answer;
//           { token, schedules }  -> stores getSchedule's (older flows).
//
// The token is 32 random hex bytes and only maps to a uid; it lets the
// flow read the list of colleague addresses the user typed and write
// free/busy. Firestore holds it all server-side (no client rules: the
// collections are unreachable from the browser by default).
import { randomBytes } from 'node:crypto';
import { adminDb } from './_lib/firebaseAdmin.js';
import { applyCors, requireAuth, failWith } from './_lib/http.js';
import {
  AVAILABILITY_MAX_PEOPLE, availabilityEmails, availabilityWindow, getScheduleBody,
  isValidEmail, normEmail, normalizeSchedules, schedulesFromSuggestions,
} from '../src/utils/availability.js';

const USERS = 'availability';
const TOKENS = 'availabilityTokens';

function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  try { return JSON.parse(String(b || '{}')); } catch { return {}; }
}

async function uidForToken(db, token) {
  if (!/^av_[0-9a-f]{64}$/.test(String(token || ''))) return null;
  const snap = await db.collection(TOKENS).doc(token).get();
  return snap.exists ? snap.data()?.uid || null : null;
}

async function handleApp(req, res, auth) {
  const db = adminDb();
  const ref = db.collection(USERS).doc(auth.uid);

  if (req.method === 'GET') {
    const snap = await ref.get();
    let data = snap.exists ? snap.data() : {};
    if (!data.token) {
      const token = `av_${randomBytes(32).toString('hex')}`;
      await db.collection(TOKENS).doc(token).set({ uid: auth.uid, createdAt: new Date().toISOString() });
      await ref.set({ token }, { merge: true });
      data = { ...data, token };
    }
    return res.status(200).json({
      token: data.token,
      people: data.people || {},
      schedules: data.schedules || [],
      updatedAt: data.updatedAt || null,
      window: data.window || null,
      maxPeople: AVAILABILITY_MAX_PEOPLE,
    });
  }

  if (req.method === 'POST') {
    const { oppId, emails } = readBody(req);
    const id = String(oppId || '').trim();
    if (!id || id.length > 200 || id.includes('/')) return res.status(400).json({ error: 'Missing or invalid oppId' });
    if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails must be a list' });
    const clean = [...new Set(emails.map(normEmail).filter(isValidEmail))].slice(0, AVAILABILITY_MAX_PEOPLE);
    const snap = await ref.get();
    const people = { ...(snap.exists ? snap.data()?.people || {} : {}) };
    if (clean.length) people[id] = clean; else delete people[id];
    // set+merge would deep-merge the map and never drop an opp's entry.
    await ref.set({ people }, { mergeFields: ['people'] });
    return res.status(200).json({ ok: true, people });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleFlow(req, res) {
  // Power Automate calls from Microsoft's servers, not a browser.
  res.setHeader('Access-Control-Allow-Origin', '*');
  const db = adminDb();

  if (req.method === 'GET') {
    const uid = await uidForToken(db, req.query?.token);
    if (!uid) return res.status(401).json({ error: 'Unknown token' });
    const snap = await db.collection(USERS).doc(uid).get();
    const emails = availabilityEmails(snap.exists ? snap.data()?.people : {});
    const window = availabilityWindow();
    return res.status(200).json({
      emails,
      count: emails.length,
      attendees: emails.join(';'),
      start: window.start,
      end: window.end,
      window,
      getScheduleBody: getScheduleBody(emails, window),
    });
  }

  if (req.method === 'POST') {
    const body = readBody(req);
    const uid = await uidForToken(db, body.token);
    if (!uid) return res.status(401).json({ error: 'Unknown token' });
    const fromSuggestions = body.suggestions ?? body.meetingTimeSuggestions;
    const schedules = fromSuggestions !== undefined
      ? schedulesFromSuggestions(fromSuggestions)
      : normalizeSchedules(body.schedules ?? body.value ?? body);
    // The window the flow was told about, so the tab knows which days the
    // data covers. Recomputed rather than trusted from the body.
    const window = availabilityWindow();
    await db.collection(USERS).doc(uid).set({
      schedules,
      window,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return res.status(200).json({ ok: true, people: schedules.length });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default async function handler(req, res) {
  try {
    if (req.headers.authorization) {
      applyCors(req, res);
      if (req.method === 'OPTIONS') return res.status(204).end();
      const auth = await requireAuth(req, res);
      if (!auth) return undefined;
      return await handleApp(req, res, auth);
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).end();
    }
    return await handleFlow(req, res);
  } catch (err) {
    return failWith(res, err, '/api/availability');
  }
}
