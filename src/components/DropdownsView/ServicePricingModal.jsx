import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PRICING_BASES, formatMoney, formatSetupSummary, parseMoney,
} from '../../utils/servicePricing';
import styles from './DropdownsView.module.css';

// One service's pricing, all of it, on one screen.
//
// The rate card's own columns can't say what a cell means beyond a tooltip,
// and the fields that are set once per service — the setup components, the
// minimum fee, a fee typed outright — would each cost the table a column
// that a hundred and fifty rows never scan. Clicking the row opens this
// instead: every field that decides what the service is worth, in one place,
// each with the sentence that explains it, and the arithmetic underneath so
// the fee can be read against the rate that produced it.
//
// Every field writes through the same save path the table cells use, so an
// edit here and an edit in a column that still exists are the same edit;
// there is no Save button and nothing to lose by closing the panel.

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

// The order the fee breakdown lists its bases in. Not the order the bases
// are declared in: this is the order the rows get read in when someone is
// pricing a deal — the job first, then what it costs to stand up, then the
// flat and per-unit lines, with the cut of the deal last. A basis that
// isn't named here still gets a row; it just goes on the end, so adding one
// in the bases editor puts it in the table without any change here.
const BREAKDOWN_ORDER = [
  'per_project', 'flat', 'recurring_annual', 'per_site', 'per_account',
  'per_meter', 'per_equipment', 'per_mwh', 'pct_deal',
];

// Setup has a row of its own rather than a basis: it is one-time money, so
// it never has a recurring end, and it is already built out of components
// in its own panel. The row shows what those come to and opens that panel.
const SETUP_ROW = '__setup__';

function breakdownRows(bases) {
  const rank = (key) => {
    const at = BREAKDOWN_ORDER.indexOf(key);
    return at === -1 ? BREAKDOWN_ORDER.length : at;
  };
  const ordered = [...bases].sort((a, b) => rank(a.key) - rank(b.key));
  // Setup sits directly under the project line, where the user put it: the
  // two are the one-time half of the quote and they read together.
  const at = ordered.findIndex(b => rank(b.key) > rank('per_project'));
  const rows = ordered.map(b => ({ kind: 'basis', basis: b }));
  rows.splice(at === -1 ? rows.length : at, 0, { kind: 'setup', basis: null });
  return rows;
}

// One rate cell. Shows the figure, edits as a bare number, commits on blur
// or Enter and reverts on Escape — the same rules as every other number on
// this panel, so a cell clicked into and back out of can't blank a rate.
function RateCell({ value, percent, disabled, title, placeholder, onCommit }) {
  const initial = value === null || value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const editing = draft !== null;
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commit() {
    const typed = (draft ?? '').trim();
    setDraft(null);
    if (typed === initial) return;
    if (typed === '') { onCommit(''); return; }
    const n = parseMoney(typed);
    // Not a number: leave what's stored alone rather than clearing it.
    if (n === null || n < 0) return;
    onCommit(n);
  }

  if (!editing) {
    const shown = value === null || value === undefined
      ? ''
      : (percent ? `${value}%` : formatMoney(value));
    return (
      <button
        type="button"
        className={styles.feeGridCellBtn}
        disabled={disabled}
        title={title}
        onClick={() => setDraft(initial)}
      >
        {shown || <span className={styles.feeGridEmpty}>{placeholder}</span>}
      </button>
    );
  }
  return (
    <input
      ref={inputRef}
      type="number"
      min="0"
      step="0.01"
      inputMode="decimal"
      className={styles.feeGridInput}
      value={draft}
      placeholder={percent ? '%' : '$'}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
      }}
    />
  );
}

// A figure in one of the two computed columns, or a dash when the line
// isn't priced.
function FeeCell({ value, title }) {
  return (
    <span className={styles.feeGridFigure} title={title}>
      {value === null || value === undefined
        ? <span className={styles.feeGridEmpty}>-</span>
        : (formatMoney(value) || '$0')}
    </span>
  );
}

/**
 * What this service is charged on, line by line.
 *
 * One row per pricing basis plus a row for setup, and a service can carry a
 * figure on as many of them as it is actually sold on — a per-site fee and
 * a cut of the deal, a retrofit and the annual that keeps it running. The
 * two rate columns are what you type; the two Year 1 columns are what those
 * rates come to under the scenario the tab behind is set to.
 */
