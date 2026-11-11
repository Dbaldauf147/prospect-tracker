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

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
