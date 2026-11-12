// Assertion tests for the Hubspot Mapping page's Activity subtabs
// (src/utils/hubspotActivity.js). Plain Node. Run:
//   node scripts/hubspotActivity.test.mjs
import {
  activityColumns, activityStamp, cleanId, activityKey, compactActivities, mergeActivities,
  activityMatcher, activityRows, othersActivityRows, salespeopleSummary, formatActivityDate, salespersonOf, accountTier, emailBody, emailAddresses, BODY_MAX, othersActivityIssueRecords, othersActivityIssues, stampSortValue,
} from '../src/utils/hubspotActivity.js';
import { buildHubspotMapping, compactMappingCompanies, pastedSheetRows } from '../src/utils/hubspotMapping.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// dates
check('US date and 24h time', activityStamp('10/19/2026 17:00'), '2026-10-19 17:00');
check('US date with PM', activityStamp('10/19/2026 5:07 PM'), '2026-10-19 17:07');
check('12 AM is midnight', activityStamp('1/2/2026 12:15 AM'), '2026-01-02 00:15');
check('ISO-ish text', activityStamp('2026-10-19 17:00'), '2026-10-19 17:00');
check('a Date cell', activityStamp(new Date(2026, 9, 19, 17, 0)), '2026-10-19 17:00');
check('an Excel serial', activityStamp(46314.5), '2026-10-19 12:00');
check('blank', activityStamp(''), '');
check('formatted', formatActivityDate('2026-10-19 17:00'), 'Oct 19, 2026 5:00 PM');
check('formatted morning', formatActivityDate('2026-11-05 07:45'), 'Nov 5, 2026 7:45 AM');

// ids
check('a number keeps its digits', cleanId(118921234567), '118921234567');
check('Excel scientific text', cleanId('1.18921E+11'), '118921000000');
check('digits stay digits', cleanId('55356713483'), '55356713483');
check('a file and a paste of one activity share a key',
  activityKey({ companyId: '1', date: 'd', type: 'Email', engagementId: '118921234567' }),
  activityKey({ companyId: '1', date: 'd', type: 'email', engagementId: cleanId('1.18921E+11') }));
check('two engagement IDs at one minute stay two',
  activityKey({ companyId: '1', date: 'd', type: 'x', engagementId: cleanId('1.20566E+11') }) === activityKey({ companyId: '1', date: 'd', type: 'x', engagementId: cleanId('1.20557E+11') }), false);

// columns
const cols = activityColumns(['Company ID', 'Company name', 'Company owner', 'Activity date', 'Activity type', 'Company ID_1', 'Engagement ID', 'Activity created by', 'Activity assigned to']);
check('columns found', cols, { companyId: 'Company ID', companyName: 'Company name', companyOwner: 'Company owner', date: 'Activity date', type: 'Activity type', engagementId: 'Engagement ID', createdBy: 'Activity created by', assignedTo: 'Activity assigned to', subject: '', toAddress: '', ccAddress: '', body: '' });
check('a plain Record ID is the company', activityColumns(['Record ID', 'Name', 'Activity date']).companyId, 'Record ID');

// Dan's paste, as copied out of Excel (two Company ID columns).
const paste = [
  'Company ID\tCompany name\tCompany owner\tActivity date\tActivity type\tCompany ID\tEngagement ID\tActivity created by',
  '55356713483\tFerguson\tDan Baldauf\t10/19/2026 17:00\tEmail reply from contact\t55356713483\t1.18921E+11\tDan Baldauf',
  '57330608922\tBlackstone\tDan Baldauf\t8/12/2026 14:00\tMeeting\t57330608922\t1.18432E+11\tJane Smith',
  '57330608922\tBlackstone\tDan Baldauf\t11/10/2026 16:46\tEmail sent to contact\t57330608922\t1.20851E+11\tJane Smith',
  '58115917704\tN/A\tDan Baldauf\t11/9/2026 11:52\tEmail sent to contact\t58115917704\t1.20753E+11\tBob Jones',
  '99999999999\tSomeone Else Inc\tPat Lee\t11/9/2026 11:52\tCall\t99999999999\t1.20753E+11\tPat Lee',
].join('\n');
const { activities, hasAssignee } = compactActivities(pastedSheetRows(paste));
check('every row read', activities.length, 5);
check('the export names who logged them', hasAssignee, true);
check('N/A reads as no name', activities[3].companyName, '');
check('first activity', activities[0], { companyId: '55356713483', companyName: 'Ferguson', companyOwner: 'Dan Baldauf', date: '2026-10-19 17:00', type: 'Email reply from contact', engagementId: '118921000000', createdBy: 'Dan Baldauf', assignedTo: '', subject: '', toAddress: '', ccAddress: '', body: '' });
check('no created-by falls back to assigned-to', salespersonOf({ assignedTo: 'A' }), 'A');
check('created-by wins', salespersonOf({ createdBy: 'C', assignedTo: 'A' }), 'C');
check('without either, no one', compactActivities([{ 'Company name': 'X', 'Activity date': '1/1/2026' }]).hasAssignee, false);

