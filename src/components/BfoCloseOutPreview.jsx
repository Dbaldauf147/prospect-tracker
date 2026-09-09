// What BFO will be set to, said before the close-out is saved.
//
// Closing an opp out in BFO is not a free choice: the (Competition,
// Reason Not Sold) pair decides the BFO Status and Reason outright, by the
// table in data/closeNotSoldRules. The person filling those two fields in
// is the person who wants to know what they just decided — and until now
// only the Issues tab's editor told them, at the point where the pair had
// already gone wrong. Everywhere the pair is set, this says what it means.
//
// Read straight off lookupCloseNotSold, so what this promises and what the
// AI assistant actually enters in BFO cannot disagree.
//
// `hint` is an optional trailing clause for the caller's own context —
// what an unmapped pair costs *here* ("the opp stays on this list") —
// which differs per screen in a way the shared fact does not. `mappedHint`
// is the same thing for a clause that only parses once there is a pair to
// refer to: "the assistant enters THOSE" is a sentence about nothing when
// nothing mapped.

import { lookupCloseNotSold, hasCloseNotSoldRules } from '../data/closeNotSoldRules';

export function BfoCloseOutPreview({ competition, reason, hint = null, mappedHint = null, style = null }) {
  const comp = String(competition || '').trim();
  const rsn = String(reason || '').trim();
  const mapped = lookupCloseNotSold(comp, rsn);
  const compHasRules = hasCloseNotSoldRules(comp);

  // Green only for a pair that resolves. Amber is "nothing will be set",
  // which is worth looking at whether the cause is a blank field or a
  // combination the table doesn't cover.
  const body = mapped
    ? (
      <>
        Closes out in BFO as Status <strong>{mapped.status}</strong>
        {' '}&middot; Reason <strong>{mapped.reason}</strong>.
      </>
    )
    : !comp
      ? <>Set <strong>Competition</strong> — with Reason Not Sold it decides the BFO Status and Reason.</>
      : !compHasRules
        ? <>No Reason Not Sold maps under <strong>{comp}</strong>, so there is no BFO Status or Reason to set.</>
        : !rsn
          ? <>Pick a <strong>Reason Not Sold</strong> — under <strong>{comp}</strong> each one maps to a BFO Status and Reason.</>
          // A pair that is filled in and still doesn't map. Names both
          // halves: which one is wrong is the user's call, and the table
          // has no opinion on it.
          : <><strong>{rsn}</strong> has no rule under <strong>{comp}</strong>, so BFO can't be set from this pair.</>;

  return (
    <div style={{
      fontSize: '0.72rem', lineHeight: 1.5, borderRadius: 4, padding: '0.5rem 0.6rem',
      background: mapped ? '#ECFDF5' : '#FEF3C7',
      color: mapped ? '#065F46' : '#92400E',
      ...style,
    }}>
      {body}
      {mapped && mappedHint ? <> {mappedHint}</> : null}
      {hint ? <> {hint}</> : null}
    </div>
  );
}
