// Frameworks Dan has flagged on Sites > Corporate Compliance, read back for
// the company pop-up's Frameworks field. Today that is CA SB: a company
// whose SB 253 or SB 261 row is answered Applies? = Yes on its compliance
// card is one California's climate disclosure laws catch, whether or not
// it turns up on the CA SB list on the Lists page.
//
// What counts is what the card shows: a saved answer
// (settings.corporateComplianceScreening) or, failing that, the dashed Yes
// the card derived from revenue and California sites, which the card
// publishes to settings.corporateComplianceShown. Both are keyed by the
// company's screening key, so any of the company's names (its own, the
// name it goes by, its aliases) can carry the answer.
import { companyScreeningKey } from '../data/corporateComplianceScreening.js';

export const COMPLIANCE_FRAMEWORK_RULES = [
  { label: 'CA SB', answerKeys: ['california__sb-253', 'california__sb-261'] },
];

export function complianceFlaggedFrameworks(names, screening, shown) {
  const out = new Set();
  const saved = screening && typeof screening === 'object' ? screening : {};
  const derived = shown && typeof shown === 'object' ? shown : {};
  const keys = new Set((names || []).map(n => companyScreeningKey(n)).filter(Boolean));
  for (const key of keys) {
    const answers = saved[key] && typeof saved[key] === 'object' ? saved[key] : {};
    const fallback = derived[key] && typeof derived[key] === 'object' ? derived[key] : {};
    for (const rule of COMPLIANCE_FRAMEWORK_RULES) {
      // A saved answer overrides the derived one, so a hand-picked No
      // beats a derived Yes.
      if (rule.answerKeys.some(k => (answers[k] || fallback[k]) === 'Yes')) out.add(rule.label);
    }
  }
  return out;
}
