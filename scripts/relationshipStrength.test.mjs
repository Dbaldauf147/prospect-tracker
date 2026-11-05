// Assertion tests for the Relationship Strength score.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/relationshipStrength.test.mjs
//
// What's worth pinning: each activity's points and the 45-day half-life,
// the defaults a record without a direction or outcome reads as, the reply
// link that turns an unanswered email into a two-way one, the four contact
// components and their weights, the account's breadth bonus, the tier
// edges, the trend arrow, and that a score asked for on a past date only
// sees what had happened by then.
import {
  RELATIONSHIP_CONFIG as CFG, DAY_MS, normalizeTouch, touchPoints, isTwoWay, linkReplies,
  scoreContact, scoreAccount, tierFor, trendFor, hubspotCallOutcome, hubspotMeetingMedium,
  buildTouchIndex, touchesForContact, oppsForContact, encodeTouch, decodeTouch, scoreHistory,
  buildMeetingTouchIndex, mergeTouchIndexes,
} from '../src/utils/relationshipStrength.js';
import { mergeRelationshipLogs, parseRelationshipLog } from '../src/utils/relationshipLog.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const near = (label, actual, expected, tol = 0.01) => check(label, Math.abs(actual - expected) <= tol, true);

const NOW = Date.UTC(2026, 10, 5);
const ago = (d) => NOW - d * DAY_MS;
const t = (days, fields) => normalizeTouch({ id: `t${days}${fields.type}${Math.random()}`, ms: ago(days), ...fields });

// --- defaults for records without the new fields ---------------------------
check('a bare call is an outbound voicemail', [normalizeTouch({ type: 'call' }).direction, normalizeTouch({ type: 'call' }).outcome], ['outbound', 'voicemail']);
check('a bare inbound call connected', normalizeTouch({ type: 'call', direction: 'inbound' }).outcome, 'connected');
check('a bare email is an unreplied send', [normalizeTouch({ type: 'email' }).direction, normalizeTouch({ type: 'email' }).outcome], ['outbound', 'no-reply']);
check('an inbound email has no outcome', normalizeTouch({ type: 'email', direction: 'inbound', outcome: 'replied' }).outcome, '');
check('a bare meeting is a held video meeting', [normalizeTouch({ type: 'meeting' }).medium, normalizeTouch({ type: 'meeting' }).outcome], ['video', 'held']);
check('junk values fall back', normalizeTouch({ type: 'call', direction: 'sideways', outcome: 'maybe' }).direction, 'outbound');

// --- HubSpot fields ---------------------------------------------------------
check('Connected GUID', hubspotCallOutcome({ hs_call_disposition: 'f240bbac-87c9-4f6e-bf70-924b57d47db7' }), 'connected');
check('Left voicemail GUID', hubspotCallOutcome({ hs_call_disposition: 'b2cf5968-551e-4856-9783-52b3da59a7d0' }), 'voicemail');
check('no outcome, 5 minutes long', hubspotCallOutcome({ hs_call_duration: '300000' }), 'connected');
check('no outcome, 20 seconds', hubspotCallOutcome({ hs_call_duration: '20000' }), '');
check('meeting with a Teams link is video', hubspotMeetingMedium({ hs_meeting_location: 'Microsoft Teams Meeting' }), 'video');
check('meeting at an address is in person', hubspotMeetingMedium({ hs_meeting_location: '200 Park Ave, New York' }), 'in-person');
check('meeting with no location is video', hubspotMeetingMedium({}), 'video');

// --- points -----------------------------------------------------------------
check('in-person 10', touchPoints(t(0, { type: 'meeting', medium: 'in-person' })), 10);
check('video 7', touchPoints(t(0, { type: 'meeting', medium: 'video' })), 7);
check('connected call 5', touchPoints(t(0, { type: 'call', outcome: 'connected' })), 5);
check('voicemail 0.5', touchPoints(t(0, { type: 'call', outcome: 'voicemail' })), 0.5);
check('inbound email 3', touchPoints(t(0, { type: 'email', direction: 'inbound' })), 3);
check('replied email 3', touchPoints(t(0, { type: 'email', outcome: 'replied' })), 3);
check('unreplied email 0.5', touchPoints(t(0, { type: 'email', outcome: 'no-reply' })), 0.5);
check('a no-show scores nothing', touchPoints(t(0, { type: 'meeting', outcome: 'no-show' })), 0);

// --- replies ----------------------------------------------------------------
{
  const list = linkReplies([
    { ...t(20, { type: 'email' }), source: 'hubspot' },
    { ...t(15, { type: 'email', direction: 'inbound' }), source: 'hubspot' },
    { ...t(10, { type: 'email' }), source: 'hubspot' },
  ].sort((a, b) => a.ms - b.ms));
  check('a send answered within 14 days is replied', list[0].outcome, 'replied');
  check('a send with no reply after it is not', list[2].outcome, 'no-reply');
  check('as of before the reply came, it was one-way', isTwoWay(list[0], ago(18)), false);
  check('as of after, two-way', isTwoWay(list[0], ago(14)), true);
}

