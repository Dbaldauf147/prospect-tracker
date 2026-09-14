// The Top PC of every firm on step 6 of the Prospecting ladder.
//
// The step lists PE relationships with nothing in flight, and the call it
// asks for is "who on your portfolio should I be talking to". Naming the
// firm and counting its companies stops one question short of that, so
// each row carries the same pick the PE Portfolio table's Top PC column
// shows: the highest Opportunity Score among the North America-based
// portfolio companies that haven't already been settled.
//
// It is the same function behind both, deliberately - a name that differed
// between the two pages would be worse than no name at all, since the user
// works from one and checks the other.
//
// Two things are worth saying about what this DOESN'T do:
//
//   1. No "current" pick. The PE Portfolio column hands a company with a
//      live opp the top spot outright (its LIVE marker). That can never
//      happen here: an open opp anywhere across a firm and its portfolio
//      is exactly what takes the firm off this list, so every pick below
//      is the scored one.
//   2. It reads the firm's own mapped Portfolio Companies list, not the
//      prospects that name it as their PE Owner. Same source the PE
//      Portfolio column scores, and for the same reason: the score needs
//      the energy, site count and sector that only a mapped row carries.
//      A firm whose portfolio lives entirely in PE Owner fields has a PC
//      count and no Top PC, and `mapped: 0` is what lets the row say which
//      of the two it is.
//
// Kept out of collectPeFirmsToWork (and so out of the ladder hook) on
// purpose: the ladder is computed in App for the sidebar's dot, where it
// only needs the COUNT of these firms, and scoring every portfolio to get
// it would pull the workbook's scoring module into the eager bundle for a
// number that doesn't use it. This runs on the Prospecting page instead,
// which is lazy and is the only place the names are shown.

import {
  buildProspectPcIndex,
  buildStatusIndex,
  lookupProspectByPc,
  pickTopPortfolioCompany,
} from './topPortfolioCompany.js';

// How a row is looked up in the returned map. The firm's record id when it
// has one, its name otherwise - the same key the list renders rows under,
// so a firm with no id still finds its own pick rather than nobody's.
export function peFirmTopPcKey(row) {
  return row?.firmId || row?.firm || '';
}

/**
 * Row key -> { top, mapped, prospect } for every firm handed in.
 *
 *   top      : the pick from pickTopPortfolioCompany, or null when the firm
 *              has nothing mapped or nothing survives the filters
 *   mapped   : how many portfolio companies are on the firm's own list, so
 *              a missing pick can say whether it was the mapping or the
 *              filters that came up empty
 *   prospect : the tracker record behind the Top PC's name, when the
 *              company is tracked in its own right - what the name clicks
 *              through to, null when it isn't
 *
 * Returns null when the firms haven't loaded, matching collectPeFirmsToWork:
 * the caller can then tell "no Top PCs" from "not known yet".
 */
export function collectPeFirmTopPcs(rows, prospects) {
  if (!Array.isArray(rows)) return null;
  const list = Array.isArray(prospects) ? prospects : [];
  // Both indexes are built once over the whole book and shared across every
  // firm, the way the PE Portfolio table builds them - they are keyed by
  // company name, not by firm, so per-firm rebuilds would be the same work
  // repeated.
  const statusIndex = buildStatusIndex(list);
  const pcIndex = buildProspectPcIndex(list);
  const byId = new Map();
  for (const p of list) if (p?.id) byId.set(p.id, p);

  const out = new Map();
  for (const row of rows) {
    const firm = row?.firmId ? byId.get(row.firmId) : null;
    const mapped = Array.isArray(firm?.portfolioCompanies) ? firm.portfolioCompanies : [];
    const top = pickTopPortfolioCompany(mapped, statusIndex);
    out.set(peFirmTopPcKey(row), {
      top,
      mapped: mapped.length,
      prospect: top ? lookupProspectByPc(pcIndex, top.companyName) : null,
    });
  }
  return out;
}
