import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PRICING_BASES, SETUP_KINDS, basisFor, formatMoney, normalizeSetup, parseMoney, setupTotal, unitNoun,
} from '../../utils/servicePricing';
import styles from './DropdownsView.module.css';

// Build one service's setup fee out of its parts.
//
// A setup fee is almost never one number: it's an implementation charge,
// plus a per-site onboarding cost, plus whatever else it takes to stand the
// service up. Storing the parts rather than the sum is what lets the figure
// be argued with a year later — and lets the per-unit half follow the deal,
// since a rollout across 40 sites and one across 819 are not the same job.
//
// Fixed components are dollars flat. Per-unit ones borrow the pricing
// bases, so a component charged per site multiplies the same site count the
// recurring fee does; the panel shows that arithmetic against the current
// scenario as you type, because a rate with no count beside it is a number
// nobody can sanity-check.

let nextDraftId = 1;

const toDraft = (c) => ({
  id: `saved:${nextDraftId++}`,
  label: c.label || '',
  kind: c.kind,
  amount: c.amount === null || c.amount === undefined ? '' : String(c.amount),
  basis: c.basis || '',
});

const blankDraft = (bases) => ({
  id: `new:${nextDraftId++}`,
  label: '',
  kind: 'fixed',
  amount: '',
  basis: bases.find(b => b.kind === 'unit')?.key || '',
});

// A draft row as the model stores it. Kept here rather than in the save
// handler so the live total below the rows is worked out from exactly what
// a save would write.
const fromDraft = (row) => ({
  label: row.label.trim(),
  kind: row.kind,
  amount: parseMoney(row.amount),
  basis: row.kind === 'unit' ? row.basis : '',
});

