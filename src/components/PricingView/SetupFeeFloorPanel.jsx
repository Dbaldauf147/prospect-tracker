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
// One rule sets the floor: total Year 1 fees must stay at or above total Year 1
// cost, tech depreciation included. The cut stops when that headroom runs out,
// or when the Setup fees reach $0 — on a deal whose recurring stream already
// pays for the year, the Setup fee really can go all the way, and the panel
// says so rather than inventing a limit. Where the floor takes the Setup work
// under what it costs to deliver, that is called out as context, not enforced.
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
    reducibleFloor,
  } = result;
  const pctOff = setupY1Revenue > 0 ? (maxReduction / setupY1Revenue) * 100 : 0;
  const canApply = !!onApply && (status === 'ok' || status === 'zero-floor') && maxReduction > 0;
  const belowCost = result.belowSetupCostBy > 0;

  return (
    <div className={styles.floorWrap}>
      <button
        type="button"
        className={styles.floorBtn}
        aria-expanded={open}
        onClick={() => { setOpen(o => !o); setApplied(''); }}
        title="Solve for the lowest Setup fees that still keep total Year 1 fees at or above total Year 1 cost (incl. tech depreciation). Cost, recurring fees and one-time fees are held as they are."
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
            {status === 'zero-floor' && (
              <>
                The rest of the deal already pays for Year 1: Setup fees can go all the way to
                {' '}<strong>$0</strong> — all {fmtMoney(setupY1Revenue)} of them — and Year 1 fees
                still clear Year 1 cost by <strong>{fmtMoney(result.resultingCashFlow)}</strong>.
              </>
            )}
            {status === 'ok' && (maxReduction > 0 ? (
              <>
                Setup fees can come down by <strong>{fmtMoney(maxReduction)}</strong>
                {' '}(<strong>{pctOff.toFixed(1)}%</strong> off) — from {fmtMoney(setupY1Revenue)} to
                {' '}<strong>{fmtMoney(floorSetupY1Revenue)}</strong> — before total Year 1 fees drop
                below total Year 1 cost (incl. tech depreciation).
              </>
            ) : (
              <>
                Setup fees are already at the floor: Year 1 fees clear Year 1 cost by exactly{' '}
                <strong>{fmtMoney(currentCashFlow)}</strong>, so a dollar off any Setup fee puts the
                year under its own cost.
              </>
            ))}
          </div>

          <div className={styles.floorMath}>
            Year 1 revenue {fmtWhole(result.currentY1Revenue)} − cost {fmtWhole(y1Cost)} ={' '}
            <span className={currentCashFlow < 0 ? styles.floorNeg : styles.floorPos}>
              {fmtWhole(currentCashFlow)}
            </span>
            {currentCashFlow < 0 ? ' short.' : ' of headroom.'}
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
              {' '}keeps Year 1 covered just as well.
            </div>
          )}

          {(status === 'ok' || status === 'zero-floor') && maxReduction > 0 && (
            <div className={styles.floorNote}>
              {status === 'zero-floor'
                ? <>Even at $0 the year covers its own cost, so nothing here stops the cut —
                  the recurring stream is carrying it.</>
                : <>At the floor Year 1 fees cover Year 1 cost and nothing more.</>}
              {belowCost && (
                <> That bills the Setup work {fmtMoney(result.belowSetupCostBy)} under what Setup
                itself costs to deliver ({fmtMoney(reducibleFloor)} incl. tech depreciation) — the
                year carries it, that line does not.</>
              )}
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
