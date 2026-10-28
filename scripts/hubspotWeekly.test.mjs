// Assertion tests for the weekly HubSpot import email (api/_lib/hubspotWeekly.js,
// api/hubspot-weekly-export.js). Plain Node, no framework. Run:
//   node scripts/hubspotWeekly.test.mjs
//
// What has to hold:
//   * activity is read page by page from the current portal with only the
//     properties a history line needs, and lands on every linked contact;
//     a type the token can't read is reported, not fatal; nothing but GETs,
//   * two attachments (companies, contacts) with a BOM and no em dash, and
//     the email names each file's import option,
//   * with the Schneider exports, a company already there isn't in the
//     companies file and a colleague's contact isn't in the contacts file;
//     without them, the email says not to import the contacts file yet,
//   * a run sends one email to the configured address and logs it; a
//     failure is logged with its error and sends nothing.
import { liveActivity, buildWeeklyFiles, weeklyEmailHtml, flatContact } from '../api/_lib/hubspotWeekly.js';
import { runWeekly } from '../api/hubspot-weekly-export.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const T = Date.parse('2026-10-21T15:00:00Z');

// ── liveActivity ─────────────────────────────────────────────────────────
{
  const calls = [];
  const get = async (path) => {
    calls.push(path);
    const u = new URL(`https://x${path}`);
    const type = u.pathname.split('/').pop();
    if (type === 'tasks') throw new Error('HubSpot 403 on /crm/v3/objects/tasks: missing scope');
    if (type === 'emails' && !u.searchParams.get('after')) {
      return { results: [{ id: 'e1', properties: { hs_timestamp: String(T), hs_email_subject: 'Pilot', hs_email_direction: 'EMAIL' }, associations: { contacts: { results: [{ id: 11, type: 'email_to_contact' }, { id: 12 }] } } }], paging: { next: { after: 'p2' } } };
    }
    if (type === 'emails') return { results: [{ id: 'e2', properties: { hs_timestamp: String(T - 1000), hs_email_subject: 'Intro', hs_email_direction: 'INCOMING_EMAIL' }, associations: { contacts: { results: [{ id: 11 }] } } }] };
    if (type === 'meetings') return { results: [{ id: 'm1', properties: { hs_timestamp: String(T), hs_meeting_title: 'Review' } }] };
    return { results: [] };
  };
  const { activity, errors } = await liveActivity(get);
  eq(activity, { 11: [[T, 'Email sent', 'Pilot'], [T - 1000, 'Email received', 'Intro']], 12: [[T, 'Email sent', 'Pilot']] },
    'emails across pages land on every linked contact; an unlinked meeting lands nowhere');
  eq(Object.keys(errors), ['tasks'], 'a type the token cannot read is reported');
  const emailsCall = new URL(`https://x${calls[0]}`);
  eq([emailsCall.searchParams.get('properties'), emailsCall.searchParams.get('associations')], ['hs_timestamp,hs_email_subject,hs_email_direction', 'contacts'],
    'only the properties a history line needs, with contact links');
}