// --- engagement decay -------------------------------------------------------
{
  const one = scoreContact([t(45, { type: 'meeting', medium: 'in-person' })], { nowMs: NOW });
  // 10 points at one half-life = 5 decayed, of a 40-point cap.
  near('engagement halves at 45 days', one.components.engagement, Math.round(100 * 5 / CFG.engagementCapPoints), 0.5);
  const old = scoreContact([t(400, { type: 'meeting', medium: 'in-person' })], { nowMs: NOW });
  check('a touch older than 12 months is out of the window', old.components.engagement, 0);
  check('...but still answers days since two-way', old.daysSinceTwoWay, 400);
  const lots = Array.from({ length: 30 }, (_, i) => t(i, { type: 'meeting', medium: 'in-person' }));
  check('engagement caps at 100', scoreContact(lots, { nowMs: NOW }).components.engagement, 100);
}

// --- reciprocity / consistency / opps ---------------------------------------
{
  const mix = [
    t(5, { type: 'email', direction: 'inbound' }),
    t(6, { type: 'email', outcome: 'no-reply' }),
    t(7, { type: 'email', outcome: 'no-reply' }),
    t(8, { type: 'call', outcome: 'connected' }),
  ];
  // 2 of 4 two-way, plus 1 prospect-initiated x 0.1.
  check('reciprocity: share plus initiated bonus', scoreContact(mix, { nowMs: NOW }).components.reciprocity, 60);
  const allOneWay = [t(5, { type: 'email' }), t(6, { type: 'call' })];
  check('reciprocity with nothing two-way', scoreContact(allOneWay, { nowMs: NOW }).components.reciprocity, 0);
  const monthly = [t(5, { type: 'call', outcome: 'connected' }), t(40, { type: 'call', outcome: 'connected' }), t(100, { type: 'call', outcome: 'connected' }), t(200, { type: 'call', outcome: 'connected' })];
  check('consistency counts months in the last 6', scoreContact(monthly, { nowMs: NOW }).components.consistency, 50);
  check('opportunity points', scoreContact([], { opps: { open: 1, won: 1, past: 1 }, nowMs: NOW }).components.opportunity, 100);
  check('opportunity points below the cap', scoreContact([], { opps: { open: 0, won: 0, past: 2 }, nowMs: NOW }).components.opportunity, 30);
  check('nothing at all scores 0', scoreContact([], { nowMs: NOW }).score, 0);
  check('...and is Cold', scoreContact([], { nowMs: NOW }).tier.label, 'Cold');
}

// --- the contact score is the four components over 0.85 --------------------
{
  const r = scoreContact([t(5, { type: 'meeting', medium: 'in-person' })], { opps: { open: 1 }, nowMs: NOW });
  const c = r.components;
  const w = CFG.weights;
  const expect = Math.round((w.engagement * c.engagement + w.reciprocity * c.reciprocity + w.consistency * c.consistency + w.opportunity * c.opportunity) / 0.85);
  near('weighted and re-scaled', r.score, expect, 1);
}

// --- tiers ------------------------------------------------------------------
check('75 is Strong', tierFor(75).label, 'Strong');
check('74 is Warm', tierFor(74).label, 'Warm');
check('50 is Warm', tierFor(50).label, 'Warm');
check('49 is Developing', tierFor(49).label, 'Developing');
check('25 is Developing', tierFor(25).label, 'Developing');
check('24 is Cold', tierFor(24).label, 'Cold');

// --- trend ------------------------------------------------------------------
check('recent activity after a quiet spell is up', trendFor([t(5, { type: 'call', outcome: 'connected' })], NOW), 'up');
check('activity only in the prior 60 is down', trendFor([t(50, { type: 'call', outcome: 'connected' })], NOW), 'down');
check('nothing is flat', trendFor([], NOW), 'flat');
check('steady is flat', trendFor([t(10, { type: 'call', outcome: 'connected' }), t(40, { type: 'call', outcome: 'connected' }), t(70, { type: 'call', outcome: 'connected' })], NOW), 'flat');

