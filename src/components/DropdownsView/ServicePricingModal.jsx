import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PRICING_BASES, formatMoney, formatMoneyRange, formatRate, formatSetupSummary, parseMoney,
} from '../../utils/servicePricing';
import styles from './DropdownsView.module.css';

// One service's pricing, all of it, on one screen.
//
// The rate card is fourteen columns behind a horizontal scrollbar, so pricing
// a single service means scrolling sideways and losing the name off the left
// edge — and the columns can't say what the cells mean beyond a tooltip.
// Clicking the row opens this instead: every field that decides what the
// service is worth, in one place, each with the sentence that explains it,
// and the arithmetic underneath so the fee can be read against the rate that
// produced it.
//
// Every field writes through the same save path the table cells use, so an
// edit here and an edit there are the same edit; there is no Save button and
// nothing to lose by closing the panel.

// A number field. Held as text while it's being typed so a half-typed figure
// doesn't re-price the deal on every keystroke, committed on blur / Enter,
// reverted on Escape, and only written when the value actually changed —
// opening the panel and closing it can't blank a rate.
function NumField({ label, value, prefix, placeholder, step = '1', hint, disabled, title, onCommit }) {
  const initial = value === null || value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  const [seen, setSeen] = useState(initial);
  // Re-sync when the stored figure changes under us — the same service
  // reopened after an edit, or a save from another device. Adjusted during
  // render rather than in an effect so the box never paints a stale figure.
  if (initial !== seen) {
    setSeen(initial);
    setDraft(initial);
  }

  function commit() {
    const typed = draft.trim();
    if (typed === initial) return;
    if (typed === '') { onCommit(''); return; }
    const n = parseMoney(typed);
    // Not a number: put back what's stored rather than clearing it.
    if (n === null || n < 0) { setDraft(initial); return; }
    onCommit(n);
  }

  return (
    <label className={styles.detailField} title={title}>
      <span className={styles.detailLabel}>{label}</span>
      <div className={styles.detailWeeksRow}>
        {prefix && <span className={styles.detailUnit}>{prefix}</span>}
        <input
          type="number"
          min="0"
          step={step}
          inputMode="decimal"
          className={styles.detailInput}
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); setDraft(initial); e.currentTarget.blur(); }
          }}
        />
      </div>
      {hint && <span className={styles.pricingModalHint}>{hint}</span>}
    </label>
  );
}

// A read-only figure, shown in the same shape as the fields around it so the
// panel reads as one form rather than a form with facts scattered through it.
function ReadOnlyField({ label, children, hint, title }) {
  return (
    <div className={styles.detailField} title={title}>
      <span className={styles.detailLabel}>{label}</span>
      <div className={styles.pricingModalValue}>{children}</div>
      {hint && <span className={styles.pricingModalHint}>{hint}</span>}
    </div>
  );
}

