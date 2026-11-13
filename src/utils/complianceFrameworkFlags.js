// Frameworks Dan has flagged on Sites > Corporate Compliance, read back for
// the company pop-up's Frameworks field. Today that is CA SB: a company
// whose SB 253 or SB 261 row is answered Applies? = Yes on its compliance
// card is one California's climate disclosure laws catch, whether or not
// it turns up on the CA SB list on the Lists page.
//
// Only a saved answer counts, not the card's auto-derived verdict: the
// point is "Dan flagged it", and a dashed derived Yes is the page's guess.
// Answers live under settings.corporateComplianceScreening, keyed by the
// company's screening key, so any of the company's names (its own, the
// name it goes by, its aliases) can carry the answer.
import { companyScreeningKey } from '../data/corporateComplianceScreening.js';

export const COMPLIANCE_FRAMEWORK_RULES = [
  { label: 'CA SB', answerKeys: ['california__sb-253', 'california__sb-261'] },
];

export function complianceFlaggedFrameworks(names, screening) {
  const out = new Set();
  if (!screening || typeof screening !== 'object') return out;
  const keys = new Set((names || []).map(n => companyScreeningKey(n)).filter(Boolean));
  for (const key of keys) {
    const answers = screening[key];
    if (!answers || typeof answers !== 'object') continue;
    for (const rule of COMPLIANCE_FRAMEWORK_RULES) {
      if (rule.answerKeys.some(k => answers[k] === 'Yes')) out.add(rule.label);
    }
  }
  return out;
}
