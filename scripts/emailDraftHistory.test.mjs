// Assertion tests for the email draft history rules.
// Plain Node, no framework. Run: node scripts/emailDraftHistory.test.mjs
//
// What's worth pinning: the same draft always lands on the same entry (so a
// re-save or a send bumps it rather than duplicating), any edit is a new
// entry, a later save never undoes a campaign link made by hand, and the
// automatic link uses the campaign report's own subject-containment test.
import {
  draftFingerprint, buildHistoryEntry, mergeHistoryEntry, suggestCampaignFor,
  findLinkedCampaign, draftHasContent, draftPlainText, normalizeHistoryEntry,
  subjectWords, suggestCampaigns, draftsForCampaign,
} from '../src/utils/emailDraftHistory.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const base = {
  subject: 'Q3 energy update',
  body: '<p>Hi {goesBy},</p><p>Rates are up.</p>',
  contacts: [{ id: '1', name: 'Ann Lee', email: 'ann@x.com' }, { id: '2', name: 'Bo Kim', email: 'bo@y.com' }],
  cc: ['boss@se.com'],
  bannerId: 'b1',
};

// --- fingerprint -------------------------------------------------------
check('same draft, same id', draftFingerprint(base), draftFingerprint({ ...base }));
check('recipient order does not count',
  draftFingerprint(base), draftFingerprint({ ...base, contacts: [...base.contacts].reverse() }));
check('email case does not count',
  draftFingerprint(base), draftFingerprint({ ...base, contacts: base.contacts.map(c => ({ ...c, email: c.email.toUpperCase() })) }));
check('a body edit is a new entry', draftFingerprint(base) === draftFingerprint({ ...base, body: base.body + '<p>x</p>' }), false);
check('a subject edit is a new entry', draftFingerprint(base) === draftFingerprint({ ...base, subject: 'Q4' }), false);
check('a recipient change is a new entry', draftFingerprint(base) === draftFingerprint({ ...base, contacts: base.contacts.slice(1) }), false);
check('a banner change is a new entry', draftFingerprint(base) === draftFingerprint({ ...base, bannerId: '' }), false);
check('id is a valid document id', /^d-[0-9a-z]+$/.test(draftFingerprint(base)), true);

// --- content -----------------------------------------------------------
check('Quill empty body is no content', draftHasContent({ subject: ' ', body: '<p><br></p>' }), false);
check('a subject alone is content', draftHasContent({ subject: 'Hi', body: '' }), true);
check('plain text strips tags and entities', draftPlainText('<p>A&amp;B</p><p>c&nbsp;d</p>'), 'A&B c d');

// --- building / merging ------------------------------------------------
const now = '2026-11-11T10:00:00.000Z';
const saved = buildHistoryEntry({ ...base, contacts: [{ email: 'a@b.com', phone: undefined }] }, { now });
check('undefined fields are dropped for Firestore', saved.contacts, [{ email: 'a@b.com' }]);
check('a save is not a send', [saved.sentCount, saved.lastSentAt], [0, '']);
const sent = buildHistoryEntry(base, { via: 'sent', now, campaign: 'Q3 energy update' });
check('a send counts', [sent.sentCount, sent.lastSentAt, sent.campaign], [1, now, 'Q3 energy update']);
check('createdAt kept from an imported draft',
  buildHistoryEntry({ ...base, createdAt: '2025-01-01T00:00:00.000Z' }, { now }).createdAt, '2025-01-01T00:00:00.000Z');

const later = '2026-11-12T10:00:00.000Z';
check('re-save bumps the count and keeps a manual link',
  mergeHistoryEntry({ saveCount: 2, sentCount: 1, lastSentAt: now, campaign: 'Manual' }, buildHistoryEntry(base, { now: later })),
  { lastSavedAt: later, saveCount: 3, sentCount: 1, lastSentAt: now, campaign: 'Manual' });
check('a send after saves counts the send',
  mergeHistoryEntry({ saveCount: 1, sentCount: 0, campaign: '' }, buildHistoryEntry(base, { via: 'sent', now: later, campaign: 'Auto' })),
  { lastSavedAt: later, saveCount: 2, sentCount: 1, lastSentAt: later, campaign: 'Auto' });
check('an explicit campaign replaces the old link',
  mergeHistoryEntry({ campaign: 'Old' }, buildHistoryEntry(base, { now: later, campaign: 'New' })).campaign, 'New');

