// Relationship Strength: one 0-100 score per contact, and one per account,
// worked out from the activity with them.
//
// Pure: no I/O and no clock beyond the `nowMs` a caller passes, so
// scripts/relationshipStrength.test.mjs can pin every rule, and the
// Contacts > Relationships chart can ask "what was this score on March 1"
// by passing March 1 as `nowMs` (every rule below only looks at touches
// dated on or before it).
//
// What a "touch" is
// -----------------
// Every source boils down to the same normalized record:
//
//   { id, ms, type, direction, outcome, medium, replyMs, source }
//
//   type       'meeting' | 'call' | 'email'
//   direction  'inbound' (they started it) | 'outbound' (we did)
//   outcome    calls:  'connected' | 'voicemail'
//              emails: 'replied' | 'no-reply' (outbound only; inbound is '')
//              meetings: 'held' | 'no-show'
//   medium     meetings only: 'in-person' | 'video'
//   replyMs    an outbound email's reply, when one came (see linkReplies)
//
// HubSpot's records carry none of these as such, so normalizeHubspot*
// below derive them, with a default wherever HubSpot says nothing. The
// activities typed into the Log activity form (utils/relationshipLog)
// carry them explicitly, and an edit there can override what was derived
// for a HubSpot record.
//
// Every weight is in RELATIONSHIP_CONFIG, so tuning the score is an edit
// to that one object.

import { emailDirection } from './unansweredOutreach.js';
import { rosterCompaniesMatch } from './contactRosters.js';

export const RELATIONSHIP_CONFIG = Object.freeze({
  // How each component weighs in the account score. A contact has no
  // breadth, so a contact's score is the first four re-scaled to 100
  // (divided by their sum, 0.85) rather than capped at 85.
  weights: Object.freeze({
    engagement: 0.35,
    reciprocity: 0.25,
    consistency: 0.15,
    opportunity: 0.10,
    breadth: 0.15,
  }),

  // Engagement: points per touch, decayed by age.
  points: Object.freeze({
    inPersonMeeting: 10,
    videoMeeting: 7,
    connectedCall: 5,
    inboundOrRepliedEmail: 3,
    outboundEmailNoReply: 0.5,
    voicemail: 0.5,
    noShowMeeting: 0,
  }),
  halfLifeDays: 45,
  lookbackDays: 365,
  // Decayed points that count as full engagement (100). A monthly video
  // call plus a weekly two-way email thread lands around here.
  engagementCapPoints: 40,

  // Reciprocity: the two-way share of the last 12 months' touches, plus a
  // bonus for every one the prospect started, capped.
  initiatedBonusPer: 0.1,
  initiatedBonusMax: 0.3,

  // Consistency: rolling 30-day months with a two-way touch, out of 6.
  consistencyMonths: 6,
  monthDays: 30,

  // Opportunity history: points per linked opp, capped at 100.
  oppPoints: Object.freeze({ open: 40, won: 50, past: 15 }),
  oppCap: 100,

  // An outbound email counts as replied when the same person writes back
  // within this many days.
  replyWindowDays: 14,

  // Breadth (accounts only): engaged contacts and buying roles covered,
  // half each. A contact is engaged at this score or above.
  breadth: Object.freeze({
    engagedMinScore: 25,
    engagedTarget: 3,
    contactsShare: 0.5,
    rolesShare: 0.5,
    // Each role is a Dan's Tags tag. Decision maker is the one who signs;
    // the five are the org-chart buckets (ProspectModal/contactTags.js).
    roles: Object.freeze(['decision maker', 'esg', 'procurement', 'utilities', 'climate risk', 'capital planning']),
  }),

  // Trend: points in the last 30 days against the 60 before, per day.
  trend: Object.freeze({ recentDays: 30, priorDays: 60, upRatio: 1.25, downRatio: 0.75, minRecentPoints: 1 }),

  // Ordered, so one hue light to dark: the chip colours and `fill`, the
  // colour a tier is drawn in on the Relationships charts.
  tiers: Object.freeze([
    Object.freeze({ key: 'strong', label: 'Strong', min: 75, color: '#FFFFFF', bg: '#1C5CAB', border: '#1C5CAB', fill: '#1C5CAB' }),
    Object.freeze({ key: 'warm', label: 'Warm', min: 50, color: '#0D366B', bg: '#9EC5F4', border: '#6DA7EC', fill: '#5598E7' }),
    Object.freeze({ key: 'developing', label: 'Developing', min: 25, color: '#184F95', bg: '#DCEBFC', border: '#B7D3F6', fill: '#B7D3F6' }),
    Object.freeze({ key: 'cold', label: 'Cold', min: 0, color: '#475569', bg: '#F1F5F9', border: '#CBD5E1', fill: '#CBD5E1' }),
  ]),
});

