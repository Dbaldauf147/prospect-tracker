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

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../utils/apiFetch';
import { getHubspotCache, updateHubspotCache } from '../../utils/hubspotContactsCache';
import { attendeeFromContact, contactDisplayName } from '../../utils/eventsStore';
import { companyDedupeKey } from '../../utils/firestoreSync';
import { TYPES } from '../../data/enums';
import styles from './EventsView.module.css';

// Inline Type dropdown for a matched Table View prospect — same enum
// options as the Table View's Type column. Commits immediately on
// change so the lookup list can set/correct Type without leaving Events.
function TypeCell({ prospect, onCommit }) {
  if (!prospect) return <span className={styles.tvMuted}>—</span>;
  return (
    <select
      className={styles.cdmInput}
      value={prospect.type || ''}
      onChange={e => onCommit(e.target.value)}
    >
      <option value="">—</option>
      {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

// Inline-editable CDM cell for a matched Table View prospect. Seeds
// from the prospect's stored CDM and commits on blur / Enter, so the
// user can edit Table View data straight from the lookup list.
function CdmCell({ prospect, onCommit }) {
  const [val, setVal] = useState(prospect?.cdm || '');
  useEffect(() => { setVal(prospect?.cdm || ''); }, [prospect?.id, prospect?.cdm]);
  if (!prospect) return <span className={styles.tvMuted}>—</span>;
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
            <button type="button" className={styles.suggestUse} onClick={() => pick(suggestion.company)} title="Use this name — rewrites this row's company to the Table View name">✓ Use</button>
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
const LOOKUP_FILTER_KEYS = ['title', 'company', 'tableView', 'type'];

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

// Parse pasted / uploaded text into [{ title, company }] rows. Accepts
// CSV or TSV with the first two columns as Title, Company; a leading
// header row (containing "title"/"company") is skipped.
function parseLookups(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  lines.forEach((line, idx) => {
    const cells = splitLine(line);
    const title = (cells[0] || '').trim();
    const company = (cells[1] || '').trim();
    if (!title && !company) return;
    if (idx === 0) {
      const lc = `${title} ${company}`.toLowerCase();
      if (lc.includes('title') && (lc.includes('company') || lc.includes('account'))) return;
    }
    rows.push({ title, company });
  });
  return rows;
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
                {[c.jobtitle, c.company, c.email].filter(Boolean).join(' · ') || '—'}
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
                  <div className={styles.optionMeta}>{[c.jobtitle, c.email].filter(Boolean).join(' · ') || '—'}</div>
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

// Per-row Add Contact cell: shows the contacts already added for this
// company as removable chips, plus a button that opens the roster popup.
function RowContactAdder({ company, title, contacts, attendees, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);

  // Attendees attributed to this row's company, surfaced inline so the
  // user can see who they've added without opening the popup.
  const companyNorm = useMemo(() => normalizeCompany(company), [company]);
  const addedHere = useMemo(() => {
    if (!companyNorm) return [];
    return (attendees || []).filter(a => normalizeCompany(a.company) === companyNorm);
  }, [attendees, companyNorm]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      {addedHere.map((a, idx) => (
        <span key={`${a.contactId || a.name}-${idx}`} className={styles.contactChip} title={a.email || a.name}>
          {a.name}
          <button type="button" onClick={() => onRemove(a)} aria-label={`Remove ${a.name}`}>×</button>
        </span>
      ))}
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
    ['Original title', attendee.originalTitle || '—'],
    ['Contact title', contactTitle || '—'],
    ['Company', company || '—'],
    ['Email', email ? <a href={`mailto:${email}`}>{email}</a> : '—'],
    ['Phone', phone || '—'],
    ['Location', location || '—'],
    ['LinkedIn', linkedin ? <a href={linkedin} target="_blank" rel="noopener noreferrer">View profile</a> : '—'],
    ['Tags', tags.length ? (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
        {tags.map(t => <span key={t} className={styles.tagChip}>{t}</span>)}
      </span>
    ) : '—'],
  ];

  return createPortal(
    <div className={styles.modalOverlay} onMouseDown={onClose}>
      <div className={styles.modalPanel} onMouseDown={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span>
            <strong>{name}</strong>
            {!attendee.contactId && (
              <span style={{ marginLeft: 6, fontSize: '0.7rem', fontWeight: 400, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                (manual — not in HubSpot)
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
              The full contact record isn't in the synced HubSpot cache right now — showing the details saved with this event.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Column header with a built-in type-to-filter box. A funnel toggle
// reveals a text input; rows are matched by case-insensitive substring
// on that column (handled by the parent). The input stays visible while
// it holds a value so an active filter is always obvious.
function FilterHeader({ label, value, onChange, width }) {
  const [open, setOpen] = useState(false);
  const active = !!String(value || '').trim();
  return (
    <th style={width ? { width } : undefined}>
      <div className={styles.thFilter}>
        <span>{label}</span>
        <button
          type="button"
          className={active ? styles.filterBtnActive : styles.filterBtn}
          onClick={() => setOpen(o => !o)}
          title={`Filter by ${label}`}
          aria-label={`Filter by ${label}`}
        >
          🔍
        </button>
      </div>
      {(open || active) && (
        <input
          className={styles.filterInput}
          value={value || ''}
          autoFocus={open}
          placeholder={`Filter ${label}…`}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { onChange(''); setOpen(false); } }}
        />
      )}
    </th>
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
  const [selectedId, setSelectedId] = useState(null);
  // Draft text for the "Find people on LinkedIn" import box.
  const [lookupDraft, setLookupDraft] = useState('');
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
        ? `${verb} "${tag}" on ${changed} — ${failed} failed`
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
  function addLookupsFromText(text) {
    if (!selected) return;
    const parsed = parseLookups(text);
    if (parsed.length === 0) return;
    const cur = Array.isArray(selected.lookups) ? selected.lookups : [];
    const seen = new Set(cur.map(l => `${(l.title || '').toLowerCase()}|${(l.company || '').toLowerCase()}`));
    const merged = [...cur];
    for (const row of parsed) {
      const key = `${row.title.toLowerCase()}|${row.company.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
    updateEvent(selected.id, { lookups: merged });
    setLookupDraft('');
  }

  function handleLookupFile(e) {
    const file = e.target.files && e.target.files[0];
    if (file) file.text().then(addLookupsFromText).catch(() => {});
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
            <table className={styles.attendeeTable}>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all mapped contacts"
                      title="Select all mapped contacts"
                      disabled={taggableAttendees.length === 0}
                      checked={allTaggableSelected}
                      ref={el => { if (el) el.indeterminate = selectedContactIds.size > 0 && !allTaggableSelected; }}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <FilterHeader label="Name" value={attFilters.name} onChange={v => setAttFilter('name', v)} />
                  <FilterHeader label="Original Title" value={attFilters.originalTitle} onChange={v => setAttFilter('originalTitle', v)} />
                  <FilterHeader label="Contact Title" value={attFilters.title} onChange={v => setAttFilter('title', v)} />
                  <FilterHeader label="Company" value={attFilters.company} onChange={v => setAttFilter('company', v)} />
                  <FilterHeader label="Email" value={attFilters.email} onChange={v => setAttFilter('email', v)} />
                  <FilterHeader label="Tags" value={attFilters.tags} onChange={v => setAttFilter('tags', v)} />
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visibleAttendees.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.tvMuted} style={{ padding: '0.6rem', textAlign: 'center' }}>
                      No attendees match the current filters.
                    </td>
                  </tr>
                ) : visibleAttendees.map(({ a, i }) => {
                  const cid = a.contactId ? String(a.contactId) : '';
                  const taggable = cid && contactsById.has(cid);
                  const tags = taggable ? contactTags(contactsById.get(cid)) : [];
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
                    <td>
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
                    </td>
                    <td>{a.originalTitle || '—'}</td>
                    <td>{a.title || '—'}</td>
                    <td>{a.company || '—'}</td>
                    <td>{a.email || '—'}</td>
                    <td>
                      {tags.length ? (
                        <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                          {tags.map(t => <span key={t} className={styles.tagChip}>{t}</span>)}
                        </span>
                      ) : (
                        <span className={styles.tvMuted}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className={styles.removeBtn} onClick={() => removeAttendee(i)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
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
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
            Paste or upload a list of <strong>titles and company names</strong> (two columns — CSV or tab-separated). Each row gets a LinkedIn people-search button, a <strong>Table View</strong> match (click to open, or <strong>+ Add</strong> a new prospect), and an editable <strong>CDM</strong>.
            {lookups.length > 0 && (
              <span style={{ marginLeft: 6 }}>
                <span style={{ color: '#166534', fontWeight: 600 }}>{lookupMatchCount} in Table View</span>
                {' · '}
                <span style={{ color: '#B45309', fontWeight: 600 }}>{lookups.length - lookupMatchCount} new</span>
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
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <button type="button" className={styles.newBtn} onClick={() => addLookupsFromText(lookupDraft)} disabled={!lookupDraft.trim()}>
                Add rows
              </button>
              <button type="button" className={styles.exportBtn} style={{ margin: 0 }} onClick={() => lookupFileRef.current?.click()}>
                Upload CSV
              </button>
              <input ref={lookupFileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" style={{ display: 'none' }} onChange={handleLookupFile} />
            </div>
          </div>

          {lookups.length > 0 && (
            <table className={styles.attendeeTable}>
              <thead>
                <tr>
                  <FilterHeader label="Title" value={lookupFilters.title} onChange={v => setLookupFilter('title', v)} />
                  <FilterHeader label="Company" value={lookupFilters.company} onChange={v => setLookupFilter('company', v)} />
                  <FilterHeader label="Table View" value={lookupFilters.tableView} onChange={v => setLookupFilter('tableView', v)} />
                  <th style={{ width: 190 }}>Suggested</th>
                  <FilterHeader label="Type" value={lookupFilters.type} onChange={v => setLookupFilter('type', v)} width={150} />
                  <th style={{ width: 140 }}>CDM</th>
                  <th style={{ width: 180 }}>Add Contact</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {lookups.map((l, i) => {
                  const prospect = matchProspect(l.company);
                  // Apply the CDM filter (kept on original index i so
                  // edit / remove still target the right row).
                  if (cdmFilter && String(prospect?.cdm || '').trim() !== cdmFilter) return null;
                  // Apply the per-column type-to-filter drafts.
                  const lookupVals = {
                    title: l.title || '',
                    company: l.company || '',
                    tableView: prospect?.company || '',
                    type: prospect?.type || '',
                  };
                  if (!LOOKUP_FILTER_KEYS.every(key => {
                    const q = String(lookupFilters[key] || '').trim().toLowerCase();
                    return !q || String(lookupVals[key]).toLowerCase().includes(q);
                  })) return null;
                  const suggestion = prospect ? null : suggestProspect(l.company);
                  const adding = addingCompanies.has(String(l.company || '').trim());
                  return (
                    <tr key={`${l.title}-${l.company}-${i}`}>
                      <td>{l.title || '—'}</td>
                      <td>{l.company || '—'}</td>
                      <td>
                        {prospect ? (
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
                        )}
                      </td>
                      <td style={{ verticalAlign: 'top' }}>
                        {prospect ? (
                          <span className={styles.tvMuted}>—</span>
                        ) : (
                          <SuggestedCell
                            rejected={!!l.suggestRejected}
                            suggestion={suggestion}
                            prospectCompanies={prospectCompanies}
                            onAccept={company => updateLookup(i, { company, suggestRejected: false })}
                            onReject={() => updateLookup(i, { suggestRejected: true })}
                          />
                        )}
                      </td>
                      <td>
                        <TypeCell prospect={prospect} onCommit={v => onUpdateProspect(prospect.id, { type: v })} />
                      </td>
                      <td>
                        <CdmCell prospect={prospect} onCommit={v => onUpdateProspect(prospect.id, { cdm: v })} />
                      </td>
                      <td>
                        <RowContactAdder
                          company={l.company}
                          title={l.title}
                          contacts={searchableContacts}
                          attendees={attendees}
                          onAdd={att => addAttendeeFromLookup(att, i)}
                          onRemove={removeAttendeeObj}
                        />
                      </td>
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
                  );
                })}
              </tbody>
            </table>
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
    </div>
  );
}