// --- campaign links ----------------------------------------------------
const campaigns = [
  { subjects: ['Energy update'] },
  { subjects: ['Q3 energy update', 'Q3 rates'] },
  { subject: 'Holiday hours' },
];
check('longest containing subject wins', suggestCampaignFor(campaigns, 'RE: Q3 energy update for {company}'), 'Q3 energy update');
check('a second subject line claims it, linked by the primary',
  suggestCampaignFor(campaigns, 'Q3 rates are in'), 'Q3 energy update');
check('legacy single-subject campaigns match', suggestCampaignFor(campaigns, 'Holiday hours'), 'Holiday hours');
check('no match, no link', suggestCampaignFor(campaigns, 'Lunch?'), '');
check('no campaigns, no link', suggestCampaignFor(undefined, 'Lunch?'), '');
check('a link resolves by any subject, any case', findLinkedCampaign(campaigns, 'q3 RATES') === campaigns[1], true);
check('a deleted campaign resolves to null', findLinkedCampaign(campaigns, 'Gone'), null);
check('no link resolves to null', findLinkedCampaign(campaigns, ''), null);

// --- normalizing -------------------------------------------------------
const n = normalizeHistoryEntry('d-1', { subject: 'S', contacts: 'bad', saveCount: 'x' });
check('half-written docs normalize', [n.id, n.contacts, n.saveCount, n.sentCount, n.campaign], ['d-1', [], 1, 0, '']);

// --- suggestions -------------------------------------------------------
check('subject words drop tokens, stop words and short numbers',
  [...subjectWords('RE: {company} Michigan Electric Market Risk for 2027 in Q3')], ['michigan', 'electric', 'market', 'risk', '2027']);

const roster = (emails) => emails.map(email => ({ email }));
const sugCampaigns = [
  { subjects: ['Great Lakes power outlook'], savedAt: '2026-11-09T00:00:00Z', contacts: roster(['a@x.com', 'b@x.com', 'c@x.com']) },
  { title: 'Michigan market risk webinar', subjects: ['Join us: MI risk webinar'], savedAt: '2026-01-01T00:00:00Z', contacts: roster(['z@z.com']) },
  { subjects: ['Holiday hours'], savedAt: '2026-11-10T00:00:00Z', contacts: roster(['q@q.com']) },
];
const mi = { subject: 'Michigan Electric Market Risk', contacts: roster(['a@x.com', 'b@x.com', 'd@x.com']), createdAt: '2026-11-10T00:00:00Z' };
const got = suggestCampaigns(sugCampaigns, mi);
check('roster overlap and shared words both suggest, roster first',
  got.map(g => g.key), ['Great Lakes power outlook', 'Join us: MI risk webinar']);
check('labels use the campaign title', got.map(g => g.label), ['Great Lakes power outlook', 'Michigan market risk webinar']);
check('the reason says why', got[0].reason, '2 of 3 recipients on its roster, saved around the same time');
check('a word-only match names the words', got[1].reason, 'shares "michigan", "market", "risk"');
check('timing alone never suggests', got.some(g => g.key === 'Holiday hours'), false);
check('nothing in common, nothing suggested', suggestCampaigns(sugCampaigns, { subject: 'Lunch', contacts: [] }), []);
check('limit caps the list', suggestCampaigns(sugCampaigns, mi, { limit: 1 }).length, 1);
check('one weak word is below the threshold',
  suggestCampaigns([{ subjects: ['Ohio michigan indiana illinois wisconsin minnesota'], contacts: [] }],
    { subject: 'Michigan alpha beta gamma delta epsilon', contacts: roster(['n@n.com']) }), []);

// --- drafts on a campaign ---------------------------------------------
const hist = [
  { id: '1', campaign: 'q3 energy update', lastSavedAt: '2026-11-01' },
  { id: '2', campaign: 'Q3 rates', lastSavedAt: '2026-11-05' },
  { id: '3', campaign: 'Other', lastSavedAt: '2026-11-09' },
  { id: '4', campaign: '', lastSavedAt: '2026-11-10' },
];
check('drafts on a campaign match any subject, newest first',
  draftsForCampaign(hist, { subjects: ['Q3 energy update', 'Q3 rates'] }).map(e => e.id), ['2', '1']);
check('a campaign with no subject has no drafts', draftsForCampaign(hist, {}), []);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
