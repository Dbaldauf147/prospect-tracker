import { useMemo, useState } from 'react';
import { CONTACT_TITLE_SEARCHES, termCount } from '../../data/contactTitleSearches';
import styles from './ContactTitlesView.module.css';

// The title searches behind each contact persona, on the page instead of in
// a spreadsheet.
//
// Seven searches - ESG reporting, Utilities, Procurement, Engineering,
// Climate Risk, Private Equity, CFO - each a scope and a list of title
// terms, and three of them a list of terms that disqualify a hit as well.
// They were worked out once and then lived in a seven-column sheet that
// nobody had open while they were actually searching, which is how the same
// persona gets pulled two different ways a month apart.
//
// A reference, not a filter. Nothing here reads a contact or changes one:
// the searches are still run by hand in HubSpot and ZoomInfo, and this is
// the page that says what to type. Hence the copy button on every group -
// the useful thing to do with thirty title terms is paste them somewhere
// else.

// A term matches the box if the box's text appears anywhere in it, so
// "energy" finds Energy Supply Manager and typing a full title finds the
// searches that already carry it.
const hits = (term, needle) => !!needle && term.toLowerCase().includes(needle);

export function ContactTitlesView() {
  const [term, setTerm] = useState('');
  const [copied, setCopied] = useState('');
  const needle = term.trim().toLowerCase();

  // Searches that carry a matching term. Whole cards rather than filtered
  // chip lists: a group shown with its non-matching terms stripped out
  // reads as a shorter list than the one that is actually being run, and
  // the reason to look a title up here is to see the company it keeps.
  const shown = useMemo(() => {
    if (!needle) return CONTACT_TITLE_SEARCHES;
    return CONTACT_TITLE_SEARCHES.filter(entry =>
      entry.name.toLowerCase().includes(needle)
      || entry.groups.some(g => g.terms.some(t => hits(t, needle))));
  }, [needle]);

  const total = useMemo(
    () => CONTACT_TITLE_SEARCHES.reduce((n, e) => n + termCount(e), 0),
    [],
  );

  async function copy(entry, group) {
    const id = `${entry.key}:${group.label || 'terms'}`;
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
      <h2 className={styles.title}>Titles</h2>
      <div className={styles.blurb}>
        What each persona is searched by: the scope the search runs against, the title terms to
        look for, and, where one was worked out, the terms that rule a hit back out. A reference
        for running the search in HubSpot or ZoomInfo - nothing here reads or changes a contact.
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
            ? `${shown.length} of ${CONTACT_TITLE_SEARCHES.length} searches carry “${term.trim()}”`
            : `${CONTACT_TITLE_SEARCHES.length} searches, ${total} terms`}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className={styles.empty}>
          No search carries “{term.trim()}”. That is an answer as well: nobody has put this title
          on a persona yet.
        </div>
      ) : (
        <div className={styles.cards}>
          {shown.map(entry => (
            <div key={entry.key} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.cardName}>{entry.name}</span>
                <span className={styles.cardCount}>{termCount(entry)} terms</span>
              </div>
              {entry.scope && <span className={styles.scope}>{entry.scope}</span>}

              {entry.groups.map(group => {
                const exclude = group.kind === 'exclude';
                const id = `${entry.key}:${group.label || 'terms'}`;
                return (
                  <div key={id} className={styles.group}>
                    <div className={styles.groupHead}>
                      <span className={exclude
                        ? styles.groupLabelExclude
                        : (group.label ? styles.groupLabel : styles.groupLabelPlain)}
                      >
                        {group.label || 'Titles (unheaded in the source)'}
                      </span>
                      <button
                        type="button"
                        className={styles.copyBtn}
                        onClick={() => copy(entry, group)}
                        title={`Copy these ${group.terms.length} terms, comma separated, to paste into a search`}
                      >{copied === id ? 'Copied' : 'Copy'}</button>
                    </div>
                    <div className={styles.terms}>
                      {group.terms.map(t => (
                        <span
                          key={t}
                          className={[
                            exclude ? styles.termExclude : styles.term,
                            hits(t, needle) ? styles.termHit : '',
                          ].filter(Boolean).join(' ')}
                        >{t}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className={styles.foot}>
        Terms are kept exactly as they were worked out, typos included, because these are the
        strings that get typed into a search box: a term corrected here is a term that stops
        matching whoever it used to. Four of the seven searches were written as a plain list of
        titles with no include heading over them, and they say so rather than borrowing one.
      </div>
    </div>
  );
}

export default ContactTitlesView;
