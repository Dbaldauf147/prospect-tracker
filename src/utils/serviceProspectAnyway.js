// "Prospect anyway": a service the company card shows as Not Sold that Dan
// still wants to prospect for. Set with the Prospect button on the card's
// Services grid (it only shows while the service reads Not Sold) and stored
// on the company record as serviceProspectAnyway = { [serviceName]: true }.
//
// A flagged Not Sold service counts as still open: accountPotential's
// serviceDecision leaves it undecided, so it can be the card's Biggest Deal
// and the Prospecting lists keep the company on them. The status itself is
// untouched, and the flag means nothing once the status is anything else.
//
// Pure: scripts/serviceProspectAnyway.test.mjs runs it under plain Node.

export const PROSPECT_ANYWAY_FIELD = 'serviceProspectAnyway';
export const NOT_SOLD_STATUS = 'Not Sold';

/** Whether `name` is flagged on this company (whatever its status). */
export function isProspectAnyway(client, name) {
  const map = client?.[PROSPECT_ANYWAY_FIELD];
  return !!(map && typeof map === 'object' && map[name]);
}

/** Whether the flag is in force: flagged AND the status reads Not Sold. */
export function prospectsAnyway(client, name, status) {
  return String(status ?? '').trim() === NOT_SOLD_STATUS && isProspectAnyway(client, name);
}

/** The flag map with `name` switched on or off (the key removed when off). */
export function withProspectAnyway(map, name, on) {
  const next = { ...(map && typeof map === 'object' && !Array.isArray(map) ? map : {}) };
  if (on) next[name] = true; else delete next[name];
  return next;
}
