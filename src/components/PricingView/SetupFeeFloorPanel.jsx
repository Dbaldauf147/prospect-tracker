import { useState } from 'react';
import styles from './PricingView.module.css';
import { solveSetupFeeFloor } from '../../utils/setupFeeFloor';

// "How low can the Setup fees go?" — the discount question, asked forwards.
//
// The red banner above this answers the same arithmetic backwards: type a fee,
// find out afterwards that Year 1 is under water. On a call the useful form is
// the limit — how much can come off the setup fee before the deal stops paying
// for its own first year — and until this existed that was a subtraction done
// in someone's head against a schedule of auto-derived fees.
//
// Everything except the Setup rows is held fixed: cost, recurring fees, one-time
// fees. They are not what is being negotiated, and moving them would make the
// answer depend on assumptions the user did not make.
//
// Two things stop the cut, and the panel says which one did: Year 1 running out
// of headroom, and the Setup fees reaching what Setup costs to deliver (tech
// depreciation included — the "Setup" row of Totals by type). Break-even alone
// would hand back a floor of $0 on any deal whose recurring stream carries the
// year, which quotes the delivery work away at a loss.
//
// The solve itself lives in utils/setupFeeFloor.js so it can be asserted
// directly (scripts/setupFeeFloor.test.mjs) — a floor that is quietly a few
// cents too low reads exactly like one that isn't.

const fmtMoney = (n) => (typeof n === 'number' && Number.isFinite(n))
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '';
const fmtWhole = (n) => (typeof n === 'number' && Number.isFinite(n))
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  : '';

