// Contacts on one roster that share exactly the same name: almost always
// the same person entered twice (once from HubSpot, once from a paste or a
// ZoomInfo pull), which splits their email history across two records.
//
// "Exactly" is the name as a person reads it: case and stray spacing don't
// make two names different, anything else does. "Liz Randall" beside
// "Elizabeth Randall" is a guess, and this is a warning that has to be
// right to be worth reading, so it stays out.

export function contactNameKey(c) {
  return `${c?.firstname || ''} ${c?.lastname || ''}`
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// [{ key, name, contacts }] for every name two or more contacts share, in
// roster order. A contact with only a first or only a last name is left
// out: "John" twice is two people far more often than one.
export function duplicateNameGroups(contacts) {
  const byKey = new Map();
  for (const c of contacts || []) {
    if (!String(c?.firstname || '').trim() || !String(c?.lastname || '').trim()) continue;
    const key = contactNameKey(c);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
  }
  const groups = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const first = list[0];
    groups.push({
      key,
      name: `${first.firstname || ''} ${first.lastname || ''}`.replace(/\s+/g, ' ').trim(),
      contacts: list,
    });
  }
  return groups;
}

// name key -> how many contacts carry it, for the ones that repeat.
export function duplicateNameCounts(contacts) {
  const counts = new Map();
  for (const g of duplicateNameGroups(contacts)) counts.set(g.key, g.contacts.length);
  return counts;
}