function FeeBreakdown({ row, bases, onSaveLine, onEditSetup }) {
  // What the setup fee is made of, in words — "$25,000 + $40/site". The
  // figure alone is a number nobody can check, and the components live in
  // their own panel, so the row that shows the total carries the recipe.
  const setupSummary = formatSetupSummary(row.setup, bases);
  const rows = useMemo(() => breakdownRows(bases), [bases]);
  const priced = useMemo(
    () => new Map((row._breakdown || []).map(p => [p.basis, p])),
    [row._breakdown],
  );
  const setupFee = row._setupFee || 0;

  // The totals. The two rate columns add up to DOLLARS, not to rates: a
  // per-site rate and a percentage have no sum, but the annual they earn
  // between them does, and that is the figure anyone reading a total wants.
  const year1 = row.fee === null ? null : row.fee + setupFee;
  const year1High = row.feeHigh === null ? null : row.feeHigh + setupFee;

  return (
    <>
      <div className={styles.feeGrid} role="table" aria-label={`Fee breakdown for ${row.name}`}>
        <div className={styles.feeGridHead} role="row">
          <span role="columnheader" />
          <span role="columnheader">Low recurring fee</span>
          <span role="columnheader">High recurring fee</span>
          <span role="columnheader">Year 1 Low</span>
          <span role="columnheader">Year 1 High</span>
        </div>

        {rows.map((r) => {
          if (r.kind === 'setup') {
            return (
              <div key={SETUP_ROW} className={styles.feeGridRow} role="row">
                <span className={styles.feeGridLabel}>Setup</span>
                <span className={styles.feeGridNa} title="Setup is billed once, so it has no recurring end">-</span>
                <span className={styles.feeGridNa} title="Setup is billed once, so it has no recurring end">-</span>
                <button
                  type="button"
                  className={styles.feeGridSetupBtn}
                  onClick={onEditSetup}
                  title={setupSummary
                    ? `${setupSummary} — billed once, so it lands in year one and in the deal value, never in the annual. Click to edit the components.`
                    : 'Built out of fixed and per-unit components rather than typed as a lump, so it can be taken apart later. Click to add them.'}
                >
                  {/* A setup fee made only of per-unit components comes to
                      nothing until there are counts to multiply, and this is
                      the one place the card shows it — so an empty figure
                      falls back to the recipe rather than reading as "no
                      setup fee" on a service that has one. */}
                  {setupFee > 0
                    ? formatMoney(setupFee)
                    : (setupSummary || <span className={styles.feeGridEmpty}>+ Add</span>)}
                </button>
                <FeeCell value={setupFee > 0 ? setupFee : null} title="A setup fee is one figure, not a range" />
              </div>
            );
          }

          const b = r.basis;
          const part = priced.get(b.key);
          const isPrimary = row.basis === b.key;
          const percent = b.kind === 'percent';
          const rate = isPrimary ? row.rate : (part?.rate ?? null);
          const rateHigh = isPrimary ? row.rateHigh : (part?.rateHigh ?? null);
          const has = rate !== null && rate !== undefined;

          return (
            <div
              key={b.key}
              className={`${styles.feeGridRow} ${has ? styles.feeGridRowOn : ''}`}
              role="row"
            >
              <span className={styles.feeGridLabel} title={b.recurs
                ? 'A flat figure that bills every year, whatever the service’s Type says'
                : (b.unitLabel
                  ? `Charged per ${b.unitLabel.toLowerCase().replace(/s$/, '')}`
                  : (percent ? 'A cut of the deal size typed on the Deal Pricing subtab' : 'A flat figure'))}
              >
                {b.label}
              </span>

              <RateCell
                value={rate}
                percent={percent}
                placeholder={percent ? '%' : '$'}
                title={`The low ${percent ? 'percentage' : 'rate'} this service is charged on ${b.label.toLowerCase()}`}
                onCommit={(v) => onSaveLine(b.key, { rate: v })}
              />
              <RateCell
                value={rateHigh}
                percent={percent}
                disabled={!has}
                placeholder={has ? (percent ? '%' : '$') : ''}
                title={has
                  ? 'Optional. Fill it in and this line prices to a range.'
                  : 'Set the low rate first — a range needs both ends.'}
                onCommit={(v) => onSaveLine(b.key, { rateHigh: v })}
              />

              <FeeCell value={part ? part.fee : null} title={part?.note || undefined} />
              <FeeCell value={part ? part.feeHigh : null} title={part?.note || undefined} />
            </div>
          );
        })}

        <div className={styles.feeGridTotal} role="row">
          <span>Total</span>
          <FeeCell value={row._recurringFee} title="The annual this service bills, added across its lines" />
          <FeeCell value={row._recurringFeeHigh} title="The annual this service bills, added across its lines" />
          <FeeCell value={year1} title="Every line, plus the setup fee, in the first year" />
          <FeeCell value={year1High} title="Every line, plus the setup fee, in the first year" />
        </div>
      </div>

      <div className={styles.pricingModalHint}>
        The two rate columns are what you charge — dollars per unit, or a percentage. The Year 1
        columns are what that comes to under the estimate open on the Deal Pricing subtab. The
        Total row adds dollars, not rates: its recurring figure is the annual this service bills
        across every line.
      </div>
    </>
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
  onSaveLine,
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

  return createPortal(
    <div className={styles.detailOverlay} onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`${styles.basesPanel} ${styles.pricingPanel}`}
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
              Deal Pricing subtab. Every box saves as you leave it; there is nothing to press and
              nothing lost by closing the panel.
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
                    ? `The line this service leads with, and the one the Units box below counts for. Charged per ${unitNoun.replace(/s$/, '')}.`
                    : percent
                      ? 'The line this service leads with. A cut of the deal size typed on the Deal Pricing subtab.'
                      : 'The line this service leads with. A flat figure, whatever the account’s size.')
                  : 'Set by the first row you fill in on the breakdown below. It is the line the rate card’s own columns show.'}
              </span>
            </label>

            {/* The count the per-unit rate multiplies. Read-only: the number
                belongs to the account being priced, and a figure typed over
                it here prices the service against something the estimate
                on the Deal Pricing subtab isn't. It still says where it came
                from, because the Year 1 column is meaningless without it. */}
            <ReadOnlyField
              label={row._unitLabel ? `Units (${unitNoun})` : 'Units'}
              hint={!row._unit
                ? (hasBasis
                  ? `${row.basisLabel} isn’t priced per unit, so there’s nothing to count.`
                  : 'Pick a per-unit basis first.')
                : row.units === null
                  ? `No ${unitNoun} to price against — put a figure in the ${row._unitLabel || 'units'} box on the Deal Pricing subtab.`
                  : row._unitsOwn
                    ? 'Set against this service for this estimate, whatever the shared count says. Clear it in the Units column on the Deal Pricing subtab.'
                    : row._unitsTyped
                      ? 'A standing figure on the rate card.'
                      : `From the ${row._unitLabel} box on the Deal Pricing subtab.`}
            >
              {!row._unit || row.units === null
                ? <span className={styles.serviceMutedCell}>-</span>
                : `${row.units.toLocaleString('en-US')} ${unitNoun}`}
            </ReadOnlyField>

          </div>

          <div className={styles.pricingModalSectionTitle}>Fee breakdown</div>
          <FeeBreakdown
            row={row}
            bases={bases}
            onSaveLine={onSaveLine}
            onEditSetup={onEditSetup}
          />

          <div className={styles.pricingModalSectionTitle}>Pricing notes</div>
          {/* A textarea rather than the table's one-line cell: the note is the
              assumptions behind the number — who quoted it, what it excludes,
              when it was last checked — and a rate outlives the memory of them. */}
          <NotesField value={row.notes} onCommit={(v) => onSaveField('notes', v)} />
        </div>

        <div className={styles.basesFooter}>
          {/* Only where the scope is actually editable. Opened off the rate
              card there is no estimate to tick this service into — that is
              the Deal Pricing subtab's job — and a checkbox that wrote to
              one from here would be an edit nobody asked for. */}
          {onToggleScope && (
            <label className={styles.pricingModalScope} title="Include this service in the deal estimate on the Deal Pricing subtab">
              <input type="checkbox" checked={row._scoped} onChange={onToggleScope} />
              In scope for this estimate
            </label>
          )}
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
