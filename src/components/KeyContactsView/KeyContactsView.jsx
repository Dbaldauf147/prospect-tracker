import { Component, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { apiFetch } from '../../utils/apiFetch';
import { useAuth } from '../../contexts/AuthContext';
import { getHubspotCache, updateHubspotCache } from '../../utils/hubspotContactsCache';
import { userLsGet } from '../../utils/userLs';
import { loadOpps2Newest } from '../../utils/opps2Store';
import { formatAum } from '../../utils/formatters';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import { tagReviewScore, TAG_OPTIONS, recordForVerdict, sameTagRecord, recordKeepsTag, tagKey, dedupeTags, planTagEdit, groupTagWrites, findTagRecord, tagRecordKeyFor } from '../../utils/contactTagReview';
import { toggleContactInEvents } from '../../utils/eventsStore';
import { buildCompanyGuessIndex, guessCompanyForContact } from '../../utils/companyGuess';
import { buildEmailFormatIndex, predictEmailForContact } from '../../utils/emailFormat';
import { matchesCdm } from '../../utils/cdmMatch';
import { checkCity, checkState } from '../../utils/locationStandardize';
import { getStateForCity, lookupStateForCity, CITY_OPTIONS, matchCities } from '../../data/cities';
import { useDraftCampaignQueue, setQueuedContactIds } from '../../utils/draftCampaignQueue';
import { withCompanyOverride } from '../../utils/contactCompanyOverride';

// Curated city names for the inline City autocomplete. Matches the
// predictive-text dropdown the Edit HubSpot Contact popup uses, so the
// flat All Contacts table offers the same suggestions (alias-aware via
// matchCities) and the same State / Country auto-fill on commit.
const CITY_NAME_OPTIONS = CITY_OPTIONS.map(o => o.name);
const matchCityNames = (query) => matchCities(query, CITY_OPTIONS).slice(0, 12);

// Click-to-edit cell used inside the All Contacts table. Idle state
// renders the value as plain text; on click it switches to an <input>
// (or autocomplete-style combobox when `suggestions` is provided),
// commits on blur / Enter, and discards on Escape. The actual write
// is delegated to `onCommit(nextValue)` so the parent can call the
// HubSpot endpoint and update the cache.

function InlineCell({
  value,
  onCommit,
  placeholder = '-',
  emptyColor = '#CBD5E1',
  fontSize = '0.72rem',
  fontWeight = 400,
  textColor = '#1E293B',
  align = 'left',
  type = 'text',
  suggestions = null,
  matchFn = null,
  suggestionsNoun = 'Table View companies',
  title,
  disabled = false,
  flagIssue = null,
  flagFix = null,
  // A flagged value the user has chosen to accept as-is. The warning stops
  // shouting — no amber, no Fix — but a muted marker stays, because a
  // silently suppressed warning is one nobody can find their way back to.
  flagIgnored = false,
  onToggleFlagIgnored = null,
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
    // A flag the user has told to be quiet: the cell reads like any other,
    // with a small grey marker to say the warning is still there and can be
    // brought back.
    if (flagIssue && flagIgnored) {
      return (
        <div
          onClick={startEdit}
          title={title || 'Click to edit'}
          style={{
            padding: '0.45rem 0.6rem', fontSize, fontWeight,
            color: empty ? emptyColor : textColor, textAlign: align,
            cursor: disabled ? 'default' : 'text',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{empty ? placeholder : value}</span>
          {onToggleFlagIgnored && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onToggleFlagIgnored(false); }}
              title={`Warning ignored: ${flagIssue}. Click to show it again.`}
              style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, color: '#CBD5E1', fontSize: '0.62rem', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }}
            >⚠</button>
          )}
        </div>
      );
    }
    // Non-standard value: amber background, a ⚠ marker, and a one-click
    // Fix button when a standardized replacement is available.
    if (flagIssue) {
      return (
        <div
          onClick={startEdit}
          title={flagIssue}
          style={{
            padding: '0.45rem 0.6rem',
            fontSize,
            fontWeight,
            color: empty ? emptyColor : textColor,
            textAlign: align,
            cursor: disabled ? 'default' : 'text',
            background: '#FEF3C7',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {/* The marker doubles as the dismiss control when the caller
              allows ignoring. These columns run as narrow as 80px, where a
              separate Ignore button squeezed the value itself out of the
              cell — and the value is the one thing that has to stay
              readable. Same glyph brings it back afterwards. */}
          {onToggleFlagIgnored ? (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onToggleFlagIgnored(true); }}
              aria-label="Ignore this warning"
              title={`${flagIssue}\n\nClick the ⚠ to ignore: accept this value as-is and stop warning about it.`}
              style={{ flexShrink: 0, background: 'none', border: 'none', padding: 0, color: '#B45309', fontWeight: 700, fontSize: 'inherit', fontFamily: 'inherit', cursor: 'pointer', lineHeight: 1 }}
            >⚠</button>
          ) : (
            <span style={{ flexShrink: 0, color: '#B45309', fontWeight: 700 }}>⚠</span>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{empty ? placeholder : value}</span>
          {flagFix && flagFix !== value && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); commit(flagFix); }}
              title={`Set to "${flagFix}"`}
              style={{ flexShrink: 0, background: '#ECFDF5', border: '1px solid #6EE7B7', color: '#065F46', fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}
            >Fix</button>
          )}
        </div>
      );
    }
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
  // `matchFn` (e.g. the city autocomplete using alias-aware matchCities)
  // overrides the default substring filter when provided.
  const matches = matchFn
    ? matchFn(draft)
    : (suggestions && suggestions.length > 0
      ? (q ? suggestions.filter(n => String(n).toLowerCase().includes(q)).slice(0, 50) : suggestions.slice(0, 50))
      : []);
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
              ? `No ${suggestionsNoun} loaded`
              : draft.trim()
                ? `${matches.length} of ${(suggestions || []).length} match "${draft.trim()}"`
                : `${(suggestions || []).length} ${suggestionsNoun}`}
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
                ? <>No {suggestionsNoun} match <strong style={{ color: '#1E293B', fontStyle: 'normal' }}>"{draft.trim()}"</strong>. Press <strong style={{ color: '#1E293B', fontStyle: 'normal' }}>Enter</strong> to save your typed value as-is.</>
                : <>Start typing to filter the {(suggestions || []).length} {suggestionsNoun}.</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Read-only cell for the Changed Jobs "Expected Email" column. Takes the