// merging
const once = mergeActivities([], activities);
check('first drop adds everything', [once.activities.length, once.added], [5, 5]);
const twice = mergeActivities(once.activities, activities.slice(0, 2));
check('a second drop of the same rows adds none', [twice.activities.length, twice.added, twice.updated], [5, 0, 2]);
check('newest first', twice.activities[0].date >= twice.activities[4].date, true);

// mapping to accounts
const accounts = [
  { id: 'a1', company: 'Ferguson' },
  { id: 'a2', company: 'Blackstone' },
  { id: 'a3', company: 'Kenco Logistics' },
];
const companies = compactMappingCompanies([
  { 'Company ID': '55356713483', 'Company name': 'Ferguson', 'Company owner': 'Dan Baldauf' },
  { 'Company ID': '57330608922', 'Company name': 'Blackstone', 'Company owner': 'Dan Baldauf' },
  { 'Company ID': '58115917704', 'Company name': 'N/A', 'Company owner': 'Dan Baldauf' },
]);
const mapping = buildHubspotMapping(accounts, companies, {});
const match = activityMatcher(mapping, accounts);
check('by Company ID', match({ companyId: '55356713483', companyName: 'Whatever' })?.row.account.company, 'Ferguson');
check('by name when the ID is not in the mapping', match({ companyId: '1', companyName: 'Kenco Logistics' })?.row.account.company, 'Kenco Logistics');
check('by name says so', match({ companyId: '1', companyName: 'Kenco Logistics' })?.how, 'Name');
check('not one of my accounts', match({ companyId: '1', companyName: 'Nobody' }), null);

const rows = activityRows(activities, match, 'Dan Baldauf');
check('accounts on the rows', rows.map(r => r.account?.company || ''), ['Ferguson', 'Blackstone', 'Blackstone', '', '']);
check('mine', rows.map(r => r.mine), [true, false, false, false, false]);
const others = othersActivityRows(rows, 'Dan Baldauf');
check("others' activity is on my accounts and not by me", others.map(r => `${r.account.company}:${r.salesperson}`), ['Blackstone:Jane Smith', 'Blackstone:Jane Smith']);
check('no name, no others', othersActivityRows(rows, ''), []);
check('summary', salespeopleSummary(others), [{ name: 'Jane Smith', count: 2, accounts: 1, last: '2026-11-10 16:46' }]);

// email columns
const emailCols = activityColumns(['Company ID', 'Activity date', 'Email To Address', 'Email CC Address', 'Email body']);
check('email columns found', [emailCols.toAddress, emailCols.ccAddress, emailCols.body], ['Email To Address', 'Email CC Address', 'Email body']);
check('addresses lowercased, once each', emailAddresses('rachael.roy@se.com; Daniel.Baldauf@se.com; daniel.baldauf@se.com'), 'rachael.roy@se.com; daniel.baldauf@se.com');
check('(No value) is no address', emailAddresses('(No value)'), '');
check('a name-only cell is kept', emailAddresses('Jackie Cobb'), 'Jackie Cobb');
const thread = [
  '    [External email: Use caution with links and attachments]',
  '   ',
  '     Hi Rachael, Yes, preview of it. Let me know.       CGBANNERINDICATOR    Hi Rachael,  ',
  '   Yes, that sounds like a great plan.    ',
  '   Tuesday, October 20: 2\u00E2\u20AC\u201C3 p.m. ET     Next week, I\u00E2\u20AC\u2122m available.   ',
  ' Thank you,    ',
  '   Vincent Black',
  '        From: Rachael Roy &lt;rachael.roy@se.com&gt;',
  ' Sent: Friday, October 16, 2026 2:35 PM',
  ' Subject: RE: Climate Week',
  ' HI Vincent and Malyn,',
].join('\n');
check('newest message only, banners and preview gone, characters fixed', emailBody(thread),
  'Hi Rachael,\nYes, that sounds like a great plan.\nTuesday, October 20: 2\u20133 p.m. ET Next week, I\'m available.\nThank you,\nVincent Black');
