import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTACT_TITLE_SEARCHES,
  normalizeTitleSearches,
  resolveTitleSearches,
  termCount,
  uniqueKey,
} from '../../data/contactTitleSearches';
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

export function ContactTitlesView({ settings, updateSettings }) {
  const [term, setTerm] = useState('');
  const [copied, setCopied] = useState('');
  const needle = term.trim().toLowerCase();

  const saved = useMemo(() => resolveTitleSearches(settings), [settings]);

  // While editing, the draft is authoritative: `saved` is rebuilt from
  // settings on every write, and reading through it mid-edit would snap a
  // half-typed name back to the version that just round-tripped.
  const [draft, setDraft] = useState(null);
  const editing = draft != null;
  const searches = editing ? draft : saved;

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

  function startEditing() {
    // Deep enough copy that editing a term can't mutate the module-level
    // defaults, which are shared by every later Reset.
    setDraft(searches.map(e => ({ ...e, groups: e.groups.map(g => ({ ...g, terms: [...g.terms] })) })));
  }

  function stopEditing() {
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
  // Not applied while editing. A card that vanishes on the keystroke that
  // takes its name past the filter is a card the user was in the middle of
  // renaming, so the find box is put away for the duration instead.
  const shown = useMemo(() => {
    if (editing || !needle) return searches;
    return searches.filter(entry =>
      entry.name.toLowerCase().includes(needle)
      || entry.groups.some(g => g.terms.some(t => hits(t, needle))));
  }, [editing, needle, searches]);

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
    <div className={styles.wrapper}>
      <div className={styles.head}>
        <h2 className={styles.title}>Titles</h2>
        {editing ? (
          <>
            <button type="button" className={styles.doneBtn} onClick={stopEditing}>Done</button>
            <button type="button" className={styles.resetBtn} onClick={resetToDefaults}>
              Reset to the built-in seven
            </button>
          </>
        ) : (
          <button type="button" className={styles.editBtn} onClick={startEditing}>Edit</button>
        )}
      </div>
      <div className={styles.blurb}>
        What each persona is searched by: the scope the search runs against, the title terms to
        look for, and, where one was worked out, the terms that rule a hit back out. A reference
        for running the search in HubSpot or ZoomInfo - nothing here reads or changes a contact.
      </div>

      {editing ? (
        <div className={styles.editNote}>
          Editing. Names, scopes, headings and terms are all text boxes, and changes save as you
          type. A term is what gets pasted into a search box, so it is stored exactly as typed:
          nothing is spell-checked or tidied on the way in.
        </div>
      ) : (
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
      )}

      {shown.length === 0 ? (
        <div className={styles.empty}>
          {editing
            ? 'No searches. Add one below.'
            : searches.length === 0
              ? 'No searches on this page yet. Edit to add one, or reset to the built-in seven.'
              : `No search carries “${term.trim()}”. That is an answer as well: nobody has put this title on a persona yet.`}
        </div>
      ) : (
        <div className={styles.cards}>
          {shown.map((entry) => {
            const si = searches.indexOf(entry);
            return (
              <div key={entry.key} className={styles.card}>
                <div className={styles.cardHead}>
                  {editing ? (
                    <input
                      type="text"
                      className={styles.nameInput}
                      value={entry.name}
                      placeholder="Persona name"
                      aria-label="Persona name"
                      onChange={e => patchSearch(si, { name: e.target.value })}
                    />
                  ) : (
                    <span className={styles.cardName}>{entry.name || 'Untitled search'}</span>
                  )}
                  <span className={styles.cardCount}>{termCount(entry)} terms</span>
                  {editing && (
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => removeSearch(si)}
                      title="Delete this search"
                    >Delete</button>
                  )}
                </div>

                {editing ? (
                  <input
                    type="text"
                    className={styles.scopeInput}
                    value={entry.scope}
                    placeholder="Scope (who the search runs against)"
                    aria-label="Scope"
                    onChange={e => patchSearch(si, { scope: e.target.value })}
                  />
                ) : entry.scope ? (
                  <span className={styles.scope}>{entry.scope}</span>
                ) : null}

                {entry.groups.map((group, gi) => {
                  const exclude = group.kind === 'exclude';
                  const id = `${entry.key}:${gi}`;
                  return (
                    <div key={id} className={styles.group}>
                      <div className={styles.groupHead}>
                        {editing ? (
                          <input
                            type="text"
                            className={exclude ? styles.labelInputExclude : styles.labelInput}
                            value={group.label}
                            placeholder="Heading (optional)"
                            aria-label="Group heading"
                            onChange={e => patchGroup(si, gi, { label: e.target.value })}
                          />
                        ) : (
                          <span className={exclude
                            ? styles.groupLabelExclude
                            : (group.label ? styles.groupLabel : styles.groupLabelPlain)}
                          >
                            {group.label || EMPTY_GROUP_LABEL}
                          </span>
                        )}
                        {editing ? (
                          <button
                            type="button"
                            className={styles.removeGroupBtn}
                            onClick={() => removeGroup(si, gi)}
                            title="Remove this group of terms"
                          >Remove</button>
                        ) : (
                          <button
                            type="button"
                            className={styles.copyBtn}
                            onClick={() => copy(entry, group, gi)}
                            title={`Copy these ${group.terms.length} terms, comma separated, to paste into a search`}
                          >{copied === id ? 'Copied' : 'Copy'}</button>
                        )}
                      </div>
                      <div className={styles.terms}>
                        {group.terms.map((t, ti) => (
                          editing ? (
                            <span key={ti} className={exclude ? styles.termEditExclude : styles.termEdit}>
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
                          ) : (
                            <span
                              key={ti}
                              className={[
                                exclude ? styles.termExclude : styles.term,
                                hits(t, needle) ? styles.termHit : '',
                              ].filter(Boolean).join(' ')}
                            >{t}</span>
                          )
                        ))}
                        {editing && <AddTerm onAdd={v => addTerm(si, gi, v)} />}
                      </div>
                    </div>
                  );
                })}

                {editing && (
                  <div className={styles.cardFoot}>
                    <button type="button" className={styles.addGroupBtn} onClick={() => addGroup(si, 'include')}>
                      + Include group
                    </button>
                    <button type="button" className={styles.addGroupBtnExclude} onClick={() => addGroup(si, 'exclude')}>
                      + Exclude group
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <button type="button" className={styles.addSearchBtn} onClick={addSearch}>
          + New search
        </button>
      )}

      <div className={styles.foot}>
        Terms are stored exactly as they are typed, typos included, because these are the strings
        that get typed into a search box: a term corrected here is a term that stops matching
        whoever it used to. Four of the seven built-in searches were written as a plain list of
        titles with no include heading over them, and they say so rather than borrowing one.
      </div>
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
