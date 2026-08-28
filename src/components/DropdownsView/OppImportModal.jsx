import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pickableOpps } from '../../utils/oppPricingImport';
import { formatMoney } from '../../utils/servicePricing';
import { parseMoney } from '../../utils/oppsMetrics';
import styles from './DropdownsView.module.css';

// Pick an opportunity to price. The list is every Opps 2 record with an
// account on it, open work first — an import is nearly always for a live
// deal — searchable on account, scope, stage, contact and BFO link.
//
// Read-only: picking an opp copies its scope and counts into the estimator
// and changes nothing about the opp itself.
export function OppImportModal({ records, loading, error, onPick, onClose }) {
  const [term, setTerm] = useState('');
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const all = useMemo(() => pickableOpps(records, ''), [records]);
  // Capped: the store runs to thousands of opps and the panel is a picker,
  // not a table. Searching is how you reach the rest, and the count line
  // says how many the search is hiding.
  const matches = useMemo(() => pickableOpps(records, term), [records, term]);
  const shown = matches.slice(0, 60);

  return createPortal(
    <div className={styles.detailOverlay} onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className={styles.oppPickerPanel}
        role="dialog"
        aria-modal="true"
        aria-label="Import an opportunity"
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.detailHeader}>
          <div className={styles.detailTitleWrap}>
            <h3 className={styles.detailTitle}>Import an opportunity</h3>
            <div className={styles.oppPickerSub}>
              Ticks the services its Scope names and fills in the account’s sites, accounts and quoted amount.
            </div>
          </div>
          <button type="button" className={styles.detailClose} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.oppPickerSearchRow}>
          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            placeholder="Search account, scope, stage, BFO link…"
            value={term}
            onChange={e => setTerm(e.target.value)}
          />
          <span className={styles.resultCount}>
            {loading
              ? 'Loading opps…'
              : `${matches.length} of ${all.length} opps${matches.length > shown.length ? ` · showing ${shown.length}` : ''}`}
          </span>
        </div>

        <div className={styles.oppPickerBody}>
          {error ? (
            <div className={styles.oppPickerEmpty}>{error}</div>
          ) : loading ? (
            <div className={styles.oppPickerEmpty}>Loading opportunities…</div>
          ) : all.length === 0 ? (
            <div className={styles.oppPickerEmpty}>
              No opportunities are loaded in this browser yet. Open the Opps 2 tab once to pull them down,
              then come back.
            </div>
          ) : shown.length === 0 ? (
            <div className={styles.oppPickerEmpty}>No opportunities match “{term}”.</div>
          ) : shown.map((opp, i) => {
            const quoted = parseMoney(opp['Quoted Amount']);
            return (
              <button
                key={opp._id || `${opp.Account}-${i}`}
                type="button"
                className={styles.oppPickerRow}
                onClick={() => onPick(opp)}
                title={opp.Scope || 'No scope on this opp'}
              >
                <span className={styles.oppPickerAccount}>{opp.Account}</span>
                <span className={styles.oppPickerStage}>{opp.Stage || '-'}</span>
                <span className={styles.oppPickerScope}>
                  {opp.Scope
                    ? opp.Scope
                    : <em className={styles.serviceMutedCell}>No scope — nothing to tick</em>}
                </span>
                <span className={styles.oppPickerAmount}>{quoted === null ? '' : formatMoney(quoted)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
