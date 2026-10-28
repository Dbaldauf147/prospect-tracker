// The weekly HubSpot import files, built on the server and emailed, for the
// corporate portal the app has no API access to (IT allows no private or
// installed apps there). Dan keeps the current portal as the app's own and
// refreshes the corporate one from these every week by hand, with
// HubSpot's Import screen.
//
// Same files the Account move tab builds in the browser
// (src/utils/hubspotImportFiles.js), from the same sources read here
// instead: the contacts and their activity from the current portal's API,
// the companies, settings and Opps from Firestore. Activity is read with
// only the few properties a history line needs, not from a full backup, so
// the whole job fits in one function call.
//
// Three attachments, each with its own import mode:
//   1 companies          Create new records only
//   2 new contacts       Create new records only (the full list each week:
//                        anyone already in the portal is skipped)
//   3 contact updates    Update existing records only (email + Dan's own
//                        fields, so nothing a colleague keeps is touched)

import { buildImportFiles, liveOpps, weeklyUpdateFile } from '../../src/utils/hubspotImportFiles.js';
import { toCsv } from '../../src/utils/csv.js';
import { stripDashes } from '../../src/utils/exportSanitize.js';
import { digestRecords } from './activityDigest.js';

const BASE = 'https://api.hubapi.com';

// What each activity type's history line needs.
const ACTIVITY_PROPS = {
  emails: ['hs_timestamp', 'hs_email_subject', 'hs_email_direction'],
  meetings: ['hs_timestamp', 'hs_meeting_title'],
  calls: ['hs_timestamp', 'hs_call_title'],
  notes: ['hs_timestamp', 'hs_note_body'],
  tasks: ['hs_timestamp', 'hs_task_subject'],
};

/**
 * Every activity in the portal as { [contactId]: [[whenMs, kind, subject]] }.
 * `get` is a GET-JSON function for a HubSpot path. A type the token can't
 * read is listed in `errors` and the rest still count.
 */
export async function liveActivity(get) {
  const activity = {};
  const errors = {};
  for (const [type, props] of Object.entries(ACTIVITY_PROPS)) {
    try {
      let after = '';
      for (let i = 0; i < 2000; i += 1) {
        const qs = new URLSearchParams({ limit: '100', properties: props.join(','), associations: 'contacts' });
        if (after) qs.set('after', after);
        const page = await get(`/crm/v3/objects/${type}?${qs}`);
        // The list answer nests associations as { contacts: { results } };
        // the digest reads the backup's { contacts: [{ id }] }.
        const records = (page.results || []).map(r => ({
          ...r,
          associations: { contacts: (r.associations?.contacts?.results || []).map(a => ({ id: String(a.id) })) },
        }));
        for (const [id, when, kind, subject] of digestRecords(type, records)) {
          (activity[id] || (activity[id] = [])).push([when, kind, subject]);
        }
        after = page.paging?.next?.after || '';
        if (!after) break;
      }
    } catch (err) {
      errors[type] = String(err?.message || err).slice(0, 300);
    }
  }
  return { activity, errors };
}

/** A GET-JSON function for one HubSpot token, waiting out rate limits. */
export function hubspotGetter(token, { fetchImpl = fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  return async (path) => {
    let res = await fetchImpl(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    for (let i = 0; i < 4 && (res.status === 429 || res.status >= 500); i += 1) {
      const after = Number(res.headers?.get?.('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 15000) : 1000 * (2 ** i));
      res = await fetchImpl(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!res.ok) throw new Error(`HubSpot ${res.status} on ${path.split('?')[0]}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return res.json();
  };
}

// A cached HubSpot contact ({ id, properties }) in the flat shape the
// builder reads, the same one the browser cache holds.
export const flatContact = (c) => ({ id: String(c.id), ...(c.properties || {}) });

/**
 * Build the three attachments and the email's summary from loaded data.
 * Pure.
 */
export function buildWeeklyFiles({ prospects, contacts, opps, settings, activity, ownerEmail, date }) {
  const built = buildImportFiles({ prospects, contacts, opps: liveOpps(opps), settings, ownerEmail, activity });
  const updates = weeklyUpdateFile(built.contacts);
  const csv = (f) => `\uFEFF${stripDashes(toCsv(f.headers, f.rows))}`;
  const attachments = [
    { filename: `hubspot-${date}-1-companies.csv`, content: csv(built.companies), contentType: 'text/csv; charset=utf-8' },
    { filename: `hubspot-${date}-2-new-contacts.csv`, content: csv(built.contacts), contentType: 'text/csv; charset=utf-8' },
    { filename: `hubspot-${date}-3-contact-updates.csv`, content: csv(updates), contentType: 'text/csv; charset=utf-8' },
  ];
  const counts = {
    companies: built.companies.rows.length,
    contacts: built.contacts.rows.length,
    updates: updates.rows.length,
    withHistory: built.report.contactsWithHistory,
    colleaguesLeftOut: built.report.contactsColleagues,
    companiesNoWebsite: built.report.companiesNoDomain.length,
  };
  return { attachments, counts, report: built.report };
}

const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function weeklyEmailHtml({ counts, attachments, activityErrors = {} }) {
  const n = (v) => Number(v || 0).toLocaleString('en-US');
  const errs = Object.entries(activityErrors);
  const step = (i, file, what, mode) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top"><b>${i}</b></td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top">${esc(file)}<br><span style="color:#64748b">${what}</span></td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top"><b>${mode}</b></td>
    </tr>`;
  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#334155;font-size:13px">
      <h2 style="color:#009530;margin:0 0 8px">Your weekly HubSpot import files</h2>
      <p style="margin:0 0 12px">Import these three files into the Schneider HubSpot account, in this order
        (Data integration, Import a file, File from computer, One file, One object).</p>
      <table style="border-collapse:collapse;margin:0 0 14px">
        <thead><tr>
          <th style="padding:4px 10px;text-align:left;border-bottom:2px solid #ddd">#</th>
          <th style="padding:4px 10px;text-align:left;border-bottom:2px solid #ddd">File</th>
          <th style="padding:4px 10px;text-align:left;border-bottom:2px solid #ddd">Import option</th>
        </tr></thead>
        <tbody>
          ${step(1, attachments[0].filename, `${n(counts.companies)} companies. Object: Companies.`, 'Create new records only')}
          ${step(2, attachments[1].filename, `${n(counts.contacts)} contacts, all of them: anyone already in HubSpot is skipped. Object: Contacts.`, 'Create new records only')}
          ${step(3, attachments[2].filename, `${n(counts.updates)} contacts: your tags and activity history only. Object: Contacts.`, 'Update existing records only')}
        </tbody>
      </table>
      <p style="margin:0 0 6px">${n(counts.withHistory)} contacts carry activity history.
        Left out: ${n(counts.colleaguesLeftOut)} colleagues at your own domain, ${n(counts.companiesNoWebsite)} companies with no website.</p>
      ${errs.length ? `<p style="color:#b45309">Activity that could not be read this week (the history is missing these): ${errs.map(([t, e]) => `${esc(t)}: ${esc(e)}`).join('; ')}</p>` : ''}
      <p style="color:#8896A6;font-size:11px;margin-top:18px">Sent every Monday by Prospect Tracker. On the files' mapping screens, Company Domain Name links contacts to their company. Built from your current HubSpot account and the site; nothing was sent to the Schneider account.</p>
    </div>`;
}
