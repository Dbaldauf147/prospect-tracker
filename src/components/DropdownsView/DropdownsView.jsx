import { useState, useMemo } from 'react';
import { DROPDOWN_LISTS, STAGE_AGE_GUIDANCE, SOLUTIONS_CATALOG } from '../../data/dropdownLists';
import styles from './DropdownsView.module.css';

// Reference page for the Opps-workflow dropdown lists. Pulls the
// option vocabulary out of the spreadsheet and surfaces it in the app
// so a salesperson can scan all the available picks without flipping
// to Sheets.
export function DropdownsView() {
  const [search, setSearch] = useState('');

  const term = search.trim().toLowerCase();

  // Filter each card's options against the search term; cards keep
  // their full option list when there's no search, and hide when the
  // search has zero hits in their list AND in the label itself.
  const filteredLists = useMemo(() => {
    if (!term) return DROPDOWN_LISTS;
    return DROPDOWN_LISTS
      .map(list => {
        const labelHit = list.label.toLowerCase().includes(term);
        const filteredOptions = list.options.filter(o => String(o).toLowerCase().includes(term));
        if (labelHit) return list; // keep full list when the label matches
        if (filteredOptions.length === 0) return null;
        return { ...list, options: filteredOptions };
      })
      .filter(Boolean);
  }, [term]);

  const filteredSolutions = useMemo(() => {
    if (!term) return SOLUTIONS_CATALOG;
    return SOLUTIONS_CATALOG.filter(o => String(o).toLowerCase().includes(term));
  }, [term]);

  const totalOptions = useMemo(
    () => DROPDOWN_LISTS.reduce((a, l) => a + l.options.length, 0) + SOLUTIONS_CATALOG.length,
    [],
  );
  const shownOptions = useMemo(
    () => filteredLists.reduce((a, l) => a + l.options.length, 0) + filteredSolutions.length,
    [filteredLists, filteredSolutions],
  );

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h2 className={styles.title}>Dropdowns</h2>
        <span className={styles.lastSync}>
          Reference picklist vocabulary for the Opps workflow. Search filters every list at once.
        </span>
      </div>

      <div className={styles.searchRow}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search options or list name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className={styles.resultCount}>
          {term ? `${shownOptions} of ${totalOptions} options` : `${totalOptions} options across ${DROPDOWN_LISTS.length + 1} lists`}
        </span>
      </div>

      <div className={styles.scroll}>
        <div className={styles.grid}>
          {filteredLists.map(list => (
            <div key={list.key} className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>{list.label}</span>
                <span className={styles.cardCount}>{list.options.length}</span>
              </div>
              <div className={styles.cardBody}>
                {list.options.length === 0 ? (
                  <div className={styles.optionEmpty}>— no options —</div>
                ) : (
                  list.options.map((o, i) => (
                    <div key={`${o}-${i}`} className={styles.option}>{o}</div>
                  ))
                )}
              </div>
            </div>
          ))}

          {filteredSolutions.length > 0 && (
            <div className={styles.card} style={{ gridColumn: 'span 2' }}>
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>Solutions / Service Catalog</span>
                <span className={styles.cardCount}>{filteredSolutions.length}</span>
              </div>
              <div className={`${styles.cardBody} ${styles.cardBodyTall}`}>
                {filteredSolutions.map((o, i) => (
                  <div key={`${o}-${i}`} className={styles.option}>{o}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {!term && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Stage age guidance</h3>
            <table className={styles.guidanceTable}>
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Max Target Age</th>
                  <th>Next Move</th>
                </tr>
              </thead>
              <tbody>
                {STAGE_AGE_GUIDANCE.map(row => (
                  <tr key={row.stage}>
                    <td>{row.stage}</td>
                    <td>{row.maxAge}</td>
                    <td>{row.nextMove}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
