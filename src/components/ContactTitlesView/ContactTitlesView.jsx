import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTACT_TITLE_SEARCHES,
  normalizeTitleSearches,
  resolveTitleSearches,
  termCount,
  uniqueKey,
} from '../../data/contactTitleSearches';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { decisionMakerTitles } from '../../utils/decisionMakerTitles';
import styles from './ContactTitlesView.module.css';

// The title searches behind each contact persona, on the page instead of in
// a spreadsheet.
//
// Seven searches to start with - ESG reporting, Utilities, Procurement,
// Engineering, Climate Risk, Private Equity, CFO - each a scope and a list
// of title terms, and three of them a list of terms that disqualify a hit
// as well. They were worked out once and then lived in a seven-column sheet
// that nobody had open while they were actually searching, which is how the
// same persona gets pulled two different ways a month apart.
//
// A reference, not a filter. Nothing here reads a contact or changes one:
// the searches are still run by hand in HubSpot and ZoomInfo, and this is
// the page that says what to type. Hence the copy button on every group -
// the useful thing to do with thirty title terms is paste them somewhere
// else.
//
// Edit mode makes the whole reference the user's own: persona names, the
// scope line, group headings, and every term. A search that can be read but
// not corrected is a search that gets corrected in a sheet somewhere else
// instead, which is the problem this page was built to end. Edits save to
// settings.contactTitleSearches and Reset puts the seven back.

// A term matches the box if the box's text appears anywhere in it, so
// "energy" finds Energy Supply Manager and typing a full title finds the
// searches that already carry it.
const hits = (term, needle) => !!needle && term.toLowerCase().includes(needle);

// Long enough to read, short enough that a two-letter term isn't a
// half-empty box. Chips size to their text so the flow still reads as
// chips rather than a column of inputs.
const inputSize = (value) => Math.min(Math.max(String(value || '').length + 1, 4), 40);

const EMPTY_GROUP_LABEL = 'Titles (unheaded in the source)';

// The page's own tabs. Searches is the reference this page started as; the
// Decision Makers tab is the other half of the same question, the titles
// the people tagged Decision Maker actually hold.
const VIEWS = [
  { key: 'searches', label: 'Searches' },
  { key: 'dms',      label: 'Decision Makers' },
];
const VIEW_KEY = 'contact-titles:view';

export function ContactTitlesView({ settings, updateSettings }) {
  const [view, setView] = useState(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (VIEWS.some(v => v.key === saved)) return saved;
    } catch { /* storage blocked: start on Searches */ }
    return 'searches';
  });
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* not remembered, still works */ }
  }, [view]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.viewTabs}>
        {VIEWS.map(v => (
          <button
            key={v.key}
            type="button"
            className={view === v.key ? styles.viewTabActive : styles.viewTab}
            onClick={() => setView(v.key)}
          >{v.label}</button>
        ))}
      </div>
      {view === 'dms'
        ? <DecisionMakerTitles settings={settings} updateSettings={updateSettings} />
        : <TitleSearches settings={settings} updateSettings={updateSettings} />}
    </div>
  );
}