check('no thread, kept whole', emailBody('      Hi Brad,\n \n Hope you are enjoying your fall!  \n     \n          Dan Baldauf'), 'Hi Brad,\n\nHope you are enjoying your fall!\n\nDan Baldauf');
check('Original Appointment cuts too', emailBody('Sure, Friday works.\n -----Original Appointment-----\n From: Andi'), 'Sure, Friday works.');
check('entities decoded', emailBody('Tom &amp; Jerry &lt;x&gt;'), 'Tom & Jerry <x>');
check('(No value) body', emailBody('(No value)'), '');
check('a long body is capped', emailBody('a'.repeat(BODY_MAX + 50)).length, BODY_MAX + 3);
const withEmail = compactActivities([{ 'Company ID': '1', 'Activity date': '11/9/2026 13:31', 'Activity type': 'Email sent to contact', 'Email To Address': 'Eric.Pan@warburgpincus.com', 'Email CC Address': '(No value)', 'Email body': '      Hi Eric,\n \n You might have already seen this.' }]).activities[0];
check('email fields read', [withEmail.toAddress, withEmail.ccAddress, withEmail.body], ['eric.pan@warburgpincus.com', '', 'Hi Eric,\n\nYou might have already seen this.']);

// Others' Activity as issues
const issueData = { activities, ignored: [] };
const recs = othersActivityIssueRecords(issueData, match, 'Dan Baldauf');
check('one record per others\' row, newest first', recs.map(r => [r.company, r.salesperson, r.date]), [['Blackstone', 'Jane Smith', '2026-11-10 16:46'], ['Blackstone', 'Jane Smith', '2026-08-12 14:00']]);
check('an ignored row is no issue', othersActivityIssueRecords({ activities, ignored: [recs[0].key] }, match, 'Dan Baldauf').length, 1);
check('no name, no records', othersActivityIssueRecords(issueData, match, ''), []);
const issues = othersActivityIssues(recs, { prospects: [{ id: 'a2', company: 'Blackstone Inc' }] });
check('issue rows', issues.map(i => [i.id.startsWith('hubspot-others-activity:'), i.source, i.type, i.company, i.prospectId]),
  [[true, 'Hubspot Mapping', 'Activity by another salesperson', 'Blackstone Inc', 'a2'], [true, 'Hubspot Mapping', 'Activity by another salesperson', 'Blackstone Inc', 'a2']]);
check('issue detail', issues[0].detail, "Jane Smith logged Email sent to contact on Nov 10, 2026 4:46 PM in HubSpot. Ignore it on My Accounts > Hubspot Mapping > Activity > Others' Activity to clear it.");
check('a deleted account drops its issue', othersActivityIssues(recs, { prospects: [{ id: 'zz', company: 'Other' }] }).length, 0);
check('no prospects loaded yet keeps them', othersActivityIssues(recs).length, 2);

// date sorting
check('stamps sort by minute, not by year', [stampSortValue('2026-11-09 13:41') > stampSortValue('2026-10-28 14:38'), stampSortValue('')], [true, null]);

// tier
check('tier label first', accountTier({ tierLabel: 'Tier 1 (Dan target)', myTier: 'Tier 1' }), 'Tier 1 (Dan target)');
check('my tier', accountTier({ myTier: 'Tier 2' }), 'Tier 2');
check('no account, no tier', accountTier(null), '');

console.log(`${failed ? 'FAIL' : 'PASS'} hubspotActivity: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