export function SetupFeeModal({
  serviceName, setup, bases = PRICING_BASES, counts = null,
  ownUnit = null, ownUnits = null, onSave, onClose,
}) {
  const unitBases = useMemo(() => bases.filter(b => b.kind === 'unit'), [bases]);
  const [draft, setDraft] = useState(() => {
    const rows = normalizeSetup(setup, bases).map(toDraft);
    return rows.length ? rows : [blankDraft(unitBases)];
  });
  const firstInputRef = useRef(null);

  useEffect(() => { firstInputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  function editRow(id, patch) {
    setDraft(rows => rows.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  const components = useMemo(() => draft.map(fromDraft), [draft]);
  const total = useMemo(
    () => setupTotal(components, { counts, ownUnit, ownUnits, bases }),
    [components, counts, ownUnit, ownUnits, bases],
  );

  // The count one row multiplies under the scenario open in the estimator,
  // and where it came from — the service's own figure or the shared box.
  function rowCount(row) {
    const basis = basisFor(row.basis, bases);
    if (!basis?.unit) return null;
    const own = basis.unit === ownUnit && ownUnits !== null && ownUnits !== undefined
      ? parseMoney(ownUnits) : null;
    const shared = parseMoney(counts?.[basis.unit]);
    const n = own !== null ? own : (shared ?? 0);
    return { n, basis, own: own !== null };
  }

  // Only rows carrying a real amount are saved: a half-typed row left
  // behind is not a component, and storing it as $0 would put a line into
  // every quote that reads as a decision.
  const savable = components.filter(c => c.amount !== null && c.amount > 0);
  const error = draft.some(r => r.kind === 'unit' && !r.basis)
    ? 'Every per-unit component needs a unit to multiply.'
    : '';

  function save() {
    if (error) return;
    onSave(savable);
  }

  return createPortal(
    <div className={styles.detailOverlay} onClick={onClose} role="presentation">
      <div
        className={styles.basesPanel}
        role="dialog"
        aria-modal="true"
        aria-label={`Setup fee for ${serviceName}`}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.detailHeader}>
          <div className={styles.detailTitleWrap}>
            <h3 className={styles.detailTitle}>Setup fee — {serviceName}</h3>
            <div className={styles.oppPickerSub}>
              What it costs to stand this service up, one line per component. Fixed is a flat figure;
              per-unit multiplies the same count the recurring fee is charged on. The whole setup fee is
              billed once — it lands in the first year and in the deal value, never in the annual.
            </div>
          </div>
          <button type="button" className={styles.detailClose} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.basesBody}>
          <div className={styles.setupHeadRow}>
            <span>What it&rsquo;s for</span>
            <span>How it&rsquo;s charged</span>
            <span>Amount</span>
            <span>On this deal</span>
            <span />
          </div>

          {draft.map((row, i) => {
            const amount = parseMoney(row.amount);
            const count = row.kind === 'unit' ? rowCount(row) : null;
            return (
              <div key={row.id} className={styles.setupRow}>
                <input
                  ref={i === 0 ? firstInputRef : undefined}
                  type="text"
                  className={styles.basesInput}
                  value={row.label}
                  placeholder={row.kind === 'unit' ? 'Site onboarding' : 'Implementation'}
                  onChange={e => editRow(row.id, { label: e.target.value })}
                  aria-label="What this component is for"
                />

                <select
                  className={styles.basesSelect}
                  value={row.kind}
                  onChange={e => editRow(row.id, {
                    kind: e.target.value,
                    basis: e.target.value === 'unit' && !row.basis ? (unitBases[0]?.key || '') : row.basis,
                  })}
                  title={SETUP_KINDS.find(k => k.kind === row.kind)?.hint}
                  aria-label="How this component is charged"
                >
                  {SETUP_KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>

                <div className={styles.setupAmountCol}>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    className={styles.basesInput}
                    value={row.amount}
                    placeholder="$"
                    onChange={e => editRow(row.id, { amount: e.target.value })}
                    aria-label="Amount"
                  />
                  {row.kind === 'unit' && (
                    <select
                      className={styles.basesSelect}
                      value={row.basis}
                      onChange={e => editRow(row.id, { basis: e.target.value })}
                      title="The count this component multiplies"
                      aria-label="Per what"
                    >
                      {unitBases.length === 0 && <option value="">No per-unit bases</option>}
                      {unitBases.map(b => (
                        <option key={b.key} value={b.key}>per {unitNoun(b.unitLabel)}</option>
                      ))}
                    </select>
                  )}
                </div>

                <span className={styles.setupLineTotal}>
                  {amount === null || amount <= 0
                    ? <span className={styles.basesNoUnit}>-</span>
                    : row.kind === 'fixed'
                      ? formatMoney(amount)
                      : (
                        <span title={count?.own
                          ? `${count.n.toLocaleString('en-US')} ${count.basis.unitLabel.toLowerCase()} typed against this service`
                          : `${(count?.n ?? 0).toLocaleString('en-US')} ${count?.basis?.unitLabel?.toLowerCase() || 'units'} from the estimator`}
                        >
                          {`× ${(count?.n ?? 0).toLocaleString('en-US')} = ${formatMoney(amount * (count?.n ?? 0))}`}
                        </span>
                      )}
                </span>

                <button
                  type="button"
                  className={styles.stageRemoveBtn}
                  onClick={() => setDraft(rows => rows.filter(r => r.id !== row.id))}
                  title="Remove this component"
                  aria-label={`Remove ${row.label || 'component'}`}
                >×</button>
              </div>
            );
          })}

          <button
            type="button"
            className={styles.addStageBtn}
            onClick={() => setDraft(rows => [...rows, blankDraft(unitBases)])}
          >+ Add a setup component</button>

          <div className={styles.setupTotalRow}>
            <span>Setup fee on this deal</span>
            <strong>{formatMoney(total) || '$0'}</strong>
          </div>
        </div>

        <div className={styles.basesFooter}>
          {error && <span className={styles.basesError}>{error}</span>}
          <span className={styles.basesFooterSpacer} />
          <button type="button" className={styles.showHiddenBtn} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={styles.importOppBtn}
            onClick={save}
            disabled={!!error}
            title={error || (savable.length === 0
              ? 'Saves an empty setup fee — this service goes back to having none'
              : 'Save the components')}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default SetupFeeModal;
