// The order of a campaign's roster on Email Campaigns: the Not Sent rows
// (no sentDate) lead, whatever column the table is sorted by, because they
// are the ones still to do and on a long roster they used to be scattered
// through it. Within each group the column sort holds, then roster order.
//
// `list` is [{ c, i }] (contact, roster index); `valueOf(c)` gives the sort
// value for the chosen column, or pass null for no column sort. Returns a
// new array. Pure: scripts/campaignRosterOrder.test.mjs.
export function orderCampaignRoster(list, valueOf = null, dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  const group = (x) => (x.c?.sentDate ? 1 : 0);
  return (list || []).slice().sort((a, b) => {
    const g = group(a) - group(b);
    if (g) return g;
    if (valueOf) {
      const va = valueOf(a.c);
      const vb = valueOf(b.c);
      if (va < vb) return -1 * sign;
      if (va > vb) return 1 * sign;
    }
    return a.i - b.i;
  });
}
