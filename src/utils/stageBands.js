// The numbered BFO sales stages the pipeline columns roll up into, in
// board order. Two columns can share one stage — Qualifying and Quoting
// are both Stage 4, Quoted and Contracting both Stage 5 — so the
// Days-in-Stage board bands its columns rather than labelling each one,
// and the Opp details popup splits its numbered stage subtabs the same
// way. Not Started sits ahead of the numbered stages and carries no band
// label. `stages` between them must cover TRACKED_STAGES exactly, in the
// same order.
//
// Its own module rather than a daysInStage export so both the board and
// the details popup read one list: a stage that moves bands moves in both
// places at once.
export const STAGE_BANDS = [
  { label: '', name: '', stages: ['Not Started'] },
  { label: 'Stage 3', name: 'Qualify Opportunity', stages: ['Lead'] },
  { label: 'Stage 4', name: 'Influence and Develop', stages: ['Qualifying', 'Quoting'] },
  { label: 'Stage 5', name: 'Prepare & Bid', stages: ['Quoted', 'Contracting'] },
  { label: 'Stage 6', name: 'Negotiate to Win', stages: ['Agreement Sent'] },
];
