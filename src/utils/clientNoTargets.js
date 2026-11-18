// The Issues tab's "No targets" rows (utils/clientIssues computeIssues).
// Kept in its own file, free of the extensionless imports clientIssues
// carries, so scripts/noTargetsIssue.test.mjs can run it under plain Node.
import { matchesCdm } from './cdmMatch.js';
import { hasTargetValues } from './companyTargets.js';
import { isClosedStatus } from './closedStatuses.js';

// Issue: an active, tracked client whose company popup Targets tab is
// empty (no row with anything filled in, utils/companyTargets
// hasTargetValues). Same client set as "No expiration date". Logging the
// targets, or the tab's "No Target Set" row when it has none, clears it.
export function detectNoTargets({ prospects, cdmName, untrackedMap }) {
  const issues = [];
  for (const p of prospects || []) {
    if (!matchesCdm(p.cdm, cdmName)) continue;
    if (String(p?.status || '').trim().toLowerCase() !== 'client') continue;
    if (untrackedMap?.[String(p.company || '').trim().toLowerCase()]) continue;
    if (hasTargetValues(p.climateTargets)) continue;
    issues.push({
      id: `no-targets:${p.id}`,
      source: 'Clients',
      type: 'No targets',
      company: p.company || '-',
      prospectId: p.id,
      daysUntil: null,
      expirationDate: null,
      resolve: { kind: 'noTargets' },
      detail: 'Nothing on the Targets tab of the company popup: add its sustainability targets, or log "No Target Set" if it has none',
    });
  }
  return issues;
}

// Issue: one of your prospects with the same empty Targets tab. "Your
// prospects" are the Prospecting page's My Prospects (utils/
// prospectingPortfolio myProspectRows): a company whose CDM is you and
// whose status isn't closed (Old Client, Lost - Not Sold, Hold Off).
// Clients are left to detectNoTargets above, tracked or not, so a company
// never shows under both. Cleared the same way, through the same popup.
export function detectProspectNoTargets({ prospects, cdmName }) {
  const issues = [];
  for (const p of prospects || []) {
    if (!p?.company || !matchesCdm(p.cdm, cdmName)) continue;
    if (String(p.status || '').trim().toLowerCase() === 'client') continue;
    if (isClosedStatus(p.status)) continue;
    if (hasTargetValues(p.climateTargets)) continue;
    issues.push({
      id: `prospect-no-targets:${p.id}`,
      source: 'Prospects',
      type: 'No targets',
      company: p.company,
      prospectId: p.id,
      daysUntil: null,
      expirationDate: null,
      resolve: { kind: 'noTargets' },
      detail: 'Nothing on the Targets tab of the company popup: add its sustainability targets, or log "No Target Set" if it has none',
    });
  }
  issues.sort((a, b) => a.company.localeCompare(b.company, undefined, { sensitivity: 'base' }));
  return issues;
}
