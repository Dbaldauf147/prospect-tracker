import { Component, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotCache, updateHubspotCache } from '../../utils/hubspotContactsCache';
import { dbGet } from '../../utils/db';
import { formatAum } from '../../utils/formatters';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import { buildCompanyGuessIndex, guessCompanyForContact } from '../../utils/companyGuess';
import { matchesCdm } from '../../utils/cdmMatch';
import { useDraftCampaignQueue, toggleQueuedContact, setQueuedContactIds } from '../../utils/draftCampaignQueue';

// Click-to-edit cell used inside the All Contacts table. Idle state
// renders the value as plain text; on click it switches to an <input>
// (or autocomplete-style combobox when `suggestions` is provided),
// commits on blur / Enter, and discards on Escape. The actual write
// is delegated to `onCommit(nextValue)` so the parent can call the
// HubSpot endpoint and update the cache.

// Inline editor for the dans_tags HubSpot field. Renders each tag as
// a removable pill (× drops it) with a "+" button that opens a small
// dropdown of every tag option NOT already on this contact. onCommit
// receives the new ;-joined string so the parent's existing
// inlineUpdateField('dans_tags', …) path keeps working.
function TagsInlineCell({ value, options, onCommit }) {
  const tags = useMemo(() => String(value || '').split(';').map(s => s.trim()).filter(Boolean), [value]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) { setPickerOpen(false); setDraft(''); } }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  function commit(nextTags) {
    const out = [...new Set(nextTags.map(t => String(t || '').trim()).filter(Boolean))];
    onCommit(out.join(';'));
  }
  function removeTag(tag) {
    commit(tags.filter(t => t.toLowerCase() !== String(tag).toLowerCase()));
  }
  function addTag(tag) {
    const v = String(tag || '').trim();
    if (!v) return;
    if (tags.some(t => t.toLowerCase() === v.toLowerCase())) { setPickerOpen(false); setDraft(''); return; }
    commit([...tags, v]);
    setPickerOpen(false);
    setDraft('');
  }

  const lowerTagSet = new Set(tags.map(t => t.toLowerCase()));
  const filteredOpts = (options || [])
    .filter(o => !lowerTagSet.has(String(o).toLowerCase()))
    .filter(o => !draft.trim() || String(o).toLowerCase().includes(draft.trim().toLowerCase()))
    .slice(0, 30);
  const draftIsNewTag = draft.trim()
    && !lowerTagSet.has(draft.trim().toLowerCase())
    && !filteredOpts.some(o => o.toLowerCase() === draft.trim().toLowerCase());

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', padding: '0.15rem 0.2rem', minHeight: '1.4rem' }}>
      {tags.map(tag => (
        <span
          key={tag}
          title={`Click × to remove "${tag}"`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 2,
            background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1E40AF',
            padding: '0 5px', borderRadius: 999,
            fontSize: '0.62rem', fontWeight: 600, lineHeight: '1.4',
            whiteSpace: 'nowrap',
          }}
        >
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
            style={{ background: 'none', border: 'none', color: '#93C5FD', fontSize: '0.7rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
            aria-label={`Remove ${tag}`}
          >×</button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => setPickerOpen(o => !o)}
        title="Add a tag"
        style={{
          background: pickerOpen ? '#1E40AF' : 'transparent',
          color: pickerOpen ? '#fff' : '#475569',
          border: '1px dashed #94A3B8',
          fontSize: '0.6rem', fontWeight: 700,
          cursor: 'pointer', padding: '1px 5px',
          borderRadius: 999, lineHeight: 1.2,
        }}
      >+</button>
      {pickerOpen && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 30,
            background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6,
            boxShadow: '0 8px 20px rgba(15,23,42,0.12)',
            minWidth: 200, maxHeight: 240, overflowY: 'auto',
            padding: '0.2rem 0',
            fontSize: '0.72rem',
          }}
        >
          <div style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid #F1F5F9' }}>
            <input
              type="text"
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (filteredOpts[0]) addTag(filteredOpts[0]);
                  else if (draftIsNewTag) addTag(draft.trim());
                } else if (e.key === 'Escape') {
                  setPickerOpen(false); setDraft('');
                }
              }}
              placeholder="Filter tags or type a new one…"
              style={{ width: '100%', padding: '3px 6px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.7rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          {filteredOpts.length === 0 && !draftIsNewTag && (
            <div style={{ padding: '0.4rem 0.6rem', color: '#94A3B8', fontStyle: 'italic' }}>No matching tags.</div>
          )}
          {filteredOpts.map(o => (
            <button
              key={o}
              type="button"
              onClick={() => addTag(o)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '0.3rem 0.6rem', border: 'none', background: 'transparent',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem',
                color: '#1E293B',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#EFF6FF')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >{o}</button>
          ))}
          {draftIsNewTag && (
            <button
              type="button"
              onClick={() => addTag(draft.trim())}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '0.3rem 0.6rem', border: 'none', background: '#F0FDF4',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem',
                color: '#166534', fontWeight: 600,
                borderTop: filteredOpts.length > 0 ? '1px solid #DCFCE7' : 'none',
              }}
            >+ Add new tag: "{draft.trim()}"</button>
          )}
        </div>
      )}
    </div>
  );
}

