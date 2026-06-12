// Close-out rules for Not Sold opps: (Competition, Reason Not Sold) →
// the BFO Status + Reason the AI assistant selects when closing the
// opp out in BFO. Shared by the Agents tab's Close Not Solds prompt
// (status/reason per row) and the Opps 2 Not Sold popup (which offers
// only the Reason Not Sold options valid for the chosen Competition).
//
// Combinations absent from the table are unmapped: the Agents tab
// surfaces them (highlighted) instead of guessing, and the popup
// won't offer them. Competition "N/A" (and blank) has no rules, so
// the popup falls back to the full reason list and the Agents row
// shows as unmapped until the user fills Competition in.
//
// Keys are normalized via normKey (lower-case, trimmed, apostrophes
// stripped) so "Customer Didn't Have Enough Pain", curly-quote
// variants, and "Customer didnt have enough pain" all match.

function normKey(s) {
  return String(s || '').trim().toLowerCase().replace(/['‘’]/g, '');
}

const LOST_RULES = {
  'current service delivery issues': { status: 'Lost', reason: 'Relationship Issue with SE' },
  'customer didnt have enough pain': { status: 'Lost', reason: 'No acceptable Offer from SE' },
  'ghosted - no response': { status: 'Lost', reason: 'Relationship Issue with SE' },
  'price pain': { status: 'Lost', reason: 'Pricing issue' },
  'software or service doesnt meet need': { status: 'Lost', reason: 'No acceptable Offer from SE' },
};

export const CLOSE_NOT_SOLD_RULES = {
  // Competitive deals (with or without an RFP) close out as Lost.
  'competitive non rfp': LOST_RULES,
  'rfp': LOST_RULES,
  // No competition — the deal was cancelled, never lost to anyone.
  'only se': {
    'cancelled internally - no opp': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
    'cancelled internally - not in targets': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
    'current service delivery issues': { status: 'Cancelled by Customer', reason: 'Relationship Issue with SE' },
    'customer didnt have enough pain': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
    'duplicate opp': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
    'free service': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
    'ghosted - no response': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
    'never connected': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
    'price pain': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
    'software or service doesnt meet need': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
    'unknown': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
  },
};

// BFO { status, reason } for a (Competition, Reason Not Sold) pair, or
// null when the combination isn't mapped.
export function lookupCloseNotSold(competition, reasonNotSold) {
  const byReason = CLOSE_NOT_SOLD_RULES[normKey(competition)];
  return byReason?.[normKey(reasonNotSold)] || null;
}

// The subset of `reasonOptions` that's valid for the given Competition.
// Competitions with no rules (blank, "N/A", custom values) keep the
// full list so the popup never paints the user into a corner.
export function reasonOptionsForCompetition(competition, reasonOptions) {
  const byReason = CLOSE_NOT_SOLD_RULES[normKey(competition)];
  if (!byReason) return reasonOptions;
  return (reasonOptions || []).filter(o => byReason[normKey(o)]);
}
