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
import { getHubspotCache } from '../../utils/hubspotContactsCache';
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
    onAdd(attendeeFromContact(c));
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

// Per-row contact picker scoped to one company — the same flow as the
// Opps 2 page's "+ Add from <company>": predictive search across the
// HubSpot contacts already on file for that company, with a manual-add
// fallback when nobody matches. Adding a contact drops them into the
// event's attendee list.
function RowContactAdder({ company, title, contacts, attendees, onAdd }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Contacts whose HubSpot company matches this row's company, matched
  // on the normalized name so suffix / casing drift doesn't hide them.
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

  // Names / ids already on the attendee list, so options show a ✓.
  const added = useMemo(() => {
    const ids = new Set();
    const names = new Set();
    for (const a of (attendees || [])) {
      if (a.contactId) ids.add(String(a.contactId));
      names.add(String(a.name || '').toLowerCase());
    }
    return { ids, names };
  }, [attendees]);
  const isAdded = (c) => added.ids.has(String(c.id || c.vid || '')) || added.names.has(contactDisplayName(c).toLowerCase());

  // Prefix-then-substring predictive match (same ranking as Opps 2).
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster.slice(0, 8);
    const pre = [];
    const sub = [];
    for (const c of roster) {
      const name = contactDisplayName(c).toLowerCase();
      const email = String(c.email || '').toLowerCase();
      if (name.startsWith(q)) pre.push(c);
      else if (name.includes(q) || email.includes(q)) sub.push(c);
    }
    return [...pre, ...sub].slice(0, 12);
  }, [roster, query]);

  function addContact(c) { onAdd(attendeeFromContact(c)); setQuery(''); setOpen(false); }
  function addManual() {
    const name = query.trim();
    if (!name) return;
    onAdd({ contactId: '', name, email: '', company: company || '', title: title || '' });
    setQuery('');
    setOpen(false);
  }

  return (
    <div className={styles.picker} ref={wrapRef} style={{ minWidth: 170 }}>
      <input
        className={styles.cdmInput}
        style={{ border: '1px solid var(--color-border)' }}
        value={query}
        placeholder="Add contact…"
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) addContact(matches[0]); else addManual(); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <div className={styles.dropdown} style={{ minWidth: 240 }}>
          {matches.map(c => {
            const tagged = isAdded(c);
            return (
              <button key={String(c.id || c.vid)} type="button" className={styles.option} onClick={() => addContact(c)}>
                <div className={styles.optionName}>
                  {contactDisplayName(c)}{tagged && <span style={{ color: '#15803D', marginLeft: 6 }}>✓</span>}
                </div>
                <div className={styles.optionMeta}>
                  {[c.jobtitle, c.email].filter(Boolean).join(' · ') || '—'}
                </div>
              </button>
            );
          })}
          {query.trim() ? (
            <button type="button" className={`${styles.option} ${styles.addManual}`} onClick={addManual}>
              + Add "{query.trim()}" manually
            </button>
          ) : matches.length === 0 ? (
            <div style={{ padding: '0.5rem 0.7rem', fontSize: '0.74rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              No contacts on file for this company. Type a name to add them manually.
            </div>
          ) : null}
        </div>
      )}
    </div>
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
  // Company names currently being pushed to the Table View, so the
  // "+ Add" button can show progress until the prospects list updates.
  const [addingCompanies, setAddingCompanies] = useState(() => new Set());
  const [bulkAdding, setBulkAdding] = useState(false);

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

  function addAttendee(attendee) {
    if (!selected) return;
    // De-dupe HubSpot contacts by id; manual attendees by lowercased name.
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    const dup = attendee.contactId
      ? list.some(a => a.contactId && a.contactId === attendee.contactId)
      : list.some(a => !a.contactId && a.name.toLowerCase() === attendee.name.toLowerCase());
    if (dup) return;
    updateEvent(selected.id, { attendees: [...list, attendee] });
  }

  function removeAttendee(index) {
    if (!selected) return;
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    updateEvent(selected.id, { attendees: list.filter((_, i) => i !== index) });
  }

  function exportAttendeesCsv() {
    if (!selected) return;
    const list = Array.isArray(selected.attendees) ? selected.attendees : [];
    const escape = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const headers = ['Name', 'Title', 'Company', 'Email'];
    const rows = list.map(a => [a.name, a.title, a.company, a.email].map(escape).join(','));
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

  const attendees = selected && Array.isArray(selected.attendees) ? selected.attendees : [];
  const lookups = selected && Array.isArray(selected.lookups) ? selected.lookups : [];
  const lookupMatchCount = useMemo(
    () => lookups.reduce((n, l) => n + (matchProspect(l.company) ? 1 : 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookups, prospectByCompanyKey],
  );
  const newLookupCount = lookups.length - lookupMatchCount;

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

          <AttendeePicker contacts={contacts} existingIds={existingIds} onAdd={addAttendee} />

          {attendees.length === 0 ? (
            <div className={styles.emptyAttendees}>
              No attendees saved yet. Use the search box above to add contacts.
            </div>
          ) : (
            <table className={styles.attendeeTable}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {attendees.map((a, i) => (
                  <tr key={`${a.contactId || 'manual'}-${i}`}>
                    <td>
                      {a.name}
                      {!a.contactId && (
                        <span style={{ marginLeft: 6, fontSize: '0.64rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                          (manual)
                        </span>
                      )}
                    </td>
                    <td>{a.title || '—'}</td>
                    <td>{a.company || '—'}</td>
                    <td>{a.email || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className={styles.removeBtn} onClick={() => removeAttendee(i)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className={styles.sectionTitle}>
            Find people on LinkedIn
            <span className={styles.countPill}>{lookups.length}</span>
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
                  <th>Title</th>
                  <th>Company</th>
                  <th>Table View</th>
                  <th>Suggested</th>
                  <th style={{ width: 150 }}>Type</th>
                  <th style={{ width: 140 }}>CDM</th>
                  <th style={{ width: 180 }}>Add Contact</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {lookups.map((l, i) => {
                  const prospect = matchProspect(l.company);
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
                      <td>
                        {prospect ? (
                          <span className={styles.tvMuted}>—</span>
                        ) : suggestion ? (
                          <button
                            type="button"
                            className={styles.tvSuggest}
                            title={`Fuzzy match — open "${suggestion.company}" in the Table View`}
                            onClick={() => onSelectProspect(suggestion)}
                          >
                            ≈ {suggestion.company}
                          </button>
                        ) : (
                          <span className={styles.tvMuted}>—</span>
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
                          contacts={contacts}
                          attendees={attendees}
                          onAdd={addAttendee}
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
    </div>
  );
}
