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

// Issue: a company on My Accounts with the same empty Targets tab, so the
// rows follow that page's list rather than a rule of their own.
//
// MyAccountsView publishes one { kind: 'noTargets' } record per active
// account with nothing on its Targets tab to the my-accounts:flags store
// (utils/myAccountsFlagsStore), beside its tier / status / HQ Region
// flags. That snapshot is only rewritten while My Accounts is open, so
// each record is checked against the live company here: one whose targets
// have since been logged, that has gone inactive (Old Client, Hold Off,
// Lost - Not Sold) or that no longer exists is dropped. A company that
// joined My Accounts since the page was last opened shows up on the next
// visit there.
//
// `skipIds` holds the companies a clients' or Key Contacts row already
// lists, so a company shows once. Cleared the same way as those rows,
// through the same popup.
export function myAccountsNoTargetIssues({ myAccountsFlags, prospects, skipIds }) {
  const list = prospects || [];
  const canValidate = list.length > 0;
  const byId = new Map(list.map(p => [String(p.id), p]));
  const seen = new Set();
  const issues = [];
  for (const f of myAccountsFlags || []) {
    if (!f || !f.id || f.kind !== 'noTargets') continue;
    const id = String(f.id);
    if (seen.has(id) || skipIds?.has(id)) continue;
    const live = byId.get(id);
    if (canValidate && !live) continue;
    if (live && (hasTargetValues(live.climateTargets) || isClosedStatus(live.status))) continue;
    seen.add(id);
    issues.push({
      id: `my-accounts-no-targets:${id}`,
      source: 'My Accounts',
      type: 'No targets',
      company: (live && live.company) || f.company || '-',
      prospectId: live ? live.id : f.id,
      daysUntil: null,
      expirationDate: null,
      resolve: { kind: 'noTargets' },
      detail: 'Nothing on the Targets tab of the company popup: add its sustainability targets, or log "No Target Set" if it has none',
    });
  }
  issues.sort((a, b) => a.company.localeCompare(b.company, undefined, { sensitivity: 'base' }));
  return issues;
}