// --- account ----------------------------------------------------------------
{
  const strong = { contact: { id: '1', dans_tags: 'Decision Maker;ESG' }, result: { score: 80, trend: 'up', daysSinceTwoWay: 3, lastTwoWayMs: ago(3) } };
  const warm = { contact: { id: '2', dans_tags: 'Procurement' }, result: { score: 40, trend: 'flat', daysSinceTwoWay: 20, lastTwoWayMs: ago(20) } };
  const cold = { contact: { id: '3', dans_tags: 'Utilities' }, result: { score: 10, trend: 'down', daysSinceTwoWay: null, lastTwoWayMs: null } };
  const a = scoreAccount([strong, warm, cold]);
  // 2 of 3 engaged -> 0.5 x 2/3; DM, ESG, Procurement of 6 roles -> 0.5 x 3/6.
  check('breadth', a.breadth, Math.round(100 * (0.5 * 2 / 3 + 0.5 * 3 / 6)));
  check('account = best + 0.15 x breadth', a.score, Math.round(80 + 0.15 * (100 * (0.5 * 2 / 3 + 0.5 * 3 / 6))));
  check('only engaged contacts cover roles', a.rolesCovered.includes('utilities'), false);
  check('account days since two-way is its freshest', a.daysSinceTwoWay, 3);
  check('an account with no contacts has no score', scoreAccount([]), null);
  check('account score caps at 100', scoreAccount([{ ...strong, result: { ...strong.result, score: 98 } }, warm]).score, 100);
}

// --- index round trip and per-contact gathering ------------------------------
{
  const feed = {
    emails: [
      { id: 'e1', hs_timestamp: new Date(ago(10)).toISOString(), hs_email_from_email: 'dan@se.com', hs_email_to_email: 'pat@acme.com', hs_email_subject: 'Hi' },
      { id: 'e2', hs_timestamp: new Date(ago(9)).toISOString(), hs_email_from_email: 'pat@acme.com', hs_email_to_email: 'dan@se.com', hs_email_subject: 'Re: Hi' },
      { id: 'e3', hs_timestamp: new Date(ago(9)).toISOString(), hs_email_from_email: 'dan@se.com', hs_email_to_email: 'pat@acme.com', hs_email_subject: '(Sample Email)' },
    ],
    calls: [
      { id: 'c1', hs_timestamp: new Date(ago(3)).toISOString(), hs_call_direction: 'OUTBOUND', hs_call_disposition: 'f240bbac-87c9-4f6e-bf70-924b57d47db7', _contactIds: ['77'] },
      { id: 'c2', hs_timestamp: new Date(ago(2)).toISOString(), hs_call_direction: 'OUTBOUND', _contactIds: ['77'] },
    ],
    meetings: [{ id: 'm1', hs_meeting_start_time: new Date(ago(1)).toISOString(), hs_meeting_location: '1 Main St', _contactIds: ['77'] }],
  };
  const idx = buildTouchIndex(feed, 'dan@se.com', { nowMs: NOW });
  const pat = { id: '77', email: 'pat@acme.com', firstname: 'Pat', lastname: 'Lee', company: 'Acme' };
  const list = touchesForContact(pat, idx);
  check('sample emails are skipped; one touch per activity', list.map(x => x.id), ['hs:e:e1', 'hs:e:e2', 'hs:c:c1', 'hs:c:c2', 'hs:m:m1']);
  check('the send is linked to its reply', list[0].outcome, 'replied');
  check('a call with no outcome reads as the default', list[3].outcome, 'voicemail');
  check('the meeting was in person', list[4].medium, 'in-person');
  check('encode/decode keeps the fields', decodeTouch(encodeTouch(normalizeTouch({ id: 'x', ms: 5, type: 'call', direction: 'inbound', outcome: 'connected' }))).outcome, 'connected');

  const log = {
    activities: {
      a1: { id: 'a1', contactId: '77', type: 'meeting', medium: 'in-person', direction: 'inbound', date: new Date(ago(0)).toISOString().slice(0, 10), updatedAt: 'x' },
      a2: { id: 'a2', contactId: '77', type: 'call', date: '2026-01-01', deleted: true },
      a3: { id: 'a3', contactId: '99', type: 'call', date: '2026-01-01' },
    },
    overrides: { 'hs:c:c2': { outcome: 'connected' } },
  };
  const withLog = touchesForContact(pat, idx, log);
  check('a logged activity joins, deleted and other people\'s do not', withLog.map(x => x.id).includes('a1') && !withLog.some(x => x.id === 'a2' || x.id === 'a3'), true);
  check('an edit overrides the derived outcome', withLog.find(x => x.id === 'hs:c:c2').outcome, 'connected');

  const emailEdit = touchesForContact(pat, idx, { activities: {}, overrides: { 'hs:e:e1': { outcome: 'no-reply' } } });
  check('a hand-set email outcome survives the reply link', emailEdit.find(x => x.id === 'hs:e:e1').outcome, 'no-reply');
  check('an edited HubSpot touch is marked', emailEdit.find(x => x.id === 'hs:e:e1').edited, true);

  const before = scoreContact(touchesForContact(pat, idx), { nowMs: NOW }).score;
  const after = scoreContact(withLog, { nowMs: NOW }).score;
  check('adding activity raises the score', after > before, true);
}

