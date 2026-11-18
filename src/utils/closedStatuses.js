// Statuses that mean there is nothing to prospect: the account has said no,
// been parked, or already been a client and moved on. Shared by the
// Prospecting page's subtabs (utils/prospectingPortfolio) and the Issues
// tab's prospect "No targets" rows (utils/clientNoTargets). No imports, so
// either can load it under plain Node.
export const CLOSED_STATUSES = ['Old Client', 'Lost - Not Sold', 'Hold Off'];
const CLOSED_SET = new Set(CLOSED_STATUSES.map(s => s.toLowerCase()));
export function isClosedStatus(status) {
  return CLOSED_SET.has(String(status || '').trim().toLowerCase());
}