function TitleSearches({ settings, updateSettings }) {
  const [term, setTerm] = useState('');
  const [copied, setCopied] = useState('');
  const needle = term.trim().toLowerCase();

  const saved = useMemo(() => resolveTitleSearches(settings), [settings]);

  // The page is always editable. Once something has been typed the draft
  // is authoritative: `saved` is rebuilt from settings on every write, and
  // reading through it mid-edit would snap a half-typed name back to the
  // version that just round-tripped (normalised, trailing space trimmed).
  // The draft is dropped again once the save has landed and nothing on the
  // page has focus, so a change made on another device still shows up.
  const [draft, setDraft] = useState(null);
  const searches = draft ?? saved;
  const pageRef = useRef(null);

  // Autosave, debounced. A settings write per keystroke would be a
  // Firestore round trip per letter of "Chief Sustainability Officer";
  // a save only on Done loses the lot to a closed tab.
  const pendingRef = useRef(null);
  const timerRef = useRef(null);
  // The save runs from a timer, so it needs whichever updateSettings is
  // current when it fires rather than the one captured when it was set.
  const updateRef = useRef(updateSettings);
  useEffect(() => { updateRef.current = updateSettings; }, [updateSettings]);

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next) updateRef.current?.({ contactTitleSearches: normalizeTitleSearches(next) });
  }, []);

  // A pending save outlives the tab switch that unmounts this view.
  useEffect(() => flush, [flush]);

  const commit = useCallback((next) => {
    setDraft(next);
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 800);
  }, [flush]);

  // Let go of the draft when the user leaves the page's fields: save what
  // is pending and read from settings again.
  function releaseDraft(e) {
    if (pageRef.current?.contains(e.relatedTarget)) return;
    flush();
    setDraft(null);
  }

  function resetToDefaults() {
    if (!window.confirm(
      'Put the seven built-in searches back?\n\n'
      + 'Every persona, heading and term you have added or changed on this page is '
      + 'replaced by the original list. This cannot be undone.',
    )) return;
    const fresh = CONTACT_TITLE_SEARCHES.map(e => ({
      ...e, groups: e.groups.map(g => ({ ...g, terms: [...g.terms] })),
    }));
    commit(fresh);
  }

  // Every edit below is the same shape: rebuild the list with one search,
  // one group or one term replaced. Written out rather than reached for
  // through a path helper because each one is two lines and the shape of
  // the change is the useful thing to be able to read.
  const patchSearch = (si, patch) =>
    commit(searches.map((e, i) => (i === si ? { ...e, ...patch } : e)));

  const patchGroup = (si, gi, patch) =>
    patchSearch(si, { groups: searches[si].groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });

  const patchTerms = (si, gi, terms) => patchGroup(si, gi, { terms });

  function addSearch() {
    const used = new Set(searches.map(e => e.key));
    commit([...searches, {
      key: uniqueKey('new-search', used),
      name: '',
      // The scope every one of the built-in searches carries. A new
      // persona is far likelier to share it than to want it blank, and
      // it is a text box either way.
      scope: 'North American Contacts Only',
      groups: [{ label: '', kind: 'include', terms: [] }],
    }]);
  }

  function removeSearch(si) {
    const entry = searches[si];
    const n = termCount(entry);
    if (n > 0 && !window.confirm(
      `Delete ${entry.name || 'this search'} and its ${n} term${n === 1 ? '' : 's'}?`,
    )) return;
    commit(searches.filter((_, i) => i !== si));
  }

  function addGroup(si, kind) {
    patchSearch(si, {
      groups: [...searches[si].groups, { label: kind === 'exclude' ? 'Not' : 'Include', kind, terms: [] }],
    });
  }

  function removeGroup(si, gi) {
    const g = searches[si].groups[gi];
    if (g.terms.length > 0 && !window.confirm(
      `Delete this group and its ${g.terms.length} term${g.terms.length === 1 ? '' : 's'}?`,
    )) return;
    patchSearch(si, { groups: searches[si].groups.filter((_, i) => i !== gi) });
  }

  function addTerm(si, gi, value) {
    const v = String(value || '').trim();
    if (!v) return;
    patchTerms(si, gi, [...searches[si].groups[gi].terms, v]);
  }

  function setTermAt(si, gi, ti, value) {
    patchTerms(si, gi, searches[si].groups[gi].terms.map((t, i) => (i === ti ? value : t)));
  }

  function removeTerm(si, gi, ti) {
    patchTerms(si, gi, searches[si].groups[gi].terms.filter((_, i) => i !== ti));
  }

  // Searches that carry a matching term. Whole cards rather than filtered
  // chip lists: a group shown with its non-matching terms stripped out
  // reads as a shorter list than the one that is actually being run, and
  // the reason to look a title up here is to see the company it keeps.
  //
  // Filtered against what is saved rather than the draft, so a card can't
  // vanish on the keystroke that takes its name past the filter while the
  // user is in the middle of renaming it.
  const shownKeys = useMemo(() => {
    if (!needle) return null;
    return new Set(saved.filter(entry =>
      entry.name.toLowerCase().includes(needle)
      || entry.groups.some(g => g.terms.some(t => hits(t, needle)))).map(e => e.key));
  }, [needle, saved]);
  const shown = shownKeys ? searches.filter(e => shownKeys.has(e.key)) : searches;

  const total = useMemo(
    () => searches.reduce((n, e) => n + termCount(e), 0),
    [searches],
  );

  async function copy(entry, group, gi) {
    const id = `${entry.key}:${gi}`;
    try {
      await navigator.clipboard?.writeText(group.terms.join(', '));
      setCopied(id);
      setTimeout(() => setCopied(c => (c === id ? '' : c)), 1600);
    } catch {
      // No clipboard permission: the terms are on the screen to be selected
      // by hand, so a failed copy is not worth an alert over.
    }
  }

  return (
    <div ref={pageRef} onBlur={releaseDraft}>
      <div className={styles.head}>
        <h2 className={styles.title}>Titles</h2>
        <button type="button" className={styles.resetBtn} onClick={resetToDefaults}>
          Reset to the built-in seven
        </button>
      </div>
      <div className={styles.blurb}>
        What each persona is searched by: the scope the search runs against, the title terms to
        look for, and, where one was worked out, the terms that rule a hit back out. A reference
        for running the search in HubSpot or ZoomInfo - nothing here reads or changes a contact.
        Click any name, scope, heading or term to change it; changes save as you type.
      </div>

      <div className={styles.searchRow}>
        <input
          type="text"
          className={styles.search}
          placeholder="Find a title: energy, risk, portfolio…"
          value={term}
          onChange={e => setTerm(e.target.value)}
        />
        <span className={styles.count}>
          {needle
            ? `${shown.length} of ${searches.length} searches carry “${term.trim()}”`
            : `${searches.length} searches, ${total} terms`}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className={styles.empty}>
          {searches.length === 0
            ? 'No searches on this page yet. Add one below, or reset to the built-in seven.'
            : `No search carries “${term.trim()}”. That is an answer as well: nobody has put this title on a persona yet.`}
        </div>
      ) : (
        <div className={styles.cards}>
          {shown.map((entry) => {
            const si = searches.indexOf(entry);
            return (
              <div key={entry.key} className={styles.card}>
                <div className={styles.cardHead}>
                  <input
                    type="text"
                    className={styles.nameInput}
                    value={entry.name}
                    placeholder="Persona name"
                    aria-label="Persona name"
                    onChange={e => patchSearch(si, { name: e.target.value })}
                  />
                  <span className={styles.cardCount}>{termCount(entry)} terms</span>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => removeSearch(si)}
                    title="Delete this search"
                  >Delete</button>
                </div>

                <input
                  type="text"
                  className={styles.scopeInput}
                  value={entry.scope}
                  placeholder="Scope (who the search runs against)"
                  aria-label="Scope"
                  onChange={e => patchSearch(si, { scope: e.target.value })}
                />

                {entry.groups.map((group, gi) => {
                  const exclude = group.kind === 'exclude';
                  const id = `${entry.key}:${gi}`;
                  return (
                    <div key={id} className={styles.group}>
                      <div className={styles.groupHead}>
                        <input
                          type="text"
                          className={exclude ? styles.labelInputExclude : styles.labelInput}
                          value={group.label}
                          placeholder={EMPTY_GROUP_LABEL}
                          aria-label="Group heading"
                          onChange={e => patchGroup(si, gi, { label: e.target.value })}
                        />
                        <button
                          type="button"
                          className={styles.removeGroupBtn}
                          onClick={() => removeGroup(si, gi)}
                          title="Remove this group of terms"
                        >Remove</button>
                        <button
                          type="button"
                          className={styles.copyBtn}
                          onClick={() => copy(entry, group, gi)}
                          title={`Copy these ${group.terms.length} terms, comma separated, to paste into a search`}
                        >{copied === id ? 'Copied' : 'Copy'}</button>
                      </div>
                      <div className={styles.terms}>
                        {group.terms.map((t, ti) => (
                          <span
                            key={ti}
                            className={[
                              exclude ? styles.termEditExclude : styles.termEdit,
                              hits(t, needle) ? styles.termHit : '',
                            ].filter(Boolean).join(' ')}
                          >
                            <input
                              type="text"
                              className={styles.termInput}
                              value={t}
                              size={inputSize(t)}
                              aria-label="Search term"
                              onChange={e => setTermAt(si, gi, ti, e.target.value)}
                              onBlur={() => { if (!t.trim()) removeTerm(si, gi, ti); }}
                            />
                            <button
                              type="button"
                              className={styles.termX}
                              onClick={() => removeTerm(si, gi, ti)}
                              title={`Remove “${t}”`}
                            >×</button>
                          </span>
                        ))}
                        <AddTerm onAdd={v => addTerm(si, gi, v)} />
                      </div>
                    </div>
                  );
                })}

                <div className={styles.cardFoot}>
                  <button type="button" className={styles.addGroupBtn} onClick={() => addGroup(si, 'include')}>
                    + Include group
                  </button>
                  <button type="button" className={styles.addGroupBtnExclude} onClick={() => addGroup(si, 'exclude')}>
                    + Exclude group
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button type="button" className={styles.addSearchBtn} onClick={addSearch}>
        + New search
      </button>

      <div className={styles.foot}>
        Terms are stored exactly as they are typed, typos included, because these are the strings
        that get typed into a search box: a term corrected here is a term that stops matching
        whoever it used to. Four of the seven built-in searches were written as a plain list of
        titles with no include heading over them, and they say so rather than borrowing one.
      </div>
    </div>
  );
}

// Every distinct job title held by a contact tagged Decision Maker, A to Z,
// with how many hold it. Click a title to see who. Read from the same
// HubSpot cache the contacts tabs use, and refreshed when it is.
//
// Picking a tag (its column heading or the Tag box) narrows the table to
// the titles somebody with that tag holds, most holders first, and puts a
// star by each title: the titles worth flagging for that tag, starred ones
// on top. Stars are kept per tag, in settings.dmTitleStars as
// { tag key: [title, ...] }, and a starred title stays listed under its tag
// even once nobody holding it carries the tag any more, so a flag is never
// lost to a contact being retagged.
//
// Which tag columns show is the user's too, in settings.dmTitlesHiddenTags.
// Stored as the hidden ones rather than the shown ones so a tag that turns
// up later gets a column without anybody having to switch it on.
const STAR_KEY = 'dmTitleStars';
const HIDDEN_TAGS_KEY = 'dmTitlesHiddenTags';

function DecisionMakerTitles({ settings, updateSettings }) {
  const [contacts, setContacts] = useState(null);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [copied, setCopied] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);
  const needle = term.trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => { if (!cancelled) setContacts([]); });
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // The column picker closes on a click anywhere else, like a menu.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onDown = (e) => { if (!pickerRef.current?.contains(e.target)) setPickerOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setPickerOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [pickerOpen]);

  const { titles, tags, untitled } = useMemo(() => decisionMakerTitles(contacts || []), [contacts]);

  const savedStars = settings?.[STAR_KEY];
  const stars = useMemo(() => {
    const out = {};
    if (savedStars && typeof savedStars === 'object' && !Array.isArray(savedStars)) {
      for (const [k, v] of Object.entries(savedStars)) if (Array.isArray(v)) out[k] = new Set(v);
    }
    return out;
  }, [savedStars]);
  const savedHidden = settings?.[HIDDEN_TAGS_KEY];
  const hidden = useMemo(() => new Set(Array.isArray(savedHidden) ? savedHidden : []), [savedHidden]);
  const visibleTags = useMemo(() => tags.filter(t => !hidden.has(t.key)), [tags, hidden]);

  // A to Z with no tag picked. With one, only the titles held by somebody
  // carrying it (or starred for it), starred first, then most holders.
  const [filterTag, setFilterTag] = useState('');
  const activeTag = tags.some(t => t.key === filterTag) ? filterTag : '';
  const tagStars = useMemo(() => (activeTag ? (stars[activeTag] || new Set()) : null), [stars, activeTag]);
  const shown = useMemo(() => {
    let list = needle ? titles.filter(t => t.title.toLowerCase().includes(needle)) : titles;
    if (!activeTag) return list;
    list = list.filter(t => (t.tagCounts[activeTag] || 0) > 0 || tagStars.has(t.title));
    if (starredOnly) list = list.filter(t => tagStars.has(t.title));
    // Array sort is stable, so ties stay A to Z.
    return [...list].sort((a, b) =>
      (tagStars.has(b.title) - tagStars.has(a.title))
      || ((b.tagCounts[activeTag] || 0) - (a.tagCounts[activeTag] || 0)));
  }, [titles, needle, activeTag, tagStars, starredOnly]);
  const tagLabel = useMemo(() => new Map(tags.map(t => [t.key, t.label])), [tags]);
  const people = useMemo(() => titles.reduce((n, t) => n + t.count, 0), [titles]);
  const activeLabel = activeTag ? tagLabel.get(activeTag) : '';
  const starCount = tagStars ? tagStars.size : 0;

  const pickTag = (key) => {
    setFilterTag(key);
    if (!key) setStarredOnly(false);
  };

  const toggle = (title) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(title)) next.delete(title); else next.add(title);
    return next;
  });

  function toggleStar(title) {
    if (!activeTag) return;
    const next = new Set(stars[activeTag] || []);
    if (next.has(title)) next.delete(title); else next.add(title);
    const all = {};
    for (const [k, v] of Object.entries(stars)) all[k] = [...v];
    if (next.size) all[activeTag] = [...next].sort((a, b) => a.localeCompare(b));
    else delete all[activeTag];
    updateSettings?.({ [STAR_KEY]: all });
  }

  function setHidden(next) {
    updateSettings?.({ [HIDDEN_TAGS_KEY]: [...next] });
  }

  function toggleColumn(key) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setHidden(next);
  }

  async function copyAll() {
    try {
      await navigator.clipboard?.writeText(shown.map(t => t.title).join(', '));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Same as the search cards: the list is on screen to select by hand.
    }
  }

  return (
    <div>
      <div className={styles.head}>
        <h2 className={styles.title}>Decision Maker titles</h2>
      </div>
      <div className={styles.blurb}>
        Every job title held by a contact tagged Decision Maker, A to Z, with how many hold it and,
        in a column per tag, how many of them also carry that tag. Click a title to see who. Pick a
        tag, or click its heading, to see only the titles held by people with it, and star the ones
        to flag for that tag. Columns chooses which tags the table shows. Hidden and Left contacts
        are left out, the same as the DMs tab.
      </div>

      <div className={styles.searchRow}>
        <input
          type="text"
          className={styles.search}
          placeholder="Find a title: director, energy, finance…"
          value={term}
          onChange={e => setTerm(e.target.value)}
        />
        <select
          className={activeTag ? styles.dmTagSelectActive : styles.dmTagSelect}
          value={activeTag}
          onChange={e => pickTag(e.target.value)}
          aria-label="Show only the titles for a tag"
        >
          <option value="">All tags</option>
          {tags.map(t => <option key={t.key} value={t.key}>{t.label} ({t.count})</option>)}
        </select>
        {activeTag && (
          <label className={styles.dmStarOnly}>
            <input type="checkbox" checked={starredOnly} onChange={e => setStarredOnly(e.target.checked)} />
            Starred only ({starCount})
          </label>
        )}
        <div className={styles.dmPickerWrap} ref={pickerRef}>
          <button
            type="button"
            className={styles.editBtn}
            onClick={() => setPickerOpen(v => !v)}
            aria-expanded={pickerOpen}
            title="Choose which tag columns the table shows"
          >Columns ({visibleTags.length} of {tags.length})</button>
          {pickerOpen && (
            <div className={styles.dmPicker}>
              <div className={styles.dmPickerHead}>
                <button type="button" className={styles.dmPickerLink} onClick={() => setHidden(new Set())}>Show all</button>
                <button type="button" className={styles.dmPickerLink} onClick={() => setHidden(new Set(tags.map(t => t.key)))}>Hide all</button>
              </div>
              {tags.map(t => (
                <label key={t.key} className={styles.dmPickerItem}>
                  <input type="checkbox" checked={!hidden.has(t.key)} onChange={() => toggleColumn(t.key)} />
                  <span>{t.label}</span>
                  <span className={styles.dmPickerCount}>{t.count}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <span className={styles.count}>
          {contacts == null
            ? 'Loading contacts…'
            : activeTag
              ? `${shown.length} title${shown.length === 1 ? '' : 's'} for ${activeLabel}, ${starCount} starred`
              : needle
                ? `${shown.length} of ${titles.length} titles match “${term.trim()}”`
                : `${titles.length} titles across ${people} decision makers`
                  + (untitled ? `, ${untitled} with no title on file` : '')}
        </span>
        {shown.length > 0 && (
          <button
            type="button"
            className={styles.editBtn}
            onClick={copyAll}
            title={`Copy these ${shown.length} titles, comma separated`}
          >{copied ? 'Copied' : 'Copy titles'}</button>
        )}
      </div>

      {contacts == null ? null : shown.length === 0 ? (
        <div className={styles.empty}>
          {titles.length === 0
            ? 'No contacts tagged Decision Maker have a job title on file yet.'
            : activeTag && starredOnly
              ? `No titles starred for ${activeLabel} yet. Untick Starred only and click a star to flag one.`
              : activeTag
                ? `No decision maker title ${needle ? `matching “${term.trim()}” ` : ''}is held by anybody tagged ${activeLabel}.`
                : `No decision maker title matches “${term.trim()}”.`}
        </div>
      ) : (
        <div className={styles.dmTableWrap}>
          <table className={styles.dmTable}>
            <thead>
              <tr>
                <th className={styles.dmThTitle}>
                  <button
                    type="button"
                    className={!activeTag ? styles.dmSortActive : styles.dmSort}
                    onClick={() => pickTag('')}
                    title="All titles, A to Z"
                  >Title</button>
                </th>
                <th className={styles.dmThNum}>DMs</th>
                {visibleTags.map(t => (
                  <th key={t.key} className={styles.dmThTag}>
                    <button
                      type="button"
                      className={activeTag === t.key ? styles.dmSortActive : styles.dmSort}
                      onClick={() => pickTag(activeTag === t.key ? '' : t.key)}
                      title={activeTag === t.key
                        ? 'Back to every title, A to Z'
                        : `Only the titles held by somebody tagged ${t.label} (${t.count} in all)`}
                    >{t.label}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(t => {
                const isOpen = open.has(t.title);
                const starred = !!tagStars?.has(t.title);
                return (
                  <Fragment key={t.title}>
                    <tr className={starred ? styles.dmStarredRow : undefined}>
                      <td className={styles.dmTdTitle}>
                        <div className={styles.dmTitleCell}>
                          {activeTag && (
                            <button
                              type="button"
                              className={starred ? styles.dmStarOn : styles.dmStar}
                              onClick={() => toggleStar(t.title)}
                              aria-pressed={starred}
                              title={starred ? `Unstar for ${activeLabel}` : `Star ${t.title} for ${activeLabel}`}
                            >{starred ? '★' : '☆'}</button>
                          )}
                          <button
                            type="button"
                            className={styles.dmTitleBtn}
                            onClick={() => toggle(t.title)}
                            aria-expanded={isOpen}
                          >
                            <span className={styles.dmCaret}>{isOpen ? '▾' : '▸'}</span>
                            <span className={styles.dmTitle}>{t.title}</span>
                          </button>
                        </div>
                      </td>
                      <td className={styles.dmTdNum}>{t.count}</td>
                      {visibleTags.map(tag => {
                        const n = t.tagCounts[tag.key] || 0;
                        return (
                          <td
                            key={tag.key}
                            className={n ? styles.dmTdTagHit : styles.dmTdTag}
                            title={n ? `${n} of ${t.count} ${t.title} tagged ${tag.label}` : undefined}
                          >{n || ''}</td>
                        );
                      })}
                    </tr>
                    {isOpen && t.contacts.map((p, i) => (
                      <tr key={i} className={styles.dmPersonRow}>
                        <td className={styles.dmTdPerson}>
                          {p.name}
                          {p.company && <span className={styles.dmCompany}>, {p.company}</span>}
                        </td>
                        <td className={styles.dmTdNum} />
                        {visibleTags.map(tag => (
                          <td key={tag.key} className={styles.dmTdTag}>
                            {p.tags.includes(tag.key) && (
                              <span className={styles.dmTick} title={`${p.name} is tagged ${tagLabel.get(tag.key)}`}>✓</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// The add box at the end of a group. Its own component so the text it is
// holding belongs to the group it sits in - one piece of state up in the
// page would put half-typed text in whichever group was touched last.
function AddTerm({ onAdd }) {
  const [value, setValue] = useState('');
  const submit = () => { onAdd(value); setValue(''); };
  return (
    <input
      type="text"
      className={styles.addTermInput}
      value={value}
      size={inputSize(value) + 4}
      placeholder="+ term"
      aria-label="Add a term"
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') { e.preventDefault(); setValue(''); }
      }}
      // Typing a term and clicking away is still adding a term. The box
      // clears itself, so nothing is left looking half-entered.
      onBlur={submit}
    />
  );
}

export default ContactTitlesView;
