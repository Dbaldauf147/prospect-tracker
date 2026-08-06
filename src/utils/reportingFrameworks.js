// The three disclosure regimes a sustainability programme is read against:
// has this company actually reported under CSRD, IFRS (ISSB S1/S2) or TCFD?
//
// Kept apart from the wider Frameworks list because these three answer one
// question — "do they already disclose, and under what" — which is the
// context both the company card's Sustainability Targets and the Corporate
// Compliance screener need alongside the targets themselves. A target with
// no disclosure behind it is a different conversation from one filed in an
// audited report, and neither page could tell them apart before.
//
// Two boards read this, so the rule lives here rather than in a copy each.

export const REPORTING_FRAMEWORKS = ['CSRD', 'IFRS', 'TCFD'];

// Long names for the hover — the acronyms are not self-explanatory to
// everyone who opens these pages.
export const REPORTING_FRAMEWORK_NAMES = {
  CSRD: 'Corporate Sustainability Reporting Directive (EU)',
  IFRS: 'IFRS Sustainability Disclosure Standards (ISSB S1 / S2)',
  TCFD: 'Task Force on Climate-related Financial Disclosures',
};

// Reporting status for each of the three, from whatever the caller knows
// about the company's frameworks.
//
// `frameworks` is the company record's own list — manual picks plus
// anything the sustainability research added. `listMatched` is the set of
// labels a *confirmed* Lists-page mapping supplies, which is how the
// company card's "Auto" provenance works; passing it keeps the screener
// agreeing with the card instead of quietly reporting less.
//
// Blank / absent means "not reported" rather than "unknown": these are
// public disclosures, so the absence of a record is itself the answer most
// of the time, and an explicit "Not reported" is what makes the row worth
// reading at a glance.
export function reportingStatus(frameworks, listMatched) {
  const have = new Set(
    (Array.isArray(frameworks) ? frameworks : [])
      .map(f => String(f || '').trim())
      .filter(Boolean),
  );
  for (const f of listMatched || []) {
    const v = String(f || '').trim();
    if (v) have.add(v);
  }
  return REPORTING_FRAMEWORKS.map(label => ({
    label,
    reported: have.has(label),
    name: REPORTING_FRAMEWORK_NAMES[label] || label,
  }));
}

// Chip palette. Reported reads green (it is a fact on the record);
// not-reported stays muted rather than red — not disclosing is not a
// failure state, it is just the other answer.
export const REPORTED_COLORS = { bg: '#DCFCE7', border: '#86EFAC', text: '#166534' };
export const NOT_REPORTED_COLORS = { bg: '#F1F5F9', border: '#E2E8F0', text: '#64748B' };