export const DAY_MS = 86400000;

export const ACTIVITY_TYPES = ['meeting', 'call', 'email'];
export const DIRECTIONS = ['outbound', 'inbound'];
export const CALL_OUTCOMES = ['connected', 'voicemail'];
export const EMAIL_OUTCOMES = ['no-reply', 'replied'];
export const MEETING_MEDIUMS = ['video', 'in-person'];
export const MEETING_OUTCOMES = ['held', 'no-show'];

export const OPTION_LABELS = {
  meeting: 'Meeting', call: 'Call', email: 'Email',
  outbound: 'Outbound', inbound: 'Inbound',
  connected: 'Connected', voicemail: 'Voicemail',
  replied: 'Replied', 'no-reply': 'No reply',
  video: 'Video', 'in-person': 'In person',
  held: 'Held', 'no-show': 'No show',
};

// The default direction and outcome for a record that has none, which is
// every record from before these fields existed. Outbound, because almost
// everything in the feed is us reaching out; a call with nothing to say it
// connected is a voicemail, the cautious reading (0.5 points, not 5); an
// outbound email is unreplied until a reply is found.
export function defaultsFor(type) {
  if (type === 'call') return { direction: 'outbound', outcome: 'voicemail', medium: '' };
  if (type === 'meeting') return { direction: 'outbound', outcome: 'held', medium: 'video' };
  return { direction: 'outbound', outcome: 'no-reply', medium: '' };
}

/**
 * Fill in and tidy one touch's fields. Anything missing or not one of the
 * allowed values takes its type's default, so a record from before the
 * fields existed reads the same as one logged with the defaults picked.
 */
export function normalizeTouch(t) {
  const type = ACTIVITY_TYPES.includes(t?.type) ? t.type : 'email';
  const d = defaultsFor(type);
  const direction = DIRECTIONS.includes(t?.direction) ? t.direction : d.direction;
  let outcome = '';
  let medium = '';
  if (type === 'call') outcome = CALL_OUTCOMES.includes(t?.outcome) ? t.outcome : (direction === 'inbound' ? 'connected' : d.outcome);
  if (type === 'email') outcome = direction === 'inbound' ? '' : (EMAIL_OUTCOMES.includes(t?.outcome) ? t.outcome : d.outcome);
  if (type === 'meeting') {
    outcome = MEETING_OUTCOMES.includes(t?.outcome) ? t.outcome : d.outcome;
    medium = MEETING_MEDIUMS.includes(t?.medium) ? t.medium : d.medium;
  }
  const ms = Number(t?.ms);
  return {
    id: String(t?.id || ''),
    ms: Number.isFinite(ms) ? ms : NaN,
    type, direction, outcome, medium,
    replyMs: Number.isFinite(Number(t?.replyMs)) && t?.replyMs ? Number(t.replyMs) : null,
    source: t?.source || '',
    // Carried through for the reply link and the activity list: an
    // outcome set by hand, a HubSpot record that has been edited, the note.
    ...(t?.outcomeSet ? { outcomeSet: true } : {}),
    ...(t?.edited ? { edited: true } : {}),
    ...(t?.note ? { note: String(t.note) } : {}),
  };
}

// --- HubSpot records -> touches -------------------------------------------