export function ServicePricingModal({
  row,
  bases = PRICING_BASES,
  // False while a panel of this one's own is open on top (the setup fee
  // builder): both would answer the same Escape, and closing the builder
  // shouldn't take the pricing panel with it.
  escapeCloses = true,
  onSaveField,
  onSetUnits,
  onToggleScope,
  onEditSetup,
  onClose,
}) {
  const panelRef = useRef(null);
  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => {
    if (!escapeCloses) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [escapeCloses, onClose]);

  const percent = row._kind === 'percent';
  const hasBasis = !!row.basis;
  const unitNoun = row._unitLabel ? row._unitLabel.toLowerCase() : 'units';
  const setupSummary = formatSetupSummary(row.setup, bases);
  const hasSetup = row.setup.length > 0;

  // The rate as a sentence — "$450 per site", "3% of the deal" — which is
  // the form the number is argued in, and the one a bare cell never shows.
  const rateSentence = hasBasis && row.rate !== null
    ? (row.rateHigh !== null && row.rateHigh > row.rate
      ? `${formatRate({ basis: row.basis, rate: row.rate }, bases)} to ${formatRate({ basis: row.basis, rate: row.rateHigh }, bases)}`
      : formatRate({ basis: row.basis, rate: row.rate }, bases))
    : '';

  return createPortal(
    <div className={styles.detailOverlay} onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        tabIndex={-1}
        className={styles.basesPanel}
        role="dialog"
        aria-modal="true"
        aria-label={`Pricing for ${row.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.detailHeader}>
          <div className={styles.detailTitleWrap}>
            <h3 className={styles.detailTitle}>Pricing — {row.name}</h3>
            <div className={styles.detailBadges}>
              {row.serviceBucket && <span className={styles.detailBadgeMuted}>{row.serviceBucket}</span>}
              {row.serviceType && <span className={styles.detailBadgeMuted}>{row.serviceType}</span>}
              {row.years && <span className={styles.detailBadgeMuted}>{row.years}</span>}
              {row._scoped && <span className={styles.detailBadge}>In scope</span>}
            </div>
            <div className={styles.oppPickerSub}>
              What this service is charged on, and what that comes to under the estimate open on the
              tab behind. Every box saves as you leave it — the same edit as typing in the table.
            </div>
          </div>
          <button type="button" className={styles.detailClose} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.basesBody}>
          <div className={styles.pricingModalSectionTitle}>How it&rsquo;s priced</div>
          <div className={styles.detailGrid}>
            <label className={styles.detailField}>
              <span className={styles.detailLabel}>Pricing basis</span>
              <select
                className={styles.detailInput}
                value={row.basis || ''}
                onChange={(e) => onSaveField('basis', e.target.value)}
              >
                <option value="">-</option>
                {bases.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
              <span className={styles.pricingModalHint}>
                {hasBasis
                  ? (row._unit
                    ? `Charged per ${unitNoun.replace(/s$/, '')} — the rate multiplies the count below.`
                    : percent
                      ? 'A cut of the deal size typed into the estimator.'
                      : 'A flat figure, whatever the account’s size.')
                  : 'Pick one and the rate boxes below come to life. Clearing it takes the rate, floor and count with it.'}
              </span>
            </label>

            <NumField
              label="Low annual recurring fee"
              value={row.rate}
              prefix={percent ? '%' : '$'}
              step="0.01"
              disabled={!hasBasis}
              onCommit={(v) => onSaveField('rate', v)}
              hint={!hasBasis
                ? 'Pick a pricing basis first.'
                : row._typed
                  ? 'Not in use: a fee is typed in below, and that wins.'
                  : 'On its own it prices one figure; add a high rate for a range.'}
            />

            <NumField
              label="High annual recurring fee"
              value={row.rateHigh}
              prefix={percent ? '%' : '$'}
              step="0.01"
              disabled={!hasBasis || row.rate === null}
              onCommit={(v) => onSaveField('rateHigh', v)}
              hint={!hasBasis
                ? 'Pick a pricing basis first.'
                : row.rate === null
                  ? 'Set the low rate first — a range needs both ends.'
                  : 'Optional. Fill it in and every fee for this service reads as a range.'}
            />

            <NumField
              label="Minimum fee"
              value={row.minFee}
              prefix="$"
              step="100"
              onCommit={(v) => onSaveField('minFee', v)}
              hint="The floor: once the service is in scope the fee never comes out below this."
            />

            <NumField
              label={row._unitLabel ? `Units (${unitNoun})` : 'Units'}
              value={row.units}
              placeholder={row._unitLabel || ''}
              disabled={!row._unit}
              onCommit={(v) => onSetUnits(v)}
              hint={!row._unit
                ? (hasBasis
                  ? `${row.basisLabel} isn’t priced per unit, so there’s nothing to count.`
                  : 'Pick a per-unit basis first.')
                : row._unitsOwn
                  ? `Typed in for this estimate: charged on ${row.units.toLocaleString('en-US')} ${unitNoun}, whatever the shared count says. Clear it to go back to that count.`
                  : row._unitsTyped
                    ? 'A standing figure on the rate card. Type here to charge this estimate on its own number instead.'
                    : `From the ${row._unitLabel} box in the estimator. Type a figure to charge this service on its own number of ${unitNoun}.`}
            />

            <ReadOnlyField
              label="Setup fee"
              hint={hasSetup
                ? `${setupSummary} — billed once, so it lands in year one and in the deal value, never in the annual.`
                : 'Built out of fixed and per-unit components rather than typed as a lump, so it can be taken apart later.'}
            >
              <button
                type="button"
                className={styles.setupCellBtn}
                onClick={onEditSetup}
                title={hasSetup ? 'Edit the components this setup fee is made of' : 'Add the components this setup fee is made of'}
              >
                {hasSetup
                  ? <span>{formatMoney(row._setupFee) || '$0'}</span>
                  : <span className={styles.setupCellEmpty}>+ Add</span>}
              </button>
            </ReadOnlyField>
          </div>

          <div className={styles.pricingModalSectionTitle}>What it comes to on this deal</div>
          <div className={styles.detailGrid}>
            <NumField
              label="Estimated year 1 fee"
              value={row.fee}
              prefix="$"
              placeholder="Not priced yet"
              step="100"
              onCommit={(v) => onSaveField('avgFee', v)}
              hint={row._typed
                ? 'Typed in: this is the fee, whatever the basis works out to. Clear it to price off the rates again.'
                : row.fee === null
                  ? `Not priced yet${row._note ? ` — ${row._note.toLowerCase()}` : ''}. Type a fee here, or set a basis and rate above.`
                  : `Worked out from the rate${row._note ? ` — ${row._note.toLowerCase()}` : ''}. Type over it to quote a figure outright.`}
            />

            <ReadOnlyField
              label="Est. deal value"
              hint={row.value === null
                ? 'Nothing to work it out from yet.'
                : 'The fee across the service’s term, with the setup fee in year one.'}
            >
              {row.value === null
                ? <span className={styles.serviceMutedCell}>-</span>
                : formatMoneyRange(row.value, row.valueHigh)}
            </ReadOnlyField>

            <ReadOnlyField
              label="Rate in words"
              hint={rateSentence ? 'How this fee is arrived at.' : 'Set a basis and a rate to see it.'}
            >
              {rateSentence || <span className={styles.serviceMutedCell}>-</span>}
            </ReadOnlyField>
          </div>

          <div className={styles.pricingModalSectionTitle}>Pricing notes</div>
          {/* A textarea rather than the table's one-line cell: the note is the
              assumptions behind the number — who quoted it, what it excludes,
              when it was last checked — and a rate outlives the memory of them. */}
          <NotesField value={row.notes} onCommit={(v) => onSaveField('notes', v)} />
        </div>

        <div className={styles.basesFooter}>
          <label className={styles.pricingModalScope} title="Include this service in the deal estimate on the tab behind">
            <input type="checkbox" checked={row._scoped} onChange={onToggleScope} />
            In scope for this estimate
          </label>
          <span className={styles.basesFooterSpacer} />
          <button type="button" className={styles.importOppBtn} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// The notes box. Same commit rules as the number fields, but Enter opens a
// line rather than committing — a note is prose.
function NotesField({ value, onCommit }) {
  const initial = value || '';
  const [draft, setDraft] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setDraft(initial);
  }
  return (
    <textarea
      className={styles.pricingModalNotes}
      value={draft}
      rows={3}
      placeholder="What this price assumes — who quoted it, what it excludes, when it was last checked."
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const t = draft.trim(); if (t !== initial) onCommit(t); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setDraft(initial); e.currentTarget.blur(); } }}
    />
  );
}

export default ServicePricingModal;