export function SetupFeeFloorPanel({
  y1Cost = 0,
  fixedY1Revenue = 0,
  setupCostFloor = 0,
  heldSetupY1Revenue = 0,
  setupRows = [],
  onApply,
}) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState('');

  const result = solveSetupFeeFloor({
    y1Cost, fixedY1Revenue, setupCostFloor, heldSetupY1Revenue, rows: setupRows,
  });
  const {
    status, rows, maxReduction, currentCashFlow, setupY1Revenue, floorSetupY1Revenue,
    bindingConstraint, reducibleFloor,
  } = result;
  const pctOff = setupY1Revenue > 0 ? (maxReduction / setupY1Revenue) * 100 : 0;
  const canApply = !!onApply && (status === 'ok' || status === 'zero-floor') && maxReduction > 0;
  const costBound = bindingConstraint === 'setupCost';

  return (
    <div className={styles.floorWrap}>
      <button
        type="button"
        className={styles.floorBtn}
        aria-expanded={open}
        onClick={() => { setOpen(o => !o); setApplied(''); }}
        title="Solve for the lowest Setup fees that still cover the Setup cost (incl. tech depreciation) and keep Year 1 cash flow at or above zero. Cost, recurring fees and one-time fees are held as they are."
      >
        {open ? '▾' : '▸'} How low can Setup fees go?
      </button>

      {open && (
        <div className={styles.floorPanel}>
          <div className={styles.floorHeadline}>
            {status === 'already-negative' && (
              <>
                Year 1 is already <strong>{fmtMoney(result.shortfall)}</strong> short
                ({fmtMoney(result.currentY1Revenue)} revenue vs {fmtMoney(y1Cost)} cost).
                Cutting Setup fees widens that gap — there is no room to discount.
                Year 1 needs {fmtMoney(result.shortfall)} more fee, or that much cost moved out of it.
              </>
            )}
            {status === 'nothing-to-reduce' && (
              <>
                No Setup fee bills in Year 1, so there is nothing here to discount.
                Year 1 currently nets <strong>{fmtMoney(currentCashFlow)}</strong>.
                {' '}(Pass-through rows and fees starting after month 12 are left out — neither moves Year 1.)
              </>
            )}
            {status === 'at-cost-floor' && (
              <>
                Setup fees are already at their floor: {fmtMoney(setupY1Revenue)} against
                {' '}<strong>{fmtMoney(reducibleFloor)}</strong> of Setup cost (incl. tech depreciation),
                so there is nothing to discount.
                {result.belowCostBy > 0 && (
                  <> They are <strong>{fmtMoney(result.belowCostBy)}</strong> under that cost as it is —
                  the Setup work is billing at a loss, whatever Year 1 nets overall.</>
                )}
              </>
            )}
            {status === 'zero-floor' && (
              <>
                The rest of the deal already pays for Year 1: Setup fees can go all the way to
                {' '}<strong>$0</strong> and Year 1 still nets <strong>{fmtMoney(result.resultingCashFlow)}</strong>.
              </>
            )}
            {status === 'ok' && (maxReduction > 0 ? (
              <>
                Setup fees can come down by <strong>{fmtMoney(maxReduction)}</strong>
                {' '}(<strong>{pctOff.toFixed(1)}%</strong> off) — from {fmtMoney(setupY1Revenue)} to
                {' '}<strong>{fmtMoney(floorSetupY1Revenue)}</strong> —{' '}
                {costBound
                  ? 'before they stop covering the Setup cost (incl. tech depreciation).'
                  : 'before Year 1 cash flow turns negative.'}
              </>
            ) : (
              <>
                Setup fees are already at the floor:{' '}
                {costBound
                  ? <>they bill {fmtMoney(setupY1Revenue)} against {fmtMoney(reducibleFloor)} of Setup
                    cost (incl. tech depreciation), so a dollar off puts the Setup work under its own cost.</>
                  : <>Year 1 nets <strong>{fmtMoney(currentCashFlow)}</strong>, so a dollar off any Setup
                    fee puts it under water.</>}
              </>
            ))}
          </div>

          <div className={styles.floorMath}>
            Year 1 revenue {fmtWhole(result.currentY1Revenue)} − cost {fmtWhole(y1Cost)} ={' '}
            <span className={currentCashFlow < 0 ? styles.floorNeg : styles.floorPos}>
              {fmtWhole(currentCashFlow)}
            </span>
            {currentCashFlow < 0 ? ' short.' : ' of headroom.'}
            {reducibleFloor > 0 && (
              <>
                {' '}Setup cost floor <strong>{fmtWhole(reducibleFloor)}</strong> (incl. tech depreciation)
                {result.heldSetupY1Revenue > 0 && (
                  <>, after {fmtWhole(result.heldSetupY1Revenue)} of pass-through Setup fee already
                  covering part of it</>
                )}
                .
              </>
            )}
            {' '}Cost, recurring fees and one-time fees are held as they are.
          </div>

          {rows.length > 0 && status !== 'already-negative' && (
            <table className={styles.floorTable}>
              <thead>
                <tr>
                  <th>Setup fee</th>
                  <th className={styles.numCell}>Fee now</th>
                  <th className={styles.numCell}>Floor fee</th>
                  <th className={styles.numCell}>Units</th>
                  <th className={styles.numCell}>Y1 now</th>
                  <th className={styles.numCell}>Y1 at floor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key}>
                    <td>
                      {r.label}
                      {r.isAuto && <span className={styles.floorAutoTag} title="This row's fee is auto-derived from its linked costs. Applying the floor writes a fixed fee over it; clear the cell to go back to auto.">auto</span>}
                    </td>
                    <td className={styles.numCell}>{fmtMoney(r.fee)}</td>
                    <td className={`${styles.numCell} ${styles.floorFeeCell}`}>{fmtMoney(r.floorFee)}</td>
                    <td className={styles.numCell}>{r.unitCount || ''}</td>
                    <td className={styles.numCell}>{fmtMoney(r.y1Revenue)}</td>
                    <td className={styles.numCell}>{fmtMoney(r.floorY1Revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {rows.length > 1 && (status === 'ok' || status === 'zero-floor') && maxReduction > 0 && (
            <div className={styles.floorNote}>
              The cut is spread across the rows in proportion to what each bills, so every Setup
              fee gives up the same percentage. Any other split adding up to {fmtMoney(maxReduction)}
              {' '}holds the {costBound ? 'Setup fees at their cost' : 'year at break even'} just as well.
            </div>
          )}

          {status === 'ok' && maxReduction > 0 && (
            <div className={styles.floorNote}>
              {costBound
                ? <>At the floor the Setup fees bill exactly what Setup costs to deliver — no margin on
                  that work at all. Year 1 still nets {fmtMoney(result.resultingCashFlow)}, so the cut
                  stops here on the cost, not on the year.</>
                : <>At the floor Year 1 nets {fmtMoney(result.resultingCashFlow)} — it covers its own cost
                  and nothing more.</>}
              {' '}It is a limit to negotiate against, not a price to open with.
            </div>
          )}

          {canApply && (
            <div className={styles.floorActions}>
              <button
                type="button"
                className={styles.floorApplyBtn}
                onClick={() => {
                  onApply(rows.map(r => ({ index: r.index, fee: r.floorFee })));
                  setApplied(`Wrote the floor fee into ${rows.length} row${rows.length === 1 ? '' : 's'}. Clear a Fee cell to put it back on auto.`);
                }}
                title="Type these floor fees into the schedule's Fee column. Any row that was auto-deriving its fee gets a fixed value written over it."
              >
                Apply floor to the {rows.length} Setup row{rows.length === 1 ? '' : 's'}
              </button>
              {applied && <span className={styles.floorApplied}>{applied}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SetupFeeFloorPanel;
