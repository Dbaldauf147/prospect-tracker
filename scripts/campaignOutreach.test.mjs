// Assertion tests for "which saved campaigns still have mail to go out".
// Plain Node — no test framework (the project has none). Run:
//   node scripts/campaignOutreach.test.mjs
//
// The rules worth pinning: a finished campaign drops off the list, a
// campaign with nobody in it never appears, the percentages match the ones
// the Saved Campaigns table prints, and the Active rule is the same 60-day
// rule (with the same manual override) that table uses — the two now read
// one function, so a drift here is a drift there.
import {
  isCampaignFresh, isCampaignActive, campaignSendStats, campaignOutreachLabel, unfinishedCampaigns,
  isCampaignPaused, campaignStatus, campaignPauseUntil, CAMPAIGN_PAUSE_DAYS, campaignsAllSent,
} from '../src/utils/campaignOutreach.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const NOW = Date.parse('2026-09-08T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();
const inDays = (n) => new Date(NOW + n * 24 * 60 * 60 * 1000).toISOString();

// --- one campaign's figures -----------------------------------------
// The two campaigns as the Saved Campaigns table shows them.
check('13 of 33', campaignSendStats({ uniqueRecipients: 13, totalContacts: 33 }),
  { sent: 13, total: 33, remaining: 20, pct: 39.4 });
check('20 of 27', campaignSendStats({ uniqueRecipients: 20, totalContacts: 27 }),
  { sent: 20, total: 27, remaining: 7, pct: 74.1 });
check('finished', campaignSendStats({ uniqueRecipients: 10, totalContacts: 10 }),
  { sent: 10, total: 10, remaining: 0, pct: 100 });
check('nobody in it', campaignSendStats({}), { sent: 0, total: 0, remaining: 0, pct: 0 });
// An older campaign saved before totalContacts existed.
check('falls back to the contact list', campaignSendStats({ uniqueRecipients: 2, contacts: [1, 2, 3, 4] }),
  { sent: 2, total: 4, remaining: 2, pct: 50 });
// More sent than the list holds (a contact removed after the send) is
// finished, not negative.
check('over-sent is not negative', campaignSendStats({ uniqueRecipients: 12, totalContacts: 10 }),
  { sent: 12, total: 10, remaining: 0, pct: 120 });

check('the title names it', campaignOutreachLabel({ title: 'Data Center', subject: 'x' }), 'Data Center');
check('falls back to the subject', campaignOutreachLabel({ subject: 'Q3 update' }), 'Q3 update');
check('and to something', campaignOutreachLabel({}), '(untitled campaign)');

// --- active / inactive ----------------------------------------------
check('refreshed last week is fresh', isCampaignFresh({ refreshedAt: daysAgo(7) }, NOW), true);
check('nothing in 90 days is not', isCampaignFresh({ refreshedAt: daysAgo(90) }, NOW), false);
check('the newer of the two dates wins', isCampaignFresh({ savedAt: daysAgo(90), refreshedAt: daysAgo(3) }, NOW), true);
check('no dates at all stays fresh', isCampaignFresh({}, NOW), true);
check('a manual Active beats the 60-day rule',
  isCampaignActive({ refreshedAt: daysAgo(200), manualActive: true }, NOW), true);
check('a manual Inactive beats it too',
  isCampaignActive({ refreshedAt: daysAgo(1), manualActive: false }, NOW), false);

// --- paused ----------------------------------------------------------
// A pause is stored as the moment it lifts, which is what makes it expire on
// its own instead of waiting to be switched back off.
check('a pause runs for two days', CAMPAIGN_PAUSE_DAYS, 2);
check('pausing now lands two days out', campaignPauseUntil(NOW), inDays(2));

check('paused until tomorrow is paused', isCampaignPaused({ pausedUntil: inDays(1) }, NOW), true);
check('a pause that has run out is not', isCampaignPaused({ pausedUntil: daysAgo(1) }, NOW), false);
check('the moment it lifts, it has lifted',
  isCampaignPaused({ pausedUntil: new Date(NOW).toISOString() }, NOW), false);
check('no pause field is not paused', isCampaignPaused({ savedAt: daysAgo(1) }, NOW), false);
// A campaign parked forever by a junk date is the one outcome worth ruling out.
check('an unparseable pause is not a pause', isCampaignPaused({ pausedUntil: 'whenever' }, NOW), false);
check('a blanked pause is not a pause', isCampaignPaused({ pausedUntil: '' }, NOW), false);

// A live pause outranks both the 60-day rule and a manual Active.
check('a paused campaign is not active',
  isCampaignActive({ savedAt: daysAgo(1), pausedUntil: inDays(1) }, NOW), false);
check('even one forced Active by hand',
  isCampaignActive({ manualActive: true, pausedUntil: inDays(1) }, NOW), false);
check('and it goes back to what it was when the pause lifts',
  isCampaignActive({ manualActive: true, pausedUntil: daysAgo(1) }, NOW), true);
check('a manual Inactive underneath survives the pause too',
  isCampaignActive({ manualActive: false, pausedUntil: daysAgo(1) }, NOW), false);

check('status: paused', campaignStatus({ savedAt: daysAgo(1), pausedUntil: inDays(2) }, NOW), 'paused');
check('status: active', campaignStatus({ savedAt: daysAgo(1) }, NOW), 'active');
check('status: inactive', campaignStatus({ savedAt: daysAgo(300), refreshedAt: daysAgo(300) }, NOW), 'inactive');
check('status: back to active once the pause lifts',
  campaignStatus({ savedAt: daysAgo(1), pausedUntil: daysAgo(1) }, NOW), 'active');