function InlineCell({
  value,
  onCommit,
  placeholder = '—',
  emptyColor = '#CBD5E1',
  fontSize = '0.72rem',
  fontWeight = 400,
  textColor = '#1E293B',
  align = 'left',
  type = 'text',
  suggestions = null,
  title,
  disabled = false,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [hover, setHover] = useState(0);
  // Tracks whether the user has actively navigated the suggestion
  // list (ArrowDown / ArrowUp). Without this signal, pressing Enter
  // would always commit matches[0] — which means typing a value that
  // happens to be a fuzzy substring of an existing suggestion would
  // silently get rewritten. With it, Enter prefers the typed text
  // unless the user explicitly navigated to a suggestion.
  const [navigated, setNavigated] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      try { inputRef.current.select(); } catch {}
    }
  }, [editing]);
  useEffect(() => {
    if (!editing) return;
    const onDown = (e) => {
      if (!wrapperRef.current?.contains(e.target)) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [editing]);
  function startEdit() {
    if (disabled) return;
    setDraft(value || '');
    setHover(0);
    setSuggestionsOpen(!!suggestions);
    setEditing(true);
  }
  async function commit(v) {
    setEditing(false);
    setSuggestionsOpen(false);
    const next = (v ?? draft).trim();
    if (next === (value || '').trim()) return;
    try { await onCommit(next); } catch (err) { console.warn('Inline commit failed', err); }
  }
  if (!editing) {
    const empty = value === null || value === undefined || value === '';
    return (
      <div
        onClick={startEdit}
        title={title || (disabled ? value || '' : 'Click to edit')}
        style={{
          padding: '0.45rem 0.6rem',
          fontSize,
          fontWeight,
          color: empty ? emptyColor : textColor,
          textAlign: align,
          cursor: disabled ? 'default' : 'text',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >{empty ? placeholder : value}</div>
    );
  }
  const q = (draft || '').trim().toLowerCase();
  const matches = suggestions && suggestions.length > 0
    ? (q ? suggestions.filter(n => String(n).toLowerCase().includes(q)).slice(0, 50) : suggestions.slice(0, 50))
    : [];
  const showSuggestionList = !!suggestions && suggestionsOpen && matches.length > 0;
  return (
    <div ref={wrapperRef} style={{ position: 'relative', padding: '0.2rem 0.3rem' }}>
      <input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={e => { setDraft(e.target.value); setHover(0); setNavigated(false); if (suggestions) setSuggestionsOpen(true); }}
        onBlur={() => commit()}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (showSuggestionList && navigated && matches[hover] !== undefined) commit(matches[hover]);
            else commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
            setSuggestionsOpen(false);
          } else if (showSuggestionList) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setNavigated(true); setHover(h => Math.min(h + 1, matches.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setNavigated(true); setHover(h => Math.max(h - 1, 0)); }
          }
        }}
        style={{
          width: '100%',
          padding: '0.25rem 0.4rem',
          fontSize,
          fontFamily: 'inherit',
          border: '1px solid #93C5FD',
          borderRadius: 4,
          textAlign: align,
        }}
      />
      {suggestions && suggestionsOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          // Let the dropdown overflow the cell to the right so long
          // company names aren't visually clipped by the column width.
          minWidth: '100%',
          width: 'max-content',
          maxWidth: 480,
          marginTop: 2,
          zIndex: 30,
          maxHeight: 280,
          overflowY: 'auto',
          background: '#fff',
          border: '1px solid #CBD5E1',
          borderRadius: 6,
          boxShadow: '0 6px 16px rgba(15,23,42,0.12)',
        }}>
          <div style={{ position: 'sticky', top: 0, background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', padding: '0.25rem 0.6rem', fontSize: '0.6rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
            {(suggestions || []).length === 0
              ? 'No Table View companies loaded'
              : draft.trim()
                ? `${matches.length} of ${(suggestions || []).length} match "${draft.trim()}"`
                : `${(suggestions || []).length} Table View companies`}
          </div>
          {matches.length > 0 ? matches.map((n, i) => (
            <div
              key={n}
              onMouseDown={e => { e.preventDefault(); commit(n); }}
              onMouseEnter={() => { setHover(i); setNavigated(true); }}
              style={{
                padding: '0.4rem 0.6rem',
                fontSize: '0.78rem',
                cursor: 'pointer',
                background: i === hover && navigated ? '#EFF6FF' : '#fff',
                color: '#1E293B',
                borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={n}
            >{n}</div>
          )) : (
            // No prospect company matches — let the user know the
            // typed value doesn't exist in their Table View yet, and
            // that pressing Enter will still save it as-is.
            <div style={{ padding: '0.5rem 0.6rem', fontSize: '0.7rem', color: '#64748B', fontStyle: 'italic' }}>
              {draft.trim()
                ? <>No Table View company matches <strong style={{ color: '#1E293B', fontStyle: 'normal' }}>"{draft.trim()}"</strong>. Press <strong style={{ color: '#1E293B', fontStyle: 'normal' }}>Enter</strong> to save your typed value as-is.</>
                : <>Start typing to filter the {(suggestions || []).length} Table View companies.</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb) return true;
  const sLonger = sa.length >= sb.length ? sa : sb;
  const sShorter = sa.length >= sb.length ? sb : sa;
  if (sShorter.length >= 4 && sShorter.length >= sLonger.length * 0.6 && sLonger.includes(sShorter)) return true;
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

export function useOppsRecords(userId) {
  const [records, setRecords] = useState([]);
  useEffect(() => {
    let cancelled = false;
    async function loadFromIndexedDB() {
      try { const data = await dbGet('opps-cache', 'data'); return data?.records || null; } catch { return null; }
    }
    function loadFromLocalStorage() {
      try { const cache = JSON.parse(localStorage.getItem('opps-cache')); return cache?.records || null; } catch { return null; }
    }
    async function loadFromFirestore() {
      if (!userId) return null;
      try {
        const ref = doc(db, 'oppsData', userId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return null;
        const raw = snap.data();
        if (!raw?.json) return null;
        const parsed = JSON.parse(raw.json);
        return parsed?.records || null;
      } catch { return null; }
    }
    (async () => {
      let recs = await loadFromIndexedDB();
      if (!recs || recs.length === 0) recs = loadFromLocalStorage();
      if (!recs || recs.length === 0) recs = await loadFromFirestore();
      if (!cancelled && recs && recs.length > 0) setRecords(recs);
    })();
    return () => { cancelled = true; };
  }, [userId]);
  return records;
}

// Defaults for the original "Dan Key Target" page. Other tabs (e.g. the
// Active Contacts tab) override these to reuse the same UI.
const KEY_TARGET_SELECTOR = (c) => {
  const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
  if (tags.includes('hide')) return false;
  // Contacts who have left their company live on the Changed Jobs tab
  // — keep them out of the Key Contacts list so the page only shows
  // people still at their target accounts.
  if (tags.includes('left')) return false;
  return tags.includes('dan key target');
};

// Class-based boundary so a render-time crash inside the contacts table
// (e.g., a malformed prospect row, an inline-edit closure issue, a
// resize handler dereferencing null) shows an inline error instead of
// blanking the whole page. The reset button clears the per-page
// localStorage prefs that most often trigger persistent crashes.
class ContactsErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('KeyContactsView render crashed', error, info);
  }
  resetPrefsAndReload() {
    try {
      const prefix = this.props.storagePrefix || 'key-contacts';
      const drop = [
        'visible-cols', 'contact-col-widths', 'contact-col-filters',
        'contact-sort-key', 'contact-sort-dir', 'view-mode',
        'col-widths', 'sort-key', 'sort-dir',
      ];
      for (const k of drop) {
        try { localStorage.removeItem(`${prefix}:${k}`); } catch {}
      }
    } catch {}
    window.location.reload();
  }
  render() {
    if (this.state.error) {
      const msg = String(this.state.error?.message || this.state.error || 'Unknown error');
      return (
        <div style={{ padding: '1.25rem', fontFamily: 'inherit' }}>
          <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Contacts page failed to render</h2>
          <p style={{ color: '#475569', fontSize: 13 }}>
            Something in this page's render or recent interaction threw an error. The reset button below clears your per-page column widths / filter / sort preferences in localStorage and reloads — your HubSpot data and Firestore settings are not affected.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', margin: '0.75rem 0' }}>
            <button
              type="button"
              onClick={() => this.resetPrefsAndReload()}
              style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '0.45rem 0.9rem', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600 }}
            >Reset page prefs and reload</button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              style={{ background: 'transparent', color: '#334155', border: '1px solid #94a3b8', borderRadius: 6, padding: '0.45rem 0.9rem', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
            >Try again</button>
          </div>
          <details style={{ fontSize: 12, color: '#64748b', marginTop: '0.75rem' }}>
            <summary style={{ cursor: 'pointer' }}>Error details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '0.5rem', background: '#f1f5f9', padding: '0.5rem', borderRadius: 4 }}>{msg}</pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

export function KeyContactsView(props) {
  return (
    <ContactsErrorBoundary storagePrefix={props.storagePrefix || 'key-contacts'}>
      <KeyContactsViewInner {...props} />
    </ContactsErrorBoundary>
  );
}

function KeyContactsViewInner({
  prospects = [],
  onSelectProspect,
  cdmName = '',
  settings = {},
  updateSettings = () => {},
  storagePrefix = 'key-contacts',
  pageTitle = 'Key Contacts',
  pageSubtitle = (
    <>Every HubSpot contact tagged <code>Dan Key Target</code>. Toggle <strong>All Contacts</strong> for a flat name-by-name table or <strong>By Company</strong> to roll them up by account with opportunities and decision-maker stats.</>
  ),
  emptyTitle = 'No "Dan Key Target" contacts found',
  emptyDetail = (
    <>Tag a HubSpot contact with <code>Dan Key Target</code> in the HubSpot Contacts tab and they'll show up here.</>
  ),
  contactSelector = KEY_TARGET_SELECTOR,
  metInPersonSelector = (c) => (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase().includes('met in person'),
  requireActiveOpp = false,
  // When true, only keep contacts whose company doesn't match any
  // prospect on the Table View (matched via companiesMatch + email
  // domain). Useful for surfacing "we're emailing them but haven't
  // tracked their company yet" gaps.
  unmappedOnly = false,
  // Adds a "Suggested Company" column that guesses a Table View
  // company for each contact based on their email domain / current
  // Company text. Most useful when paired with `unmappedOnly`.
  showSuggestedCompany = false,
  // When provided, fires with the count of contacts that would pass
  // the "active in past 30 days AND not in Table View" filter — used
  // by ActiveContactsView to label the toggle checkbox. The count is
  // emitted regardless of whether `unmappedOnly` is currently on so
  // the user can see how many rows the filter would expose before
  // flipping it.
  onUnmappedPast30CountChange,
}) {
  const lsKey = (suffix) => `${storagePrefix}:${suffix}`;
  const { user } = useAuth();
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState('');
  // Mass-edit state. When `massMode` is on the All Contacts table grows
  // a checkbox column and a toolbar surfaces at the top to apply a
  // single field value across every checked contact via the HubSpot
  // update endpoint.
  const [massMode, setMassMode] = useState(false);
  const [massSelected, setMassSelected] = useState(() => new Set());
  // IDs queued for the Custom Email Campaign on the Draft Emails page.
  // Persisted in localStorage and shared across Active / Client / Key
  // Contacts (all three render via this component) so a checkbox
  // toggled here surfaces in the Drafts page's queue immediately.
  const queuedIds = useDraftCampaignQueue();
  const queuedSet = useMemo(() => new Set(queuedIds), [queuedIds]);
  const [massField, setMassField] = useState('company');
  const [massValue, setMassValue] = useState('');
  const [massStatus, setMassStatus] = useState(null); // { type, message }
  const [massProcessing, setMassProcessing] = useState(false);
  const [massCompanyOpen, setMassCompanyOpen] = useState(false);
  const [massCompanyHover, setMassCompanyHover] = useState(0);
  const massCompanyBoxRef = useRef(null);
  useEffect(() => {
    if (!massCompanyOpen) return;
    const onDown = (e) => { if (!massCompanyBoxRef.current?.contains(e.target)) setMassCompanyOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [massCompanyOpen]);
  function toggleMassSelect(id) {
    setMassSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  // Append the "hide" tag to a contact's existing Dan's Tags. The
  // contactSelector for both Key Contacts and Active Contacts skips
  // anything tagged "hide", so the row vanishes after the cache event
  // fires. Existing tags are preserved.
  // Persist a single-field edit on one contact via the HubSpot
  // update endpoint and mirror the change into the local cache so
  // the row reflects it immediately. Used by InlineCell-driven edits
  // on the All Contacts table.
  async function inlineUpdateField(contact, field, value) {
    const id = String(contact?.id || contact?.vid || '');
    if (!id || !field) return;
    const next = (value ?? '').trim();
    let companyAssignment = null;
    try {
      const res = await fetch('/api/hubspot?action=update-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: id, properties: { [field]: next } }),
      });
      const json = await res.json();
      if (json.error || !res.ok) throw new Error(json.error || `HubSpot ${res.status}`);
      companyAssignment = json.companyAssignment || null;
    } catch (err) {
      console.warn('Inline update failed', err);
      setMassStatus({ type: 'partial', message: `Save failed: ${err?.message || 'unknown error'}` });
      return;
    }
    try {
      await updateHubspotCache(draft => {
        const target = draft.contacts.find(x => String(x.id || x.vid) === id);
        if (target) target[field] = next;
      });
    } catch (err) { console.warn('Inline cache update failed', err); }
    // Company-field saves also need the local-override pin so the
    // typed value sticks when HubSpot's fuzzy Company match resolves
    // to a record whose name differs (e.g. "Prologis" → "Prologis
    // Inc"). Mirror HubSpotView.handleInlineUpdate's behavior:
    //   - association failed entirely → keep override = typed value
    //   - association succeeded but matched-name differs → keep override
    //   - association succeeded with matching name → clear override
    if (field === 'company') {
      const cur = settings?.contactLocalFields || {};
      const merged = { ...(cur[id] || {}) };
      let didChange = false;
      if (!companyAssignment || companyAssignment.ok === false || companyAssignment.nameDiffers) {
        if (merged._companyOverride !== next) {
          merged._companyOverride = next;
          didChange = true;
        }
        if (companyAssignment?.nameDiffers && companyAssignment?.matchedName) {
          setMassStatus({ type: 'success', message: `Saved "${next}" locally. HubSpot linked this contact to "${companyAssignment.matchedName}" — Prospect Tracker will keep your typed value here.` });
        }
      } else if (merged._companyOverride !== undefined) {
        delete merged._companyOverride;
        didChange = true;
      }
      if (didChange) {
        const nextLocal = { ...cur };
        if (Object.keys(merged).length === 0) delete nextLocal[id];
        else nextLocal[id] = merged;
        updateSettings({ contactLocalFields: nextLocal });
      }
    }
  }

  async function applyHideTag(contactIds) {
    if (!contactIds || contactIds.length === 0) return { updated: 0, errors: 0, errorMessage: '' };
    const idSet = new Set(contactIds.map(String));
    const cache = hubspotCache?.contacts || [];
    let updated = 0;
    let errors = 0;
    let firstErrorMessage = '';
    const successfulIds = new Set();
    for (const id of idSet) {
      const c = cache.find(x => String(x.id) === id) || cache.find(x => String(x.vid) === id);
      const raw = (c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '');
      const parts = raw.split(';').map(s => s.trim()).filter(Boolean);
      const lower = new Set(parts.map(p => p.toLowerCase()));
      if (lower.has('hide')) { updated += 1; successfulIds.add(id); continue; }
      parts.push('Hide');
      // Use ';' (no space) to match the separator HubSpotView's tag
      // picker uses; some HubSpot enum properties reject leading
      // whitespace on values.
      const nextTags = parts.join(';');
      try {
        const res = await fetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: id, properties: { dans_tags: nextTags } }),
        });
        const json = await res.json();
        if (json.error || !res.ok) {
          errors += 1;
          if (!firstErrorMessage) firstErrorMessage = json.error || `HubSpot ${res.status}`;
          continue;
        }
        updated += 1;
        successfulIds.add(id);
      } catch (err) {
        errors += 1;
        if (!firstErrorMessage) firstErrorMessage = err?.message || 'Network error';
      }
    }
    // Only mirror the successful writes into the local cache so the
    // row only disappears when HubSpot actually accepted the change.
    if (successfulIds.size > 0) {
      try {
        await updateHubspotCache(draft => {
          for (const c of draft.contacts) {
            if (!successfulIds.has(String(c.id || c.vid))) continue;
            const existing = (c.dans_tags || c.dan_s_tags || c.dans_tag || '');
            const parts = existing.split(';').map(s => s.trim()).filter(Boolean);
            if (parts.some(p => p.toLowerCase() === 'hide')) continue;
            parts.push('Hide');
            c.dans_tags = parts.join(';');
          }
        });
      } catch (err) { console.warn('Hide cache update failed', err); }
    }
    return { updated, errors, errorMessage: firstErrorMessage };
  }

  // Push a suggested-company value onto the contact in HubSpot and
  // update the local cache so the row reflects the new mapping (and
  // the unmapped-only filter, if active, drops it).
  async function applySuggestedCompany(contact, suggested) {
    const id = String(contact?.id || contact?.vid || '');
    if (!id || !suggested) return;
    setMassProcessing(true);
    setMassStatus(null);
    let ok = false;
    try {
      const res = await fetch('/api/hubspot?action=update-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: id, properties: { company: suggested } }),
      });
      const json = await res.json();
      ok = !json.error;
    } catch { ok = false; }
    if (ok) {
      try {
        await updateHubspotCache(draft => {
          const target = draft.contacts.find(x => String(x.id || x.vid) === id);
          if (target) target.company = suggested;
        });
      } catch (err) { console.warn('Suggested-company cache update failed', err); }
      setMassStatus(null);
    } else {
      setMassStatus({ type: 'partial', message: 'Apply failed' });
    }
    setMassProcessing(false);
  }

  async function handleHideRow(contact) {
    const id = String(contact?.id || contact?.vid || '');
    if (!id) return;
    setMassProcessing(true);
    setMassStatus(null);
    const { updated, errors, errorMessage } = await applyHideTag([id]);
    setMassProcessing(false);
    if (errors > 0) {
      const hint = /allowed options/i.test(errorMessage)
        ? ' — add "Hide" to the Dan\'s Tags allowed values in HubSpot Settings → Properties.'
        : '';
      setMassStatus({ type: 'partial', message: `Hide failed: ${errorMessage}${hint}` });
    } else {
      setMassStatus(null);
      void updated;
    }
  }

  async function handleMassHide() {
    if (massSelected.size === 0) return;
    if (!window.confirm(`Hide ${massSelected.size} selected contact${massSelected.size === 1 ? '' : 's'}? This adds the "Hide" tag in HubSpot so they stop appearing here.`)) return;
    setMassProcessing(true);
    setMassStatus(null);
    const { updated, errors, errorMessage } = await applyHideTag([...massSelected]);
    const hint = errors > 0 && /allowed options/i.test(errorMessage)
      ? ' — add "Hide" to the Dan\'s Tags allowed values in HubSpot Settings → Properties.'
      : '';
    setMassStatus({
      type: errors === 0 ? 'success' : 'partial',
      message: `Hid ${updated} contact${updated === 1 ? '' : 's'}${errors > 0 ? `, ${errors} failed: ${errorMessage}${hint}` : ''}`,
    });
    setMassProcessing(false);
    setMassSelected(new Set());
  }

  // Download the currently visible contacts as a CSV. Honors the
  // active query, per-column filters, and sort order so the file is a
  // 1:1 dump of what's on screen. Used by the Download button on the
  // All Contacts view; in By Company mode we still flatten every
  // contact across the visible rows.
  // Combined export across Key / Active / Client tabs. Each contact
  // only appears once; the Categories column lists every tab they
  // qualify for (comma-separated). Output is a Schneider-green-themed
  // .xlsx workbook (not raw CSV) so the user can scan / filter inside
  // Excel and the file looks consistent with the Indicative Savings
  // export on the Sites page.
  async function downloadCombinedContactsCsv() {
    const cache = hubspotCache?.contacts || [];
    if (cache.length === 0) {
      alert('No HubSpot contacts loaded — sync HubSpot Contacts first.');
      return;
    }
    const local = settings?.contactLocalFields || {};
    // Build the Client / Old Client filter sets the same way the
    // ClientContactsView selector does — CDM-scoped Client list +
    // global Old Client list (so Old Client suppresses regardless of
    // CDM, mirroring the page). Active Contacts page additionally
    // suppresses contacts at ANY Client (not just the user's CDM-
    // scoped clients), so we keep a separate `allClientCompanies` /
    // `allClientDomains` set just for the Active suppression.
    const clientCompanies = new Set();
    const clientDomains = new Set();
    const oldClientCompanies = new Set();
    const oldClientDomains = new Set();
    const allClientCompanies = new Set();
    const allClientDomains = new Set();
    function collectDomains(p, into) {
      if (p?.emailDomain) {
        for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
          const at = entry.lastIndexOf('@');
          const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
          if (d) into.add(d);
        }
      }
      if (p?.website) {
        const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
        if (d) into.add(d);
      }
    }
    for (const p of (prospects || [])) {
      if (p.status === 'Client') {
        if (p.company) allClientCompanies.add(String(p.company).toLowerCase().trim());
        collectDomains(p, allClientDomains);
        if (matchesCdm(p.cdm, cdmName)) {
          if (p.company) clientCompanies.add(String(p.company).toLowerCase().trim());
          collectDomains(p, clientDomains);
        }
      }
      if (p.status === 'Old Client') {
        if (p.company) oldClientCompanies.add(String(p.company).toLowerCase().trim());
        collectDomains(p, oldClientDomains);
      }
    }
    const SCHNEIDER_RE = /\bschneider\s*electric\b/i;
    const SCHNEIDER_DOMAIN_RE = /(^|\.)(se\.com|schneider-electric\.com|schneider\.com)$/i;
    function isSchneider(c) {
      if (SCHNEIDER_RE.test(String(c.company || ''))) return true;
      const e = String(c.email || '').toLowerCase().trim();
      const at = e.lastIndexOf('@');
      if (at >= 0) {
        const d = e.slice(at + 1).trim();
        if (SCHNEIDER_DOMAIN_RE.test(d)) return true;
      }
      return false;
    }
    // Active = at least one HubSpot email-activity timestamp in the
    // last 90 days AND the contact's company has at least one open /
    // active opportunity in the Opps tab (matches ActiveContactsView's
    // default + requireActiveOpp behavior). Without the opp gate the
    // export would include companies the user isn't actively working
    // (LLR Partners etc.).
    //
    // Normalize both sides so trailing punctuation (`,`),
    // parent-disclosure parentheticals (`(a Stonepeak co.)`), and
    // corporate suffixes (Inc / LLC / Ltd / Corp / Co / GmbH / etc.)
    // don't sink the match — the Active Contacts page tolerates these
    // via fuzzy companiesMatch and we want the export to surface the
    // same rows.
    const NORM_CORP_RE = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|holdings|group|grp)\b\.?/g;
    const normalizeCompanyText = (s) => String(s || '')
      .toLowerCase()
      .replace(/\s*\([^)]*\)\s*$/g, ' ')
      .replace(/[,.;:]+/g, ' ')
      .replace(NORM_CORP_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Keep both the lowercased original Account string AND a
    // normalized form. The export now mirrors the Active Contacts
    // page's matching cascade — exact (lowercased) → companiesMatch
    // fuzz → normalized-string equality — so short / multi-word
    // accounts like "URW" vs an opp called "URW Westfield" still pair
    // up. Using only the normalized set lookup misses those because
    // "urw westfield" doesn't equal "urw".
    const activeOppAccounts = [];
    const activeOppNormSet = new Set();
    for (const r of (oppsRecords || [])) {
      const stage = String(r.Stage || '').trim();
      if (!stage || INVALID_STAGES.has(stage) || CLOSED_STAGES.has(stage)) continue;
      const raw = String(r.Account || '').trim();
      if (!raw) continue;
      activeOppAccounts.push(raw);
      const norm = normalizeCompanyText(raw);
      if (norm) activeOppNormSet.add(norm);
    }
    const ACTIVE_CUTOFF = Date.now() - 90 * 86400000;
    const ACTIVITY_FIELDS = ['hs_email_last_send_date', 'hs_sales_email_last_replied', 'hs_email_last_open_date', 'hs_email_last_click_date', 'notes_last_contacted'];
    function isActive(c) {
      for (const f of ACTIVITY_FIELDS) {
        const v = c[f];
        if (!v) continue;
        const ts = Date.parse(v);
        if (!Number.isNaN(ts) && ts >= ACTIVE_CUTOFF) return true;
      }
      return false;
    }
    function emailDomainOf(c) {
      const e = String(c.email || '').toLowerCase().trim();
      const at = e.lastIndexOf('@');
      if (at < 0) return '';
      const d = e.slice(at + 1).trim();
      return d && !FREE_MAIL.has(d) ? d : '';
    }
    const out = [];
    for (const baseC of cache) {
      const lf = local[String(baseC.id || baseC.vid || '')] || null;
      const c = lf && typeof lf._companyOverride === 'string' && lf._companyOverride
        ? { ...baseC, company: lf._companyOverride }
        : baseC;
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide')) continue;
      if (tags.includes('left')) continue;
      if (isSchneider(c)) continue;
      const companyLower = String(c.company || '').trim().toLowerCase();
      const domain = emailDomainOf(c);
      const categories = [];
      // Key Contacts
      if (tags.includes('dan key target')) categories.push('Key');
      // Client Contacts
      const blockedByOldClient = (companyLower && oldClientCompanies.has(companyLower)) || (domain && oldClientDomains.has(domain));
      if (!blockedByOldClient) {
        const isClient = (companyLower && clientCompanies.has(companyLower)) || (!companyLower && domain && clientDomains.has(domain));
        if (isClient) categories.push('Client');
      }
      // Active Contacts (drops Key Targets and Clients to mirror the
      // page's exclusion rules — they live on the other tabs). Also
      // requires the contact's company to have at least one open /
      // active opportunity in the Opps tab so the export tracks what
      // the user actually sees on Active Contacts.
      // Active Contacts page suppresses against ALL clients (any CDM),
      // not just the logged-in user's clients, so use the wider sets.
      const isClientForActive = (companyLower && allClientCompanies.has(companyLower)) || (!companyLower && domain && allClientDomains.has(domain));
      // Match the contact's company against the open-opp Account list
      // using the same exact → fuzzy → normalized cascade the Active
      // Contacts page applies. Exact (lowercased) catches the common
      // case; companiesMatch handles short names (e.g. "URW" vs "URW
      // Westfield") and corporate-suffix drift; the normalized-set
      // fallback handles trailing "(a Stonepeak co.)" / "Inc." etc.
      const cName = String(c.company || '').trim();
      const cNameLower = cName.toLowerCase();
      let hasActiveOpp = false;
      if (cName) {
        hasActiveOpp = activeOppAccounts.some(a => a.toLowerCase() === cNameLower)
          || activeOppAccounts.some(a => companiesMatch(a, cName))
          || activeOppNormSet.has(normalizeCompanyText(cName));
      }
      if (isActive(c) && hasActiveOpp && !tags.includes('dan key target') && !isClientForActive) {
        categories.push('Active');
      }
      if (categories.length === 0) continue;
      out.push({ contact: c, categories });
    }
    if (out.length === 0) {
      alert('No contacts qualify for any of the three tabs.');
      return;
    }
    // Schneider-branded XLSX export. Same green palette as the
    // Indicative Savings workbook on the Sites page so the company
    // collateral looks consistent. Column widths are capped at 30 —
    // wide enough to show most emails / titles without wrapping, but
    // not so wide that the sheet stops fitting on a normal screen.
    const { Workbook } = await import('exceljs');
    const SE_GREEN_DARK = 'FF009530';
    const SE_GREEN_LIGHT = 'FFE6F7EC';
    const SE_GREEN = 'FF3DCD58';
    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();
    const ws = wb.addWorksheet('Contacts (Combined)', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
    });
    const columns = [
      { label: 'Categories',    width: 22, get: ({ categories }) => categories.join(', ') },
      { label: 'Full Name',     width: 24, get: ({ contact: c }) => [c.firstname, c.lastname].filter(Boolean).join(' ') },
      { label: 'Title',         width: 30, get: ({ contact: c }) => c.jobtitle || '' },
      { label: 'Company',       width: 30, get: ({ contact: c }) => c.company || '' },
      { label: 'Email',         width: 30, get: ({ contact: c }) => c.email || '' },
      { label: 'Phone',         width: 18, get: ({ contact: c }) => c.phone || '' },
      { label: 'City',          width: 18, get: ({ contact: c }) => c.city || '' },
      { label: 'State',         width: 16, get: ({ contact: c }) => c.state || '' },
      { label: 'Country',       width: 16, get: ({ contact: c }) => c.country || '' },
      { label: 'LinkedIn URL',  width: 30, get: ({ contact: c }) => c.hs_linkedin_url || c.linkedin_url || '' },
      { label: 'Met In Person', width: 14, get: ({ contact: c }) => {
        const t = String(c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
        return t.includes('met in person') ? 'Yes' : '';
      } },
      { label: 'Events',        width: 30, get: ({ contact: c }) => contactEvents[String(c.id || '')] || '' },
      { label: 'Tags',          width: 30, get: ({ contact: c }) => c.dans_tags || c.dan_s_tags || c.dans_tag || '' },
    ];
    ws.columns = columns.map(c => ({ width: Math.min(c.width, 30) }));

    // Title row — Schneider green band, white text.
    ws.mergeCells(1, 1, 1, columns.length);
    const title = ws.getCell(1, 1);
    title.value = `Contacts (Combined: Key + Active + Client) · ${out.length} contact${out.length === 1 ? '' : 's'}`;
    title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 28;

    // Spacer row 2 left blank for visual breathing room.
    ws.getRow(2).height = 6;

    // Header row 3 — light-green wash, dark-green bold text.
    const headerRow = ws.getRow(3);
    columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.label;
      cell.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_GREEN_DARK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
    });
    headerRow.height = 22;

    // Data rows.
    out.forEach((entry, idx) => {
      const r = 4 + idx;
      const row = ws.getRow(r);
      columns.forEach((col, i) => {
        const cell = row.getCell(i + 1);
        cell.value = col.get(entry);
        cell.font = { name: 'Nunito Sans', size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: false };
        // Subtle alternating-row banding in Schneider light green.
        if (idx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6FCF8' } };
        }
      });
      row.height = 18;
    });

    // Auto-filter on the header row so the user can sort / filter
    // straight from Excel.
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `contacts-combined-${date}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadContactsCsv() {
    const list = viewMode === 'contacts'
      ? filteredContacts
      : filteredRows.flatMap(row => row.contacts.map(c => ({
          ...c,
          companyName: row.companyName,
          prospect: row.prospect,
        })));
    if (!list || list.length === 0) {
      alert('No contacts to download — adjust your filters.');
      return;
    }
    const headers = [
      'First Name', 'Last Name', 'Full Name', 'Title', 'Company',
      'Email', 'Phone', 'City', 'State', 'Country',
      'LinkedIn URL', 'Met In Person', 'Events', 'Tags',
    ];
    const escape = (v) => {
      const s = (v === null || v === undefined) ? '' : String(v);
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const rows = list.map(c => {
      const raw = c.raw || {};
      const tags = (raw.dans_tags || raw.dan_s_tags || raw.dans_tag || '');
      return [
        c.firstname || '',
        c.lastname || '',
        c.name || '',
        c.jobtitle || '',
        c.companyName || c.company || '',
        c.email || '',
        c.phone || '',
        c.city || '',
        c.state || '',
        c.country || '',
        c.linkedin || raw.hs_linkedin_url || '',
        c.metInPerson ? 'Yes' : '',
        contactEvents[String(c.id || '')] || '',
        tags,
      ].map(escape).join(',');
    });
    const csv = headers.map(escape).join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `${storagePrefix}-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleMassApply() {
    if (massSelected.size === 0 || !massValue.trim()) return;
    setMassProcessing(true);
    setMassStatus(null);
    let updated = 0, errors = 0;
    const value = massValue.trim();
    for (const id of massSelected) {
      try {
        const res = await fetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: id, properties: { [massField]: value } }),
        });
        const json = await res.json();
        if (json.error) errors++; else updated++;
      } catch { errors++; }
    }
    try {
      await updateHubspotCache(draft => {
        for (const c of draft.contacts) {
          if (massSelected.has(c.id)) c[massField] = value;
        }
      });
    } catch (err) { console.warn('Mass cache update failed', err); }
    setMassStatus({
      type: errors === 0 ? 'success' : 'partial',
      message: `Updated ${updated} contact${updated === 1 ? '' : 's'}${errors > 0 ? `, ${errors} failed` : ''}`,
    });
    setMassProcessing(false);
    setMassValue('');
    setMassSelected(new Set());
  }

  // The contact currently being edited in the in-place modal. We open
  // the same `ContactEditModal` the prospect modal uses so edits made
  // here propagate through the shared HubSpot cache + Firestore
  // settings — the prospect modal's contact list listens to the same
  // `hubspot-cache-updated` event we do, so a save here lights up
  // there automatically (and vice-versa).
  const [editingContact, setEditingContact] = useState(null);
  // ContactEditModal calls onSave with { silent: true } from its
  // tag-autosave path so each tag toggle persists without dropping
  // the user out of the popup. We have to honour that flag — the
  // previous version always called setEditingContact(null), which
  // closed the modal on every tick.
  const handleContactSaved = useCallback((updated, opts) => {
    if (!opts?.silent) setEditingContact(null);
    void updated;
  }, []);
  const handleSaveContactNote = useCallback((cid, note) => {
    const cur = settings?.contactNotes || {};
    const next = { ...cur };
    if (note && note.trim()) next[cid] = note; else delete next[cid];
    updateSettings({ contactNotes: next });
  }, [settings?.contactNotes, updateSettings]);
  // Per-contact Events log (conferences, meetings, etc.) stored in
  // Firestore settings so it persists cross-device. Edited inline on
  // the All Contacts table.
  const contactEvents = settings?.contactEvents || {};
  const handleSaveContactEvents = useCallback((cid, val) => {
    const cur = settings?.contactEvents || {};
    const next = { ...cur };
    const v = String(val || '').trim();
    if (v) next[cid] = v; else delete next[cid];
    updateSettings({ contactEvents: next });
  }, [settings?.contactEvents, updateSettings]);
  const handleSaveContactOldEmails = useCallback((cid, val) => {
    const cur = settings?.contactOldEmails || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactOldEmails: next });
  }, [settings?.contactOldEmails, updateSettings]);
  const handleSaveContactNickname = useCallback((cid, val) => {
    const cur = settings?.contactNicknames || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactNicknames: next });
  }, [settings?.contactNicknames, updateSettings]);
  const handleSaveContactTeamName = useCallback((cid, val) => {
    const cur = settings?.contactTeamNames || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val.trim(); else delete next[cid];
    updateSettings({ contactTeamNames: next });
  }, [settings?.contactTeamNames, updateSettings]);
  const handleSaveContactReportsTo = useCallback((cid, managerIds) => {
    const cur = settings?.contactReportsTo || {};
    const next = { ...cur };
    const arr = Array.isArray(managerIds)
      ? managerIds.filter(Boolean).map(String)
      : (managerIds ? [String(managerIds)] : []);
    if (arr.length > 0) next[cid] = arr; else delete next[cid];
    updateSettings({ contactReportsTo: next });
  }, [settings?.contactReportsTo, updateSettings]);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(lsKey('view-mode')) || 'contacts');
  useEffect(() => { try { localStorage.setItem(lsKey('view-mode'), viewMode); } catch {} }, [viewMode]);
  const [contactSortKey, setContactSortKey] = useState(() => localStorage.getItem(lsKey('contact-sort-key')) || 'name');
  const [contactSortDir, setContactSortDir] = useState(() => localStorage.getItem(lsKey('contact-sort-dir')) || 'asc');
  useEffect(() => { try { localStorage.setItem(lsKey('contact-sort-key'), contactSortKey); } catch {} }, [contactSortKey]);
  useEffect(() => { try { localStorage.setItem(lsKey('contact-sort-dir'), contactSortDir); } catch {} }, [contactSortDir]);
  function toggleContactSort(key) {
    setContactSortDir(prev => (contactSortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
    setContactSortKey(key);
  }

  const DEFAULT_CONTACT_COL_WIDTHS = {
    name: 180, title: 200, company: 200, suggestedCompany: 220, email: 240, phone: 140, location: 140, city: 120, state: 80, country: 120, linkedin: 90, salesNav: 110, met: 80, events: 220, tags: 200,
  };
  // Column visibility — every contact column except Name (always
  // shown; it's the primary identifier). Stored per-page so the Key,
  // Active, Client, and All tabs each remember their own set. City /
  // State sit alongside Location so a user who wants the combined
  // "City, State" string keeps it, while the separate columns are
  // available for filtering / sorting on either field independently.
  const DEFAULT_VISIBLE_COLS = ['title', 'company', 'email', 'phone', 'location', 'city', 'state', 'country', 'linkedin', 'salesNav', 'met', 'events', 'tags'];
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey('visible-cols')));
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch {}
    return DEFAULT_VISIBLE_COLS;
  });
  useEffect(() => { try { localStorage.setItem(lsKey('visible-cols'), JSON.stringify(visibleCols)); } catch {} }, [visibleCols, storagePrefix]);
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  const colsMenuRef = useRef(null);
  useEffect(() => {
    if (!colsMenuOpen) return;
    const onDown = (e) => { if (!colsMenuRef.current?.contains(e.target)) setColsMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [colsMenuOpen]);
  function toggleVisibleCol(key) {
    setVisibleCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }
  const [contactColWidths, setContactColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey('contact-col-widths'))) || {};
      return { ...DEFAULT_CONTACT_COL_WIDTHS, ...saved };
    } catch { return DEFAULT_CONTACT_COL_WIDTHS; }
  });
  useEffect(() => { try { localStorage.setItem(lsKey('contact-col-widths'), JSON.stringify(contactColWidths)); } catch {} }, [contactColWidths]);
  const [contactColFilters, setContactColFilters] = useState(() => {
    try { return JSON.parse(localStorage.getItem(lsKey('contact-col-filters'))) || {}; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem(lsKey('contact-col-filters'), JSON.stringify(contactColFilters)); } catch {} }, [contactColFilters]);
  const contactResizingRef = useRef(null);
  function startContactResize(colKey, e) {
    e.preventDefault();
    e.stopPropagation();
    // Capture the key + start metrics in local scope so the setter
    // callback below doesn't depend on contactResizingRef.current
    // still being non-null. Without that, a mousemove that lands
    // *after* mouseup (browser event ordering) can throw a TypeError
    // reading `.key` on null and blank the entire page.
    const key = colKey;
    const startX = e.clientX;
    const startWidth = contactColWidths[colKey] || 100;
    contactResizingRef.current = { key, startX, startWidth };
    const onMove = (ev) => {
      if (!contactResizingRef.current) return;
      const delta = ev.clientX - startX;
      const next = Math.max(60, startWidth + delta);
      setContactColWidths(prev => ({ ...prev, [key]: next }));
    };
    const onUp = () => {
      contactResizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  const [hubspotCache, setHubspotCacheState] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { getHubspotCache().then(c => { if (!cancelled) setHubspotCacheState(c); }).catch(() => {}); };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Tag options for the inline Tags column. Union of (a) the canonical
  // Dan-curated list plus (b) every distinct dans_tags value already
  // in the loaded HubSpot cache, so a tag the user has typed
  // ad-hoc on a prior contact still shows up in the dropdown the
  // next time they open it.
  const tagOptionsList = useMemo(() => {
    const CURATED = ['ESG', 'Procurement', 'Private Equity', 'Real Estate', 'Capital Planning', 'Efficiency / Renewables', 'Dan Key Target', 'Decision Maker', 'Met In Person', 'EU', 'Hide', 'Left'];
    const seen = new Set();
    const out = [];
    const push = (t) => {
      const v = String(t || '').trim();
      if (!v) return;
      const k = v.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(v);
    };
    for (const t of CURATED) push(t);
    for (const c of (hubspotCache?.contacts || [])) {
      const raw = c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '';
      if (!raw) continue;
      for (const t of String(raw).split(';')) push(t);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [hubspotCache]);

  const DEFAULT_COL_WIDTHS = { company: 260, aum: 100, type: 120, status: 130, keyContacts: 130, dm: 150, met: 130, ratio: 110 };
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey('col-widths'))) || {};
      return { ...DEFAULT_COL_WIDTHS, ...saved };
    } catch { return DEFAULT_COL_WIDTHS; }
  });
  const [sortKey, setSortKey] = useState(() => localStorage.getItem(lsKey('sort-key')) || 'keyContacts');
  const [sortDir, setSortDir] = useState(() => localStorage.getItem(lsKey('sort-dir')) || 'desc');
  useEffect(() => { try { localStorage.setItem(lsKey('col-widths'), JSON.stringify(colWidths)); } catch {} }, [colWidths]);
  useEffect(() => { try { localStorage.setItem(lsKey('sort-key'), sortKey); } catch {} }, [sortKey]);
  useEffect(() => { try { localStorage.setItem(lsKey('sort-dir'), sortDir); } catch {} }, [sortDir]);

  const resizingRef = useRef(null);
  function startResize(colKey, e) {
    e.preventDefault();
    e.stopPropagation();
    // Capture in local scope so a stray mousemove after mouseup can't
    // dereference null (which previously blanked the page when React
    // ran the setter callback after we cleared the ref).
    const key = colKey;
    const startX = e.clientX;
    const startWidth = colWidths[colKey] || 100;
    resizingRef.current = { key, startX, startWidth };
    const onMove = (ev) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - startX;
      const next = Math.max(60, startWidth + delta);
      setColWidths(prev => ({ ...prev, [key]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  function toggleSort(key) {
    setSortDir(prev => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'desc'));
    setSortKey(key);
  }

  const oppsRecords = useOppsRecords(user?.uid);

  const FREE_MAIL = useMemo(() => new Set([
    'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
    'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
  ]), []);

  // Pull domain off a prospect — manual emailDomain entries plus website hostname.
  const collectProspectDomains = (p, into) => {
    if (!p) return;
    if (p.emailDomain) {
      for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
        const at = entry.lastIndexOf('@');
        const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
        if (d) into.add(d);
      }
    }
    if (p.website) {
      const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
      if (d) into.add(d);
    }
  };

  // Every contact tagged "Dan Key Target" (excluding hidden). One entry per contact;
  // we'll bucket them by company below.
  // Companies (lowercased) that have at least one open / active opp.
  // Only computed when `requireActiveOpp` is on; used to gate which
  // contacts even enter the keyContacts list. Active = stage outside
  // CLOSED_STAGES and INVALID_STAGES.
  const activeOppCompanies = useMemo(() => {
    if (!requireActiveOpp) return null;
    const out = [];
    const seen = new Set();
    for (const r of oppsRecords) {
      const stage = (r['Stage'] || '').trim();
      if (!stage || INVALID_STAGES.has(stage) || CLOSED_STAGES.has(stage)) continue;
      const acct = String(r['Account'] || '').trim();
      const k = acct.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(acct);
    }
    return out;
  }, [requireActiveOpp, oppsRecords]);

  // Index of prospect domains / canonical names — fed into
  // guessCompanyForContact to fill the Suggested Company column.
  const companyGuessIndex = useMemo(
    () => showSuggestedCompany ? buildCompanyGuessIndex(prospects, hubspotCache?.contacts || []) : null,
    [showSuggestedCompany, prospects, hubspotCache]
  );

  const keyContacts = useMemo(() => {
    const out = [];
    const localFields = settings?.contactLocalFields || {};
    for (const baseC of (hubspotCache?.contacts || [])) {
      // Apply per-contact overrides so a typed Company value survives
      // even when HubSpot's sync would revert it (mirrors what the
      // HubSpot Contacts page does when its fuzzy Company match
      // resolves to a record with a different name).
      const local = localFields[String(baseC.id || baseC.vid || '')] || null;
      const c = local && typeof local._companyOverride === 'string' && local._companyOverride
        ? { ...baseC, company: local._companyOverride }
        : baseC;
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      // Note: we used to fast-skip hide-tagged contacts here, but
      // ActiveContactsView's "Show hidden" mode wants them to come
      // through. The selector is the single source of truth — every
      // built-in selector (KEY_TARGET_SELECTOR, ClientContactsView,
      // ActiveContactsView "visible" mode) still filters them out.
      void tags;
      if (!contactSelector(c)) continue;
      if (activeOppCompanies) {
        const cName = String(c.company || '').trim();
        if (!cName) continue;
        const lc = cName.toLowerCase();
        // Fast exact-match path first; fall back to fuzzy match so
        // "Acme Corp" vs "Acme Corporation" still pairs correctly.
        let hit = activeOppCompanies.some(a => a.toLowerCase() === lc);
        if (!hit) hit = activeOppCompanies.some(a => companiesMatch(a, cName));
        if (!hit) continue;
      }
      if (unmappedOnly) {
        // Treat the contact as "mapped" when any prospect's company
        // matches by name OR a domain is shared. Anything else (no
        // company, unknown company, novel domain) counts as unmapped.
        const cName = String(c.company || '').trim();
        const email = (c.email || '').toLowerCase().trim();
        const at = email.lastIndexOf('@');
        const cDomain = at >= 0 ? email.slice(at + 1).trim() : '';
        const cDomainOk = cDomain && !FREE_MAIL.has(cDomain);
        const mapped = (cName && prospects.some(p => companiesMatch(p.company, cName)))
          || (cDomainOk && prospects.some(p => {
            const ds = new Set();
            collectProspectDomains(p, ds);
            return ds.has(cDomain);
          }));
        if (mapped) continue;
      }
      const company = (c.company || '').trim();
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const rawDomain = at >= 0 ? email.slice(at + 1).trim() : '';
      const domain = rawDomain && !FREE_MAIL.has(rawDomain) ? rawDomain : '';
      out.push({
        id: c.id || `${c.email || ''}|${c.firstname || ''}|${c.lastname || ''}`,
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown',
        firstname: c.firstname || '',
        lastname: c.lastname || '',
        email: c.email || '',
        phone: c.phone || '',
        jobtitle: c.jobtitle || '',
        linkedin: c.hs_linkedin_url || '',
        city: String(c.city || '').trim(),
        state: String(c.state || '').trim(),
        country: String(c.country || '').trim(),
        metInPerson: metInPersonSelector(c),
        company,
        domain,
        suggestedCompany: companyGuessIndex ? guessCompanyForContact(c, companyGuessIndex) : '',
        raw: c,
      });
    }
    return out;
  }, [hubspotCache, FREE_MAIL, contactSelector, metInPersonSelector, activeOppCompanies, unmappedOnly, prospects, companyGuessIndex, settings?.contactLocalFields]);

  // Count of contacts the "unmapped past 30 days" filter WOULD yield,
  // computed independently from the active filters above so we can
  // show the badge whether the toggle is on or off. Mirrors the same
  // 30-day activity check + Table-View-not-mapped logic used when
  // `unmappedOnly` is on.
  const unmappedPast30Count = useMemo(() => {
    if (!onUnmappedPast30CountChange) return 0;
    const cutoff = Date.now() - 30 * 86400000;
    const fields = ['hs_email_last_send_date', 'hs_sales_email_last_replied', 'hs_email_last_open_date', 'hs_email_last_click_date', 'notes_last_contacted'];
    let n = 0;
    for (const c of (hubspotCache?.contacts || [])) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide')) continue;
      let recent = false;
      for (const f of fields) {
        const v = c[f];
        if (!v) continue;
        const ts = Date.parse(v);
        if (Number.isNaN(ts)) continue;
        if (ts >= cutoff) { recent = true; break; }
      }
      if (!recent) continue;
      const cName = String(c.company || '').trim();
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const cDomain = at >= 0 ? email.slice(at + 1).trim() : '';
      const cDomainOk = cDomain && !FREE_MAIL.has(cDomain);
      const mapped = (cName && prospects.some(p => companiesMatch(p.company, cName)))
        || (cDomainOk && prospects.some(p => {
          const ds = new Set();
          collectProspectDomains(p, ds);
          return ds.has(cDomain);
        }));
      if (!mapped) n += 1;
    }
    return n;
  }, [onUnmappedPast30CountChange, hubspotCache, FREE_MAIL, prospects]);
  useEffect(() => {
    if (onUnmappedPast30CountChange) onUnmappedPast30CountChange(unmappedPast30Count);
  }, [unmappedPast30Count, onUnmappedPast30CountChange]);

  // Decision-maker contacts — used for the per-company DM column. Mirrors
  // the equivalent flat-list pattern from the PE Portfolio view.
  const decisionMakers = useMemo(() => {
    const out = [];
    for (const c of (hubspotCache?.contacts || [])) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('hide')) continue;
      if (!tags.includes('decision maker')) continue;
      const company = (c.company || '').toLowerCase().trim();
      const email = (c.email || '').toLowerCase().trim();
      const at = email.lastIndexOf('@');
      const rawDomain = at >= 0 ? email.slice(at + 1).trim() : '';
      const domain = rawDomain && !FREE_MAIL.has(rawDomain) ? rawDomain : '';
      out.push({
        name: [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email || 'Unknown',
        company,
        domain,
        metInPerson: tags.includes('met in person'),
        city: String(c.city || '').trim(),
      });
    }
    return out;
  }, [hubspotCache, FREE_MAIL]);

  // Build one row per distinct company that has ≥1 Dan Key Target contact.
  // Each row is anchored to a prospect when one matches by name OR domain;
  // otherwise we surface the raw HubSpot company name so contacts on
  // companies that aren't yet prospect records still show up.
  const rows = useMemo(() => {
    if (keyContacts.length === 0) return [];

    // Each row keyed by either prospect.id or `raw:<lowercased company>`.
    const byKey = new Map();

    for (const kc of keyContacts) {
      // Strict 1:1 name match only — a contact only groups under a
      // prospect whose Company text equals the contact's company text
      // (case-insensitive, trimmed). The previous fuzzy fallback used
      // companiesMatch's single-token rule, which incorrectly grouped
      // e.g. a "Blackstone" contact under "BRE Hotels & Resorts (a
      // Blackstone Co.)" because "blackstone" appears as a token in
      // the latter. If no exact match, fall back to email-domain
      // match — only useful when the contact's company text is empty
      // or differs but their email domain is registered on a prospect.
      let match = null;
      if (kc.company) {
        const needle = String(kc.company).toLowerCase().trim();
        match = prospects.find(p => String(p.company || '').toLowerCase().trim() === needle);
      }
      if (!match && !kc.company && kc.domain) {
        match = prospects.find(p => {
          const ds = new Set();
          collectProspectDomains(p, ds);
          return ds.has(kc.domain);
        });
      }

      const key = match ? `pid:${match.id}` : `raw:${(kc.company || '(no company)').toLowerCase()}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          prospect: match || null,
          rawCompany: match ? null : (kc.company || '(no company)'),
          contacts: [],
        });
      }
      byKey.get(key).contacts.push(kc);
    }

    // Compute per-row stats: opps, decision makers, etc.
    const out = [];
    for (const row of byKey.values()) {
      const p = row.prospect;
      const companyName = p?.company || row.rawCompany || '';
      const lowerName = companyName.toLowerCase();

      const domains = new Set();
      if (p) collectProspectDomains(p, domains);
      // Also add the contacts' own domains to widen the DM/opps match —
      // contacts on the same company often share the corporate domain even
      // if no prospect record carries it yet.
      for (const c of row.contacts) {
        if (c.domain) domains.add(c.domain);
      }

      // Decision makers on this company (by name or domain).
      const dmSeen = new Set();
      const dmEntries = [];
      for (const dm of decisionMakers) {
        const matches =
          (dm.company && lowerName && companiesMatch(lowerName, dm.company)) ||
          (dm.domain && domains.has(dm.domain));
        if (!matches) continue;
        if (dmSeen.has(dm.name)) continue;
        dmSeen.add(dm.name);
        dmEntries.push(dm);
      }

      // Opps on this company (any stage; closed filtered later).
      const opps = [];
      for (const r of oppsRecords) {
        const stage = (r['Stage'] || '').trim();
        if (INVALID_STAGES.has(stage)) continue;
        const acct = (r['Account'] || '').toLowerCase();
        if (!acct || !lowerName) continue;
        if (!companiesMatch(lowerName, acct)) continue;
        opps.push(r);
      }
      const activeOpps = opps.filter(r => !CLOSED_STAGES.has((r['Stage'] || '').trim())).length;
      const totalOpps = opps.length;

      // Choose an AUM to display: peAum if set, else reAum.
      const aum = p ? (p.peAum || p.reAum || 0) : 0;

      out.push({
        ...row,
        companyName,
        aum,
        type: p?.type || '',
        status: p?.status || '',
        decisionMakerEntries: dmEntries,
        metInPersonCount: dmEntries.filter(e => e.metInPerson).length,
        nycCount: dmEntries.filter(e => /(new york|nyc)/i.test(e.city || '')).length,
        opps,
        activeOpps,
        totalOpps,
      });
    }
    return out;
  }, [keyContacts, prospects, decisionMakers, oppsRecords]);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'company':
          cmp = (a.companyName || '').localeCompare(b.companyName || '');
          break;
        case 'aum':
          cmp = (a.aum || 0) - (b.aum || 0);
          break;
        case 'type':
          cmp = (a.type || '').localeCompare(b.type || '');
          break;
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '');
          break;
        case 'keyContacts':
          cmp = a.contacts.length - b.contacts.length;
          break;
        case 'dm':
          cmp = a.decisionMakerEntries.length - b.decisionMakerEntries.length;
          break;
        case 'met':
          cmp = (a.metInPersonCount || 0) - (b.metInPersonCount || 0);
          if (cmp === 0) cmp = (a.nycCount || 0) - (b.nycCount || 0);
          break;
        case 'ratio':
          cmp = (a.activeOpps || 0) - (b.activeOpps || 0);
          if (cmp === 0) cmp = (a.totalOpps || 0) - (b.totalOpps || 0);
          break;
        default:
          cmp = 0;
      }
      if (sortDir === 'desc') cmp = -cmp;
      if (cmp === 0) cmp = (a.companyName || '').localeCompare(b.companyName || '');
      return cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const q = query.trim().toLowerCase();
  const filteredRows = q
    ? sortedRows.filter(r => (r.companyName || '').toLowerCase().includes(q))
    : sortedRows;

  // Flat list of every Dan Key Target contact, paired with the matched
  // prospect (when one) so we can route the open-prospect arrow.
  const flatContacts = useMemo(() => {
    const prospectByKey = new Map();
    for (const row of rows) {
      if (row.prospect) prospectByKey.set(row.key, row.prospect);
    }
    const out = [];
    for (const row of rows) {
      for (const c of row.contacts) {
        out.push({
          ...c,
          companyName: row.companyName,
          prospect: row.prospect || null,
          rowKey: row.key,
        });
      }
    }
    return out;
  }, [rows]);

  const sortedContacts = useMemo(() => {
    const arr = [...flatContacts];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (contactSortKey) {
        case 'name':
          cmp = (a.lastname || a.name || '').localeCompare(b.lastname || b.name || '')
            || (a.firstname || '').localeCompare(b.firstname || '');
          break;
        case 'title':   cmp = (a.jobtitle || '').localeCompare(b.jobtitle || ''); break;
        case 'company': cmp = (a.companyName || '').localeCompare(b.companyName || ''); break;
        case 'suggestedCompany': cmp = (a.suggestedCompany || '').localeCompare(b.suggestedCompany || ''); break;
        case 'email':   cmp = (a.email || '').localeCompare(b.email || ''); break;
        case 'location':
          cmp = ((a.state || '') + (a.city || '')).localeCompare((b.state || '') + (b.city || ''));
          break;
        case 'city':    cmp = (a.city || '').localeCompare(b.city || ''); break;
        case 'state':   cmp = (a.state || '').localeCompare(b.state || ''); break;
        case 'country': cmp = (a.country || '').localeCompare(b.country || ''); break;
        case 'events':  cmp = (contactEvents[String(a.id || '')] || '').localeCompare(contactEvents[String(b.id || '')] || ''); break;
        case 'met':     cmp = Number(!!a.metInPerson) - Number(!!b.metInPerson); break;
        default: cmp = 0;
      }
      if (contactSortDir === 'desc') cmp = -cmp;
      if (cmp === 0) cmp = (a.name || '').localeCompare(b.name || '');
      return cmp;
    });
    return arr;
  }, [flatContacts, contactSortKey, contactSortDir]);

  const contactFieldGetters = {
    name:     c => c.name || '',
    title:    c => c.jobtitle || '',
    company:  c => c.companyName || '',
    suggestedCompany: c => c.suggestedCompany || '',
    email:    c => c.email || '',
    phone:    c => c.phone || '',
    location: c => [c.city, c.state].filter(Boolean).join(', '),
    city:     c => c.city || '',
    state:    c => c.state || '',
    country:  c => c.country || '',
    linkedin: c => c.linkedin ? 'open' : '',
    salesNav: c => '',
    met:      c => c.metInPerson ? 'yes' : 'no',
    events:   c => contactEvents[String(c.id || '')] || '',
  };
  const activeContactFilters = Object.entries(contactColFilters)
    .map(([k, v]) => [k, String(v || '').trim().toLowerCase()])
    .filter(([, v]) => v.length > 0);
  const filteredContacts = sortedContacts.filter(c => {
    if (q) {
      const blob = (c.name || '') + ' ' + (c.companyName || '') + ' '
        + (c.email || '') + ' ' + (c.jobtitle || '');
      if (!blob.toLowerCase().includes(q)) return false;
    }
    for (const [key, needle] of activeContactFilters) {
      const getter = contactFieldGetters[key];
      if (!getter) continue;
      if (!String(getter(c)).toLowerCase().includes(needle)) return false;
    }
    return true;
  });

  function toggle(key) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>{pageTitle}</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2, maxWidth: 720 }}>
            {pageSubtitle}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'inline-flex', border: '1px solid #CBD5E1', borderRadius: 6, overflow: 'hidden' }}>
            {[
              { key: 'contacts', label: 'All Contacts' },
              { key: 'companies', label: 'By Company' },
            ].map((opt, i) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setViewMode(opt.key)}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  border: 'none',
                  borderLeft: i === 0 ? 'none' : '1px solid #CBD5E1',
                  background: viewMode === opt.key ? '#1E293B' : '#fff',
                  color: viewMode === opt.key ? '#fff' : '#475569',
                }}
              >{opt.label}</button>
            ))}
          </div>
          {viewMode === 'companies' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#475569', cursor: 'pointer' }}>
              <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />
              <span>Include closed (Sold / Not Sold / Lost)</span>
            </label>
          )}
          <button
            type="button"
            onClick={downloadContactsCsv}
            title="Download a CSV of every contact currently visible on this page (honors active filters, search, and view mode)."
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.72rem',
              fontWeight: 600,
              border: '1px solid #CBD5E1',
              borderRadius: 6,
              background: '#fff',
              color: '#334155',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >Download CSV</button>
          <button
            type="button"
            onClick={downloadCombinedContactsCsv}
            title="Download a single CSV combining contacts from Key Contacts, Active Contacts, and Client Contacts. Each row has a Categories column listing every tab the contact qualifies for. Filters and search on this page are NOT applied — the export covers the full tag/CDM-derived sets."
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.72rem',
              fontWeight: 600,
              border: '1px solid #1D4ED8',
              borderRadius: 6,
              background: '#EFF6FF',
              color: '#1D4ED8',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >Download Combined (Key + Active + Client)</button>
          {viewMode === 'contacts' && (
            <div ref={colsMenuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setColsMenuOpen(o => !o)}
                title="Choose which columns are visible on the All Contacts table. Persists per page."
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  border: '1px solid #CBD5E1',
                  borderRadius: 6,
                  background: '#fff',
                  color: '#334155',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >Columns ▾</button>
              {colsMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    marginTop: 4,
                    zIndex: 30,
                    background: '#fff',
                    border: '1px solid #CBD5E1',
                    borderRadius: 6,
                    boxShadow: '0 6px 16px rgba(15,23,42,0.12)',
                    minWidth: 200,
                    padding: '0.4rem 0',
                  }}
                >
                  {[
                    { key: 'title', label: 'Title' },
                    { key: 'company', label: 'Company' },
                    ...(showSuggestedCompany ? [{ key: 'suggestedCompany', label: 'Suggested Company' }] : []),
                    { key: 'email', label: 'Email' },
                    { key: 'phone', label: 'Phone' },
                    { key: 'location', label: 'Location' },
                    { key: 'city', label: 'City' },
                    { key: 'state', label: 'State' },
                    { key: 'country', label: 'Country' },
                    { key: 'linkedin', label: 'LinkedIn' },
                    { key: 'salesNav', label: 'LinkedIn Search' },
                    { key: 'met', label: 'Met' },
                    { key: 'events', label: 'Events' },
                  ].map(opt => (
                    <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.35rem 0.75rem', fontSize: '0.74rem', color: '#1E293B', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={visibleCols.includes(opt.key)}
                        onChange={() => toggleVisibleCol(opt.key)}
                      />
                      {opt.label}
                    </label>
                  ))}
                  <div style={{ padding: '0.35rem 0.75rem', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setVisibleCols(DEFAULT_VISIBLE_COLS)}
                      style={{ background: 'transparent', border: '1px solid #CBD5E1', borderRadius: 4, padding: '2px 8px', fontSize: '0.68rem', color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}
                    >Reset to default</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {viewMode === 'contacts' && (
            <button
              type="button"
              onClick={() => {
                setMassMode(p => !p);
                setMassSelected(new Set());
                setMassValue('');
                setMassStatus(null);
              }}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.72rem',
                fontWeight: 600,
                border: '1px solid ' + (massMode ? '#1E293B' : '#CBD5E1'),
                borderRadius: 6,
                background: massMode ? '#1E293B' : '#fff',
                color: massMode ? '#fff' : '#475569',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >{massMode ? 'Exit Mass Edit' : 'Mass Edit'}</button>
          )}
        </div>
      </div>

      {viewMode === 'contacts' && massMode && (
        <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', padding: '0.5rem 0.75rem', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1E293B' }}>{massSelected.size} selected</span>
            <button
              type="button"
              onClick={() => setMassSelected(new Set(filteredContacts.map(c => c.id)))}
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.68rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}
            >Select all visible</button>
            <button
              type="button"
              onClick={() => setMassSelected(new Set())}
              disabled={massSelected.size === 0}
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.68rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: massSelected.size === 0 ? '#CBD5E1' : '#475569', cursor: massSelected.size === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
            <select
              value={massField}
              onChange={e => setMassField(e.target.value)}
              style={{ padding: '0.25rem 0.4rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit', background: '#fff' }}
            >
              <option value="company">Company</option>
              <option value="jobtitle">Job Title</option>
              <option value="phone">Phone</option>
              <option value="city">City</option>
              <option value="state">State</option>
              <option value="country">Country</option>
              <option value="firstname">First Name</option>
              <option value="lastname">Last Name</option>
            </select>
            {massField === 'company' ? (() => {
              const q = (massValue || '').trim().toLowerCase();
              const allNames = (() => {
                const seen = new Set();
                const out = [];
                for (const p of prospects) {
                  const s = String(p.company || '').trim();
                  if (!s) continue;
                  const k = s.toLowerCase();
                  if (seen.has(k)) continue;
                  seen.add(k);
                  out.push(s);
                }
                return out;
              })();
              const matches = q
                ? allNames.filter(n => n.toLowerCase().includes(q)).slice(0, 12)
                : allNames.slice(0, 12);
              const showList = massCompanyOpen && matches.length > 0;
              return (
                <div ref={massCompanyBoxRef} style={{ position: 'relative', flex: '1 1 220px', minWidth: 160 }}>
                  <input
                    type="text"
                    value={massValue}
                    onFocus={() => { setMassCompanyOpen(true); setMassCompanyHover(0); }}
                    onChange={e => { setMassValue(e.target.value); setMassCompanyOpen(true); setMassCompanyHover(0); }}
                    onKeyDown={e => {
                      if (!showList) return;
                      if (e.key === 'ArrowDown') { e.preventDefault(); setMassCompanyHover(h => Math.min(h + 1, matches.length - 1)); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setMassCompanyHover(h => Math.max(h - 1, 0)); }
                      else if (e.key === 'Enter') { e.preventDefault(); setMassValue(matches[massCompanyHover]); setMassCompanyOpen(false); }
                      else if (e.key === 'Escape') { setMassCompanyOpen(false); }
                    }}
                    placeholder="Type to search Table View companies…"
                    autoComplete="off"
                    style={{ width: '100%', padding: '0.25rem 0.5rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit' }}
                  />
                  {showList && (
                    <div style={{
                      position: 'absolute',
                      top: '100%', left: 0, right: 0,
                      marginTop: 2,
                      zIndex: 30,
                      maxHeight: 240,
                      overflowY: 'auto',
                      background: '#fff',
                      border: '1px solid #CBD5E1',
                      borderRadius: 6,
                      boxShadow: '0 6px 16px rgba(15,23,42,0.12)',
                    }}>
                      {matches.map((n, i) => (
                        <div
                          key={n}
                          onMouseDown={e => { e.preventDefault(); setMassValue(n); setMassCompanyOpen(false); }}
                          onMouseEnter={() => setMassCompanyHover(i)}
                          style={{
                            padding: '0.4rem 0.6rem',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            background: i === massCompanyHover ? '#EFF6FF' : '#fff',
                            color: '#1E293B',
                            borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={n}
                        >{n}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })() : (
              <input
                type="text"
                value={massValue}
                onChange={e => setMassValue(e.target.value)}
                placeholder="New value…"
                style={{ flex: '1 1 220px', minWidth: 160, padding: '0.25rem 0.5rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit' }}
              />
            )}
            <button
              type="button"
              onClick={handleMassApply}
              disabled={massProcessing || massSelected.size === 0 || !massValue.trim()}
              style={{
                padding: '0.3rem 0.75rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                border: 'none',
                borderRadius: 4,
                background: (massProcessing || massSelected.size === 0 || !massValue.trim()) ? '#94A3B8' : '#1D4ED8',
                color: '#fff',
                cursor: (massProcessing || massSelected.size === 0 || !massValue.trim()) ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >{massProcessing ? 'Updating…' : 'Apply to Selected'}</button>
            <button
              type="button"
              onClick={handleMassHide}
              disabled={massProcessing || massSelected.size === 0}
              title="Add the Hide tag in HubSpot so these contacts stop appearing on this page"
              style={{
                padding: '0.3rem 0.75rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                border: '1px solid #B91C1C',
                borderRadius: 4,
                background: (massProcessing || massSelected.size === 0) ? '#FEE2E2' : '#FEF2F2',
                color: '#B91C1C',
                cursor: (massProcessing || massSelected.size === 0) ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >Hide Selected</button>
            {massStatus && (
              <span style={{ fontSize: '0.7rem', color: massStatus.type === 'success' ? '#166534' : '#92400E' }}>{massStatus.message}</span>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={viewMode === 'contacts'
            ? `Search ${flatContacts.length} contact${flatContacts.length === 1 ? '' : 's'}…`
            : `Search ${rows.length} compan${rows.length === 1 ? 'y' : 'ies'}…`}
          style={{ width: '100%', maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        {/* Surface inline-edit save status here so failures are
            visible whether or not Mass Edit mode is on. */}
        {!massMode && massStatus && (
          <div
            style={{
              fontSize: '0.72rem',
              padding: '0.3rem 0.6rem',
              borderRadius: 6,
              background: massStatus.type === 'success' ? '#DCFCE7' : '#FEF3C7',
              color: massStatus.type === 'success' ? '#166534' : '#92400E',
              border: '1px solid ' + (massStatus.type === 'success' ? '#86EFAC' : '#FDE68A'),
              maxWidth: 600,
            }}
          >
            <span>{massStatus.message}</span>{' '}
            <button
              type="button"
              onClick={() => setMassStatus(null)}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '0.7rem', textDecoration: 'underline' }}
            >dismiss</button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 1.25rem 1.25rem', minHeight: 0 }}>
        {!hubspotCache && (
          <div style={{ padding: '0.6rem 0.8rem', marginBottom: '0.5rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.72rem', color: '#92400E' }}>
            Loading HubSpot contacts… open the <strong>HubSpot Contacts</strong> tab once if this doesn't populate.
          </div>
        )}
        {viewMode === 'contacts' ? (
          flatContacts.length === 0 ? (
            <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>{emptyTitle}</div>
              <div style={{ fontSize: '0.78rem' }}>{emptyDetail}</div>
            </div>
          ) : (() => {
            const ALL_CONTACT_COLS = [
              { key: 'name',     label: 'Name', alwaysOn: true },
              { key: 'title',    label: 'Title' },
              { key: 'company',  label: 'Company' },
              ...(showSuggestedCompany ? [{ key: 'suggestedCompany', label: 'Suggested Company' }] : []),
              { key: 'email',    label: 'Email' },
              { key: 'phone',    label: 'Phone' },
              { key: 'location', label: 'Location' },
              { key: 'city',     label: 'City' },
              { key: 'state',    label: 'State' },
              { key: 'country',  label: 'Country' },
              { key: 'linkedin', label: 'LinkedIn', sortable: false },
              { key: 'salesNav', label: 'LinkedIn Search', sortable: false },
              { key: 'met',      label: 'Met' },
              { key: 'events',   label: 'Events' },
              { key: 'tags',     label: 'Tags', sortable: false },
            ];
            const visibleSet = new Set(visibleCols);
            const CONTACT_COLS = ALL_CONTACT_COLS.filter(c => c.alwaysOn || visibleSet.has(c.key));
            // Single 32px checkbox column at the front. When Mass Edit
            // is off it carries the Custom Email Campaign queue toggle;
            // when Mass Edit is on the same column flips to mass-select
            // checkboxes so the user only ever sees one column of
            // checkboxes — picking rows for the bulk update doesn't
            // also queue them for a campaign.
            const CONTACT_GRID = '32px '
              + CONTACT_COLS.map(c => `${contactColWidths[c.key] || 120}px`).join(' ')
              + ' 60px';
            const allVisibleQueued = filteredContacts.length > 0
              && filteredContacts.every(c => queuedSet.has(String(c.id)));
            const toggleQueueAllVisible = () => {
              const next = new Set(queuedIds);
              if (allVisibleQueued) {
                for (const c of filteredContacts) next.delete(String(c.id));
              } else {
                for (const c of filteredContacts) next.add(String(c.id));
              }
              setQueuedContactIds(Array.from(next));
            };
            const allVisibleSelected = massMode
              && filteredContacts.length > 0
              && filteredContacts.every(c => massSelected.has(c.id));
            const CONTACT_GLYPH = (key) => contactSortKey === key ? (contactSortDir === 'desc' ? ' ▼' : ' ▲') : '';
            const RESIZE_HANDLE = { position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, cursor: 'col-resize', userSelect: 'none' };
            return (
              <div style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: CONTACT_GRID, background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', borderTopLeftRadius: 8, borderTopRightRadius: 8, position: 'sticky', top: 0, zIndex: 2 }}>
                  {massMode ? (
                    <div style={{ padding: '0.4rem 0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #E2E8F0' }}>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={() => {
                          if (allVisibleSelected) {
                            const rest = new Set(massSelected);
                            for (const c of filteredContacts) rest.delete(c.id);
                            setMassSelected(rest);
                          } else {
                            const next = new Set(massSelected);
                            for (const c of filteredContacts) next.add(c.id);
                            setMassSelected(next);
                          }
                        }}
                        title={allVisibleSelected ? 'Clear visible' : 'Select visible'}
                      />
                    </div>
                  ) : (
                    <div style={{ padding: '0.4rem 0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #E2E8F0' }}
                      title={allVisibleQueued ? 'Remove all visible contacts from the Custom Email Campaign queue' : 'Add all visible contacts to the Custom Email Campaign queue (Draft Emails page)'}
                    >
                      <input
                        type="checkbox"
                        checked={allVisibleQueued}
                        onChange={toggleQueueAllVisible}
                        title={allVisibleQueued ? 'Clear visible from queue' : 'Queue visible for campaign'}
                      />
                    </div>
                  )}
                  {CONTACT_COLS.map(c => (
                    <div
                      key={c.key}
                      onClick={c.sortable === false ? undefined : () => toggleContactSort(c.key)}
                      title={c.sortable === false ? c.label : `Sort by ${c.label.toLowerCase()}`}
                      style={{
                        position: 'relative',
                        padding: '0.4rem 0.6rem',
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: contactSortKey === c.key ? '#1E293B' : '#475569',
                        background: contactSortKey === c.key ? '#E2E8F0' : 'transparent',
                        cursor: c.sortable === false ? 'default' : 'pointer',
                        userSelect: 'none',
                        borderRight: '1px solid #E2E8F0',
                      }}
                    >
                      {c.label}{c.sortable === false ? '' : CONTACT_GLYPH(c.key)}
                      <span
                        onMouseDown={e => startContactResize(c.key, e)}
                        onClick={e => e.stopPropagation()}
                        style={RESIZE_HANDLE}
                        title="Drag to resize"
                      />
                    </div>
                  ))}
                  <div />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: CONTACT_GRID, background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', position: 'sticky', top: 30, zIndex: 2 }}>
                  <div style={{ borderRight: '1px solid #E2E8F0' }} />
                  {CONTACT_COLS.map(c => (
                    <div key={c.key} style={{ padding: '0.25rem 0.4rem', borderRight: '1px solid #E2E8F0' }}>
                      <input
                        type="text"
                        value={contactColFilters[c.key] || ''}
                        onChange={e => setContactColFilters(prev => ({ ...prev, [c.key]: e.target.value }))}
                        placeholder="Filter…"
                        style={{ width: '100%', padding: '0.2rem 0.35rem', fontSize: '0.7rem', border: '1px solid #E2E8F0', borderRadius: 3, fontFamily: 'inherit', background: '#fff' }}
                      />
                    </div>
                  ))}
                  <div />
                </div>
                {filteredContacts.length === 0 && (
                  <div style={{ padding: '1rem', textAlign: 'center', color: '#64748B', fontSize: '0.78rem', background: '#FAFAFA', borderTop: '1px solid #F1F5F9' }}>
                    No contacts match the current filters{query ? ` for "${query}"` : ''} — clear a filter or column search to see results.
                  </div>
                )}
                {filteredContacts.map((c, i) => (
                  <div
                    key={`${c.rowKey}|${c.id}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: CONTACT_GRID,
                      alignItems: 'center',
                      borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                      background: massMode && massSelected.has(c.id) ? '#EFF6FF' : (i % 2 === 0 ? '#fff' : '#FCFCFD'),
                    }}
                  >
                    {massMode ? (
                      <div style={{ padding: '0.45rem 0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <input
                          type="checkbox"
                          checked={massSelected.has(c.id)}
                          onChange={() => toggleMassSelect(c.id)}
                          onClick={e => e.stopPropagation()}
                        />
                      </div>
                    ) : (
                      <div
                        style={{ padding: '0.45rem 0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title={queuedSet.has(String(c.id)) ? 'Remove from Custom Email Campaign queue' : 'Add to Custom Email Campaign queue (pulls into Draft Emails)'}
                      >
                        <input
                          type="checkbox"
                          checked={queuedSet.has(String(c.id))}
                          onChange={() => toggleQueuedContact(c.id)}
                          onClick={e => e.stopPropagation()}
                        />
                      </div>
                    )}
                    <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.8rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Click to edit ${c.name}`}>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditingContact(c.raw || c)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingContact(c.raw || c); } }}
                        style={{ color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline' }}
                      >{c.name}</span>
                    </div>
                    {visibleSet.has('title') && (
                    <InlineCell
                      value={c.jobtitle}
                      onCommit={v => inlineUpdateField(c.raw || c, 'jobtitle', v)}
                      textColor="#475569"
                      title={c.jobtitle ? `Click to edit — ${c.jobtitle}` : 'Click to edit'}
                    />
                    )}
                    {visibleSet.has('company') && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        minWidth: 0,
                        // Soft amber wash + left rule when the contact's
                        // company doesn't map to a Table View prospect,
                        // so the user can spot at a glance which rows
                        // are floating outside the prospect list and
                        // need a Suggested Company / manual mapping.
                        ...(c.companyName && !c.prospect ? { background: '#FEF3C7', borderLeft: '3px solid #F59E0B' } : null),
                      }}
                      title={c.companyName && !c.prospect ? `"${c.companyName}" is not mapped to any prospect in the Table View — no matching company name and no shared email domain.` : undefined}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <InlineCell
                          value={c.companyName}
                          onCommit={v => inlineUpdateField(c.raw || c, 'company', v)}
                          fontSize="0.74rem"
                          textColor="#1E293B"
                          fontWeight={600}
                          suggestions={prospects.map(p => p.company).filter(Boolean)}
                          title={c.prospect ? `Click to edit. Use the ↗ button to open ${c.companyName}.` : 'Not mapped to any Table View prospect. Click to edit (autocomplete from Table View companies).'}
                        />
                      </div>
                      {c.prospect ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={e => { e.stopPropagation(); onSelectProspect?.(c.prospect); }}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onSelectProspect?.(c.prospect); } }}
                          title={`Open ${c.companyName} prospect record`}
                          style={{ flexShrink: 0, marginRight: 4, fontSize: '0.7rem', color: '#1D4ED8', cursor: 'pointer', fontWeight: 700 }}
                        >↗</span>
                      ) : c.companyName ? (
                        <span
                          title={`"${c.companyName}" is not in the Table View`}
                          style={{ flexShrink: 0, marginRight: 4, fontSize: '0.7rem', color: '#B45309', fontWeight: 700 }}
                        >⚠</span>
                      ) : null}
                    </div>
                    )}
                    {showSuggestedCompany && (
                      <div style={{ padding: '0.3rem 0.5rem', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }} title={c.suggestedCompany || ''}>
                        {c.suggestedCompany ? (
                          <>
                            <span style={{ color: '#0F766E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.suggestedCompany}</span>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); applySuggestedCompany(c.raw || c, c.suggestedCompany); }}
                              disabled={massProcessing}
                              title={`Set ${c.name}'s Company to ${c.suggestedCompany}`}
                              style={{
                                background: '#ECFDF5',
                                border: '1px solid #6EE7B7',
                                color: '#065F46',
                                fontSize: '0.6rem',
                                fontWeight: 700,
                                padding: '1px 5px',
                                borderRadius: 4,
                                cursor: massProcessing ? 'default' : 'pointer',
                                fontFamily: 'inherit',
                                flexShrink: 0,
                              }}
                            >Apply</button>
                          </>
                        ) : (
                          <span style={{ color: '#CBD5E1' }}>—</span>
                        )}
                      </div>
                    )}
                    {visibleSet.has('email') && (
                    <InlineCell
                      value={c.email}
                      onCommit={v => inlineUpdateField(c.raw || c, 'email', v)}
                      type="email"
                    />
                    )}
                    {visibleSet.has('phone') && (
                    <InlineCell
                      value={c.phone}
                      onCommit={v => inlineUpdateField(c.raw || c, 'phone', v)}
                      textColor="#64748B"
                    />
                    )}
                    {visibleSet.has('location') && (
                    <InlineCell
                      value={[c.city, c.state].filter(Boolean).join(', ')}
                      onCommit={async (v) => {
                        const [city = '', state = ''] = String(v || '').split(',').map(s => s.trim());
                        await inlineUpdateField(c.raw || c, 'city', city);
                        if ((c.state || '') !== state) await inlineUpdateField(c.raw || c, 'state', state);
                      }}
                      textColor="#64748B"
                      placeholder="—"
                      title="Click to edit. Type 'City, State'."
                      fontSize="0.7rem"
                    />
                    )}
                    {visibleSet.has('city') && (
                    <InlineCell
                      value={c.city}
                      onCommit={v => inlineUpdateField(c.raw || c, 'city', v)}
                      textColor="#64748B"
                      placeholder="—"
                      fontSize="0.7rem"
                    />
                    )}
                    {visibleSet.has('state') && (
                    <InlineCell
                      value={c.state}
                      onCommit={v => inlineUpdateField(c.raw || c, 'state', v)}
                      textColor="#64748B"
                      placeholder="—"
                      fontSize="0.7rem"
                    />
                    )}
                    {visibleSet.has('country') && (
                    <InlineCell
                      value={c.country}
                      onCommit={v => inlineUpdateField(c.raw || c, 'country', v)}
                      textColor="#64748B"
                      fontSize="0.7rem"
                    />
                    )}
                    {visibleSet.has('linkedin') && (
                    <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem' }}>
                      {c.linkedin
                        ? <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}>Open ↗</a>
                        : <span style={{ color: '#CBD5E1' }}>—</span>}
                    </div>
                    )}
                    {visibleSet.has('salesNav') && (() => {
                      const parts = [c.firstname, c.lastname, c.companyName].map(s => String(s || '').trim()).filter(Boolean);
                      if (parts.length === 0) return <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem', color: '#CBD5E1' }}>—</div>;
                      const keywords = encodeURIComponent(parts.join(' '));
                      const liHref = `https://www.linkedin.com/search/results/people/?keywords=${keywords}`;
                      const snHref = `https://www.linkedin.com/sales/search/people?keywords=${keywords}`;
                      return (
                        <div style={{ padding: '0.45rem 0.4rem', fontSize: '0.65rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <a
                            href={liHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open regular LinkedIn people search for "${parts.join(' ')}" — best for grabbing the canonical linkedin.com/in/ URL.`}
                            style={{ color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}
                          >LinkedIn ↗</a>
                          <a
                            href={snHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open Sales Navigator search pre-filtered to "${parts.join(' ')}".`}
                            style={{ color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}
                          >Sales Nav ↗</a>
                        </div>
                      );
                    })()}
                    {visibleSet.has('met') && (
                    <div style={{ padding: '0.45rem 0.6rem' }}>
                      {c.metInPerson
                        ? <span style={{ display: 'inline-block', padding: '1px 6px', fontSize: '0.6rem', fontWeight: 700, background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC', borderRadius: 999 }}>✓ Yes</span>
                        : <span style={{ color: '#CBD5E1', fontSize: '0.7rem' }}>—</span>}
                    </div>
                    )}
                    {visibleSet.has('events') && (
                    <InlineCell
                      value={contactEvents[String(c.id || '')] || ''}
                      onCommit={v => handleSaveContactEvents(String(c.id || ''), v)}
                      placeholder="—"
                      title="Click to log events for this contact (conferences, meetings, etc.)"
                      fontSize="0.7rem"
                      textColor="#475569"
                    />
                    )}
                    {visibleSet.has('tags') && (
                    <TagsInlineCell
                      value={c.dans_tags || c.dan_s_tags || c.dans_tag || ''}
                      options={tagOptionsList}
                      onCommit={v => inlineUpdateField(c.raw || c, 'dans_tags', v)}
                    />
                    )}
                    <div style={{ padding: '0.2rem 0.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleHideRow(c.raw || c)}
                        disabled={massProcessing}
                        title="Add the Hide tag so this contact stops appearing here"
                        style={{
                          background: 'transparent',
                          border: '1px solid #FCA5A5',
                          color: '#B91C1C',
                          fontSize: '0.6rem',
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          cursor: massProcessing ? 'default' : 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >Hide</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        ) : rows.length === 0 ? (
          <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>{emptyTitle}</div>
            <div style={{ fontSize: '0.78rem' }}>{emptyDetail}</div>
          </div>
        ) : (() => {
          const GRID = `${colWidths.company}px ${colWidths.aum}px ${colWidths.type}px ${colWidths.status}px ${colWidths.keyContacts}px ${colWidths.dm}px ${colWidths.met}px ${colWidths.ratio}px 28px`;
          const HEADER_COLUMNS = [
            { key: 'company',     label: 'Company',         align: 'left',   tip: 'Sort by company name' },
            { key: 'aum',         label: 'AUM',             align: 'right',  tip: 'PE AUM, falling back to RE AUM, from the prospect\'s Table View record' },
            { key: 'type',        label: 'Type',            align: 'left',   tip: 'Prospect type — Private Equity, Real Estate, etc.' },
            { key: 'status',      label: 'Status',          align: 'left',   tip: 'Prospect status — Client, Inside Sales, Qualifying, etc.' },
            { key: 'keyContacts', label: 'Key Contacts',    align: 'center', tip: 'Number of HubSpot contacts at this company tagged "Dan Key Target"' },
            { key: 'dm',          label: 'Decision Makers', align: 'center', tip: 'Number of HubSpot contacts at this company tagged "decision maker"' },
            { key: 'met',         label: 'Met in Person',   align: 'left',   tip: 'Met-in-person count / total decision makers, plus how many of them list New York / NYC' },
            { key: 'ratio',       label: 'Opps 2/4',        align: 'center', tip: 'Active / total opportunities for this company in the Opps tab' },
          ];
          const SORT_GLYPH = (key) => sortKey === key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
          const RESIZE_HANDLE = { position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, cursor: 'col-resize', userSelect: 'none' };
          return (
            <div style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID, background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', borderTopLeftRadius: 8, borderTopRightRadius: 8, position: 'sticky', top: 0, zIndex: 2 }}>
                {HEADER_COLUMNS.map(c => (
                  <div
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    title={c.tip}
                    style={{
                      position: 'relative',
                      padding: '0.35rem 0.6rem',
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: sortKey === c.key ? '#1E293B' : '#475569',
                      textAlign: c.align,
                      cursor: 'pointer',
                      userSelect: 'none',
                      background: sortKey === c.key ? '#E2E8F0' : 'transparent',
                      borderRight: '1px solid #E2E8F0',
                    }}
                  >
                    {c.label}{SORT_GLYPH(c.key)}
                    <span
                      onMouseDown={e => startResize(c.key, e)}
                      onClick={e => e.stopPropagation()}
                      style={RESIZE_HANDLE}
                      title="Drag to resize"
                    />
                  </div>
                ))}
                <div style={{ padding: '0.35rem 0.6rem' }}></div>
              </div>

              {filteredRows.length === 0 && (
                <div style={{ padding: '1rem', textAlign: 'center', color: '#64748B', fontSize: '0.78rem', background: '#FAFAFA', borderTop: '1px solid #F1F5F9' }}>
                  No companies match the current filters{query ? ` for "${query}"` : ''} — clear a filter or column search to see results.
                </div>
              )}
              {filteredRows.map((row, rowIdx) => {
                const isExpanded = expanded.has(row.key);
                const dmTotal = row.decisionMakerEntries.length;
                const met = row.metInPersonCount || 0;
                const nyc = row.nycCount || 0;
                const visibleOpps = (row.opps || []).filter(r => {
                  const stage = (r['Stage'] || '').trim();
                  if (!showClosed && CLOSED_STAGES.has(stage)) return false;
                  return true;
                });
                const oppsByStage = new Map();
                for (const r of visibleOpps) {
                  const k = (r['Stage'] || 'Unspecified').trim() || 'Unspecified';
                  if (!oppsByStage.has(k)) oppsByStage.set(k, []);
                  oppsByStage.get(k).push(r);
                }
                const stageOrder = Array.from(oppsByStage.keys()).sort((a, b) => a.localeCompare(b));

                return (
                  <div key={row.key} style={{ borderTop: rowIdx === 0 ? 'none' : '1px solid #E2E8F0' }}>
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      style={{ width: '100%', padding: 0, background: isExpanded ? '#F8FAFC' : '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', display: 'grid', gridTemplateColumns: GRID, alignItems: 'center' }}
                    >
                      <div
                        style={{ padding: '0.55rem 0.6rem', fontSize: '0.82rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        {row.prospect ? (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={e => { e.stopPropagation(); onSelectProspect?.(row.prospect); }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onSelectProspect?.(row.prospect); } }}
                            title={`Click to open ${row.companyName}`}
                            style={{ color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >{row.companyName}</span>
                        ) : (
                          <span style={{ color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.companyName}</span>
                        )}
                        {!row.prospect && (
                          <span style={{ padding: '1px 6px', fontSize: '0.55rem', fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 999, flexShrink: 0 }}>NO PROSPECT</span>
                        )}
                      </div>

                      <div
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontSize: '0.78rem', fontWeight: 600, color: row.aum ? '#1E293B' : '#CBD5E1' }}
                        title={row.aum ? `AUM: $${row.aum}B` : 'No AUM set on this prospect record'}
                      >
                        {formatAum(row.aum)}
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: row.type ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.type || '—'}
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: row.status ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.status || '—'}
                      </div>

                      <div
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}
                        title={row.contacts.map(c => c.name + (c.jobtitle ? ` (${c.jobtitle})` : '')).join('\n')}
                      >
                        <span style={{
                          padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                          background: '#CFFAFE', color: '#0E7490', border: '1px solid #67E8F9',
                        }}>{row.contacts.length}</span>
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}>
                        {dmTotal > 0 ? (
                          <span
                            title={row.decisionMakerEntries.map(e => e.name).join(', ')}
                            style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC' }}
                          >✓ {dmTotal}</span>
                        ) : (
                          <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}>✗ 0</span>
                        )}
                      </div>

                      {(() => {
                        if (dmTotal === 0) return <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: '#CBD5E1' }}>—</div>;
                        const nycList = row.decisionMakerEntries
                          .filter(e => /(new york|nyc)/i.test(e.city || ''))
                          .map(e => `${e.name}${e.city ? ` (${e.city})` : ''}`)
                          .join(', ');
                        const metList = row.decisionMakerEntries.filter(e => e.metInPerson).map(e => e.name).join(', ');
                        const tipParts = [];
                        if (met > 0) tipParts.push(`Met in person: ${metList}`);
                        else tipParts.push('No decision makers tagged "met in person" yet');
                        if (nyc > 0) tipParts.push(`In NY: ${nycList}`);
                        return (
                          <div style={{ padding: '0.55rem 0.6rem', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.72rem' }} title={tipParts.join('\n')}>
                            <span style={{
                              padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                              background: met > 0 ? '#DCFCE7' : '#F1F5F9',
                              color:      met > 0 ? '#166534' : '#94A3B8',
                              border: `1px solid ${met > 0 ? '#86EFAC' : '#E2E8F0'}`,
                            }}>{met}/{dmTotal}</span>
                            {nyc > 0 && (
                              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#5B21B6' }}>({nyc} in NY)</span>
                            )}
                          </div>
                        );
                      })()}

                      <div
                        style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: (row.activeOpps || 0) > 0 ? '#7C3AED' : (row.totalOpps || 0) > 0 ? '#64748B' : '#CBD5E1' }}
                        title="active / total opportunities for this company"
                      >
                        {(row.activeOpps || 0)}/{(row.totalOpps || 0)}
                      </div>

                      <div style={{ padding: '0.55rem 0.2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.8rem' }}>
                        {isExpanded ? '▾' : '▸'}
                      </div>
                    </button>

                    {isExpanded && (
                      <div style={{ padding: '0.75rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ background: '#FBFBFB', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.55rem 0.75rem' }}>
                          <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: '0.4rem' }}>
                            Key Target contacts <span style={{ color: '#94A3B8', fontWeight: 500 }}>({row.contacts.length})</span>
                          </div>
                          {(() => {
                            const CONTACT_GRID = '1.4fr 1.6fr 2fr 1.2fr 1.4fr 0.7fr 0.8fr 0.9fr';
                            return (
                              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: CONTACT_GRID, gap: '0.5rem', padding: '0.3rem 0.6rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B' }}>
                                  <div>Name</div>
                                  <div>Title</div>
                                  <div>Email</div>
                                  <div>Phone</div>
                                  <div>Location</div>
                                  <div>LinkedIn</div>
                                  <div>LinkedIn Search</div>
                                  <div>Met</div>
                                </div>
                                {row.contacts.map((c, i) => (
                                  <div
                                    key={c.id}
                                    style={{
                                      display: 'grid', gridTemplateColumns: CONTACT_GRID, gap: '0.5rem',
                                      padding: '0.4rem 0.6rem',
                                      borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                                      alignItems: 'center',
                                      background: i % 2 === 0 ? '#fff' : '#FCFCFD',
                                    }}
                                  >
                                    <div style={{ fontSize: '0.78rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Click to edit ${c.name}`}>
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={e => { e.stopPropagation(); setEditingContact(c.raw || c); }}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setEditingContact(c.raw || c); } }}
                                        style={{ color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline' }}
                                      >{c.name}</span>
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: c.jobtitle ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.jobtitle}>{c.jobtitle || '—'}</div>
                                    <div style={{ fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.email}>
                                      {c.email
                                        ? <a href={`mailto:${c.email}`} style={{ color: '#3B82F6', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>{c.email}</a>
                                        : <span style={{ color: '#CBD5E1' }}>—</span>}
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: c.phone ? '#64748B' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.phone}>{c.phone || '—'}</div>
                                    <div style={{ fontSize: '0.68rem', color: (c.city || c.state) ? '#64748B' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                                    </div>
                                    <div style={{ fontSize: '0.68rem' }}>
                                      {c.linkedin
                                        ? <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }} onClick={e => e.stopPropagation()}>Open ↗</a>
                                        : <span style={{ color: '#CBD5E1' }}>—</span>}
                                    </div>
                                    {(() => {
                                      const parts = [c.firstname, c.lastname, row.companyName].map(s => String(s || '').trim()).filter(Boolean);
                                      if (parts.length === 0) return <div style={{ fontSize: '0.62rem', color: '#CBD5E1' }}>—</div>;
                                      const keywords = encodeURIComponent(parts.join(' '));
                                      const liHref = `https://www.linkedin.com/search/results/people/?keywords=${keywords}`;
                                      const snHref = `https://www.linkedin.com/sales/search/people?keywords=${keywords}`;
                                      return (
                                        <div style={{ fontSize: '0.62rem', display: 'flex', flexDirection: 'column', gap: 1 }}>
                                          <a
                                            href={liHref}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={e => e.stopPropagation()}
                                            title={`Open regular LinkedIn people search for "${parts.join(' ')}".`}
                                            style={{ color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}
                                          >LinkedIn ↗</a>
                                          <a
                                            href={snHref}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={e => e.stopPropagation()}
                                            title={`Open Sales Navigator search pre-filtered to "${parts.join(' ')}".`}
                                            style={{ color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}
                                          >Sales Nav ↗</a>
                                        </div>
                                      );
                                    })()}
                                    <div>
                                      {c.metInPerson
                                        ? <span style={{ display: 'inline-block', padding: '1px 6px', fontSize: '0.6rem', fontWeight: 700, background: '#DCFCE7', color: '#166534', border: '1px solid #86EFAC', borderRadius: 999 }}>✓ Yes</span>
                                        : <span style={{ color: '#CBD5E1', fontSize: '0.68rem' }}>—</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>

                        {stageOrder.length > 0 && (
                          <>
                            {stageOrder.map(stage => {
                              const list = oppsByStage.get(stage) || [];
                              return (
                                <div key={stage} style={{ background: '#FBFBFB', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.55rem 0.75rem' }}>
                                  <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: '0.4rem' }}>
                                    {stage} <span style={{ color: '#94A3B8', fontWeight: 500 }}>({list.length})</span>
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.4rem' }}>
                                    {list.map((r, idx) => {
                                      const title = r['Opportunity Name'] || r['Opportunity'] || r['Name'] || r['Description'] || '(Unnamed opportunity)';
                                      const value = r['Amount'] || r['Value'] || r['$'] || '';
                                      const closeDate = r['Close Date'] || r['Est. Close'] || r['Target Close'] || '';
                                      return (
                                        <div
                                          key={`${row.key}-${idx}`}
                                          onClick={() => row.prospect && onSelectProspect?.(row.prospect)}
                                          style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 4, padding: '0.45rem 0.6rem', cursor: row.prospect ? 'pointer' : 'default' }}
                                          onMouseEnter={e => { if (row.prospect) e.currentTarget.style.borderColor = '#3B82F6'; }}
                                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; }}
                                        >
                                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
                                          <div style={{ fontSize: '0.68rem', color: '#3B82F6', fontWeight: 600 }}>{r['Account'] || ''}</div>
                                          {value && <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>{String(value).startsWith('$') ? value : `$${value}`}</div>}
                                          {closeDate && <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>Close: {closeDate}</div>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </>
                        )}

                        {visibleOpps.length === 0 && (
                          <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic' }}>
                            No {showClosed ? '' : 'active '}opportunities for this company in the Opps tab.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
      {editingContact && (() => {
        // Resolve sibling contacts at the same company so the Reports
        // To picker can offer managers; merge HubSpot domain hits with
        // any matching prospect's emailDomain field so corporate
        // emails group correctly.
        const editCompany = String(editingContact.company || '').trim().toLowerCase();
        const allHs = hubspotCache?.contacts || [];
        const sameCompanyContacts = editCompany
          ? allHs.filter(c => (c.company || '').trim().toLowerCase() === editCompany)
          : [];
        const matched = editCompany
          ? prospects.find(p => companiesMatch(p.company, editingContact.company))
          : null;
        const emailDomains = matched?.emailDomain
          ? String(matched.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)
          : [];
        return (
          <ContactEditModal
            contact={editingContact}
            onSave={handleContactSaved}
            onClose={() => setEditingContact(null)}
            contactNotes={settings?.contactNotes || {}}
            onSaveNote={handleSaveContactNote}
            contactOldEmails={settings?.contactOldEmails || {}}
            onSaveOldEmails={handleSaveContactOldEmails}
            contactNicknames={settings?.contactNicknames || {}}
            onSaveNickname={handleSaveContactNickname}
            contactTeamNames={settings?.contactTeamNames || {}}
            onSaveTeamName={handleSaveContactTeamName}
            contactReportsTo={settings?.contactReportsTo || {}}
            onSaveReportsTo={handleSaveContactReportsTo}
            companyContacts={sameCompanyContacts}
            emailDomains={emailDomains}
            companyNames={prospects.map(p => p.company).filter(Boolean)}
          />
        );
      })()}
    </div>
  );
}
