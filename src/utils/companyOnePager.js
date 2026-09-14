// The company one-pager: who we know, what they already buy, and who owns
// the account, on a single branded page.
//
// The thing this is for is the five minutes before a meeting - a handover,
// a manager asking "what is the story on this account", a leave-behind.
// So it is one page by construction rather than by luck: the lists are
// capped, the sections are fixed, and anything that would push it onto a
// second page is summarised instead ("+7 more").
//
// Pure HTML, no DOM, no Firebase. The modal hands it the figures it has
// already computed and turns the result into a .docx with the same
// html-docx-js path the opportunity notes use - so this can be rendered
// and read in a test without a browser, which is the only way the layout
// is checked at all.
//
// Word is the target, and it is not a browser. The markup below keeps to
// what Word's HTML import actually honours: tables for layout, inline
// styles, background colours on cells rather than on divs. No flexbox, no
// grid, no CSS that has to cascade.

import {
  SE_GREEN, SE_GREEN_DARK, SE_GRAPHITE, SE_SLATE, SE_MUTED, SE_SURFACE, SE_BORDER,
  SE_EMAIL_FONT,
} from './schneiderBrand.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// What fits on one page. Past these the section says how many it left out
// rather than running on: a one-pager that is three pages is a document
// nobody reads in the five minutes it exists for.
export const MAX_CONTACTS = 8;
export const MAX_SERVICES = 14;

const clean = (v) => String(v ?? '').trim();

/**
 * A contact as the sheet lists them. `decisionMaker` floats them to the
 * top and earns the marker: on a page about who we know, the answer to
 * "who signs" is the first thing looked for.
 */
export function orderContacts(contacts) {
  const rows = (contacts || []).map(c => ({
    name: clean(c?.name),
    title: clean(c?.title),
    email: clean(c?.email),
    phone: clean(c?.phone),
    decisionMaker: !!c?.decisionMaker,
    metInPerson: !!c?.metInPerson,
  })).filter(c => c.name || c.email);
  // Decision makers first, then anyone already met, then by name. Stable
  // beyond that, so two runs of the same account produce the same sheet.
  return rows.sort((a, b) => (Number(b.decisionMaker) - Number(a.decisionMaker))
    || (Number(b.metInPerson) - Number(a.metInPerson))
    || a.name.localeCompare(b.name));
}

function headerHtml({ company, generatedAt }) {
  const when = generatedAt instanceof Date && !isNaN(generatedAt)
    ? generatedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
    <tr>
      <td bgcolor="${SE_GREEN_DARK}" style="background-color:${SE_GREEN_DARK};padding:14px 18px">
        <div style="font-family:${SE_EMAIL_FONT};font-size:22px;font-weight:700;color:#FFFFFF;line-height:1.2">${esc(company) || 'Company'}</div>
        <div style="font-family:${SE_EMAIL_FONT};font-size:11px;color:#DCFCE7;letter-spacing:.06em;text-transform:uppercase;margin-top:2px">Account summary${when ? ` &#183; ${esc(when)}` : ''}</div>
      </td>
      <!-- The tagline is a light tint rather than SE_GREEN: brand green on
           the dark green band is the one pairing in the kit that cannot be
           read, and the lockup renders white on dark everywhere else. -->
      <td bgcolor="${SE_GREEN_DARK}" align="right" style="background-color:${SE_GREEN_DARK};padding:14px 18px;vertical-align:bottom">
        <div style="font-family:${SE_EMAIL_FONT};font-size:15px;font-weight:700;color:#FFFFFF;line-height:1.1">Schneider Electric</div>
        <div style="font-family:${SE_EMAIL_FONT};font-size:10px;color:#A7F3D0;letter-spacing:.14em;text-transform:uppercase">Life Is On</div>
      </td>
    </tr>
  </table>`;
}

const sectionHead = (label, note) => `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:16px 0 6px">
    <tr>
      <td style="border-bottom:2px solid ${SE_GREEN};padding-bottom:3px">
        <span style="font-family:${SE_EMAIL_FONT};font-size:12px;font-weight:700;color:${SE_GREEN_DARK};letter-spacing:.08em;text-transform:uppercase">${esc(label)}</span>
        ${note ? `<span style="font-family:${SE_EMAIL_FONT};font-size:10px;color:${SE_MUTED};font-weight:400"> &#183; ${esc(note)}</span>` : ''}
      </td>
    </tr>
  </table>`;

// The two names that answer "who do I ask about this account". Side by
// side at the top because they are the reason a handover reads this at
// all, and a blank one says so rather than leaving the reader guessing
// whether it is unassigned or just missing from the sheet.
function ownersHtml({ cdm, clientManager }) {
  const cell = (label, value) => `<td width="50%" bgcolor="${SE_SURFACE}" style="width:50%;background-color:${SE_SURFACE};border:1px solid ${SE_BORDER};padding:9px 12px">
      <div style="font-family:${SE_EMAIL_FONT};font-size:10px;font-weight:700;color:${SE_MUTED};letter-spacing:.06em;text-transform:uppercase">${esc(label)}</div>
      <div style="font-family:${SE_EMAIL_FONT};font-size:14px;font-weight:700;color:${value ? SE_GRAPHITE : SE_MUTED};margin-top:1px">${esc(value) || 'Not assigned'}</div>
    </td>`;
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:12px">
    <tr>
      ${cell('CDM', cdm)}
      <td width="10" style="width:10px"></td>
      ${cell('Client Manager', clientManager)}
    </tr>
  </table>`;
}

