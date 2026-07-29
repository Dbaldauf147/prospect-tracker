// Carries a company rename through every Clients-view subtab. The Clients
// and Old Clients tabs read the prospect record directly, so they follow a
// rename for free — but several Clients surfaces key off the company-name
// string instead of the record id and would otherwise strand under the old
// name:
//
//   • Clients/Old Clients typed fields — Client Manager, Status, Notes,
//     In Person, Untracked, Louisville (clientManagerStore, keyed by name).
//   • Deal→client mappings whose target is the renamed client (dealClientMap).
//   • Deals subtab rows — the uploaded "Client Name" cell (dealsStore).
//   • Commissions subtab rows — the "Account Name" lookup (commissionsStore).
//
// Both a count (for the rename-confirmation summary) and an apply are exposed
// so the caller can show the user exactly what will move before doing it.

import { countClientFieldRenames, renameClientFields } from './clientManagerStore';
import { countDealClientRename, renameDealClient } from './dealClientMap';
import { countDealsClientRename, renameDealsClient } from './dealsStore';
import { countCommissionsClientRename, renameCommissionsClient } from './commissionsStore';

export function countClientsSubtabRename(oldName, newName) {
  return {
    fields: countClientFieldRenames(oldName, newName),
    dealMap: countDealClientRename(oldName, newName),
    deals: countDealsClientRename(oldName, newName),
    commissions: countCommissionsClientRename(oldName, newName),
  };
}

export function clientsSubtabRenameTotal(counts) {
  if (!counts) return 0;
  return (counts.fields || 0) + (counts.dealMap || 0) + (counts.deals || 0) + (counts.commissions || 0);
}

// Human-readable bullet lines for the rename confirmation prompt.
export function summarizeClientsSubtabRename(counts) {
  const lines = [];
  if (!counts) return lines;
  if (counts.deals) lines.push(`• ${counts.deals} Deals row${counts.deals === 1 ? '' : 's'} (Client Name)`);
  if (counts.commissions) lines.push(`• ${counts.commissions} Commissions row${counts.commissions === 1 ? '' : 's'} (Account Name)`);
  if (counts.fields) lines.push(`• ${counts.fields} Clients-tab field${counts.fields === 1 ? '' : 's'} (manager / status / notes…)`);
  if (counts.dealMap) lines.push(`• ${counts.dealMap} deal→client mapping${counts.dealMap === 1 ? '' : 's'}`);
  return lines;
}

export function applyClientsSubtabRename(oldName, newName) {
  renameClientFields(oldName, newName);
  renameDealClient(oldName, newName);
  renameDealsClient(oldName, newName);
  renameCommissionsClient(oldName, newName);
}
