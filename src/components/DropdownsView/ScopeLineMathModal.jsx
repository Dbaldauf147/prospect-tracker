import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatMoney, formatMoneyRange } from '../../utils/servicePricing';
import { scopeLineMath } from '../../utils/scopeLineMath';
import styles from './DropdownsView.module.css';

// Why one service in the deal costs what it costs.
//
// Opened from a bullet in the scope breakdown, which states a figure and
// nothing else. The figure is the end of a sum whose parts are scattered
// across three subtabs — the rates on Services Pricing, the counts in the
// boxes above the table, the deal a percentage takes its cut of inside a
// bundle nobody can see — and a range quoted to a client is the number most
// likely to be challenged. So the sum is printed: every line, the rate and
// the count that made it, and the total they add to, which is the same
// total the row shows.
//
// Read-only. Nothing here edits a rate: the rate card is where a price is
// changed, and a panel that both explains a number and quietly moves it is
// a panel nobody can trust to explain the next one.
export function ScopeLineMathModal({ line, dealTotal, bases, onClose }) {
  const panelRef = useRef(null);
  const math = useMemo(
    () => scopeLineMath(line, { bases, dealTotal }),
    [line, bases, dealTotal],
  );

  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  if (!math) return null;

  const ranged = math.year1High !== null && math.year1High > math.year1;
  // The sentence under the total. Year one is one figure on the row above
  // and two kinds of money underneath: the half that bills again next year
  // and the half that doesn't. A first year that is mostly setup is a very
  // different deal from one that isn't, and the row can't say so.
  const splitParts = [];
  if (math.recurring > 0 || math.recurringHigh > 0) {
    splitParts.push(`${formatMoneyRange(math.recurring, math.recurringHigh)} of it bills again every year`);
  }
  if (math.once > 0 || math.onceHigh > 0) {
    splitParts.push(`${formatMoneyRange(math.once, math.onceHigh)} is billed once`);
  }

  return createPortal(
    <div className={styles.detailOverlay} onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        tabIndex={-1}
        className={styles.mathPanel}
        role="dialog"
        aria-modal="true"
        aria-label={`How ${math.name} is priced`}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.detailHeader}>
          <div className={styles.detailTitleWrap}>
            <h3 className={styles.detailTitle}>{math.name}</h3>
            <div className={styles.oppPickerSub}>
              How this service got to its year one price. Read-only: rates are edited on the Services Pricing subtab, counts in the boxes above the table.
            </div>
          </div>
          <button type="button" className={styles.detailClose} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.mathBody}>
          <div className={styles.mathHeadline}>
            <span className={styles.mathHeadlineFigure}>
              {math.priced ? (formatMoneyRange(math.year1, math.year1High) || '$0') : 'Not priced'}
            </span>
            <span className={styles.mathHeadlineLabel}>
              {math.priced
                ? `In year one${math.share > 0 ? `, ${math.share}% of the deal` : ''}`
                : 'Nothing on the rate card works this out yet'}
            </span>
          </div>

          {math.rateCard && (
            <div className={styles.mathRateCard}>
              <span className={styles.mathRateCardLabel}>On the rate card</span>
              {math.rateCard}
            </div>
          )}

          {math.steps.length > 0 ? (
            <table className={styles.mathTable}>
              <thead>
                <tr>
                  <th className={styles.mathColStep}>Line</th>
                  <th className={styles.mathColMoney}>Low</th>
                  <th className={styles.mathColMoney}>High</th>
                </tr>
              </thead>
              <tbody>
                {math.steps.map(step => (
                  <tr key={step.key}>
                    <td className={styles.mathColStep}>
                      <div className={styles.mathStepHead}>
                        <span className={styles.mathStepName}>{step.label}</span>
                        <span className={step.setup ? styles.mathTagSetup : styles.mathTag}>{step.when}</span>
                      </div>
                      {step.math && <div className={styles.mathStepWorking}>{step.math}</div>}
                      {step.note
                        ? <div className={styles.mathStepNote}>{step.note}, so this line prices at nothing</div>
                        : step.source && <div className={styles.mathStepSource}>{step.source}</div>}
                    </td>
                    <td className={styles.mathColMoney}>{formatMoney(step.low) || '$0'}</td>
                    <td className={styles.mathColMoney}>{formatMoney(step.high) || '$0'}</td>
                  </tr>
                ))}
                {/* The line the ones above it add up to. It is the same
                    figure the bullet showed, which is the point: a total
                    nobody can take apart is a total nobody can check. */}
                <tr className={styles.mathTotalRow}>
                  <td className={styles.mathColStep}>Year one, all in</td>
                  <td className={styles.mathColMoney}>{formatMoney(math.year1) || '$0'}</td>
                  <td className={styles.mathColMoney}>{formatMoney(math.year1High) || '$0'}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className={styles.mathEmpty}>
              {math.noFee
                ? 'Marked no fee: this service is given away on purpose, so there is no arithmetic behind it and it adds nothing to the deal.'
                : `${math.note || 'Nothing is priced on the rate card for this service'}, so there is no working to show. It stays in the scope and out of the total: unknown, not free.`}
            </div>
          )}

          {math.priced && splitParts.length > 0 && (
            <div className={styles.mathFoot}>
              {`${splitParts.join(', and ')}.`}
              {math.years > 1 && math.recurringHigh > 0 && (
                ` Over the ${math.years} year term that is ${formatMoneyRange(math.contract, math.contractHigh)}.`
              )}
            </div>
          )}

          {ranged && (
            <div className={styles.mathFoot}>
              The two columns are the two ends of the rate card, not a guess either side of a figure: the low column prices every line at its low rate and the high column prices every line at its high one.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