// --- the list --------------------------------------------------------
const saved = [
  { title: 'Data Center Impact Outlook', uniqueRecipients: 13, totalContacts: 33, savedAt: daysAgo(8), refreshedAt: daysAgo(5) },
  { title: 'Mexico Electric Power Cost Increase', uniqueRecipients: 20, totalContacts: 27, savedAt: daysAgo(28), refreshedAt: daysAgo(28) },
  { title: 'All sent', uniqueRecipients: 40, totalContacts: 40, savedAt: daysAgo(2) },
  { title: 'Nobody in it', uniqueRecipients: 0, totalContacts: 0, savedAt: daysAgo(2) },
  { title: 'Parked halfway', uniqueRecipients: 1, totalContacts: 99, savedAt: daysAgo(300), refreshedAt: daysAgo(300) },
];
check('only the unfinished ones, worst gap first, inactive last',
  unfinishedCampaigns(saved, NOW).map(r => [r.label, r.pct, r.remaining, r.active]),
  [
    ['Data Center Impact Outlook', 39.4, 20, true],
    ['Mexico Electric Power Cost Increase', 74.1, 7, true],
    ['Parked halfway', 1, 98, false],
  ]);
// Pausing the campaign that led the list drops it to the bottom — below even
// the inactive one, because it is the campaign already dealt with — and it
// climbs back on its own when the pause lifts.
const withPause = saved.map((c, i) => (i === 0 ? { ...c, pausedUntil: inDays(2) } : c));
check('a paused campaign sorts last and says so',
  unfinishedCampaigns(withPause, NOW).map(r => [r.label, r.status]),
  [
    ['Mexico Electric Power Cost Increase', 'active'],
    ['Parked halfway', 'inactive'],
    ['Data Center Impact Outlook', 'paused'],
  ]);
check('the row carries when it comes back',
  unfinishedCampaigns(withPause, NOW)[2].pausedUntil, inDays(2));
check('a lapsed pause leaves no trace on the row',
  unfinishedCampaigns(saved.map((c, i) => (i === 0 ? { ...c, pausedUntil: daysAgo(1) } : c)), NOW)[0],
  { ...unfinishedCampaigns(saved, NOW)[0] });
check('and it leads the list again',
  unfinishedCampaigns(withPause, NOW + 3 * 24 * 60 * 60 * 1000).map(r => r.status)[0], 'active');
check('rows carry their place in the saved list',
  unfinishedCampaigns(saved, NOW).map(r => r.index), [0, 1, 4]);
check('everything sent', unfinishedCampaigns([{ uniqueRecipients: 5, totalContacts: 5 }], NOW), []);
check('nothing saved', unfinishedCampaigns(undefined, NOW), []);
// One junk entry must not take the real campaigns with it.
check('junk rows are skipped',
  unfinishedCampaigns([null, 'nope', { title: 'Real', uniqueRecipients: 1, totalContacts: 4, savedAt: daysAgo(1) }], NOW)
    .map(r => r.label),
  ['Real']);
// Same gap, same activity: the lower percentage leads, then the name.
check('ties break on percentage then name',
  unfinishedCampaigns([
    { title: 'Bravo', uniqueRecipients: 8, totalContacts: 10, savedAt: daysAgo(1) },
    { title: 'Alpha', uniqueRecipients: 8, totalContacts: 10, savedAt: daysAgo(1) },
    { title: 'Charlie', uniqueRecipients: 2, totalContacts: 4, savedAt: daysAgo(1) },
  ], NOW).map(r => r.label),
  ['Charlie', 'Alpha', 'Bravo']);

// --- has the sending finished? ---------------------------------------
// What clears the Prospecting ladder's market-updates step without a tick.
check('one campaign still going out is not finished',
  campaignsAllSent(saved, NOW), false);
check('every campaign at 100% is',
  campaignsAllSent([
    { title: 'A', uniqueRecipients: 5, totalContacts: 5, savedAt: daysAgo(1) },
    { title: 'B', uniqueRecipients: 40, totalContacts: 40, savedAt: daysAgo(300) },
  ], NOW), true);
// The user asked for the paused ones to be left out — a pause is the
// campaign already dealt with for the next couple of days.
check('a paused campaign left half-sent does not hold the step open',
  campaignsAllSent([
    { title: 'A', uniqueRecipients: 5, totalContacts: 5, savedAt: daysAgo(1) },
    { title: 'Parked', uniqueRecipients: 1, totalContacts: 99, pausedUntil: inDays(1) },
  ], NOW), true);
check('and it holds it open again the moment the pause lifts',
  campaignsAllSent([
    { title: 'A', uniqueRecipients: 5, totalContacts: 5, savedAt: daysAgo(1) },
    { title: 'Parked', uniqueRecipients: 1, totalContacts: 99, pausedUntil: daysAgo(1) },
  ], NOW), false);
// Inactive is not paused: a campaign that went quiet at 1% is still owed.
check('an inactive campaign still counts as unsent',
  campaignsAllSent([{ title: 'Parked halfway', uniqueRecipients: 1, totalContacts: 99, savedAt: daysAgo(300), refreshedAt: daysAgo(300) }], NOW),
  false);
check('an empty campaign is neither work nor proof',
  campaignsAllSent([{ title: 'Nobody in it', uniqueRecipients: 0, totalContacts: 0 }], NOW), false);
// Nothing saved proves nothing about today's outreach, so the step falls
// back to being marked by hand rather than clearing itself.
check('no campaigns at all does not clear the step', campaignsAllSent([], NOW), false);
check('junk rows are skipped here too',
  campaignsAllSent([null, 'nope', { uniqueRecipients: 3, totalContacts: 3 }], NOW), true);
check('not loaded yet is not an answer', campaignsAllSent(null, NOW), null);
check('nor is undefined', campaignsAllSent(undefined, NOW), null);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
