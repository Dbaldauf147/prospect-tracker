// Events subtab — event-centric attendee lists. Each event holds a
// name / date / location / notes plus a saved list of attendees. The
// attendee picker searches the synced HubSpot contacts cache (the same
// roster the other Contacts subtabs read from) so you can build the
// list straight from your contacts; people who aren't in HubSpot can be
// added as free-text "manual" attendees.
//
// Events persist in Firestore settings under `settings.events`, so they
// sync across devices the same way the per-contact Events log, contact
// notes, and the other Contacts-page settings do.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../utils/apiFetch';
import { getHubspotCache, updateHubspotCache } from '../../utils/hubspotContactsCache';
import { attendeeFromContact, contactDisplayName } from '../../utils/eventsStore';
import { companyDedupeKey } from '../../utils/firestoreSync';
import { buildTypeOptions } from '../../utils/prospectOptions';
import styles from './EventsView.module.css';

// Inline Type dropdown for a matched Table View prospect — the same
// options as the Table View's Type column, off the Dropdowns-tab list.
// Commits immediately on change so the lookup list can set/correct Type
// without leaving Events.
function TypeCell({ prospect, options = [], onCommit }) {
  if (!prospect) return <span className={styles.tvMuted}>-</span>;
  const value = prospect.type || '';
  return (
    <select
      className={styles.cdmInput}
      value={value}
      onChange={e => onCommit(e.target.value)}
    >
      <option value="">-</option>
      {/* A Type this company carries that has since left the list stays
          selectable, so opening the cell can't silently blank it. */}
      {value && !options.includes(value) && <option value={value}>{value}</option>}
      {options.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

// Inline-editable CDM cell for a matched Table View prospect. Seeds
// from the prospect's stored CDM and commits on blur / Enter, so the
// user can edit Table View data straight from the lookup list.
function CdmCell({ prospect, onCommit }) {
  const [val, setVal] = useState(prospect?.cdm || '');
  useEffect(() => { setVal(prospect?.cdm || ''); }, [prospect?.id, prospect?.cdm]);
  if (!prospect) return <span className={styles.tvMuted}>-</span>;
  const commit = () => {
    const next = val.trim();
    if (next !== String(prospect.cdm || '').trim()) onCommit(next);
  };
  return (
    <input
      className={styles.cdmInput}
      value={val}
      placeholder="CDM…"
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
    />
  );
}

// Inline-editable Name cell for a lookup row. The name isn't usually in
// the pasted title/company data, so this lets the user record the person
// they find on LinkedIn. Commits on blur / Enter back onto the row.
function LookupNameCell({ value, onCommit }) {
  const [val, setVal] = useState(value || '');
  useEffect(() => { setVal(value || ''); }, [value]);
  const commit = () => {
    const next = val.trim();
    if (next !== String(value || '').trim()) onCommit(next);
  };
  return (
    <input
      className={styles.cdmInput}
      value={val}
      placeholder="Name…"
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
    />
  );
}

// Suggested-company cell for an unmatched lookup row. Surfaces the fuzzy
// match (if any, and not rejected) with actions to Use it (rewrite the
// row's company to the canonical Table View name), Reject it, or open a
// predictive search over every Table View company to pick a different
// mapping. Kept narrow — the name wraps instead of stretching the column.
function SuggestedCell({ rejected, suggestion, prospectCompanies, onAccept, onReject }) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!searching) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) { setSearching(false); setQuery(''); } }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [searching]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const pre = [];
    const sub = [];
    for (const name of prospectCompanies) {
      const n = name.toLowerCase();
      if (n.startsWith(q)) pre.push(name);
      else if (n.includes(q)) sub.push(name);
      if (pre.length + sub.length >= 40) break;
    }
    return [...pre, ...sub].slice(0, 20);
  }, [query, prospectCompanies]);

  const showSuggestion = suggestion && !rejected;
  const pick = (name) => { onAccept(name); setSearching(false); setQuery(''); };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {showSuggestion ? (
        <>
          <span className={styles.suggestName} title={suggestion.company}>≈ {suggestion.company}</span>
          <div className={styles.suggestBtns}>
            <button type="button" className={styles.suggestUse} onClick={() => pick(suggestion.company)} title="Use this name: rewrites this row's company to the Table View name">✓ Use</button>
            <button type="button" className={styles.suggestReject} onClick={onReject} title="Reject this suggestion">✕</button>
            <button type="button" className={styles.suggestSearchBtn} onClick={() => setSearching(s => !s)} title="Search for a different company">🔍</button>
          </div>
        </>
      ) : (
        <button type="button" className={styles.suggestSearchBtn} onClick={() => setSearching(true)} title="Search Table View companies to map this row">🔍 Search</button>
      )}
      {searching && (
        <div className={styles.dropdown} style={{ minWidth: 220 }}>
          <div style={{ padding: '0.3rem 0.4rem', borderBottom: '1px solid var(--color-border)' }}>
            <input
              autoFocus
              value={query}
              placeholder="Search Table View companies…"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && matches[0]) { e.preventDefault(); pick(matches[0]); }
                else if (e.key === 'Escape') { setSearching(false); setQuery(''); }
              }}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: '0.76rem', padding: '4px 6px', fontFamily: 'inherit', border: '1px solid var(--color-border)', borderRadius: 4 }}
            />
          </div>
          {query.trim() && matches.length === 0 ? (
            <div style={{ padding: '0.5rem 0.6rem', fontSize: '0.74rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No Table View company matches.</div>
          ) : matches.map(name => (
            <button key={name} type="button" className={styles.option} onClick={() => pick(name)}>
              <div className={styles.optionName}>{name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function newId() {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Normalize a company name for fuzzy matching: drop parentheticals,
// strip common corporate suffixes, and collapse to lowercase tokens.
const COMPANY_SUFFIX_RE = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|holdings|group|grp)\b\.?/g;
function normalizeCompany(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(COMPANY_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Filterable columns for the two Events tables (keys map to the value
// pulled for each row in the filter predicates below).
const ATT_FILTER_KEYS = ['name', 'originalTitle', 'title', 'company', 'email', 'tags'];
const LOOKUP_FILTER_KEYS = ['name', 'title', 'company', 'tableView', 'type', 'cdm'];

// HubSpot stores Dan's Tags as a single semicolon-separated string.
// Split it into a clean list of individual tags.
function parseTags(str) {
  return String(str || '').split(';').map(s => s.trim()).filter(Boolean);
}

// Pull the current Dan's Tags off a cached HubSpot contact record,
// tolerating the property's a few historical field spellings.
function contactTags(contact) {
  return parseTags(contact?.dans_tags || contact?.dan_s_tags || contact?.dans_tag || '');
}
// A contact is a "decision maker" when its Dan's Tags include that tag —
// the same convention the Prospect modal / Progress / PE views use.
function isDecisionMaker(contact) {
  return contactTags(contact).some(t => t.toLowerCase() === 'decision maker');
}

// ---- Email domain detection & guessing ---------------------------
// Free / personal mail providers — these never count as a company's
// email domain (and aren't used to guess a colleague's address).
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com',
  'proton.me', 'gmx.com', 'mail.com', 'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
]);

function emailDomain(email) {
  const m = /@([^@\s]+)$/.exec(String(email || '').trim().toLowerCase());
  return m ? m[1] : '';
}
const cleanNamePart = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');

// Infer the dominant local-part pattern (e.g. first.last) from sample
// {email, first, last} records whose domain matches `domain`.
function inferEmailPattern(samples, domain) {
  const counts = new Map();
  for (const s of samples) {
    if (domain && emailDomain(s.email) !== domain) continue;
    const local = s.email.split('@')[0];
    const f = cleanNamePart(s.first);
    const l = cleanNamePart(s.last);
    if (!f || !l) continue;
    const fi = f[0];
    const li = l[0];
    let pat = null;
    if (local === `${f}.${l}`) pat = '{f}.{l}';
    else if (local === `${f}${l}`) pat = '{f}{l}';
    else if (local === `${fi}${l}`) pat = '{fi}{l}';
    else if (local === `${fi}.${l}`) pat = '{fi}.{l}';
    else if (local === `${f}.${li}`) pat = '{f}.{li}';
    else if (local === `${f}_${l}`) pat = '{f}_{l}';
    else if (local === `${l}.${f}`) pat = '{l}.{f}';
    else if (local === `${l}${f}`) pat = '{l}{f}';
    if (pat) counts.set(pat, (counts.get(pat) || 0) + 1);
  }
  let best = '{f}.{l}';
  let bestN = 0;
  for (const [p, n] of counts) if (n > bestN) { bestN = n; best = p; }
  return best;
}

// Build a guessed address from a name + domain + inferred pattern.
function buildGuessedEmail(first, last, domain, pattern) {
  if (!domain) return '';
  const f = cleanNamePart(first);
  const l = cleanNamePart(last);
  const fi = f.slice(0, 1);
  const li = l.slice(0, 1);
  let local;
  switch (pattern) {
    case '{f}{l}': local = `${f}${l}`; break;
    case '{fi}{l}': local = `${fi}${l}`; break;
    case '{fi}.{l}': local = fi && l ? `${fi}.${l}` : ''; break;
    case '{f}.{li}': local = f && li ? `${f}.${li}` : ''; break;
    case '{f}_{l}': local = f && l ? `${f}_${l}` : ''; break;
    case '{l}.{f}': local = l && f ? `${l}.${f}` : ''; break;
    case '{l}{f}': local = `${l}${f}`; break;
    case '{f}.{l}':
    default: local = f && l ? `${f}.${l}` : (f || l); break;
  }
  return local ? `${local}@${domain}` : '';
}

// Convert a search-list entry to a stored attendee. Manually-created
// pseudo-contacts (flagged `_manual`) are saved back as manual
// attendees (no contactId) so they de-dupe by name against the original
// rather than minting a parallel id-bearing copy.
function contactToAttendee(c) {
  if (c && c._manual) {
    return { contactId: '', name: contactDisplayName(c), email: c.email || '', company: c.company || '', title: c.jobtitle || '' };
  }
  return attendeeFromContact(c);
}

function formatDate(iso) {
  if (!iso) return '';
  // iso is a yyyy-mm-dd string from <input type="date">. Render it
  // without going through Date() so timezones don't shift the day.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// LinkedIn people-search deep link for a title + company. Opening it
// runs the search in the browser so the user can spot and connect with
// the actual person.
function linkedInSearchUrl(title, company) {
  const kw = [title, company].map(s => String(s || '').trim()).filter(Boolean).join(' ');
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(kw)}`;
}

// Split one delimited line into fields, honoring double-quoted values
// so a company like "Smith, Jones & Co" pasted from a sheet stays in
// one cell. Tabs win over commas when both are present (sheet pastes
// are tab-separated).
function splitLine(line) {
  const delim = line.includes('\t') ? '\t' : ',';
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// Parse pasted / uploaded text into a grid of cells (rows × columns),
// making no assumption about which column is which — the column-mapping
// modal decides that. Accepts CSV or TSV.
function parseGrid(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(splitLine);
}

// Fields a lookup row can hold, in the order they're offered in the
// column-mapping dropdowns.
const LOOKUP_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'title', label: 'Title' },
  { key: 'company', label: 'Company' },
];

// Does this row look like a header (column names) rather than data?
function looksLikeHeader(cells) {
  const lc = (cells || []).map(c => String(c || '').toLowerCase());
  const hasTitle = lc.some(c => /\b(title|role|position)\b/.test(c));
  const hasCompany = lc.some(c => /company|account|organi[sz]ation|employer/.test(c));
  const hasName = lc.some(c => /\bname\b/.test(c));
  return hasTitle || hasCompany || hasName;
}

// Best-guess mapping of source columns → lookup fields. Uses header text
// when present, then falls back to position (first column → Title,
// second → Company) for any essential field still unmapped.
function guessLookupMapping(headerCells, hasHeader, columnCount) {
  const mapping = Array(columnCount).fill('');
  const used = new Set();
  if (hasHeader) {
    (headerCells || []).forEach((h, idx) => {
      if (idx >= columnCount) return;
      const lc = String(h || '').toLowerCase();
      if (!used.has('company') && /company|account|organi[sz]ation|employer/.test(lc)) {
        mapping[idx] = 'company'; used.add('company');
      } else if (!used.has('title') && /\b(title|role|position)\b/.test(lc)) {
        mapping[idx] = 'title'; used.add('title');
      } else if (!used.has('name') && /\bname\b/.test(lc)) {
        mapping[idx] = 'name'; used.add('name');
      }
    });
  }
  // Fill essentials still unmapped by position (Title first, then Company).
  for (const field of ['title', 'company']) {
    if (used.has(field)) continue;
    const idx = mapping.findIndex(m => m === '');
    if (idx !== -1) { mapping[idx] = field; used.add(field); }
  }
  return mapping;
}

// Search box that surfaces matching HubSpot contacts and lets the user
// add either a matched contact or a free-text manual attendee.
function AttendeePicker({ contacts, existingIds, onAdd }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const c of contacts) {
      const id = String(c.id || c.vid || '');
      if (!id || existingIds.has(id)) continue;
      const hay = `${contactDisplayName(c)} ${c.email || ''} ${c.company || ''} ${c.jobtitle || ''}`.toLowerCase();
      if (hay.includes(q)) out.push(c);
      if (out.length >= 40) break;
    }
    return out;
  }, [query, contacts, existingIds]);

  function addContact(c) {
    onAdd(contactToAttendee(c));
    setQuery('');
    setOpen(false);
  }

  function addManual() {
    const name = query.trim();
    if (!name) return;
    onAdd({ contactId: '', name, email: '', company: '', title: '' });
    setQuery('');
    setOpen(false);
  }

  return (
    <div className={styles.picker} ref={wrapRef}>
      <input
        className={styles.input}
        style={{ width: '100%', boxSizing: 'border-box' }}
        value={query}
        placeholder="Search contacts by name, email, or company to add…"
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (matches[0]) addContact(matches[0]);
            else addManual();
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && query.trim() && (
        <div className={styles.dropdown}>
          {matches.map(c => (
            <button
              key={String(c.id || c.vid)}
              type="button"
              className={styles.option}
              onClick={() => addContact(c)}
            >
              <div className={styles.optionName}>{contactDisplayName(c)}</div>
              <div className={styles.optionMeta}>
                {[c.jobtitle, c.company, c.email].filter(Boolean).join(' · ') || '-'}
              </div>
            </button>
          ))}
          <button
            type="button"
            className={`${styles.option} ${styles.addManual}`}
            onClick={addManual}
          >
            + Add "{query.trim()}" as a manual attendee
          </button>
        </div>
      )}
    </div>
  );
}

// Modal roster picker for one company — the Opps 2 "+ Add from
// <company>" flow as a popup: search the HubSpot contacts on file for
// that company, toggle them on/off the attendee list, or add someone
// manually when nobody matches. Rendered in a portal so it isn't
// clipped by the table's scroll container.
function ContactPickerModal({ company, title, contacts, attendees, onAdd, onRemove, onClose }) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const companyNorm = useMemo(() => normalizeCompany(company), [company]);
  const roster = useMemo(() => {
    if (!companyNorm) return [];
    const out = [];
    for (const c of contacts) {
      const cn = normalizeCompany(c.company);
      if (!cn) continue;
      if (cn === companyNorm || cn.includes(companyNorm) || companyNorm.includes(cn)) out.push(c);
    }
    return out;
  }, [contacts, companyNorm]);

  const addedAtt = useMemo(() => {
    const byId = new Map();
    const byName = new Map();
    for (const a of (attendees || [])) {
      if (a.contactId) byId.set(String(a.contactId), a);
      byName.set(String(a.name || '').toLowerCase(), a);
    }
    return { byId, byName };
  }, [attendees]);
  const attendeeFor = (c) => addedAtt.byId.get(String(c.id || c.vid || '')) || addedAtt.byName.get(contactDisplayName(c).toLowerCase()) || null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    const pre = [];
    const sub = [];
    for (const c of roster) {
      const name = contactDisplayName(c).toLowerCase();
      const email = String(c.email || '').toLowerCase();
      if (name.startsWith(q)) pre.push(c);
      else if (name.includes(q) || email.includes(q)) sub.push(c);
    }
    return [...pre, ...sub];
  }, [roster, query]);

  function addManual() {
    const name = query.trim();
    if (!name) return;
    onAdd({ contactId: '', name, email: '', company: company || '', title: title || '', originalTitle: title || '' });
    setQuery('');
  }

  return createPortal(
    <div className={styles.modalOverlay} onMouseDown={onClose}>
      <div className={styles.modalPanel} onMouseDown={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span>Add contacts from <strong>{company || 'this company'}</strong></span>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div style={{ padding: '0.6rem 0.8rem' }}>
          <input
            autoFocus
            className={styles.input}
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={query}
            placeholder="Filter or type a name to add manually…"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && matches.length === 0) { e.preventDefault(); addManual(); } }}
          />
        </div>
        <div className={styles.modalList}>
          {matches.length === 0 ? (
            <div style={{ padding: '0.6rem 0.8rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
              {roster.length === 0
                ? 'No HubSpot contacts on file for this company yet.'
                : 'No contacts match your filter.'}
              {query.trim() && (
                <button type="button" className={styles.modalManualBtn} onClick={addManual}>
                  + Add "{query.trim()}" manually
                </button>
              )}
            </div>
          ) : matches.map(c => {
            const att = attendeeFor(c);
            return (
              <button
                key={String(c.id || c.vid)}
                type="button"
                className={styles.modalRow}
                onClick={() => (att ? onRemove(att) : onAdd({ ...contactToAttendee(c), originalTitle: title || '' }))}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div className={styles.optionName}>{contactDisplayName(c)}</div>
                  <div className={styles.optionMeta}>{[c.jobtitle, c.email].filter(Boolean).join(' · ') || '-'}</div>
                </span>
                <span className={att ? styles.modalTagged : styles.modalAddTag}>{att ? '✓ Added' : '+ Add'}</span>
              </button>
            );
          })}
        </div>
        {query.trim() && matches.length > 0 && (
          <button type="button" className={styles.modalManualBtn} style={{ margin: '0 0.8rem 0.7rem' }} onClick={addManual}>
            + Add "{query.trim()}" as a manual contact
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Per-row Add Contact cell: a button that opens the company roster
// popup. Once a contact for this company is added, the whole row drops
// out of the worklist (handled by the parent), so no inline chips.
function RowContactAdder({ company, title, contacts, attendees, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <button type="button" className={styles.addContactBtn} onClick={() => setOpen(true)}>
        + Add contact
      </button>
      {open && (
        <ContactPickerModal
          company={company}
          title={title}
          contacts={contacts}
          attendees={attendees}
          onAdd={onAdd}
          onRemove={onRemove}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// Read-only details popup for a mapped attendee. Merges the stored
// attendee fields (original title kept from the lookup row) with the
// full cached HubSpot contact record when one was matched, so phone /
// LinkedIn / location surface even though the attendee row only saves a
// slim subset.
function AttendeeContactModal({ attendee, contact, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = contact ? contactDisplayName(contact) : (attendee.name || 'Contact');
  const contactTitle = contact?.jobtitle || attendee.title || '';
  const company = contact?.company || attendee.company || '';
  const email = contact?.email || attendee.email || '';
  const phone = contact?.phone || '';
  const linkedin = contact?.hs_linkedin_url || contact?.linkedin_url || contact?.hs_linkedinid || '';
  const location = [contact?.city, contact?.state, contact?.country].filter(Boolean).join(', ');
  const tags = contactTags(contact);

  const rows = [
    ['Original title', attendee.originalTitle || '-'],
    ['Contact title', contactTitle || '-'],
    ['Company', company || '-'],
    ['Email', email ? <a href={`mailto:${email}`}>{email}</a> : '-'],
    ['Phone', phone || '-'],
    ['Location', location || '-'],
    ['LinkedIn', linkedin ? <a href={linkedin} target="_blank" rel="noopener noreferrer">View profile</a> : '-'],
    ['Tags', tags.length ? (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
        {tags.map(t => <span key={t} className={styles.tagChip}>{t}</span>)}
      </span>
    ) : '-'],
  ];

  return createPortal(
    <div className={styles.modalOverlay} onMouseDown={onClose}>
      <div className={styles.modalPanel} onMouseDown={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span>
            <strong>{name}</strong>
            {!attendee.contactId && (
              <span style={{ marginLeft: 6, fontSize: '0.7rem', fontWeight: 400, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                (manual: not in HubSpot)
              </span>
            )}
          </span>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div style={{ padding: '0.7rem 0.9rem' }}>
          <table className={styles.contactDetailTable}>
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!contact && attendee.contactId && (
            <div style={{ marginTop: '0.6rem', fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
              The full contact record isn't in the synced HubSpot cache right now: showing the details saved with this event.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Column-mapping popup shown when data is dropped / pasted / uploaded
// into the lookup list. The user maps each source column to a lookup
// field (Title / Company / don't import); a preview reflects the choice
// live. Company must be mapped before the rows can be added.
function LookupMappingModal({ grid, onCancel, onConfirm }) {
  const columnCount = useMemo(() => grid.reduce((n, r) => Math.max(n, r.length), 0), [grid]);
  const [hasHeader, setHasHeader] = useState(() => looksLikeHeader(grid[0]));
  const headerCells = grid[0] || [];
  const [mapping, setMapping] = useState(() => guessLookupMapping(headerCells, hasHeader, columnCount));

  // Re-guess when the header toggle flips — that changes which row is
  // data and the available header text, so prior guesses no longer hold.
  useEffect(() => {
    setMapping(guessLookupMapping(grid[0] || [], hasHeader, columnCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHeader]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const dataRows = hasHeader ? grid.slice(1) : grid;
  const nameIdx = mapping.indexOf('name');
  const titleIdx = mapping.indexOf('title');
  const companyIdx = mapping.indexOf('company');
  const builtRows = useMemo(() => dataRows
    .map(cells => ({
      name: nameIdx >= 0 ? String(cells[nameIdx] || '').trim() : '',
      title: titleIdx >= 0 ? String(cells[titleIdx] || '').trim() : '',
      company: companyIdx >= 0 ? String(cells[companyIdx] || '').trim() : '',
    }))
    .filter(r => r.name || r.title || r.company), [dataRows, nameIdx, titleIdx, companyIdx]);

  // Each field may map to only one column — picking it for one column
  // clears it from any other.
  function setColumnField(colIdx, field) {
    setMapping(prev => {
      const next = prev.map((m, i) => (field && m === field && i !== colIdx ? '' : m));
      next[colIdx] = field;
      return next;
    });
  }

  const colLabel = (idx) => (hasHeader && headerCells[idx] ? headerCells[idx] : `Column ${idx + 1}`);
  const previewRows = dataRows.slice(0, 5);
  const canConfirm = companyIdx >= 0 && builtRows.length > 0;

  return createPortal(
    <div className={styles.modalOverlay} onMouseDown={onCancel}>
      <div className={styles.modalPanel} style={{ width: 720, maxWidth: '100%' }} onMouseDown={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span>Map your columns</span>
          <button type="button" className={styles.modalClose} onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div style={{ padding: '0.7rem 0.9rem', overflow: 'auto', flex: 1, minHeight: 0 }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '0.6rem' }}>
            Choose which column holds the <strong>Title</strong> and which holds the <strong>Company</strong>. {columnCount} column{columnCount === 1 ? '' : 's'} · {dataRows.length} row{dataRows.length === 1 ? '' : 's'} detected.
          </div>
          <label className={styles.mapHeaderToggle}>
            <input type="checkbox" checked={hasHeader} onChange={e => setHasHeader(e.target.checked)} />
            First row is a header (column names, not data)
          </label>
          <div className={styles.tableScroll} style={{ marginTop: '0.6rem', border: '1px solid var(--color-border)', borderRadius: 8 }}>
            <table className={styles.mapTable}>
              <thead>
                <tr>
                  {Array.from({ length: columnCount }).map((_, idx) => (
                    <th key={idx}>
                      <div className={styles.mapColName} title={colLabel(idx)}>{colLabel(idx)}</div>
                      <select
                        className={styles.mapSelect}
                        value={mapping[idx] || ''}
                        onChange={e => setColumnField(idx, e.target.value)}
                      >
                        <option value="">Don't import</option>
                        {LOOKUP_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.length === 0 ? (
                  <tr><td colSpan={columnCount} className={styles.tvMuted} style={{ padding: '0.5rem', textAlign: 'center' }}>No data rows to preview.</td></tr>
                ) : previewRows.map((cells, r) => (
                  <tr key={r}>
                    {Array.from({ length: columnCount }).map((_, idx) => (
                      <td key={idx} className={mapping[idx] ? styles.mapCellMapped : undefined}>
                        {String(cells[idx] || '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dataRows.length > previewRows.length && (
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.4rem' }}>
              Showing first {previewRows.length} of {dataRows.length} rows.
            </div>
          )}
        </div>
        <div className={styles.mapFooter}>
          {companyIdx < 0 && (
            <span className={styles.mapWarn}>Map a column to <strong>Company</strong> to continue.</span>
          )}
          <button type="button" className={styles.mapCancelBtn} onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={styles.newBtn}
            disabled={!canConfirm}
            onClick={() => onConfirm(builtRows)}
          >
            Add {builtRows.length} row{builtRows.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---- Configurable / resizable table columns ----------------------
// Column visibility + widths are personal display prefs, so they live in
// localStorage (keyed per table) rather than the synced Firestore event
// settings — same approach the Key Contacts table uses.
const LS_PREFIX = 'events-view';
function colsLsGet(key) { try { return localStorage.getItem(`${LS_PREFIX}:${key}`); } catch { return null; } }
function colsLsSet(key, val) { try { localStorage.setItem(`${LS_PREFIX}:${key}`, val); } catch { /* ignore */ } }

// Manage which columns are shown and how wide they are for one table.
// `columns` is the full ordered definition ([{ key, label, width }…]);
// the returned `visible` is the subset to render (in definition order).
function useTableColumns(tableKey, columns) {
  const defaultVisible = columns.map(c => c.key);
  const defaultWidths = Object.fromEntries(columns.map(c => [c.key, c.width]));

  const [visibleKeys, setVisibleKeys] = useState(() => {
    try {
      const saved = JSON.parse(colsLsGet(`${tableKey}-visible`));
      if (Array.isArray(saved)) {
        // Keep only keys we still know about; if everything saved is
        // stale, fall back to the defaults so the table isn't empty.
        const knownSet = new Set(defaultVisible);
        const filtered = saved.filter(k => knownSet.has(k));
        if (filtered.length) {
          // Surface columns the user has never been offered before
          // (added in a later version) instead of silently hiding them.
          // The "-known" record is what makes this precise; before it
          // exists (first load after this shipped) every column reads as
          // new, so a one-time re-show of any hidden column is expected.
          // From then on, columns the user hides stay hidden.
          let offered = [];
          try { offered = JSON.parse(colsLsGet(`${tableKey}-known`)) || []; } catch { /* ignore */ }
          const offeredSet = new Set(offered);
          const result = [...filtered];
          for (const k of defaultVisible) {
            if (!offeredSet.has(k) && !result.includes(k)) result.push(k);
          }
          return result;
        }
      }
    } catch { /* ignore */ }
    return defaultVisible;
  });
  useEffect(() => { colsLsSet(`${tableKey}-visible`, JSON.stringify(visibleKeys)); }, [tableKey, visibleKeys]);
  // Record the full set of columns we've now offered, so a column added
  // in a future version can be detected as new (and shown) on next load.
  const knownKeysStr = defaultVisible.join(',');
  useEffect(() => { colsLsSet(`${tableKey}-known`, JSON.stringify(knownKeysStr.split(','))); }, [tableKey, knownKeysStr]);

  const [widths, setWidths] = useState(() => {
    try {
      const saved = JSON.parse(colsLsGet(`${tableKey}-widths`)) || {};
      return { ...defaultWidths, ...saved };
    } catch { return defaultWidths; }
  });
  useEffect(() => { colsLsSet(`${tableKey}-widths`, JSON.stringify(widths)); }, [tableKey, widths]);

  // Toggle a column on/off, but never let the user hide the last one.
  function toggle(key) {
    setVisibleKeys(prev => {
      if (prev.includes(key)) return prev.length <= 1 ? prev : prev.filter(k => k !== key);
      return [...prev, key];
    });
  }
  function reset() { setVisibleKeys(defaultVisible); setWidths(defaultWidths); }

  // Drag-to-resize a column. Start metrics are captured in local scope
  // so a stray mousemove after mouseup can't throw on a null ref.
  const resizingRef = useRef(null);
  function startResize(key, e) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widths[key] || 120;
    resizingRef.current = { key };
    const onMove = (ev) => {
      if (!resizingRef.current) return;
      const next = Math.max(60, startWidth + (ev.clientX - startX));
      setWidths(prev => ({ ...prev, [key]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const visible = columns.filter(c => visibleKeys.includes(c.key));
  return { visible, visibleKeys, widths, toggle, reset, startResize };
}

// "Columns ▾" dropdown: checkboxes to show/hide each column plus a reset.
function ColumnsMenu({ columns, visibleKeys, onToggle, onReset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!ref.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div ref={ref} className={styles.colsMenuWrap}>
      <button type="button" className={styles.colsBtn} onClick={() => setOpen(o => !o)} title="Show or hide columns">
        Columns ▾
      </button>
      {open && (
        <div className={styles.colsMenu}>
          {columns.map(c => {
            const checked = visibleKeys.includes(c.key);
            return (
              <label key={c.key} className={styles.colsMenuItem}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={checked && visibleKeys.length <= 1}
                  onChange={() => onToggle(c.key)}
                />
                {c.label}
              </label>
            );
          })}
          <button type="button" className={styles.colsMenuReset} onClick={onReset}>Reset to default</button>
        </div>
      )}
    </div>
  );
}

// Header for a resizable table: a <colgroup> drives the fixed column
// widths and each <th> carries its label and a drag handle. When the
// table is filterable a second row of always-visible type-to-filter
// inputs sits directly beneath the headers. `leading` / `trailing` are
// optional always-on columns (e.g. a select-all checkbox or row actions).
function ResizableHead({ columns, widths, startResize, filters, onFilterChange, leading, trailing }) {
  const showFilterRow = !!onFilterChange && columns.some(c => c.filterable);
  return (
    <>
      <colgroup>
        {leading && <col style={{ width: leading.width }} />}
        {columns.map(c => <col key={c.key} style={{ width: widths[c.key] }} />)}
        {trailing && <col style={{ width: trailing.width }} />}
      </colgroup>
      <thead>
        <tr>
          {leading && <th style={{ textAlign: 'center' }}>{leading.content}</th>}
          {columns.map(c => (
            <th key={c.key} title={c.label}>
              <span className={styles.thLabel}>{c.label}</span>
              <span
                className={styles.resizeHandle}
                onMouseDown={e => startResize(c.key, e)}
                role="separator"
                aria-label={`Resize ${c.label} column`}
              />
            </th>
          ))}
          {trailing && <th aria-label={trailing.label} />}
        </tr>
        {showFilterRow && (
          <tr className={styles.filterRow}>
            {leading && <th />}
            {columns.map(c => (
              <th key={c.key}>
                {c.filterable && (
                  <input
                    className={styles.filterInput}
                    value={filters?.[c.key] || ''}
                    placeholder={`Filter ${c.label}…`}
                    aria-label={`Filter by ${c.label}`}
                    onChange={e => onFilterChange(c.key, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') onFilterChange(c.key, ''); }}
                  />
                )}
              </th>
            ))}
            {trailing && <th />}
          </tr>
        )}
      </thead>
    </>
  );
}

export function EventsView({
  settings = {},
  updateSettings = () => {},
  prospects = [],
  onSelectProspect = () => {},
  onAddProspect = () => {},
  onUpdateProspect = () => {},
  cdmName = '',
}) {
  const events = useMemo(
    () => (Array.isArray(settings?.events) ? settings.events : []),
    [settings?.events],
  );
  // Company Types for the lookup list's inline Type cell, off the
  // Dropdowns-tab list every other Type picker reads.
  const typeOptions = useMemo(() => buildTypeOptions(prospects, settings), [prospects, settings]);
  const [selectedId, setSelectedId] = useState(null);
  // Draft text for the "Find people on LinkedIn" import box.
  const [lookupDraft, setLookupDraft] = useState('');
  // Parsed grid awaiting column mapping (null = mapping popup closed).
  const [lookupMapping, setLookupMapping] = useState(null);
  const lookupFileRef = useRef(null);
  // Active CDM filter for the lookup table ('' = show all).
  const [cdmFilter, setCdmFilter] = useState('');
  // Company names currently being pushed to the Table View, so the
  // "+ Add" button can show progress until the prospects list updates.
  const [addingCompanies, setAddingCompanies] = useState(() => new Set());
  const [bulkAdding, setBulkAdding] = useState(false);
  // Attendee whose contact details popup is open (null = closed).
  const [contactPopup, setContactPopup] = useState(null);
  // Bulk tag editor: which mapped contacts are selected (by HubSpot id),
  // the tag being applied, and transient save state / status text.
  const [selectedContactIds, setSelectedContactIds] = useState(() => new Set());
  const [bulkTag, setBulkTag] = useState('');
  const [tagSaving, setTagSaving] = useState(false);
  const [tagStatus, setTagStatus] = useState('');
  const [tagOptions, setTagOptions] = useState([]);
  // Per-column type-to-filter drafts for the two tables (keyed by column).
  const [attFilters, setAttFilters] = useState({});
  const [lookupFilters, setLookupFilters] = useState({});
  const setAttFilter = (key, v) => setAttFilters(prev => ({ ...prev, [key]: v }));
  const setLookupFilter = (key, v) => setLookupFilters(prev => ({ ...prev, [key]: v }));

  // Index every Table View prospect by the app's canonical company
  // dedupe key so each lookup row can find its matching prospect the
  // same way addProspect de-dupes (regional qualifiers respected).
  const prospectByCompanyKey = useMemo(() => {
    const map = new Map();
    for (const p of (prospects || [])) {
      const key = companyDedupeKey(p?.company);
      if (key && !map.has(key)) map.set(key, p);
    }
    return map;
  }, [prospects]);
  const matchProspect = (company) => {
    const key = companyDedupeKey(company);
    return key ? (prospectByCompanyKey.get(key) || null) : null;
  };

  // Pre-normalized prospect names for the fuzzy "Suggested" column —
  // built once per prospects change. Each entry keeps a normalized
  // string (corporate suffixes / parentheticals stripped) and its
  // token set for overlap scoring.
  const prospectNorms = useMemo(() => {
    const out = [];
    for (const p of (prospects || [])) {
      const norm = normalizeCompany(p?.company);
      if (!norm) continue;
      out.push({ p, norm, tokens: new Set(norm.split(' ').filter(t => t.length >= 3)) });
    }
    return out;
  }, [prospects]);

  // Best fuzzy Table View match for a company that has no exact
  // dedupe-key match. Returns the candidate prospect when confidence
  // clears the threshold, else null. Tuned to suggest (user reviews),
  // not auto-apply.
  const suggestProspect = (company) => {
    const q = normalizeCompany(company);
    if (!q) return null;
    const qTokens = q.split(' ').filter(t => t.length >= 3);
    let best = null;
    let bestScore = 0;
    for (const { p, norm, tokens } of prospectNorms) {
      let score = 0;
      if (norm === q) score = 1;
      else if (norm.includes(q) || q.includes(norm)) score = 0.9;
      else if (qTokens.length && tokens.size) {
        let common = 0;
        for (const t of qTokens) if (tokens.has(t)) common += 1;
        score = common / Math.max(qTokens.length, tokens.size);
      }
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return bestScore >= 0.5 ? best : null;
  };

  async function addCompanyToTableView(company) {
    const name = String(company || '').trim();
    if (!name) return;
    setAddingCompanies(prev => new Set(prev).add(name));
    try {
      await onAddProspect({ company: name, cdm: cdmName || '' });
    } catch (err) {
      console.warn('Add to Table View failed', err);
    } finally {
      setAddingCompanies(prev => { const next = new Set(prev); next.delete(name); return next; });
    }
  }

  // Mirror of the synced HubSpot contacts cache, refreshed when the
  // cache-updated event fires (e.g. after the Refresh contacts button).
  const [contacts, setContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCache()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => {});
    }
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Index the synced HubSpot contacts by id so a mapped attendee (which
  // only stores a slim snapshot) can resolve back to its live record for
  // its current Dan's Tags.
  const contactsById = useMemo(() => {
    const m = new Map();
    for (const c of contacts) {
      const id = String(c.id || c.vid || '');
      if (id) m.set(id, c);
    }
    return m;
  }, [contacts]);

  // Email index over the synced HubSpot contacts, so a manual attendee
  // (no contactId) that was later added to HubSpot under a matching
  // address still reads as "in HubSpot" in the status column below.
  const contactsByEmail = useMemo(() => {
    const m = new Map();
    for (const c of contacts) {
      const email = String(c.email || c.properties?.email || '').trim().toLowerCase();
      if (email && !m.has(email)) m.set(email, c);
    }
    return m;
  }, [contacts]);

  // Does this attendee exist in the synced HubSpot contacts? True when it
  // carries a contactId we have cached, or (for manual attendees) when its
  // email matches a cached contact.
  function attendeeInHubspot(a) {
    if (a.contactId && contactsById.has(String(a.contactId))) return true;
    const email = String(a.email || '').trim().toLowerCase();
    return !!email && contactsByEmail.has(email);
  }

  // Valid Dan's Tags options for the bulk editor — the same union the
  // HubSpot Contacts tab uses: every tag already in the synced contacts,
  // supplemented by the property's enumerated options from HubSpot.
  useEffect(() => {
    let cancelled = false;
    const vals = new Set();
    for (const c of contacts) for (const t of contactTags(c)) vals.add(t);
    if (!cancelled && vals.size) setTagOptions([...vals].sort((a, b) => a.localeCompare(b)));
    (async () => {
      try {
        const res = await apiFetch('/api/hubspot?action=properties');
        const json = await res.json();
        const prop = (json.properties || []).find(p =>
          p.name === 'dans_tags' || p.name === 'dan_s_tags' || p.name === 'dans_tag' ||
          ((p.label || '').toLowerCase().includes('dan') && (p.label || '').toLowerCase().includes('tag')));
        if (!prop) return;
        const dRes = await apiFetch(`/api/hubspot?action=property-detail&name=${prop.name}`);
        const detail = await dRes.json();
        if (detail.options?.length) {
          for (const o of detail.options) {
            const v = typeof o === 'string' ? o : (o.label || o.value || '');
            if (v) vals.add(v);
          }
          if (!cancelled) setTagOptions([...vals].sort((a, b) => a.localeCompare(b)));
        }
      } catch { /* options stay as derived from the cache */ }
    })();
    return () => { cancelled = true; };
  }, [contacts]);

  // Keep a valid selection: default to the first event, and recover if
  // the selected event is deleted.
  useEffect(() => {
    if (events.length === 0) { if (selectedId !== null) setSelectedId(null); return; }
    if (!events.some(e => e.id === selectedId)) setSelectedId(events[0].id);
  }, [events, selectedId]);

  const selected = events.find(e => e.id === selectedId) || null;

  function saveEvents(next) {
    updateSettings({ events: next });
  }

  function createEvent() {
    const ev = { id: newId(), name: 'New Event', date: '', location: '', notes: '', attendees: [] };
    saveEvents([ev, ...events]);
    setSelectedId(ev.id);
  }

  function updateEvent(id, patch) {
    saveEvents(events.map(e => (e.id === id ? { ...e, ...patch } : e)));
  }

  function deleteEvent(id) {
    const ev = events.find(e => e.id === id);
    if (ev && !window.confirm(`Delete event "${ev.name || 'Untitled'}" and its attendee list?`)) return;
    saveEvents(events.filter(e => e.id !== id));
  }

  function attendeeExists(list, attendee) {
    return attendee.contactId
      ? list.some(a => a.contactId && a.contactId === attendee.contactId)
      : list.some(a => !a.contactId && a.name.toLowerCase() === attendee.name.toLowerCase());
  }

  function addAttendee(attendee) {
    if (!selected) return;
    // De-dupe HubSpot contacts by id; manual attendees by lowercased name.
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    if (attendeeExists(list, attendee)) return;
    updateEvent(selected.id, { attendees: [...list, attendee] });
  }

  // Add an attendee from a lookup row and drop that row from the lookup
  // table in the same write — both touch selected.events, so doing them
  // as one updateEvent avoids the second call clobbering the first.
  function addAttendeeFromLookup(attendee, lookupIndex) {
    if (!selected) return;
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    const nextAttendees = attendeeExists(list, attendee) ? list : [...list, attendee];
    const curLookups = Array.isArray(selected.lookups) ? selected.lookups : [];
    const nextLookups = curLookups.filter((_, i) => i !== lookupIndex);
    updateEvent(selected.id, { attendees: nextAttendees, lookups: nextLookups });
  }

  function removeAttendee(index) {
    if (!selected) return;
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    updateEvent(selected.id, { attendees: list.filter((_, i) => i !== index) });
  }

  // Remove an attendee by reference (HubSpot id when present, else
  // name + company) — used by the per-row Add Contact chips / popup.
  function removeAttendeeObj(att) {
    if (!selected) return;
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    const next = list.filter(a => att.contactId
      ? String(a.contactId) !== String(att.contactId)
      : !(!a.contactId && a.name === att.name && (a.company || '') === (att.company || '')));
    updateEvent(selected.id, { attendees: next });
  }

  // Resolve a mapped attendee back to its full cached contact record
  // (by HubSpot id, else by name + company) and open the details popup.
  function openAttendeeContact(att) {
    const byId = att.contactId
      ? searchableContacts.find(c => String(c.id || c.vid || '') === String(att.contactId))
      : null;
    const byName = !byId
      ? searchableContacts.find(c =>
          contactDisplayName(c).toLowerCase() === String(att.name || '').toLowerCase()
          && normalizeCompany(c.company) === normalizeCompany(att.company))
      : null;
    setContactPopup({ attendee: att, contact: byId || byName || null });
  }

  // ---- Bulk Dan's Tags editing for mapped attendees ----------------
  // Only attendees backed by a HubSpot contact (have a contactId that
  // resolves in the synced cache) can be tag-edited; manual attendees
  // have no HubSpot record to write to. (`taggableAttendees` /
  // `allTaggableSelected` are derived below, once `attendees` exists.)
  function toggleContactSelected(id) {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Operates on the currently-visible taggable rows so it respects any
  // active column filters.
  function toggleSelectAll() {
    setSelectedContactIds(prev => {
      const ids = visibleTaggable.map(({ a }) => String(a.contactId));
      const allSelected = ids.length > 0 && ids.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  // Add or remove `bulkTag` across every selected contact, writing each
  // change to HubSpot and the local cache (which refreshes the table).
  async function applyBulkTag(mode) {
    const tag = bulkTag.trim();
    const ids = [...selectedContactIds].filter(id => contactsById.has(String(id)));
    if (!tag || ids.length === 0) return;
    setTagSaving(true);
    setTagStatus('');
    let changed = 0;
    let failed = 0;
    for (const id of ids) {
      const cur = contactTags(contactsById.get(String(id)));
      const has = cur.some(t => t.toLowerCase() === tag.toLowerCase());
      if (mode === 'add' && has) continue;
      if (mode === 'remove' && !has) continue;
      const next = mode === 'add' ? [...cur, tag] : cur.filter(t => t.toLowerCase() !== tag.toLowerCase());
      const nextStr = next.join(';');
      try {
        const res = await apiFetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: id, properties: { dans_tags: nextStr } }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.error) throw new Error(json?.message || json?.error || `HubSpot ${res.status}`);
        await updateHubspotCache(draft => {
          const idx = draft.contacts.findIndex(c => String(c.id || c.vid) === String(id));
          if (idx !== -1) draft.contacts[idx] = { ...draft.contacts[idx], dans_tags: nextStr };
        });
        changed += 1;
      } catch (err) {
        console.error('[Events bulk tag] update failed for', id, err);
        failed += 1;
      }
    }
    setTagSaving(false);
    const verb = mode === 'add' ? 'Added' : 'Removed';
    setTagStatus(
      failed
        ? `${verb} "${tag}" on ${changed} · ${failed} failed`
        : changed
          ? `${verb} "${tag}" on ${changed} contact${changed === 1 ? '' : 's'}`
          : 'No changes needed',
    );
    setTimeout(() => setTagStatus(''), 4000);
  }

  function exportAttendeesCsv() {
    if (!selected) return;
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    const escape = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const headers = ['Name', 'Original Title', 'Contact Title', 'Company', 'Email', 'Tags'];
    const rows = list.map(a => {
      const tags = a.contactId ? contactTags(contactsById.get(String(a.contactId))).join('; ') : '';
      return [a.name, a.originalTitle, a.title, a.company, a.email, tags].map(escape).join(',');
    });
    const csv = headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = (selected.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
    a.download = `${slug}-attendees.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- LinkedIn lookup list ----------------------------------------
  // Parse dropped / pasted / uploaded text into a grid and open the
  // column-mapping popup so the user picks which column is which.
  function openLookupMapping(text) {
    if (!selected) return;
    const grid = parseGrid(text);
    if (grid.length === 0) return;
    setLookupMapping(grid);
  }

  // Commit the mapped rows ([{ name, title, company }]) to the lookup
  // list, de-duping against existing rows (case-insensitive title|company).
  function commitMappedLookups(rows) {
    if (!selected) { setLookupMapping(null); return; }
    const cur = Array.isArray(selected.lookups) ? selected.lookups : [];
    const seen = new Set(cur.map(l => `${(l.title || '').toLowerCase()}|${(l.company || '').toLowerCase()}`));
    const merged = [...cur];
    for (const row of rows) {
      const name = String(row.name || '').trim();
      const title = String(row.title || '').trim();
      const company = String(row.company || '').trim();
      if (!name && !title && !company) continue;
      const key = `${title.toLowerCase()}|${company.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ name, title, company });
    }
    updateEvent(selected.id, { lookups: merged });
    setLookupDraft('');
    setLookupMapping(null);
  }

  function handleLookupFile(e) {
    const file = e.target.files && e.target.files[0];
    if (file) file.text().then(openLookupMapping).catch(() => {});
    e.target.value = '';
  }

  function removeLookup(index) {
    if (!selected) return;
    const list = Array.isArray(selected.lookups) ? selected.lookups : [];
    updateEvent(selected.id, { lookups: list.filter((_, i) => i !== index) });
  }

  function updateLookup(index, patch) {
    if (!selected) return;
    const list = Array.isArray(selected.lookups) ? selected.lookups : [];
    updateEvent(selected.id, { lookups: list.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
  }

  function clearLookups() {
    if (!selected) return;
    if (!window.confirm('Clear the entire LinkedIn lookup list for this event?')) return;
    updateEvent(selected.id, { lookups: [] });
  }

  // Map a suggested decision maker to its company by saving them as an
  // attendee (de-duped by HubSpot id), keeping the lookup row in place.
  function addDecisionMaker(contact, lookupRow) {
    addAttendee({ ...contactToAttendee(contact), originalTitle: lookupRow.title || '' });
  }
  // Hide a suggested decision maker for one lookup row without adding
  // them. The ignore list is stored on the row so it persists.
  function ignoreDecisionMaker(contactId, lookupIndex) {
    const list = Array.isArray(selected?.lookups) ? selected.lookups : [];
    const row = list[lookupIndex];
    if (!row) return;
    const cur = Array.isArray(row.ignoredContactIds) ? row.ignoredContactIds : [];
    if (cur.includes(contactId)) return;
    updateLookup(lookupIndex, { ignoredContactIds: [...cur, contactId] });
  }

  const existingIds = useMemo(() => {
    const set = new Set();
    for (const a of (selected?.attendees || [])) if (a.contactId) set.add(a.contactId);
    return set;
  }, [selected]);

  // Manually-added contacts (no contactId) harvested from every event's
  // attendee list, shaped like HubSpot contacts so they surface in the
  // contact search / roster lists. Flagged `_manual` so adding one saves
  // it back as a manual attendee instead of a synthetic id-bearing copy.
  const manualContacts = useMemo(() => {
    const byKey = new Map();
    for (const ev of events) {
      for (const a of (ev.attendees || [])) {
        if (a.contactId) continue;
        const name = String(a.name || '').trim();
        if (!name) continue;
        const key = `manual:${name.toLowerCase()}|${String(a.company || '').toLowerCase()}`;
        if (byKey.has(key)) continue;
        byKey.set(key, { id: key, firstname: name, lastname: '', email: a.email || '', company: a.company || '', jobtitle: a.title || '', _manual: true });
      }
    }
    return [...byKey.values()];
  }, [events]);
  const searchableContacts = useMemo(() => [...manualContacts, ...contacts], [manualContacts, contacts]);

  // HubSpot contacts tagged "Decision Maker" — used to surface the
  // decision maker(s) for each lookup company right under its row.
  const decisionMakerContacts = useMemo(
    () => (contacts || []).filter(isDecisionMaker),
    [contacts],
  );
  // Decision-maker contacts whose company matches `company`, using the
  // same fuzzy company match the roster popup uses.
  function decisionMakersForCompany(company) {
    const norm = normalizeCompany(company);
    if (!norm) return [];
    return decisionMakerContacts.filter(c => {
      const cn = normalizeCompany(c.company);
      return cn && (cn === norm || cn.includes(norm) || norm.includes(cn));
    });
  }

  // HubSpot contacts grouped by normalized company name, so the email
  // domain lookup below can find a company's contacts without scanning
  // the whole cache on every call.
  const contactsByCompanyNorm = useMemo(() => {
    const map = new Map();
    for (const c of (contacts || [])) {
      const key = normalizeCompany(c.company);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return map;
  }, [contacts]);

  // Email-domain info for a company, derived from its HubSpot contacts:
  // the most common corporate domain (free providers excluded), how many
  // contacts have any email, and the local-part pattern to guess with.
  // Memoized with an internal cache keyed by normalized company name.
  const companyEmailInfo = useMemo(() => {
    const cache = new Map();
    const contactsForCompany = (norm) => {
      if (!norm) return [];
      const exact = contactsByCompanyNorm.get(norm);
      if (exact) return exact;
      const out = [];
      for (const [key, list] of contactsByCompanyNorm) {
        if (key.includes(norm) || norm.includes(key)) out.push(...list);
      }
      return out;
    };
    return (company) => {
      const norm = normalizeCompany(company);
      if (!norm) return { domain: '', emailCount: 0, corporateCount: 0, pattern: '{f}.{l}' };
      if (cache.has(norm)) return cache.get(norm);
      const list = contactsForCompany(norm);
      let emailCount = 0;
      const domainCounts = new Map();
      const samples = [];
      for (const c of list) {
        const email = String(c.email || '').trim().toLowerCase();
        if (!email.includes('@')) continue;
        emailCount += 1;
        const dom = emailDomain(email);
        if (!dom || FREE_EMAIL_DOMAINS.has(dom)) continue;
        domainCounts.set(dom, (domainCounts.get(dom) || 0) + 1);
        samples.push({ email, first: c.firstname, last: c.lastname });
      }
      let domain = '';
      let corporateCount = 0;
      for (const [dom, n] of domainCounts) if (n > corporateCount) { corporateCount = n; domain = dom; }
      const info = { domain, emailCount, corporateCount, pattern: inferEmailPattern(samples, domain) };
      cache.set(norm, info);
      return info;
    };
  }, [contactsByCompanyNorm]);

  // Patch one attendee in place (by original index).
  function updateAttendeeAt(index, patch) {
    if (!selected) return;
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    updateEvent(selected.id, { attendees: list.map((a, i) => (i === index ? { ...a, ...patch } : a)) });
  }

  // Fill an attendee's missing email by guessing from the company's
  // domain + inferred pattern, flagged so the UI can show it's a guess.
  function guessAttendeeEmail(attendee, index) {
    const info = resolveEmailDomain(attendee.company);
    if (!info.domain) return;
    let first = '';
    let last = '';
    const contact = attendee.contactId ? contactsById.get(String(attendee.contactId)) : null;
    if (contact) { first = contact.firstname || ''; last = contact.lastname || ''; }
    else {
      const parts = String(attendee.name || '').trim().split(/\s+/).filter(Boolean);
      first = parts[0] || '';
      last = parts.length > 1 ? parts[parts.length - 1] : '';
    }
    const email = buildGuessedEmail(first, last, info.domain, info.pattern);
    if (email) updateAttendeeAt(index, { email, emailGuessed: true });
  }

  const attendees = useMemo(
    () => (selected && Array.isArray(selected.attendees) ? selected.attendees : []),
    [selected],
  );
  // Mapped attendees that resolve to a synced HubSpot contact — the only
  // ones the bulk tag editor can write to.
  const taggableAttendees = useMemo(
    () => attendees.filter(a => a.contactId && contactsById.has(String(a.contactId))),
    [attendees, contactsById],
  );

  // ---- Add attendees to HubSpot ------------------------------------
  // The email domain(s) a user has explicitly mapped on the matched
  // Table View prospect record (bare domain, full address, or URL —
  // normalized to a hostname). Defined here so both the Email Domain
  // column and the add-to-HubSpot helpers below can reuse it.
  const savedDomainsFor = (company) => {
    const prospect = matchProspect(company);
    const raw = prospect?.emailDomain;
    if (!raw) return [];
    const out = [];
    for (const entry of String(raw).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
      const at = entry.lastIndexOf('@');
      let d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
      d = d.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
      if (d && !out.includes(d)) out.push(d);
    }
    return out;
  };

  // The domain + pattern used to guess a missing email address. The
  // hand-mapped emailDomain wins (same precedence as the Email Domain
  // column); fall back to the domain inferred from HubSpot contacts.
  const resolveEmailDomain = (company) => {
    const info = companyEmailInfo(company);
    const saved = savedDomainsFor(company);
    return { domain: saved[0] || info.domain, pattern: info.pattern || '{f}.{l}' };
  };

  const splitAttendeeName = (a) => {
    const cid = a.contactId ? String(a.contactId) : '';
    const live = cid ? contactsById.get(cid) : null;
    if (live && (live.firstname || live.lastname)) {
      return { first: live.firstname || '', last: live.lastname || '' };
    }
    const parts = String(a.name || '').trim().split(/\s+/).filter(Boolean);
    return { first: parts[0] || '', last: parts.length > 1 ? parts.slice(1).join(' ') : '' };
  };

  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

  // The address we'd create this attendee in HubSpot with: their existing
  // email when valid, otherwise one guessed from the company's email
  // domain + the contact's name — so manually-added attendees that only
  // have a known domain (no typed email yet) can still be added. Returns
  // { email, guessed }; email is '' when nothing usable can be built.
  const effectiveAttendeeEmail = (a) => {
    const existing = String(a.email || '').trim();
    if (isValidEmail(existing)) return { email: existing, guessed: !!a.emailGuessed };
    if (existing) return { email: '', guessed: false };
    const { domain, pattern } = resolveEmailDomain(a.company);
    if (!domain) return { email: '', guessed: false };
    const { first, last } = splitAttendeeName(a);
    const guessed = buildGuessedEmail(first, last, domain, pattern);
    return isValidEmail(guessed) ? { email: guessed, guessed: true } : { email: '', guessed: false };
  };

  // Can this attendee be created in HubSpot? Only when it isn't already
  // there (reuses the "In HubSpot" column's attendeeInHubspot check) and
  // we can resolve an email for it — a typed one, or a guess from the
  // company's email domain.
  const canAddToHubSpot = (a) => {
    if (attendeeInHubspot(a)) return false;
    return !!effectiveAttendeeEmail(a).email;
  };

  const attendeesNeedingHubSpot = useMemo(
    () => attendees.map((a, i) => ({ a, i })).filter(({ a }) => canAddToHubSpot(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attendees, contactsById, contactsByEmail, prospects],
  );

  const [hubspotAddingIdx, setHubspotAddingIdx] = useState(() => new Set());
  const [hubspotBulkAdding, setHubspotBulkAdding] = useState(false);
  const [hubspotAddStatus, setHubspotAddStatus] = useState('');

  // Create one attendee in HubSpot (or recover the existing contact on a
  // 409). Uses the attendee's email or a domain-based guess. Returns the
  // contact record { id, ... } on success, else throws.
  const createHubSpotContact = async (a) => {
    const { email } = effectiveAttendeeEmail(a);
    if (!email) throw new Error('No email available to create this contact');
    const { first, last } = splitAttendeeName(a);
    const res = await apiFetch('/api/hubspot?action=create-contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: {
          email,
          firstname: first,
          lastname: last,
          company: a.company || '',
          jobtitle: a.title || a.originalTitle || '',
        },
      }),
    });
    const data = await res.json();
    if (!data?.success || !data.contact?.id) {
      throw new Error(data?.error || 'Failed to add contact');
    }
    return data.contact;
  };

  // Merge freshly created/looked-up contacts into the local HubSpot cache
  // so the attendee immediately reads as "in HubSpot" without a full sync.
  const mergeContactsIntoCache = async (list) => {
    if (list.length === 0) return;
    try {
      await updateHubspotCache(draft => {
        for (const c of list) {
          const id = String(c.id || c.vid || '');
          if (id && !draft.contacts.some(x => String(x.id || x.vid || '') === id)) {
            draft.contacts.push({ ...c, _source: 'manual' });
          }
        }
      });
    } catch { /* cache merge is best-effort */ }
  };

  // Add a single attendee (by original index) to HubSpot and link the
  // resulting contactId back onto the attendee row.
  async function addAttendeeToHubSpot(index) {
    if (!selected) return;
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    const a = list[index];
    if (!a || !canAddToHubSpot(a)) return;
    setHubspotAddingIdx(prev => { const n = new Set(prev); n.add(index); return n; });
    try {
      const hadEmail = !!String(a.email || '').trim();
      const contact = await createHubSpotContact(a);
      const patch = { contactId: String(contact.id) };
      // Persist the guessed address back onto the attendee so the row
      // shows the email it was created with.
      if (!hadEmail && contact.email) { patch.email = contact.email; patch.emailGuessed = true; }
      updateAttendeeAt(index, patch);
      await mergeContactsIntoCache([contact]);
      setHubspotAddStatus(`Added ${a.name || contact.email || 'contact'} to HubSpot`);
    } catch (err) {
      setHubspotAddStatus(`Failed: ${err?.message || 'could not add contact'}`);
    } finally {
      setHubspotAddingIdx(prev => { const n = new Set(prev); n.delete(index); return n; });
      setTimeout(() => setHubspotAddStatus(''), 4000);
    }
  }

  // Add every attendee that isn't yet in HubSpot (and has a valid email)
  // in one pass, then apply all new contactIds in a single settings write.
  async function addAllAttendeesToHubSpot() {
    if (!selected) return;
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    const targets = list.map((a, i) => ({ a, i })).filter(({ a }) => canAddToHubSpot(a));
    if (targets.length === 0) return;
    setHubspotBulkAdding(true);
    setHubspotAddStatus('');
    const patchByIndex = new Map();
    const created = [];
    let failed = 0;
    for (const { a, i } of targets) {
      try {
        const hadEmail = !!String(a.email || '').trim();
        const contact = await createHubSpotContact(a);
        const patch = { contactId: String(contact.id) };
        if (!hadEmail && contact.email) { patch.email = contact.email; patch.emailGuessed = true; }
        patchByIndex.set(i, patch);
        created.push(contact);
      } catch { failed += 1; }
    }
    if (patchByIndex.size > 0) {
      // Re-read the latest attendees so a concurrent edit during the
      // awaits isn't clobbered, then stamp the new contactIds (and any
      // guessed email) on by index.
      const latest = Array.isArray(selected.attendees) ? selected.attendees : list;
      const next = latest.map((a, i) => (patchByIndex.has(i) ? { ...a, ...patchByIndex.get(i) } : a));
      updateEvent(selected.id, { attendees: next });
    }
    await mergeContactsIntoCache(created);
    setHubspotBulkAdding(false);
    setHubspotAddStatus(`${created.length} added to HubSpot${failed ? `, ${failed} failed` : ''}`);
    setTimeout(() => setHubspotAddStatus(''), 5000);
  }

  // Attendees that pass the active per-column filters, paired with their
  // original index so Remove / checkboxes still target the right row.
  const visibleAttendees = useMemo(() => {
    const tagsOf = a => (a.contactId ? contactTags(contactsById.get(String(a.contactId))).join(' ') : '');
    const matches = a => ATT_FILTER_KEYS.every(key => {
      const q = String(attFilters[key] || '').trim().toLowerCase();
      if (!q) return true;
      const val = key === 'tags' ? tagsOf(a) : (a[key] || '');
      return String(val).toLowerCase().includes(q);
    });
    return attendees.map((a, i) => ({ a, i })).filter(({ a }) => matches(a));
  }, [attendees, attFilters, contactsById]);
  // Taggable subset of the currently-visible rows, so select-all and the
  // header checkbox operate on what the user can actually see.
  const visibleTaggable = visibleAttendees.filter(
    ({ a }) => a.contactId && contactsById.has(String(a.contactId)),
  );
  const allTaggableSelected = visibleTaggable.length > 0
    && visibleTaggable.every(({ a }) => selectedContactIds.has(String(a.contactId)));
  const lookups = selected && Array.isArray(selected.lookups) ? selected.lookups : [];
  // Normalized companies that already have a contact on the attendee
  // list — their lookup rows are "done" and drop out of the worklist.
  const attendeeCompanies = useMemo(() => {
    const set = new Set();
    for (const a of attendees) {
      const n = normalizeCompany(a.company);
      if (n) set.add(n);
    }
    return set;
  }, [attendees]);
  const lookupDoneCount = useMemo(
    () => lookups.reduce((n, l) => n + (attendeeCompanies.has(normalizeCompany(l.company)) ? 1 : 0), 0),
    [lookups, attendeeCompanies],
  );
  const lookupMatchCount = useMemo(
    () => lookups.reduce((n, l) => n + (matchProspect(l.company) ? 1 : 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookups, prospectByCompanyKey],
  );
  const newLookupCount = lookups.length - lookupMatchCount;

  // Distinct CDMs across the matched prospects in this lookup list, for
  // the CDM filter dropdown. Reset the active filter when the selected
  // event changes so a stale CDM doesn't hide every row.
  const lookupCdms = useMemo(() => {
    const set = new Set();
    for (const l of lookups) {
      const cdm = String(matchProspect(l.company)?.cdm || '').trim();
      if (cdm) set.add(cdm);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookups, prospectByCompanyKey]);
  useEffect(() => {
    setCdmFilter('');
    setSelectedContactIds(new Set());
    setTagStatus('');
    setAttFilters({});
    setLookupFilters({});
    setLookupMapping(null);
  }, [selectedId]);

  // Unique, sorted Table View company names for the Suggested cell's
  // manual-search dropdown.
  const prospectCompanies = useMemo(() => {
    const set = new Set();
    for (const p of (prospects || [])) {
      const c = String(p?.company || '').trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [prospects]);

  // Push every lookup company that isn't yet in the Table View, in one
  // go. De-duped (case-insensitive) so a company listed twice is only
  // added once; addProspect is idempotent so re-running is safe.
  async function addAllNewToTableView() {
    const names = [];
    const seen = new Set();
    for (const l of lookups) {
      const name = String(l.company || '').trim();
      if (!name || matchProspect(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    if (names.length === 0) return;
    if (!window.confirm(`Add ${names.length} new compan${names.length === 1 ? 'y' : 'ies'} to the Table View, attributed to ${cdmName || 'your CDM'}?`)) return;
    setBulkAdding(true);
    setAddingCompanies(prev => { const next = new Set(prev); names.forEach(n => next.add(n)); return next; });
    try {
      for (const name of names) {
        try { await onAddProspect({ company: name, cdm: cdmName || '' }); }
        catch (err) { console.warn('Bulk add to Table View failed for', name, err); }
      }
    } finally {
      setBulkAdding(false);
      setAddingCompanies(prev => { const next = new Set(prev); names.forEach(n => next.delete(n)); return next; });
    }
  }

  // Shared renderer for the "Email Domain" column on both tables: the
  // company's dominant corporate domain as a chip (with a count tooltip),
  // or a note when only personal emails / no emails are on file.
  // (savedDomainsFor / resolveEmailDomain are defined earlier, alongside
  // the add-to-HubSpot helpers that also use them.)
  const renderDomainCell = (company) => {
    const saved = savedDomainsFor(company);
    if (saved.length > 0) {
      const extra = saved.length - 1;
      return (
        <span
          className={styles.domainChip}
          title={saved.length > 1 ? `Saved email domains: ${saved.map(d => '@' + d).join(', ')}` : `Saved email domain @${saved[0]}`}
        >
          @{saved[0]}{extra > 0 ? ` +${extra}` : ''}
        </span>
      );
    }
    const info = companyEmailInfo(company);
    if (info.domain) {
      return (
        <span className={styles.domainChip} title={`${info.corporateCount} contact${info.corporateCount === 1 ? '' : 's'} with @${info.domain}`}>
          @{info.domain}
        </span>
      );
    }
    if (info.emailCount > 0) {
      return (
        <span className={styles.tvMuted} title="Only personal email domains on file for this company">
          {info.emailCount} email{info.emailCount === 1 ? '' : 's'}
        </span>
      );
    }
    return <span className={styles.tvMuted}>-</span>;
  };

  // ---- Configurable columns for the two tables ---------------------
  // Each column carries its default width, an optional `filterable` flag
  // (renders a type-to-filter funnel, wired to the per-column filter
  // state), and a render function for the body cell. The leading
  // select-all checkbox and trailing "Actions" columns are always shown,
  // so they live outside this set.
  const attendeeColumns = [
    { key: 'name', label: 'Name', width: 180, filterable: true, render: (a) => (
      <>
        <button
          type="button"
          className={styles.attendeeNameLink}
          onClick={() => openAttendeeContact(a)}
          title="View contact details"
        >
          {a.name}
        </button>
        {!a.contactId && (
          <span style={{ marginLeft: 6, fontSize: '0.64rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            (manual)
          </span>
        )}
      </>
    ) },
    { key: 'originalTitle', label: 'Original Title', width: 150, filterable: true, render: (a) => a.originalTitle || '-' },
    { key: 'title', label: 'Contact Title', width: 150, filterable: true, render: (a) => a.title || '-' },
    { key: 'company', label: 'Company', width: 160, filterable: true, render: (a) => {
      const prospect = matchProspect(a.company);
      if (prospect) {
        return (
          <button
            type="button"
            className={styles.tvLink}
            title={`Open "${prospect.company}" in the Table View`}
            onClick={() => onSelectProspect(prospect)}
          >
            {a.company}
          </button>
        );
      }
      return a.company || '-';
    } },
    { key: 'email', label: 'Email', width: 220, filterable: true, render: (a, { i }) => {
      if (a.email) {
        return (
          <span>
            {a.email}
            {a.emailGuessed && (
              <span className={styles.guessTag} title="Guessed from the company email domain: verify before using">guess</span>
            )}
          </span>
        );
      }
      const info = resolveEmailDomain(a.company);
      if (!info.domain) return <span className={styles.tvMuted}>-</span>;
      return (
        <button
          type="button"
          className={styles.guessBtn}
          onClick={() => guessAttendeeEmail(a, i)}
          title={`Guess an address at @${info.domain} from this contact's name`}
        >
          Guess @{info.domain}
        </button>
      );
    } },
    { key: 'emailDomain', label: 'Email Domain', width: 150, render: (a) => renderDomainCell(a.company) },
    { key: 'inHubspot', label: 'In HubSpot', width: 110, render: (a) => (
      attendeeInHubspot(a) ? (
        <span className={styles.hsYes} title="This contact exists in the synced HubSpot contacts">In HubSpot</span>
      ) : (
        <span className={styles.hsNo} title="Not found in the synced HubSpot contacts">Not added</span>
      )
    ) },
    { key: 'tags', label: 'Tags', width: 180, filterable: true, render: (a, { tags }) => (
      tags.length ? (
        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
          {tags.map(t => <span key={t} className={styles.tagChip}>{t}</span>)}
        </span>
      ) : (
        <span className={styles.tvMuted}>-</span>
      )
    ) },
  ];
  const ATTENDEE_ACTIONS = { key: 'actions', label: 'Actions', width: 200 };

  const lookupColumns = [
    { key: 'name', label: 'Name', width: 150, filterable: true, render: (l, { i }) => (
      <LookupNameCell value={l.name} onCommit={v => updateLookup(i, { name: v })} />
    ) },
    { key: 'title', label: 'Title', width: 150, filterable: true, render: (l) => l.title || '-' },
    { key: 'company', label: 'Company', width: 160, filterable: true, render: (l) => l.company || '-' },
    { key: 'emailDomain', label: 'Email Domain', width: 150, render: (l) => renderDomainCell(l.company) },
    { key: 'tableView', label: 'Table View', width: 160, filterable: true, render: (l, { prospect, adding }) => (
      prospect ? (
        <button
          type="button"
          className={styles.tvLink}
          title={`Open "${prospect.company}" in the Table View`}
          onClick={() => onSelectProspect(prospect)}
        >
          {prospect.company}
        </button>
      ) : (
        <button
          type="button"
          className={styles.tvAdd}
          disabled={adding || !String(l.company || '').trim()}
          onClick={() => addCompanyToTableView(l.company)}
          title="Add this company to the Table View as a new prospect"
        >
          {adding ? 'Adding…' : '+ Add'}
        </button>
      )
    ) },
    { key: 'suggested', label: 'Suggested', width: 190, render: (l, { i, prospect, suggestion }) => (
      prospect ? (
        <span className={styles.tvMuted}>-</span>
      ) : (
        <SuggestedCell
          rejected={!!l.suggestRejected}
          suggestion={suggestion}
          prospectCompanies={prospectCompanies}
          onAccept={company => updateLookup(i, { company, suggestRejected: false })}
          onReject={() => updateLookup(i, { suggestRejected: true })}
        />
      )
    ) },
    { key: 'type', label: 'Type', width: 150, filterable: true, render: (l, { prospect }) => (
      <TypeCell prospect={prospect} options={typeOptions} onCommit={v => onUpdateProspect(prospect.id, { type: v })} />
    ) },
    { key: 'cdm', label: 'CDM', width: 140, filterable: true, render: (l, { prospect }) => (
      <CdmCell prospect={prospect} onCommit={v => onUpdateProspect(prospect.id, { cdm: v })} />
    ) },
    { key: 'addContact', label: 'Add Contact', width: 190, render: (l, { i }) => (
      <RowContactAdder
        company={l.company}
        title={l.title}
        contacts={searchableContacts}
        attendees={attendees}
        onAdd={att => addAttendeeFromLookup(att, i)}
        onRemove={removeAttendeeObj}
      />
    ) },
  ];
  const LOOKUP_ACTIONS = { key: 'actions', label: 'Actions', width: 200 };

  const attendeeCols = useTableColumns('attendees', attendeeColumns);
  const lookupCols = useTableColumns('lookups', lookupColumns);
  const ATTENDEE_SELECT = { width: 28 };
  const attendeeTableWidth = ATTENDEE_SELECT.width + attendeeCols.visible.reduce((s, c) => s + (attendeeCols.widths[c.key] || 0), 0) + ATTENDEE_ACTIONS.width;
  const lookupTableWidth = lookupCols.visible.reduce((s, c) => s + (lookupCols.widths[c.key] || 0), 0) + LOOKUP_ACTIONS.width;
  // colSpan helpers for the full-width "no matches" / DM sub-rows.
  const attendeeColSpan = 1 + attendeeCols.visible.length + 1;
  const lookupColSpan = lookupCols.visible.length + 1;

  return (
    <div className={styles.wrapper}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>Events</span>
          <button type="button" className={styles.newBtn} onClick={createEvent}>+ New</button>
        </div>
        <div className={styles.eventList}>
          {events.length === 0 && (
            <div style={{ padding: '0.75rem 0.6rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              No events yet. Click <strong>+ New</strong> to create one.
            </div>
          )}
          {events.map(ev => {
            const count = Array.isArray(ev.attendees) ? ev.attendees.length : 0;
            return (
              <button
                key={ev.id}
                type="button"
                className={ev.id === selectedId ? styles.eventItemActive : styles.eventItem}
                onClick={() => setSelectedId(ev.id)}
              >
                <div className={styles.eventItemName}>{ev.name || 'Untitled event'}</div>
                <div className={styles.eventItemMeta}>
                  {[formatDate(ev.date), `${count} attendee${count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {!selected ? (
        <div className={styles.empty}>
          Select an event on the left, or create a new one to start saving its attendee list.
        </div>
      ) : (
        <div className={styles.detail}>
          <div className={styles.detailHeader}>
            <input
              className={`${styles.input} ${styles.nameInput}`}
              style={{ flex: 1, border: 'none', background: 'none', padding: '0.2rem 0' }}
              value={selected.name}
              placeholder="Event name"
              onChange={e => updateEvent(selected.id, { name: e.target.value })}
            />
            <button type="button" className={styles.deleteBtn} onClick={() => deleteEvent(selected.id)}>
              Delete event
            </button>
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Date</span>
              <input
                type="date"
                className={styles.input}
                value={selected.date || ''}
                onChange={e => updateEvent(selected.id, { date: e.target.value })}
              />
            </label>
            <label className={styles.field} style={{ flex: 1, minWidth: 180 }}>
              <span className={styles.fieldLabel}>Location</span>
              <input
                className={styles.input}
                value={selected.location || ''}
                placeholder="City, venue, virtual…"
                onChange={e => updateEvent(selected.id, { location: e.target.value })}
              />
            </label>
          </div>

          <div className={styles.sectionTitle}>
            Attendees
            <span className={styles.countPill}>{attendees.length}</span>
            {attendees.length > 0 && (
              <button type="button" className={styles.exportBtn} onClick={exportAttendeesCsv}>
                Export CSV
              </button>
            )}
            {attendeesNeedingHubSpot.length > 0 && (
              <button
                type="button"
                className={styles.exportBtn}
                style={{ background: '#FFF7ED', borderColor: '#FED7AA', color: '#C2410C' }}
                onClick={addAllAttendeesToHubSpot}
                disabled={hubspotBulkAdding}
                title="Create a HubSpot contact for every attendee here who isn't already in HubSpot (requires an email)"
              >
                {hubspotBulkAdding ? 'Adding…' : `+ Add ${attendeesNeedingHubSpot.length} to HubSpot`}
              </button>
            )}
            {hubspotAddStatus && (
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: hubspotAddStatus.startsWith('Failed') ? '#B91C1C' : '#166534' }}>
                {hubspotAddStatus}
              </span>
            )}
            {attendees.length > 0 && (
              <ColumnsMenu
                columns={attendeeColumns}
                visibleKeys={attendeeCols.visibleKeys}
                onToggle={attendeeCols.toggle}
                onReset={attendeeCols.reset}
              />
            )}
          </div>

          <AttendeePicker contacts={searchableContacts} existingIds={existingIds} onAdd={addAttendee} />

          {taggableAttendees.length > 0 && (
            <div className={styles.bulkTagBar}>
              <span className={styles.bulkTagCount}>
                {selectedContactIds.size} of {taggableAttendees.length} selected
              </span>
              <select
                className={styles.bulkTagSelect}
                value={bulkTag}
                onChange={e => setBulkTag(e.target.value)}
              >
                <option value="">{tagOptions.length ? 'Choose a tag…' : 'No tags available'}</option>
                {tagOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <button
                type="button"
                className={styles.bulkTagBtn}
                disabled={!bulkTag || selectedContactIds.size === 0 || tagSaving}
                onClick={() => applyBulkTag('add')}
              >
                {tagSaving ? 'Saving…' : '+ Add to selected'}
              </button>
              <button
                type="button"
                className={`${styles.bulkTagBtn} ${styles.bulkTagBtnRemove}`}
                disabled={!bulkTag || selectedContactIds.size === 0 || tagSaving}
                onClick={() => applyBulkTag('remove')}
              >
                − Remove from selected
              </button>
              {tagStatus && <span className={styles.bulkTagStatus}>{tagStatus}</span>}
            </div>
          )}

          {attendees.length === 0 ? (
            <div className={styles.emptyAttendees}>
              No attendees saved yet. Use the search box above to add contacts.
            </div>
          ) : (
            <div className={styles.tableScroll}>
              <table
                className={`${styles.attendeeTable} ${styles.resizable}`}
                style={{ width: attendeeTableWidth, minWidth: attendeeTableWidth }}
              >
                <ResizableHead
                  columns={attendeeCols.visible}
                  widths={attendeeCols.widths}
                  startResize={attendeeCols.startResize}
                  filters={attFilters}
                  onFilterChange={setAttFilter}
                  leading={{
                    width: ATTENDEE_SELECT.width,
                    content: (
                      <input
                        type="checkbox"
                        aria-label="Select all mapped contacts"
                        title="Select all mapped contacts"
                        disabled={taggableAttendees.length === 0}
                        checked={allTaggableSelected}
                        ref={el => { if (el) el.indeterminate = selectedContactIds.size > 0 && !allTaggableSelected; }}
                        onChange={toggleSelectAll}
                      />
                    ),
                  }}
                  trailing={ATTENDEE_ACTIONS}
                />
                <tbody>
                  {visibleAttendees.length === 0 ? (
                    <tr>
                      <td colSpan={attendeeColSpan} className={styles.tvMuted} style={{ padding: '0.6rem', textAlign: 'center' }}>
                        No attendees match the current filters.
                      </td>
                    </tr>
                  ) : visibleAttendees.map(({ a, i }) => {
                    const cid = a.contactId ? String(a.contactId) : '';
                    const taggable = cid && contactsById.has(cid);
                    const tags = taggable ? contactTags(contactsById.get(cid)) : [];
                    const ctx = { i, cid, taggable, tags };
                    return (
                      <tr key={`${a.contactId || 'manual'}-${i}`}>
                        <td style={{ textAlign: 'center' }}>
                          {taggable && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${a.name}`}
                              checked={selectedContactIds.has(cid)}
                              onChange={() => toggleContactSelected(cid)}
                            />
                          )}
                        </td>
                        {attendeeCols.visible.map(c => (
                          <td key={c.key}>{c.render(a, ctx)}</td>
                        ))}
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {canAddToHubSpot(a) && (
                            <button
                              type="button"
                              className={styles.guessBtn}
                              style={{ marginRight: 6 }}
                              disabled={hubspotAddingIdx.has(i)}
                              onClick={() => addAttendeeToHubSpot(i)}
                              title="Add this attendee to HubSpot as a new contact"
                            >
                              {hubspotAddingIdx.has(i) ? 'Adding…' : '+ HubSpot'}
                            </button>
                          )}
                          <button type="button" className={styles.removeBtn} onClick={() => removeAttendee(i)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className={styles.sectionTitle}>
            Find people on LinkedIn
            <span className={styles.countPill}>{lookups.length}</span>
            {lookupCdms.length > 0 && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                CDM
                <select
                  value={cdmFilter}
                  onChange={e => setCdmFilter(e.target.value)}
                  style={{ fontSize: '0.74rem', fontFamily: 'inherit', padding: '2px 4px', border: '1px solid var(--color-border)', borderRadius: 5, background: cdmFilter ? '#EFF6FF' : 'var(--color-surface)', color: 'var(--color-text)' }}
                >
                  <option value="">All</option>
                  {lookupCdms.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            )}
            {newLookupCount > 0 && (
              <button
                type="button"
                className={styles.exportBtn}
                style={{ background: '#DCFCE7', borderColor: '#86EFAC', color: '#166534' }}
                onClick={addAllNewToTableView}
                disabled={bulkAdding}
                title="Create a Table View prospect for every company here that isn't already tracked"
              >
                {bulkAdding ? 'Adding…' : `+ Add all ${newLookupCount} new to Table View`}
              </button>
            )}
            {lookups.length > 0 && (
              <button type="button" className={styles.exportBtn} style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#B91C1C', marginLeft: 0 }} onClick={clearLookups}>
                Clear list
              </button>
            )}
            {lookups.length > 0 && (
              <ColumnsMenu
                columns={lookupColumns}
                visibleKeys={lookupCols.visibleKeys}
                onToggle={lookupCols.toggle}
                onReset={lookupCols.reset}
              />
            )}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
            Paste, drop, or upload a list of <strong>titles and company names</strong> (CSV or tab-separated): a <strong>column-mapping</strong> popup lets you pick which column is which. Each row gets a LinkedIn people-search button, a <strong>Table View</strong> match (click to open, or <strong>+ Add</strong> a new prospect), and an editable <strong>CDM</strong>.
            {lookups.length > 0 && (
              <span style={{ marginLeft: 6 }}>
                <span style={{ color: '#166534', fontWeight: 600 }}>{lookupMatchCount} in Table View</span>
                {' · '}
                <span style={{ color: '#B45309', fontWeight: 600 }}>{lookups.length - lookupMatchCount} new</span>
                {lookupDoneCount > 0 && <>{' · '}<span style={{ color: '#64748B', fontWeight: 600 }}>{lookupDoneCount} added (hidden)</span></>}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
            <textarea
              className={styles.textarea}
              style={{ flex: 1, minWidth: 260, boxSizing: 'border-box', minHeight: 56 }}
              value={lookupDraft}
              placeholder={'Title, Company\nVP Finance, Acme Corp\nHead of Sustainability, Globex'}
              onChange={e => setLookupDraft(e.target.value)}
              onDrop={e => {
                // Dropping a CSV/text file onto the box jumps straight to
                // the column-mapping popup instead of pasting a file path.
                const file = e.dataTransfer?.files?.[0];
                if (file) { e.preventDefault(); file.text().then(openLookupMapping).catch(() => {}); }
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <button type="button" className={styles.newBtn} onClick={() => openLookupMapping(lookupDraft)} disabled={!lookupDraft.trim()}>
                Add rows
              </button>
              <button type="button" className={styles.exportBtn} style={{ margin: 0 }} onClick={() => lookupFileRef.current?.click()}>
                Upload CSV
              </button>
              <input ref={lookupFileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" style={{ display: 'none' }} onChange={handleLookupFile} />
            </div>
          </div>

          {lookups.length > 0 && (
            <div className={styles.tableScroll}>
              <table
                className={`${styles.attendeeTable} ${styles.resizable}`}
                style={{ width: lookupTableWidth, minWidth: lookupTableWidth }}
              >
                <ResizableHead
                  columns={lookupCols.visible}
                  widths={lookupCols.widths}
                  startResize={lookupCols.startResize}
                  filters={lookupFilters}
                  onFilterChange={setLookupFilter}
                  trailing={LOOKUP_ACTIONS}
                />
                <tbody>
                  {lookups.map((l, i) => {
                    const prospect = matchProspect(l.company);
                    // Drop rows whose company already has a contact on the
                    // attendee list — they're done. Reappears if removed.
                    if (attendeeCompanies.has(normalizeCompany(l.company))) return null;
                    // Apply the CDM filter (kept on original index i so
                    // edit / remove still target the right row).
                    if (cdmFilter && String(prospect?.cdm || '').trim() !== cdmFilter) return null;
                    // Apply the per-column type-to-filter drafts.
                    const lookupVals = {
                      name: l.name || '',
                      title: l.title || '',
                      company: l.company || '',
                      tableView: prospect?.company || '',
                      type: prospect?.type || '',
                      cdm: prospect?.cdm || '',
                    };
                    if (!LOOKUP_FILTER_KEYS.every(key => {
                      const q = String(lookupFilters[key] || '').trim().toLowerCase();
                      return !q || String(lookupVals[key]).toLowerCase().includes(q);
                    })) return null;
                    const suggestion = prospect ? null : suggestProspect(l.company);
                    const adding = addingCompanies.has(String(l.company || '').trim());
                    const ctx = { i, prospect, suggestion, adding };
                    // Decision maker(s) on file for this row's company that
                    // haven't already been added as attendees or ignored.
                    const ignoredIds = Array.isArray(l.ignoredContactIds) ? l.ignoredContactIds : [];
                    const dmSuggestions = decisionMakersForCompany(l.company).filter(c => {
                      const id = String(c.id || c.vid || '');
                      if (!id) return false;
                      if (attendees.some(a => a.contactId && String(a.contactId) === id)) return false;
                      return !ignoredIds.includes(id);
                    });
                    return (
                      <Fragment key={`${l.title}-${l.company}-${i}`}>
                        <tr>
                          {lookupCols.visible.map(c => (
                            <td key={c.key} style={c.key === 'suggested' ? { verticalAlign: 'top' } : undefined}>
                              {c.render(l, ctx)}
                            </td>
                          ))}
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <a
                              href={linkedInSearchUrl(l.title, l.company)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={styles.exportBtn}
                              style={{ margin: 0, display: 'inline-block', textDecoration: 'none' }}
                              title={`Search LinkedIn for "${[l.title, l.company].filter(Boolean).join(' at ')}"`}
                            >
                              🔍 LinkedIn
                            </a>
                            <button type="button" className={styles.removeBtn} style={{ marginLeft: 6 }} onClick={() => removeLookup(i)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                        {dmSuggestions.length > 0 && (
                          <tr className={styles.dmRow}>
                            <td colSpan={lookupColSpan}>
                              <div className={styles.dmWrap}>
                                <span className={styles.dmLabel}>
                                  ★ Decision maker{dmSuggestions.length > 1 ? 's' : ''} at {l.company || 'this company'}
                                </span>
                                {dmSuggestions.map(c => {
                                  const id = String(c.id || c.vid || '');
                                  const name = contactDisplayName(c);
                                  return (
                                    <span key={id} className={styles.dmChip}>
                                      <span className={styles.dmName}>{name}</span>
                                      {c.jobtitle && <span className={styles.dmTitle}>{c.jobtitle}</span>}
                                      <button
                                        type="button"
                                        className={styles.dmAdd}
                                        onClick={() => addDecisionMaker(c, l)}
                                        title={`Map ${name} to ${l.company || 'this company'} as an attendee`}
                                      >
                                        + Add
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.dmIgnore}
                                        onClick={() => ignoreDecisionMaker(id, i)}
                                        title="Hide this suggestion"
                                      >
                                        Ignore
                                      </button>
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {contactPopup && (
        <AttendeeContactModal
          attendee={contactPopup.attendee}
          contact={contactPopup.contact}
          onClose={() => setContactPopup(null)}
        />
      )}
      {lookupMapping && (
        <LookupMappingModal
          grid={lookupMapping}
          onCancel={() => setLookupMapping(null)}
          onConfirm={commitMappedLookups}
        />
      )}
    </div>
  );
}
