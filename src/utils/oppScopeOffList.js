// Opps whose Scope (the services on the deal) names a service the Dropdowns
// tab's services list doesn't have. Feeds the Issues page's "Service not in
// Dropdowns" row; see detectOppScopeOffList in clientIssues.
import { splitServiceNames } from './serviceNameList.js';

// What an empty Scope cell is written as, not a service.
const SCOPE_PLACEHOLDERS = new Set(['-', '#n/a', 'n/a']);

// records        the Opps records ({ Scope, ... })
// knownServices  every service name the Dropdowns tab has; with none (not
//                loaded yet, or the list hidden) nothing is returned
// Returns [{ record, off }] for each opp with at least one unmatched name,
// `off` the unmatched names as written, deduped case-insensitively.
export function oppScopeOffList(records, knownServices) {
  if (!Array.isArray(knownServices) || knownServices.length === 0) return [];
  const known = new Set(knownServices.map(s => String(s ?? '').trim().toLowerCase()).filter(Boolean));
  const out = [];
  for (const record of records || []) {
    const off = [];
    for (const name of splitServiceNames(record?.Scope, knownServices)) {
      const k = name.trim().toLowerCase();
      if (!k || SCOPE_PLACEHOLDERS.has(k) || known.has(k)) continue;
      if (!off.some(x => x.toLowerCase() === k)) off.push(name.trim());
    }
    if (off.length > 0) out.push({ record, off });
  }
  return out;
}
