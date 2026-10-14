import { useMemo, useState, useCallback, useRef, useEffect, Fragment } from 'react';
import { useSyncedTablePref, SET_PREF } from '../../hooks/useSyncedTablePref';
import { writeWorkKey } from '../../utils/mirroredWorkKeys';
import { apiFetch } from '../../utils/apiFetch';
import { logAction } from '../../utils/auditLog';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotContacts, updateHubspotCache } from '../../utils/hubspotContactsCache';
import { matchesCdm, resolveTargetAccountCdm } from '../../utils/cdmMatch';
import { getQueuedContactIds, setQueuedContactIds } from '../../utils/draftCampaignQueue';
import { userLsGet, userLsSet, userLsRemove } from '../../utils/userLs';
import { buildEmailFromPattern, estimateEmailDomain } from '../../utils/emailDomainPattern';
import { FREE_MAIL_DOMAINS } from '../../utils/companyGuess';
import {
  companyTextEquals, companyRuleKey, groupCompanyMappings, pendingSuggestionActions, summarizeSuggestionActions,
} from '../../utils/bulkSuggestionActions';
import { ColumnToggle } from '../common/ColumnToggle';
import { orderColumns, mergeColumnOrder } from '../../utils/tableColumnPrefs';
import { classifyHqCountry, OUTSIDE_NORTH_AMERICA } from '../../utils/hqRegion';
import { parseContactPaste } from '../../utils/contactPaste';
import { companiesMatch } from '../../utils/listFlags';
import { contactIsHidden } from '../ProspectModal/contactTags';
import { ContactsTable } from '../ProspectModal/ContactsTable';
import { applyTagPresetToContact, presetSummary } from '../../utils/tagPresets';
import { tagVocabulary } from '../../utils/contactTagReview';
import styles from './AgendaView.module.css';

const STORAGE_KEY = 'bulk-contacts-cache';

// Columns we'll try to pull out of an uploaded Excel alongside the
// standard contact fields. When present, we offer to backfill the
// matched Table View prospect with any of these four values it's
// missing (website, Zoom Company ID/Name, email domain).
const PROSPECT_BACKFILL_FIELDS = [
  { key: 'website',         label: 'Website',           aliases: ['website', 'url', 'web', 'homepage'] },
  { key: 'zoomCompanyId',   label: 'Zoom Company ID',   aliases: ['zoomcompanyid', 'zoomid'] },
  { key: 'zoomCompanyName', label: 'Zoom Company Name', aliases: ['zoomcompanyname', 'zoomname'] },
  { key: 'emailDomain',     label: 'Email Domain',      aliases: ['emaildomain', 'domain'] },
];

// Priority-ordered mapping rules: for each header we pick the FIRST
// rule whose pattern appears in the normalized header string. Order
// matters — Zoom / ZoomInfo patterns come before generic "company" /
// "name" so "ZoomInfo Company Name" maps to the Zoom field rather
// than landing on the plain Company column. linkedin rules come
// before the generic website rule so a "LinkedIn URL" header doesn't
// land on Website. city/state/country rules sit above the company
// rule so "Company City" doesn't match company.
const HEADER_MATCH_RULES = [
  ['_upload_zoomCompanyId',   ['zoominfocompanyid', 'zoominfocompnyid', 'zoomcompanyid', 'zicompanyid', 'zoominfoid', 'zoomid', 'ziid']],
  ['_upload_zoomCompanyName', ['zoominfocompanyname', 'zoomcompanyname', 'zicompanyname', 'zoominfoname', 'zoomname']],
  ['linkedinUrl',             ['contactlinkedin', 'employeelinkedin', 'personlinkedin', 'linkedincontactprofile', 'linkedincontactprofileurl', 'linkedinurl', 'linkedinprofileurl', 'linkedinprofile', 'linkedin']],
  ['_upload_website',         ['companywebsite', 'companyurl', 'website', 'homepage', 'url']],
  ['_upload_emailDomain',     ['emaildomain', 'domainpattern', 'companydomain']],
  ['email',                   ['emailaddress', 'workemail', 'email']],
  ['mobilePhone',             ['mobilephonenumber', 'cellphonenumber', 'mobilephone', 'cellphone', 'mobile', 'cell']],
  ['phone',                   ['workphonenumber', 'officephone', 'directphone', 'workphone', 'phonenumber', 'phone']],
  ['firstname',               ['firstname', 'givenname', 'first']],
  ['lastname',                ['lastname', 'surname', 'familyname', 'last']],
  ['jobtitle',                ['jobtitle', 'position', 'title', 'role']],
  ['city',                    ['city']],
  ['state',                   ['stateprovinceregion', 'stateprovince', 'state']],
  ['country',                 ['country']],
  ['company',                 ['accountname', 'companyname', 'organization', 'company', 'account']],
  ['dans_tags',               ['danstags', 'tags']],
  // Full Name last: every more-specific name-ish header (First/Last/Company
  // Name, etc.) is claimed by an earlier rule first, so this only catches a
  // single combined-name column like "Full Name" / "Contact Name" / "Name".
  ['fullName',                ['fullname', 'fullcontactname', 'contactfullname', 'contactname', 'employeefullname', 'employeename', 'personname', 'displayname', 'name']],
];

// Headers that should never be auto-mapped, even if a rule pattern
// appears inside them. Checked before the rules. This keeps noisy
// exports from silently landing on the wrong field — e.g. "Company
// Division Name" no longer gets captured as Company, "ZoomInfo
// Contact Profile URL" doesn't land on the Website column, and
// "Company LinkedIn URL" never fills the contact's LinkedIn field
// (we only want the employee's personal profile).
const IGNORE_HEADER_PATTERNS = [
  'companydivision',
  'divisionname',
  'zoominfocontactprofile',
  'companylinkedin',
  'linkedincompany',
];

// All the destination fields a file column can be mapped to. Drives
// the Maps-To dropdown in the mapping preview modal and the default
// row schema in the parser.
const FIELD_OPTIONS = [
  { key: '',                         label: '(Ignore this column)' },
  { key: 'email',                    label: 'Email (required)' },
  { key: 'firstname',                label: 'First Name' },
  { key: 'lastname',                 label: 'Last Name' },
  { key: 'fullName',                 label: 'Full Name (splits to First / Last)' },
  { key: 'company',                  label: 'Company' },
  { key: 'phone',                    label: 'Work Phone Number' },
  { key: 'mobilePhone',              label: 'Cell Phone Number' },
  { key: 'jobtitle',                 label: 'Job Title' },
  { key: 'linkedinUrl',              label: 'LinkedIn URL' },
  { key: 'city',                     label: 'City' },
  { key: 'state',                    label: 'State' },
  { key: 'country',                  label: 'Country' },
  { key: 'dans_tags',                label: "Dan's Tags" },
  { key: '_upload_website',          label: 'Table View: Website' },
  { key: '_upload_zoomCompanyId',    label: 'Table View: Zoom Company ID' },
  { key: '_upload_zoomCompanyName',  label: 'Table View: Zoom Company Name' },
  { key: '_upload_emailDomain',      label: 'Table View: Email Domain' },
];

// Auto-map a set of file headers to our internal destination fields.
// Each header can only feed one field (first qualifying rule wins) to
// avoid ambiguous collisions like "Company Name" vs. "ZoomInfo Company
// Name". Returns { header: destinationKey | '' }.
function autoMapHeaders(headers) {
  const norm = s => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapping = {};
  const usedKeys = new Set();
  for (const h of headers) {
    const n = norm(h);
    if (!n) { mapping[h] = ''; continue; }
    if (IGNORE_HEADER_PATTERNS.some(p => n.includes(p))) {
      mapping[h] = '';
      continue;
    }
    let matched = '';
    for (const [key, patterns] of HEADER_MATCH_RULES) {
      if (usedKeys.has(key)) continue;
      if (patterns.some(p => n === p || n.includes(p))) {
        matched = key;
        usedKeys.add(key);
        break;
      }
    }
    mapping[h] = matched;
  }
  return mapping;
}

// Given a mapping and raw sheet rows, produce an array of AgendaView
// row objects. Rows without an email are dropped, as are @se.com
// addresses. All destination fields present in the schema below are
// initialized so downstream code can rely on their presence.
function applyMappingToRows(rawRows, mapping) {
  const out = [];
  for (const r of rawRows) {
    const out1 = {
      email: '', firstname: '', lastname: '', company: '',
      phone: '', mobilePhone: '', jobtitle: '', linkedinUrl: '',
      city: '', state: '', country: '', dans_tags: '',
    };
    for (const f of PROSPECT_BACKFILL_FIELDS) out1[`_upload_${f.key}`] = '';
    let fullName = '';
    for (const [src, dst] of Object.entries(mapping)) {
      if (!dst) continue;
      const val = String(r[src] ?? '').trim();
      // Full Name is a composite — capture it and split below rather than
      // writing it to a real row field.
      if (dst === 'fullName') { fullName = val; continue; }
      out1[dst] = val;
    }
    // Split a mapped Full Name into first/last (handles "Last, First" too),
    // but let explicitly-mapped First/Last columns win when both are present.
    if (fullName && !out1.firstname && !out1.lastname) {
      const { firstname, lastname } = splitFullName(fullName);
      out1.firstname = firstname;
      out1.lastname = lastname;
    }
    // Keep name-only rows (no email column) so the address can be estimated
    // from the company's recorded pattern after import. Drop rows that have
    // neither an email nor a name — there's nothing to import or estimate.
    if (!out1.email && !out1.firstname && !out1.lastname) continue;
    if (out1.email) {
      out1.email = out1.email.toLowerCase();
      if (out1.email.endsWith('@se.com')) continue;
    }
    out.push(out1);
  }
  return out;
}

// Parse an uploaded Excel sheet into an array of AgendaView-compatible
// rows using the auto-mapper. Used for the plain-text fallback path
// when we don't surface a mapping preview.
function parseContactsXlsx(rows) {
  if (!rows || !rows.length) return [];
  const headers = Object.keys(rows[0]);
  const mapping = autoMapHeaders(headers);
  return applyMappingToRows(rows, mapping);
}

// "Name <email@x.com>" or just "email@x.com" or "First Last (email)" — extract pairs.
const PAIR_RE = /(?:"?([^"<\n,;]+?)"?\s*[<(]\s*)?([\w.+-]+@[\w-]+\.[\w.-]+)\s*[>)]?/g;