// --- Granola meetings and merging --------------------------------------------
{
  const pat = { id: '77', email: 'pat@acme.com', firstname: 'Pat', lastname: 'Lee' };
  const gr = buildMeetingTouchIndex([
    { id: 'granola:n1', _meetingStart: new Date(ago(10)).toISOString(), _externalEmails: ['Pat@Acme.com'], _location: 'Zoom' },
    { id: 'granola:n2', _meetingStart: new Date(ago(40)).toISOString(), _externalEmails: ['pat@acme.com'], _location: '200 Park Ave' },
    { id: 'granola:old', _meetingStart: new Date(ago(900)).toISOString(), _externalEmails: ['pat@acme.com'] },
  ], { nowMs: NOW });
  const list = touchesForContact(pat, gr);
  check('Granola meetings become held meetings, matched by attendee address', list.map(t => [t.type, t.outcome, t.medium, t.source]),
    [['meeting', 'held', 'in-person', 'granola'], ['meeting', 'held', 'video', 'granola']]);
  check('older than two years is left out', list.length, 2);

  const hs = buildTouchIndex({ meetings: [{ id: 'm9', hs_meeting_start_time: new Date(ago(10) + 30 * 60000).toISOString(), _contactIds: ['77'] }] }, '', { nowMs: NOW });
  const both = touchesForContact(pat, mergeTouchIndexes(hs, gr));
  check('the same meeting in HubSpot and Granola counts once', both.filter(t => Math.abs(t.ms - ago(10)) < 3 * 3600000).length, 1);
  check('...keeping the other Granola meeting', both.length, 2);
  check('merge of nothing is nothing', mergeTouchIndexes(null, undefined), null);
  check('merge joins lists', mergeTouchIndexes({ byEmail: { a: [[1, 'eo-', 'x']] } }, { byEmail: { a: [[2, 'eo-', 'y']] } }).byEmail.a.length, 2);
}

// --- opps -------------------------------------------------------------------
{
  const pat = { firstname: 'Pat', lastname: 'Lee', company: 'Acme Corp' };
  const opps = [
    { Contact: 'Pat Lee, Sam Roe', Account: 'Acme', Stage: 'Quoting' },
    { Contact: 'Sam Roe, Pat Lee', Account: 'Acme', Stage: 'Sold' },
    { Contact: 'Pat Lee', Account: 'Acme', Stage: 'Not Sold' },
    { Contact: 'Pat Lee', Account: 'Globex', Stage: 'Quoting' },
    { Contact: 'Pat Leeds', Account: 'Acme', Stage: 'Quoting' },
    { Contact: 'Pat Lee', Account: 'Acme', Stage: '#N/A' },
  ];
  check('opps named on, at the contact\'s company', oppsForContact(pat, opps), { open: 1, won: 1, past: 1 });
  check('an opp started after the date is left out', oppsForContact(pat, [{ Contact: 'Pat Lee', Account: 'Acme', Stage: 'Quoting', 'Start Date': '2026-12-01' }], { nowMs: NOW }), { open: 0, won: 0, past: 0 });
}

// --- history ----------------------------------------------------------------
{
  const hist = scoreHistory([t(5, { type: 'meeting', medium: 'in-person' })], { nowMs: NOW, points: 3, stepDays: 14 });
  check('three points, oldest first', hist.map(h => h.ms), [ago(28), ago(14), NOW]);
  check('before the meeting the score was 0', hist[0].score, 0);
  check('after it, above 0', hist[2].score > 0, true);
}

// --- the log merge ----------------------------------------------------------
{
  const a = { activities: { x: { id: 'x', note: 'old', updatedAt: '2026-01-01T00:00:00Z' }, y: { id: 'y', updatedAt: '2026-01-01T00:00:00Z' } }, overrides: {} };
  const b = { activities: { x: { id: 'x', note: 'new', updatedAt: '2026-02-01T00:00:00Z' }, z: { id: 'z', updatedAt: '2026-01-01T00:00:00Z' } }, overrides: { h: { outcome: 'connected', updatedAt: '2026-01-01T00:00:00Z' } } };
  const m = mergeRelationshipLogs(a, b);
  check('newer edit wins', m.activities.x.note, 'new');
  check('both sides\' entries kept', Object.keys(m.activities).sort(), ['x', 'y', 'z']);
  check('overrides merged', m.overrides.h.outcome, 'connected');
  check('order does not matter', mergeRelationshipLogs(b, a).activities.x.note, 'new');
  check('junk parses empty', parseRelationshipLog('nope'), { activities: {}, overrides: {} });
}

console.log(`${failed ? 'FAIL' : 'PASS'} relationshipStrength: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
