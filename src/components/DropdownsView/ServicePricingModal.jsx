import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PRICING_BASES, formatMoney, parseMoney } from '../../utils/servicePricing';
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
//
// The panel opens on the breakdown. It used to lead with a "How it's priced"
// pair — a Pricing basis dropdown and a read-only unit count — and both were
// saying again what the screen already said: the basis has its own editable
// column on the rate card and is marked on its row in the breakdown below,
// and the unit count is the account's, set on the Deal Pricing subtab and
// not editable from here. Two fields' worth of height before the arithmetic
// anyone opened this for.

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

// Setup used to have a row of its own, built out of components in a panel
// of its own. It has columns now instead: setup is charged on the same
// bases the recurring fee is — flat, per site, a cut of the deal — so it
// belongs on the SAME row as the recurring rate it sits beside, where what
// a line costs to stand up and what it costs to run can be read against
// each other and add into one Year 1 figure.
function breakdownRows(bases) {
  const rank = (key) => {
    const at = BREAKDOWN_ORDER.indexOf(key);
    return at === -1 ? BREAKDOWN_ORDER.length : at;
  };
  return [...bases].sort((a, b) => rank(a.key) - rank(b.key));
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
 * One row per pricing basis, and a service can carry a figure on as many of
 * them as it is actually sold on — a per-site fee and a cut of the deal, a
 * retrofit and the annual that keeps it running.
 *
 * Four rate columns, in the order the money arrives: what the line costs to
 * STAND UP, low and high, then what it costs to RUN every year, low and
 * high. Setup is priced on the same bases the recurring side is, so the two
 * halves of a line sit on one row rather than in separate tables — $40 a
 * site to onboard beside $450 a site to run, and the pair of them adding
 * into the Year 1 columns on the right, which are what those rates come to
 * under the scenario the tab behind is set to.
 */
function FeeBreakdown({ row, bases, onSaveLine, onSaveSetupLine }) {
  const rows = useMemo(() => breakdownRows(bases), [bases]);
  const priced = useMemo(
    () => new Map((row._breakdown || []).map(p => [p.basis, p])),
    [row._breakdown],
  );
  // The setup half of the same map: what each setup line came to under this
  // scenario, so the row can show the fee its rate produced.
  const setupPriced = useMemo(
    () => new Map((row._setupBreakdown || []).map(p => [p.basis, p])),
    [row._setupBreakdown],
  );
  const setupRates = useMemo(
    () => new Map((row.setupLines || []).map(l => [l.basis, l])),
    [row.setupLines],
  );

  // The totals. The four rate columns add up to DOLLARS, not to rates: a
  // per-site rate and a percentage have no sum, but the money they earn
  // between them does, and that is the figure anyone reading a total wants.
  const setupFee = row._setupFee || 0;
  const setupFeeHigh = row._setupFeeHigh || 0;
  const year1 = row.fee === null ? null : row.fee + setupFee;
  const year1High = row.feeHigh === null ? null : row.feeHigh + setupFeeHigh;

  return (
    <>
      <div className={styles.feeGrid} role="table" aria-label={`Fee breakdown for ${row.name}`}>
        <div className={styles.feeGridHead} role="row">
          <span role="columnheader">Fee Component</span>
          <span role="columnheader">Setup Low</span>
          <span role="columnheader">Setup High</span>
          <span role="columnheader">Low Annual Recurring</span>
          <span role="columnheader">High Annual Recurring</span>
          <span role="columnheader">Year 1 Low</span>
          <span role="columnheader">Year 1 High</span>
        </div>

        {rows.map((b) => {
          const part = priced.get(b.key);
          const setupPart = setupPriced.get(b.key);
          const isPrimary = row.basis === b.key;
          const percent = b.kind === 'percent';
          const rate = isPrimary ? row.rate : (part?.rate ?? null);
          const rateHigh = isPrimary ? row.rateHigh : (part?.rateHigh ?? null);
          const has = rate !== null && rate !== undefined;
          const setupLine = setupRates.get(b.key);
          const setupRate = setupLine?.rate ?? null;
          const setupRateHigh = setupLine?.rateHigh ?? null;
          const hasSetup = setupRate !== null && setupRate !== undefined;
          // Year 1 is the two halves added, and a row priced on only one of
          // them still has a first year: a setup-only line bills its setup,
          // a recurring-only line bills its annual. A row priced on neither
          // has nothing to add and shows a dash.
          const rowYear1 = (part || setupPart)
            ? (part?.fee ?? 0) + (setupPart?.fee ?? 0)
            : null;
          const rowYear1High = (part || setupPart)
            ? (part?.feeHigh ?? 0) + (setupPart?.feeHigh ?? 0)
            : null;
          const note = part?.note || setupPart?.note || undefined;

          return (
            <div
              key={b.key}
              className={`${styles.feeGridRow} ${has || hasSetup ? styles.feeGridRowOn : ''}`}
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
                value={setupRate}
                percent={percent}
                placeholder={percent ? '%' : '$'}
                title={`What this service charges once, up front, on ${b.label.toLowerCase()} — billed in year one and never again`}
                onCommit={(v) => onSaveSetupLine(b.key, { rate: v })}
              />
              <RateCell
                value={setupRateHigh}
                percent={percent}
                disabled={!hasSetup}
                placeholder={hasSetup ? (percent ? '%' : '$') : ''}
                title={hasSetup
                  ? 'Optional. Fill it in and this setup line prices to a range.'
                  : 'Set the low setup rate first — a range needs both ends.'}
                onCommit={(v) => onSaveSetupLine(b.key, { rateHigh: v })}
              />

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

              <FeeCell value={rowYear1} title={note} />
              <FeeCell value={rowYear1High} title={note} />
            </div>
          );
        })}

        <div className={styles.feeGridTotal} role="row">
          <span>Total</span>
          <FeeCell value={setupFee} title="What this service costs to stand up, added across its setup lines. Billed once." />
          <FeeCell value={setupFeeHigh} title="What this service costs to stand up, added across its setup lines. Billed once." />
          <FeeCell value={row._recurringFee} title="The annual this service bills, added across its lines" />
          <FeeCell value={row._recurringFeeHigh} title="The annual this service bills, added across its lines" />
          <FeeCell value={year1} title="Every line, setup and recurring, in the first year" />
          <FeeCell value={year1High} title="Every line, setup and recurring, in the first year" />
        </div>
      </div>

      <div className={styles.pricingModalHint}>
        The four rate columns are what you charge — dollars per unit, or a percentage. Setup is
        billed once and lands in year one; the recurring columns bill again every year and run for
        the term. The Year 1 columns are the two added together under the estimate open on the Deal
        Pricing subtab. The Total row adds dollars, not rates.
      </div>
    </>
  );
}

export function ServicePricingModal({
  row,
  bases = PRICING_BASES,
  escapeCloses = true,
  onSaveField,
  onSaveLine,
  onSaveSetupLine,
  onToggleScope,
  onToggleNoFee,
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
          {/* Said above the grid the mark emptied, because otherwise this
              panel is a screen of blank rate boxes with no reason on it. */}
          {row.noFee && (
            <div className={styles.pricingNoFeeNote}>
              <strong>Marked no fee.</strong> This service is delivered at no charge: it prices to
              $0 on every deal and no longer reads as one nobody has got round to pricing. Typing a
              rate below takes the mark off.
            </div>
          )}
          <div className={styles.pricingModalSectionTitle}>Fee breakdown</div>
          <FeeBreakdown
            row={row}
            bases={bases}
            onSaveLine={onSaveLine}
            onSaveSetupLine={onSaveSetupLine}
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
          {/* Beside the scope checkbox because they are the two answers
              this panel gives that aren't a number: is it in the deal, and
              does it charge anything. */}
          {onToggleNoFee && (
            <label
              className={styles.pricingModalScope}
              title="This service is delivered at no charge. It prices to $0 instead of reading as unpriced — and marking it clears the rates below, which unmarking won't bring back."
            >
              <input type="checkbox" checked={!!row.noFee} onChange={onToggleNoFee} />
              No fee
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