// HubSpot's built-in call outcomes are GUIDs. Connected is the one that
// means you spoke; every other one (left voicemail, left live message, no
// answer, busy, wrong number) means you didn't.
const HS_CONNECTED = 'f240bbac-87c9-4f6e-bf70-924b57d47db7';
const HS_NOT_CONNECTED = new Set([
  'b2cf5968-551e-4856-9783-52b3da59a7d0', // left voicemail
  'a4c4c377-d246-4b32-a13b-75a56a4cd0ff', // left live message
  '73a0d17f-1163-4015-bdd5-ec830791da20', // no answer
  '9d9162e7-6cf3-4944-bf63-4dff82258764', // busy
  '17b47fee-58de-441e-a44c-c6300d46f273', // wrong number
]);
// A call with no outcome recorded that ran at least this long was a
// conversation.
const CONNECTED_MIN_SECONDS = 60;

export function hubspotCallOutcome(c) {
  const disp = String(c?.hs_call_disposition || '').trim().toLowerCase();
  if (disp === HS_CONNECTED || disp === 'connected') return 'connected';
  if (HS_NOT_CONNECTED.has(disp) || /voicemail|no.?answer|busy|wrong|live message/.test(disp)) return 'voicemail';
  const secs = Number(c?.hs_call_duration) / 1000;
  if (Number.isFinite(secs) && secs >= CONNECTED_MIN_SECONDS) return 'connected';
  return '';
}