// status-tagged prediction from predictEmailForContact and either shows
// the guessed address with a Copy button, or a muted explanation of why
// no address could be produced yet.
function ExpectedEmailCell({ info, name }) {
  const [copied, setCopied] = useState(false);
  const status = info?.status || 'no-company';
  const muted = (text, title) => (
    <div
      title={title || undefined}
      style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem', color: '#94A3B8', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
    >{text}</div>
  );
  if (status === 'no-company') return muted('-', 'Map a New Company to predict an email.');
  if (status === 'no-domain') return muted('Domain unknown', `We don't have an email domain on file for "${info.company}", so no address can be predicted. Add the company to the Table View with an Email Domain / Website to enable this.`);
  if (status === 'no-format') return muted('Format unknown', `We know the domain (${info.domain}) but haven't seen enough contacts there to learn its email format.`);
  if (status === 'no-name') return muted('Missing name', 'This contact is missing the first/last name needed to build the address.');
  const email = info.email;
  const provenance = info.sample
    ? `Predicted from ${info.domain}'s format (${info.label}). Learned from ${info.votes}/${info.total} known contact${info.total === 1 ? '' : 's'}, e.g. ${info.sample}.`
    : `Predicted from ${info.domain}'s format (${info.label}).`;
  const doCopy = (e) => {
    e.stopPropagation();
    try {
      navigator.clipboard?.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — ignore */ }
  };
  return (
    <div style={{ padding: '0.3rem 0.5rem', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }} title={provenance}>
      <span style={{ color: '#065F46', fontSize: '0.72rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
      <button
        type="button"
        onClick={doCopy}
        title={`Copy ${name ? `${name}'s ` : ''}predicted email`}
        style={{
          background: copied ? '#065F46' : '#ECFDF5',
          border: '1px solid #6EE7B7',
          color: copied ? '#fff' : '#065F46',
          fontSize: '0.6rem',
          fontWeight: 700,
          padding: '1px 6px',
          borderRadius: 4,
          cursor: 'pointer',
          fontFamily: 'inherit',
          flexShrink: 0,
        }}
      >{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

// Mass Edit tag modes that record one of the contact popup's local answers
// rather than only switching the HubSpot tag. Add / Remove / Replace can
// only say the tag is on or off, and "off" is the ambiguous one — doesn't
// apply, haven't looked, or theirs but not bought yet all look identical.
// Those are the answers the Tagged % counts, and they were only settable
// one contact at a time.
//
// `tagMode` is what the HubSpot half of the write does, and it follows the
// same rule the popup does: Sold keeps the tag on (a general pull should
// still return them), the other three take it off.
// The bulk equivalents of the contact popup's own buttons, in the popup's
// order: the Answer group, then the Status group.
//
// `tagMode` is the direction the mark takes the HubSpot tag for almost every
// contact, and it's what decides whether the action confirms first. It is NOT
// what performs the write: the tag each contact ends up with is decided per
// contact from the record the mark leaves behind (recordKeepsTag), because
// Yes is the one mark whose tag half isn't uniform — a contact already held
// off by a Not sold records the Yes and keeps the tag off, which is the whole
// point of a hold-off.
const MASS_TAG_VERDICTS = [
  { mode: 'yes', label: 'Mark Yes', verb: 'Marked Yes', tagMode: 'add' },
  { mode: 'no', label: 'Mark No', verb: 'Marked No', tagMode: 'remove' },
  { mode: 'unsure', label: 'Mark Not sure', verb: 'Marked Not sure', tagMode: 'remove' },
  { mode: 'sold', label: 'Mark Sold', verb: 'Marked Sold', tagMode: 'add' },
  { mode: 'notsold', label: 'Mark Not sold', verb: 'Marked Not sold', tagMode: 'remove' },
];
const massTagVerdict = (mode) => MASS_TAG_VERDICTS.find(v => v.mode === mode) || null;

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
    (async () => {
      // Read the canonical Opps 2 store the way the rest of the app does:
      // the strictly-newer of the local IndexedDB cache and the Firestore
      // doc, with Firestore's chunked payload reassembled. The inline
      // reader this replaced only read the doc's `json` field and bailed
      // when the doc was chunked (large datasets), and it always preferred
      // local IDB even when Firestore was newer.
      try {
        const data = await loadOpps2Newest(userId);
        const recs = Array.isArray(data?.records) ? data.records : null;
        if (!cancelled && recs && recs.length > 0) setRecords(recs);
      } catch { /* leave records empty on failure */ }
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
        'visible-cols', 'contact-col-widths', 'contact-col-filters', 'contact-col-value-filters',
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
            Something in this page's render or recent interaction threw an error. The reset button below clears your per-page column widths / filter / sort preferences in localStorage and reloads: your HubSpot data and Firestore settings are not affected.
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
  // Adds a "New Company" mapping column plus an "Expected Email" column
  // that predicts the contact's address at that new employer from the
  // company's learned email format. Used by the Changed Jobs tab so a
  // person who left their old company can be re-targeted at the new one.
  showNewCompanyEmail = false,
  // Adds a per-row "Reached out" toggle in the actions column (and a
  // "Reached Out" status column) so the user can track who they've
  // already contacted at their new employer. Used by the Changed Jobs tab.
  showReachedOut = false,
  // Optional categorisation function. When provided, KeyContactsView
  // renders an extra "Category" column showing coloured pills for
  // each label the function returns. Used by All Contacts to mark
  // each row as Key / Active / Client (or any combination thereof).
  categorizeContact = null,
  // Optional controlled category filter. When set to a label (e.g.
  // 'Key'), the flat contacts list is narrowed to rows whose
  // categorizeContact() output includes that label. Driven by the
  // clickable Totals pills on the All Contacts page. null = no filter.
  categoryFilter = null,
  // When true, a contact's company name renders as a hyperlink that opens
  // the company popup (via onSelectProspect) instead of an inline-edit
  // cell — used by All Contacts. Only applies to rows mapped to a prospect;
  // unmapped companies stay editable so they can be fixed/mapped.
  linkCompanyToProspect = false,
  // Default view mode when no per-page localStorage entry exists yet.
  // 'contacts' (the default) lands the user on the flat name-by-name
  // table; 'companies' lands them on the By Company rollup. Used by
  // Key Prospects which is meant to be an account-level worklist.
  defaultViewMode = 'contacts',
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
  const [massField, setMassField] = useState('company');
  const [massValue, setMassValue] = useState('');
  const [massStatus, setMassStatus] = useState(null); // { type, message }
  const [massProcessing, setMassProcessing] = useState(false);
  const [massCompanyOpen, setMassCompanyOpen] = useState(false);
  const [massCompanyHover, setMassCompanyHover] = useState(0);
  const massCompanyBoxRef = useRef(null);
  // Bulk tag editing (massField === 'dans_tags'). Tags are a
  // multi-value HubSpot property, so a single "new value" box doesn't
  // fit: instead the user picks one or more tags and an operation —
  // add them, remove them, replace the whole list, or record one of the
  // popup's local answers (No / Not sure / Sold / Not sold) across the
  // selection. See MASS_TAG_VERDICTS.
  const [massTagMode, setMassTagMode] = useState('add');
  const [massTags, setMassTags] = useState(() => new Set());
  const [massTagOpen, setMassTagOpen] = useState(false);
  const [massTagQuery, setMassTagQuery] = useState('');
  const massTagBoxRef = useRef(null);
  function toggleMassTag(tag) {
    setMassTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }
  // Push the currently-selected contacts into the Custom Email Campaign
  // queue (Draft Emails page). Shared by the Mass Edit toolbar and the
  // normal-mode selection bar, so "Queue for Campaign" works whether or
  // not Mass Edit is on.
  const queueSelectedForCampaign = useCallback(() => {
    if (massSelected.size === 0) return;
    const current = new Set(queuedIds);
    let added = 0, already = 0;
    for (const id of massSelected) {
      const k = String(id);
      if (current.has(k)) already++;
      else { current.add(k); added++; }
    }
    setQueuedContactIds(Array.from(current));
    setMassStatus({
      type: 'success',
      message: added === 0
        ? `All ${already} already queued`
        : `Queued ${added}${already > 0 ? ` · ${already} already queued` : ''} for Custom Email Campaign`,
    });
    setTimeout(() => setMassStatus(null), 3500);
  }, [massSelected, queuedIds]);
  useEffect(() => {
    if (!massCompanyOpen) return;
    const onDown = (e) => { if (!massCompanyBoxRef.current?.contains(e.target)) setMassCompanyOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [massCompanyOpen]);
  useEffect(() => {
    if (!massTagOpen) return;
    const onDown = (e) => { if (!massTagBoxRef.current?.contains(e.target)) setMassTagOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [massTagOpen]);
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
      const res = await apiFetch('/api/hubspot?action=update-contact', {
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
    // Company-field saves rename the Company record this contact is linked
    // to (so the new name lands in HubSpot and cascades to every contact at
    // that company). Keep a local override only when that push fails, or
    // when the contact had no company and HubSpot linked it to a
    // differently-named record. Mirror HubSpotView.handleInlineUpdate:
    //   - rename/associate failed → keep override = typed value
    //   - associate fallback matched a different name → keep override
    //   - rename succeeded (or names already matched) → clear override
    if (field === 'company') {
      // Always pin the typed value locally so it survives a refresh
      // regardless of HubSpot sync/association timing; the API also renamed
      // the linked Company record. (Empty string → clear the override.)
      const nextLocal = withCompanyOverride(settings?.contactLocalFields, id, next);
      if (companyAssignment?.ok === false) {
        const what = companyAssignment.mode === 'rename-failed' ? 'rename the Company record' : 'pin the Company association';
        setMassStatus({ type: 'success', message: `Saved "${next}" locally. HubSpot couldn't ${what}: Prospect Tracker will keep your typed value here.` });
      } else if (companyAssignment?.nameDiffers && companyAssignment?.matchedName) {
        setMassStatus({ type: 'success', message: `Saved "${next}" locally. This contact had no linked company, so HubSpot linked it to "${companyAssignment.matchedName}".` });
      } else if (companyAssignment?.mode === 'renamed') {
        setMassStatus({ type: 'success', message: `Renamed the HubSpot Company "${companyAssignment.oldName || '-'}" → "${next}" (updates every contact linked to it).` });
      }
      if (nextLocal) updateSettings({ contactLocalFields: nextLocal });
    }
  }

  // The same pin, from the Edit HubSpot Contact popup. Without it the
  // popup's Company edit lives only in the local HubSpot cache, and the
  // next refresh — My Accounts loading, the Contacts tab's Refresh, another
  // device syncing — rewrites the contact's company from the Company record
  // HubSpot has it associated with, putting the old name back. The inline
  // cell has always pinned it; the popup is the way a contact already mapped
  // to a prospect gets edited at all, since that cell renders as a link.
  const saveCompanyOverride = useCallback((contactId, value) => {
    const nextLocal = withCompanyOverride(settings?.contactLocalFields, contactId, value);
    if (nextLocal) updateSettings({ contactLocalFields: nextLocal });
  }, [settings?.contactLocalFields, updateSettings]);

  // Persist the "New Company" a changed-jobs contact moved to. Stored in
  // the same per-contact local settings bag as _companyOverride, under
  // _newCompany, so it survives refreshes but is never pushed to HubSpot
  // (pushing it would overwrite the Company field and drop the contact
  // off the Changed Jobs tab). Empty clears the mapping.
  function setNewCompanyMapping(contact, value) {
    const id = String(contact?.id || contact?.vid || '');
    if (!id) return;
    const next = String(value ?? '').trim();
    const cur = settings?.contactLocalFields || {};
    const merged = { ...(cur[id] || {}) };
    if (next) merged._newCompany = next;
    else delete merged._newCompany;
    const nextLocal = { ...cur };
    if (Object.keys(merged).length === 0) delete nextLocal[id];
    else nextLocal[id] = merged;
    updateSettings({ contactLocalFields: nextLocal });
  }

  // Toggle the "reached out" flag for a changed-jobs contact. Stored in
  // the same per-contact local settings bag under _reachedOut (+ a
  // timestamp), synced via Firestore, never pushed to HubSpot. Pass an
  // explicit `next` to force a value, or omit to flip the current one.
  function toggleReachedOut(contact, next) {
    const id = String(contact?.id || contact?.vid || '');
    if (!id) return;
    const cur = settings?.contactLocalFields || {};
    const merged = { ...(cur[id] || {}) };
    const value = next === undefined ? !merged._reachedOut : !!next;
    if (value) { merged._reachedOut = true; merged._reachedOutAt = new Date().toISOString(); }
    else { delete merged._reachedOut; delete merged._reachedOutAt; }
    const nextLocal = { ...cur };
    if (Object.keys(merged).length === 0) delete nextLocal[id];
    else nextLocal[id] = merged;
    updateSettings({ contactLocalFields: nextLocal });
  }

  // When a City is committed inline, auto-fill State and Country the
  // same way the Edit HubSpot Contact popup does: try the curated city
  // list first (fast, handles ambiguous-name cities by leaving State
  // alone), then fall back to the Nominatim geocoder. Only blank fields
  // are filled — a State/Country the user already entered is never
  // overridden. `current` carries the row's existing state/country so
  // we know what's safe to fill.
  async function autoFillLocationFromCity(contact, cityValue, current = {}) {
    const city = (cityValue || '').trim();
    if (!city) return;
    const hasState = !!String(current.state || '').trim();
    const hasCountry = !!String(current.country || '').trim();
    // Mirror the popup: if a State is already present we leave the
    // location alone entirely rather than second-guessing it.
    if (hasState) return;
    let state = '';
    let country = '';
    const local = getStateForCity(city);
    if (local) {
      state = local.state || '';
      country = local.country || '';
    } else {
      const result = await lookupStateForCity(city, current.country);
      if (result) { state = result.state || ''; country = result.country || ''; }
    }
    if (state && !hasState) await inlineUpdateField(contact, 'state', state);
    if (country && !hasCountry) await inlineUpdateField(contact, 'country', country);
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
        const res = await apiFetch('/api/hubspot?action=update-contact', {
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

  // Bulk tag editor. Applies one operation to the Dan's Tags property
  // of every contact in `contactIds`:
  //   add     — union of the contact's existing tags and `tags`
  //   remove  — existing tags minus `tags`
  //   replace — `tags` becomes the whole list (empty clears the field)
  // Matching is case-insensitive but existing spellings are preserved,
  // so an add of "hide" never rewrites a contact's "Hide" to lowercase.
  // Contacts already in the requested state are reported as unchanged
  // instead of being written, so a bulk add across a mixed selection
  // only touches the rows that actually need it. Only writes HubSpot
  // accepted are mirrored into the local cache.
  // The tags HubSpot holds for these contacts right now, as a Map of
  // id -> tag string. An id HubSpot has no contact for is absent from the
  // map rather than empty, so the caller can tell "no tags" from "no such
  // contact". Returns null when the read itself fails — the caller then
  // falls back to the cached snapshot.
  async function fetchLiveContactTags(ids) {
    try {
      const res = await apiFetch('/api/hubspot?action=contact-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: ids }),
      });
      const json = await res.json();
      if (!res.ok || json.error || !json.tags) return null;
      return new Map(Object.entries(json.tags));
    } catch {
      return null;
    }
  }

  async function applyTagEdit(contactIds, mode, tags) {
    const ids = [...new Set((contactIds || []).map(String).filter(Boolean))];
    // Two spellings of one tag are one tag (see tagKey), so a pick list
    // holding both writes it once.
    const chosen = dedupeTags(tags);
    const empty = { updated: 0, unchanged: 0, skipped: 0, errors: 0, errorMessage: '' };
    if (ids.length === 0) return empty;
    if (mode !== 'replace' && chosen.length === 0) return empty;
    // What HubSpot has right now for exactly these contacts. dans_tags is
    // one string, so the write below is a whole-list overwrite: built from
    // the cached snapshot it silently reverts any tag changed in HubSpot
    // since the last sync, and a contact the snapshot has never seen would
    // be written as if they had no tags at all — wiping the rest. The cache
    // is only the fallback for a read that fails outright.
    const live = await fetchLiveContactTags(ids);
    const cache = hubspotCache?.contacts || [];
    const cachedTags = (id) => {
      const c = cache.find(x => String(x.id) === id) || cache.find(x => String(x.vid) === id);
      return c ? String(c.dans_tags || c.dan_s_tags || c.dans_tag || '') : undefined;
    };
    const nextById = new Map();
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    let errors = 0;
    let firstErrorMessage = '';
    for (const id of ids) {
      const current = live ? live.get(id) : cachedTags(id);
      const plan = planTagEdit(mode, chosen, current);
      if (plan.action === 'skip') { skipped += 1; continue; }
      if (plan.action === 'unchanged') { unchanged += 1; continue; }
      const nextStr = plan.tags;
      try {
        const res = await apiFetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: id, properties: { dans_tags: nextStr } }),
        });
        const json = await res.json();
        if (json.error || !res.ok) {
          errors += 1;
          if (!firstErrorMessage) firstErrorMessage = json.error || `HubSpot ${res.status}`;
          continue;
        }
        updated += 1;
        nextById.set(id, nextStr);
      } catch (err) {
        errors += 1;
        if (!firstErrorMessage) firstErrorMessage = err?.message || 'Network error';
      }
    }
    if (nextById.size > 0) {
      try {
        await updateHubspotCache(draft => {
          for (const c of draft.contacts) {
            const nextStr = nextById.get(String(c.id || c.vid));
            if (nextStr === undefined) continue;
            c.dans_tags = nextStr;
            // Legacy field spellings shadow dans_tags when it's blank
            // (readers do `dans_tags || dan_s_tags || dans_tag`), so a
            // clear has to wipe them too or the old tags come back.
            if (c.dan_s_tags !== undefined) c.dan_s_tags = nextStr;
            if (c.dans_tag !== undefined) c.dans_tag = nextStr;
          }
        });
      } catch (err) { console.warn('Tag cache update failed', err); }
    }
    return { updated, unchanged, skipped, errors, errorMessage: firstErrorMessage };
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
      const res = await apiFetch('/api/hubspot?action=update-contact', {
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
        ? ': add "Hide" to the Dan\'s Tags allowed values in HubSpot Settings → Properties.'
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
      ? ': add "Hide" to the Dan\'s Tags allowed values in HubSpot Settings → Properties.'
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
      alert('No HubSpot contacts loaded: sync HubSpot Contacts first.');
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
      // When the page supplies its own categoriser (All Contacts), use it
      // so the export is a 1:1 dump of every contact the page surfaces —
      // including the Key Prospect category — rather than the internal
      // Key/Active/Client recomputation below.
      if (categorizeContact) {
        const categories = categorizeContact(c) || [];
        if (categories.length === 0) continue;
        out.push({ contact: c, categories });
        continue;
      }
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
      alert(categorizeContact ? 'No contacts to export.' : 'No contacts qualify for any of the three tabs.');
      return;
    }
    // Label used for the workbook title, sheet name, and download file.
    const exportLabel = categorizeContact ? 'All Contacts' : 'Contacts (Combined: Key + Active + Client)';
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
    const ws = wb.addWorksheet(categorizeContact ? 'All Contacts' : 'Contacts (Combined)', {
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
      { label: 'Met In Person', width: 14, get: ({ contact: c }) => resolveMetInPerson(c) ? 'Yes' : '' },
      { label: 'Events',        width: 30, get: ({ contact: c }) => contactEvents[String(c.id || '')] || '' },
      { label: 'Tags',          width: 30, get: ({ contact: c }) => c.dans_tags || c.dan_s_tags || c.dans_tag || '' },
    ];
    ws.columns = columns.map(c => ({ width: Math.min(c.width, 30) }));

    // Title row — Schneider green band, white text.
    ws.mergeCells(1, 1, 1, columns.length);
    const title = ws.getCell(1, 1);
    title.value = `${exportLabel} · ${out.length} contact${out.length === 1 ? '' : 's'}`;
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
    a.download = `${categorizeContact ? 'all-contacts' : 'contacts-combined'}-${date}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadContactsCsv() {
    const list = isContactList
      ? filteredContacts
      : filteredRows.flatMap(row => row.contacts.map(c => ({
          ...c,
          companyName: row.companyName,
          prospect: row.prospect,
        })));
    if (!list || list.length === 0) {
      alert('No contacts to download: adjust your filters.');
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

  // Record a local tag answer (No / Not sure / Sold / Not sold) against
  // every selected contact, in ONE settings write. The popup saves a
  // contact at a time, which is right for one contact and wrong for 26:
  // each write builds its patch from the settings it captured, so a
  // burst of them ends with the last writer's copy — most of the answers
  // silently lost. Returns how many contacts actually changed.
  //
  // A record holds an answer and a sale status, and a mark sets one half
  // without disturbing the other — recordForVerdict applies it exactly as
  // the popup's own buttons would, per contact, so a Yes already recorded
  // survives a bulk Not sold.
  // Returns { touched, wanted } — how many contacts' answers changed, and
  // per contact which of the chosen tags the mark leaves them wanting ON and
  // which OFF. The caller writes the tags from `wanted` rather than from one
  // direction for the whole batch, so a Yes marked over a Not sold records
  // the Yes without putting the tag back.
  function saveMassTagVerdicts(ids, tags, verdict) {
    const wanted = new Map();
    if (!updateSettings) return { touched: 0, wanted };
    const next = { ...(settings?.contactTagReview || {}) };
    let touched = 0;
    for (const id of ids) {
      const key = String(id);
      if (!key) continue;
      const map = { ...(next[key] || {}) };
      let changed = false;
      const on = [];
      const off = [];
      for (const tag of tags) {
        // The record may already be saved under the other spelling of this
        // tag — the popup writes the vocabulary's, this picker writes
        // HubSpot's. Read through either and write back onto the key that's
        // already there, or the answer lands somewhere the popup can't see.
        const storedKey = tagRecordKeyFor(map, tag);
        const stored = findTagRecord(map, tag);
        const record = recordForVerdict(stored, verdict);
        (recordKeepsTag(record) ? on : off).push(tag);
        if (sameTagRecord(stored, record)) continue;
        map[storedKey] = record;
        changed = true;
      }
      wanted.set(key, { on, off });
      if (changed) { next[key] = map; touched += 1; }
    }
    if (touched > 0) updateSettings({ contactTagReview: next });
    return { touched, wanted };
  }

  // Bulk tag apply — the Tags field of the Mass Edit toolbar. Replace
  // is destructive (it drops tags the user never picked, including
  // Hide), so it asks first; add / remove do exactly what they say and
  // don't.
  //
  // Three of the four Mark options are destructive too, and less obviously:
  // No, Not sure and Not sold each take the HubSpot tag off every selected
  // contact as a side effect of recording the answer. That's the intended
  // rule — a Not sold is a hold-off, and keeping the tag off is what makes
  // it hold — but "Mark Not sold" doesn't look like "untag 22 people", so it
  // asks first as well.
  //
  // The verdict modes are two writes in one: the answer goes to settings
  // for every selected contact, and the HubSpot tag follows it on or off
  // (see MASS_TAG_VERDICTS). The counts differ on purpose — marking 26
  // contacts "Not sold" for a tag only 4 of them carry is 26 answers and
  // 4 tag removals, and the status line says both.
  async function handleMassTagApply() {
    if (massSelected.size === 0) return;
    const tags = [...massTags];
    if (massTagMode !== 'replace' && tags.length === 0) return;
    const verdict = massTagVerdict(massTagMode);
    const n = massSelected.size;
    const plural = n === 1 ? '' : 's';
    if (massTagMode === 'replace') {
      const message = tags.length === 0
        ? `Clear every tag on ${n} selected contact${plural}?`
        : `Replace the tags on ${n} selected contact${plural} with ${tags.join(', ')}? Any other tags they have today are removed.`;
      if (!window.confirm(message)) return;
    } else if (verdict && verdict.tagMode === 'remove') {
      const message = `${verdict.label} for ${tags.join(', ')} on ${n} selected contact${plural}?`
        + `\n\nThat records the answer AND takes ${tags.length === 1 ? 'that tag' : 'those tags'} off `
        + `${n === 1 ? 'the contact' : `all ${n}`} in HubSpot, so they stop coming back in a general pull of it.`;
      if (!window.confirm(message)) return;
    }
    setMassProcessing(true);
    setMassStatus(null);
    const ids = [...massSelected];
    // The answers are the user's own and don't depend on HubSpot taking
    // the tag change, so they're recorded whatever the writes below do.
    // A contact who already had the tag off still gets the answer — that
    // case IS the point of the mode.
    const { touched: marked, wanted } = verdict
      ? saveMassTagVerdicts(ids, tags, verdict.mode)
      : { touched: 0, wanted: null };
    // The tag half. A plain Add / Remove / Replace is one write for the whole
    // selection; a Mark is whatever each contact's new record asks for, which
    // is only uniform until a Yes lands on someone held off by a Not sold.
    const runs = wanted
      ? groupTagWrites(ids, wanted)
      : [{ mode: massTagMode, tags, ids }];
    let updated = 0, unchanged = 0, skipped = 0, errors = 0, errorMessage = '';
    let tagsAdded = 0, tagsRemoved = 0;
    for (const run of runs) {
      const r = await applyTagEdit(run.ids, run.mode, run.tags);
      updated += r.updated;
      unchanged += r.unchanged;
      skipped += r.skipped;
      errors += r.errors;
      if (!errorMessage) errorMessage = r.errorMessage;
      if (run.mode === 'add') tagsAdded += r.updated; else tagsRemoved += r.updated;
    }
    // The API registers a tag that isn't in the Dan's Tags allowed values
    // and retries, so "go add it by hand" is only the right advice when
    // that didn't happen — and the API's own message says so when it did.
    // Keep the manual instruction only for an allowed-options failure that
    // came back without one.
    const hint = errors > 0
      && /allowed options|doesn't allow the value/i.test(errorMessage)
      && !/Dan's Tags/i.test(errorMessage)
      ? ' Add it to the Dan\'s Tags allowed values in HubSpot Settings → Properties, then try again.'
      : '';
    const verb = verdict
      ? verdict.verb
      : (massTagMode === 'add' ? 'Tagged' : massTagMode === 'remove' ? 'Untagged' : 'Retagged');
    // A verdict counts the answers written, then reports the tag half
    // separately — "already up to date" against the answer count would
    // read as "nothing to do" on the run that did the most work.
    // A verdict counts the answers written, then reports the tag half
    // separately — and reports both directions, because a Mark Yes over a
    // Not sold records the Yes while leaving the tag alone.
    const tagMoves = [
      tagsAdded > 0 ? `tag added to ${tagsAdded}` : '',
      tagsRemoved > 0 ? `tag removed from ${tagsRemoved}` : '',
    ].filter(Boolean).join(' · ') || 'no tag changes needed';
    const head = verdict
      ? `${verb} on ${marked || n} contact${(marked || n) === 1 ? '' : 's'} for ${tags.join(', ')}`
        + ` · ${tagMoves}`
      : `${verb} ${updated} contact${updated === 1 ? '' : 's'}`
        + (unchanged > 0 ? ` · ${unchanged} already up to date in HubSpot` : '');
    // A contact HubSpot has no record of was left alone rather than written
    // from a guess — say so, because silence there reads as success.
    const skippedNote = skipped > 0
      ? ` · ${skipped} skipped (HubSpot has no contact with that ID)`
      : '';
    setMassStatus({
      type: errors === 0 && skipped === 0 ? 'success' : 'partial',
      message: head + skippedNote + (errors > 0 ? ` · ${errors} failed: ${errorMessage}${hint}` : ''),
    });
    setMassProcessing(false);
    // Clear the chosen tags, keep the chosen contacts. Tagging a group is
    // rarely one tag — add EU, then Decision Maker, then Dan Key Target —
    // and dropping the selection on every apply meant re-ticking the whole
    // list between them. The tags themselves do clear, so the next apply
    // can't repeat the last one by accident.
    if (errors === 0) setMassTags(new Set());
  }

  async function handleMassApply() {
    if (massField === 'dans_tags') { await handleMassTagApply(); return; }
    if (massSelected.size === 0 || !massValue.trim()) return;
    setMassProcessing(true);
    setMassStatus(null);
    let updated = 0, errors = 0;
    const value = massValue.trim();
    for (const id of massSelected) {
      try {
        const res = await apiFetch('/api/hubspot?action=update-contact', {
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
    // Same as the tag path: the typed value clears, the selection stays, so
    // a second field can be set on the same contacts without picking them
    // again. Hide is the one that still clears — those rows leave the list,
    // so holding their ids selected would only strand the count.
    setMassValue('');
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
  // Per-contact "Custom" free-text field, stored in Firestore settings
  // under `customField` keyed by HubSpot contact id. Shared with the
  // {custom} email variable (DraftEmailView) and the HubSpot Contacts
  // grid's Custom column. Mirrors handleSaveContactEvents — an
  // empty / whitespace value deletes the key (same as contactNotes).
  const handleSaveContactCustom = useCallback((cid, val) => {
    const cur = settings?.customField || {};
    const next = { ...cur };
    const v = String(val || '').trim();
    if (v) next[cid] = v; else delete next[cid];
    updateSettings({ customField: next });
  }, [settings?.customField, updateSettings]);
  const handleSaveContactOldEmails = useCallback((cid, val) => {
    const cur = settings?.contactOldEmails || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactOldEmails: next });
  }, [settings?.contactOldEmails, updateSettings]);
  const handleSaveContactOldCompany = useCallback((cid, val) => {
    const cur = settings?.contactOldCompany || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactOldCompany: next });
  }, [settings?.contactOldCompany, updateSettings]);
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
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(lsKey('view-mode')) || defaultViewMode);
  useEffect(() => { try { localStorage.setItem(lsKey('view-mode'), viewMode); } catch {} }, [viewMode]);
  // Travel mode (All Contacts only) — a third view alongside All Contacts /
  // By Company. Pick a state and/or city and the flat contacts table
  // narrows to people in that area, so a trip can be planned around who's
  // nearby. The chosen location persists alongside the other view prefs.
  const travelEnabled = storagePrefix === 'all-contacts';
  const isTravel = travelEnabled && viewMode === 'travel';
  // "By Location" rollup — contacts counted by State and City. Like
  // Travel, it's an All Contacts–only view.
  const isGeography = travelEnabled && viewMode === 'geography';
  // Everything that isn't the By Company rollup or the By Location rollup
  // renders the flat contacts table (All Contacts + Travel share the same
  // table, Travel just adds a location filter on top).
  const isContactList = viewMode !== 'companies' && viewMode !== 'geography';
  // Expanded states in the By Location view (state → its cities).
  const [geoExpanded, setGeoExpanded] = useState(() => new Set());
  function toggleGeo(key) {
    setGeoExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const [travelState, setTravelState] = useState(() => localStorage.getItem(lsKey('travel-state')) || '');
  const [travelCity, setTravelCity] = useState(() => localStorage.getItem(lsKey('travel-city')) || '');
  useEffect(() => { try { localStorage.setItem(lsKey('travel-state'), travelState); } catch {} }, [travelState]);
  useEffect(() => { try { localStorage.setItem(lsKey('travel-city'), travelCity); } catch {} }, [travelCity]);
  // "Only city/state needing cleanup" filter — narrows the contacts
  // list to rows whose City or State fails the standard-format checks.
  const [onlyLocationFlagged, setOnlyLocationFlagged] = useState(() => localStorage.getItem(lsKey('only-loc-flagged')) === '1');
  useEffect(() => { try { localStorage.setItem(lsKey('only-loc-flagged'), onlyLocationFlagged ? '1' : '0'); } catch {} }, [onlyLocationFlagged]);
  const [contactSortKey, setContactSortKey] = useState(() => localStorage.getItem(lsKey('contact-sort-key')) || 'name');
  const [contactSortDir, setContactSortDir] = useState(() => localStorage.getItem(lsKey('contact-sort-dir')) || 'asc');
  useEffect(() => { try { localStorage.setItem(lsKey('contact-sort-key'), contactSortKey); } catch {} }, [contactSortKey]);
  useEffect(() => { try { localStorage.setItem(lsKey('contact-sort-dir'), contactSortDir); } catch {} }, [contactSortDir]);
  function toggleContactSort(key) {
    setContactSortDir(prev => (contactSortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
    setContactSortKey(key);
  }

  const DEFAULT_CONTACT_COL_WIDTHS = {
    name: 180, category: 160, title: 200, company: 200, suggestedCompany: 220, newCompany: 200, expectedEmail: 220, reachedOut: 150, email: 240, phone: 140, location: 140, city: 120, state: 80, country: 120, linkedin: 90, salesNav: 110, met: 80, events: 220, custom: 200, toCc: 280, tags: 200, taggedPct: 100, lastOutreach: 160, emailCampaigns: 240,
  };
  // Column visibility — every contact column except Name (always
  // shown; it's the primary identifier). Stored per-page so the Key,
  // Active, Client, and All tabs each remember their own set. City /
  // State sit alongside Location so a user who wants the combined
  // "City, State" string keeps it, while the separate columns are
  // available for filtering / sorting on either field independently.
  const DEFAULT_VISIBLE_COLS = ['category', 'title', 'company', ...(showNewCompanyEmail ? ['newCompany', 'expectedEmail'] : []), ...(showReachedOut ? ['reachedOut'] : []), 'email', 'phone', 'location', 'city', 'state', 'country', 'linkedin', 'salesNav', 'met', 'events', ...(storagePrefix === 'all-contacts' ? ['custom', 'toCc'] : []), 'tags', ...(storagePrefix === 'all-contacts' ? ['taggedPct'] : []), 'lastOutreach', ...(storagePrefix === 'all-contacts' ? ['emailCampaigns'] : [])];
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey('visible-cols')));
      if (Array.isArray(saved) && saved.length > 0) {
        // One-time migration: surface the new Last Outreach column for
        // users whose saved visibility predates it. Migration flag is
        // sticky so we don't re-add the column if the user hides it.
        const migKey = lsKey('visible-cols-mig-lastOutreach');
        let next = saved;
        if (!localStorage.getItem(migKey) && !next.includes('lastOutreach')) {
          try { localStorage.setItem(migKey, '1'); } catch {}
          next = [...next, 'lastOutreach'];
        }
        // One-time migration for the Changed Jobs "New Company" +
        // "Expected Email" columns — inject them (right after Company) for
        // users whose saved visibility predates the feature. Sticky flag
        // so re-hiding them sticks.
        if (showNewCompanyEmail) {
          const njMigKey = lsKey('visible-cols-mig-newCompanyEmail');
          if (!localStorage.getItem(njMigKey)) {
            try { localStorage.setItem(njMigKey, '1'); } catch {}
            const add = ['newCompany', 'expectedEmail'].filter(k => !next.includes(k));
            if (add.length > 0) {
              const compIdx = next.indexOf('company');
              next = compIdx >= 0
                ? [...next.slice(0, compIdx + 1), ...add, ...next.slice(compIdx + 1)]
                : [...next, ...add];
            }
          }
        }
        // One-time migration for the Changed Jobs "Reached Out" column.
        if (showReachedOut) {
          const roMigKey = lsKey('visible-cols-mig-reachedOut');
          if (!localStorage.getItem(roMigKey)) {
            try { localStorage.setItem(roMigKey, '1'); } catch {}
            if (!next.includes('reachedOut')) {
              const eeIdx = next.indexOf('expectedEmail');
              const anchor = eeIdx >= 0 ? eeIdx : next.indexOf('company');
              next = anchor >= 0
                ? [...next.slice(0, anchor + 1), 'reachedOut', ...next.slice(anchor + 1)]
                : [...next, 'reachedOut'];
            }
          }
        }
        // Same one-time migration for the All Contacts "custom" column —
        // existing users have a saved set that predates it, so inject it
        // once (just before tags, to match DEFAULT_VISIBLE_COLS order).
        if (storagePrefix === 'all-contacts') {
          const customMigKey = lsKey('visible-cols-mig-custom');
          if (!localStorage.getItem(customMigKey) && !next.includes('custom')) {
            try { localStorage.setItem(customMigKey, '1'); } catch {}
            const tagsIdx = next.indexOf('tags');
            next = tagsIdx >= 0
              ? [...next.slice(0, tagsIdx), 'custom', ...next.slice(tagsIdx)]
              : [...next, 'custom'];
          }
          // One-time migration for the new All Contacts "Email Campaigns"
          // column — append it (after Last Outreach) for users whose saved
          // visibility predates it. Sticky flag so re-hiding it sticks.
          const campMigKey = lsKey('visible-cols-mig-emailCampaigns');
          if (!localStorage.getItem(campMigKey) && !next.includes('emailCampaigns')) {
            try { localStorage.setItem(campMigKey, '1'); } catch {}
            next = [...next, 'emailCampaigns'];
          }
          // Same for the "Tagged %" column — surfaced once, after Tags, for
          // users whose saved visibility predates it. Sticky flag so hiding
          // it again sticks.
          const taggedMigKey = lsKey('visible-cols-mig-taggedPct');
          if (!localStorage.getItem(taggedMigKey) && !next.includes('taggedPct')) {
            try { localStorage.setItem(taggedMigKey, '1'); } catch { /* private mode — column just re-offers next load */ }
            const tIdx = next.indexOf('tags');
            next = tIdx >= 0
              ? [...next.slice(0, tIdx + 1), 'taggedPct', ...next.slice(tIdx + 1)]
              : [...next, 'taggedPct'];
          }
        }
        return next;
      }
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
  // Per-column value filters (Excel-style checklist). Each entry maps a
  // column key → array of selected display values; a row passes when its
  // value for that column is one of them. Absent / empty = column not
  // filtered. Replaces the old free-text per-column filter.
  const [contactColValueFilters, setContactColValueFilters] = useState(() => {
    try { return JSON.parse(localStorage.getItem(lsKey('contact-col-value-filters'))) || {}; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem(lsKey('contact-col-value-filters'), JSON.stringify(contactColValueFilters)); } catch {} }, [contactColValueFilters]);
  // Which column's filter dropdown is currently open, plus the working
  // (uncommitted) set of checked values and the in-dropdown search text.
  const [openFilterCol, setOpenFilterCol] = useState(null);
  const [filterDraft, setFilterDraft] = useState(null); // Set | null (null = seed from current selection)
  const [filterSearch, setFilterSearch] = useState('');
  const filterMenuRef = useRef(null);
  useEffect(() => {
    if (!openFilterCol) return;
    const onDown = (e) => { if (!filterMenuRef.current?.contains(e.target)) { setOpenFilterCol(null); setFilterDraft(null); setFilterSearch(''); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openFilterCol]);
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

  // Keep an open popup pointed at the live contact. It opens on the row's
  // cached HubSpot record, and the cache replaces those records wholesale
  // on every refresh — a mass edit run over the selection, a tag write,
  // a sync. Without this the popup goes on showing the copy it opened
  // with while the table behind it shows the new one, which is how its
  // Tagged % and the table's come to disagree.
  useEffect(() => {
    setEditingContact(prev => {
      if (!prev) return prev;
      const id = String(prev.id || prev.vid || '');
      if (!id) return prev;
      const fresh = (hubspotCache?.contacts || []).find(c => String(c.id || c.vid || '') === id);
      return (fresh && fresh !== prev) ? fresh : prev;
    });
  }, [hubspotCache]);

  // The option list for the bulk tag editor: every distinct Dan's Tags
  // value in the cache, plus the app's own tag vocabulary.
  //
  // It used to be the cache alone, on the reasoning that HubSpot rejects
  // values outside the property's allowed options — but that left a tag
  // nobody carries YET unpickable, which is exactly the state a newly
  // added tag (NAM Only) starts in. The only way to reach one was to type
  // it into the search box, where a slip of the shift key writes "Nam
  // only" as its own option. The contact popup has always offered the
  // full vocabulary; this brings the bulk editor in line. A tag HubSpot
  // hasn't registered is self-healed on write — api/hubspot.js adds the
  // option to the property and retries (ensureDansTagsOptions).
  //
  // Keyed on the tag with case and spacing collapsed, so "NAM Only" and a
  // stray "Nam only" — or "Efficiency / Renewables" and the no-space form
  // HubSpot stores — are one entry, not two. The cache goes in first, so
  // a tag already in HubSpot keeps the spelling HubSpot has and only a
  // genuinely new tag shows the app's.
  const dansTagOptions = useMemo(() => {
    const seen = new Map(); // collapsed key → spelling to show
    const add = (raw) => {
      const t = String(raw || '').trim();
      if (!t) return;
      const k = tagKey(t);
      if (!seen.has(k)) seen.set(k, t);
    };
    for (const c of (hubspotCache?.contacts || [])) {
      const v = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
      if (!v) continue;
      for (const part of String(v).split(';')) add(part);
    }
    for (const t of TAG_OPTIONS) add(t);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [hubspotCache]);

  // Activity cache (emails / calls / meetings) populated by the
  // Tag review completeness per contact, for the Tagged % column. Same
  // helper the contact popup's header runs on, so the number in the table
  // and the number in the popup are the same number.
  const tagReviewMap = useMemo(() => settings?.contactTagReview || {}, [settings?.contactTagReview]);
  const tagScoreFor = useCallback(
    (c) => tagReviewScore(c.raw || c, tagReviewMap[String(c.id || c.vid || '')]),
    [tagReviewMap],
  );

  // Activity tab — used to drive the "Last Outreach" column. Read on
  // mount and refreshed on the custom event from ActivityView's
  // saveCache plus the cross-tab `storage` event.
  const [activityCache, setActivityCache] = useState(() => {
    try { return JSON.parse(userLsGet('hubspot-activity-cache')); } catch { return null; }
  });
  // Compact email/phone → {tsMs, ts, type} index written by the Activity
  // tab. Preferred source for the column: the full activityCache above is
  // often missing because the raw feed exceeds the localStorage quota and
  // its write is silently dropped, whereas this index always fits.
  const [outreachIndex, setOutreachIndex] = useState(() => {
    try { return JSON.parse(userLsGet('hubspot-outreach-index')); } catch { return null; }
  });
  useEffect(() => {
    const reload = () => {
      try { setActivityCache(JSON.parse(userLsGet('hubspot-activity-cache'))); } catch { setActivityCache(null); }
      try { setOutreachIndex(JSON.parse(userLsGet('hubspot-outreach-index'))); } catch { setOutreachIndex(null); }
    };
    const onStorage = (e) => {
      if (e.key && (e.key.endsWith(':hubspot-activity-cache') || e.key.endsWith(':hubspot-outreach-index'))) reload();
    };
    window.addEventListener('hubspot-activity-cache-updated', reload);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('hubspot-activity-cache-updated', reload);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Saved email campaigns (created on the Email Campaigns subtab of the
  // Draft Emails page and persisted to Firestore at emailCampaigns/{uid}).
  // Drives the All Contacts "Email Campaigns" column, surfacing the most
  // recent campaign a contact was a recipient of. Only the All Contacts
  // page renders that column, so we skip the Firestore read elsewhere.
  const [savedCampaigns, setSavedCampaigns] = useState([]);
  useEffect(() => {
    if (storagePrefix !== 'all-contacts' || !user?.uid) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'emailCampaigns', user.uid));
        if (!cancelled) setSavedCampaigns(snap.exists() ? (snap.data().campaigns || []) : []);
      } catch { if (!cancelled) setSavedCampaigns([]); }
    })();
    return () => { cancelled = true; };
  }, [user, storagePrefix]);

  // Campaign membership filter (All Contacts only): pick a saved email
  // campaign to see which contacts are already in it vs. still missing.
  // campaignFilterId '' = no campaign picked; mode is 'all' | 'in' | 'out'.
  const [campaignFilterId, setCampaignFilterId] = useState('');
  const [campaignFilterMode, setCampaignFilterMode] = useState('all');

  // contactId → latest call/email activity. The HubSpot API only
  // attaches associated contact IDs to meetings, so we match emails
  // by to/from address and calls by normalized phone number (last 10
  // digits, US-style). Meetings are excluded by design — the user
  // asked specifically for calls + emails.
  const contactLastOutreach = useMemo(() => {
    const map = new Map();
    const contacts = hubspotCache?.contacts || [];
    if (contacts.length === 0) return map;

    const normalizePhone = (p) => {
      const digits = String(p || '').replace(/\D/g, '');
      return digits.length >= 10 ? digits.slice(-10) : digits;
    };

    const consider = (id, ts, type) => {
      if (!id || !ts) return;
      const tsMs = new Date(ts).getTime();
      if (!Number.isFinite(tsMs)) return;
      const prev = map.get(id);
      if (!prev || tsMs > prev.tsMs) map.set(id, { tsMs, ts, type });
    };

    // Preferred path: the compact email/phone index. Look up each
    // contact's address/number directly — it's keyed the same way the
    // contacts are matched, just pre-computed and small enough to persist.
    if (outreachIndex) {
      for (const c of contacts) {
        const id = String(c.id || '');
        if (!id) continue;
        if (c.email) {
          const hit = outreachIndex.emails?.[String(c.email).toLowerCase().trim()];
          if (hit) consider(id, hit.ts, hit.type);
        }
        if (c.phone) {
          const ph = normalizePhone(c.phone);
          if (ph.length >= 10) {
            const hit = outreachIndex.phones?.[ph];
            if (hit) consider(id, hit.ts, hit.type);
          }
        }
      }
    }

    // Fallback / merge: when the full feed is still cached (older sessions,
    // or quota allowed it), fold it in too so nothing is lost — newest
    // wins via `consider`.
    if (activityCache) {
      const emailToIds = new Map();
      const phoneToIds = new Map();
      for (const c of contacts) {
        const id = String(c.id || '');
        if (!id) continue;
        if (c.email) {
          const k = String(c.email).toLowerCase().trim();
          if (k) {
            if (!emailToIds.has(k)) emailToIds.set(k, []);
            emailToIds.get(k).push(id);
          }
        }
        if (c.phone) {
          const k = normalizePhone(c.phone);
          if (k.length >= 10) {
            if (!phoneToIds.has(k)) phoneToIds.set(k, []);
            phoneToIds.get(k).push(id);
          }
        }
      }

      for (const e of (activityCache.emails || [])) {
        const subj = String(e.hs_email_subject || '').toLowerCase();
        if (subj.includes('(sample email)')) continue;
        const idSet = new Set();
        for (const field of ['hs_email_to_email', 'hs_email_from_email']) {
          const raw = e[field];
          if (!raw) continue;
          for (const part of String(raw).split(/[;,]/)) {
            const em = part.trim().toLowerCase();
            if (!em) continue;
            const ids = emailToIds.get(em);
            if (ids) for (const id of ids) idSet.add(id);
          }
        }
        for (const id of idSet) consider(id, e.hs_timestamp, 'email');
      }
      for (const c of (activityCache.calls || [])) {
        const idSet = new Set();
        for (const field of ['hs_call_to_number', 'hs_call_from_number']) {
          const ph = normalizePhone(c[field]);
          if (ph.length < 10) continue;
          const ids = phoneToIds.get(ph);
          if (ids) for (const id of ids) idSet.add(id);
        }
        for (const id of idSet) consider(id, c.hs_timestamp, 'call');
      }
    }

    return map;
  }, [activityCache, outreachIndex, hubspotCache]);

  // Whole days between the most recent outreach and now. Floored, so an
  // outreach earlier today reads as 0.
  const daysSinceOutreach = (entry) => {
    const ms = entry?.tsMs ?? (entry?.ts ? new Date(entry.ts).getTime() : NaN);
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
  };

  const fmtLastOutreach = (entry) => {
    const days = daysSinceOutreach(entry);
    if (days == null) return '';
    return days === 1 ? '1 day' : `${days} days`;
  };

  // Map each recipient email → the most recent campaign send they were
  // part of. Saved-campaign contacts store their recipients as a single
  // '; '-joined string (group sends), so split them back out and key by
  // individual lowercased email, keeping the newest sentDate per email.
  const contactCampaign = useMemo(() => {
    const map = new Map();
    for (const camp of (savedCampaigns || [])) {
      const subject = String(camp.subject || '').trim();
      for (const ct of (camp.contacts || [])) {
        const t = ct.sentDate ? new Date(ct.sentDate).getTime() : NaN;
        const tsMs = Number.isFinite(t) ? t : 0;
        for (const part of String(ct.email || '').split(/[;,]/)) {
          const em = part.trim().toLowerCase();
          if (!em) continue;
          const prev = map.get(em);
          if (!prev || tsMs > prev.tsMs) {
            map.set(em, { subject, tsMs, ts: ct.sentDate || '', replied: !!ct.replied });
          }
        }
      }
    }
    return map;
  }, [savedCampaigns]);
  const campaignForContact = (c) => contactCampaign.get(String(c?.email || '').toLowerCase().trim());

  // One option per saved campaign, each carrying the full set of its
  // recipient emails (lowercased). Unlike contactCampaign (which keeps
  // only the newest campaign per email) this lets us answer "is this
  // contact in THIS campaign?" for any campaign, which the membership
  // filter needs. Keyed by index so two campaigns with the same subject
  // stay distinct.
  const campaignRecipientOptions = useMemo(() => {
    return (savedCampaigns || []).map((camp, idx) => {
      const recipients = new Set();
      for (const ct of (camp.contacts || [])) {
        for (const part of String(ct.email || '').split(/[;,]/)) {
          const em = part.trim().toLowerCase();
          if (em) recipients.add(em);
        }
      }
      const dateLabel = camp.savedAt
        ? new Date(camp.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      return {
        id: String(idx),
        subject: String(camp.subject || '(untitled campaign)'),
        dateLabel,
        count: recipients.size,
        recipients,
      };
    });
  }, [savedCampaigns]);
  const selectedCampaign = campaignFilterId
    ? (campaignRecipientOptions.find(o => o.id === campaignFilterId) || null)
    : null;
  // If the picked campaign disappears (e.g. the Firestore doc reloads),
  // drop the filter so the table doesn't silently keep an invisible gate.
  useEffect(() => {
    if (campaignFilterId && !campaignRecipientOptions.some(o => o.id === campaignFilterId)) {
      setCampaignFilterId('');
      setCampaignFilterMode('all');
    }
  }, [campaignRecipientOptions, campaignFilterId]);

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

  // Learned email-format index (domain → address pattern), built from the
  // Table View prospects and every HubSpot contact. Powers the Changed
  // Jobs tab's Expected Email column. Only computed when that column is on.
  const emailFormatIndex = useMemo(
    () => showNewCompanyEmail ? buildEmailFormatIndex(prospects, hubspotCache?.contacts || []) : null,
    [showNewCompanyEmail, prospects, hubspotCache]
  );
  // Autocomplete for the New Company column: companies we can actually
  // predict an email for come first (so picking one yields an address),
  // followed by every Table View company. De-duped, case-insensitive.
  const newCompanySuggestions = useMemo(() => {
    if (!showNewCompanyEmail) return [];
    const out = [];
    const seen = new Set();
    const add = (name) => {
      const v = String(name || '').trim();
      if (!v) return;
      const lc = v.toLowerCase();
      if (seen.has(lc)) return;
      seen.add(lc);
      out.push(v);
    };
    for (const n of (emailFormatIndex?.companiesWithFormat || [])) add(n);
    for (const p of prospects) add(p.company);
    return out;
  }, [showNewCompanyEmail, emailFormatIndex, prospects]);

  // "Met In Person" is now a local checkbox (settings.contactMetInPerson),
  // not a HubSpot tag. Prefer the saved local value; fall back to the legacy
  // HubSpot tag for contacts that haven't been touched yet, so existing
  // tagged contacts keep counting until they're explicitly set.
  // Contacts whose non-standard State the user has accepted. Some states
  // genuinely aren't in the standard list — foreign regions, a deliberate
  // shorthand — and a warning that can't be dismissed just trains you to
  // stop reading the amber. Keyed by contact id in Firestore settings, so
  // an ignore made here holds on every device and on every page that
  // renders this table.
  // Memoized: the `|| {}` fallback would hand a fresh object to the
  // callbacks below on every render, re-deriving every row's flag with it.
  const stateWarningIgnored = useMemo(() => settings?.contactStateWarningIgnored || {}, [settings?.contactStateWarningIgnored]);
  const isStateWarningIgnored = useCallback((c) => {
    const id = String(c?.id || c?.vid || '');
    return !!(id && stateWarningIgnored[id]);
  }, [stateWarningIgnored]);
  const toggleStateWarningIgnored = useCallback((c, on) => {
    const id = String(c?.id || c?.vid || '');
    if (!id) return;
    const next = { ...stateWarningIgnored };
    if (on) next[id] = true; else delete next[id];
    updateSettings({ contactStateWarningIgnored: next });
  }, [stateWarningIgnored, updateSettings]);
  // The State check as the page should act on it: an ignored contact has no
  // flag at all, so it drops out of the cleanup count and the "needs
  // cleanup" filter as well as losing the amber cell. One definition, so
  // the badge can't claim work the table won't show.
  const stateFlagOf = useCallback(
    (c) => (isStateWarningIgnored(c) ? null : checkState(c?.state)),
    [isStateWarningIgnored],
  );

  const metInPersonMap = settings?.contactMetInPerson || {};
  const resolveMetInPerson = useCallback((c) => {
    const id = String(c?.id || c?.vid || '');
    if (id && Object.prototype.hasOwnProperty.call(metInPersonMap, id)) return !!metInPersonMap[id];
    return metInPersonSelector(c);
  }, [metInPersonMap, metInPersonSelector]);

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
      // The new employer the user mapped this changed-jobs contact to,
      // stored locally (never pushed to HubSpot so it doesn't move the
      // contact off the tab), plus the address we predict from it.
      const newCompany = String(local?._newCompany || '').trim();
      const expectedEmail = emailFormatIndex
        ? predictEmailForContact({ firstname: c.firstname, lastname: c.lastname, company: newCompany }, emailFormatIndex)
        : null;
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
        metInPerson: resolveMetInPerson(c),
        company,
        domain,
        suggestedCompany: companyGuessIndex ? guessCompanyForContact(c, companyGuessIndex) : '',
        newCompany,
        expectedEmail,
        reachedOut: !!local?._reachedOut,
        reachedOutAt: local?._reachedOutAt || '',
        raw: c,
      });
    }
    return out;
  }, [hubspotCache, FREE_MAIL, contactSelector, resolveMetInPerson, activeOppCompanies, unmappedOnly, prospects, companyGuessIndex, emailFormatIndex, settings?.contactLocalFields]);

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
        metInPerson: resolveMetInPerson(c),
        city: String(c.city || '').trim(),
      });
    }
    return out;
  }, [hubspotCache, FREE_MAIL, resolveMetInPerson]);

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

  // Distinct states / cities across the loaded contacts, powering the
  // Travel mode dropdowns. Cities narrow to the selected state when one
  // is chosen so the city list stays relevant.
  const travelStateOptions = useMemo(() => {
    const set = new Set();
    for (const c of flatContacts) { const s = String(c.state || '').trim(); if (s) set.add(s); }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [flatContacts]);
  const travelCityOptions = useMemo(() => {
    const set = new Set();
    const stateLc = travelState.trim().toLowerCase();
    for (const c of flatContacts) {
      if (stateLc && String(c.state || '').trim().toLowerCase() !== stateLc) continue;
      const city = String(c.city || '').trim();
      if (city) set.add(city);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [flatContacts, travelState]);

  // How many loaded contacts have a non-standard City or State — drives
  // the "needs cleanup" filter badge.
  const locationFlaggedCount = useMemo(
    () => flatContacts.reduce((n, c) => (checkCity(c.city) || stateFlagOf(c) ? n + 1 : n), 0),
    [flatContacts, stateFlagOf]
  );

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
        case 'newCompany': cmp = (a.newCompany || '').localeCompare(b.newCompany || ''); break;
        case 'reachedOut': cmp = Number(!!a.reachedOut) - Number(!!b.reachedOut); break;
        case 'email':   cmp = (a.email || '').localeCompare(b.email || ''); break;
        case 'location':
          cmp = ((a.state || '') + (a.city || '')).localeCompare((b.state || '') + (b.city || ''));
          break;
        case 'city':    cmp = (a.city || '').localeCompare(b.city || ''); break;
        case 'state':   cmp = (a.state || '').localeCompare(b.state || ''); break;
        case 'country': cmp = (a.country || '').localeCompare(b.country || ''); break;
        case 'events':  cmp = (contactEvents[String(a.id || '')] || '').localeCompare(contactEvents[String(b.id || '')] || ''); break;
        case 'met':     cmp = Number(!!a.metInPerson) - Number(!!b.metInPerson); break;
        case 'taggedPct': cmp = tagScoreFor(a).pct - tagScoreFor(b).pct; break;
        case 'lastOutreach': {
          const av = contactLastOutreach.get(String(a.id || ''))?.tsMs || 0;
          const bv = contactLastOutreach.get(String(b.id || ''))?.tsMs || 0;
          cmp = av - bv;
          break;
        }
        case 'category': {
          const av = (categorizeContact ? (categorizeContact(a.raw || a) || []) : []).join(' ');
          const bv = (categorizeContact ? (categorizeContact(b.raw || b) || []) : []).join(' ');
          cmp = av.localeCompare(bv);
          break;
        }
        case 'emailCampaigns': {
          const av = contactCampaign.get(String(a.email || '').toLowerCase().trim())?.tsMs || 0;
          const bv = contactCampaign.get(String(b.email || '').toLowerCase().trim())?.tsMs || 0;
          cmp = av - bv;
          break;
        }
        default: cmp = 0;
      }
      if (contactSortDir === 'desc') cmp = -cmp;
      if (cmp === 0) cmp = (a.name || '').localeCompare(b.name || '');
      return cmp;
    });
    return arr;
  }, [flatContacts, contactSortKey, contactSortDir, contactLastOutreach, contactEvents, categorizeContact, contactCampaign, tagScoreFor]);

  // Combined "To Also" + "CC" recipients edited in the contact popup,
  // keyed by lowercased primary email so the All Contacts "To / CC"
  // column can surface every linked recipient at a glance. `toAlsoMap`
  // feeds the To line, `ccMap` the CC line — both live on settings and
  // are keyed by the contact's primary email.
  const toCcByEmail = useMemo(() => {
    const map = new Map();
    const add = (src, kind) => {
      for (const [email, list] of Object.entries(src || {})) {
        if (!Array.isArray(list) || list.length === 0) continue;
        const k = String(email).toLowerCase().trim();
        if (!k) continue;
        const entry = map.get(k) || { to: [], cc: [] };
        for (const addr of list) {
          const a = String(addr).trim();
          if (a && !entry[kind].includes(a)) entry[kind].push(a);
        }
        map.set(k, entry);
      }
    };
    add(settings?.toAlsoMap, 'to');
    add(settings?.ccMap, 'cc');
    return map;
  }, [settings?.toAlsoMap, settings?.ccMap]);
  const toCcEntryFor = useCallback(
    (c) => {
      const e = String(c?.email || '').toLowerCase().trim();
      return (e && toCcByEmail.get(e)) || null;
    },
    [toCcByEmail]
  );

  // Friendly display name for any email that belongs to a loaded contact —
  // lets the "also a To / CC for …" note name the owning contact instead of
  // showing a bare address.
  const contactNameByEmail = useMemo(() => {
    const m = new Map();
    for (const c of flatContacts) {
      const e = String(c?.email || '').toLowerCase().trim();
      if (e && !m.has(e)) m.set(e, c.name || e);
    }
    return m;
  }, [flatContacts]);

  // Reverse of toCcByEmail: for each recipient address, which *other* contacts
  // list it on their To Also / CC lines. Keyed by lowercased recipient email
  // so the All Contacts "To / CC" column can flag a contact that is itself a
  // recipient on someone else's outreach. `owner` is the contact whose popup
  // added the recipient (their primary email).
  const referencedAsRecipient = useMemo(() => {
    const map = new Map();
    const add = (src, kind) => {
      for (const [owner, list] of Object.entries(src || {})) {
        if (!Array.isArray(list) || list.length === 0) continue;
        const ownerK = String(owner).toLowerCase().trim();
        if (!ownerK) continue;
        for (const addr of list) {
          const a = String(addr).toLowerCase().trim();
          if (!a) continue;
          const entry = map.get(a) || { to: new Set(), cc: new Set() };
          entry[kind].add(ownerK);
          map.set(a, entry);
        }
      }
    };
    add(settings?.toAlsoMap, 'to');
    add(settings?.ccMap, 'cc');
    return map;
  }, [settings?.toAlsoMap, settings?.ccMap]);
  // The other contacts that reference contact `c` as a To / CC recipient,
  // excluding `c` itself. Returns { to: string[], cc: string[] } of owner
  // emails, or null when nobody references this contact.
  const inboundRefsFor = useCallback(
    (c) => {
      const e = String(c?.email || '').toLowerCase().trim();
      if (!e) return null;
      const entry = referencedAsRecipient.get(e);
      if (!entry) return null;
      const to = [...entry.to].filter(o => o !== e);
      const cc = [...entry.cc].filter(o => o !== e);
      return (to.length || cc.length) ? { to, cc } : null;
    },
    [referencedAsRecipient]
  );

  const contactFieldGetters = {
    name:     c => c.name || '',
    category: c => (categorizeContact ? (categorizeContact(c.raw || c) || []) : []).join(' '),
    title:    c => c.jobtitle || '',
    company:  c => c.companyName || '',
    suggestedCompany: c => c.suggestedCompany || '',
    newCompany: c => c.newCompany || '',
    reachedOut: c => c.reachedOut ? 'Reached out' : 'Not yet',
    expectedEmail: c => (c.expectedEmail?.status === 'ok' ? c.expectedEmail.email : ''),
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
    taggedPct: c => `${tagScoreFor(c).pct}%`,
    lastOutreach: c => fmtLastOutreach(contactLastOutreach.get(String(c.id || ''))),
    emailCampaigns: c => campaignForContact(c)?.subject || '',
    toCc:     c => {
      const entry = toCcEntryFor(c);
      if (!entry) return '';
      return [...entry.to, ...entry.cc].join(', ');
    },
  };
  const activeValueFilters = Object.entries(contactColValueFilters)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k, v]) => [k, new Set(v)]);
  // Page-level gates (category pills, travel, location flag, search box)
  // that every column's filter dropdown should respect when listing the
  // values available to pick from.
  const passesNonColumnFilters = (c, opts) => {
    if (categoryFilter && categorizeContact) {
      const cats = categorizeContact(c.raw || c) || [];
      if (!cats.includes(categoryFilter)) return false;
    }
    if (isTravel) {
      if (travelState && String(c.state || '').trim().toLowerCase() !== travelState.trim().toLowerCase()) return false;
      if (travelCity && String(c.city || '').trim().toLowerCase() !== travelCity.trim().toLowerCase()) return false;
    }
    if (onlyLocationFlagged && !checkCity(c.city) && !stateFlagOf(c)) return false;
    // Campaign membership gate — 'in' keeps contacts already emailed in
    // the picked campaign, 'out' keeps everyone else. skipCampaign lets
    // the In/Not-in counts measure against the pre-gate roster.
    if (!opts?.skipCampaign && selectedCampaign && campaignFilterMode !== 'all') {
      const em = String(c.email || '').toLowerCase().trim();
      const inCampaign = !!em && selectedCampaign.recipients.has(em);
      if (campaignFilterMode === 'in' && !inCampaign) return false;
      if (campaignFilterMode === 'out' && inCampaign) return false;
    }
    if (q) {
      const blob = (c.name || '') + ' ' + (c.companyName || '') + ' '
        + (c.email || '') + ' ' + (c.jobtitle || '');
      if (!blob.toLowerCase().includes(q)) return false;
    }
    return true;
  };
  // Column value filters, optionally skipping one column (so a dropdown
  // can show the values that would be available ignoring its own filter).
  const passesColumnFilters = (c, exceptKey) => {
    for (const [key, vals] of activeValueFilters) {
      if (key === exceptKey) continue;
      const getter = contactFieldGetters[key];
      if (!getter) continue;
      if (!vals.has(String(getter(c)))) return false;
    }
    return true;
  };
  // Distinct values available for a column, honoring all other filters —
  // this is the checklist the dropdown shows and what "Select All" ticks.
  const columnFilterValues = (key) => {
    const getter = contactFieldGetters[key];
    if (!getter) return [];
    const set = new Set();
    for (const c of sortedContacts) {
      if (!passesNonColumnFilters(c)) continue;
      if (!passesColumnFilters(c, key)) continue;
      set.add(String(getter(c)));
    }
    return Array.from(set).sort((a, b) => {
      if (a === '' && b !== '') return 1;
      if (b === '' && a !== '') return -1;
      return a.localeCompare(b);
    });
  };
  const filteredContacts = sortedContacts.filter(c => passesNonColumnFilters(c) && passesColumnFilters(c, null));

  // In / Not-in tallies for the campaign membership pills, measured over
  // the roster the OTHER filters (category, search, columns) leave — so
  // the numbers reflect "within what I'm looking at, X are already in the
  // campaign and Y still aren't."
  const campaignCounts = selectedCampaign ? (() => {
    let inC = 0, outC = 0;
    for (const c of sortedContacts) {
      if (!passesNonColumnFilters(c, { skipCampaign: true })) continue;
      if (!passesColumnFilters(c, null)) continue;
      const em = String(c.email || '').toLowerCase().trim();
      if (em && selectedCampaign.recipients.has(em)) inC += 1; else outC += 1;
    }
    return { inC, outC, total: inC + outC };
  })() : null;

  // Geography rollup for the By Location view — contacts grouped by State,
  // then City within each state. Built from filteredContacts so the search
  // box and the Key / Active / Client category pills narrow it the same way
  // they narrow the table. States and cities are ordered by count (desc),
  // then alphabetically; blanks collapse into a "(no value)" bucket.
  const NO_LOCATION = '(no value)';
  const geoSummary = useMemo(() => {
    const byState = new Map();
    for (const c of filteredContacts) {
      const state = String(c.state || '').trim() || NO_LOCATION;
      const city = String(c.city || '').trim() || NO_LOCATION;
      let entry = byState.get(state);
      if (!entry) { entry = { state, total: 0, cities: new Map() }; byState.set(state, entry); }
      entry.total += 1;
      entry.cities.set(city, (entry.cities.get(city) || 0) + 1);
    }
    const states = [...byState.values()].map(s => ({
      state: s.state,
      total: s.total,
      cities: [...s.cities.entries()]
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city)),
    }));
    states.sort((a, b) => b.total - a.total || a.state.localeCompare(b.state));
    return states;
  }, [filteredContacts]);
  const geoTotals = useMemo(() => ({
    contacts: geoSummary.reduce((n, s) => n + s.total, 0),
    states: geoSummary.length,
  }), [geoSummary]);

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
              ...(travelEnabled ? [{ key: 'travel', label: 'Travel' }] : []),
              ...(travelEnabled ? [{ key: 'geography', label: 'By Location' }] : []),
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
            title={categorizeContact
              ? 'Download a formatted Excel workbook of every contact on this page. Each row has a Categories column (Key / Active / Client / Key Prospect). The export covers the full page set: on-screen filters and search are NOT applied.'
              : 'Download a single workbook combining contacts from Key Contacts, Active Contacts, and Client Contacts. Each row has a Categories column listing every tab the contact qualifies for. Filters and search on this page are NOT applied: the export covers the full tag/CDM-derived sets.'}
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
          >{categorizeContact ? 'Download All (Excel)' : 'Download Combined (Key + Active + Client)'}</button>
          {isContactList && (
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
                    ...(categorizeContact ? [{ key: 'category', label: 'Category' }] : []),
                    { key: 'title', label: 'Title' },
                    { key: 'company', label: 'Company' },
                    ...(showSuggestedCompany ? [{ key: 'suggestedCompany', label: 'Suggested Company' }] : []),
                    ...(showNewCompanyEmail ? [{ key: 'newCompany', label: 'New Company' }, { key: 'expectedEmail', label: 'Expected Email' }] : []),
                    ...(showReachedOut ? [{ key: 'reachedOut', label: 'Reached Out' }] : []),
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
                    ...(storagePrefix === 'all-contacts' ? [{ key: 'toCc', label: 'To / CC' }] : []),
                    { key: 'lastOutreach', label: 'Last Outreach' },
                    ...(storagePrefix === 'all-contacts' ? [{ key: 'emailCampaigns', label: 'Email Campaigns' }] : []),
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
          {isContactList && (
            <button
              type="button"
              onClick={() => {
                // The selection deliberately survives the toggle. Rows are
                // checkable outside Mass Edit too (the normal-mode bar
                // below queues them for a campaign), so ticking twenty
                // contacts and then opening Mass Edit is the obvious way
                // in — and clearing them there threw away the work that
                // was the whole reason for the click. "Edit Tags" on that
                // bar has always carried its selection into mass mode;
                // this button now agrees with it. "Clear" is one click
                // away for the times a fresh selection is wanted.
                setMassMode(p => !p);
                // The pending value doesn't survive: it belongs to the
                // edit that was being composed, and a stale one left in
                // the box is a value that can be applied by accident.
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

      {isContactList && massMode && (
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
              <option value="dans_tags">Tags</option>
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
            })() : massField === 'dans_tags' ? (() => {
              // Tags are multi-value, so instead of one text box the user
              // picks tags from the vocabulary already in HubSpot and
              // chooses whether to add, remove, or replace.
              const q = massTagQuery.trim().toLowerCase();
              const matches = q ? dansTagOptions.filter(t => t.toLowerCase().includes(q)) : dansTagOptions;
              const exact = dansTagOptions.some(t => t.toLowerCase() === q);
              const chosen = [...massTags];
              return (
                <div ref={massTagBoxRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 340px', minWidth: 280 }}>
                  <select
                    value={massTagMode}
                    onChange={e => setMassTagMode(e.target.value)}
                    title={'Add keeps existing tags · Remove strips only the chosen tags · Replace overwrites the whole tag list'
                      + '\n\nThe Mark options record the same answers as the contact popup, across every selected contact:'
                      + '\nYes — the area is theirs · No — doesn\'t apply to them · Not sure — haven\'t worked it out'
                      + '\nSold — their company has bought it · Not sold — theirs, but their company hasn\'t bought it'
                      + '\n\nYes and Sold put the tag on, so they come back in a general pull; No, Not sure and Not sold take it off.'
                      + '\nA Yes marked over an existing Not sold records the Yes and leaves the tag off — that hold-off is the point.'}
                    style={{ padding: '0.25rem 0.4rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit', background: '#fff' }}
                  >
                    <optgroup label="Tag in HubSpot">
                      <option value="add">Add</option>
                      <option value="remove">Remove</option>
                      <option value="replace">Replace all</option>
                    </optgroup>
                    <optgroup label="Record an answer">
                      {MASS_TAG_VERDICTS.map(v => (
                        <option key={v.mode} value={v.mode}>{v.label}</option>
                      ))}
                    </optgroup>
                  </select>
                  <button
                    type="button"
                    onClick={() => setMassTagOpen(o => !o)}
                    title={chosen.length > 0 ? chosen.join(', ') : 'Pick the tags to apply'}
                    style={{
                      flex: 1, minWidth: 140, textAlign: 'left',
                      padding: '0.25rem 0.5rem', fontSize: '0.72rem',
                      border: '1px solid #CBD5E1', borderRadius: 4,
                      background: '#fff', color: chosen.length > 0 ? '#1E293B' : '#94A3B8',
                      cursor: 'pointer', fontFamily: 'inherit',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >{chosen.length > 0 ? chosen.join(', ') : 'Choose tags…'} ▾</button>
                  {chosen.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setMassTags(new Set())}
                      title="Clear the chosen tags"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.68rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                    >Clear tags</button>
                  )}
                  {massTagOpen && (
                    <div style={{
                      position: 'absolute',
                      top: '100%', left: 0, right: 0,
                      marginTop: 2,
                      zIndex: 30,
                      maxHeight: 260,
                      overflowY: 'auto',
                      background: '#fff',
                      border: '1px solid #CBD5E1',
                      borderRadius: 6,
                      boxShadow: '0 6px 16px rgba(15,23,42,0.12)',
                    }}>
                      <div style={{ padding: 6, borderBottom: '1px solid #F1F5F9', position: 'sticky', top: 0, background: '#fff' }}>
                        <input
                          type="text"
                          value={massTagQuery}
                          autoFocus
                          onChange={e => setMassTagQuery(e.target.value)}
                          placeholder="Search tags…"
                          style={{ width: '100%', padding: '0.25rem 0.5rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit' }}
                        />
                      </div>
                      {matches.map(t => (
                        <label
                          key={t}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.35rem 0.6rem', fontSize: '0.74rem', color: '#1E293B', cursor: 'pointer' }}
                        >
                          <input type="checkbox" checked={massTags.has(t)} onChange={() => toggleMassTag(t)} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
                        </label>
                      ))}
                      {matches.length === 0 && !massTagQuery.trim() && (
                        <div style={{ padding: '0.5rem 0.6rem', fontSize: '0.72rem', color: '#94A3B8' }}>No tags in the HubSpot cache yet.</div>
                      )}
                      {massTagQuery.trim() && !exact && (
                        <button
                          type="button"
                          onMouseDown={e => { e.preventDefault(); toggleMassTag(massTagQuery.trim()); setMassTagQuery(''); }}
                          title="Tag with a value that isn't in the list. It's registered on HubSpot's Dan's Tags property on the first write, so it doesn't have to be added there by hand — but it's added exactly as typed, so check the spelling."
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.4rem 0.6rem', fontSize: '0.72rem', border: 'none', borderTop: '1px solid #F1F5F9', background: '#F8FAFC', color: '#1D4ED8', cursor: 'pointer', fontFamily: 'inherit' }}
                        >Use "{massTagQuery.trim()}"</button>
                      )}
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
            {(() => {
              // "Replace all" with nothing chosen is a legitimate action
              // (clear every tag), so the Apply button only needs a
              // chosen tag for add / remove.
              const disabled = massProcessing || massSelected.size === 0 || (massField === 'dans_tags'
                ? (massTagMode !== 'replace' && massTags.size === 0)
                : !massValue.trim());
              return (
                <button
                  type="button"
                  onClick={handleMassApply}
                  disabled={disabled}
                  style={{
                    padding: '0.3rem 0.75rem',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    border: 'none',
                    borderRadius: 4,
                    background: disabled ? '#94A3B8' : '#1D4ED8',
                    color: '#fff',
                    cursor: disabled ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >{massProcessing ? 'Updating…' : 'Apply to Selected'}</button>
              );
            })()}
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
            <button
              type="button"
              onClick={queueSelectedForCampaign}
              disabled={massProcessing || massSelected.size === 0}
              title="Push the selected contacts into the Custom Email Campaign queue (Draft Emails page)"
              style={{
                padding: '0.3rem 0.75rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                border: '1px solid #2563EB',
                borderRadius: 4,
                background: (massProcessing || massSelected.size === 0) ? '#DBEAFE' : '#EFF6FF',
                color: '#1D4ED8',
                cursor: (massProcessing || massSelected.size === 0) ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >Queue for Campaign</button>
            {massStatus && (
              <span style={{ fontSize: '0.7rem', color: massStatus.type === 'success' ? '#166534' : '#92400E' }}>{massStatus.message}</span>
            )}
          </div>
        </div>
      )}

      {/* Normal-mode selection bar — lets you check contacts and queue
          them for a Custom Email Campaign without entering Mass Edit.
          Appears once at least one contact is selected. */}
      {isContactList && !massMode && massSelected.size > 0 && (
        <div style={{ padding: '0 1.25rem 0.5rem', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', padding: '0.5rem 0.75rem', background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: 6 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1E293B' }}>{massSelected.size} selected</span>
            <button
              type="button"
              onClick={queueSelectedForCampaign}
              title="Push the selected contacts into the Custom Email Campaign queue (Draft Emails page)"
              style={{
                padding: '0.3rem 0.75rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                border: '1px solid #2563EB',
                borderRadius: 4,
                background: '#EFF6FF',
                color: '#1D4ED8',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >Queue for Campaign</button>
            <button
              type="button"
              onClick={() => { setMassField('dans_tags'); setMassStatus(null); setMassMode(true); setMassTagOpen(true); }}
              title="Add, remove, or replace Dan's Tags on the selected contacts"
              style={{
                padding: '0.3rem 0.75rem',
                fontSize: '0.72rem',
                fontWeight: 700,
                border: '1px solid #7C3AED',
                borderRadius: 4,
                background: '#F5F3FF',
                color: '#6D28D9',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >Edit Tags</button>
            <button
              type="button"
              onClick={() => setMassSelected(new Set())}
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.68rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
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
          placeholder={isContactList || isGeography
            ? `Search ${flatContacts.length} contact${flatContacts.length === 1 ? '' : 's'}…`
            : `Search ${rows.length} compan${rows.length === 1 ? 'y' : 'ies'}…`}
          style={{ width: '100%', maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        {isTravel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1E293B' }}>Travel to:</span>
            <select
              value={travelState}
              onChange={e => { setTravelState(e.target.value); setTravelCity(''); }}
              style={{ padding: '0.35rem 0.5rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', borderRadius: 6, fontFamily: 'inherit', background: '#fff', color: '#334155' }}
            >
              <option value="">All states</option>
              {travelStateOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={travelCity}
              onChange={e => setTravelCity(e.target.value)}
              style={{ padding: '0.35rem 0.5rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', borderRadius: 6, fontFamily: 'inherit', background: '#fff', color: '#334155' }}
            >
              <option value="">{travelState ? `All cities in ${travelState}` : 'All cities'}</option>
              {travelCityOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {(travelState || travelCity) && (
              <button
                type="button"
                onClick={() => { setTravelState(''); setTravelCity(''); }}
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.7rem', fontWeight: 600, border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}
              >Clear</button>
            )}
            <span style={{ fontSize: '0.7rem', color: '#64748B' }}>
              {filteredContacts.length} contact{filteredContacts.length === 1 ? '' : 's'}{(travelState || travelCity) ? ' in area' : ''}
            </span>
          </div>
        )}
        {isContactList && (
          <label
            title="Show only contacts whose City or State isn't in standard format (e.g. NY → New York, or Atlanta, GA → Atlanta). Use the per-cell Fix button to standardize."
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', color: '#475569', cursor: 'pointer' }}
          >
            <input type="checkbox" checked={onlyLocationFlagged} onChange={e => setOnlyLocationFlagged(e.target.checked)} />
            <span>Needs city/state cleanup</span>
            <span style={{
              display: 'inline-block', padding: '0 6px', fontSize: '0.62rem', fontWeight: 700, borderRadius: 999,
              background: locationFlaggedCount > 0 ? '#FEF3C7' : '#F1F5F9',
              color: locationFlaggedCount > 0 ? '#92400E' : '#94A3B8',
              border: '1px solid ' + (locationFlaggedCount > 0 ? '#FDE68A' : '#E2E8F0'),
              minWidth: 18, textAlign: 'center',
            }}>{locationFlaggedCount}</span>
          </label>
        )}
        {storagePrefix === 'all-contacts' && isContactList && campaignRecipientOptions.length > 0 && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              title="Pick a saved email campaign (from Draft Emails → Email Campaigns) to see which of these contacts are already in it vs. still missing."
              style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1E293B' }}
            >Campaign:</span>
            <select
              value={campaignFilterId}
              onChange={e => { setCampaignFilterId(e.target.value); setCampaignFilterMode(e.target.value ? 'in' : 'all'); }}
              style={{ padding: '0.35rem 0.5rem', fontSize: '0.72rem', border: '1px solid #CBD5E1', borderRadius: 6, fontFamily: 'inherit', background: '#fff', color: '#334155', maxWidth: 280 }}
            >
              <option value="">(filter by campaign)</option>
              {campaignRecipientOptions.map(o => (
                <option key={o.id} value={o.id}>
                  {o.subject}{o.dateLabel ? ` (${o.dateLabel})` : ''} · {o.count} sent
                </option>
              ))}
            </select>
            {selectedCampaign && campaignCounts && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {[
                  { mode: 'all', label: `Show all ${campaignCounts.total}`, bg: '#F1F5F9', border: '#CBD5E1', color: '#334155' },
                  { mode: 'in', label: `In campaign ${campaignCounts.inC}`, bg: '#DCFCE7', border: '#86EFAC', color: '#166534' },
                  { mode: 'out', label: `Not in campaign ${campaignCounts.outC}`, bg: '#FEF3C7', border: '#FCD34D', color: '#92400E' },
                ].map(({ mode, label, bg, border, color }) => {
                  const active = campaignFilterMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setCampaignFilterMode(mode)}
                      title={mode === 'in'
                        ? 'Show only contacts already emailed in this campaign'
                        : mode === 'out'
                          ? 'Show only contacts NOT yet in this campaign: the ones left to add'
                          : 'Show all contacts (both in and not in the campaign)'}
                      style={{
                        padding: '1px 8px', borderRadius: 999,
                        background: active ? color : bg,
                        border: `1px solid ${active ? color : border}`,
                        color: active ? '#fff' : color,
                        fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                      }}
                    >{label}</button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => { setCampaignFilterId(''); setCampaignFilterMode('all'); }}
                  title="Clear the campaign filter"
                  style={{ padding: '1px 6px', borderRadius: 999, background: '#fff', border: '1px solid #CBD5E1', color: '#64748B', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
                >×</button>
              </div>
            )}
          </div>
        )}
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
        {isContactList ? (
          flatContacts.length === 0 ? (
            <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>{emptyTitle}</div>
              <div style={{ fontSize: '0.78rem' }}>{emptyDetail}</div>
            </div>
          ) : (() => {
            const ALL_CONTACT_COLS = [
              { key: 'name',     label: 'Name', alwaysOn: true },
              ...(categorizeContact ? [{ key: 'category', label: 'Category' }] : []),
              { key: 'title',    label: 'Title' },
              { key: 'company',  label: 'Company' },
              ...(showSuggestedCompany ? [{ key: 'suggestedCompany', label: 'Suggested Company' }] : []),
              ...(showNewCompanyEmail ? [{ key: 'newCompany', label: 'New Company' }, { key: 'expectedEmail', label: 'Expected Email', sortable: false }] : []),
              ...(showReachedOut ? [{ key: 'reachedOut', label: 'Reached Out' }] : []),
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
              // Custom free-text column — only on the All Contacts page.
              // Reads/writes the same per-contact `settings.customField`
              // value used by the {custom} email variable.
              ...(storagePrefix === 'all-contacts' ? [{ key: 'custom', label: 'Custom', sortable: false }] : []),
              // Combined To / CC recipients from the contact popup — All Contacts only.
              ...(storagePrefix === 'all-contacts' ? [{ key: 'toCc', label: 'To / CC', sortable: false }] : []),
              { key: 'tags',     label: 'Tags', sortable: false },
              // How much of this contact's tag review is done, from the
              // popup's Yes / No / Not sure table. All Contacts only, like
              // the other columns that report on the popup's local fields.
              ...(storagePrefix === 'all-contacts' ? [{ key: 'taggedPct', label: 'Tagged %' }] : []),
              { key: 'lastOutreach', label: 'Last Outreach' },
              ...(storagePrefix === 'all-contacts' ? [{ key: 'emailCampaigns', label: 'Email Campaigns' }] : []),
            ].filter(Boolean);
            const visibleSet = new Set(visibleCols);
            const CONTACT_COLS = ALL_CONTACT_COLS.filter(c => c.alwaysOn || visibleSet.has(c.key));
            // Single 32px checkbox column at the front, meaning the same
            // thing whether or not Mass Edit is on: these are the rows
            // picked. What can be done with them is what changes — the
            // normal-mode bar queues them for a campaign or opens the tag
            // editor, and Mass Edit adds the field-by-field update. The
            // selection itself carries across, so a set of ticks made
            // before the mode was switched is still there after it.
            const CONTACT_GRID = '32px '
              + CONTACT_COLS.map(c => `${contactColWidths[c.key] || 120}px`).join(' ')
              + ' 60px';
            const allVisibleSelected = filteredContacts.length > 0
              && filteredContacts.every(c => massSelected.has(c.id));
            const CONTACT_GLYPH = (key) => contactSortKey === key ? (contactSortDir === 'desc' ? ' ▼' : ' ▲') : '';
            const RESIZE_HANDLE = { position: 'absolute', top: 0, right: 0, bottom: 0, width: 6, cursor: 'col-resize', userSelect: 'none' };
            return (
              <div style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: CONTACT_GRID, background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', borderTopLeftRadius: 8, borderTopRightRadius: 8, position: 'sticky', top: 0, zIndex: 2 }}>
                  <div style={{ padding: '0.4rem 0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #E2E8F0' }}
                    title={allVisibleSelected ? 'Clear visible selection' : 'Select all visible contacts'}
                  >
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
                  {CONTACT_COLS.map(col => {
                    const sel = contactColValueFilters[col.key];
                    const isFiltered = Array.isArray(sel) && sel.length > 0;
                    const isOpen = openFilterCol === col.key;
                    return (
                      <div key={col.key} style={{ padding: '0.25rem 0.4rem', borderRight: '1px solid #E2E8F0', position: 'relative' }}>
                        <button
                          type="button"
                          onClick={() => {
                            if (isOpen) { setOpenFilterCol(null); setFilterDraft(null); setFilterSearch(''); return; }
                            setFilterSearch('');
                            setFilterDraft(null);
                            setOpenFilterCol(col.key);
                          }}
                          title={isFiltered ? `Filtered to ${sel.length} value${sel.length === 1 ? '' : 's'}: click to change` : 'Filter by value'}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '0.2rem 0.35rem', fontSize: '0.7rem', border: '1px solid ' + (isFiltered ? '#2563EB' : '#E2E8F0'), borderRadius: 3, fontFamily: 'inherit', background: isFiltered ? '#EFF6FF' : '#fff', color: isFiltered ? '#1D4ED8' : '#64748B', cursor: 'pointer' }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isFiltered ? `${sel.length} selected` : 'All'}</span>
                          <span style={{ flexShrink: 0 }}>▾</span>
                        </button>
                        {isOpen && (() => {
                          const available = columnFilterValues(col.key);
                          const draft = filterDraft || new Set(isFiltered ? sel : available);
                          const searchLc = filterSearch.trim().toLowerCase();
                          const shown = available.filter(v => !searchLc || (v === '' ? '(blanks)' : v.toLowerCase()).includes(searchLc));
                          const allShownChecked = shown.length > 0 && shown.every(v => draft.has(v));
                          const apply = () => {
                            const chosen = available.filter(v => draft.has(v));
                            setContactColValueFilters(prev => {
                              const next = { ...prev };
                              if (chosen.length === 0 || chosen.length === available.length) delete next[col.key];
                              else next[col.key] = chosen;
                              return next;
                            });
                            setOpenFilterCol(null); setFilterDraft(null); setFilterSearch('');
                          };
                          const clear = () => {
                            setContactColValueFilters(prev => { const n = { ...prev }; delete n[col.key]; return n; });
                            setOpenFilterCol(null); setFilterDraft(null); setFilterSearch('');
                          };
                          return (
                            <div ref={filterMenuRef} style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 40, background: '#fff', border: '1px solid #CBD5E1', borderRadius: 6, boxShadow: '0 6px 16px rgba(15,23,42,0.18)', width: 240, padding: 6 }}>
                              <input
                                autoFocus
                                type="text"
                                value={filterSearch}
                                onChange={e => setFilterSearch(e.target.value)}
                                placeholder="Search…"
                                style={{ width: '100%', padding: '0.25rem 0.4rem', fontSize: '0.72rem', border: '1px solid #E2E8F0', borderRadius: 4, fontFamily: 'inherit', marginBottom: 6, boxSizing: 'border-box' }}
                              />
                              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.2rem 0.3rem', fontSize: '0.74rem', fontWeight: 700, color: '#1E293B', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={allShownChecked}
                                    onChange={() => {
                                      const next = new Set(draft);
                                      if (allShownChecked) { for (const v of shown) next.delete(v); }
                                      else { for (const v of shown) next.add(v); }
                                      setFilterDraft(next);
                                    }}
                                  />
                                  (Select All{searchLc ? ' matching' : ''})
                                </label>
                                {shown.length === 0 && <div style={{ padding: '0.3rem', fontSize: '0.72rem', color: '#94A3B8' }}>No values</div>}
                                {shown.map(v => (
                                  <label key={v || '__blank__'} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.2rem 0.3rem', fontSize: '0.74rem', color: '#334155', cursor: 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={draft.has(v)}
                                      onChange={() => {
                                        const next = new Set(draft);
                                        if (next.has(v)) next.delete(v); else next.add(v);
                                        setFilterDraft(next);
                                      }}
                                    />
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v === '' ? '(Blanks)' : v}</span>
                                  </label>
                                ))}
                              </div>
                              <div style={{ display: 'flex', gap: 6, marginTop: 6, paddingTop: 6, borderTop: '1px solid #F1F5F9' }}>
                                <button type="button" onClick={apply} style={{ flex: 1, padding: '0.25rem', fontSize: '0.7rem', fontWeight: 700, border: '1px solid #2563EB', borderRadius: 4, background: '#2563EB', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Apply</button>
                                <button type="button" onClick={clear} style={{ flex: 1, padding: '0.25rem', fontSize: '0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                  <div />
                </div>
                {filteredContacts.length === 0 && (
                  <div style={{ padding: '1rem', textAlign: 'center', color: '#64748B', fontSize: '0.78rem', background: '#FAFAFA', borderTop: '1px solid #F1F5F9' }}>
                    No contacts match the current filters{query ? ` for "${query}"` : ''}: clear a filter or column search to see results.
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
                      background: massSelected.has(c.id) ? '#EFF6FF' : (i % 2 === 0 ? '#fff' : '#FCFCFD'),
                    }}
                  >
                    <div
                      style={{ padding: '0.45rem 0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title={massSelected.has(c.id) ? 'Deselect this contact' : 'Select this contact'}
                    >
                      <input
                        type="checkbox"
                        checked={massSelected.has(c.id)}
                        onChange={() => toggleMassSelect(c.id)}
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                    <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.8rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Click to edit ${c.name}`}>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditingContact(c.raw || c)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingContact(c.raw || c); } }}
                        style={{ color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline' }}
                      >{c.name}</span>
                    </div>
                    {categorizeContact && visibleSet.has('category') && (
                      <div style={{ padding: '0.45rem 0.6rem', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        {(() => {
                          const cats = categorizeContact(c.raw || c) || [];
                          if (cats.length === 0) return <span style={{ color: '#CBD5E1', fontSize: '0.7rem' }}>-</span>;
                          const COLORS = {
                            Key:    { bg: '#FEF3C7', border: '#FCD34D', color: '#92400E' },
                            Active: { bg: '#DCFCE7', border: '#86EFAC', color: '#166534' },
                            Client: { bg: '#DBEAFE', border: '#93C5FD', color: '#1E3A8A' },
                            'Key Prospect': { bg: '#EDE9FE', border: '#C4B5FD', color: '#5B21B6' },
                          };
                          return cats.map(cat => {
                            const k = COLORS[cat] || { bg: '#F1F5F9', border: '#CBD5E1', color: '#334155' };
                            return (
                              <span
                                key={cat}
                                style={{
                                  background: k.bg,
                                  border: `1px solid ${k.border}`,
                                  color: k.color,
                                  padding: '1px 8px',
                                  borderRadius: 999,
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  whiteSpace: 'nowrap',
                                }}
                              >{cat}</span>
                            );
                          });
                        })()}
                      </div>
                    )}
                    {visibleSet.has('title') && (
                    <InlineCell
                      value={c.jobtitle}
                      onCommit={v => inlineUpdateField(c.raw || c, 'jobtitle', v)}
                      textColor="#475569"
                      title={c.jobtitle ? `Click to edit: ${c.jobtitle}` : 'Click to edit'}
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
                      title={c.companyName && !c.prospect ? `"${c.companyName}" is not mapped to any prospect in the Table View: no matching company name and no shared email domain.` : undefined}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {linkCompanyToProspect && c.prospect ? (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={e => { e.stopPropagation(); onSelectProspect?.(c.prospect); }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onSelectProspect?.(c.prospect); } }}
                            title={`Open ${c.companyName} prospect record`}
                            style={{ display: 'block', padding: '0.3rem 0.5rem', fontSize: '0.74rem', fontWeight: 600, color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#93C5FD', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >{c.companyName}</span>
                        ) : (
                          <InlineCell
                            value={c.companyName}
                            onCommit={v => inlineUpdateField(c.raw || c, 'company', v)}
                            fontSize="0.74rem"
                            textColor="#1E293B"
                            fontWeight={600}
                            suggestions={prospects.map(p => p.company).filter(Boolean)}
                            title={c.prospect ? `Click to edit. Use the ↗ button to open ${c.companyName}.` : 'Not mapped to any Table View prospect. Click to edit (autocomplete from Table View companies).'}
                          />
                        )}
                      </div>
                      {c.prospect ? (
                        linkCompanyToProspect ? null : (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={e => { e.stopPropagation(); onSelectProspect?.(c.prospect); }}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onSelectProspect?.(c.prospect); } }}
                          title={`Open ${c.companyName} prospect record`}
                          style={{ flexShrink: 0, marginRight: 4, fontSize: '0.7rem', color: '#1D4ED8', cursor: 'pointer', fontWeight: 700 }}
                        >↗</span>
                        )
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
                          <span style={{ color: '#CBD5E1' }}>-</span>
                        )}
                      </div>
                    )}
                    {showNewCompanyEmail && visibleSet.has('newCompany') && (
                      <InlineCell
                        value={c.newCompany}
                        onCommit={v => setNewCompanyMapping(c.raw || c, v)}
                        fontSize="0.74rem"
                        textColor="#1E293B"
                        fontWeight={600}
                        suggestions={newCompanySuggestions}
                        suggestionsNoun="companies"
                        placeholder="Map new company…"
                        title="The company this person moved to. Pick one to predict their new email (autocomplete lists companies with a known email format first)."
                      />
                    )}
                    {showNewCompanyEmail && visibleSet.has('expectedEmail') && (
                      <ExpectedEmailCell info={c.expectedEmail} name={c.name} />
                    )}
                    {showReachedOut && visibleSet.has('reachedOut') && (
                      <div style={{ padding: '0.3rem 0.5rem', display: 'flex', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleReachedOut(c.raw || c); }}
                          title={c.reachedOut
                            ? `Marked reached out${c.reachedOutAt ? ` on ${new Date(c.reachedOutAt).toLocaleDateString()}` : ''}: click to unmark`
                            : 'Click to mark that you\'ve reached out to this contact'}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '2px 8px', borderRadius: 999,
                            fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                            background: c.reachedOut ? '#DCFCE7' : '#fff',
                            border: `1px solid ${c.reachedOut ? '#86EFAC' : '#CBD5E1'}`,
                            color: c.reachedOut ? '#166534' : '#64748B',
                            whiteSpace: 'nowrap',
                          }}
                        >{c.reachedOut ? '✓ Reached out' : 'Mark reached out'}</button>
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
                        await autoFillLocationFromCity(c.raw || c, city, { state: state || c.state, country: c.country });
                      }}
                      textColor="#64748B"
                      placeholder="-"
                      title="Click to edit. Type 'City, State'."
                      fontSize="0.7rem"
                    />
                    )}
                    {visibleSet.has('city') && (() => {
                      const flag = checkCity(c.city);
                      return (
                        <InlineCell
                          value={c.city}
                          onCommit={async (v) => {
                            await inlineUpdateField(c.raw || c, 'city', v);
                            await autoFillLocationFromCity(c.raw || c, v, { state: c.state, country: c.country });
                          }}
                          suggestions={CITY_NAME_OPTIONS}
                          matchFn={matchCityNames}
                          suggestionsNoun="cities"
                          title="Click to edit. Pick a city for auto-filled State / Country, or type your own."
                          textColor="#64748B"
                          placeholder="-"
                          fontSize="0.7rem"
                          flagIssue={flag?.issue || null}
                          flagFix={flag?.fix || null}
                        />
                      );
                    })()}
                    {visibleSet.has('state') && (() => {
                      // The raw check, not stateFlagOf: an ignored contact
                      // still needs its issue text for the muted marker's
                      // tooltip, so the cell is told both what the warning
                      // says and that it's been ignored.
                      const flag = checkState(c.state);
                      return (
                        <InlineCell
                          value={c.state}
                          onCommit={v => inlineUpdateField(c.raw || c, 'state', v)}
                          textColor="#64748B"
                          placeholder="-"
                          fontSize="0.7rem"
                          flagIssue={flag?.issue || null}
                          flagFix={flag?.fix || null}
                          flagIgnored={isStateWarningIgnored(c)}
                          onToggleFlagIgnored={on => toggleStateWarningIgnored(c, on)}
                        />
                      );
                    })()}
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
                        : <span style={{ color: '#CBD5E1' }}>-</span>}
                    </div>
                    )}
                    {visibleSet.has('salesNav') && (() => {
                      const parts = [c.firstname, c.lastname, c.companyName].map(s => String(s || '').trim()).filter(Boolean);
                      if (parts.length === 0) return <div style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem', color: '#CBD5E1' }}>-</div>;
                      const keywords = encodeURIComponent(parts.join(' '));
                      const liHref = `https://www.linkedin.com/search/results/people/?keywords=${keywords}`;
                      const snHref = `https://www.linkedin.com/sales/search/people?keywords=${keywords}`;
                      return (
                        <div style={{ padding: '0.45rem 0.4rem', fontSize: '0.65rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <a
                            href={liHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open regular LinkedIn people search for "${parts.join(' ')}": best for grabbing the canonical linkedin.com/in/ URL.`}
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
                        : <span style={{ color: '#CBD5E1', fontSize: '0.7rem' }}>-</span>}
                    </div>
                    )}
                    {visibleSet.has('events') && (
                    <InlineCell
                      value={contactEvents[String(c.id || '')] || ''}
                      onCommit={v => handleSaveContactEvents(String(c.id || ''), v)}
                      placeholder="-"
                      title="Click to log events for this contact (conferences, meetings, etc.)"
                      fontSize="0.7rem"
                      textColor="#475569"
                    />
                    )}
                    {storagePrefix === 'all-contacts' && visibleSet.has('custom') && (
                    <InlineCell
                      value={(settings?.customField || {})[String(c.id || '')] || ''}
                      onCommit={v => handleSaveContactCustom(String(c.id || ''), v)}
                      placeholder="-"
                      title="Click to edit this contact's Custom field (used by the {custom} email variable)"
                      fontSize="0.7rem"
                      textColor="#475569"
                    />
                    )}
                    {storagePrefix === 'all-contacts' && visibleSet.has('toCc') && (() => {
                      const entry = toCcEntryFor(c);
                      const hasOwn = !!entry && (entry.to.length > 0 || entry.cc.length > 0);
                      // Other contacts that list THIS contact on their own
                      // To Also / CC lines — surfaced in italics so it reads
                      // as "referenced elsewhere", not a recipient of its own.
                      const inbound = inboundRefsFor(c);
                      const ownerNames = (owners) => owners.map(o => contactNameByEmail.get(o) || o);
                      if (!hasOwn && !inbound) {
                        return (
                          <div
                            style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem', color: '#CBD5E1' }}
                            title="No To / CC recipients set. Open the contact and use the To Also / CC Emails fields to link recipients."
                          >-</div>
                        );
                      }
                      const tip = [
                        entry?.to?.length ? `To: ${entry.to.join(', ')}` : '',
                        entry?.cc?.length ? `CC: ${entry.cc.join(', ')}` : '',
                        inbound?.to?.length ? `Also a To for: ${ownerNames(inbound.to).join(', ')}` : '',
                        inbound?.cc?.length ? `Also a CC for: ${ownerNames(inbound.cc).join(', ')}` : '',
                      ].filter(Boolean).join('\n');
                      return (
                        <div
                          style={{ padding: '0.4rem 0.6rem', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}
                          title={tip}
                        >
                          {hasOwn && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', overflow: 'hidden' }}>
                              {entry.to.map(email => (
                                <span
                                  key={`to|${email}`}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, maxWidth: '100%', padding: '1px 7px', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 999, fontSize: '0.66rem', color: '#92400E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                >
                                  <span style={{ fontWeight: 800, fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>To</span>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</span>
                                </span>
                              ))}
                              {entry.cc.map(email => (
                                <span
                                  key={`cc|${email}`}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, maxWidth: '100%', padding: '1px 7px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 999, fontSize: '0.66rem', color: '#1E40AF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                >
                                  <span style={{ fontWeight: 800, fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>CC</span>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</span>
                                </span>
                              ))}
                            </div>
                          )}
                          {inbound && (
                            <div style={{ fontStyle: 'italic', fontSize: '0.63rem', color: '#64748B', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {inbound.to.length > 0 && (
                                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Also a To for: {ownerNames(inbound.to).join(', ')}</div>
                              )}
                              {inbound.cc.length > 0 && (
                                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Also a CC for: {ownerNames(inbound.cc).join(', ')}</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {visibleSet.has('tags') && (() => {
                      // Read-only, comma-separated tag list. The HubSpot
                      // tags live on the un-normalized `raw` contact
                      // (dans_tags), so read from there first — the
                      // top-level normalized object doesn't carry them.
                      // Kept on a single line and clipped with an ellipsis
                      // so long tag lists don't wrap the row; full text is
                      // available on hover.
                      const raw = c.raw || c;
                      const tagStr = String(raw.dans_tags || raw.dan_s_tags || raw.dans_tag || '')
                        .split(';').map(s => s.trim()).filter(Boolean).join(', ');
                      return (
                        <div
                          title={tagStr}
                          style={{
                            padding: '0.45rem 0.6rem',
                            fontSize: '0.7rem',
                            color: tagStr ? '#1E293B' : '#CBD5E1',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            minWidth: 0,
                          }}
                        >{tagStr || '-'}</div>
                      );
                    })()}
                    {storagePrefix === 'all-contacts' && visibleSet.has('taggedPct') && (() => {
                      // How far through the popup's Yes / No / Not sure table
                      // this contact is. Banded rather than plain text so a
                      // column of numbers reads as "which of these still need
                      // working through" at a glance.
                      const { answered, total, pct, done } = tagScoreFor(c);
                      const band = done
                        ? { bg: '#DCFCE7', color: '#166534' }
                        : pct >= 50 ? { bg: '#FEF3C7', color: '#92400E' }
                        : pct > 0 ? { bg: '#FFEDD5', color: '#9A3412' }
                        : { bg: '#F1F5F9', color: '#94A3B8' };
                      return (
                        <div
                          style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem', minWidth: 0 }}
                          title={`${answered} of ${total} tags mapped. Hide, Left and Test aren't counted. Open the contact to answer the rest.`}
                        >
                          <span style={{
                            display: 'inline-block', padding: '1px 8px', borderRadius: 999,
                            background: band.bg, color: band.color, fontWeight: 700,
                          }}>{pct}%</span>
                        </div>
                      );
                    })()}
                    {visibleSet.has('lastOutreach') && (() => {
                      const entry = contactLastOutreach.get(String(c.id || ''));
                      if (!entry) {
                        return (
                          <div
                            style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem', color: '#CBD5E1' }}
                            title={(activityCache || outreachIndex) ? 'No call or email logged in the Activity feed for this contact' : 'Open the Activity tab once to load HubSpot activity'}
                          >-</div>
                        );
                      }
                      const d = new Date(entry.ts);
                      const days = isNaN(d) ? null : Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
                      const isCall = entry.type === 'call';
                      // Flag contacts gone quiet for over 100 days so stale
                      // relationships are easy to spot at a glance.
                      const stale = days != null && days > 100;
                      const tip = isNaN(d)
                        ? ''
                        : `Most recent ${isCall ? 'call' : 'email'} on ${d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} (from the Activity tab)${stale ? ': over 100 days since last outreach' : ''}`;
                      return (
                        <div
                          style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem', color: stale ? '#B45309' : '#475569', fontWeight: stale ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={tip}
                        >
                          {stale && <span style={{ flexShrink: 0, marginRight: 4, color: '#B45309', fontWeight: 700 }}>⚠</span>}
                          {days == null ? '' : `${days} ${days === 1 ? 'day' : 'days'}`}
                        </div>
                      );
                    })()}
                    {storagePrefix === 'all-contacts' && visibleSet.has('emailCampaigns') && (() => {
                      const entry = contactCampaign.get(String(c.email || '').toLowerCase().trim());
                      if (!entry) {
                        return (
                          <div
                            style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem', color: '#CBD5E1' }}
                            title={savedCampaigns.length ? "This contact isn't a recipient in any saved email campaign" : 'Save a campaign on the Email Campaigns subtab (Draft Emails) to populate this column'}
                          >-</div>
                        );
                      }
                      const d = new Date(entry.ts);
                      const dateLabel = isNaN(d)
                        ? ''
                        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                      const tip = `Most recent campaign: “${entry.subject}”${dateLabel ? ` · sent ${dateLabel}` : ''}`;
                      return (
                        <div
                          style={{ padding: '0.45rem 0.6rem', fontSize: '0.7rem', color: '#475569', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={tip}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {entry.subject}{dateLabel ? ` · ${dateLabel}` : ''}
                          </span>
                        </div>
                      );
                    })()}
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
        ) : isGeography ? (
          geoSummary.length === 0 ? (
            <div style={{ padding: '1.25rem', textAlign: 'center', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No contacts to summarize</div>
              <div style={{ fontSize: '0.78rem' }}>{emptyDetail}</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.72rem', color: '#475569' }}>
                  <strong style={{ color: '#1E293B' }}>{geoTotals.contacts}</strong> contact{geoTotals.contacts === 1 ? '' : 's'} across{' '}
                  <strong style={{ color: '#1E293B' }}>{geoTotals.states}</strong> state{geoTotals.states === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => setGeoExpanded(new Set(geoSummary.map(s => s.state)))}
                  style={{ padding: '0.25rem 0.55rem', fontSize: '0.68rem', fontWeight: 600, border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}
                >Expand all</button>
                <button
                  type="button"
                  onClick={() => setGeoExpanded(new Set())}
                  style={{ padding: '0.25rem 0.55rem', fontSize: '0.68rem', fontWeight: 600, border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}
                >Collapse all</button>
              </div>
              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', padding: '0.5rem 0.9rem', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontSize: '0.62rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <span>State / City</span>
                  <span style={{ textAlign: 'right' }}>Contacts</span>
                </div>
                {geoSummary.map(s => {
                  const open = geoExpanded.has(s.state);
                  return (
                    <div key={s.state}>
                      <div
                        onClick={() => toggleGeo(s.state)}
                        title={open ? 'Click to collapse cities' : 'Click to show cities'}
                        style={{ display: 'grid', gridTemplateColumns: '1fr 120px', alignItems: 'center', padding: '0.5rem 0.9rem', borderBottom: '1px solid #F1F5F9', cursor: 'pointer', background: open ? '#F8FAFC' : '#fff' }}
                      >
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1E293B', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: '#94A3B8', fontSize: '0.7rem', width: 10, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
                          {s.state}
                          <span style={{ color: '#94A3B8', fontWeight: 500, fontSize: '0.7rem' }}>({s.cities.length} {s.cities.length === 1 ? 'city' : 'cities'})</span>
                        </span>
                        <span style={{ textAlign: 'right', fontSize: '0.8rem', fontWeight: 700, color: '#1E293B' }}>{s.total}</span>
                      </div>
                      {open && s.cities.map(ct => (
                        <div key={ct.city} style={{ display: 'grid', gridTemplateColumns: '1fr 120px', alignItems: 'center', padding: '0.35rem 0.9rem 0.35rem 2.1rem', borderBottom: '1px solid #F8FAFC', background: '#fff' }}>
                          <span style={{ fontSize: '0.75rem', color: '#475569' }}>{ct.city}</span>
                          <span style={{ textAlign: 'right', fontSize: '0.75rem', color: '#475569' }}>{ct.count}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )
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
            { key: 'type',        label: 'Type',            align: 'left',   tip: 'Prospect type: Private Equity, Real Estate, etc.' },
            { key: 'status',      label: 'Status',          align: 'left',   tip: 'Prospect status: Client, Inside Sales, Qualifying, etc.' },
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
                  No companies match the current filters{query ? ` for "${query}"` : ''}: clear a filter or column search to see results.
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
                        {row.type || '-'}
                      </div>

                      <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: row.status ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.status || '-'}
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
                        if (dmTotal === 0) return <div style={{ padding: '0.55rem 0.6rem', fontSize: '0.72rem', color: '#CBD5E1' }}>-</div>;
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
                                    <div style={{ fontSize: '0.7rem', color: c.jobtitle ? '#475569' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.jobtitle}>{c.jobtitle || '-'}</div>
                                    <div style={{ fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.email}>
                                      {c.email
                                        ? <a href={`mailto:${c.email}`} style={{ color: '#3B82F6', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>{c.email}</a>
                                        : <span style={{ color: '#CBD5E1' }}>-</span>}
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: c.phone ? '#64748B' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.phone}>{c.phone || '-'}</div>
                                    <div style={{ fontSize: '0.68rem', color: (c.city || c.state) ? '#64748B' : '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {[c.city, c.state].filter(Boolean).join(', ') || '-'}
                                    </div>
                                    <div style={{ fontSize: '0.68rem' }}>
                                      {c.linkedin
                                        ? <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }} onClick={e => e.stopPropagation()}>Open ↗</a>
                                        : <span style={{ color: '#CBD5E1' }}>-</span>}
                                    </div>
                                    {(() => {
                                      const parts = [c.firstname, c.lastname, row.companyName].map(s => String(s || '').trim()).filter(Boolean);
                                      if (parts.length === 0) return <div style={{ fontSize: '0.62rem', color: '#CBD5E1' }}>-</div>;
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
                                        : <span style={{ color: '#CBD5E1', fontSize: '0.68rem' }}>-</span>}
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
            contactOldCompany={settings?.contactOldCompany || {}}
            onSaveOldCompany={handleSaveContactOldCompany}
            onSaveCompanyOverride={saveCompanyOverride}
            contactNicknames={settings?.contactNicknames || {}}
            onSaveNickname={handleSaveContactNickname}
            contactTeamNames={settings?.contactTeamNames || {}}
            onSaveTeamName={handleSaveContactTeamName}
            contactReportsTo={settings?.contactReportsTo || {}}
            onSaveReportsTo={handleSaveContactReportsTo}
            ccMap={settings?.ccMap || {}}
            onSaveCcMap={m => updateSettings({ ccMap: m })}
            toAlsoMap={settings?.toAlsoMap || {}}
            onSaveToAlsoMap={m => updateSettings({ toAlsoMap: m })}
            contactFamilies={settings?.contactFamilies || {}}
            onSaveFamily={(contactId, info) => {
              const current = settings?.contactFamilies || {};
              const next = { ...current };
              const partner = String(info?.partner || '').trim();
              const kids = String(info?.kids || '').trim();
              if (!partner && !kids) delete next[contactId];
              else next[contactId] = { partner, kids };
              updateSettings({ contactFamilies: next });
            }}
            contactMetInPerson={settings?.contactMetInPerson || {}}
            onSaveMetInPerson={(contactId, met) => {
              const current = settings?.contactMetInPerson || {};
              updateSettings({ contactMetInPerson: { ...current, [contactId]: !!met } });
            }}
            contactInvitedToLouisville={settings?.contactInvitedToLouisville || {}}
            onSaveInvitedToLouisville={(contactId, invited) => {
              const current = settings?.contactInvitedToLouisville || {};
              updateSettings({ contactInvitedToLouisville: { ...current, [contactId]: !!invited } });
            }}
            contactSentiment={settings?.contactSentiment || {}}
            onSaveSentiment={(cid, v) => {
              if (cid == null) return;
              const next = { ...(settings?.contactSentiment || {}) };
              if (v) next[cid] = v; else delete next[cid];
              updateSettings({ contactSentiment: next });
            }}
            contactTagReview={settings?.contactTagReview || {}}
            onSaveTagReview={(cid, map) => {
              if (cid == null) return;
              updateSettings({ contactTagReview: { ...(settings?.contactTagReview || {}), [cid]: map } });
            }}
            events={settings?.events || []}
            onToggleContactEvent={(eventId, c) => updateSettings({ events: toggleContactInEvents(settings?.events || [], eventId, c) })}
            companyContacts={sameCompanyContacts}
            allContacts={allHs}
            emailDomains={emailDomains}
            companyNames={prospects.map(p => p.company).filter(Boolean)}
          />
        );
      })()}
    </div>
  );
}
