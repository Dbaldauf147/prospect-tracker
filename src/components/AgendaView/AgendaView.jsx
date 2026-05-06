import { useMemo, useState, useCallback, useRef, useEffect, Fragment } from 'react';
import * as XLSX from 'xlsx';
import { logAction } from '../../utils/auditLog';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotContacts, updateHubspotCache } from '../../utils/hubspotContactsCache';
import { matchesCdm } from '../../utils/cdmMatch';
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
  { key: '',                         label: '— Ignore this column —' },
  { key: 'email',                    label: 'Email (required)' },
  { key: 'firstname',                label: 'First Name' },
  { key: 'lastname',                 label: 'Last Name' },
  { key: 'company',                  label: 'Company' },
  { key: 'phone',                    label: 'Work Phone Number' },
  { key: 'mobilePhone',              label: 'Cell Phone Number' },
  { key: 'jobtitle',                 label: 'Job Title' },
  { key: 'linkedinUrl',              label: 'LinkedIn URL' },
  { key: 'city',                     label: 'City' },
  { key: 'state',                    label: 'State' },
  { key: 'country',                  label: 'Country' },
  { key: 'dans_tags',                label: "Dan's Tags" },
  { key: '_upload_website',          label: 'Table View — Website' },
  { key: '_upload_zoomCompanyId',    label: 'Table View — Zoom Company ID' },
  { key: '_upload_zoomCompanyName',  label: 'Table View — Zoom Company Name' },
  { key: '_upload_emailDomain',      label: 'Table View — Email Domain' },
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
    for (const [src, dst] of Object.entries(mapping)) {
      if (!dst) continue;
      out1[dst] = String(r[src] ?? '').trim();
    }
    if (!out1.email) continue;
    out1.email = out1.email.toLowerCase();
    if (out1.email.endsWith('@se.com')) continue;
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
        // "Last, First" — common for Outlook contact cards.
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

// Saved "when a contact's parsed Company matches X, auto-apply Y"
// rules. Persisted to localStorage so the user doesn't have to keep
// re-clicking the same Suggested Company pill across imports.
const COMPANY_RULES_KEY = 'bulk-contacts-company-rules';
const BULK_COL_WIDTHS_KEY = 'bulk-contacts-col-widths';
const BULK_COL_VISIBLE_KEY = 'bulk-contacts-col-visible';

// Column catalog for the Bulk Add Contacts table. order drives the
// layout; key is the single source of truth for width state, toggle
// state, and (where applicable) sort/filter handlers.
const BULK_COLS = [
  { key: '_remove',          label: '',                    w: 36,  fixed: true, toggleable: false },
  { key: 'email',            label: 'Email',               w: 230 },
  { key: 'status',           label: 'HubSpot Status',      w: 120 },
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

const companyRuleKey = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function loadCompanyRules() {
  try { return JSON.parse(localStorage.getItem(COMPANY_RULES_KEY)) || {}; } catch { return {}; }
}
function persistCompanyRules(map) {
  try { localStorage.setItem(COMPANY_RULES_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}
function saveCache(rows) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch { /* ignore */ }
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

// Patterns we check a contact email's local-part against to detect the
// company's naming convention. The winner (most common across the
// rows matched to a given prospect) becomes the "<pattern>@<domain>"
// Email Domain suggestion.
const EMAIL_PATTERN_RULES = [
  { key: 'firstname.lastname',    build: (f, l) => (f && l ? `${f}.${l}` : null) },
  { key: 'firstname_lastname',    build: (f, l) => (f && l ? `${f}_${l}` : null) },
  { key: 'firstname-lastname',    build: (f, l) => (f && l ? `${f}-${l}` : null) },
  { key: 'firstnamelastname',     build: (f, l) => (f && l ? `${f}${l}` : null) },
  { key: 'lastname.firstname',    build: (f, l) => (f && l ? `${l}.${f}` : null) },
  { key: 'lastnamefirstname',     build: (f, l) => (f && l ? `${l}${f}` : null) },
  { key: 'firstinitial.lastname', build: (f, l) => (f && l ? `${f[0]}.${l}` : null) },
  { key: 'firstinitiallastname',  build: (f, l) => (f && l ? `${f[0]}${l}` : null) },
  { key: 'firstname.lastinitial', build: (f, l) => (f && l ? `${f}.${l[0]}` : null) },
  { key: 'firstnamelastinitial',  build: (f, l) => (f && l ? `${f}${l[0]}` : null) },
  { key: 'firstname',             build: (f)    => (f ? f : null) },
  { key: 'lastname',              build: (_, l) => (l ? l : null) },
];

function detectLocalPattern(email, firstname, lastname) {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0) return null;
  const local = email.slice(0, at).toLowerCase().replace(/\+.*/, '');
  const f = String(firstname || '').toLowerCase().replace(/[^a-z]/g, '');
  const l = String(lastname || '').toLowerCase().replace(/[^a-z]/g, '');
  for (const rule of EMAIL_PATTERN_RULES) {
    const expected = rule.build(f, l);
    if (expected && local === expected) return rule.key;
  }
  return null;
}

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
]);