function contactsHtml(contacts) {
  const rows = orderContacts(contacts);
  if (!rows.length) {
    return `<div style="font-family:${SE_EMAIL_FONT};font-size:12px;color:${SE_MUTED};font-style:italic">No contacts on file for this company yet.</div>`;
  }
  const shown = rows.slice(0, MAX_CONTACTS);
  const head = ['Name', 'Title', 'Email', 'Phone'].map(h => (
    `<th align="left" style="font-family:${SE_EMAIL_FONT};font-size:10px;font-weight:700;color:${SE_MUTED};letter-spacing:.06em;text-transform:uppercase;padding:4px 8px;border-bottom:1px solid ${SE_BORDER}">${h}</th>`
  )).join('');
  const body = shown.map(c => `<tr>
      <td style="font-family:${SE_EMAIL_FONT};font-size:12px;font-weight:700;color:${SE_GRAPHITE};padding:5px 8px;border-bottom:1px solid #EEF2F6">
        ${esc(c.name)}${c.decisionMaker ? `<span style="color:${SE_GREEN_DARK};font-size:10px;font-weight:700"> &#183; DM</span>` : ''}
      </td>
      <td style="font-family:${SE_EMAIL_FONT};font-size:12px;color:${SE_SLATE};padding:5px 8px;border-bottom:1px solid #EEF2F6">${esc(c.title) || '-'}</td>
      <td style="font-family:${SE_EMAIL_FONT};font-size:11px;color:${SE_SLATE};padding:5px 8px;border-bottom:1px solid #EEF2F6">${esc(c.email) || '-'}</td>
      <td style="font-family:${SE_EMAIL_FONT};font-size:11px;color:${SE_SLATE};padding:5px 8px;border-bottom:1px solid #EEF2F6;white-space:nowrap">${esc(c.phone) || '-'}</td>
    </tr>`).join('');
  const more = rows.length > shown.length
    ? `<div style="font-family:${SE_EMAIL_FONT};font-size:10px;color:${SE_MUTED};margin-top:3px">+ ${rows.length - shown.length} more on the company record.</div>`
    : '';
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
    <tr>${head}</tr>
    ${body}
  </table>${more}`;
}

// What the account already buys. Chips rather than a list: the question is
// "how much of the catalog is in already", and a block of them answers it
// at a glance in a way a bulleted column does not.
function servicesHtml(services) {
  const names = (services || []).map(clean).filter(Boolean);
  if (!names.length) {
    return `<div style="font-family:${SE_EMAIL_FONT};font-size:12px;color:${SE_MUTED};font-style:italic">Nothing sold on this account yet.</div>`;
  }
  const shown = names.slice(0, MAX_SERVICES);
  const chips = shown.map(n => (
    `<td bgcolor="${SE_SURFACE}" style="background-color:${SE_SURFACE};border:1px solid ${SE_GREEN};padding:4px 9px;font-family:${SE_EMAIL_FONT};font-size:11px;font-weight:700;color:${SE_GREEN_DARK};white-space:nowrap">${esc(n)}</td>`
  ));
  // Three to a row: Word lays a table out at the width it is given and
  // will not wrap cells the way a browser wraps inline blocks.
  const rows = [];
  for (let i = 0; i < chips.length; i += 3) {
    const cells = chips.slice(i, i + 3);
    while (cells.length < 3) cells.push('<td></td>');
    rows.push(`<tr>${cells.join('<td width="6" style="width:6px"></td>')}</tr>`);
  }
  const more = names.length > shown.length
    ? `<div style="font-family:${SE_EMAIL_FONT};font-size:10px;color:${SE_MUTED};margin-top:4px">+ ${names.length - shown.length} more sold.</div>`
    : '';
  return `<table cellpadding="0" cellspacing="3" border="0" style="border-collapse:separate">${rows.join('')}</table>${more}`;
}

/**
 * The one-pager, as a complete HTML document.
 *
 * @param company        the account name
 * @param cdm            the CDM on the account
 * @param clientManager  the Client Manager on the account
 * @param services       the services already sold, as names
 * @param contacts       [{ name, title, email, phone, decisionMaker, metInPerson }]
 * @param notes          optional free text, printed under the fold
 * @param generatedAt    stamped in the header; pass a fixed date to get a
 *                       byte-identical document out of the same account
 */
export function buildCompanyOnePagerHtml({
  company = '',
  cdm = '',
  clientManager = '',
  services = [],
  contacts = [],
  notes = '',
  generatedAt = new Date(),
} = {}) {
  const sold = (services || []).map(clean).filter(Boolean);
  const trimmedNotes = clean(notes);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(company) || 'Company'} - Account summary</title></head>
<body style="margin:0;padding:0;background-color:#FFFFFF">
  <div style="font-family:${SE_EMAIL_FONT};color:${SE_GRAPHITE}">
    ${headerHtml({ company, generatedAt })}
    ${ownersHtml({ cdm: clean(cdm), clientManager: clean(clientManager) })}
    ${sectionHead('Key contacts', 'DM marks a tagged decision maker')}
    ${contactsHtml(contacts)}
    ${sectionHead('In scope today', `${sold.length} service${sold.length === 1 ? '' : 's'} sold`)}
    ${servicesHtml(sold)}
    ${trimmedNotes ? `${sectionHead('Notes')}<div style="font-family:${SE_EMAIL_FONT};font-size:12px;line-height:1.45;color:${SE_SLATE};white-space:pre-wrap">${esc(trimmedNotes)}</div>` : ''}
    <div style="font-family:${SE_EMAIL_FONT};font-size:9px;color:${SE_MUTED};margin-top:18px;border-top:1px solid ${SE_BORDER};padding-top:5px">
      Schneider Electric &#183; generated from Prospect Tracker. Internal use.
    </div>
  </div>
</body></html>`;
}

/** The download name, with the characters Windows refuses taken out. */
export function onePagerFileName(company) {
  const safe = clean(company).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'Company';
  return `${safe} - Account summary.docx`;
}
