import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { applyCompanyOverride } from '../../utils/contactRosters';
import styles from './ContactTitlesView.module.css';

// The full-page list behind a search's Contacts button on the Titles page:
// every contact in the app whose job title the search pulls, run with the
// same rules the popup's blurb states (utils/titleSearchMatch.js). The
// "Show left out by Not" switch adds the ones a title term caught and a
// Not term threw back, with the Not term that did it, so a Not list can
// be checked as well as the include list.
//
// `result` is matchTitleSearch's output, worked out by the page so the
// count on the button and the rows in here can't disagree.

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const nameOf = (c) => [c?.firstname, c?.lastname].map(clean).filter(Boolean).join(' ') || clean(c?.email) || 'Unnamed contact';
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export function TitleSearchContactsModal({ entry, result, settings, updateSettings, onClose }) {
  const [showExcluded, setShowExcluded] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const localFields = settings?.contactLocalFields;
  const rows = useMemo(() => {
    const toRow = (m, status) => {
      const c = applyCompanyOverride(m.contact, localFields);
      return {
        id: String(c?.id || c?.vid || c?.email || `${nameOf(c)}|${m.title}`),
        status,
        name: nameOf(c),
        jobtitle: m.title,
        company: clean(c?.company),
        email: clean(c?.email),
        phone: clean(c?.phone),
        location: [c?.city, c?.state, c?.country].map(clean).filter(Boolean).join(', '),
        country: clean(c?.country),
        hits: m.hits.join(', '),
        notHits: m.notHits.join(', '),
        tags: String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '').split(';').map(clean).filter(Boolean).join(', '),
      };
    };
    const list = result.matched.map(m => toRow(m, 'Included'));
    if (showExcluded) list.push(...result.excluded.map(m => toRow(m, 'Left out by Not')));
    return list;
  }, [result, showExcluded, localFields]);

  const columns = useMemo(() => [
    ...(showExcluded ? [{
      key: 'status', label: 'Status', defaultWidth: 130,
      render: (r) => (
        <span className={r.status === 'Included' ? styles.statusIn : styles.statusOut}>{r.status}</span>
      ),
    }] : []),
    { key: 'name', label: 'Name', defaultWidth: 180 },
    { key: 'jobtitle', label: 'Job Title', defaultWidth: 300 },
    { key: 'company', label: 'Company', defaultWidth: 200 },
    { key: 'hits', label: 'Matched Terms', defaultWidth: 180 },
    ...(showExcluded ? [{ key: 'notHits', label: 'Not Terms Hit', defaultWidth: 160 }] : []),
    { key: 'email', label: 'Email', defaultWidth: 220 },
    { key: 'location', label: 'Location', defaultWidth: 180 },
    { key: 'country', label: 'Country', defaultWidth: 120 },
    { key: 'phone', label: 'Phone', defaultWidth: 130 },
    { key: 'tags', label: "Dan's Tags", defaultWidth: 200 },
  ], [showExcluded]);

  const title = clean(entry?.name) || 'Untitled search';
  const exportName = `${title} contacts`.replace(/[\\/:*?"<>|]+/g, ' ');

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.contactsModal}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} contacts`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <span className={styles.modalCount}>
            {plural(result.matched.length, 'contact')}
            {result.excluded.length > 0 && `, ${result.excluded.length.toLocaleString()} more left out by the Not terms`}
          </span>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.modalBlurb}>
            Every contact whose job title has at least one of this search&apos;s {plural(result.includeCount, 'title term')} and
            none of its {plural(result.excludeCount, 'Not term')} (its own Not groups plus the Not list that applies to every
            search). A term matches as whole words in any case, plural included, so &quot;Intern&quot; does not catch
            &quot;International&quot;. Hidden, Left and Schneider contacts are left out, the same as the other contact pages.
            {entry?.scope ? ` The scope line ("${clean(entry.scope)}") is not applied: use the Country column to narrow it.` : ''}
            <label className={styles.modalToggle}>
              <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} />
              Show the {result.excluded.length.toLocaleString()} left out by a Not term
            </label>
          </div>
          {result.includeCount === 0 ? (
            <div className={styles.empty}>This search has no title terms yet, so it pulls nobody. Add some in an Include group.</div>
          ) : (
            <div className={styles.modalTable}>
              <DataTable
                tableId="contact-titles-search-contacts"
                columns={columns}
                rows={rows}
                alwaysVisible={['name']}
                defaultSort={{ key: 'name', direction: 'asc' }}
                emptyMessage="No contacts in the app hold a title this search pulls"
                exportFileName={exportName}
                settings={settings}
                updateSettings={updateSettings}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
