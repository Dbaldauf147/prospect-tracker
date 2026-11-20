import { useMemo, useState } from 'react';
import { DataTable } from '../common/DataTable';
import { groupGuessedCompanies } from '../../utils/companyGuessIgnore';
import { confidenceBand } from '../../utils/companyGuessConfidence';
import styles from './HubSpotView.module.css';

// The review step in front of "Copy All Guessed Companies": every pending
// guess, one row per pairing of what the contact has now and the Table
// View name suggested for it. Each row starts ticked. Unticking one marks
// that suggestion to be ignored for good, and the footer says how many of
// each there are before anything is saved.
// How sure the match is, at a glance: green to trust, red to read first.
const BAND_COLORS = {
  high: { bg: '#DCFCE7', color: '#166534' },
  medium: { bg: '#FEF3C7', color: '#92400E' },
  low: { bg: '#FEE2E2', color: '#991B1B' },
};
const BAND_TITLES = {
  high: 'Strong match: the suggested name accounts for the whole current name or email domain.',
  medium: 'Partial match: worth a look before mapping.',
  low: 'Weak match: the names only share a beginning. Check it, and untick it if it is a different company.',
};

export function GuessedCompanyReviewModal({ contacts, onConfirm, onClose, settings, updateSettings }) {
  const groups = useMemo(() => groupGuessedCompanies(contacts), [contacts]);
  const [skipped, setSkipped] = useState(() => new Set());
  // What the table's own filters leave on screen, so "untick shown" acts
  // on the rows being looked at.
  const [shown, setShown] = useState(null);

  function toggle(id) {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function setShownTo(skip) {
    const ids = (shown || groups).map((g) => g.id);
    setSkipped((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (skip) next.add(id); else next.delete(id); }
      return next;
    });
  }

  const mapGroups = groups.filter((g) => !skipped.has(g.id));
  const ignoreGroups = groups.filter((g) => skipped.has(g.id));
  const mapContacts = mapGroups.reduce((n, g) => n + g.count, 0);
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

  function finish(alsoMap) {
    onConfirm({
      toMap: alsoMap ? mapGroups.flatMap((g) => g.contacts) : [],
      ignoreKeys: ignoreGroups.map((g) => g.id),
    });
  }

  const columns = [
    { key: 'map', label: 'Map', defaultWidth: 70, render: (g) => (
      <input
        type="checkbox"
        checked={!skipped.has(g.id)}
        onChange={() => toggle(g.id)}
        aria-label={`Map ${g.current} to ${g.guess}`}
        title="Ticked: apply this name. Unticked: ignore this suggestion from now on."
      />
    ) },
    { key: 'current', label: 'Current Company', defaultWidth: 260 },
    { key: 'guess', label: 'Suggested Table View Name', defaultWidth: 260, render: (g) => (
      skipped.has(g.id)
        ? <span style={{ color: 'var(--color-text-muted)' }}><s>{g.guess}</s> <em>will be ignored</em></span>
        : <strong>{g.guess}</strong>
    ) },
    { key: 'confidence', label: 'Match %', defaultWidth: 100, render: (g) => {
      const c = BAND_COLORS[confidenceBand(g.confidence)];
      return (
        <span
          title={BAND_TITLES[confidenceBand(g.confidence)]}
          style={{ display: 'inline-block', minWidth: 44, textAlign: 'center', padding: '1px 8px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, background: c.bg, color: c.color }}
        >{g.confidence}%</span>
      );
    } },
    { key: 'count', label: 'Contacts', defaultWidth: 90 },
    { key: 'basis', label: 'Matched On', defaultWidth: 130 },
    { key: 'examples', label: 'Contacts Affected', defaultWidth: 320 },
  ];
  // The Map column filters and sorts on what it shows. Memoized because
  // the table reports its filtered rows back whenever this list changes,
  // and a fresh array every render would have the two chase each other.
  const rows = useMemo(
    () => groups.map((g) => ({ ...g, map: skipped.has(g.id) ? 'Ignore' : 'Map' })),
    [groups, skipped],
  );

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.guessReviewModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Review Guessed Companies</h3>
          <button className={styles.modalClose} onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className={styles.modalBody} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <p className={styles.bulkDesc}>
            {plural(groups.length, 'suggestion')} covering {plural(contacts.length, 'contact')}. Untick any you
            do not want. An unticked suggestion is ignored permanently: it will not be offered again for
            those contacts or for new ones with the same company or email domain. Match % is how
            closely the suggested name fits the current one, so sort by it to read the weakest first.
            Mapping sets the Prospect Tracker Company Name only, HubSpot is not changed.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <button type="button" className={styles.modalCancelBtn} onClick={() => setShownTo(true)}>Untick shown</button>
            <button type="button" className={styles.modalCancelBtn} onClick={() => setShownTo(false)}>Tick shown</button>
          </div>
          {/* DataTable fills a flex column, so it needs a box with a height. */}
          <div style={{ flex: 1, minHeight: 240, display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border-light)', borderRadius: 8, overflow: 'hidden' }}>
          <DataTable
            tableId="hubspot-guess-review"
            columns={columns}
            rows={rows}
            alwaysVisible={['map', 'current', 'guess']}
            defaultSort={{ key: 'count', direction: 'desc' }}
            emptyMessage="No guessed companies to review"
            exportFileName="Guessed companies review"
            onFilteredRowsChange={setShown}
            settings={settings}
            updateSettings={updateSettings}
          />
          </div>
        </div>
        <div className={styles.modalFooter} style={{ alignItems: 'center' }}>
          <span style={{ marginRight: 'auto', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            {plural(mapContacts, 'contact')} to map, {plural(ignoreGroups.length, 'suggestion')} to ignore
          </span>
          <button className={styles.modalCancelBtn} onClick={onClose}>Cancel</button>
          {ignoreGroups.length > 0 && (
            <button
              className={styles.modalCancelBtn}
              onClick={() => finish(false)}
              title="Save the unticked suggestions as ignored and leave the ticked ones for later."
            >
              Ignore {ignoreGroups.length.toLocaleString()} only
            </button>
          )}
          <button className={styles.modalSaveBtn} onClick={() => finish(true)} disabled={mapContacts === 0}>
            Map {plural(mapContacts, 'contact')}{ignoreGroups.length > 0 ? `, ignore ${ignoreGroups.length.toLocaleString()}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