// ── files ────────────────────────────────────────────────────────────────
const prospects = [{ id: 'p1', company: 'Acme Corp', website: 'acme.com', tier: 'Tier 1' }];
const contacts = [
  flatContact({ id: '11', properties: { email: 'jane@acme.com', firstname: 'Jane', jobtitle: 'CFO', company: 'Acme Corp', dans_tags: 'ESG' } }),
  flatContact({ id: '12', properties: { email: 'bo@acme.com', firstname: 'Bo', company: 'Acme Corp' } }),
  flatContact({ id: '13', properties: { email: 'pat@se.com', firstname: 'Pat' } }),
];
const activity = { 11: [[T, 'Email sent', 'Pilot']], 13: [[T, 'Email sent', 'Internal']] };
{
  const { attachments, counts } = buildWeeklyFiles({ prospects, contacts, opps: { records: [] }, settings: {}, activity, ownerEmail: 'daniel.baldauf@se.com', date: '2026-11-02' });
  eq(attachments.map(a => a.filename), ['hubspot-2026-11-02-1-companies.csv', 'hubspot-2026-11-02-2-contacts.csv'], 'two attachments, dated and numbered');
  eq(attachments.every(a => a.content.startsWith('\uFEFF') && !a.content.includes('\u2014')), true, 'each has a BOM and no em dash');
  eq([counts.companies, counts.contacts, counts.withHistory, counts.colleaguesLeftOut, counts.hasContactsExport], [1, 2, 1, 1, false], 'counts: colleague left out');
  const html = weeklyEmailHtml({ counts, attachments, activityErrors: { tasks: 'missing scope' } });
  eq([html.includes('Create new records only'), html.includes('Create and update'), html.includes('tasks: missing scope'), html.includes('\u2014')], [true, true, true, false],
    'the email names each import option and any unread activity, with no em dash');
  eq(html.includes("Don't import the contacts file yet"), true, 'no Schneider exports: the email says not to import contacts yet');

  const existing = {
    companies: [{ id: '501', name: 'Acme Corp', domain: '', owner: 'Kat Gross' }],
    contacts: [{ id: '9', email: 'bo@acme.com', owner: 'Kat Gross' }],
    meta: { contactsAt: '2026-11-01T10:00:00Z' },
  };
  const withExports = buildWeeklyFiles({ prospects, contacts, opps: { records: [] }, settings: {}, activity, ownerEmail: 'daniel.baldauf@se.com', date: '2026-11-02', existing });
  eq([withExports.counts.companies, withExports.counts.companiesExisting, withExports.counts.contacts, withExports.counts.colleagueOwned],
    [0, 1, 1, 1], "with the exports: the existing company isn't created, the colleague's contact is left out");
  eq(withExports.attachments[1].content.includes('501'), true, 'the contact links to the existing company by Record ID');
  const html2 = weeklyEmailHtml({ counts: withExports.counts, attachments: withExports.attachments });
  eq([html2.includes("Don't import the contacts file yet"), html2.includes('2026-11-01')], [false, true], 'with the exports: no warning, and the export date shown');
}

// ── runWeekly ────────────────────────────────────────────────────────────
{
  const logs = [];
  const db = { collection: () => ({ doc: () => ({ set: async (v) => { logs.push(v); } }) }) };
  const sent = [];
  const send = async (m) => { sent.push(m); return {}; };
  const load = async () => ({ prospects, contacts, opps: { records: [] }, settings: {}, activity, activityErrors: {} });
  const now = () => new Date('2026-11-02T12:35:00Z');
  const ok = await runWeekly({ db, token: 't', env: {}, load, send, now });
  eq([ok.ok, sent.length, sent[0].to, sent[0].attachments.length, logs[0].ok], [true, 1, ['daniel.baldauf@se.com'], 2, true], 'a run sends one email to the owner by default and logs it');
  eq(sent[0].subject, 'HubSpot import files for the week of 2026-11-02', 'subject names the week');
  await runWeekly({ db, token: 't', env: { HUBSPOT_WEEKLY_TO: 'a@se.com; b@se.com' }, load, send, now });
  eq(sent[1].to, ['a@se.com', 'b@se.com'], 'HUBSPOT_WEEKLY_TO overrides the recipient');

  const bad = await runWeekly({ db, token: 't', env: {}, load: async () => { throw new Error('HubSpot 401'); }, send, now });
  eq([bad.ok, bad.error, sent.length, logs.at(-1).ok], [false, 'HubSpot 401', 2, false], 'a failure is logged with its error and sends nothing');
  const noToken = await runWeekly({ db, token: '', env: {}, load, send, now });
  eq([noToken.ok, /HUBSPOT_ACCESS_TOKEN/.test(noToken.error)], [false, true], 'no token: a clear error');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