function parseDroppedText(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  let m;
  PAIR_RE.lastIndex = 0;
  while ((m = PAIR_RE.exec(text)) !== null) {
    const email = m[2].toLowerCase();
    if (seen.has(email)) continue;
    if (email.endsWith('@se.com')) continue;
    seen.add(email);
    let name = (m[1] || '').trim().replace(/^['"]|['"]$/g, '');
    let firstname = '';
    let lastname = '';
    if (name) {
      if (name.includes(',')) {
        // "Last, First" - common for Outlook contact cards.
        const [lastPart, firstPart = ''] = name.split(',').map(s => s.trim());
        lastname = lastPart;
        firstname = firstPart;
      } else {
        const parts = name.split(/\s+/);
        firstname = parts[0] || '';
        lastname = parts.slice(1).join(' ') || '';
      }
    }
    out.push({
      email,
      firstname,
      lastname,
      company: '',
      phone: '',
      jobtitle: '',
      suggestedCompany: '',
      companyDomains: [],
    });
  }
  return out;
}

// Try to find headers in dropped text (for forwarded emails or pasted message blocks).
// e.g. "From: Name <a@b.com>" / "To: ..." / "Cc: ..."
function parseEmailHeaders(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (const line of lines) {
    const m = /^\s*(From|To|Cc|Bcc|Sent\s+On\s+Behalf\s+Of)\s*:\s*(.+)$/i.exec(line);
    if (m) blocks.push(m[2]);
  }
  return blocks.length ? parseDroppedText(blocks.join('; ')) : parseDroppedText(text);
}

// Everything a pasted or dropped block of text names: the "Name <email>"
// pairs, plus the people it lists by name and title without an address (an
// account plan, a LinkedIn search), read by the same parser as the company
// popup's Paste Contacts so the two can't disagree about a paste. Name-only
// rows get an estimated email from the company's pattern once a company is
// set, same as a sheet row.
function parsePastedText(text) {
  const withEmail = parseEmailHeaders(text);
  const named = new Set(withEmail.map(r => `${r.firstname} ${r.lastname}`.trim().toLowerCase()).filter(Boolean));
  const byName = parseContactPaste(text)
    .filter(r => !r.email && !named.has(`${r.firstname} ${r.lastname}`.toLowerCase()))
    .map(r => ({
      email: '', firstname: r.firstname, lastname: r.lastname, company: '',
      phone: '', mobilePhone: '', jobtitle: r.jobtitle, linkedinUrl: r.linkedin,
      city: '', state: '', country: '', dans_tags: '',
    }));
  return [...withEmail, ...byName];
}

// Compose a row's full name from its firstname + lastname halves, and
// the inverse split (used by the editable Full Name cell). Mirrors the
// "Last, First" handling in parseDroppedText so a paste from Outlook
// works the same whether the user dumps it into the Full Name cell or
// into the bulk-paste box at the top of the page.
function composeFullName(r) {
  return `${r?.firstname || ''} ${r?.lastname || ''}`.trim();
}
function splitFullName(input) {
  const name = String(input || '').trim();
  if (!name) return { firstname: '', lastname: '' };
  if (name.includes(',')) {
    const [lastPart, firstPart = ''] = name.split(',').map(s => s.trim());
    return { firstname: firstPart, lastname: lastPart };
  }
  const parts = name.split(/\s+/);
  return { firstname: parts[0] || '', lastname: parts.slice(1).join(' ') || '' };
}

// Saved "when a contact's parsed Company matches X, auto-apply Y"
// rules. Persisted to localStorage so the user doesn't have to keep
// re-clicking the same Suggested Company pill across imports.
const COMPANY_RULES_KEY = 'bulk-contacts-company-rules';
const BULK_COL_WIDTHS_KEY = 'bulk-contacts-col-widths';
const BULK_COL_VISIBLE_KEY = 'bulk-contacts-col-visible';
const BULK_COL_STARRED_KEY = 'bulk-contacts-col-starred';
const BULK_COL_REMOVED_KEY = 'bulk-contacts-col-removed';
const BULK_COL_ORDER_KEY = 'bulk-contacts-col-order';

// Column catalog for the Bulk Add Contacts table. order drives the
// layout; key is the single source of truth for width state, toggle
// state, and (where applicable) sort/filter handlers.
const BULK_COLS = [
  { key: '_remove',          label: '',                    w: 36,  fixed: true, toggleable: false },
  { key: 'email',            label: 'Email',               w: 230 },
  { key: 'status',           label: 'HubSpot Status',      w: 170 },
  { key: 'fullName',         label: 'Full Name',           w: 180 },
  { key: 'firstname',        label: 'First',               w: 110 },
  { key: 'lastname',         label: 'Last',                w: 130 },
  { key: 'jobtitle',         label: 'Job title',           w: 140 },
  { key: 'company',          label: 'Company',             w: 180 },
  { key: 'tier',             label: 'Tier',                w: 90  },
  { key: 'cdmReps',          label: 'CDM / Other Reps',    w: 220 },
  { key: 'suggestedCompany', label: 'Suggested Company',   w: 170 },
  { key: 'website',          label: 'TV Website',          w: 160 },
  { key: 'zoomCompanyId',    label: 'TV Zoom ID',          w: 130 },
  { key: 'zoomCompanyName',  label: 'TV Zoom Name',        w: 160 },
  { key: 'emailDomain',      label: 'TV Email Domain',     w: 200 },
  { key: 'dans_tags',        label: "Dan's Tags",          w: 140 },
  { key: 'phone',            label: 'Work Phone Number',   w: 140 },
  { key: 'mobilePhone',      label: 'Cell Phone Number',   w: 140 },
  { key: 'linkedinUrl',      label: 'LinkedIn URL',        w: 180 },
  { key: 'city',             label: 'City',                w: 110 },
  { key: 'state',            label: 'State',               w: 90  },
  { key: 'country',          label: 'Country',             w: 110 },
  { key: 'notes',            label: 'Notes',               w: 240 },
];
function loadBulkColWidths() {
  try { return JSON.parse(localStorage.getItem(BULK_COL_WIDTHS_KEY)) || {}; } catch { return {}; }
}
function persistBulkColWidths(obj) {
  try { localStorage.setItem(BULK_COL_WIDTHS_KEY, JSON.stringify(obj)); } catch {}
}
function loadBulkColVisible() {
  try {
    const raw = localStorage.getItem(BULK_COL_VISIBLE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr);
  } catch {}
  return null;
}
function persistBulkColVisible(set) {
  try { localStorage.setItem(BULK_COL_VISIBLE_KEY, JSON.stringify([...set])); } catch {}
}
function loadBulkColOrder() {
  try {
    const arr = JSON.parse(localStorage.getItem(BULK_COL_ORDER_KEY));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function persistBulkColOrder(arr) {
  try { localStorage.setItem(BULK_COL_ORDER_KEY, JSON.stringify(arr)); } catch { /* storage blocked */ }
}
// BULK_COLS in the user's saved order. The row-remove x isn't in the
// picker, so it never has a place in the saved order: it stays at the
// left edge rather than drifting to the end.
function orderBulkCols(order) {
  return [
    ...BULK_COLS.filter(c => c.fixed),
    ...orderColumns(BULK_COLS.filter(c => !c.fixed), order),
  ];
}
function loadBulkKeySet(lsKey) {
  try {
    const arr = JSON.parse(localStorage.getItem(lsKey));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function persistBulkKeySet(lsKey, set) {
  try { localStorage.setItem(lsKey, JSON.stringify([...set])); } catch { /* storage blocked */ }
}

// The three groups the Bulk Add Contacts table splits its rows into, in
// display order. See rowBucket for how a row is placed.
const BULK_BUCKETS = [
  { key: 'new',     label: 'New',            color: '#1D4ED8', hint: 'Not in HubSpot yet. Adding to HubSpot creates these contacts.' },
  { key: 'update',  label: 'Update pending', color: '#92400E', hint: 'Already in HubSpot. Adding to HubSpot fills the blank fields listed under each status, and never overwrites a value HubSpot has.' },
  { key: 'hubspot', label: 'In HubSpot',     color: '#475569', hint: 'Already in HubSpot with nothing new to add, so these are ignored.' },
];
// v2: In HubSpot now starts folded shut (those rows are ignored by the
// push, so they're the least useful to look at). A new key, so the default
// reaches browsers that already saved a choice under the first one.
const BULK_BUCKETS_COLLAPSED_KEY = 'bulk-contacts-collapsed-buckets-v2';
const BULK_BUCKETS_COLLAPSED_DEFAULT = ['hubspot'];
// Stands in the bucket's row list where the "Outside US, Canada, Mexico"
// sub-header draws.
const INTL_SUBGROUP = { __intlSubgroup: true };

// True when a contact's Country places them outside the US, Canada and
// Mexico (and the US territories hqRegion counts with them). A blank or
// unreadable Country stays with the rest: never guess foreign from nothing.
// Two-letter codes are read here because classifyHqCountry only knows the
// three-letter ones, and would call "CA" or "MX" foreign.
function contactOutsideNorthAmerica(country) {
  const raw = String(country || '').trim();
  if (!raw) return false;
  if (/^(us|ca|mx|pr)$/i.test(raw)) return false;
  return classifyHqCountry(raw) === OUTSIDE_NORTH_AMERICA;
}

// What the Bulk Add Contacts table's layout is called in settings.tablePrefs.
const BULK_PREFS_TABLE_ID = 'agenda-bulk-contacts';

// A saved visible set, from either copy, with columns added since it was
// saved switched on — otherwise a new column arrives hidden and the user has
// to go find it in the Columns menu. (Today: the Full Name composite cell.)
function bulkVisibleFromSaved(saved) {
  if (!saved || saved.size === 0) return new Set(BULK_COLS.map(c => c.key));
  const next = new Set(saved);
  if (!next.has('fullName')) next.add('fullName');
  return next;
}

// Why a Suggested Company was offered, by lookupMatch's suggestSource.
const SUGGEST_SOURCE_LABELS = {
  'domain-exact':    'matched by email domain (exact)',
  'hubspot-company': "matched by HubSpot contact's Company",
  'typed-company':   'matched against the Company you typed',
  'domain-token':    'matched by email domain brand token',
  'domain-compact':  'matched by email domain compact prefix',
};

function loadCompanyRules() {
  try { return JSON.parse(userLsGet(COMPANY_RULES_KEY)) || {}; } catch { return {}; }
}
function persistCompanyRules(map) {
  try { writeWorkKey(COMPANY_RULES_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function loadCache() {
  try { return JSON.parse(userLsGet(STORAGE_KEY)) || []; } catch { return []; }
}
function saveCache(rows) {
  try { userLsSet(STORAGE_KEY, JSON.stringify(rows)); } catch { /* ignore */ }
}

async function loadHubSpotByEmail() {
  try {
    const contacts = await getHubspotContacts();
    const m = new Map();
    for (const c of contacts) if (c.email) m.set(c.email.toLowerCase(), c);
    return m;
  } catch { return new Map(); }
}

// Convert an ALL-CAPS name to Title Case. "JOHN SMITH" -> "John Smith",
// "MARY-ANNE O'BRIEN" -> "Mary-Anne O'Brien". Mixed-case names pass through unchanged.
function fixAllCapsName(name) {
  if (!name) return name;
  const trimmed = String(name).trim();
  if (!trimmed) return trimmed;
  // Only touch it if it contains at least one letter AND the whole string is uppercase.
  if (!/[A-Z]/.test(trimmed)) return trimmed;
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  // Title-case each run of letters; preserve hyphens, apostrophes, spaces, dots.
  return trimmed.toLowerCase().replace(/([a-z])([a-z]*)/g, (_, first, rest) => first.toUpperCase() + rest);
}

// Extract the "brand" label from a domain — the second-level label minus TLD.
// "urw.com" -> "urw", "ext.urw.com" -> "urw", "acme.co.uk" -> "acme".
function extractBrandToken(domain) {
  if (!domain) return '';
  const parts = domain.split('.').filter(Boolean);
  if (parts.length < 2) return domain;
  const twoPartTlds = new Set(['co.uk', 'co.jp', 'com.au', 'com.br', 'co.nz', 'com.mx', 'co.in']);
  const last2 = parts.slice(-2).join('.');
  if (twoPartTlds.has(last2) && parts.length >= 3) return parts[parts.length - 3];
  return parts[parts.length - 2];
}


// Mirrors the name-from-email guess used on the HubSpot Contacts page:
// split the local part on '.' / '_' / '-' and title-case the first + last token.
// Returns { firstname, lastname } with either/both possibly empty.
function guessNameFromEmail(email) {
  if (!email) return { firstname: '', lastname: '' };
  const at = email.lastIndexOf('@');
  if (at < 0) return { firstname: '', lastname: '' };
  const local = email.slice(0, at).toLowerCase();
  const parts = local.split(/[._-]/).filter(Boolean).filter(p => !/^\d+$/.test(p));
  if (parts.length < 2) return { firstname: '', lastname: '' };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return { firstname: cap(parts[0]), lastname: cap(parts[parts.length - 1]) };
}

// A row's email is "real" when it's a syntactically valid address. Name-only
// pastes arrive without one; rather than leaving the email blank (which would
// collide as a row key and could be mistaken for a sendable address) those rows
// hold a non-email placeholder key — see placeholderEmailKey.
function isRealEmail(e) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
}

// The HubSpot contacts already at a company, for the Company cell's contacts
// popup. Read the same way the company card reads its own list: a fuzzy
// Company-name match, a contact with no Company text on one of the card's
// email domains, and anyone linked to the card by hand, hidden people left
// out. `names` is every spelling the popup knows the company by.
function existingCompanyContacts(contacts, names, card, links) {
  const domains = new Set();
  for (const entry of String(card?.emailDomain || '').split(/[\n;,]+/)) {
    const at = entry.lastIndexOf('@');
    const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
    if (d) domains.add(d);
  }
  const site = String(card?.website || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '').toLowerCase().trim();
  if (site) domains.add(site);
  const linked = new Set((links || []).map(String));
  const out = [];
  for (const c of contacts) {
    if (contactIsHidden(c)) continue;
    const id = String(c.id || c.vid || '');
    let hit = (id && linked.has(id)) || names.some(n => companiesMatch(c.company, n));
    if (!hit && !String(c.company || '').trim() && domains.size) {
      const email = String(c.email || '').toLowerCase();
      const d = email.slice(email.lastIndexOf('@') + 1);
      hit = Boolean(d) && !FREE_MAIL_DOMAINS.has(d) && domains.has(d);
    }
    if (hit) out.push(c);
  }
  return out;
}

// Deterministic, non-email row key for a contact we couldn't find or estimate
// an address for. Derived from name + company so re-pasting the same list
// dedupes instead of piling up duplicates. Never contains '@', so it can't be
// pushed to HubSpot and reads as blank in the (editable) Email cell.
function placeholderEmailKey(firstname, lastname, company) {
  const slug = `${firstname || ''} ${lastname || ''} ${company || ''}`
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `__noemail__${slug || Math.random().toString(36).slice(2)}`;
}

// Prepend https:// when a URL doesn't already carry a protocol so the
// <a href> opens externally instead of being treated as a same-origin
// path ("acme.com" -> "https://acme.com").
function ensureProtocol(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function AgendaView({ prospects = [], onUpdateProspect, onSelectProspect, cdmName, settings, updateSettings, updateSettingsPath, targetAccountsData }) {
  const { user } = useAuth();
  const [rows, setRows] = useState(() => loadCache());
  // Latest-rows ref so callbacks (e.g. toggleSuggestedCompanyDismiss)
  // can read the current rows without re-creating themselves on every
  // row change.
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [results, setResults] = useState({}); // email -> 'added' | 'exists' | 'error: msg'
  const [tvMissingOnly, setTvMissingOnly] = useState(false);
  const [activeTab, setActiveTab] = useState('contacts'); // 'contacts' | 'tableview'
  const [pendingUpload, setPendingUpload] = useState(null); // { fileName, headers, rows, mapping }
  const [sortKey, setSortKey] = useState(null); // column key; null = original insertion order
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'
  // Per-column "show only rows that have a live suggestion" toggles.
  // Keyed by the same identifier as the column header.
  const [columnFilters, setColumnFilters] = useState({
    suggestedCompany: false, website: false, zoomCompanyId: false,
    zoomCompanyName: false, emailDomain: false,
  });
  const toggleColumnFilter = useCallback((key) => {
    setColumnFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const handleSort = useCallback((key) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return key;
      }
      setSortDir('asc');
      return key;
    });
  }, []);
  const [dismissedSuggestedCompanies, setDismissedSuggestedCompanies] = useState(() => new Set());
  const [companyRules, setCompanyRules] = useState(() => loadCompanyRules());
  // Which row's Company cell is swapped out of link mode and into its
  // input. One at a time (keyed by the row's email, the same handle
  // updateRow takes), because editing ends the moment the input blurs.
  const [companyEditKey, setCompanyEditKey] = useState(null);
  // The company whose contacts popup is open: { name, prospectId, card }
  // from the Company cell that was clicked, or null when it is shut.
  const [companyContacts, setCompanyContacts] = useState(null);
  const [companyContactsPicked, setCompanyContactsPicked] = useState(() => new Set());
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  // Bucket groups (New / Update pending / In HubSpot) folded shut on the
  // table. Remembered per browser.
  const [collapsedBuckets, setCollapsedBuckets] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BULK_BUCKETS_COLLAPSED_KEY));
      return new Set(Array.isArray(saved) ? saved : BULK_BUCKETS_COLLAPSED_DEFAULT);
    } catch { return new Set(BULK_BUCKETS_COLLAPSED_DEFAULT); }
  });
  const toggleBucketCollapsed = useCallback((key) => {
    setCollapsedBuckets(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(BULK_BUCKETS_COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);
  // Column-resize + visibility state for the Bulk Add Contacts table.
  const [bulkColWidths, setBulkColWidths] = useSyncedTablePref({
    tableId: BULK_PREFS_TABLE_ID, field: 'widths', settings, updateSettings,
    readLocal: loadBulkColWidths,
    writeLocal: persistBulkColWidths,
  });
  const [bulkColTextFilters, setBulkColTextFilters] = useState({});
  const [bulkMassMode, setBulkMassMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditField, setBulkEditField] = useState('company');
  const [bulkEditValue, setBulkEditValue] = useState('');
  const [bulkEditMode, setBulkEditMode] = useState('replace'); // 'replace' | 'append'
  // "Add a contact by name" mini-form: type first/last/title/company and the
  // email is guessed from the company's recorded naming pattern. manualEmail is
  // kept editable; manualEmailTouched tracks whether the user has overridden the
  // guess so we stop auto-syncing it once they do.
  const [manualEntry, setManualEntry] = useState({ firstname: '', lastname: '', jobtitle: '', company: '' });
  const [manualEmail, setManualEmail] = useState('');
  const [manualEmailTouched, setManualEmailTouched] = useState(false);
  const [manualMsg, setManualMsg] = useState('');
  // Collapse the "Add a contact by name" panel by default so the parsed
  // contacts table (and its sortable / filterable header) gets more
  // vertical room. Remembered per browser.
  const [showManualAdd, setShowManualAdd] = useState(() => {
    try { return localStorage.getItem('bulk-add:show-manual') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('bulk-add:show-manual', showManualAdd ? '1' : '0'); } catch { /* ignore */ }
  }, [showManualAdd]);
  function applyBulkEdit() {
    const field = bulkEditField;
    const value = bulkEditValue;
    if (!field || bulkSelected.size === 0) return;
    setRows(prev => {
      const next = prev.map(r => {
        if (!bulkSelected.has(r.email)) return r;
        if (bulkEditMode === 'append' && (field === 'dans_tags' || field === 'notes')) {
          const existing = String(r[field] || '');
          if (!value.trim()) return r;
          if (existing.split(/[;\n,]+/).map(s => s.trim()).includes(value.trim())) return r;
          const sep = field === 'notes' ? '\n' : '; ';
          return { ...r, [field]: existing ? `${existing}${sep}${value.trim()}` : value.trim() };
        }
        return { ...r, [field]: value };
      });
      saveCache(next);
      return next;
    });
    setBulkEditOpen(false);
    setBulkEditValue('');
  }
  const toggleBulkSelect = useCallback((email) => {
    setBulkSelected(prev => {
      const n = new Set(prev);
      if (n.has(email)) n.delete(email); else n.add(email);
      return n;
    });
  }, []);
  const [bulkColVisible, setBulkColVisible] = useSyncedTablePref({
    tableId: BULK_PREFS_TABLE_ID, field: 'visible', settings, updateSettings,
    readLocal: () => bulkVisibleFromSaved(loadBulkColVisible()),
    writeLocal: persistBulkColVisible,
    toRemote: SET_PREF.toRemote,
    fromRemote: (a) => bulkVisibleFromSaved(SET_PREF.fromRemote(a)),
  });
  // Stars mark the user's own default columns (Reset brings back exactly
  // those), and the picker's × deletes a column out of the table until it's
  // restored. Same model as the shared Columns picker on every other table.
  const [bulkColStarred, setBulkColStarred] = useSyncedTablePref({
    tableId: BULK_PREFS_TABLE_ID, field: 'starred', settings, updateSettings,
    readLocal: () => loadBulkKeySet(BULK_COL_STARRED_KEY),
    writeLocal: (set) => persistBulkKeySet(BULK_COL_STARRED_KEY, set),
    toRemote: SET_PREF.toRemote,
    fromRemote: SET_PREF.fromRemote,
  });
  const [bulkColRemoved, setBulkColRemoved] = useSyncedTablePref({
    tableId: BULK_PREFS_TABLE_ID, field: 'removed', settings, updateSettings,
    readLocal: () => loadBulkKeySet(BULK_COL_REMOVED_KEY),
    writeLocal: (set) => persistBulkKeySet(BULK_COL_REMOVED_KEY, set),
    toRemote: SET_PREF.toRemote,
    fromRemote: SET_PREF.fromRemote,
  });
  // The column order, dragged in the picker. Empty means BULK_COLS order.
  const [bulkColOrder, setBulkColOrder] = useSyncedTablePref({
    tableId: BULK_PREFS_TABLE_ID, field: 'order', settings, updateSettings,
    readLocal: loadBulkColOrder,
    writeLocal: persistBulkColOrder,
    fromRemote: (a) => (Array.isArray(a) ? a : []),
  });
  const orderedBulkCols = useMemo(() => orderBulkCols(bulkColOrder), [bulkColOrder]);
  // The picker only lists the columns it shows, so the drag is merged into
  // the full order: a deleted column keeps its place for when it's restored.
  const reorderBulkCols = useCallback((keys) => {
    setBulkColOrder(mergeColumnOrder(orderedBulkCols.filter(c => !c.fixed).map(c => c.key), keys));
  }, [orderedBulkCols, setBulkColOrder]);
  // The picker lists every column but the row-remove ×, which isn't one
  // the user can hide.
  const bulkPickerColumns = useMemo(
    () => orderedBulkCols.filter(c => c.toggleable !== false && !bulkColRemoved.has(c.key)),
    [orderedBulkCols, bulkColRemoved],
  );
  const bulkRemovedColumns = useMemo(
    () => orderedBulkCols.filter(c => c.toggleable !== false && bulkColRemoved.has(c.key)),
    [orderedBulkCols, bulkColRemoved],
  );
  const bulkPickerVisible = useMemo(
    () => new Set(bulkPickerColumns.filter(c => bulkColVisible.has(c.key)).map(c => c.key)),
    [bulkPickerColumns, bulkColVisible],
  );
  const starBulkCol = useCallback((key) => {
    const star = !bulkColStarred.has(key);
    setBulkColStarred(prev => {
      const next = new Set(prev);
      if (star) next.add(key); else next.delete(key);
      return next;
    });
    // Starring makes the column part of the default view, so it has to be
    // on screen too. Unstarring leaves it where it is.
    if (star) {
      setBulkColVisible(prev => (prev.has(key) ? prev : new Set([...prev, key])));
      setBulkColRemoved(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [bulkColStarred, setBulkColStarred, setBulkColVisible, setBulkColRemoved]);
  const removeBulkCol = useCallback((key) => {
    setBulkColRemoved(prev => new Set([...prev, key]));
  }, [setBulkColRemoved]);
  const restoreBulkCol = useCallback((key) => {
    setBulkColRemoved(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setBulkColVisible(prev => (prev.has(key) ? prev : new Set([...prev, key])));
  }, [setBulkColRemoved, setBulkColVisible]);
  // Reset: every deleted column back, the default order, then the starred
  // view, or every column when nothing is starred.
  const resetBulkCols = useCallback(() => {
    setBulkColRemoved(new Set());
    setBulkColOrder([]);
    setBulkColVisible(new Set(BULK_COLS
      .filter(c => c.toggleable === false || bulkColStarred.size === 0 || bulkColStarred.has(c.key))
      .map(c => c.key)));
  }, [bulkColStarred, setBulkColRemoved, setBulkColVisible, setBulkColOrder]);
  // What actually draws: switched on in the picker and not deleted.
  const bulkColShown = useMemo(
    () => new Set([...bulkColVisible].filter(k => !bulkColRemoved.has(k))),
    [bulkColVisible, bulkColRemoved],
  );
  // BULK_COLS filtered by visibility, with a dynamically-injected
  // _select checkbox column at the left edge when mass-edit mode is on.
  const effectiveBulkCols = useMemo(() => {
    const base = orderedBulkCols.filter(c => c.toggleable === false || bulkColShown.has(c.key));
    if (bulkMassMode) {
      base.unshift({ key: '_select', label: '', w: 32, fixed: true, toggleable: false });
    }
    return base;
  }, [bulkMassMode, bulkColShown, orderedBulkCols]);
  const getBulkColWidth = (key) => bulkColWidths[key] || BULK_COLS.find(c => c.key === key)?.w || 120;
  const toggleBulkColVisible = useCallback((key) => {
    setBulkColVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, [setBulkColVisible]);
  const bulkResizingRef = useRef(null);
  const handleBulkResize = useCallback((e, colKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = (bulkColWidths[colKey] || BULK_COLS.find(c => c.key === colKey)?.w || 120);
    bulkResizingRef.current = colKey;
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const next = Math.max(36, startWidth + dx);
      setBulkColWidths(prev => ({ ...prev, [colKey]: next }));
    };
    const up = () => {
      bulkResizingRef.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [bulkColWidths, setBulkColWidths]);
  // `sweep: false` saves the rule without rewriting the other rows: the
  // bulk Apply sets each row to its own suggestion, and a sweep there would
  // drag rows it never meant to touch along with it.
  const saveCompanyRule = useCallback((raw, canonical, { sweep = true } = {}) => {
    const k = companyRuleKey(raw);
    const v = String(canonical || '').trim();
    if (!k || !v || k === v.toLowerCase()) return;
    setCompanyRules(prev => {
      if (prev[k] === v) return prev;
      const next = { ...prev, [k]: v };
      persistCompanyRules(next);
      return next;
    });
    if (!sweep) return;
    // Retroactively update every other row currently in the grid
    // whose raw company matches — so mapping "Lennar" → "Lennar
    // Corporation" on one row fixes all the other Lennar rows too.
    setRows(prev => {
      let changed = false;
      const next = prev.map(r => {
        if (companyRuleKey(r.company) === k && r.company !== v) {
          changed = true;
          return { ...r, company: v, _companyFromRule: true };
        }
        return r;
      });
      if (!changed) return prev;
      saveCache(next);
      return next;
    });
  }, []);
  const removeCompanyRule = useCallback((raw) => {
    const k = companyRuleKey(raw);
    setCompanyRules(prev => {
      if (!(k in prev)) return prev;
      const next = { ...prev };
      delete next[k];
      persistCompanyRules(next);
      return next;
    });
  }, []);
  // Dismissing the suggested company also dismisses every TV-field
  // suggestion that was sourced from that prospect-match — if the
  // user doesn't trust the company link they shouldn't see Website /
  // Zoom Name / Zoom ID / Email Domain rolling in from the same
  // lookup. Un-dismissing flips them all back on. The dismissedSuggestions
  // setter handles both the per-pill × on the table and the panel
  // checkboxes, so the cascade is symmetric there too.
  const TV_FIELD_KEYS = ['website', 'zoomCompanyId', 'zoomCompanyName', 'emailDomain'];
  const toggleSuggestedCompanyDismiss = useCallback((email) => {
    setDismissedSuggestedCompanies(prev => {
      const next = new Set(prev);
      const willBeDismissed = !next.has(email);
      if (willBeDismissed) next.add(email); else next.delete(email);
      // Walk the rows snapshot to find the matched prospect for this
      // email so we can flip its TV-field dismiss keys in the same
      // setState pass.
      const row = rowsRef.current?.find(r => r.email === email);
      const pid = row?._matchedProspectId;
      if (pid) {
        setDismissedSuggestions(prev2 => {
          const next2 = new Set(prev2);
          for (const f of TV_FIELD_KEYS) {
            const k = `${pid}::${f}`;
            if (willBeDismissed) next2.add(k); else next2.delete(k);
          }
          return next2;
        });
      }
      return next;
    });
  }, []);

  // Reps assigned to Tier 1 / Tier 2 target accounts on someone else's
  // sheet — pulled out of the same Target Accounts workbook the My
  // Accounts page reads from. Each entry is `{ company, rep }`. Empty
  // when the workbook hasn't loaded yet (the user has to visit the
  // Lists tab once to populate it; targetAccountsData lives on App
  // state and is re-served to the bulk page from there).
  const allTargetReps = useMemo(() => {
    const data = targetAccountsData;
    if (!data?.sheets) return [];
    const findCol = (r, keywords) => {
      for (const key of Object.keys(r)) {
        const lower = key.toLowerCase();
        for (const kw of keywords) {
          if (lower.includes(kw.toLowerCase())) return (r[key] || '').trim();
        }
      }
      return '';
    };
    const out = [];
    for (const sheetName of data.sheetNames || []) {
      const sheet = data.sheets[sheetName];
      if (!sheet?.records) continue;
      for (const r of sheet.records) {
        const company = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
        if (!company) continue;
        // Use the salesperson/CDM column mapped on the Target Accounts
        // page (New Sales rep wins, then CDM), falling back to a keyword
        // scan so this resolves a rep even without a mapping.
        const rep = resolveTargetAccountCdm(r, settings?.targetRepColumn || settings?.targetCdmColumn);
        if (!rep) continue;
        // Skip the current user's own entries — those are "your"
        // accounts, not Other Reps.
        if (matchesCdm(rep, cdmName)) continue;
        out.push({ company: company.trim(), rep: rep.trim() });
      }
    }
    return out;
  }, [targetAccountsData, cdmName, settings?.targetRepColumn, settings?.targetCdmColumn]);

  // For each matched prospect, the list of Other Reps tied to the
  // confirmed Target Account name(s) for that prospect. Mirrors the
  // shape of the My Accounts column so the badge UI is consistent.
  const otherRepsByProspect = useMemo(() => {
    const map = new Map();
    if (!allTargetReps.length) return map;
    const targetMap = settings?.targetMap || {};
    for (const p of prospects) {
      const raw = targetMap[p.id];
      const targetNames = Array.isArray(raw) ? raw.filter(Boolean) : (raw ? [raw] : []);
      if (!targetNames.length) continue;
      const lowered = new Set(targetNames.map(n => String(n).toLowerCase().trim()));
      const reps = allTargetReps.filter(t => lowered.has(String(t.company || '').toLowerCase().trim()));
      if (reps.length) map.set(p.id, reps);
    }
    return map;
  }, [allTargetReps, prospects, settings]);

  // Reload HubSpot cache whenever results change (so newly-added contacts move to the "exists" state).
  const [hubspotByEmail, setHubspotByEmail] = useState(new Map());
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadHubSpotByEmail().then(m => { if (!cancelled) setHubspotByEmail(m); });
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, [results]);

  // Build domain → prospect (and prospect → all known domains) maps so we can both
  // suggest a company and surface the full domain list tied to that prospect.
  // Also build a token → prospect map from company-name words (e.g. "URW" from
  // "Unibail-Rodamco-Westfield (URW)") so we can fuzzy-match when the domain
  // itself isn't registered on the prospect.
  const { domainToProspect, prospectDomains, tokenToProspect, prospectByCompanyKey, prospectCompactPrefixMap, prospectCompactPrefixesDesc } = useMemo(() => {
    const dToP = new Map();
    const pDoms = new Map();
    const tToP = new Map();
    const compactToP = new Map();
    const byCompanyKey = new Map();
    function recordDomain(p, domain) {
      if (!domain || !p.company) return;
      dToP.set(domain, p);
      const key = p.company.toLowerCase();
      if (!pDoms.has(key)) pDoms.set(key, new Set());
      pDoms.get(key).add(domain);
    }
    for (const p of prospects) {
      // Exact-name lookup so a typed-Company / HubSpot-company string
      // can land on a canonical TV prospect without going through the
      // brand-token fuzz.
      if (p.company) {
        const key = p.company.toLowerCase().trim();
        if (key && !byCompanyKey.has(key)) byCompanyKey.set(key, p);
      }
      if (p.emailDomain) {
        p.emailDomain.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean).forEach(entry => {
          const at = entry.lastIndexOf('@');
          const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase();
          recordDomain(p, d);
        });
      }
      if (p.website) {
        const d = p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
        recordDomain(p, d);
      }
      // Tokens from company name — 3+ chars, lowercased, deduped. Skip generic suffixes.
      const GENERIC = new Set(['inc', 'llc', 'ltd', 'corp', 'group', 'holdings', 'plc', 'the', 'and', 'company', 'co']);
      if (p.company) {
        const tokens = new Set(
          p.company.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !GENERIC.has(t))
        );
        for (const t of tokens) {
          if (!tToP.has(t)) tToP.set(t, p); // first-wins; prospects loaded earlier take priority
        }
        // Index every "first-N-tokens joined" compact form — e.g.
        // "LPL Financial" → "lpl", "lplfinancial" — so a domain brand
        // like "lplfinancial" (from lplfinancial.com) can still map
        // back to the canonical TV prospect.
        const orderedTokens = p.company.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        for (let n = 1; n <= orderedTokens.length; n++) {
          const prefix = orderedTokens.slice(0, n).join('');
          if (prefix && prefix.length >= 3 && !compactToP.has(prefix)) compactToP.set(prefix, p);
        }
      }
    }
    const compactDesc = Array.from(compactToP.keys()).sort((a, b) => b.length - a.length);
    return {
      domainToProspect: dToP,
      prospectDomains: pDoms,
      tokenToProspect: tToP,
      prospectByCompanyKey: byCompanyKey,
      prospectCompactPrefixMap: compactToP,
      prospectCompactPrefixesDesc: compactDesc,
    };
  }, [prospects]);

  // Unique, alphabetically-sorted list of Table View company names —
  // piped into a shared <datalist> so the Company input offers native
  // predictive-text suggestions while the user types.
  const prospectCompanyOptions = useMemo(() => {
    const seen = new Set();
    const names = [];
    for (const p of prospects) {
      const name = (p.company || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    names.sort((a, b) => a.localeCompare(b));
    return names;
  }, [prospects]);

  // Fuzzy-match an arbitrary company string against the TV prospect
  // pool. Same vocabulary the domain-brand path uses (token map +
  // compact-prefix map) plus an exact normalized name lookup at the
  // top so typed-canonical-name inputs short-circuit before tokenizing.
  const GENERIC_COMPANY_TOKENS = useMemo(() => new Set([
    'inc', 'llc', 'ltd', 'corp', 'group', 'holdings', 'plc',
    'the', 'and', 'company', 'co',
  ]), []);
  const matchProspectByCompanyName = useCallback((name) => {
    const norm = String(name || '').toLowerCase().trim();
    if (!norm || norm.length < 2) return null;
    const exact = prospectByCompanyKey.get(norm);
    if (exact) return exact;
    const tokens = norm.split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !GENERIC_COMPANY_TOKENS.has(t));
    if (tokens.length === 0) return null;
    for (const t of tokens) {
      const hit = tokenToProspect.get(t);
      if (hit) return hit;
    }
    const compact = tokens.join('');
    if (compact && prospectCompactPrefixMap.has(compact)) return prospectCompactPrefixMap.get(compact);
    if (compact && compact.length >= 5) {
      for (const key of prospectCompactPrefixesDesc) {
        if (key.length < 5) break;
        if (compact.startsWith(key) || key.startsWith(compact)) return prospectCompactPrefixMap.get(key);
      }
    }
    return null;
  }, [prospectByCompanyKey, tokenToProspect, prospectCompactPrefixMap, prospectCompactPrefixesDesc, GENERIC_COMPANY_TOKENS]);

  // Look up match details for a single row based on the current prospects snapshot.
  // Used both during initial enrichment AND at render time so the columns refresh
  // after the prospect's emailDomain is auto-patched. Optionally accepts the
  // row object so the matcher can fall through to non-email signals
  // (HubSpot contact company, the user's typed Company cell) when the
  // email's domain doesn't resolve to a known TV prospect.
  const lookupMatch = useCallback((email, row = null) => {
    const at = email.lastIndexOf('@');
    const domain = at >= 0 ? email.slice(at + 1).toLowerCase() : '';
    let matched = domain ? domainToProspect.get(domain) : null;
    const wasExactMatch = !!matched;
    let source = matched ? 'domain-exact' : '';
    // Layer 2: non-email signals. The HubSpot contact record is
    // typically curated (a real person typed it) and the user's typed
    // Company cell is even more deliberate, so both signals beat the
    // brand-token fuzz on the email domain. HubSpot wins when both
    // exist because the typed cell might be a draft mid-edit.
    if (!matched) {
      const hsCompany = String(hubspotByEmail.get(email)?.company || '').trim();
      if (hsCompany) {
        const m = matchProspectByCompanyName(hsCompany);
        if (m) { matched = m; source = 'hubspot-company'; }
      }
    }
    if (!matched) {
      const typedCompany = String(row?.company || '').trim();
      if (typedCompany) {
        const m = matchProspectByCompanyName(typedCompany);
        if (m) { matched = m; source = 'typed-company'; }
      }
    }
    // Layer 3: domain brand-token / compact-prefix fuzz (legacy path).
    if (!matched && domain) {
      const token = extractBrandToken(domain);
      if (token && token.length >= 3) {
        const hit = tokenToProspect.get(token);
        if (hit) { matched = hit; source = 'domain-token'; }
      }
      // Still no hit? Try the compact-prefix map so "lplfinancial"
      // (domain brand) resolves to "LPL Financial" (prospect whose
      // first-two-token compact form is "lplfinancial"). Supports
      // prefix-match in either direction, longest wins.
      if (!matched && token && token.length >= 3) {
        if (prospectCompactPrefixMap.has(token)) {
          matched = prospectCompactPrefixMap.get(token);
          source = 'domain-compact';
        } else {
          for (const key of prospectCompactPrefixesDesc) {
            if (key.length < 5) break;
            if (token.startsWith(key) || key.startsWith(token)) {
              matched = prospectCompactPrefixMap.get(key);
              source = 'domain-compact';
              break;
            }
          }
        }
      }
    }
    // Only suggest a company that actually exists in Table View —
    // never a bare brand derived from the domain (e.g. "Lplfinancial").
    const suggestedCompany = matched?.company || '';
    const domainSet = matched ? prospectDomains.get(matched.company.toLowerCase()) : null;
    const companyDomains = domainSet ? Array.from(domainSet).sort() : (domain ? [domain] : []);
    return { domain, matched, wasExactMatch, suggestedCompany, companyDomains, suggestSource: source };
  }, [domainToProspect, prospectDomains, tokenToProspect, prospectCompactPrefixMap, prospectCompactPrefixesDesc, hubspotByEmail, matchProspectByCompanyName]);

  const enrichRow = useCallback((r) => {
    const { domain, matched, wasExactMatch } = lookupMatch(r.email, r);
    // Only guess name parts if the parsed row didn't already carry them from "Name <email>" drops.
    const nameGuess = (!r.firstname && !r.lastname) ? guessNameFromEmail(r.email) : { firstname: '', lastname: '' };
    const firstname = fixAllCapsName(r.firstname || nameGuess.firstname);
    const lastname = fixAllCapsName(r.lastname || nameGuess.lastname);
    // Initial Company value: match HubSpot's current value when the contact already exists
    // (even if blank — so user sees the real state). For brand-new contacts, leave blank so the
    // Suggested Company chip is an explicit opt-in rather than an auto-fill.
    const existing = hubspotByEmail.get(r.email);
    const initialCompany = r.company !== undefined && r.company !== null && r.company !== ''
      ? r.company
      : (existing ? (existing.company || '') : '');
    // Email resolution. A real provided address wins. Otherwise estimate one
    // from the matched company's recorded naming pattern. Otherwise fall back
    // to a non-email placeholder key so the row still shows up for review but
    // can't be pushed to HubSpot until the user supplies an address.
    //   _emailStatus: 'provided' | 'estimated' | 'missing'
    let email = isRealEmail(r.email) ? r.email.toLowerCase() : '';
    let emailStatus = email ? 'provided' : '';
    if (!email && matched) {
      const est = buildEmailFromPattern(matched.emailDomain, firstname, lastname);
      if (est) { email = est.toLowerCase(); emailStatus = 'estimated'; }
    }
    if (!email) {
      email = placeholderEmailKey(firstname, lastname, initialCompany);
      emailStatus = 'missing';
    }
    return {
      ...r,
      email,
      _emailStatus: emailStatus,
      firstname,
      lastname,
      company: initialCompany,
      _matchedProspectId: matched?.id || null,
      _matchedDomain: domain,
      _domainAlreadyKnown: wasExactMatch,
      // Preserve the Table View backfill fields parsed off an Excel
      // upload so the "Fill missing Table View data" panel can offer
      // them below.
      _upload_website: r._upload_website || '',
      _upload_zoomCompanyId: r._upload_zoomCompanyId || '',
      _upload_zoomCompanyName: r._upload_zoomCompanyName || '',
      _upload_emailDomain: r._upload_emailDomain || '',
    };
  }, [lookupMatch, hubspotByEmail]);

  // Track which (prospectId, domain) pairs we've already patched this session so we don't flood Firestore.
  const patchedPairsRef = useRef(new Set());

  const patchProspectDomains = useCallback((enrichedRows) => {
    if (!onUpdateProspect) return;
    // One update per prospect — collect all domains to add in a single set.
    const byProspect = new Map(); // id -> { prospect, domainsToAdd: Set<string> }
    for (const r of enrichedRows) {
      if (!r._matchedProspectId || !r._matchedDomain) continue;
      if (r._domainAlreadyKnown) continue; // already in emailDomain/website — nothing to do
      const p = prospects.find(pp => pp.id === r._matchedProspectId);
      if (!p) continue;
      const existing = prospectDomains.get((p.company || '').toLowerCase()) || new Set();
      if (existing.has(r._matchedDomain)) continue;
      const pairKey = `${p.id}|${r._matchedDomain}`;
      if (patchedPairsRef.current.has(pairKey)) continue;
      patchedPairsRef.current.add(pairKey);
      if (!byProspect.has(p.id)) byProspect.set(p.id, { prospect: p, domainsToAdd: new Set() });
      byProspect.get(p.id).domainsToAdd.add(r._matchedDomain);
    }
    for (const { prospect, domainsToAdd } of byProspect.values()) {
      const currentEntries = (prospect.emailDomain || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
      const nextEntries = [...currentEntries, ...Array.from(domainsToAdd)];
      onUpdateProspect(prospect.id, { emailDomain: nextEntries.join('\n') });
    }
  }, [onUpdateProspect, prospects, prospectDomains]);

  const mergeNewRows = useCallback((parsed) => {
    if (parsed.length === 0) return;
    // Apply saved Company mapping rules so the user doesn't have to
    // keep re-clicking the Suggested Company pill for the same names.
    for (const p of parsed) {
      const k = companyRuleKey(p.company);
      if (k && companyRules[k]) {
        p.company = companyRules[k];
        p._companyFromRule = true;
      }
    }
    const newlyEnriched = [];
    setRows(prev => {
      const byEmail = new Map(prev.map(r => [r.email, r]));
      for (const p of parsed) {
        // Enrich first so an estimated / placeholder email becomes the dedupe
        // key — name-only rows have no email of their own to key on.
        const er = enrichRow(p);
        const existing = byEmail.get(er.email);
        if (!existing) {
          byEmail.set(er.email, er);
          newlyEnriched.push(er);
        } else {
          // Re-drop of the same contact: refresh the upload-sourced
          // fields so an updated file actually updates the row. User
          // edits (name, company, tags, notes) are preserved; upload
          // fields and blank contact fields get the new values.
          const refreshed = { ...existing };
          for (const f of PROSPECT_BACKFILL_FIELDS) {
            const k = `_upload_${f.key}`;
            if (p[k]) refreshed[k] = p[k];
          }
          if (!existing.phone && p.phone) refreshed.phone = p.phone;
          if (!existing.mobilePhone && p.mobilePhone) refreshed.mobilePhone = p.mobilePhone;
          if (!existing.jobtitle && p.jobtitle) refreshed.jobtitle = p.jobtitle;
          if (!existing.linkedinUrl && p.linkedinUrl) refreshed.linkedinUrl = p.linkedinUrl;
          if (!existing.city && p.city) refreshed.city = p.city;
          if (!existing.state && p.state) refreshed.state = p.state;
          if (!existing.country && p.country) refreshed.country = p.country;
          if (!existing.company && p.company) refreshed.company = p.company;
          if (!existing.dans_tags && p.dans_tags) refreshed.dans_tags = p.dans_tags;
          byEmail.set(er.email, refreshed);
        }
      }
      const next = Array.from(byEmail.values());
      saveCache(next);
      return next;
    });
    if (newlyEnriched.length > 0) patchProspectDomains(newlyEnriched);
  }, [enrichRow, patchProspectDomains, companyRules]);

  // Guess an email for the "Add a contact by name" form: match the typed
  // company to a Table View prospect, then apply that prospect's recorded
  // naming pattern. Returns '' when the company isn't matched or has no pattern.
  const guessEmailFromCompany = useCallback((firstname, lastname, company) => {
    const m = matchProspectByCompanyName(company);
    if (!m) return '';
    return buildEmailFromPattern(m.emailDomain, firstname, lastname);
  }, [matchProspectByCompanyName]);

  const manualGuessedEmail = useMemo(
    () => guessEmailFromCompany(manualEntry.firstname, manualEntry.lastname, manualEntry.company),
    [guessEmailFromCompany, manualEntry],
  );
  // Keep the email box in sync with the guess until the user edits it by hand.
  useEffect(() => {
    if (!manualEmailTouched) setManualEmail(manualGuessedEmail);
  }, [manualGuessedEmail, manualEmailTouched]);

  function addManualContact() {
    const email = manualEmail.trim().toLowerCase();
    const { firstname, lastname, jobtitle, company } = manualEntry;
    if (!firstname.trim() && !lastname.trim()) { setManualMsg('Add a first or last name'); return; }
    if (!email) { setManualMsg('No email yet: type one, or add a company whose pattern is on record'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setManualMsg('That email doesn’t look valid'); return; }
    if (email.endsWith('@se.com')) { setManualMsg('@se.com addresses are skipped'); return; }
    if (rows.some(r => r.email === email)) { setManualMsg('That email is already in the list'); return; }
    // Reuse the upload pipeline so the new row is enriched (prospect match,
    // company suggestion, Table View backfill) exactly like a pasted one.
    mergeNewRows([{
      email,
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      company: company.trim(),
      jobtitle: jobtitle.trim(),
      phone: '', mobilePhone: '', linkedinUrl: '', city: '', state: '', country: '', dans_tags: '',
    }]);
    setManualEntry({ firstname: '', lastname: '', jobtitle: '', company: '' });
    setManualEmail('');
    setManualEmailTouched(false);
    setManualMsg('Added: see it at the top of the list below');
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const dt = e.dataTransfer;
    const collected = [];

    // 1. Try plain text first — covers Outlook web drag, address-book drag, and most pastes.
    const text = dt.getData('text/plain') || dt.getData('text/html') || '';
    // Names-without-emails are only read from plain text: in HTML the tags
    // would read as text, and the email pairs are all that markup offers.
    if (text) collected.push(...(dt.getData('text/plain') ? parsePastedText(text) : parseEmailHeaders(text)));

    // 2. If files were dropped, branch on type: .xlsx / .xls / .csv / .tsv
    //    opens a column-mapping preview modal; anything else we read as
    //    text and regex-extract email addresses.
    const files = Array.from(dt.files || []);
    if (files.length === 0 && collected.length > 0) {
      mergeNewRows(collected);
      return;
    }
    if (files.length === 0) return;

    const sheetFile = files.find(f => /\.(xlsx?|csv|tsv)$/i.test(f.name));
    const otherFiles = files.filter(f => !/\.(xlsx?|csv|tsv)$/i.test(f.name));

    if (sheetFile) {
      (async () => {
        try {
          const buf = await sheetFile.arrayBuffer();
          // Pulled in on use — the spreadsheet library is ~140 KB gzipped
          // and this page only needs it to read an uploaded sheet.
          const XLSX = await import('xlsx');
          const wb = XLSX.read(buf);
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          if (raw.length === 0) { alert('No data rows found in the file.'); return; }
          const headers = Object.keys(raw[0]);
          const mapping = autoMapHeaders(headers);
          setPendingUpload({ fileName: sheetFile.name, headers, rows: raw, mapping });
        } catch (err) {
          console.warn('Failed to parse sheet', err);
          alert('Could not read that file: ' + (err.message || 'unknown error'));
        }
      })();
    }

    if (collected.length > 0) mergeNewRows(collected);

    let pending = otherFiles.length;
    if (pending === 0) return;
    otherFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || '');
        const matches = parsePastedText(raw);
        pending -= 1;
        if (matches.length > 0) mergeNewRows(matches);
      };
      reader.onerror = () => { pending -= 1; };
      reader.readAsText(file);
    });
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragActive(true);
  }
  function handleDragLeave() { setDragActive(false); }

  function handlePaste(e) {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    // If the paste looks like multi-column tabular data (tab-
    // separated rows with at least one header and one body row),
    // route it through the same column-mapping modal that file
    // drops use. Anything that doesn't look tabular falls back to
    // the email-headers parser so a plain "Name <email>" paste keeps
    // working the way it always has.
    const trimmedLines = text
      .split(/\r?\n/)
      .map(l => l.replace(/\r$/, ''))
      .filter(l => l.length > 0);
    const looksTabular =
      trimmedLines.length >= 2
      && trimmedLines[0].includes('\t')
      && trimmedLines.slice(1).some(l => l.includes('\t'));
    if (!looksTabular) {
      e.preventDefault();
      mergeNewRows(parsePastedText(text));
      return;
    }
    e.preventDefault();
    try {
      const cells = trimmedLines.map(line => line.split('\t'));
      // Dedup blank header names with a numeric suffix so the
      // mapping modal doesn't end up with multiple "" keys.
      const seen = new Map();
      const headers = cells[0].map((h, i) => {
        const base = String(h || '').trim() || `Column ${i + 1}`;
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        return n === 1 ? base : `${base} ${n}`;
      });
      const raw = cells.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (row[i] ?? '').trim(); });
        return obj;
      }).filter(o => Object.values(o).some(v => v !== ''));
      if (raw.length === 0) {
        mergeNewRows(parsePastedText(text));
        return;
      }
      const mapping = autoMapHeaders(headers);
      setPendingUpload({ fileName: '(pasted from clipboard)', headers, rows: raw, mapping });
    } catch (err) {
      console.warn('Failed to parse pasted tabular data, falling back to email extraction', err);
      mergeNewRows(parsePastedText(text));
    }
  }

  function updateRow(email, patch) {
    setRows(prev => {
      const next = prev.map(r => r.email === email ? { ...r, ...patch } : r);
      saveCache(next);
      return next;
    });
  }
  function removeRow(email) {
    setRows(prev => {
      const next = prev.filter(r => r.email !== email);
      saveCache(next);
      return next;
    });
    setResults(prev => {
      const next = { ...prev };
      delete next[email];
      return next;
    });
  }
  // removeRow for several rows at once, so the company contacts popup
  // takes its picks out of the grid in one pass.
  function removeRows(emails) {
    const drop = new Set(emails);
    if (drop.size === 0) return;
    setRows(prev => {
      const next = prev.filter(r => !drop.has(r.email));
      saveCache(next);
      return next;
    });
    setResults(prev => {
      const next = { ...prev };
      for (const e of drop) delete next[e];
      return next;
    });
    setBulkSelected(prev => {
      if (![...drop].some(e => prev.has(e))) return prev;
      const next = new Set(prev);
      for (const e of drop) next.delete(e);
      return next;
    });
  }
  // Escape shuts the company contacts popup wherever focus has gone (a
  // removed row takes its focused × button with it).
  useEffect(() => {
    if (!companyContacts) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setCompanyContacts(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [companyContacts]);
  function openCompanyContacts(r, card) {
    setCompanyContacts({
      name: String(r.company || '').trim(),
      prospectId: r._matchedProspectId || card?.id || null,
      card: card || null,
    });
    setCompanyContactsPicked(new Set());
  }
  function clearAll() {
    if (!confirm('Clear all rows?')) return;
    setRows([]);
    setResults({});
    try { userLsRemove(STORAGE_KEY); } catch { /* ignore */ }
  }

  // Snapshot every row in the grid into a Schneider-styled .xlsx
  // mirror of what the user sees on screen. Honors the column-
  // visibility toggle so the export shape matches the table; per-row
  // derived fields (HubSpot status, Tier, CDM / Other Reps,
  // Suggested Company, TV backfill values) are recomputed the same
  // way the on-screen cells do, so what the user reads in Excel
  // matches the page exactly — including the dismiss-cascade rules.
  const exportToExcel = useCallback(async () => {
    if (rows.length === 0) return;
    const { Workbook } = await import('exceljs');
    const SE_GREEN_DARK = 'FF009530';
    const SE_TEXT_DARK = 'FF1E293B';
    const SE_BORDER = 'FFD4DDE1';

    // Column catalog — mirrors BULK_COLS labels. Each entry knows how
    // to pull its value from the row + per-row context bag.
    const COLS = {
      email:            { label: 'Email',             w: 32, get: (r) => r.email },
      status:           { label: 'HubSpot Status',    w: 16, get: (r, ctx) => ctx.statusLabel },
      firstname:        { label: 'First',             w: 14, get: (r) => r.firstname },
      lastname:         { label: 'Last',              w: 16, get: (r) => r.lastname },
      jobtitle:         { label: 'Job Title',         w: 24, get: (r) => r.jobtitle },
      company:          { label: 'Company',           w: 24, get: (r) => r.company },
      tier:             { label: 'Tier',              w: 10, get: (r, ctx) => ctx.tier },
      cdmReps:          { label: 'CDM / Other Reps',  w: 30, get: (r, ctx) => ctx.cdmReps },
      suggestedCompany: { label: 'Suggested Company', w: 24, get: (r, ctx) => ctx.suggestedCompany },
      website:          { label: 'TV Website',        w: 22, get: (r, ctx) => ctx.tv.website },
      zoomCompanyId:    { label: 'TV Zoom ID',        w: 16, get: (r, ctx) => ctx.tv.zoomCompanyId },
      zoomCompanyName:  { label: 'TV Zoom Name',      w: 22, get: (r, ctx) => ctx.tv.zoomCompanyName },
      emailDomain:      { label: 'TV Email Domain',   w: 24, get: (r, ctx) => ctx.tv.emailDomain },
      dans_tags:        { label: "Dan's Tags",        w: 18, get: (r) => r.dans_tags || '' },
      phone:            { label: 'Work Phone',        w: 16, get: (r) => r.phone || '' },
      mobilePhone:      { label: 'Cell Phone',        w: 16, get: (r) => r.mobilePhone || '' },
      linkedinUrl:      { label: 'LinkedIn URL',      w: 28, get: (r) => r.linkedinUrl || '' },
      city:             { label: 'City',              w: 14, get: (r) => r.city || '' },
      state:            { label: 'State',             w: 10, get: (r) => r.state || '' },
      country:          { label: 'Country',           w: 14, get: (r) => r.country || '' },
      notes:            { label: 'Notes',             w: 36, get: (r) => r.notes || '' },
    };
    const exportCols = [];
    for (const c of orderedBulkCols) {
      if (c.key === '_remove' || c.key === '_select') continue;
      if (!bulkColShown.has(c.key)) continue;
      if (COLS[c.key]) exportCols.push(COLS[c.key]);
    }
    if (exportCols.length === 0) return;

    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();
    const ws = wb.addWorksheet('Bulk Add Contacts', {
      views: [{ state: 'frozen', ySplit: 2 }],
    });
    ws.columns = exportCols.map(c => ({ width: c.w }));

    // Title band.
    ws.mergeCells(1, 1, 1, exportCols.length);
    const title = ws.getCell(1, 1);
    title.value = 'Bulk Add Contacts';
    title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 28;

    // Header row.
    const headerRow = ws.getRow(2);
    exportCols.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.label;
      cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
    });
    headerRow.height = 28;

    // Per-row context — keeps the export in lockstep with the on-screen
    // cells. Suggested Company / Tier / CDM-Other Reps / TV fields
    // hide when the user dismissed the company suggestion, the same
    // way the table cells do.
    const buildCtx = (r) => {
      const hubspotContact = hubspotByEmail.get(r.email);
      const exists = !!hubspotContact;
      const outcome = results[r.email];
      let statusLabel = 'New';
      if (exists) statusLabel = 'In HubSpot';
      if (outcome === 'added') statusLabel = 'Added';
      else if (outcome === 'updated') statusLabel = 'Updated';
      else if (typeof outcome === 'string' && outcome.startsWith('error')) {
        statusLabel = outcome.replace(/^error: /, '');
      }
      const live = lookupMatch(r.email, r);
      const prospect = r._matchedProspectId
        ? prospects.find(p => p.id === r._matchedProspectId)
        : null;
      const dismissed = dismissedSuggestedCompanies.has(r.email);

      let suggestedCompany = '';
      if (!dismissed && live.suggestedCompany) {
        suggestedCompany = companyTextEquals(r.company, live.suggestedCompany)
          ? 'applied'
          : live.suggestedCompany;
      }

      let tier = '';
      if (!dismissed && prospect) {
        const explicit = (prospect.tier || '').trim();
        if (explicit === 'Tier 1' || explicit === 'Tier 2') tier = explicit;
        else if (matchesCdm(prospect.cdm, cdmName)) tier = 'Tier 3';
      }

      let cdmReps = '';
      if (!dismissed && prospect) {
        const cdm = String(prospect.cdm || '').trim();
        const reps = otherRepsByProspect.get(prospect.id) || [];
        const seen = new Set();
        const repNames = [];
        for (const rep of reps) {
          const k = rep.rep.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          repNames.push(rep.rep);
        }
        const parts = [];
        if (cdm) parts.push(`CDM: ${cdm}`);
        if (repNames.length) parts.push(`Other: ${repNames.join(', ')}`);
        cdmReps = parts.join(' · ');
      }

      const tv = (!dismissed && prospect) ? {
        website: prospect.website || '',
        zoomCompanyId: prospect.zoomCompanyId || '',
        zoomCompanyName: prospect.zoomCompanyName || '',
        emailDomain: prospect.emailDomain || '',
      } : { website: '', zoomCompanyId: '', zoomCompanyName: '', emailDomain: '' };

      return { statusLabel, suggestedCompany, tier, cdmReps, tv };
    };

    rows.forEach((r, idx) => {
      const ctx = buildCtx(r);
      const dataRow = ws.getRow(3 + idx);
      exportCols.forEach((c, i) => {
        const cell = dataRow.getCell(i + 1);
        const v = c.get(r, ctx);
        cell.value = (v === '' || v == null) ? null : v;
        cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT_DARK } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        cell.border = {
          bottom: { style: 'hair', color: { argb: SE_BORDER } },
          right:  { style: 'hair', color: { argb: SE_BORDER } },
        };
      });
      dataRow.height = 18;
    });

    ws.autoFilter = {
      from: { row: 2, column: 1 },
      to:   { row: 2 + rows.length, column: exportCols.length },
    };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Bulk Add Contacts - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [rows, bulkColShown, orderedBulkCols, hubspotByEmail, results, lookupMatch, prospects, dismissedSuggestedCompanies, otherRepsByProspect, cdmName]);

  // The best company name we can put on the wire for this row. Priority:
  //   1. The explicit row.company the user typed in the cell.
  //   2. The prospect-matched / email-domain-inferred suggestedCompany.
  // Used so a HubSpot contact whose `company` field is currently blank
  // gets filled even when the user hasn't manually edited the row.
  function effectiveRowCompany(row) {
    const typed = String(row?.company || '').trim();
    if (typed) return typed;
    return String(row?.suggestedCompany || '').trim();
  }

  // Build a properties object of fields the user has supplied that are currently blank
  // on the existing HubSpot contact. Used to "fill in missing values" without overwriting
  // data that HubSpot already has.
  function missingFieldUpdates(row, existing) {
    if (!existing) return null;
    const firstname = fixAllCapsName(row.firstname);
    const lastname = fixAllCapsName(row.lastname);
    const patch = {};
    // Company: when HubSpot has nothing, push whatever effective
    // company we have for this row (typed cell first, then the
    // suggested / matched value). Fixes the "HubSpot: no company
    // listed" rows that previously stayed blank because the user
    // never re-typed the value the suggested-pill already showed.
    const company = effectiveRowCompany(row);
    if (company && !existing.company) patch.company = company;
    if (firstname && !existing.firstname) patch.firstname = firstname;
    if (lastname && !existing.lastname) patch.lastname = lastname;
    if (row.phone && !existing.phone) patch.phone = row.phone;
    if (row.mobilePhone && !existing.mobilephone) patch.mobilephone = row.mobilePhone;
    if (row.jobtitle && !existing.jobtitle) patch.jobtitle = row.jobtitle;
    if (row.linkedinUrl && row.linkedinUrl.trim() && !existing.hs_linkedin_url && !existing.linkedin_url) {
      patch.hs_linkedin_url = row.linkedinUrl.trim();
    }
    if (row.city && !existing.city) patch.city = row.city;
    if (row.state && !existing.state) patch.state = row.state;
    if (row.country && !existing.country) patch.country = row.country;
    if (row.dans_tags && row.dans_tags.trim() && !existing.dans_tags && !existing.dan_s_tags) patch.dans_tags = row.dans_tags.trim();
    return Object.keys(patch).length ? patch : null;
  }

  // True when the row has a note that the existing HubSpot contact's
  // notes-flavoured fields don't already include verbatim. Naive
  // dedup (substring match) — good enough to stop the obvious double
  // import when the user re-uploads the same sheet, but doesn't try
  // to fight HubSpot's engagement timeline if the user edits the
  // note text. Notes are timestamped engagement objects, so adding
  // a slightly-different one isn't a destructive operation.
  function hasPendingNote(row, existing) {
    const text = String(row?.notes || '').trim();
    if (!text) return false;
    if (!existing) return true;
    const existingNotes = String(
      existing.notes
      || existing.hs_content_membership_notes
      || existing.message
      || ''
    );
    return !existingNotes.includes(text);
  }

  // Human-readable list of what an "Update pending" push would change on
  // the existing HubSpot contact: one entry per blank field it fills, plus
  // the note when one is queued. Mirrors missingFieldUpdates exactly so the
  // preview never promises a field the push leaves alone.
  const PATCH_FIELD_LABELS = {
    company: 'Company', firstname: 'First', lastname: 'Last', jobtitle: 'Job title',
    phone: 'Work phone', mobilephone: 'Cell phone', hs_linkedin_url: 'LinkedIn',
    city: 'City', state: 'State', country: 'Country', dans_tags: "Dan's Tags",
  };
  function pendingUpdateChanges(row, existing) {
    const patch = missingFieldUpdates(row, existing) || {};
    const out = Object.entries(patch).map(([k, v]) => ({ label: PATCH_FIELD_LABELS[k] || k, value: String(v) }));
    if (hasPendingNote(row, existing)) out.push({ label: 'Note', value: String(row.notes || '').trim() });
    return out;
  }

  // Which bucket a row sits in on the table: 'new' (not in HubSpot yet, so
  // the push creates it), 'update' (in HubSpot with blanks the push fills or
  // a note to attach), 'hubspot' (in HubSpot with nothing new, so the push
  // skips it). Rows pushed this session land in 'hubspot'.
  function rowBucket(r) {
    const outcome = results[r.email];
    if (outcome === 'added' || outcome === 'updated') return 'hubspot';
    const existing = hubspotByEmail.get(r.email);
    if (!existing) return 'new';
    if (missingFieldUpdates(r, existing) || hasPendingNote(r, existing)) return 'update';
    return 'hubspot';
  }

  // Engagement note attached to a contact. Returns 'ok' on success or
  // a 'error: …' string the caller can roll into its own outcome.
  // On success we also mirror the note text into settings.contactNotes
  // so the HubSpot Contacts page (and every other in-app view that
  // reads the same store) surfaces it immediately — HubSpot's note
  // engagements live on the activity timeline rather than as a
  // contact property, so without this mirror the on-screen Notes
  // column would stay blank even though the note successfully
  // landed on the HubSpot record.
  async function pushContactNote(contactId, body) {
    const text = String(body || '').trim();
    if (!contactId || !text) return null;
    try {
      const res = await apiFetch('/api/hubspot?action=create-contact-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, body: text }),
      });
      const data = await res.json();
      if (data?.success || data?.note || data?.engagement) {
        if (updateSettings) {
          const cur = settings?.contactNotes || {};
          // Append to any existing local note rather than overwrite,
          // so a fresh push doesn't clobber prior context the user
          // has built up over several uploads / edits.
          const prior = String(cur[contactId] || '').trim();
          const merged = prior && !prior.includes(text)
            ? `${prior}\n${text}`
            : (prior || text);
          updateSettings({ contactNotes: { ...cur, [contactId]: merged } });
        }
        return 'ok';
      }
      return 'error: ' + (data?.error || 'note write failed');
    } catch (err) {
      return 'error: ' + (err.message || 'network');
    }
  }

  // A saved tag preset (utils/tagPresets) to give every contact this page
  // CREATES in HubSpot: its tags go on the new contact, and its answers
  // (No / Not sure / Not sold included) are recorded against the new id, as
  // if it had been clicked on that contact's popup. Contacts already in
  // HubSpot are left alone: this page only ever fills their blanks.
  const [tagPresetId, setTagPresetId] = useState('');
  // Settings as they are now, for the whole-map fallback write below: the
  // push loop outlives the render that started it.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const tagPresets = settings?.tagPresets || [];
  const activeTagPreset = tagPresets.find(p => p.id === tagPresetId) || null;
  const tagPresetVocab = useMemo(() => {
    const fromContacts = [];
    for (const c of hubspotByEmail.values()) {
      for (const t of String(c?.dans_tags || '').split(';')) fromContacts.push(t);
    }
    return tagVocabulary(fromContacts);
  }, [hubspotByEmail]);

  async function addOne(row) {
    // Defensive: never POST a row without a real address (placeholder keys for
    // contacts whose email couldn't be estimated must be resolved first).
    if (!isRealEmail(row.email)) return 'error: no email address';
    const firstname = fixAllCapsName(row.firstname);
    const lastname = fixAllCapsName(row.lastname);
    try {
      const properties = {
        email: row.email,
        firstname,
        lastname,
        // Same effective-company fallback updateOne uses — the
        // suggestedCompany pill is treated as an acceptable source
        // when the user hasn't typed anything in the cell.
        company: effectiveRowCompany(row),
        phone: row.phone,
        jobtitle: row.jobtitle,
      };
      if (row.mobilePhone && row.mobilePhone.trim()) properties.mobilephone = row.mobilePhone.trim();
      if (row.linkedinUrl && row.linkedinUrl.trim()) properties.hs_linkedin_url = row.linkedinUrl.trim();
      if (row.city && row.city.trim()) properties.city = row.city.trim();
      if (row.state && row.state.trim()) properties.state = row.state.trim();
      if (row.country && row.country.trim()) properties.country = row.country.trim();
      if (row.dans_tags && row.dans_tags.trim()) properties.dans_tags = row.dans_tags.trim();
      // The row's own tags (typed comma- or semicolon-separated) plus the
      // preset's, under the preset's rules: a No in the preset beats a tag
      // typed on the row, the same as applying it on the popup would.
      const presetOut = activeTagPreset
        ? applyTagPresetToContact({
          dansTags: String(row.dans_tags || '').split(/[;,]/).map(t => t.trim()).filter(Boolean).join(';'),
          records: {},
          preset: activeTagPreset,
          tags: tagPresetVocab,
        })
        : null;
      if (presetOut) {
        if (presetOut.dansTags) properties.dans_tags = presetOut.dansTags;
        else delete properties.dans_tags;
      }
      const res = await apiFetch('/api/hubspot?action=create-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties }),
      });
      const data = await res.json();
      if (data.success) {
        logAction(user, 'contact_created', {
          contactId: data.contact?.id,
          properties: { email: row.email, firstname, lastname, company: row.company },
          source: 'bulk_contacts',
        });
        try {
          await updateHubspotCache(draft => { draft.contacts.push({ ...data.contact, _source: 'bulk' }); });
        } catch { /* ignore */ }
        // The preset's answers, against the id HubSpot just gave the
        // contact. One path per contact, so a run of creates can't drop
        // each other's records.
        const newId = data.contact?.id;
        if (presetOut && newId && Object.keys(presetOut.records).length > 0) {
          if (updateSettingsPath) updateSettingsPath({ [`contactTagReview.${newId}`]: presetOut.records });
          else updateSettings?.({ contactTagReview: { ...(settingsRef.current?.contactTagReview || {}), [newId]: presetOut.records } });
        }
        // After the contact lands, attach any note the user typed for
        // this row as a HubSpot engagement on that contact. Failures
        // here don't roll back the contact create — surface them as
        // a softer 'added (note failed)' outcome so the row's status
        // copy still flags that something went wrong.
        const noteText = String(row.notes || '').trim();
        if (noteText && data.contact?.id) {
          const noteOutcome = await pushContactNote(data.contact.id, noteText);
          if (noteOutcome && noteOutcome.startsWith('error')) {
            return 'error: contact added, note failed (' + noteOutcome.replace(/^error: /, '') + ')';
          }
        }
        return 'added';
      }
      return 'error: ' + (data.error || 'unknown');
    } catch (err) {
      return 'error: ' + (err.message || 'network');
    }
  }

  async function updateOne(row, existing, patch) {
    try {
      // Property patch (may be empty when this is a note-only sync —
      // e.g. existing contact already has every other field but the
      // user has typed a fresh note for them).
      const hasPatch = patch && Object.keys(patch).length > 0;
      if (hasPatch) {
        const res = await apiFetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: existing.id, properties: patch }),
        });
        const data = await res.json();
        if (!(data.success || data.contact)) {
          return 'error: ' + (data.error || 'unknown');
        }
        logAction(user, 'contact_updated', {
          contactId: existing.id,
          properties: patch,
          source: 'bulk_contacts',
        });
        try {
          await updateHubspotCache(draft => {
            draft.contacts = draft.contacts.map(c => c.id === existing.id ? { ...c, ...patch } : c);
          });
        } catch { /* ignore */ }
      }
      // Note engagement — fires whenever the row carries note text
      // that doesn't already match what's on the existing contact.
      if (hasPendingNote(row, existing)) {
        const noteOutcome = await pushContactNote(existing.id, row.notes);
        if (noteOutcome && noteOutcome.startsWith('error')) {
          return hasPatch
            ? 'error: contact updated, note failed (' + noteOutcome.replace(/^error: /, '') + ')'
            : 'error: ' + noteOutcome.replace(/^error: /, '');
        }
      }
      return 'updated';
    } catch (err) {
      return 'error: ' + (err.message || 'network');
    }
  }

  async function addAll() {
    // Two parallel queues: create new contacts, and fill in missing fields on existing ones.
    const toCreate = rows.filter(r => isRealEmail(r.email) && !hubspotByEmail.has(r.email) && results[r.email] !== 'added');
    const toUpdate = [];
    for (const r of rows) {
      if (!isRealEmail(r.email)) continue;
      if (results[r.email] === 'added' || results[r.email] === 'updated') continue;
      const existing = hubspotByEmail.get(r.email);
      if (!existing) continue;
      const patch = missingFieldUpdates(r, existing);
      // Eligibility: missing fields to fill OR a note that's not
      // already attached. updateOne handles both branches.
      if (patch || hasPendingNote(r, existing)) toUpdate.push({ row: r, existing, patch });
    }
    const total = toCreate.length + toUpdate.length;
    if (total === 0) return;
    setBusy(true);
    setProgress({ done: 0, total });
    let done = 0;
    for (const row of toCreate) {
      const outcome = await addOne(row);
      setResults(prev => ({ ...prev, [row.email]: outcome }));
      done += 1;
      setProgress({ done, total });
    }
    for (const { row, existing, patch } of toUpdate) {
      const outcome = await updateOne(row, existing, patch);
      setResults(prev => ({ ...prev, [row.email]: outcome }));
      done += 1;
      setProgress({ done, total });
    }
    setBusy(false);
    setProgress(null);
  }

  // Same shape as addAll, but restricted to rows the user has ticked
  // in Mass Edit mode. Lets the user cherry-pick which contacts go to
  // HubSpot without having to remove the rest from the queue first.
  async function addSelected() {
    if (bulkSelected.size === 0) return;
    const picked = rows.filter(r => bulkSelected.has(r.email));
    const toCreate = picked.filter(r => isRealEmail(r.email) && !hubspotByEmail.has(r.email) && results[r.email] !== 'added');
    const toUpdate = [];
    for (const r of picked) {
      if (!isRealEmail(r.email)) continue;
      if (results[r.email] === 'added' || results[r.email] === 'updated') continue;
      const existing = hubspotByEmail.get(r.email);
      if (!existing) continue;
      const patch = missingFieldUpdates(r, existing);
      if (patch || hasPendingNote(r, existing)) toUpdate.push({ row: r, existing, patch });
    }
    const total = toCreate.length + toUpdate.length;
    if (total === 0) return;
    setBusy(true);
    setProgress({ done: 0, total });
    let done = 0;
    for (const row of toCreate) {
      const outcome = await addOne(row);
      setResults(prev => ({ ...prev, [row.email]: outcome }));
      done += 1;
      setProgress({ done, total });
    }
    for (const { row, existing, patch } of toUpdate) {
      const outcome = await updateOne(row, existing, patch);
      setResults(prev => ({ ...prev, [row.email]: outcome }));
      done += 1;
      setProgress({ done, total });
    }
    setBusy(false);
    setProgress(null);
  }

  // Rows with no usable address (couldn't be estimated from a company pattern).
  // They stay in the grid for review but are blocked from the HubSpot push.
  const missingEmailCount = rows.filter(r => !isRealEmail(r.email)).length;
  const newCount = rows.filter(r => isRealEmail(r.email) && !hubspotByEmail.has(r.email)).length;
  const updateCount = rows.filter(r => {
    if (!isRealEmail(r.email)) return false;
    const existing = hubspotByEmail.get(r.email);
    if (!existing) return false;
    return !!missingFieldUpdates(r, existing) || hasPendingNote(r, existing);
  }).length;
  const dupCount = rows.length - newCount;
  const addedCount = Object.values(results).filter(v => v === 'added').length;
  const updatedCount = Object.values(results).filter(v => v === 'updated').length;
  const errorCount = Object.values(results).filter(v => typeof v === 'string' && v.startsWith('error')).length;

  // Per-prospect inferences derived from the contact rows matched to
  // that prospect: the busiest work domain, and the naming pattern the
  // people on it agree on. Both come from estimateEmailDomain, which is
  // also what the company card's "Estimate from contacts" button reads -
  // a pattern learned on this page and a pattern learned there have to be
  // the same string or the field stops working.
  const inferredSuggestions = useMemo(() => {
    const byProspect = new Map();
    for (const r of rows) {
      if (!r._matchedProspectId) continue;
      if (!byProspect.has(r._matchedProspectId)) byProspect.set(r._matchedProspectId, []);
      byProspect.get(r._matchedProspectId).push(r);
    }
    const out = new Map();
    for (const [pid, matchedRows] of byProspect) {
      const est = estimateEmailDomain(matchedRows);
      out.set(pid, {
        website: est.domain || null,
        // Only ever a "<pattern>@<domain>" entry. A bare domain would
        // just duplicate the company website and isn't useful in Table
        // View, so estimateEmailDomain withholds one.
        emailDomain: est.entry,
        // zoomCompanyId / zoomCompanyName cannot be inferred from emails - upload only.
      });
    }
    return out;
  }, [rows]);

  // Resolve a suggestion for (prospectId, fieldKey). Upload values (from
  // an .xlsx drop) win over inferred ones. Fields with a single slot
  // (website / zoomCompanyId / zoomCompanyName) skip the suggestion if
  // the prospect already has a value. emailDomain is multi-value, so
  // we only skip when the exact value is already present.
  const suggestionFor = useCallback((prospectId, fieldKey) => {
    if (!prospectId) return null;
    const prospect = prospects.find(p => p.id === prospectId);
    if (!prospect) return null;
    const currentValue = String(prospect[fieldKey] || '').trim();
    if (currentValue && fieldKey !== 'emailDomain') return null;
    const existingDomains = fieldKey === 'emailDomain'
      ? new Set(currentValue.split(/[\n;,]+/).map(s => s.trim().toLowerCase()).filter(Boolean))
      : null;
    const uploadKey = {
      website: '_upload_website',
      zoomCompanyId: '_upload_zoomCompanyId',
      zoomCompanyName: '_upload_zoomCompanyName',
      emailDomain: '_upload_emailDomain',
    }[fieldKey];
    if (uploadKey) {
      for (const r of rows) {
        if (r._matchedProspectId !== prospectId) continue;
        const v = String(r[uploadKey] || '').trim();
        if (!v) continue;
        // For emailDomain, require a naming pattern (value must
        // contain @). Bare company domains like "acme.com" aren't
        // useful and shouldn't be suggested.
        if (fieldKey === 'emailDomain' && !v.includes('@')) continue;
        if (existingDomains && existingDomains.has(v.toLowerCase())) continue;
        return { value: v, origin: 'upload' };
      }
    }
    const inferred = inferredSuggestions.get(prospectId);
    if (inferred && inferred[fieldKey]) {
      const v = inferred[fieldKey];
      if (existingDomains && existingDomains.has(v.toLowerCase())) return null;
      return { value: v, origin: 'inferred' };
    }
    return null;
  }, [rows, prospects, inferredSuggestions]);

  // Set of "prospectId::field" suggestions the user has dismissed —
  // both from the per-row pill × and the summary panel checkboxes.
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => new Set());
  const toggleDismissed = useCallback((key) => {
    setDismissedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Build a row per prospect with a cell per Table View field. Each cell
  // records the existing prospect value, any suggestion we have (upload
  // or inferred), and whether the user dismissed it. The green panel
  // renders this as a grid so all four columns stay visible even when
  // the user dismisses individual suggestions; the bulk-apply patch is
  // derived from the non-dismissed cells.
  const prospectSuggestionRows = useMemo(() => {
    if (!onUpdateProspect) return [];
    const prospectIds = new Set();
    for (const r of rows) if (r._matchedProspectId) prospectIds.add(r._matchedProspectId);
    const fields = ['website', 'zoomCompanyId', 'zoomCompanyName', 'emailDomain'];
    const out = [];
    for (const pid of prospectIds) {
      const prospect = prospects.find(p => p.id === pid);
      if (!prospect) continue;
      const cells = {};
      let hasAnySuggestion = false;
      for (const field of fields) {
        const dismissKey = `${pid}::${field}`;
        const dismissed = dismissedSuggestions.has(dismissKey);
        const sugg = suggestionFor(pid, field);
        const existing = String(prospect[field] || '').trim();
        if (sugg) hasAnySuggestion = true;
        cells[field] = { sugg, existing, dismissed, dismissKey };
      }
      if (hasAnySuggestion) out.push({ prospect, cells });
    }
    out.sort((a, b) => (a.prospect.company || '').localeCompare(b.prospect.company || ''));
    return out;
  }, [rows, prospects, onUpdateProspect, dismissedSuggestions, suggestionFor]);

  // Derive the apply-to-HubSpot patch from the grid, excluding dismissed
  // cells. emailDomain is multi-value, so we append to the existing
  // value rather than overwriting.
  const prospectBackfillUpdates = useMemo(() => {
    const out = [];
    for (const { prospect, cells } of prospectSuggestionRows) {
      const patch = {};
      const sources = {};
      for (const field of ['website', 'zoomCompanyId', 'zoomCompanyName', 'emailDomain']) {
        const cell = cells[field];
        if (!cell || !cell.sugg || cell.dismissed) continue;
        if (field === 'emailDomain') {
          const existing = String(prospect.emailDomain || '')
            .split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
          const existingLower = new Set(existing.map(s => s.toLowerCase()));
          if (existingLower.has(cell.sugg.value.toLowerCase())) continue;
          patch.emailDomain = [...existing, cell.sugg.value].join('\n');
        } else {
          patch[field] = cell.sugg.value;
        }
        sources[field] = cell.sugg;
      }
      if (Object.keys(patch).length > 0) out.push({ prospect, patch, sources });
    }
    return out;
  }, [prospectSuggestionRows]);

  // Cheap per-row lookup of the four Table View fields we surface in
  // the contacts grid. Returns the matched prospect's current value
  // for each field (so we can show "has it" vs "missing"), plus a
  // boolean for the row filter.
  const rowTableViewState = useCallback((r) => {
    if (!r._matchedProspectId) return null;
    const prospect = prospects.find(p => p.id === r._matchedProspectId);
    if (!prospect) return null;
    const has = {
      website: String(prospect.website || '').trim(),
      zoomCompanyId: String(prospect.zoomCompanyId || '').trim(),
      zoomCompanyName: String(prospect.zoomCompanyName || '').trim(),
      emailDomain: String(prospect.emailDomain || '').trim(),
    };
    const missing = {
      website: !has.website,
      zoomCompanyId: !has.zoomCompanyId,
      zoomCompanyName: !has.zoomCompanyName,
      emailDomain: !has.emailDomain,
    };
    const anyMissing = missing.website || missing.zoomCompanyId || missing.zoomCompanyName || missing.emailDomain;
    return { prospect, has, missing, anyMissing };
  }, [prospects]);

  const visibleRows = useMemo(() => {
    let out = rows;
    if (tvMissingOnly) {
      out = out.filter(r => {
        const s = rowTableViewState(r);
        return s && s.anyMissing;
      });
    }
    if (columnFilters.suggestedCompany) {
      out = out.filter(r => {
        const live = lookupMatch(r.email, r);
        return live.suggestedCompany
          && !companyTextEquals(r.company, live.suggestedCompany)
          && !dismissedSuggestedCompanies.has(r.email);
      });
    }
    for (const field of ['website', 'zoomCompanyId', 'zoomCompanyName', 'emailDomain']) {
      if (!columnFilters[field]) continue;
      out = out.filter(r => !!suggestionFor(r._matchedProspectId, field));
    }
    // Per-column text filter — substring, case-insensitive.
    const activeText = Object.entries(bulkColTextFilters).filter(([, v]) => v && v.trim());
    if (activeText.length > 0) {
      const valueFor = (r, key) => {
        switch (key) {
          case 'email':            return r.email || '';
          case 'status':           return ({ new: 'new', update: 'update pending', hubspot: 'in hubspot ignored' })[rowBucket(r)];
          case 'fullName':         return composeFullName(r);
          case 'firstname':        return r.firstname || '';
          case 'lastname':         return r.lastname || '';
          case 'company':          return r.company || '';
          case 'jobtitle':         return r.jobtitle || '';
          case 'suggestedCompany': return lookupMatch(r.email, r).suggestedCompany || '';
          case 'website':
          case 'zoomCompanyId':
          case 'zoomCompanyName':
          case 'emailDomain':      return suggestionFor(r._matchedProspectId, key)?.value || '';
          case 'dans_tags':        return r.dans_tags || '';
          case 'phone':            return r.phone || '';
          case 'mobilePhone':      return r.mobilePhone || '';
          case 'linkedinUrl':      return r.linkedinUrl || '';
          case 'city':             return r.city || '';
          case 'state':            return r.state || '';
          case 'country':          return r.country || '';
          case 'notes':            return r.notes || '';
          case 'tier': {
            const p = r._matchedProspectId ? prospects.find(pp => pp.id === r._matchedProspectId) : null;
            if (!p) return '';
            const explicit = (p.tier || '').trim();
            if (explicit === 'Tier 1' || explicit === 'Tier 2') return explicit;
            if (matchesCdm(p.cdm, cdmName)) return 'Tier 3';
            return '';
          }
          default:                 return '';
        }
      };
      out = out.filter(r => {
        for (const [key, needle] of activeText) {
          const n = needle.toLowerCase();
          const hay = String(valueFor(r, key)).toLowerCase();
          if (!hay.includes(n)) return false;
        }
        return true;
      });
    }
    if (sortKey) {
      const dir = sortDir === 'asc' ? 1 : -1;
      const sortValue = (r) => {
        switch (sortKey) {
          case 'email':            return r.email || '';
          case 'status':           return ({ new: 'New', update: 'Update pending', hubspot: 'In HubSpot' })[rowBucket(r)];
          case 'fullName':         return composeFullName(r);
          case 'firstname':        return r.firstname || '';
          case 'lastname':         return r.lastname || '';
          case 'company':          return r.company || '';
          case 'suggestedCompany': return lookupMatch(r.email, r).suggestedCompany || '';
          case 'website':
          case 'zoomCompanyId':
          case 'zoomCompanyName':
          case 'emailDomain':      return suggestionFor(r._matchedProspectId, sortKey)?.value || '';
          case 'dans_tags':        return r.dans_tags || '';
          case 'jobtitle':         return r.jobtitle || '';
          case 'phone':            return r.phone || '';
          case 'mobilePhone':      return r.mobilePhone || '';
          case 'linkedinUrl':      return r.linkedinUrl || '';
          case 'city':             return r.city || '';
          case 'state':            return r.state || '';
          case 'country':          return r.country || '';
          case 'notes':            return r.notes || '';
          case 'tier': {
            const p = r._matchedProspectId ? prospects.find(pp => pp.id === r._matchedProspectId) : null;
            if (!p) return '';
            const explicit = (p.tier || '').trim();
            if (explicit === 'Tier 1' || explicit === 'Tier 2') return explicit;
            if (matchesCdm(p.cdm, cdmName)) return 'Tier 3';
            return '';
          }
          default:                 return '';
        }
      };
      out = [...out].sort((a, b) => String(sortValue(a)).localeCompare(String(sortValue(b))) * dir);
    }
    return out;
  }, [rows, tvMissingOnly, columnFilters, sortKey, sortDir, rowTableViewState, lookupMatch, suggestionFor, dismissedSuggestedCompanies, hubspotByEmail, results, prospects, bulkColTextFilters]);

  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState(null);
  // Track per-cell apply state — "prospectId::field" keys. 'applying'
  // while the request is in flight, 'applied' once we've patched the
  // prospect and before it re-renders with the new value so the user
  // sees a transient confirmation.
  const [cellApplyState, setCellApplyState] = useState({});

  // Push a single (prospect, field) suggestion to HubSpot without
  // touching the other suggestions. emailDomain is multi-value, so we
  // append to the prospect's existing newline-joined list.
  const applySingleSuggestion = useCallback(async (prospect, fieldKey, value) => {
    if (!onUpdateProspect || !prospect || !fieldKey || !value) return false;
    const key = `${prospect.id}::${fieldKey}`;
    setCellApplyState(prev => ({ ...prev, [key]: 'applying' }));
    try {
      let patchValue = value;
      if (fieldKey === 'emailDomain') {
        const existing = String(prospect.emailDomain || '')
          .split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
        const existingLower = new Set(existing.map(s => s.toLowerCase()));
        if (existingLower.has(String(value).toLowerCase())) {
          setCellApplyState(prev => ({ ...prev, [key]: 'applied' }));
          setTimeout(() => setCellApplyState(prev => { const n = { ...prev }; delete n[key]; return n; }), 1500);
          return true;
        }
        patchValue = [...existing, value].join('\n');
      }
      await onUpdateProspect(prospect.id, { [fieldKey]: patchValue });
      setCellApplyState(prev => ({ ...prev, [key]: 'applied' }));
      setTimeout(() => setCellApplyState(prev => { const n = { ...prev }; delete n[key]; return n; }), 1500);
      return true;
    } catch {
      setCellApplyState(prev => ({ ...prev, [key]: 'error' }));
      setTimeout(() => setCellApplyState(prev => { const n = { ...prev }; delete n[key]; return n; }), 2500);
      // Said out loud rather than only painted on the cell, so a caller
      // applying a hundred of these can count the ones that did not land.
      return false;
    }
  }, [onUpdateProspect]);

  // Auto-accept TV Email Domain suggestions. The email-pattern guess
  // (firstname.lastname@domain) is stable and derived directly from
  // the emails the user just dropped, so we push it to the matched
  // prospect without waiting for a click. Deduped per session via a
  // ref so we never re-fire the same (prospect, value) pair.
  const autoAppliedEmailDomainsRef = useRef(new Set());
  useEffect(() => {
    if (!onUpdateProspect) return;
    for (const { prospect, cells } of prospectSuggestionRows) {
      const cell = cells.emailDomain;
      if (!cell || !cell.sugg || cell.dismissed) continue;
      const dedupeKey = `${prospect.id}::${cell.sugg.value}`;
      if (autoAppliedEmailDomainsRef.current.has(dedupeKey)) continue;
      autoAppliedEmailDomainsRef.current.add(dedupeKey);
      applySingleSuggestion(prospect, 'emailDomain', cell.sugg.value);
    }
  }, [prospectSuggestionRows, applySingleSuggestion, onUpdateProspect]);

  async function applyProspectBackfill() {
    if (!onUpdateProspect || prospectBackfillUpdates.length === 0) return;
    setBackfillBusy(true);
    let done = 0;
    let failed = 0;
    for (const { prospect, patch } of prospectBackfillUpdates) {
      if (Object.keys(patch).length === 0) continue;
      try {
        await onUpdateProspect(prospect.id, patch);
        done++;
      } catch {
        failed++;
      }
    }
    setBackfillBusy(false);
    setBackfillStatus({
      type: failed > 0 ? 'partial' : 'success',
      message: `Updated ${done} prospect${done === 1 ? '' : 's'}${failed > 0 ? ` · ${failed} failed` : ''}.`,
    });
    setTimeout(() => setBackfillStatus(null), 4000);
  }

  // ---- Apply all the suggestions the table is showing ------------------
  //
  // Every yellow pill in the right-hand columns carries its own ✓, which is
  // one click per decision. On a drop of 175 contacts the same answer -
  // yes, these are right - costs a couple of hundred clicks, and the rows
  // that get missed are the ones below the fold. So the toolbar offers the
  // same answer once.
  //
  // Scoped to the ticked rows when there is a selection and to the visible
  // rows otherwise: "apply what I picked" and "apply what I am looking at"
  // are the same sentence with a different subject, and a filtered table is
  // already somebody having narrowed it down.
  const [applyAllBusy, setApplyAllBusy] = useState(false);
  const [applyAllStatus, setApplyAllStatus] = useState(null);
  // { done, total } while a run is going, for the % on the button. Counted
  // over the actions the run started with: the pending list shrinks as each
  // one lands, so it cannot be the denominator.
  const [applyAllProgress, setApplyAllProgress] = useState(null);

  const suggestionScopeSelected = bulkMassMode && bulkSelected.size > 0;
  const suggestionScopeRows = useMemo(() => (
    suggestionScopeSelected ? visibleRows.filter(r => bulkSelected.has(r.email)) : visibleRows
  ), [suggestionScopeSelected, visibleRows, bulkSelected]);

  const pendingSuggestions = useMemo(() => pendingSuggestionActions(suggestionScopeRows, {
    suggestedCompanyFor: (r) => lookupMatch(r.email, r).suggestedCompany,
    companyDismissed: (r) => dismissedSuggestedCompanies.has(r.email),
    prospectFor: (r) => (r._matchedProspectId ? prospects.find(p => p.id === r._matchedProspectId) : null),
    tvStateFor: rowTableViewState,
    suggestionFor,
    tvDismissed: (pid, field) => dismissedSuggestions.has(`${pid}::${field}`),
  }), [suggestionScopeRows, lookupMatch, dismissedSuggestedCompanies, prospects,
    rowTableViewState, suggestionFor, dismissedSuggestions]);

  const suggestionSummary = useMemo(
    () => summarizeSuggestionActions(pendingSuggestions),
    [pendingSuggestions],
  );

  // Rows with no address yet whose company now has an email format on
  // record: the guess the import would have made had the format been saved
  // (or the Company filled in) when the row came in. Same scope as Apply
  // suggestions (ticked rows, else the visible ones). The company is read
  // the way the row's Table View match is - typed Company first, then the
  // prospect the row was matched to - and a guess that collides with an
  // address already in the list is left out rather than merging two people.
  const emailGuesses = useMemo(() => {
    const taken = new Set(rows.map(r => r.email));
    const out = [];
    for (const r of suggestionScopeRows) {
      if (isRealEmail(r.email)) continue;
      if (!r.firstname && !r.lastname) continue;
      const prospect = lookupMatch(r.email, r).matched
        || (r._matchedProspectId ? prospects.find(p => p.id === r._matchedProspectId) : null);
      if (!prospect) continue;
      const guess = buildEmailFromPattern(prospect.emailDomain, r.firstname, r.lastname).toLowerCase();
      if (!guess || taken.has(guess)) continue;
      taken.add(guess);
      out.push({ from: r.email, email: guess, prospectId: prospect.id });
    }
    return out;
  }, [rows, suggestionScopeRows, lookupMatch, prospects]);

  function applyEmailGuesses() {
    if (emailGuesses.length === 0) return;
    const byKey = new Map(emailGuesses.map(g => [g.from, g]));
    setRows(prev => {
      const next = prev.map(r => {
        const g = byKey.get(r.email);
        return g ? { ...r, email: g.email, _emailStatus: 'estimated', _matchedProspectId: r._matchedProspectId || g.prospectId } : r;
      });
      saveCache(next);
      return next;
    });
    // Selection is keyed by email, so carry ticked rows over to their new key.
    setBulkSelected(prev => {
      if (!emailGuesses.some(g => prev.has(g.from))) return prev;
      const next = new Set(prev);
      for (const g of emailGuesses) if (next.delete(g.from)) next.add(g.email);
      return next;
    });
    const n = emailGuesses.length;
    setApplyAllStatus({ type: 'success', message: `Guessed ${n} email${n === 1 ? '' : 's'} from the company email format. They show as Estimated: check them before adding to HubSpot.` });
    setTimeout(() => setApplyAllStatus(null), 5000);
  }

  const applyAllPct = applyAllProgress && applyAllProgress.total > 0
    ? Math.floor((applyAllProgress.done / applyAllProgress.total) * 100)
    : 0;

  // The green button opens a preview of what it is about to do rather than
  // a one-line confirm: which raw Company goes to which Table View company,
  // on which rows, why it was matched, and whether that becomes a saved
  // rule. Each line can be unticked before anything is written.
  // `excluded` holds the keys of the unticked lines.
  const [applyPreview, setApplyPreview] = useState(null);

  const companyMappingGroups = useMemo(() => {
    if (!applyPreview) return [];
    const byEmail = new Map(rows.map(r => [r.email, r]));
    return groupCompanyMappings(pendingSuggestions).map(g => ({
      ...g,
      targets: g.targets.map(t => {
        const sources = new Set();
        // The email domains on these rows, with a count each: the address
        // is what most matches are made on, so it is the thing to check.
        const domainCounts = new Map();
        let target = null;
        for (const email of t.emails) {
          const m = lookupMatch(email, byEmail.get(email) || null);
          sources.add(SUGGEST_SOURCE_LABELS[m.suggestSource] || 'matched');
          if (!target && m.matched) target = m.matched;
          const at = email.lastIndexOf('@');
          const d = at >= 0 ? email.slice(at + 1).toLowerCase() : '';
          if (d) domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
        }
        // The target company's address formats: the ones Table View holds
        // now, and the ones this apply would add (its Email Domain write).
        const splitFormats = (v) => String(v || '').split(/[\n;,]+/).map(x => x.trim()).filter(Boolean);
        const existingFormats = target ? splitFormats(target.emailDomain) : [];
        const existingLower = new Set(existingFormats.map(f => f.toLowerCase()));
        const proposedFormats = target
          ? pendingSuggestions
            .filter(a => a.kind === 'prospect' && a.prospectId === target.id && a.field === 'emailDomain')
            .flatMap(a => splitFormats(a.value))
            .filter(f => !existingLower.has(f.toLowerCase()))
          : [];
        return {
          ...t,
          lineKey: `c::${g.key}::${t.to}`,
          sources: Array.from(sources),
          domains: Array.from(domainCounts, ([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count),
          existingFormats,
          proposedFormats: Array.from(new Set(proposedFormats)),
        };
      }),
    }));
  }, [applyPreview, rows, pendingSuggestions, lookupMatch]);

  const prospectWriteGroups = useMemo(() => {
    if (!applyPreview) return [];
    const byId = new Map();
    for (const a of pendingSuggestions) {
      if (a.kind !== 'prospect') continue;
      if (!byId.has(a.prospectId)) byId.set(a.prospectId, { prospect: a.prospect, fields: [] });
      byId.get(a.prospectId).fields.push({ ...a, lineKey: `p::${a.prospectId}::${a.field}` });
    }
    return Array.from(byId.values());
  }, [applyPreview, pendingSuggestions]);

  const actionLineKey = (a) => (a.kind === 'company'
    ? `c::${companyRuleKey(a.from)}::${a.to}`
    : `p::${a.prospectId}::${a.field}`);

  function toggleApplyPreviewLine(lineKey) {
    setApplyPreview(prev => {
      if (!prev) return prev;
      const excluded = new Set(prev.excluded);
      if (excluded.has(lineKey)) excluded.delete(lineKey); else excluded.add(lineKey);
      return { ...prev, excluded };
    });
  }

  function applyAllSuggestions() {
    if (applyAllBusy || pendingSuggestions.length === 0) return;
    setApplyPreview({ excluded: new Set() });
  }

  async function runApplySuggestions() {
    if (!applyPreview || applyAllBusy) return;
    const actions = pendingSuggestions.filter(a => !applyPreview.excluded.has(actionLineKey(a)));
    setApplyPreview(null);
    if (actions.length === 0) return;

    setApplyAllBusy(true);
    setApplyAllProgress({ done: 0, total: actions.length });
    let done = 0;
    let failed = 0;

    // Company half, in one pass. Every row takes its own suggestion, and a
    // rule is saved only for a raw Company that maps to one company across
    // the run, without the sweep: one row's rule rewriting every other row
    // with the same raw name is what used to undo the rows before it.
    const companyActions = actions.filter(a => a.kind === 'company');
    if (companyActions.length > 0) {
      for (const g of groupCompanyMappings(companyActions)) {
        if (g.ruleSafe) saveCompanyRule(g.from, g.targets[0].to, { sweep: false });
      }
      const toByEmail = new Map(companyActions.map(a => [a.email, a.to]));
      setRows(prev => {
        const next = prev.map(r => (toByEmail.has(r.email) ? { ...r, company: toByEmail.get(r.email) } : r));
        saveCache(next);
        return next;
      });
      done += companyActions.length;
      setApplyAllProgress({ done, total: actions.length });
    }

    const prospectActions = actions.filter(a => a.kind === 'prospect');
    for (const action of prospectActions) {
      const ok = await applySingleSuggestion(action.prospect, action.field, action.value);
      if (ok) done += 1; else failed += 1;
      setApplyAllProgress({ done: done + failed, total: actions.length });
    }
    setApplyAllBusy(false);
    setApplyAllProgress(null);
    setApplyAllStatus({
      type: failed > 0 ? 'partial' : 'success',
      message: `Applied ${done} suggestion${done === 1 ? '' : 's'}${failed > 0 ? ` - ${failed} failed` : ''}.`,
    });
    setTimeout(() => setApplyAllStatus(null), 4000);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Bulk Add Contacts</h2>
          <div className={styles.subtitle}>Drop emails from Outlook here: extract addresses, edit details, push to HubSpot in one go.</div>
        </div>
        <div className={styles.headerActions}>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setShowRulesPanel(v => !v)}
              title="Saved Company mapping rules auto-apply on import"
            >
              ★ Saved rules <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>({Object.keys(companyRules).length})</span>
            </button>
            {showRulesPanel && (
              <div
                style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 500, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', minWidth: 320, maxWidth: 420, maxHeight: 360, overflow: 'auto' }}
              >
                <div style={{ padding: '0.5rem 0.7rem', borderBottom: '1px solid var(--color-border-light)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Saved Company rules</span>
                  <button type="button" onClick={() => setShowRulesPanel(false)} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.9rem', padding: 0 }}>×</button>
                </div>
                {Object.keys(companyRules).length === 0 ? (
                  <div style={{ padding: '0.75rem', fontSize: '0.72rem', color: '#64748B', fontStyle: 'italic' }}>
                    No saved rules yet. Click ✓ on a Suggested Company pill to save that mapping and auto-apply it on future imports.
                  </div>
                ) : (
                  <div style={{ padding: '0.4rem 0.5rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {Object.entries(companyRules).sort(([a], [b]) => a.localeCompare(b)).map(([raw, canonical]) => (
                      <div key={raw} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', padding: '0.25rem 0.35rem', borderRadius: 4, background: '#F8FAFC' }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${raw} → ${canonical}`}>
                          <span style={{ color: '#64748B' }}>{raw}</span>
                          <span style={{ color: '#CBD5E1', margin: '0 4px' }}>→</span>
                          <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{canonical}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeCompanyRule(raw)}
                          title="Remove this rule"
                          style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.9rem', padding: '0 4px', lineHeight: 1 }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#94A3B8'; }}
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {rows.length > 0 && (
            <button
              className={styles.secondaryBtn}
              onClick={exportToExcel}
              title="Download an .xlsx snapshot of every row in the grid (honors column visibility)"
            >
              Export to Excel
            </button>
          )}
          {rows.length > 0 && <button className={styles.secondaryBtn} onClick={clearAll}>Clear</button>}
        </div>
      </div>

      <div className={styles.body}>
        <div
          className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onPaste={handlePaste}
          tabIndex={0}
        >
          <span className={styles.dropIcon}>&#8681;</span>
          <span className={styles.dropTitle}>Drop emails, Excel, CSV, or TSV here</span>
          <span className={styles.dropHint}>
            Sheet drops <em>and</em> tab-separated pastes (⌘V / Ctrl+V) show a column-mapping preview. Plain-text drops / pastes pick out email addresses, plus people listed by name and title ("Jane Doe (CFO)", "Jane Doe - CFO", or a name line over a title line) with any LinkedIn URL beside them.
          </span>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Parsed</div>
            <div className={styles.summaryValue}>{rows.length}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>New</div>
            <div className={styles.summaryValue}>{newCount}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Already in HubSpot</div>
            <div className={styles.summaryValue}>{dupCount}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Sent this session</div>
            <div className={styles.summaryValue}>
              {addedCount + updatedCount}
              {updatedCount > 0 && <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#64748B', marginLeft: '0.35rem' }}>({addedCount} new · {updatedCount} upd)</span>}
              {errorCount > 0 ? <span className={styles.errInline}> · {errorCount} err</span> : null}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--color-border)', margin: '0.75rem 0 0' }}>
          {[
            { key: 'contacts',  label: 'Add Contacts',       count: newCount + updateCount },
            { key: 'tableview', label: 'Update Table View',  count: prospectBackfillUpdates.length },
          ].map(t => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                  color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  padding: '0.5rem 0.75rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {t.label}
                <span style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: isActive ? 'var(--color-accent)' : '#E2E8F0',
                  color: isActive ? '#fff' : '#475569',
                }}>{t.count}</span>
              </button>
            );
          })}
        </div>

        {activeTab === 'tableview' && prospectSuggestionRows.length === 0 && (
          <div className={styles.empty} style={{ marginTop: '0.75rem' }}>
            No Table View backfills available. Drop contacts whose matched prospects are missing a Website / Zoom / Email Domain value.
          </div>
        )}

        {activeTab === 'tableview' && prospectSuggestionRows.length > 0 && (
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: '0.75rem 0', border: '1px solid #86EFAC', background: '#F0FDF4', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', marginBottom: '0.4rem' }}>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#166534' }}>
                  Fill missing Table View data on {prospectSuggestionRows.length} prospect{prospectSuggestionRows.length === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: '0.68rem', color: '#14532D' }}>
                  Website / Zoom / Email Domain suggestions from your upload or inferred from the contact emails. Click ✓ on a cell to apply just that one, × to skip it, or the Update Table View button to push all {prospectBackfillUpdates.length} prospect{prospectBackfillUpdates.length === 1 ? '' : 's'} at once.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {backfillStatus && (
                  <span style={{ fontSize: '0.7rem', color: backfillStatus.type === 'success' ? '#166534' : '#92400E', fontWeight: 600 }}>
                    {backfillStatus.message}
                  </span>
                )}
                <button
                  type="button"
                  onClick={applyProspectBackfill}
                  disabled={backfillBusy || prospectBackfillUpdates.length === 0}
                  style={{ padding: '0.35rem 0.8rem', border: 'none', borderRadius: 6, background: prospectBackfillUpdates.length === 0 ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.75rem', fontWeight: 700, cursor: backfillBusy || prospectBackfillUpdates.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >
                  {backfillBusy ? 'Updating…' : 'Update Table View'}
                </button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.2fr) repeat(4, minmax(140px, 1fr))', gap: '0.2rem 0.4rem', fontSize: '0.7rem', background: '#fff', border: '1px solid #BBF7D0', borderRadius: 6, padding: '0.4rem 0.5rem' }}>
              <div style={{ fontWeight: 700, color: '#166534', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Company</div>
              {PROSPECT_BACKFILL_FIELDS.map(f => (
                <div key={f.key} style={{ fontWeight: 700, color: '#166534', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>{f.label}</div>
              ))}
              {prospectSuggestionRows.map(({ prospect, cells }) => (
                <Fragment key={prospect.id}>
                  <div style={{ color: '#166534', fontWeight: 600, alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={prospect.company || ''}>
                    {prospect.company || '-'}
                  </div>
                  {PROSPECT_BACKFILL_FIELDS.map(f => {
                    const cell = cells[f.key];
                    const isWebsite = f.key === 'website';
                    if (!cell || !cell.sugg) {
                      if (cell?.existing && f.key !== 'emailDomain') {
                        if (isWebsite) {
                          return (
                            <a
                              key={f.key}
                              href={ensureProtocol(cell.existing)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Already has: ${cell.existing}`}
                              style={{ color: 'var(--color-accent)', fontSize: '0.68rem', alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'underline' }}
                            >
                              {cell.existing}
                            </a>
                          );
                        }
                        return (
                          <div key={f.key} style={{ color: '#64748B', fontSize: '0.68rem', alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Already has: ${cell.existing}`}>
                            {cell.existing}
                          </div>
                        );
                      }
                      return <div key={f.key} style={{ color: '#CBD5E1', alignSelf: 'center' }}>-</div>;
                    }
                    const { sugg, dismissed, dismissKey } = cell;
                    const origin = sugg.origin;
                    const applyState = cellApplyState[dismissKey];
                    if (dismissed) {
                      return (
                        <div key={f.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'center', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 999, padding: '1px 8px', color: '#64748B', fontSize: '0.66rem' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through' }} title={sugg.value}>{String(sugg.value).replace(/\n/g, ' · ')}</span>
                          <button
                            type="button"
                            onClick={() => toggleDismissed(dismissKey)}
                            style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: '0.62rem', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}
                          >undo</button>
                        </div>
                      );
                    }
                    const valueDisplay = String(sugg.value).replace(/\n/g, ' · ');
                    const valueEl = isWebsite ? (
                      <a
                        href={ensureProtocol(sugg.value)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ color: '#854D0E', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                        title={sugg.value}
                      >
                        {valueDisplay}
                      </a>
                    ) : (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={sugg.value}>
                        {valueDisplay}
                      </span>
                    );
                    return (
                      <div key={f.key} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'center',
                        background: applyState === 'applied' ? '#DCFCE7' : applyState === 'error' ? '#FEE2E2' : '#FEF9C3',
                        border: `1px solid ${applyState === 'applied' ? '#86EFAC' : applyState === 'error' ? '#FCA5A5' : '#FACC15'}`,
                        borderRadius: 999, padding: '1px 6px 1px 8px',
                        color: applyState === 'applied' ? '#166534' : applyState === 'error' ? '#991B1B' : '#854D0E',
                        fontSize: '0.68rem', fontWeight: 600,
                      }}>
                        {valueEl}
                        {origin === 'inferred' && (
                          <span style={{ fontSize: '0.58rem', color: '#A16207', fontWeight: 500, fontStyle: 'italic' }}>auto</span>
                        )}
                        {applyState === 'applied' ? (
                          <span style={{ fontSize: '0.62rem', fontWeight: 700 }}>✓ Applied</span>
                        ) : applyState === 'applying' ? (
                          <span style={{ fontSize: '0.62rem' }}>…</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              title="Apply just this suggestion to the prospect"
                              onClick={() => applySingleSuggestion(prospect, f.key, sugg.value)}
                              style={{ background: '#16A34A', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.62rem', padding: '0 5px', lineHeight: 1.4, fontFamily: 'inherit', fontWeight: 700, borderRadius: 999 }}
                            >✓</button>
                            <button
                              type="button"
                              title="Remove this suggestion"
                              onClick={() => toggleDismissed(dismissKey)}
                              style={{ background: 'none', border: 'none', color: '#A16207', cursor: 'pointer', fontSize: '0.78rem', padding: 0, lineHeight: 1, fontFamily: 'inherit', fontWeight: 700 }}
                            >×</button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'contacts' && (() => {
          const set = (patch) => { setManualEntry(prev => ({ ...prev, ...patch })); if (manualMsg) setManualMsg(''); };
          const companyTyped = manualEntry.company.trim().length >= 2;
          const guessed = !manualEmailTouched && !!manualGuessedEmail;
          const inputStyle = { padding: '0.32rem 0.45rem', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit', minWidth: 0 };
          return (
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: showManualAdd ? '0.55rem 0.85rem' : '0.3rem 0.6rem', margin: '0.4rem 0 0', background: '#F8FAFC' }}>
              <button
                type="button"
                onClick={() => setShowManualAdd(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-secondary)', textAlign: 'left' }}
                title={showManualAdd ? 'Collapse' : 'Expand to add a single contact by name'}
              >
                <span style={{ fontSize: '0.7rem', color: '#94A3B8' }}>{showManualAdd ? '▾' : '▸'}</span>
                Add a contact by name
                <span style={{ fontWeight: 400, color: '#64748B' }}>
                 : email is guessed from the company’s recorded pattern
                </span>
              </button>
              {showManualAdd && (<>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.5rem' }}>
                <input style={{ ...inputStyle, flex: '1 1 110px' }} placeholder="First name"
                  value={manualEntry.firstname} onChange={e => set({ firstname: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') addManualContact(); }} />
                <input style={{ ...inputStyle, flex: '1 1 110px' }} placeholder="Last name"
                  value={manualEntry.lastname} onChange={e => set({ lastname: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') addManualContact(); }} />
                <input style={{ ...inputStyle, flex: '1 1 140px' }} placeholder="Job title"
                  value={manualEntry.jobtitle} onChange={e => set({ jobtitle: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') addManualContact(); }} />
                <input style={{ ...inputStyle, flex: '1 1 160px' }} placeholder="Company"
                  value={manualEntry.company} onChange={e => set({ company: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') addManualContact(); }} />
                <input
                  style={{ ...inputStyle, flex: '1 1 200px', background: guessed ? '#ECFDF5' : '#fff', borderColor: guessed ? '#86EFAC' : 'var(--color-border)' }}
                  placeholder="Email (auto-guessed)"
                  value={manualEmail}
                  onChange={e => { setManualEmail(e.target.value); setManualEmailTouched(true); if (manualMsg) setManualMsg(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') addManualContact(); }}
                  title={guessed ? 'Guessed from the company’s recorded email pattern: edit if it’s wrong' : 'Type the email, or add a company whose pattern is on record to auto-guess'}
                />
                <button type="button" className={styles.primaryBtn} onClick={addManualContact}
                  style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}>
                  + Add contact
                </button>
              </div>
              <div style={{ fontSize: '0.72rem', marginTop: '0.4rem', minHeight: '1em', color: manualMsg ? '#B45309' : (guessed ? '#15803D' : '#64748B') }}>
                {manualMsg
                  ? manualMsg
                  : guessed
                    ? `Guessed “${manualEmail}” from ${manualEntry.company.trim()}’s recorded email pattern.`
                    : companyTyped && (manualEntry.firstname.trim() || manualEntry.lastname.trim()) && !manualEmail
                      ? 'No email pattern on record for that company: type the email manually, or it’ll fill in once a pattern is known.'
                      : 'Type a name + company; if the company’s email pattern is on record, the address fills in automatically.'}
              </div>
              </>)}
            </div>
          );
        })()}

        {activeTab === 'contacts' && rows.length === 0 ? (
          <div
            className={styles.empty}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onPaste={handlePaste}
            tabIndex={0}
            style={{
              cursor: 'copy',
              minHeight: 140,
              outline: 'none',
              transition: 'border-color 0.15s, background 0.15s',
              ...(dragActive ? { borderColor: 'var(--color-accent)', background: 'var(--color-accent-light)' } : {}),
            }}
            title="Drag a sheet here, paste tab-separated rows (⌘V / Ctrl+V), or click and paste"
          >
            No contacts yet. Drag a sheet, paste tab-separated rows (⌘V / Ctrl+V), or click and paste here: same column-mapping preview as the box above.
          </div>
        ) : activeTab === 'contacts' && (
          <>
          {missingEmailCount > 0 && (
            <div style={{ margin: '0.75rem 0 0', padding: '0.5rem 0.7rem', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 6, fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <strong>{missingEmailCount}</strong> contact{missingEmailCount === 1 ? '' : 's'} {missingEmailCount === 1 ? 'has' : 'have'} no email{emailGuesses.length > 0
                ? <>. <strong>{emailGuesses.length}</strong> of them can be guessed from a saved company email format: hit <strong>✉ Guess {emailGuesses.length === 1 ? 'email' : 'emails'}</strong> below.</>
                : ': no address could be estimated from the company’s pattern.'}
              {' '}Add an email in the <strong>Email</strong> column or remove {missingEmailCount === 1 ? 'it' : 'them'} before importing to HubSpot.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', margin: '0.75rem 0 0.25rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {tagPresets.length > 0 && (
                <select
                  value={tagPresetId}
                  onChange={e => setTagPresetId(e.target.value)}
                  disabled={busy}
                  title={activeTagPreset
                    ? `New contacts are created with the "${activeTagPreset.name}" preset. ${presetSummary(activeTagPreset)}. Contacts already in HubSpot are not changed.`
                    : 'Pick a tag preset to give every contact this creates in HubSpot. Contacts already in HubSpot are not changed.'}
                  style={{
                    padding: '0.35rem 0.5rem', borderRadius: 6, fontSize: '0.75rem', fontFamily: 'inherit', maxWidth: 220,
                    border: `1px solid ${activeTagPreset ? '#7C3AED' : '#CBD5E1'}`,
                    background: activeTagPreset ? '#F5F3FF' : '#fff',
                    color: activeTagPreset ? '#5B21B6' : '#334155',
                    fontWeight: activeTagPreset ? 700 : 500,
                  }}
                >
                  <option value="">No tag preset</option>
                  {tagPresets.map(p => <option key={p.id} value={p.id}>{`Tag preset: ${p.name}`}</option>)}
                </select>
              )}
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={busy || missingEmailCount > 0 || (newCount === 0 && updateCount === 0)}
                onClick={addAll}
                title={
                  missingEmailCount > 0
                    ? `${missingEmailCount} contact${missingEmailCount === 1 ? '' : 's'} ${missingEmailCount === 1 ? 'has' : 'have'} no email: add or remove ${missingEmailCount === 1 ? 'it' : 'them'} first`
                    : newCount === 0 && updateCount === 0
                      ? 'Nothing to send'
                      : `Create ${newCount} new and fill missing fields on ${updateCount} existing contact${updateCount === 1 ? '' : 's'}`
                }
              >
                {busy
                  ? `Sending ${progress?.done}/${progress?.total}…`
                  : updateCount > 0 && newCount > 0
                    ? `Send to HubSpot (${newCount} new · ${updateCount} update${updateCount === 1 ? '' : 's'})`
                    : updateCount > 0
                      ? `Update ${updateCount} in HubSpot`
                      : `+ Add ${newCount} to HubSpot`}
              </button>
              <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
                Showing <strong>{visibleRows.length}</strong> of {rows.length} row{rows.length === 1 ? '' : 's'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {applyAllStatus && (
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: applyAllStatus.type === 'success' ? '#166534' : '#92400E' }}>
                  {applyAllStatus.message}
                </span>
              )}
              {/* The ✓ on every pill in the right-hand columns, once. Shown
                  only when there is something to apply, because a button
                  that says "0" is a button asking to be clicked to find
                  that out. */}
              {emailGuesses.length > 0 && (
                <button
                  type="button"
                  onClick={applyEmailGuesses}
                  disabled={applyAllBusy}
                  title={`Fill the blank Email on ${emailGuesses.length} ${suggestionScopeSelected ? 'selected ' : ''}row${emailGuesses.length === 1 ? '' : 's'} from each company's saved email format (Email Domains on the company card). Guesses are marked Estimated and can be edited.`}
                  style={{ padding: '0.3rem 0.7rem', border: '1px solid #D97706', borderRadius: 6, background: '#FFFBEB', color: '#92400E', fontSize: '0.72rem', fontWeight: 700, cursor: applyAllBusy ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                  {`✉ Guess ${emailGuesses.length} email${emailGuesses.length === 1 ? '' : 's'}${suggestionScopeSelected ? ' (selected)' : ''}`}
                </button>
              )}
              {(pendingSuggestions.length > 0 || applyAllBusy) && (
                <button
                  type="button"
                  onClick={applyAllSuggestions}
                  disabled={applyAllBusy}
                  title={`Accept every suggestion in the Suggested Company and Table View columns on ${
                    suggestionScopeSelected
                      ? `the ${suggestionScopeRows.length} selected row${suggestionScopeRows.length === 1 ? '' : 's'}`
                      : `all ${suggestionScopeRows.length} row${suggestionScopeRows.length === 1 ? '' : 's'} shown`
                  }: ${suggestionSummary.companies} Suggested Company, ${suggestionSummary.prospectFields} Table View field${suggestionSummary.prospectFields === 1 ? '' : 's'} across ${suggestionSummary.prospects} prospect${suggestionSummary.prospects === 1 ? '' : 's'}. Same as clicking each ✓. Dismissed suggestions stay dismissed.`}
                  style={{
                    padding: '0.3rem 0.7rem', border: '1px solid #16A34A', borderRadius: 6, color: '#fff', fontSize: '0.72rem', fontWeight: 700,
                    cursor: applyAllBusy ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                    // While running, the button fills left to right with the
                    // share applied: dark green done, light green still to go.
                    background: applyAllBusy
                      ? `linear-gradient(to right, #16A34A ${applyAllPct}%, #86EFAC ${applyAllPct}%)`
                      : '#16A34A',
                  }}
                >
                  {applyAllBusy
                    ? `Applying… ${applyAllPct}% (${applyAllProgress?.done || 0}/${applyAllProgress?.total || 0})`
                    : `✓ Apply ${pendingSuggestions.length} suggestion${pendingSuggestions.length === 1 ? '' : 's'}${suggestionScopeSelected ? ' (selected)' : ''}`}
                </button>
              )}
              <button
                type="button"
                onClick={() => { setBulkMassMode(v => !v); setBulkSelected(new Set()); }}
                title="Select multiple rows for bulk actions"
                style={{ padding: '0.3rem 0.7rem', border: `1px solid ${bulkMassMode ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: 6, background: bulkMassMode ? 'var(--color-accent)' : '#fff', color: bulkMassMode ? '#fff' : 'var(--color-text-secondary)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >
                {bulkMassMode ? 'Exit Mass Edit' : 'Mass Edit'}
              </button>
              {bulkMassMode && (() => {
                const allSelected = visibleRows.length > 0 && visibleRows.every(r => bulkSelected.has(r.email));
                return (
                  <button
                    type="button"
                    onClick={() => {
                      setBulkSelected(prev => {
                        const next = new Set(prev);
                        if (allSelected) for (const r of visibleRows) next.delete(r.email);
                        else for (const r of visibleRows) next.add(r.email);
                        return next;
                      });
                    }}
                    style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff', color: 'var(--color-text-secondary)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  >{allSelected ? `Deselect All (${bulkSelected.size})` : `Select All (${visibleRows.length})`}</button>
                );
              })()}
              {bulkMassMode && bulkSelected.size > 0 && (() => {
                // Restrict the "Send to HubSpot" counts to the rows the
                // user actually ticked. If everything they picked is
                // already in HubSpot with no fields to fill, the
                // button disables — same disabled rule as Send-all.
                const picked = rows.filter(r => bulkSelected.has(r.email));
                const newSel = picked.filter(r => !hubspotByEmail.has(r.email) && results[r.email] !== 'added').length;
                const updateSel = picked.filter(r => {
                  if (results[r.email] === 'added' || results[r.email] === 'updated') return false;
                  const existing = hubspotByEmail.get(r.email);
                  if (!existing) return false;
                  return !!missingFieldUpdates(r, existing) || hasPendingNote(r, existing);
                }).length;
                const sendDisabled = busy || (newSel === 0 && updateSel === 0);
                const sendLabel = newSel > 0 && updateSel > 0
                  ? `Send selected (${newSel} new · ${updateSel} update${updateSel === 1 ? '' : 's'})`
                  : updateSel > 0
                    ? `Update ${updateSel} selected in HubSpot`
                    : newSel > 0
                      ? `+ Add ${newSel} selected to HubSpot`
                      : `Send ${bulkSelected.size} selected (nothing to do)`;
                // How many of the picked rows have a HubSpot contact
                // we can actually queue for the Custom Email Campaign
                // — only existing contacts have an id we can pin to.
                const queueable = picked.filter(r => !!hubspotByEmail.get(r.email)?.id);
                const queueDisabled = queueable.length === 0;
                return (
                  <>
                    <button
                      type="button"
                      onClick={addSelected}
                      disabled={sendDisabled}
                      title={sendDisabled
                        ? 'Every selected row is already in HubSpot with no missing fields to fill.'
                        : `Push only the ${bulkSelected.size} ticked row${bulkSelected.size === 1 ? '' : 's'}: same create / fill-missing rules as the main Send button.`}
                      style={{
                        padding: '0.3rem 0.7rem',
                        border: 'none', borderRadius: 6,
                        background: sendDisabled ? '#CBD5E1' : '#0EA5E9',
                        color: '#fff', fontSize: '0.72rem', fontWeight: 700,
                        cursor: sendDisabled ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit', whiteSpace: 'nowrap',
                      }}
                    >{busy ? `Sending ${progress?.done}/${progress?.total}…` : sendLabel}</button>
                    <button
                      type="button"
                      disabled={queueDisabled}
                      onClick={() => {
                        if (queueDisabled) return;
                        const cur = getQueuedContactIds();
                        const seen = new Set(cur);
                        const ids = [...cur];
                        let added = 0;
                        for (const r of queueable) {
                          const id = String(hubspotByEmail.get(r.email).id);
                          if (!seen.has(id)) { seen.add(id); ids.push(id); added++; }
                        }
                        setQueuedContactIds(ids);
                        const skipped = picked.length - queueable.length;
                        const msg = added > 0
                          ? `Added ${added} contact${added === 1 ? '' : 's'} to the Custom Email Campaign queue${skipped > 0 ? ` (skipped ${skipped} not yet in HubSpot: push them first, then queue)` : ''}.`
                          : `All ${queueable.length} picked contact${queueable.length === 1 ? ' was' : 's were'} already queued.`;
                        alert(msg);
                      }}
                      title={queueDisabled
                        ? 'No selected rows are in HubSpot yet: push them with "Send selected to HubSpot" first, then queue them here.'
                        : `Queue ${queueable.length} HubSpot-matched contact${queueable.length === 1 ? '' : 's'} for the Draft Emails → Custom Email Campaign card. ${picked.length - queueable.length > 0 ? `${picked.length - queueable.length} not-yet-imported row${picked.length - queueable.length === 1 ? '' : 's'} will be skipped.` : ''}`}
                      style={{
                        padding: '0.3rem 0.7rem',
                        border: 'none', borderRadius: 6,
                        background: queueDisabled ? '#CBD5E1' : '#7C3AED',
                        color: '#fff', fontSize: '0.72rem', fontWeight: 700,
                        cursor: queueDisabled ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit', whiteSpace: 'nowrap',
                      }}
                    >→ Queue {queueable.length || ''} for Email Campaign</button>
                    <button
                      type="button"
                      onClick={() => { setBulkEditOpen(true); setBulkEditValue(''); }}
                      style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-accent)', borderRadius: 6, background: 'var(--color-accent)', color: '#fff', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                    >Bulk Edit {bulkSelected.size}</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(`Remove ${bulkSelected.size} selected row${bulkSelected.size === 1 ? '' : 's'} from the queue? (HubSpot is not touched.)`)) return;
                        setRows(prev => {
                          const next = prev.filter(r => !bulkSelected.has(r.email));
                          saveCache(next);
                          return next;
                        });
                        setBulkSelected(new Set());
                      }}
                      style={{ padding: '0.3rem 0.7rem', border: '1px solid #FCA5A5', borderRadius: 6, background: '#FEF2F2', color: '#B91C1C', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                    >Remove {bulkSelected.size} selected</button>
                  </>
                );
              })()}
              <ColumnToggle
                align="right"
                columns={bulkPickerColumns}
                visibleCols={bulkPickerVisible}
                starredCols={bulkColStarred}
                removedColumns={bulkRemovedColumns}
                colNames={{}}
                onToggle={toggleBulkColVisible}
                onStar={starBulkCol}
                onRemove={removeBulkCol}
                onRestore={restoreBulkCol}
                onReorder={reorderBulkCols}
                onResetColumns={resetBulkCols}
              />
              <button
                type="button"
                onClick={() => setTvMissingOnly(v => !v)}
                title="Show only rows whose matched Table View account is missing one or more of Website / Zoom ID / Zoom Name / Email Domain"
                style={{
                  padding: '0.3rem 0.7rem',
                  border: `1px solid ${tvMissingOnly ? '#F59E0B' : 'var(--color-border)'}`,
                  borderRadius: 6,
                  background: tvMissingOnly ? '#FEF3C7' : '#fff',
                  color: tvMissingOnly ? '#92400E' : 'var(--color-text-secondary)',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                ⚠ {tvMissingOnly ? 'Showing missing Table View data' : 'Missing Table View data only'}
              </button>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <datalist id="bulk-contacts-company-list">
              {prospectCompanyOptions.map(name => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <table className={styles.table}>
              <colgroup>
                {effectiveBulkCols.map(c => (
                  <col key={c.key} style={{ width: (bulkColWidths[c.key] || c.w || 120) + 'px' }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {effectiveBulkCols.map(c => {
                    const isRemove = c.key === '_remove';
                    const isSelect = c.key === '_select';
                    const sortArrow = sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
                    const canSort = !isRemove && !isSelect;
                    const hasSuggestFilter = ['suggestedCompany', 'website', 'zoomCompanyId', 'zoomCompanyName', 'emailDomain'].includes(c.key);
                    const filterOn = hasSuggestFilter && columnFilters[c.key];
                    const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(r => bulkSelected.has(r.email));
                    return (
                      <th key={c.key} style={{ position: 'relative' }}>
                        {isSelect ? (
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={() => {
                              setBulkSelected(prev => {
                                const next = new Set(prev);
                                if (allVisibleSelected) {
                                  for (const r of visibleRows) next.delete(r.email);
                                } else {
                                  for (const r of visibleRows) next.add(r.email);
                                }
                                return next;
                              });
                            }}
                            title="Select / deselect every visible row"
                            style={{ accentColor: 'var(--color-accent)' }}
                          />
                        ) : canSort ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
                            <button
                              type="button"
                              onClick={() => handleSort(c.key)}
                              title="Click to sort"
                              style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'left', flex: 1, whiteSpace: 'nowrap' }}
                            >
                              {c.label}{sortArrow}
                            </button>
                            {hasSuggestFilter && (
                              <button
                                type="button"
                                title={filterOn ? 'Showing only rows with a suggestion: click to show all' : 'Show only rows with a suggestion'}
                                onClick={() => toggleColumnFilter(c.key)}
                                style={{
                                  background: filterOn ? '#FEF3C7' : 'transparent',
                                  border: `1px solid ${filterOn ? '#F59E0B' : 'transparent'}`,
                                  color: filterOn ? '#92400E' : '#94A3B8',
                                  cursor: 'pointer', fontSize: '0.62rem', padding: '0 4px', lineHeight: 1.2,
                                  borderRadius: 4, fontFamily: 'inherit', fontWeight: 700,
                                }}
                              >⚑</button>
                            )}
                          </span>
                        ) : null}
                        {!isSelect && (
                          <span
                            onMouseDown={(e) => handleBulkResize(e, c.key)}
                            style={{ position: 'absolute', right: 0, top: '20%', bottom: '20%', width: 7, cursor: 'col-resize', borderRight: '2px solid var(--color-border-light)', zIndex: 5 }}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  {effectiveBulkCols.map(c => {
                    const isAction = c.key.startsWith('_');
                    return (
                      <th key={c.key} style={{ padding: '2px 4px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border-light)' }}>
                        {isAction ? null : (
                          <input
                            type="text"
                            value={bulkColTextFilters[c.key] || ''}
                            onChange={e => setBulkColTextFilters(prev => ({ ...prev, [c.key]: e.target.value }))}
                            placeholder="Filter..."
                            style={{ width: '100%', padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.68rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {BULK_BUCKETS.flatMap(bucket => {
                  const bucketRows = visibleRows.filter(r => rowBucket(r) === bucket.key);
                  if (bucketRows.length === 0) return [];
                  const collapsed = collapsedBuckets.has(bucket.key);
                  const header = (
                    <tr key={`__bucket_${bucket.key}`} className={styles.bucketRow}>
                      <td colSpan={effectiveBulkCols.length} style={{ borderLeftColor: bucket.color }}>
                        <button
                          type="button"
                          className={styles.bucketToggle}
                          onClick={() => toggleBucketCollapsed(bucket.key)}
                          aria-expanded={!collapsed}
                        >
                          <span className={styles.bucketCaret}>{collapsed ? '▸' : '▾'}</span>
                          <span className={styles.bucketTitle} style={{ color: bucket.color }}>{bucket.label}</span>
                          <span className={styles.bucketCount}>{bucketRows.length}</span>
                          <span className={styles.bucketHint}>{bucket.hint}</span>
                        </button>
                      </td>
                    </tr>
                  );
                  if (collapsed) return [header];
                  // Contacts placed outside the US, Canada and Mexico sit in
                  // their own sub-group at the bottom of the bucket.
                  const isIntl = r => contactOutsideNorthAmerica(r.country || hubspotByEmail.get(r.email)?.country);
                  const intlRows = bucketRows.filter(isIntl);
                  const intlKey = `${bucket.key}:intl`;
                  const intlCollapsed = collapsedBuckets.has(intlKey);
                  const sequence = [
                    ...bucketRows.filter(r => !isIntl(r)),
                    ...(intlRows.length ? [INTL_SUBGROUP] : []),
                    ...(intlCollapsed ? [] : intlRows),
                  ];
                  return [header, ...sequence.map(r => {
                  if (r === INTL_SUBGROUP) {
                    return (
                      <tr key={`__bucket_${intlKey}`} className={styles.subBucketRow}>
                        <td colSpan={effectiveBulkCols.length} style={{ borderLeftColor: bucket.color }}>
                          <button
                            type="button"
                            className={styles.bucketToggle}
                            onClick={() => toggleBucketCollapsed(intlKey)}
                            aria-expanded={!intlCollapsed}
                          >
                            <span className={styles.bucketCaret}>{intlCollapsed ? '▸' : '▾'}</span>
                            <span className={styles.subBucketTitle}>Outside US, Canada, Mexico</span>
                            <span className={styles.bucketCount}>{intlRows.length}</span>
                            <span className={styles.bucketHint}>From the contact's Country, or HubSpot's when the row has none.</span>
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  const hubspotContact = hubspotByEmail.get(r.email);
                  const exists = !!hubspotContact;
                  const outcome = results[r.email];
                  let statusLabel = 'New';
                  let statusClass = styles.statusNew;
                  if (exists) { statusLabel = 'In HubSpot'; statusClass = styles.statusDup; }
                  if (outcome === 'added') { statusLabel = 'Added ✓'; statusClass = styles.statusAdded; }
                  else if (outcome === 'updated') { statusLabel = 'Updated ✓'; statusClass = styles.statusAdded; }
                  else if (typeof outcome === 'string' && outcome.startsWith('error')) { statusLabel = outcome.replace(/^error: /, ''); statusClass = styles.statusErr; }
                  // If this existing contact has pending field fill-ins, flag as updatable.
                  const updateChanges = exists && outcome !== 'updated' ? pendingUpdateChanges(r, hubspotContact) : [];
                  if (updateChanges.length > 0) {
                    statusLabel = 'Update pending';
                    statusClass = styles.statusUpdatePending;
                  } else if (exists && !outcome) {
                    statusLabel = 'Ignored, exists';
                  }
                  const live = lookupMatch(r.email, r);
                  const currentHsCompany = hubspotContact?.company?.trim() || '';
                  const tvState = rowTableViewState(r);
                  const prospect = r._matchedProspectId ? prospects.find(p => p.id === r._matchedProspectId) : null;
                  // Which company card this row belongs to: the prospect the
                  // page has already matched it to, and failing that whatever
                  // the live lookup found - a typed company name, the HubSpot
                  // company, the email domain. Null when the row names nobody
                  // the tracker holds, and then there is no arrow: an arrow
                  // that opened the wrong company would be worse than none.
                  const companyCard = prospect || live.matched || null;
                  const renderTv = (fieldKey) => {
                    if (!tvState) return <span className={styles.metaText}>-</span>;
                    const existing = tvState.has[fieldKey];
                    const pid = r._matchedProspectId;
                    const dismissKey = `${pid}::${fieldKey}`;
                    const isDismissed = pid && dismissedSuggestions.has(dismissKey);
                    const sugg = pid && !isDismissed ? suggestionFor(pid, fieldKey) : null;
                    const prospect = pid ? prospects.find(p => p.id === pid) : null;
                    const applyState = cellApplyState[dismissKey];

                    // Render the prospect's existing value — hyperlink the
                    // website so the user can click through.
                    const renderExisting = (value, { small = false, prefix = '' } = {}) => {
                      const display = String(value).replace(/\n/g, ', ');
                      const style = {
                        fontSize: small ? '0.7rem' : '0.72rem',
                        color: '#334155',
                        display: 'inline-block',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      };
                      if (fieldKey === 'website') {
                        return (
                          <a
                            href={ensureProtocol(value)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={value}
                            style={{ ...style, color: 'var(--color-accent)', textDecoration: 'underline' }}
                          >
                            {prefix}{display}
                          </a>
                        );
                      }
                      return <span title={value} style={style}>{prefix}{display}</span>;
                    };

                    // Render the yellow suggestion pill with ✓ apply + × dismiss.
                    const renderSuggPill = (prefix = '') => {
                      const tip = sugg.origin === 'inferred'
                        ? `Inferred from contact emails.\nValue: ${sugg.value}`
                        : `From the uploaded file.\nValue: ${sugg.value}`;
                      const valueEl = fieldKey === 'website' ? (
                        <a
                          href={ensureProtocol(sugg.value)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ color: '#854D0E', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                        >
                          {prefix}{sugg.value}
                        </a>
                      ) : (
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                          {prefix}{sugg.value}
                        </span>
                      );
                      return (
                        <span
                          title={tip}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px 1px 8px', background: applyState === 'applied' ? '#DCFCE7' : applyState === 'error' ? '#FEE2E2' : '#FEF9C3', border: `1px solid ${applyState === 'applied' ? '#86EFAC' : applyState === 'error' ? '#FCA5A5' : '#FACC15'}`, borderRadius: 999, fontSize: '0.68rem', fontWeight: 600, color: applyState === 'applied' ? '#166534' : applyState === 'error' ? '#991B1B' : '#854D0E', maxWidth: '100%' }}
                        >
                          {valueEl}
                          {sugg.origin === 'inferred' && (
                            <span style={{ fontSize: '0.58rem', color: '#A16207', fontWeight: 500, fontStyle: 'italic' }}>auto</span>
                          )}
                          {applyState === 'applied' ? (
                            <span style={{ fontSize: '0.62rem', fontWeight: 700 }}>✓ Applied</span>
                          ) : applyState === 'applying' ? (
                            <span style={{ fontSize: '0.62rem' }}>…</span>
                          ) : (
                            <>
                              <button
                                type="button"
                                title="Apply just this suggestion to the prospect"
                                disabled={!prospect}
                                onClick={() => applySingleSuggestion(prospect, fieldKey, sugg.value)}
                                style={{ background: '#16A34A', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.62rem', padding: '0 5px', lineHeight: 1.4, fontFamily: 'inherit', fontWeight: 700, borderRadius: 999 }}
                              >✓</button>
                              <button
                                type="button"
                                title="Remove this suggestion"
                                onClick={() => toggleDismissed(dismissKey)}
                                style={{ background: 'none', border: 'none', color: '#A16207', cursor: 'pointer', fontSize: '0.78rem', padding: 0, lineHeight: 1, fontFamily: 'inherit', fontWeight: 700 }}
                              >×</button>
                            </>
                          )}
                        </span>
                      );
                    };

                    // emailDomain is multi-value — when the prospect has
                    // entries AND we can suggest a new one, show both.
                    if (existing && fieldKey === 'emailDomain' && sugg) {
                      return (
                        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                          {renderExisting(existing, { small: true })}
                          {renderSuggPill('+ ')}
                        </span>
                      );
                    }
                    if (existing) return renderExisting(existing);
                    if (isDismissed) {
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: '0.66rem', color: '#94A3B8', fontStyle: 'italic' }}>dismissed</span>
                          <button
                            type="button"
                            onClick={() => toggleDismissed(dismissKey)}
                            style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.62rem', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}
                          >undo</button>
                        </span>
                      );
                    }
                    if (sugg) return renderSuggPill();
                    // Quick-apply: when the matched prospect is missing
                    // Zoom Name, offer a one-click button to copy the
                    // prospect's own Company name over. Uses the
                    // prospect's canonical company (always a Table
                    // View name) rather than the row's typed company
                    // so we never suggest a value that doesn't exist
                    // in Table View.
                    if (fieldKey === 'zoomCompanyName' && prospect && prospect.company && prospect.company.trim()) {
                      const value = prospect.company.trim();
                      return (
                        <span
                          title={`Copy "${value}" into the prospect's Zoom Company Name`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px 1px 8px', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 999, fontSize: '0.66rem', fontWeight: 600, color: '#3730A3', maxWidth: '100%' }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>Use Company</span>
                          <button
                            type="button"
                            title={`Apply "${value}"`}
                            onClick={() => applySingleSuggestion(prospect, 'zoomCompanyName', value)}
                            style={{ background: '#4F46E5', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.62rem', padding: '0 5px', lineHeight: 1.4, fontFamily: 'inherit', fontWeight: 700, borderRadius: 999 }}
                          >✓</button>
                        </span>
                      );
                    }
                    return (
                      <span
                        title="Prospect is missing this field and no upload/inferred value"
                        style={{ fontSize: '0.68rem', color: '#94A3B8', fontStyle: 'italic' }}
                      >
                        missing
                      </span>
                    );
                  };
                  // One cell per column key, drawn in effectiveBulkCols order so the
                  // body follows the header when columns are reordered in the picker.
                  const bulkCells = {
                    _select: () => (
                      <td>
                        <input
                          type="checkbox"
                          checked={bulkSelected.has(r.email)}
                          onChange={() => toggleBulkSelect(r.email)}
                          style={{ accentColor: 'var(--color-accent)' }}
                        />
                      </td>
                    ),
                    _remove: () => (
                      <td><button className={styles.rowRemove} onClick={() => removeRow(r.email)} title="Remove row">×</button></td>
                    ),
                    email: () => (
                      (() => {
                        // Placeholder keys (__noemail__…) stand in for an unknown
                        // address — show them as blank so the user can type one.
                        // An in-progress entry (not yet a valid email) is still
                        // shown so typing works; it just stays flagged "missing".
                        const isPlaceholder = String(r.email).startsWith('__noemail__');
                        const real = isRealEmail(r.email);
                        const estimated = real && r._emailStatus === 'estimated';
                        const missing = !real;
                        return (
                          <td className={styles.emailCell}>
                            <input
                              className={styles.cellInput}
                              type="email"
                              value={isPlaceholder ? '' : r.email}
                              placeholder={missing ? 'No email: add one' : ''}
                              onChange={e => {
                                const v = e.target.value.trim().toLowerCase();
                                if (v) updateRow(r.email, { email: v, _emailStatus: 'provided' });
                                else updateRow(r.email, { email: placeholderEmailKey(r.firstname, r.lastname, effectiveRowCompany(r)), _emailStatus: 'missing' });
                              }}
                              title={estimated
                                ? 'Estimated from the company’s recorded email pattern: edit if it’s wrong'
                                : missing
                                  ? 'No address could be estimated: type one to import this contact to HubSpot'
                                  : ''}
                              style={{
                                background: estimated ? '#FFFBEB' : missing ? '#FEF2F2' : undefined,
                                borderColor: estimated ? '#FCD34D' : missing ? '#FCA5A5' : undefined,
                              }}
                            />
                            {estimated && <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#B45309', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Estimated</span>}
                            {missing && <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#B91C1C', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Needs email</span>}
                          </td>
                        );
                      })()
                    ),
                    status: () => (
                      <td>
                        <span
                          className={`${styles.statusPill} ${statusClass}`}
                          title={statusLabel === 'Ignored, exists'
                            ? 'Already in HubSpot with nothing new to fill in. Adding to HubSpot skips this contact.'
                            : updateChanges.length > 0
                              ? 'Adding to HubSpot fills these blank fields on the existing contact. Values HubSpot already has are never overwritten.'
                              : undefined}
                        >{statusLabel}</span>
                        {updateChanges.length > 0 && (
                          <ul className={styles.updateList}>
                            {updateChanges.map(c => (
                              <li key={c.label} title={`${c.label}: ${c.value}`}>
                                <span className={styles.updateField}>{c.label}</span> {c.value}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    ),
                    fullName: () => (
                      <td><input
                        className={styles.cellInput}
                        value={composeFullName(r)}
                        onChange={e => updateRow(r.email, splitFullName(e.target.value))}
                        title='Editing splits on the first space ("Last, First" also supported) and updates the First / Last cells.'
                      /></td>
                    ),
                    firstname: () => (
                      <td><input className={styles.cellInput} value={r.firstname} onChange={e => updateRow(r.email, { firstname: e.target.value })} /></td>
                    ),
                    lastname: () => (
                      <td><input className={styles.cellInput} value={r.lastname} onChange={e => updateRow(r.email, { lastname: e.target.value })} /></td>
                    ),
                    jobtitle: () => (
                      <td><input className={styles.cellInput} value={r.jobtitle} onChange={e => updateRow(r.email, { jobtitle: e.target.value })} /></td>
                    ),
                    company: () => (
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {/* The company name opens a popup of every row in
                              this batch at that company, where any of them
                              can be taken out of the grid in one go. It is
                              the thing on the row people point at, so
                              pointing at it is what opens the popup. When the
                              row is matched to a company the tracker holds,
                              the popup also carries the way into that
                              company's card.

                              The cell is still typed in - naming companies is
                              most of the work on this table - so the ✎ beside
                              the name swaps the link back for the input, and
                              the input reverts to a link as soon as it blurs.
                              Rows with nothing typed yet are a plain input:
                              there is no name to click, and the arrow still
                              carries you to the card the row was matched to.

                              The card that opens is the row's matched
                              prospect, which is the one every other column on
                              this row is already about: the Tier badge, the
                              CDM pills and the Table View columns all read it.
                              What is typed in the cell can be the HubSpot
                              spelling ("CBRE Inc (CBRE) - HQ") rather than the
                              tracker's, so the popup gathers rows on the
                              matched prospect as well as on the typed name. */}
                          {(() => {
                            const canOpen = Boolean(companyCard && onSelectProspect);
                            const editingCompany = companyEditKey === r.email;
                            const linkable = String(r.company || '').trim() !== '';
                            if (linkable && !editingCompany) {
                              return (
                                <>
                                  <button
                                    type="button"
                                    className={styles.companyLink}
                                    onClick={() => openCompanyContacts(r, canOpen ? companyCard : null)}
                                    title={`See this batch's contacts at "${r.company}"`}
                                    aria-label={`See the contacts at ${r.company}`}
                                  >{r.company}</button>
                                  <button
                                    type="button"
                                    className={styles.companyEditBtn}
                                    onClick={() => setCompanyEditKey(r.email)}
                                    title="Edit this company name"
                                    aria-label={`Edit the company name for ${r.firstname} ${r.lastname}`.trim()}
                                  >✎</button>
                                </>
                              );
                            }
                            return (
                              <>
                                <input
                                  className={styles.cellInput}
                                  value={r.company}
                                  autoFocus={editingCompany}
                                  onChange={e => updateRow(r.email, { company: e.target.value, _companyFromRule: false })}
                                  onBlur={() => setCompanyEditKey(k => (k === r.email ? null : k))}
                                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
                                  list="bulk-contacts-company-list"
                                  autoComplete="off"
                                />
                                {canOpen && !editingCompany && (
                                  <button
                                    type="button"
                                    onClick={() => onSelectProspect(companyCard)}
                                    title={`Open the company popup for "${companyCard.company}"`}
                                    aria-label={`Open the company popup for ${companyCard.company}`}
                                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-accent)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }}
                                  >↗</button>
                                )}
                              </>
                            );
                          })()}
                          {r._companyFromRule && (
                            <span title="Applied from a saved rule" style={{ fontSize: '0.72rem', color: '#F59E0B' }}>★</span>
                          )}
                        </div>
                        {exists && (
                          currentHsCompany ? (
                            <div className={styles.hsCompanyHint} title="Currently stored in HubSpot">
                              HubSpot: {currentHsCompany}
                            </div>
                          ) : (() => {
                            // HubSpot has no company. Show what we'll
                            // push when the user clicks Send so the
                            // gap is obvious AND the fix is obvious.
                            const fill = effectiveRowCompany(r);
                            if (fill) {
                              return (
                                <div className={styles.hsCompanyMissing} title={`HubSpot has no company on file. "${fill}" will be added on the next sync.`}>
                                  HubSpot: no company listed → will add: <strong>{fill}</strong>
                                </div>
                              );
                            }
                            return (
                              <div className={styles.hsCompanyMissing} title="HubSpot has no company value for this contact, and this row has nothing to fill in either. Type a company in the cell above to push it.">
                                HubSpot: no company listed
                              </div>
                            );
                          })()
                        )}
                      </td>
                    ),
                    tier: () => (
                      <td>{(() => {
                        // Dismissing the suggested company means "I don't
                        // trust this match" — so the Tier badge that
                        // came from the matched prospect should hide
                        // alongside the dismissed pill.
                        if (dismissedSuggestedCompanies.has(r.email)) return <span className={styles.metaText}>-</span>;
                        if (!prospect) return <span className={styles.metaText}>-</span>;
                        const explicit = (prospect.tier || '').trim();
                        let t;
                        if (explicit === 'Tier 1' || explicit === 'Tier 2') {
                          t = explicit;
                        } else if (matchesCdm(prospect.cdm, cdmName)) {
                          // Prospect is in My Accounts (matching CDM) but
                          // has no explicit Tier 1/2 marker — default
                          // to Tier 3 the same way MyAccountsView does.
                          t = 'Tier 3';
                        } else {
                          return <span className={styles.metaText}>-</span>;
                        }
                        const colors = t === 'Tier 1' ? { bg: '#DBEAFE', color: '#1E40AF' }
                          : t === 'Tier 2' ? { bg: '#FEF3C7', color: '#92400E' }
                          : { bg: '#F3F4F6', color: '#6B7280' };
                        return <span style={{ padding: '1px 6px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 600, background: colors.bg, color: colors.color }}>{t}</span>;
                      })()}</td>
                    ),
                    cdmReps: () => (
                      <td>{(() => {
                        // Mirror the My Accounts CDM + Other Reps
                        // columns so the bulk page tells the user up
                        // front who's tied to this Tier 1 / Tier 2
                        // account before they push contacts. CDM pill
                        // is the prospect's own owner; Other Reps
                        // pills come from the Target Accounts workbook
                        // entries the user has confirmed for that
                        // prospect on the Lists page. If the user
                        // dismissed the company suggestion, the badge
                        // hides too — the match is no longer trusted.
                        if (dismissedSuggestedCompanies.has(r.email)) return <span className={styles.metaText}>-</span>;
                        if (!prospect) return <span className={styles.metaText}>-</span>;
                        const cdm = String(prospect.cdm || '').trim();
                        const reps = otherRepsByProspect.get(prospect.id) || [];
                        // Dedup reps by name and roll their target
                        // companies into the tooltip.
                        const byRep = new Map();
                        for (const rep of reps) {
                          const key = rep.rep.toLowerCase();
                          if (!byRep.has(key)) byRep.set(key, { rep: rep.rep, companies: [] });
                          if (!byRep.get(key).companies.includes(rep.company)) byRep.get(key).companies.push(rep.company);
                        }
                        const dedupedReps = [...byRep.values()];
                        if (!cdm && dedupedReps.length === 0) return <span className={styles.metaText}>-</span>;
                        return (
                          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
                            {cdm && (
                              <span
                                title={matchesCdm(cdm, cdmName) ? `CDM: ${cdm} (you)` : `CDM: ${cdm}`}
                                style={{
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  background: matchesCdm(cdm, cdmName) ? '#DCFCE7' : '#E0E7FF',
                                  color: matchesCdm(cdm, cdmName) ? '#166534' : '#3730A3',
                                  whiteSpace: 'nowrap',
                                }}
                              >{cdm}</span>
                            )}
                            {dedupedReps.map((r, i) => (
                              <span
                                key={i}
                                title={r.companies.join(', ')}
                                style={{
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  fontSize: '0.65rem',
                                  fontWeight: 600,
                                  background: '#FEF9C3',
                                  color: '#92400E',
                                  whiteSpace: 'nowrap',
                                }}
                              >{r.rep}</span>
                            ))}
                          </span>
                        );
                      })()}</td>
                    ),
                    suggestedCompany: () => (
                      <td className={styles.suggestCell}>
                        {(() => {
                          const sc = live.suggestedCompany;
                          if (!sc) return <span className={styles.metaText}>-</span>;
                          if (companyTextEquals(r.company, sc)) {
                            return <span style={{ fontSize: '0.7rem', color: '#64748B', fontStyle: 'italic' }}>applied</span>;
                          }
                          if (dismissedSuggestedCompanies.has(r.email)) {
                            return (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ fontSize: '0.66rem', color: '#94A3B8', fontStyle: 'italic' }}>dismissed</span>
                                <button
                                  type="button"
                                  onClick={() => toggleSuggestedCompanyDismiss(r.email)}
                                  style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.62rem', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}
                                >undo</button>
                              </span>
                            );
                          }
                          const sourceLabel = SUGGEST_SOURCE_LABELS[live.suggestSource] || 'matched';
                          return (
                            <span
                              title={`${sc} · ${sourceLabel}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px 1px 8px', background: '#FEF9C3', border: '1px solid #FACC15', borderRadius: 999, fontSize: '0.68rem', fontWeight: 600, color: '#854D0E', maxWidth: '100%' }}
                            >
                              {/* The pill names a company the tracker holds -
                                  that is what makes it a suggestion rather
                                  than a guess off the domain - so the name
                                  itself opens that company's card. */}
                              {live.matched && onSelectProspect ? (
                                <button
                                  type="button"
                                  onClick={() => onSelectProspect(live.matched)}
                                  title={`Open the company popup for "${sc}"`}
                                  style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, maxWidth: '100%' }}
                                >{sc}</button>
                              ) : (
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{sc}</span>
                              )}
                              <button
                                type="button"
                                title="Use this as Company"
                                onClick={() => {
                                  // Trimmed on the way in: a Table View name
                                  // with a stray space would otherwise be
                                  // copied onto the row and pushed to HubSpot
                                  // that way.
                                  saveCompanyRule(r.company, sc.trim());
                                  updateRow(r.email, { company: sc.trim() });
                                }}
                                style={{ background: '#16A34A', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.62rem', padding: '0 5px', lineHeight: 1.4, fontFamily: 'inherit', fontWeight: 700, borderRadius: 999 }}
                              >✓</button>
                              <button
                                type="button"
                                title="Dismiss this suggestion"
                                onClick={() => toggleSuggestedCompanyDismiss(r.email)}
                                style={{ background: 'none', border: 'none', color: '#A16207', cursor: 'pointer', fontSize: '0.78rem', padding: 0, lineHeight: 1, fontFamily: 'inherit', fontWeight: 700 }}
                              >×</button>
                            </span>
                          );
                        })()}
                      </td>
                    ),
                    website: () => (
                      <td>{renderTv('website')}</td>
                    ),
                    zoomCompanyId: () => (
                      <td>{renderTv('zoomCompanyId')}</td>
                    ),
                    zoomCompanyName: () => (
                      <td>{renderTv('zoomCompanyName')}</td>
                    ),
                    emailDomain: () => (
                      <td>{renderTv('emailDomain')}</td>
                    ),
                    dans_tags: () => (
                      <td><input className={styles.cellInput} value={r.dans_tags || ''} onChange={e => updateRow(r.email, { dans_tags: e.target.value })} placeholder="Tag1, Tag2" /></td>
                    ),
                    phone: () => (
                      <td><input className={styles.cellInput} value={r.phone} onChange={e => updateRow(r.email, { phone: e.target.value })} /></td>
                    ),
                    mobilePhone: () => (
                      <td><input className={styles.cellInput} value={r.mobilePhone || ''} onChange={e => updateRow(r.email, { mobilePhone: e.target.value })} /></td>
                    ),
                    linkedinUrl: () => (
                      <td style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input className={styles.cellInput} value={r.linkedinUrl || ''} onChange={e => updateRow(r.email, { linkedinUrl: e.target.value })} placeholder="linkedin.com/in/…" />
                        {r.linkedinUrl && (
                          <a href={ensureProtocol(r.linkedinUrl)} target="_blank" rel="noopener noreferrer" title={r.linkedinUrl} style={{ fontSize: '0.72rem', color: 'var(--color-accent)', textDecoration: 'none' }}>↗</a>
                        )}
                      </td>
                    ),
                    city: () => (
                      <td><input className={styles.cellInput} value={r.city || ''} onChange={e => updateRow(r.email, { city: e.target.value })} /></td>
                    ),
                    state: () => (
                      <td><input className={styles.cellInput} value={r.state || ''} onChange={e => updateRow(r.email, { state: e.target.value })} /></td>
                    ),
                    country: () => (
                      <td><input className={styles.cellInput} value={r.country || ''} onChange={e => updateRow(r.email, { country: e.target.value })} /></td>
                    ),
                    notes: () => (
                      <td><input className={styles.cellInput} value={r.notes || ''} onChange={e => updateRow(r.email, { notes: e.target.value })} placeholder="Free-form note" /></td>
                    ),
                  };
                  return (
                    <tr key={r.email} className={isIntl(r) ? styles.intlRow : undefined}>
                      {effectiveBulkCols.map(c => (bulkCells[c.key] ? <Fragment key={c.key}>{bulkCells[c.key]()}</Fragment> : null))}
                    </tr>
                  );
                  })];
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {applyPreview && (() => {
        const FIELD_LABELS = { website: 'Website', zoomCompanyId: 'Zoom ID', zoomCompanyName: 'Zoom Name', emailDomain: 'Email Domain' };
        const ORIGIN_LABELS = { upload: 'from your upload', inferred: 'inferred from contact emails' };
        const rowName = new Map(rows.map(r => [r.email, [r.firstname, r.lastname].filter(Boolean).join(' ') || r.email]));
        const included = pendingSuggestions.filter(a => !applyPreview.excluded.has(actionLineKey(a))).length;
        const th = { textAlign: 'left', padding: '0.35rem 0.5rem', fontSize: '0.68rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em', borderBottom: '1px solid var(--color-border)', background: '#F8FAFC', position: 'sticky', top: 0 };
        const td = { padding: '0.4rem 0.5rem', fontSize: '0.76rem', borderBottom: '1px solid #F1F5F9', verticalAlign: 'top' };
        const sectionTitle = { fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)', margin: '0.25rem 0 0.4rem' };
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1.25rem' }}
            onClick={() => setApplyPreview(null)}
          >
            <div
              style={{ background: '#fff', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', width: 'min(1180px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>
                  Apply suggestions on {suggestionScopeRows.length} {suggestionScopeSelected ? 'selected ' : ''}row{suggestionScopeRows.length === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '0.25rem' }}>
                  Review the mapping below and untick anything that is wrong. Each row only takes its own suggestion; no other row is changed. HubSpot is not touched: send the rows when you are ready.
                </div>
              </div>
              <div style={{ padding: '0.85rem 1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {companyMappingGroups.length > 0 && (
                  <div>
                    <div style={sectionTitle}>Company mapping ({suggestionSummary.companies} row{suggestionSummary.companies === 1 ? '' : 's'})</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ ...th, width: 28 }} />
                          <th style={th}>Company on row</th>
                          <th style={th}>Becomes</th>
                          <th style={th}>Rows</th>
                          <th style={th}>Email domains on rows</th>
                          <th style={th}>Company email formats</th>
                          <th style={th}>Why</th>
                          <th style={th}>Saved rule</th>
                        </tr>
                      </thead>
                      <tbody>
                        {companyMappingGroups.flatMap(g => g.targets.map((t, i) => {
                          const on = !applyPreview.excluded.has(t.lineKey);
                          const names = t.emails.map(e => rowName.get(e) || e);
                          return (
                            <tr key={t.lineKey} style={{ opacity: on ? 1 : 0.45 }}>
                              <td style={td}>
                                <input type="checkbox" checked={on} onChange={() => toggleApplyPreviewLine(t.lineKey)} />
                              </td>
                              <td style={{ ...td, fontWeight: 600 }}>{i === 0 ? (g.from || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(blank)</span>) : ''}</td>
                              <td style={{ ...td, fontWeight: 600, color: '#166534' }}>{t.to}</td>
                              <td style={td} title={names.join(', ')}>
                                {t.emails.length}: {names.slice(0, 3).join(', ')}{names.length > 3 ? `, +${names.length - 3} more` : ''}
                              </td>
                              <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.72rem' }}>
                                {t.domains.length === 0
                                  ? <span style={{ color: '#94A3B8' }}>-</span>
                                  : t.domains.map(d => (
                                    <div key={d.domain}>@{d.domain}{t.domains.length > 1 || d.count > 1 ? <span style={{ color: '#94A3B8' }}> x{d.count}</span> : null}</div>
                                  ))}
                              </td>
                              <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.72rem', minWidth: 240, overflowWrap: 'anywhere' }}>
                                {t.existingFormats.length === 0 && t.proposedFormats.length === 0 && (
                                  <span style={{ color: '#94A3B8', fontFamily: 'inherit' }}>none on file</span>
                                )}
                                {t.existingFormats.map(f => (
                                  <div key={`e:${f}`} title="Already on the company in Table View" style={{ color: '#475569' }}>{f}</div>
                                ))}
                                {t.proposedFormats.map(f => (
                                  <div key={`p:${f}`} title="Proposed: added to the company's Email Domain by this apply" style={{ color: '#166534', fontWeight: 600 }}>+ {f} <span style={{ fontWeight: 400, color: '#64748B' }}>(new)</span></div>
                                ))}
                              </td>
                              <td style={{ ...td, color: '#64748B' }}>{t.sources.join('; ')}</td>
                              <td style={{ ...td, color: g.ruleSafe ? '#166534' : '#92400E' }}>
                                {g.ruleSafe
                                  ? `"${g.from}" → "${t.to}"`
                                  : !g.key
                                    ? 'No (blank company)'
                                    : g.targets.length > 1
                                      ? `No: "${g.from}" maps to ${g.targets.length} companies here`
                                      : 'No (same name)'}
                              </td>
                            </tr>
                          );
                        }))}
                      </tbody>
                    </table>
                  </div>
                )}
                {prospectWriteGroups.length > 0 && (
                  <div>
                    <div style={sectionTitle}>Table View fields ({suggestionSummary.prospectFields} field{suggestionSummary.prospectFields === 1 ? '' : 's'} on {suggestionSummary.prospects} prospect{suggestionSummary.prospects === 1 ? '' : 's'}, saved straight to the prospect record)</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ ...th, width: 28 }} />
                          <th style={th}>Prospect</th>
                          <th style={th}>Field</th>
                          <th style={th}>Value</th>
                          <th style={th}>Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prospectWriteGroups.flatMap(g => g.fields.map((a, i) => {
                          const on = !applyPreview.excluded.has(a.lineKey);
                          return (
                            <tr key={a.lineKey} style={{ opacity: on ? 1 : 0.45 }}>
                              <td style={td}>
                                <input type="checkbox" checked={on} onChange={() => toggleApplyPreviewLine(a.lineKey)} />
                              </td>
                              <td style={{ ...td, fontWeight: 600 }}>{i === 0 ? g.prospect.company : ''}</td>
                              <td style={td}>{FIELD_LABELS[a.field] || a.field}</td>
                              <td style={{ ...td, color: '#166534', wordBreak: 'break-all' }}>{a.value}</td>
                              <td style={{ ...td, color: '#64748B' }}>
                                {a.source === 'useCompany' ? "the prospect's own company name" : (ORIGIN_LABELS[a.origin] || 'suggested')}
                                {a.field === 'emailDomain' ? ' (added to the list)' : ''}
                              </td>
                            </tr>
                          );
                        }))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setApplyPreview(null)}
                  style={{ padding: '0.4rem 0.9rem', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff', color: 'var(--color-text-secondary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >Cancel</button>
                <button
                  type="button"
                  onClick={runApplySuggestions}
                  disabled={included === 0}
                  style={{ padding: '0.4rem 0.9rem', border: '1px solid #16A34A', borderRadius: 6, background: included === 0 ? '#86EFAC' : '#16A34A', color: '#fff', fontSize: '0.8rem', fontWeight: 700, cursor: included === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                >✓ Apply {included} suggestion{included === 1 ? '' : 's'}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {bulkEditOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1.25rem' }}
          onClick={() => setBulkEditOpen(false)}
        >
          <div
            style={{ background: '#fff', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', width: 'min(440px, 100%)', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Bulk Edit {bulkSelected.size} contact{bulkSelected.size === 1 ? '' : 's'}</div>
              <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '0.25rem' }}>
                Updates the selected rows in the grid only: push them to HubSpot via Send to HubSpot afterwards.
              </div>
            </div>
            <div style={{ padding: '0.85rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)' }}>
                Field
                <select
                  value={bulkEditField}
                  onChange={e => setBulkEditField(e.target.value)}
                  style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit', marginTop: 4 }}
                >
                  <option value="firstname">First Name</option>
                  <option value="lastname">Last Name</option>
                  <option value="company">Company</option>
                  <option value="jobtitle">Job Title</option>
                  <option value="phone">Work Phone Number</option>
                  <option value="mobilePhone">Cell Phone Number</option>
                  <option value="linkedinUrl">LinkedIn URL</option>
                  <option value="dans_tags">Dan's Tags</option>
                  <option value="city">City</option>
                  <option value="state">State</option>
                  <option value="country">Country</option>
                  <option value="notes">Notes</option>
                </select>
              </label>
              {(bulkEditField === 'dans_tags' || bulkEditField === 'notes') && (
                <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="radio" checked={bulkEditMode === 'replace'} onChange={() => setBulkEditMode('replace')} /> Replace
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="radio" checked={bulkEditMode === 'append'} onChange={() => setBulkEditMode('append')} /> Append
                  </label>
                </div>
              )}
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)' }}>
                {bulkEditMode === 'append' ? 'Value to append' : 'New value'}
                <input
                  autoFocus
                  type="text"
                  value={bulkEditValue}
                  onChange={e => setBulkEditValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') applyBulkEdit(); if (e.key === 'Escape') setBulkEditOpen(false); }}
                  placeholder={bulkEditMode === 'append' ? 'e.g. Dan Key Target' : 'Leave empty to clear the field'}
                  style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit', marginTop: 4 }}
                />
              </label>
            </div>
            <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setBulkEditOpen(false)}
                style={{ padding: '0.45rem 0.9rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >Cancel</button>
              <button
                type="button"
                onClick={applyBulkEdit}
                style={{ padding: '0.45rem 0.9rem', border: 'none', background: 'var(--color-accent)', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >Apply to {bulkSelected.size}</button>
            </div>
          </div>
        </div>
      )}

      {companyContacts && (() => {
        const norm = (v) => String(v || '').trim().toLowerCase();
        const { name, prospectId, card } = companyContacts;
        const spellings = [name, card?.company].filter(Boolean);
        const members = rows.filter(r =>
          (prospectId && r._matchedProspectId === prospectId) || spellings.some(n => companiesMatch(r.company, n))
        );
        const memberEmails = new Set(members.map(r => String(r.email || '').toLowerCase()));
        const linkKey = norm(card?.company || name);
        const existing = existingCompanyContacts(
          hubspotByEmail.values(),
          [name, card?.company].filter(Boolean),
          card,
          (settings?.companyContactLinks || {})[linkKey],
        )
          .filter(c => !memberEmails.has(String(c.email || '').toLowerCase()))
          .sort((a, b) => `${a.lastname || ''} ${a.firstname || ''}`.localeCompare(`${b.lastname || ''} ${b.firstname || ''}`));
        const picked = members.filter(r => companyContactsPicked.has(r.email));
        const allPicked = members.length > 0 && picked.length === members.length;
        const close = () => setCompanyContacts(null);
        const togglePick = (email) => setCompanyContactsPicked(prev => {
          const next = new Set(prev);
          if (next.has(email)) next.delete(email); else next.add(email);
          return next;
        });
        const removePicked = () => {
          removeRows(picked.map(r => r.email));
          setCompanyContactsPicked(new Set());
        };
        const title = card?.company || name;
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1.25rem' }}
            onClick={close}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Contacts at ${title}`}
              style={{ background: '#fff', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', width: 'min(1500px, 96vw)', height: '92vh', display: 'flex', flexDirection: 'column' }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>{title}</div>
                  <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '0.25rem' }}>
                    {members.length} contact{members.length === 1 ? '' : 's'} in this batch, {existing.length} already in HubSpot. Removing takes batch rows out of the grid only; nothing is deleted in HubSpot.
                  </div>
                </div>
                {card && onSelectProspect && (
                  <button
                    type="button"
                    onClick={() => { close(); onSelectProspect(card); }}
                    title={`Open the company popup for "${card.company}"`}
                    style={{ padding: '0.35rem 0.7rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-accent)', borderRadius: 6, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  >Open company card ↗</button>
                )}
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  autoFocus
                  style={{ background: 'none', border: 'none', fontSize: '1.2rem', lineHeight: 1, color: '#64748B', cursor: 'pointer', padding: 0 }}
                >×</button>
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {/* The HubSpot contacts already at the company, first and in the
                    company card's own roster table (same columns, widths and
                    order the user set there), so it reads the way the card
                    does. Read-only here: no select or delete column. */}
                <div style={{ padding: '0.6rem 1.25rem 0.35rem', fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Already in HubSpot ({existing.length})</div>
                {existing.length === 0 ? (
                  <div style={{ padding: '0.25rem 1.25rem 1rem', fontSize: '0.8rem', color: '#64748B' }}>
                    {hubspotByEmail.size === 0 ? 'HubSpot contacts have not loaded yet.' : 'No other HubSpot contacts at this company.'}
                  </div>
                ) : (
                  <div style={{ padding: '0 1.25rem 0.5rem' }}>
                    <ContactsTable
                      contacts={existing}
                      company={title}
                      settings={settings}
                      updateSettings={updateSettings}
                      height="min(520px, 55vh)"
                    />
                  </div>
                )}
                <div style={{ padding: '0.9rem 1.25rem 0.35rem', fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', borderTop: '1px solid var(--color-border)', marginTop: '0.5rem' }}>In this batch ({members.length})</div>
                {members.length === 0 ? (
                  <div style={{ padding: '1.25rem', fontSize: '0.8rem', color: '#64748B' }}>No contacts left for this company.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: '#64748B', background: '#F8FAFC' }}>
                        <th style={{ padding: '0.45rem 0.6rem', width: 28 }}>
                          <input
                            type="checkbox"
                            checked={allPicked}
                            onChange={() => setCompanyContactsPicked(allPicked ? new Set() : new Set(members.map(r => r.email)))}
                            aria-label="Select all"
                          />
                        </th>
                        <th style={{ padding: '0.45rem 0.6rem' }}>Name</th>
                        <th style={{ padding: '0.45rem 0.6rem' }}>Job title</th>
                        <th style={{ padding: '0.45rem 0.6rem' }}>Email</th>
                        <th style={{ padding: '0.45rem 0.6rem' }}>Status</th>
                        <th style={{ padding: '0.45rem 0.6rem', width: 28 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {members.map(r => {
                        const outcome = results[r.email];
                        const status = outcome === 'added' ? 'Added' : outcome === 'updated' ? 'Updated' : hubspotByEmail.has(r.email) ? 'In HubSpot' : 'New';
                        const fullName = composeFullName(r).trim();
                        return (
                          <tr key={r.email} style={{ borderTop: '1px solid var(--color-border)' }}>
                            <td style={{ padding: '0.4rem 0.6rem' }}>
                              <input
                                type="checkbox"
                                checked={companyContactsPicked.has(r.email)}
                                onChange={() => togglePick(r.email)}
                                aria-label={`Select ${fullName || r.email}`}
                              />
                            </td>
                            <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600, color: 'var(--color-text)' }}>{fullName || '-'}</td>
                            <td style={{ padding: '0.4rem 0.6rem', color: '#334155' }}>{r.jobtitle || '-'}</td>
                            <td style={{ padding: '0.4rem 0.6rem', color: '#334155', fontFamily: 'monospace', fontSize: '0.74rem', wordBreak: 'break-all' }}>{isRealEmail(r.email) ? r.email : '-'}</td>
                            <td style={{ padding: '0.4rem 0.6rem', color: '#64748B', whiteSpace: 'nowrap' }}>{status}</td>
                            <td style={{ padding: '0.4rem 0.6rem' }}>
                              <button className={styles.rowRemove} onClick={() => removeRows([r.email])} title="Remove row" aria-label={`Remove ${fullName || r.email}`}>×</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={close}
                  style={{ padding: '0.45rem 0.9rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
                >Close</button>
                <button
                  type="button"
                  onClick={removePicked}
                  disabled={picked.length === 0}
                  style={{ padding: '0.45rem 0.9rem', border: 'none', background: picked.length ? '#DC2626' : '#FCA5A5', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: picked.length ? 'pointer' : 'default', fontFamily: 'inherit' }}
                >{picked.length ? `Remove ${picked.length} selected` : 'Remove selected'}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {pendingUpload && (() => {
        const { fileName, headers, rows: rawRows, mapping } = pendingUpload;
        const sampleRow = rawRows[0] || {};
        const mappedFieldCounts = {};
        for (const v of Object.values(mapping)) if (v) mappedFieldCounts[v] = (mappedFieldCounts[v] || 0) + 1;
        const mappedVals = Object.values(mapping);
        const hasEmail = mappedVals.includes('email');
        const hasName = mappedVals.includes('firstname') || mappedVals.includes('lastname') || mappedVals.includes('fullName');
        const hasCompany = mappedVals.includes('company');
        // Without an Email column we can still import as long as Name + Company
        // are mapped - addresses are estimated from each company's recorded
        // pattern, and any that can't be estimated are flagged in the grid and
        // blocked from the HubSpot push until the user fills them in.
        const canEstimate = !hasEmail && hasName && hasCompany;
        const canImport = hasEmail || canEstimate;
        const hasDuplicate = Object.values(mappedFieldCounts).some(n => n > 1);
        const updateCell = (header, fieldKey) => {
          setPendingUpload(prev => prev ? { ...prev, mapping: { ...prev.mapping, [header]: fieldKey } } : prev);
        };
        const cancel = () => setPendingUpload(null);
        const confirmImport = () => {
          if (!canImport) { alert('Map a column to Email: or map Name and Company so addresses can be estimated.'); return; }
          if (hasDuplicate) { alert('Each field can only be mapped to one column. Set duplicates to Ignore first.'); return; }
          const parsed = applyMappingToRows(rawRows, mapping);
          if (parsed.length === 0) {
            alert('No rows had an email or a name: nothing to import.');
            return;
          }
          mergeNewRows(parsed);
          setPendingUpload(null);
        };
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.25rem' }}>
            <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', width: 'min(900px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>Review column mapping</div>
                <div style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '0.2rem' }}>
                  <strong>{rawRows.length}</strong> row{rawRows.length === 1 ? '' : 's'} from <em>{fileName}</em>: confirm each column maps to the right field, then import.
                </div>
                {!canImport && (
                  <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 6, fontSize: '0.75rem' }}>
                    Map a column to <strong>Email</strong>: or map <strong>Name</strong> and <strong>Company</strong> so addresses can be estimated.
                  </div>
                )}
                {canEstimate && (
                  <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#EFF6FF', border: '1px solid #93C5FD', color: '#1E40AF', borderRadius: 6, fontSize: '0.75rem' }}>
                    No <strong>Email</strong> column: addresses will be estimated from each company’s recorded pattern. Contacts we can’t estimate are flagged in the grid and blocked from the HubSpot import until you add an email.
                  </div>
                )}
                {hasDuplicate && (
                  <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#FFFBEB', border: '1px solid #FCD34D', color: '#854D0E', borderRadius: 6, fontSize: '0.75rem' }}>
                    Some fields are mapped by more than one column. Only one mapping can win: set duplicates to "Ignore".
                  </div>
                )}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1.25rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                      <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--color-border)', fontSize: '0.7rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>File Column</th>
                      <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--color-border)', fontSize: '0.7rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sample Value</th>
                      <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--color-border)', fontSize: '0.7rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Maps To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map(h => {
                      const sample = String(sampleRow[h] ?? '');
                      const mappedTo = mapping[h] || '';
                      return (
                        <tr key={h} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '0.35rem 0.5rem', fontWeight: 600, color: 'var(--color-text)' }}>{h}</td>
                          <td style={{ padding: '0.35rem 0.5rem', color: '#64748B', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sample}>
                            {sample || <span style={{ color: '#CBD5E1', fontStyle: 'italic' }}>(empty)</span>}
                          </td>
                          <td style={{ padding: '0.35rem 0.5rem' }}>
                            <select
                              value={mappedTo}
                              onChange={e => updateCell(h, e.target.value)}
                              style={{ width: '100%', padding: '0.25rem 0.4rem', border: `1px solid ${mappedTo ? 'var(--color-border)' : '#FDBA74'}`, background: mappedTo ? '#fff' : '#FFF7ED', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit' }}
                            >
                              {FIELD_OPTIONS.map(opt => (
                                <option key={opt.key} value={opt.key}>{opt.label}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" onClick={cancel} style={{ padding: '0.45rem 0.9rem', border: '1px solid var(--color-border)', background: '#fff', color: 'var(--color-text-secondary)', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button type="button" onClick={confirmImport} disabled={!canImport || hasDuplicate} style={{ padding: '0.45rem 0.9rem', border: 'none', background: (!canImport || hasDuplicate) ? '#94A3B8' : 'var(--color-accent)', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: (!canImport || hasDuplicate) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>Import {rawRows.length} row{rawRows.length === 1 ? '' : 's'}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