function pickDominantKey(map) {
  let bestKey = null;
  let bestCount = 0;
  for (const [k, c] of map) if (c > bestCount) { bestKey = k; bestCount = c; }
  return bestKey;
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

export function AgendaView({ prospects = [], onUpdateProspect, cdmName, settings, targetAccountsData }) {
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
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  // Column-resize + visibility state for the Bulk Add Contacts table.
  const [bulkColWidths, setBulkColWidths] = useState(() => loadBulkColWidths());
  const [bulkColTextFilters, setBulkColTextFilters] = useState({});
  const [bulkMassMode, setBulkMassMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditField, setBulkEditField] = useState('company');
  const [bulkEditValue, setBulkEditValue] = useState('');
  const [bulkEditMode, setBulkEditMode] = useState('replace'); // 'replace' | 'append'
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
  const [bulkColVisible, setBulkColVisible] = useState(() => {
    const saved = loadBulkColVisible();
    return saved || new Set(BULK_COLS.map(c => c.key));
  });
  // BULK_COLS filtered by visibility, with a dynamically-injected
  // _select checkbox column at the left edge when mass-edit mode is on.
  const effectiveBulkCols = useMemo(() => {
    const base = BULK_COLS.filter(c => bulkColVisible.has(c.key));
    if (bulkMassMode) {
      base.unshift({ key: '_select', label: '', w: 32, fixed: true, toggleable: false });
    }
    return base;
  }, [bulkMassMode, bulkColVisible]);
  const [showBulkColMenu, setShowBulkColMenu] = useState(false);
  const getBulkColWidth = (key) => bulkColWidths[key] || BULK_COLS.find(c => c.key === key)?.w || 120;
  const toggleBulkColVisible = useCallback((key) => {
    setBulkColVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persistBulkColVisible(next);
      return next;
    });
  }, []);
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
      setBulkColWidths(prev => { persistBulkColWidths(prev); return prev; });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [bulkColWidths]);
  const saveCompanyRule = useCallback((raw, canonical) => {
    const k = companyRuleKey(raw);
    const v = String(canonical || '').trim();
    if (!k || !v || k === v.toLowerCase()) return;
    setCompanyRules(prev => {
      if (prev[k] === v) return prev;
      const next = { ...prev, [k]: v };
      persistCompanyRules(next);
      return next;
    });
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
        const rep = findCol(r, ['CDM', 'Salesperson', 'Sales Rep', 'Account Owner', 'Owner', 'Rep', 'Assigned', 'Team Member']);
        if (!rep) continue;
        // Skip the current user's own entries — those are "your"
        // accounts, not Other Reps.
        if (matchesCdm(rep, cdmName)) continue;
        out.push({ company: company.trim(), rep: rep.trim() });
      }
    }
    return out;
  }, [targetAccountsData, cdmName]);

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
  const { domainToProspect, prospectDomains, tokenToProspect, prospectCompactPrefixMap, prospectCompactPrefixesDesc } = useMemo(() => {
    const dToP = new Map();
    const pDoms = new Map();
    const tToP = new Map();
    const compactToP = new Map();
    function recordDomain(p, domain) {
      if (!domain || !p.company) return;
      dToP.set(domain, p);
      const key = p.company.toLowerCase();
      if (!pDoms.has(key)) pDoms.set(key, new Set());
      pDoms.get(key).add(domain);
    }
    for (const p of prospects) {
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

  // Look up match details for a single row based on the current prospects snapshot.
  // Used both during initial enrichment AND at render time so the columns refresh
  // after the prospect's emailDomain is auto-patched.
  const lookupMatch = useCallback((email) => {
    const at = email.lastIndexOf('@');
    const domain = at >= 0 ? email.slice(at + 1).toLowerCase() : '';
    let matched = domain ? domainToProspect.get(domain) : null;
    const wasExactMatch = !!matched;
    if (!matched && domain) {
      const token = extractBrandToken(domain);
      if (token && token.length >= 3) matched = tokenToProspect.get(token) || null;
      // Still no hit? Try the compact-prefix map so "lplfinancial"
      // (domain brand) resolves to "LPL Financial" (prospect whose
      // first-two-token compact form is "lplfinancial"). Supports
      // prefix-match in either direction, longest wins.
      if (!matched && token && token.length >= 3) {
        if (prospectCompactPrefixMap.has(token)) {
          matched = prospectCompactPrefixMap.get(token);
        } else {
          for (const key of prospectCompactPrefixesDesc) {
            if (key.length < 5) break;
            if (token.startsWith(key) || key.startsWith(token)) {
              matched = prospectCompactPrefixMap.get(key);
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
    return { domain, matched, wasExactMatch, suggestedCompany, companyDomains };
  }, [domainToProspect, prospectDomains, tokenToProspect, prospectCompactPrefixMap, prospectCompactPrefixesDesc]);

  const enrichRow = useCallback((r) => {
    const { domain, matched, wasExactMatch } = lookupMatch(r.email);
    // Only guess name parts if the parsed row didn't already carry them from "Name <email>" drops.
    const nameGuess = (!r.firstname && !r.lastname) ? guessNameFromEmail(r.email) : { firstname: '', lastname: '' };
    // Initial Company value: match HubSpot's current value when the contact already exists
    // (even if blank — so user sees the real state). For brand-new contacts, leave blank so the
    // Suggested Company chip is an explicit opt-in rather than an auto-fill.
    const existing = hubspotByEmail.get(r.email);
    const initialCompany = r.company !== undefined && r.company !== null && r.company !== ''
      ? r.company
      : (existing ? (existing.company || '') : '');
    return {
      ...r,
      firstname: fixAllCapsName(r.firstname || nameGuess.firstname),
      lastname: fixAllCapsName(r.lastname || nameGuess.lastname),
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
        const existing = byEmail.get(p.email);
        if (!existing) {
          const er = enrichRow(p);
          byEmail.set(p.email, er);
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
          byEmail.set(p.email, refreshed);
        }
      }
      const next = Array.from(byEmail.values());
      saveCache(next);
      return next;
    });
    if (newlyEnriched.length > 0) patchProspectDomains(newlyEnriched);
  }, [enrichRow, patchProspectDomains, companyRules]);

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const dt = e.dataTransfer;
    const collected = [];

    // 1. Try plain text first — covers Outlook web drag, address-book drag, and most pastes.
    const text = dt.getData('text/plain') || dt.getData('text/html') || '';
    if (text) collected.push(...parseEmailHeaders(text));

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
        const matches = parseDroppedText(raw);
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
      mergeNewRows(parseEmailHeaders(text));
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
        mergeNewRows(parseEmailHeaders(text));
        return;
      }
      const mapping = autoMapHeaders(headers);
      setPendingUpload({ fileName: '(pasted from clipboard)', headers, rows: raw, mapping });
    } catch (err) {
      console.warn('Failed to parse pasted tabular data, falling back to email extraction', err);
      mergeNewRows(parseEmailHeaders(text));
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
  function clearAll() {
    if (!confirm('Clear all rows?')) return;
    setRows([]);
    setResults({});
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
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
    for (const c of BULK_COLS) {
      if (c.key === '_remove' || c.key === '_select') continue;
      if (!bulkColVisible.has(c.key)) continue;
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
      const live = lookupMatch(r.email);
      const prospect = r._matchedProspectId
        ? prospects.find(p => p.id === r._matchedProspectId)
        : null;
      const dismissed = dismissedSuggestedCompanies.has(r.email);

      let suggestedCompany = '';
      if (!dismissed && live.suggestedCompany) {
        suggestedCompany = (r.company === live.suggestedCompany) ? 'applied' : live.suggestedCompany;
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
  }, [rows, bulkColVisible, hubspotByEmail, results, lookupMatch, prospects, dismissedSuggestedCompanies, otherRepsByProspect, cdmName]);

  // Build a properties object of fields the user has supplied that are currently blank
  // on the existing HubSpot contact. Used to "fill in missing values" without overwriting
  // data that HubSpot already has.
  function missingFieldUpdates(row, existing) {
    if (!existing) return null;
    const firstname = fixAllCapsName(row.firstname);
    const lastname = fixAllCapsName(row.lastname);
    const patch = {};
    if (row.company && !existing.company) patch.company = row.company;
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

  async function addOne(row) {
    const firstname = fixAllCapsName(row.firstname);
    const lastname = fixAllCapsName(row.lastname);
    try {
      const properties = {
        email: row.email,
        firstname,
        lastname,
        company: row.company,
        phone: row.phone,
        jobtitle: row.jobtitle,
      };
      if (row.mobilePhone && row.mobilePhone.trim()) properties.mobilephone = row.mobilePhone.trim();
      if (row.linkedinUrl && row.linkedinUrl.trim()) properties.hs_linkedin_url = row.linkedinUrl.trim();
      if (row.city && row.city.trim()) properties.city = row.city.trim();
      if (row.state && row.state.trim()) properties.state = row.state.trim();
      if (row.country && row.country.trim()) properties.country = row.country.trim();
      if (row.dans_tags && row.dans_tags.trim()) properties.dans_tags = row.dans_tags.trim();
      const res = await fetch('/api/hubspot?action=create-contact', {
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
        return 'added';
      }
      return 'error: ' + (data.error || 'unknown');
    } catch (err) {
      return 'error: ' + (err.message || 'network');
    }
  }

  async function updateOne(row, existing, patch) {
    try {
      const res = await fetch('/api/hubspot?action=update-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: existing.id, properties: patch }),
      });
      const data = await res.json();
      if (data.success || data.contact) {
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
        return 'updated';
      }
      return 'error: ' + (data.error || 'unknown');
    } catch (err) {
      return 'error: ' + (err.message || 'network');
    }
  }

  async function addAll() {
    // Two parallel queues: create new contacts, and fill in missing fields on existing ones.
    const toCreate = rows.filter(r => !hubspotByEmail.has(r.email) && results[r.email] !== 'added');
    const toUpdate = [];
    for (const r of rows) {
      if (results[r.email] === 'added' || results[r.email] === 'updated') continue;
      const existing = hubspotByEmail.get(r.email);
      if (!existing) continue;
      const patch = missingFieldUpdates(r, existing);
      if (patch) toUpdate.push({ row: r, existing, patch });
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

  const newCount = rows.filter(r => !hubspotByEmail.has(r.email)).length;
  const updateCount = rows.filter(r => {
    const existing = hubspotByEmail.get(r.email);
    return !!existing && !!missingFieldUpdates(r, existing);
  }).length;
  const dupCount = rows.length - newCount;
  const addedCount = Object.values(results).filter(v => v === 'added').length;
  const updatedCount = Object.values(results).filter(v => v === 'updated').length;
  const errorCount = Object.values(results).filter(v => typeof v === 'string' && v.startsWith('error')).length;

  // Per-prospect inferences derived from the contact rows matched to
  // that prospect. Looks at each email's domain (ignoring free webmail)
  // to pick the dominant company domain, and compares each email's
  // local-part to the contact's firstname/lastname to pick the dominant
  // naming pattern (firstname.lastname, flastname, etc.). The winners
  // become the Website + Email Domain suggestions for that prospect.
  const inferredSuggestions = useMemo(() => {
    const byProspect = new Map();
    for (const r of rows) {
      if (!r._matchedProspectId) continue;
      if (!byProspect.has(r._matchedProspectId)) {
        byProspect.set(r._matchedProspectId, { domains: new Map(), patterns: new Map() });
      }
      const bucket = byProspect.get(r._matchedProspectId);
      const email = String(r.email || '').toLowerCase();
      const at = email.lastIndexOf('@');
      if (at <= 0) continue;
      const domain = email.slice(at + 1);
      if (domain && !FREE_MAIL_DOMAINS.has(domain)) {
        bucket.domains.set(domain, (bucket.domains.get(domain) || 0) + 1);
      }
      const pattern = detectLocalPattern(email, r.firstname, r.lastname);
      if (pattern) bucket.patterns.set(pattern, (bucket.patterns.get(pattern) || 0) + 1);
    }
    const out = new Map();
    for (const [pid, { domains, patterns }] of byProspect) {
      const dominantDomain = pickDominantKey(domains);
      const dominantPattern = pickDominantKey(patterns);
      out.set(pid, {
        website: dominantDomain || null,
        // Only suggest an emailDomain entry when we have a naming
        // pattern. A bare domain like "acme.com" would just duplicate
        // the company website and isn't useful in Table View — we
        // skip it so the user sees patterns like "firstname.lastname
        // @acme.com" only.
        emailDomain: dominantDomain && dominantPattern
          ? `${dominantPattern}@${dominantDomain}`
          : null,
        // zoomCompanyId / zoomCompanyName cannot be inferred from emails — upload only.
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
        const live = lookupMatch(r.email);
        return live.suggestedCompany
          && r.company !== live.suggestedCompany
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
          case 'status':           return hubspotByEmail.has(r.email) ? 'in hubspot' : 'new';
          case 'firstname':        return r.firstname || '';
          case 'lastname':         return r.lastname || '';
          case 'company':          return r.company || '';
          case 'jobtitle':         return r.jobtitle || '';
          case 'suggestedCompany': return lookupMatch(r.email).suggestedCompany || '';
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
          case 'status':           return hubspotByEmail.has(r.email) ? 'In HubSpot' : 'New';
          case 'firstname':        return r.firstname || '';
          case 'lastname':         return r.lastname || '';
          case 'company':          return r.company || '';
          case 'suggestedCompany': return lookupMatch(r.email).suggestedCompany || '';
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
  }, [rows, tvMissingOnly, columnFilters, sortKey, sortDir, rowTableViewState, lookupMatch, suggestionFor, dismissedSuggestedCompanies, hubspotByEmail, prospects, bulkColTextFilters]);

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
    if (!onUpdateProspect || !prospect || !fieldKey || !value) return;
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
          return;
        }
        patchValue = [...existing, value].join('\n');
      }
      await onUpdateProspect(prospect.id, { [fieldKey]: patchValue });
      setCellApplyState(prev => ({ ...prev, [key]: 'applied' }));
      setTimeout(() => setCellApplyState(prev => { const n = { ...prev }; delete n[key]; return n; }), 1500);
    } catch {
      setCellApplyState(prev => ({ ...prev, [key]: 'error' }));
      setTimeout(() => setCellApplyState(prev => { const n = { ...prev }; delete n[key]; return n; }), 2500);
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

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Bulk Add Contacts</h2>
          <div className={styles.subtitle}>Drop emails from Outlook here — extract addresses, edit details, push to HubSpot in one go.</div>
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
            Sheet drops <em>and</em> tab-separated pastes (⌘V / Ctrl+V) show a column-mapping preview. Plain-text drops / pastes fall back to email-address extraction.
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
                    {prospect.company || '—'}
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
                      return <div key={f.key} style={{ color: '#CBD5E1', alignSelf: 'center' }}>—</div>;
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
            No contacts yet. Drag a sheet, paste tab-separated rows (⌘V / Ctrl+V), or click and paste here — same column-mapping preview as the box above.
          </div>
        ) : activeTab === 'contacts' && (
          <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', margin: '0.75rem 0 0.25rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={busy || (newCount === 0 && updateCount === 0)}
                onClick={addAll}
                title={
                  newCount === 0 && updateCount === 0
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
              {bulkMassMode && bulkSelected.size > 0 && (
                <>
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
              )}
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowBulkColMenu(v => !v)}
                  title="Show / hide table columns"
                  style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff', color: 'var(--color-text-secondary)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                  Columns <span style={{ opacity: 0.7 }}>({bulkColVisible.size}/{BULK_COLS.length})</span>
                </button>
                {showBulkColMenu && (
                  <div
                    style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 600, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', minWidth: 220, maxHeight: 360, overflow: 'auto', padding: '0.4rem 0.5rem', fontSize: '0.72rem' }}
                    onClick={e => e.stopPropagation()}
                  >
                    {BULK_COLS.map(c => {
                      const disabled = c.toggleable === false;
                      return (
                        <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 2px', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
                          <input
                            type="checkbox"
                            checked={bulkColVisible.has(c.key)}
                            disabled={disabled}
                            onChange={() => toggleBulkColVisible(c.key)}
                          />
                          <span>{c.label || '(action)'}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
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
                                title={filterOn ? 'Showing only rows with a suggestion — click to show all' : 'Show only rows with a suggestion'}
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
                {visibleRows.map(r => {
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
                  if (exists && outcome !== 'updated' && missingFieldUpdates(r, hubspotContact)) {
                    statusLabel = 'Update pending';
                    statusClass = styles.statusUpdatePending;
                  }
                  const live = lookupMatch(r.email);
                  const currentHsCompany = hubspotContact?.company?.trim() || '';
                  const tvState = rowTableViewState(r);
                  const prospect = r._matchedProspectId ? prospects.find(p => p.id === r._matchedProspectId) : null;
                  const renderTv = (fieldKey) => {
                    if (!tvState) return <span className={styles.metaText}>—</span>;
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
                  return (
                    <tr key={r.email}>
                      {bulkMassMode && (
                        <td>
                          <input
                            type="checkbox"
                            checked={bulkSelected.has(r.email)}
                            onChange={() => toggleBulkSelect(r.email)}
                            style={{ accentColor: 'var(--color-accent)' }}
                          />
                        </td>
                      )}
                      {bulkColVisible.has('_remove') && <td><button className={styles.rowRemove} onClick={() => removeRow(r.email)} title="Remove row">×</button></td>}
                      {bulkColVisible.has('email') && <td className={styles.emailCell}>{r.email}</td>}
                      {bulkColVisible.has('status') && <td><span className={`${styles.statusPill} ${statusClass}`}>{statusLabel}</span></td>}
                      {bulkColVisible.has('firstname') && <td><input className={styles.cellInput} value={r.firstname} onChange={e => updateRow(r.email, { firstname: e.target.value })} /></td>}
                      {bulkColVisible.has('lastname') && <td><input className={styles.cellInput} value={r.lastname} onChange={e => updateRow(r.email, { lastname: e.target.value })} /></td>}
                      {bulkColVisible.has('jobtitle') && <td><input className={styles.cellInput} value={r.jobtitle} onChange={e => updateRow(r.email, { jobtitle: e.target.value })} /></td>}
                      {bulkColVisible.has('company') && <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            className={styles.cellInput}
                            value={r.company}
                            onChange={e => updateRow(r.email, { company: e.target.value, _companyFromRule: false })}
                            list="bulk-contacts-company-list"
                            autoComplete="off"
                          />
                          {r._companyFromRule && (
                            <span title="Applied from a saved rule" style={{ fontSize: '0.72rem', color: '#F59E0B' }}>★</span>
                          )}
                        </div>
                        {exists && (
                          currentHsCompany ? (
                            <div className={styles.hsCompanyHint} title="Currently stored in HubSpot">
                              HubSpot: {currentHsCompany}
                            </div>
                          ) : (
                            <div className={styles.hsCompanyMissing} title="HubSpot has no company value for this contact">
                              HubSpot: no company listed
                            </div>
                          )
                        )}
                      </td>}
                      {bulkColVisible.has('tier') && <td>{(() => {
                        // Dismissing the suggested company means "I don't
                        // trust this match" — so the Tier badge that
                        // came from the matched prospect should hide
                        // alongside the dismissed pill.
                        if (dismissedSuggestedCompanies.has(r.email)) return <span className={styles.metaText}>—</span>;
                        if (!prospect) return <span className={styles.metaText}>—</span>;
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
                          return <span className={styles.metaText}>—</span>;
                        }
                        const colors = t === 'Tier 1' ? { bg: '#DBEAFE', color: '#1E40AF' }
                          : t === 'Tier 2' ? { bg: '#FEF3C7', color: '#92400E' }
                          : { bg: '#F3F4F6', color: '#6B7280' };
                        return <span style={{ padding: '1px 6px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 600, background: colors.bg, color: colors.color }}>{t}</span>;
                      })()}</td>}
                      {bulkColVisible.has('cdmReps') && <td>{(() => {
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
                        if (dismissedSuggestedCompanies.has(r.email)) return <span className={styles.metaText}>—</span>;
                        if (!prospect) return <span className={styles.metaText}>—</span>;
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
                        if (!cdm && dedupedReps.length === 0) return <span className={styles.metaText}>—</span>;
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
                      })()}</td>}
                      {bulkColVisible.has('suggestedCompany') && <td className={styles.suggestCell}>
                        {(() => {
                          const sc = live.suggestedCompany;
                          if (!sc) return <span className={styles.metaText}>—</span>;
                          if (r.company === sc) {
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
                          return (
                            <span
                              title={sc}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px 1px 8px', background: '#FEF9C3', border: '1px solid #FACC15', borderRadius: 999, fontSize: '0.68rem', fontWeight: 600, color: '#854D0E', maxWidth: '100%' }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{sc}</span>
                              <button
                                type="button"
                                title="Use this as Company"
                                onClick={() => {
                                  saveCompanyRule(r.company, sc);
                                  updateRow(r.email, { company: sc });
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
                      </td>}
                      {bulkColVisible.has('website') && <td>{renderTv('website')}</td>}
                      {bulkColVisible.has('zoomCompanyId') && <td>{renderTv('zoomCompanyId')}</td>}
                      {bulkColVisible.has('zoomCompanyName') && <td>{renderTv('zoomCompanyName')}</td>}
                      {bulkColVisible.has('emailDomain') && <td>{renderTv('emailDomain')}</td>}
                      {bulkColVisible.has('dans_tags') && <td><input className={styles.cellInput} value={r.dans_tags || ''} onChange={e => updateRow(r.email, { dans_tags: e.target.value })} placeholder="Tag1, Tag2" /></td>}
                      {bulkColVisible.has('phone') && <td><input className={styles.cellInput} value={r.phone} onChange={e => updateRow(r.email, { phone: e.target.value })} /></td>}
                      {bulkColVisible.has('mobilePhone') && <td><input className={styles.cellInput} value={r.mobilePhone || ''} onChange={e => updateRow(r.email, { mobilePhone: e.target.value })} /></td>}
                      {bulkColVisible.has('linkedinUrl') && <td style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input className={styles.cellInput} value={r.linkedinUrl || ''} onChange={e => updateRow(r.email, { linkedinUrl: e.target.value })} placeholder="linkedin.com/in/…" />
                        {r.linkedinUrl && (
                          <a href={ensureProtocol(r.linkedinUrl)} target="_blank" rel="noopener noreferrer" title={r.linkedinUrl} style={{ fontSize: '0.72rem', color: 'var(--color-accent)', textDecoration: 'none' }}>↗</a>
                        )}
                      </td>}
                      {bulkColVisible.has('city') && <td><input className={styles.cellInput} value={r.city || ''} onChange={e => updateRow(r.email, { city: e.target.value })} /></td>}
                      {bulkColVisible.has('state') && <td><input className={styles.cellInput} value={r.state || ''} onChange={e => updateRow(r.email, { state: e.target.value })} /></td>}
                      {bulkColVisible.has('country') && <td><input className={styles.cellInput} value={r.country || ''} onChange={e => updateRow(r.email, { country: e.target.value })} /></td>}
                      {bulkColVisible.has('notes') && <td><input className={styles.cellInput} value={r.notes || ''} onChange={e => updateRow(r.email, { notes: e.target.value })} placeholder="Free-form note" /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

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
                Updates the selected rows in the grid only — push them to HubSpot via Send to HubSpot afterwards.
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

      {pendingUpload && (() => {
        const { fileName, headers, rows: rawRows, mapping } = pendingUpload;
        const sampleRow = rawRows[0] || {};
        const mappedFieldCounts = {};
        for (const v of Object.values(mapping)) if (v) mappedFieldCounts[v] = (mappedFieldCounts[v] || 0) + 1;
        const hasEmail = Object.values(mapping).includes('email');
        const hasDuplicate = Object.values(mappedFieldCounts).some(n => n > 1);
        const updateCell = (header, fieldKey) => {
          setPendingUpload(prev => prev ? { ...prev, mapping: { ...prev.mapping, [header]: fieldKey } } : prev);
        };
        const cancel = () => setPendingUpload(null);
        const confirmImport = () => {
          if (!hasEmail) { alert('At least one column must map to Email before importing.'); return; }
          if (hasDuplicate) { alert('Each field can only be mapped to one column. Set duplicates to Ignore first.'); return; }
          const parsed = applyMappingToRows(rawRows, mapping);
          if (parsed.length === 0) {
            alert('No rows had a valid Email — nothing to import.');
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
                  <strong>{rawRows.length}</strong> row{rawRows.length === 1 ? '' : 's'} from <em>{fileName}</em> — confirm each column maps to the right field, then import.
                </div>
                {!hasEmail && (
                  <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 6, fontSize: '0.75rem' }}>
                    A column must map to <strong>Email</strong> before you can import.
                  </div>
                )}
                {hasDuplicate && (
                  <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#FFFBEB', border: '1px solid #FCD34D', color: '#854D0E', borderRadius: 6, fontSize: '0.75rem' }}>
                    Some fields are mapped by more than one column. Only one mapping can win — set duplicates to "Ignore".
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
                <button type="button" onClick={confirmImport} disabled={!hasEmail || hasDuplicate} style={{ padding: '0.45rem 0.9rem', border: 'none', background: (!hasEmail || hasDuplicate) ? '#94A3B8' : 'var(--color-accent)', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: (!hasEmail || hasDuplicate) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>Import {rawRows.length} row{rawRows.length === 1 ? '' : 's'}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