function hsMs(v) {
  if (!v) return NaN;
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return t;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// A meeting with a street address (not a link, not a dial-in) was in person.
export function hubspotMeetingMedium(m) {
  const loc = String(m?.hs_meeting_location || '').trim();
  if (!loc) return 'video';
  if (/https?:|zoom|teams|meet\.|webex|call|phone|virtual|online/i.test(loc)) return 'video';
  return 'in-person';
}

function splitAddrs(raw) {
  return String(raw || '').toLowerCase().split(/[;,]/)
    .map(a => { const m = a.match(/<([^>]+)>/); return (m ? m[1] : a).trim(); })
    .filter(Boolean);
}

/**
 * The HubSpot activity feed ({ emails, calls, meetings }) as touches, each
 * with who it was with: { touch, contactIds, emails }.
 */
export function touchesFromHubspotFeed(feed, workEmail = '') {
  const out = [];
  for (const e of (feed?.emails || [])) {
    if (String(e?.hs_email_subject || '').toLowerCase().includes('(sample email)')) continue;
    const ms = hsMs(e?.hs_timestamp);
    const dir = emailDirection(e, workEmail);
    if (!Number.isFinite(ms) || !dir) continue;
    const inbound = dir === 'in';
    out.push({
      touch: { id: `hs:e:${e.id || ms}`, ms, type: 'email', direction: inbound ? 'inbound' : 'outbound', source: 'hubspot' },
      // Only the To line on a send (being cc'd isn't an ask of that
      // person) and only the sender on a reply.
      emails: inbound ? splitAddrs(e.hs_email_from_email).slice(0, 1) : splitAddrs(e.hs_email_to_email),
      contactIds: inbound ? [] : (e._contactIds || []).map(String),
    });
  }
  for (const c of (feed?.calls || [])) {
    const ms = hsMs(c?.hs_timestamp);
    if (!Number.isFinite(ms)) continue;
    const inbound = String(c?.hs_call_direction || '').toUpperCase() === 'INBOUND';
    out.push({
      touch: { id: `hs:c:${c.id || ms}`, ms, type: 'call', direction: inbound ? 'inbound' : 'outbound', outcome: hubspotCallOutcome(c), source: 'hubspot' },
      emails: [],
      contactIds: (c._contactIds || []).map(String),
      phones: [c.hs_call_to_number, c.hs_call_from_number].filter(Boolean),
    });
  }
  for (const m of (feed?.meetings || [])) {
    const ms = hsMs(m?.hs_meeting_start_time) || hsMs(m?.hs_timestamp);
    if (!Number.isFinite(ms)) continue;
    const oc = String(m?.hs_meeting_outcome || '').toUpperCase();
    out.push({
      touch: {
        id: `hs:m:${m.id || ms}`, ms, type: 'meeting', direction: 'outbound',
        outcome: oc === 'NO_SHOW' || oc === 'CANCELED' ? 'no-show' : 'held',
        medium: hubspotMeetingMedium(m), source: 'hubspot',
      },
      emails: [],
      contactIds: (m._contactIds || []).map(String),
    });
  }
  return out;
}

// --- the compact index -----------------------------------------------------
//
// The full feed is too big to keep in localStorage (ActivityView drops it
// on quota), so what the score reads is this: per contact id and per email
// address, the touches as short tuples. Kept for two years so the trend
// chart has a full year of history behind each of its points.

export const TOUCH_INDEX_VERSION = 1;
export const TOUCH_INDEX_KEEP_DAYS = 730;

const TYPE_CODE = { email: 'e', call: 'c', meeting: 'm' };
const CODE_TYPE = { e: 'email', c: 'call', m: 'meeting' };
const OUTCOME_CODE = { connected: 'c', voicemail: 'v', 'no-show': 'x', held: 'h', '': '-' };
const CODE_OUTCOME = { c: 'connected', v: 'voicemail', x: 'no-show', h: 'held', '-': '' };

export function encodeTouch(t) {
  const code = TYPE_CODE[t.type] + (t.direction === 'inbound' ? 'i' : 'o')
    + (OUTCOME_CODE[t.type === 'email' ? '' : (t.outcome || '')] || '-')
    + (t.medium === 'in-person' ? 'p' : '');
  return [Math.round(t.ms), code, t.id];
}

export function decodeTouch(tuple) {
  const [ms, code = '', id = ''] = tuple || [];
  const type = CODE_TYPE[code[0]] || 'email';
  return {
    id, ms, type,
    direction: code[1] === 'i' ? 'inbound' : 'outbound',
    outcome: type === 'email' ? '' : (CODE_OUTCOME[code[2]] || ''),
    medium: type === 'meeting' ? (code[3] === 'p' ? 'in-person' : 'video') : '',
    source: String(id).startsWith('gr:') ? 'granola' : 'hubspot',
  };
}

export function buildTouchIndex(feed, workEmail = '', { nowMs = Date.now() } = {}) {
  const since = nowMs - TOUCH_INDEX_KEEP_DAYS * DAY_MS;
  const byId = {};
  const byEmail = {};
  const byPhone = {};
  const push = (bucket, key, tuple) => { (bucket[key] ||= []).push(tuple); };
  for (const { touch, emails, contactIds, phones } of touchesFromHubspotFeed(feed, workEmail)) {
    if (touch.ms < since || touch.ms > nowMs + DAY_MS) continue;
    const tuple = encodeTouch(normalizeTouch(touch));
    // A call left with no outcome reads as unknown here, so the default
    // (or an inbound call's 'connected') is applied when it is decoded.
    if (touch.type === 'call' && !touch.outcome) tuple[1] = tuple[1].slice(0, 2) + '-';
    for (const id of new Set(contactIds)) push(byId, id, tuple);
    for (const em of new Set(emails)) push(byEmail, em, tuple);
    for (const ph of new Set((phones || []).map(normPhone).filter(Boolean))) push(byPhone, ph, tuple);
  }
  return { v: TOUCH_INDEX_VERSION, builtAt: new Date(nowMs).toISOString(), byId, byEmail, byPhone };
}

/**
 * The Granola meetings on the Activity tab (granolaMeetingsFromRecords) as
 * a touch index of their own, keyed by the external attendees' addresses.
 * A note only exists for a meeting that happened, so each is a held
 * meeting; one with a street address for a location was in person.
 */
export function buildMeetingTouchIndex(meetings, { nowMs = Date.now() } = {}) {
  const since = nowMs - TOUCH_INDEX_KEEP_DAYS * DAY_MS;
  const byEmail = {};
  for (const m of (meetings || [])) {
    const ms = hsMs(m?._meetingStart || m?._timestamp);
    if (!Number.isFinite(ms) || ms < since || ms > nowMs + DAY_MS) continue;
    const id = String(m.id || `granola:${ms}`);
    const tuple = encodeTouch(normalizeTouch({
      id: id.startsWith('gr:') ? id : `gr:${id}`, ms, type: 'meeting', direction: 'outbound', outcome: 'held',
      medium: hubspotMeetingMedium({ hs_meeting_location: m._location }),
    }));
    for (const em of new Set((m._externalEmails || []).map(e => String(e).toLowerCase().trim()).filter(Boolean))) {
      (byEmail[em] ||= []).push(tuple);
    }
  }
  return { v: TOUCH_INDEX_VERSION, builtAt: new Date(nowMs).toISOString(), byId: {}, byEmail, byPhone: {} };
}

/** Two touch indexes read as one (each bucket's lists joined). */
export function mergeTouchIndexes(...indexes) {
  const out = { v: TOUCH_INDEX_VERSION, byId: {}, byEmail: {}, byPhone: {} };
  let any = false;
  for (const idx of indexes) {
    if (!idx) continue;
    any = true;
    for (const bucket of ['byId', 'byEmail', 'byPhone']) {
      for (const [k, list] of Object.entries(idx[bucket] || {})) {
        out[bucket][k] = out[bucket][k] ? out[bucket][k].concat(list) : list;
      }
    }
  }
  return any ? out : null;
}

export function normPhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export const contactKey = (c) => String(c?.id || c?.vid || '').trim();
export const contactEmail = (c) => String(c?.email || '').trim().toLowerCase();
export const contactName = (c) => `${String(c?.firstname || '').trim()} ${String(c?.lastname || '').trim()}`.trim();

/**
 * Every touch with one contact, from the index and the logged activities,
 * with each HubSpot touch's edits applied and outbound emails linked to
 * their replies. Oldest first, one entry per activity.
 *
 *   log  { activities: { id: entry }, overrides: { touchId: {...} } }
 *        (utils/relationshipLog's shape)
 */
export function touchesForContact(contact, index, log = null, config = RELATIONSHIP_CONFIG) {
  const id = contactKey(contact);
  const email = contactEmail(contact);
  const byKey = new Map();
  const add = (t) => { if (t.id && !byKey.has(t.id)) byKey.set(t.id, t); };
  const fromIndex = [
    ...(id ? index?.byId?.[id] || [] : []),
    ...(email ? index?.byEmail?.[email] || [] : []),
  ];
  // Calls without associations are found by number.
  for (const ph of [contact?.phone, contact?.mobilephone].map(normPhone).filter(Boolean)) {
    for (const tup of (index?.byPhone?.[ph] || [])) if (String(tup[1] || '')[0] === 'c') fromIndex.push(tup);
  }
  const overrides = log?.overrides || {};
  for (const tup of fromIndex) {
    const t = decodeTouch(tup);
    const o = overrides[t.id];
    add(o && !o.deleted ? { ...t, ...pickTouchFields(o) } : t);
  }
  for (const a of Object.values(log?.activities || {})) {
    if (!a || a.deleted) continue;
    if (!logEntryMatches(a, contact)) continue;
    add({ ...a, ms: logDayMs(a.date) ?? Number(a.ms), source: 'manual' });
  }
  const list = [...byKey.values()]
    .filter(t => !(overrides[t.id]?.deleted))
    .map(normalizeTouch)
    .filter(t => Number.isFinite(t.ms))
    .sort((a, b) => a.ms - b.ms);
  return linkReplies(dedupeMeetings(list), config);
}

function pickTouchFields(o) {
  const out = {};
  for (const k of ['type', 'direction', 'outcome', 'medium']) if (o[k]) out[k] = o[k];
  // An outcome typed by hand is a decision, not a guess to re-derive.
  if (o.outcome) out.outcomeSet = true;
  if (Object.keys(out).length) out.edited = true;
  return out;
}

// A logged activity carries a day, not a time. It is placed at local
// midnight: it reads as that day wherever you are (UTC midnight read as
// the evening before), and one logged today is already in the past, so it
// counts the moment it's saved.
export function logDayMs(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return null;
  const ms = Date.parse(`${day}T00:00:00`);
  return Number.isFinite(ms) ? ms : null;
}

export function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The same meeting can arrive twice: logged in HubSpot and noted by
// Granola. Two meetings from different sources within two hours of each
// other are one meeting, kept once (the earlier-listed, HubSpot's, wins).
const SAME_MEETING_MS = 2 * 60 * 60 * 1000;
export function dedupeMeetings(sorted) {
  const out = [];
  const kept = [];
  for (const t of sorted) {
    if (t.type === 'meeting') {
      const src = t.source || 'hubspot';
      if (kept.some(k => k.src !== src && Math.abs(k.ms - t.ms) <= SAME_MEETING_MS)) continue;
      kept.push({ src, ms: t.ms });
    }
    out.push(t);
  }
  return out;
}

export function logEntryMatches(entry, contact) {
  const id = contactKey(contact);
  const email = contactEmail(contact);
  if (id && String(entry.contactId || '') === id) return true;
  if (email && String(entry.contactEmail || '').toLowerCase() === email) return true;
  return false;
}

/**
 * Mark each outbound email that got a reply: an inbound email from the
 * same person within replyWindowDays. An email whose outcome was set by
 * hand keeps it (the reply came by phone, say).
 */
export function linkReplies(touches, config = RELATIONSHIP_CONFIG) {
  const windowMs = config.replyWindowDays * DAY_MS;
  const inbound = touches.filter(t => t.type === 'email' && t.direction === 'inbound').map(t => t.ms);
  return touches.map(t => {
    if (t.type !== 'email' || t.direction !== 'outbound') return t;
    if (t.source === 'manual' || t.outcomeSet) return t;
    const reply = inbound.find(ms => ms > t.ms && ms - t.ms <= windowMs);
    return reply ? { ...t, outcome: 'replied', replyMs: reply } : { ...t, outcome: 'no-reply', replyMs: null };
  });
}

// --- scoring one touch -----------------------------------------------------

// Whether the touch was two-way as of `nowMs`: a reply that hadn't come
// yet on that day doesn't count.
export function isTwoWay(t, nowMs = Infinity) {
  if (t.type === 'meeting') return t.outcome !== 'no-show';
  if (t.type === 'call') return t.outcome === 'connected';
  if (t.direction === 'inbound') return true;
  if (t.outcome !== 'replied') return false;
  return t.replyMs == null || t.replyMs <= nowMs;
}

export function touchPoints(t, nowMs = Infinity, config = RELATIONSHIP_CONFIG) {
  const p = config.points;
  if (t.type === 'meeting') {
    if (t.outcome === 'no-show') return p.noShowMeeting;
    return t.medium === 'in-person' ? p.inPersonMeeting : p.videoMeeting;
  }
  if (t.type === 'call') return t.outcome === 'connected' ? p.connectedCall : p.voicemail;
  return isTwoWay(t, nowMs) ? p.inboundOrRepliedEmail : p.outboundEmailNoReply;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function tierFor(score, config = RELATIONSHIP_CONFIG) {
  const s = Number(score) || 0;
  return config.tiers.find(t => s >= t.min) || config.tiers[config.tiers.length - 1];
}

// --- opportunity history ---------------------------------------------------

const OPP_WON = new Set(['sold', 'won', 'closed won']);
const OPP_PAST = new Set(['not sold', 'closed', 'lost', 'closed lost']);
const OPP_INVALID = new Set(['#n/a', '#ref!', '#value!', '#error!', 'n/a', '-', '']);

export function oppStatus(row) {
  const st = String(row?.Stage ?? '').trim().toLowerCase();
  if (OPP_INVALID.has(st)) return '';
  if (OPP_WON.has(st)) return 'won';
  if (OPP_PAST.has(st)) return 'past';
  return 'open';
}

/**
 * The opps a contact is named on: their full name in the opp's Contact
 * list, at an Account that matches their company (or any account, when
 * the contact has no company to check). Returns { open, won, past }.
 */
export function oppsForContact(contact, oppsRecords, { nowMs = Infinity } = {}) {
  const counts = { open: 0, won: 0, past: 0 };
  const name = contactName(contact).toLowerCase();
  if (!name || !oppsRecords?.length) return counts;
  const company = String(contact?.company || '').trim();
  for (const r of oppsRecords) {
    const names = String(r?.Contact ?? '').split(',').map(s => s.trim().toLowerCase());
    if (!names.includes(name)) continue;
    const acct = String(r?.Account || '').trim();
    if (company && acct && !rosterCompaniesMatch(company, acct)) continue;
    const start = Date.parse(r?.['Start Date']);
    if (Number.isFinite(start) && start > nowMs) continue;
    const st = oppStatus(r);
    if (st) counts[st] += 1;
  }
  return counts;
}

// --- the contact score -----------------------------------------------------

/**
 * One contact's score as of `nowMs`.
 *
 *   touches  touchesForContact's list
 *   opps     { open, won, past } (oppsForContact), or null
 *
 * Returns { score, tier, components: { engagement, reciprocity,
 * consistency, opportunity } (each 0-100), trend: 'up'|'down'|'flat',
 * daysSinceTwoWay (null when never), lastTwoWayMs, touchCount }.
 */
export function scoreContact(touches, { opps = null, nowMs = Date.now(), config = RELATIONSHIP_CONFIG } = {}) {
  const lookbackMs = config.lookbackDays * DAY_MS;
  const window = (touches || []).filter(t => t.ms <= nowMs && nowMs - t.ms <= lookbackMs);

  // Engagement
  const k = Math.LN2 / config.halfLifeDays;
  let decayed = 0;
  for (const t of window) decayed += touchPoints(t, nowMs, config) * Math.exp(-k * (nowMs - t.ms) / DAY_MS);
  const engagement = 100 * clamp01(decayed / config.engagementCapPoints);

  // Reciprocity
  const twoWay = window.filter(t => isTwoWay(t, nowMs));
  const initiated = twoWay.filter(t => t.direction === 'inbound').length;
  const reciprocity = window.length
    ? 100 * clamp01(twoWay.length / window.length + Math.min(config.initiatedBonusMax, initiated * config.initiatedBonusPer))
    : 0;

  // Consistency
  const monthMs = config.monthDays * DAY_MS;
  const months = new Set();
  for (const t of twoWay) {
    const m = Math.floor((nowMs - t.ms) / monthMs);
    if (m < config.consistencyMonths) months.add(m);
  }
  const consistency = 100 * months.size / config.consistencyMonths;

  // Opportunity history
  const o = opps || { open: 0, won: 0, past: 0 };
  const op = config.oppPoints;
  const opportunity = Math.min(config.oppCap, (o.open || 0) * op.open + (o.won || 0) * op.won + (o.past || 0) * op.past);

  const w = config.weights;
  const contactWeight = w.engagement + w.reciprocity + w.consistency + w.opportunity;
  const raw = (w.engagement * engagement + w.reciprocity * reciprocity
    + w.consistency * consistency + w.opportunity * opportunity) / contactWeight;
  const score = Math.round(Math.max(0, Math.min(100, raw)));

  const lastTwoWayMs = twoWay.length ? twoWay[twoWay.length - 1].ms : null;
  // Looking past the 12-month window for the last two-way touch: "430
  // days" is more use than "never" when there was one.
  const everTwoWay = lastTwoWayMs ?? [...(touches || [])].reverse().find(t => t.ms <= nowMs && isTwoWay(t, nowMs))?.ms ?? null;

  return {
    score,
    tier: tierFor(score, config),
    components: {
      engagement: Math.round(engagement),
      reciprocity: Math.round(reciprocity),
      consistency: Math.round(consistency),
      opportunity: Math.round(opportunity),
    },
    trend: trendFor(touches, nowMs, config),
    lastTwoWayMs: everTwoWay,
    daysSinceTwoWay: everTwoWay == null ? null : Math.max(0, Math.floor((nowMs - everTwoWay) / DAY_MS)),
    touchCount: window.length,
    opps: o,
  };
}

/**
 * 'up' | 'down' | 'flat': points per day over the last 30 days against the
 * 60 before. Undecayed, so it reads the activity itself rather than the
 * decay curve (which always slopes down between touches).
 */
export function trendFor(touches, nowMs, config = RELATIONSHIP_CONFIG) {
  const { recentDays, priorDays, upRatio, downRatio, minRecentPoints } = config.trend;
  let recent = 0;
  let prior = 0;
  for (const t of (touches || [])) {
    const age = (nowMs - t.ms) / DAY_MS;
    if (age < 0) continue;
    if (age < recentDays) recent += touchPoints(t, nowMs, config);
    else if (age < recentDays + priorDays) prior += touchPoints(t, nowMs, config);
  }
  const rRecent = recent / recentDays;
  const rPrior = prior / priorDays;
  if (rPrior === 0) return recent >= minRecentPoints ? 'up' : 'flat';
  if (rRecent >= rPrior * upRatio && recent >= minRecentPoints) return 'up';
  if (rRecent <= rPrior * downRatio) return 'down';
  return 'flat';
}

// --- the account score -----------------------------------------------------

function tagsOf(c) {
  return String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '')
    .split(';').map(t => t.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean);
}

/**
 * An account's score: its best contact's score plus a breadth bonus worth
 * up to weights.breadth x 100 points.
 *
 *   entries  [{ contact, result }] - result is scoreContact's
 *
 * Breadth is half how many contacts are engaged (out of engagedTarget) and
 * half how many buying roles the engaged contacts cover.
 */
export function scoreAccount(entries, config = RELATIONSHIP_CONFIG) {
  const list = (entries || []).filter(e => e?.result);
  if (!list.length) return null;
  const best = list.reduce((a, b) => (b.result.score > a.result.score ? b : a));
  const b = config.breadth;
  const engaged = list.filter(e => e.result.score >= b.engagedMinScore);
  const roles = new Set();
  for (const e of engaged) {
    const tags = tagsOf(e.contact);
    for (const r of b.roles) if (tags.includes(r)) roles.add(r);
  }
  const breadth = 100 * (b.contactsShare * clamp01(engaged.length / b.engagedTarget)
    + b.rolesShare * clamp01(roles.size / b.roles.length));
  const score = Math.round(Math.min(100, best.result.score + config.weights.breadth * breadth));
  const lastTwoWayMs = list.reduce((m, e) => Math.max(m, e.result.lastTwoWayMs ?? -Infinity), -Infinity);
  const days = list.map(e => e.result.daysSinceTwoWay).filter(d => d != null);
  return {
    score,
    tier: tierFor(score, config),
    best: best.contact,
    bestScore: best.result.score,
    breadth: Math.round(breadth),
    engagedContacts: engaged.length,
    rolesCovered: [...roles],
    // The best contact's direction: the score is theirs plus a bonus, so
    // it moves with them.
    trend: best.result.trend,
    lastTwoWayMs: Number.isFinite(lastTwoWayMs) ? lastTwoWayMs : null,
    daysSinceTwoWay: days.length ? Math.min(...days) : null,
  };
}

// --- history for the trend chart -------------------------------------------

/**
 * Score on each of `points` dates, evenly spaced `stepDays` apart and ending
 * at nowMs. Returns [{ ms, score }].
 */
export function scoreHistory(touches, { opps = null, oppsAt = null, nowMs = Date.now(), points = 27, stepDays = 14, config = RELATIONSHIP_CONFIG } = {}) {
  const out = [];
  for (let i = points - 1; i >= 0; i -= 1) {
    const at = nowMs - i * stepDays * DAY_MS;
    out.push({ ms: at, score: scoreContact(touches, { opps: oppsAt ? oppsAt(at) : opps, nowMs: at, config }).score });
  }
  return out;
}

// --- labels shared by the views ---------------------------------------------

export function touchLabel(t) {
  if (t.type === 'meeting') return `${t.medium === 'in-person' ? 'In-person' : 'Video'} meeting`;
  return OPTION_LABELS[t.type];
}

export function touchDetail(t) {
  const parts = [OPTION_LABELS[t.direction]];
  if (t.outcome && t.outcome !== 'held') parts.push(OPTION_LABELS[t.outcome]);
  return parts.join(', ');
}

export function daysLabel(days) {
  if (days == null) return 'no two-way touch';
  if (days === 0) return 'today';
  return `${days}d ago`;
}

export const TREND_ARROWS = { up: '▲', down: '▼', flat: '▶' };
