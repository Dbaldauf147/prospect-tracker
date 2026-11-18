// The draft uses {companyGoesBy}, and some recipients' companies have no
// Goes By on their company card. The send still reads fine (it falls back
// to the full company name), so this is not a blank the Variable Coverage
// counts would catch: "Price Waterhouse Coopers (PWC)" lands where "PwC"
// was meant. This lists those companies so the composer can warn.
//
//   contacts   the selected recipients ({ company })
//   goesByOf   company name -> the Goes By on its card, '' when unset
//              (NOT the name fallback the send uses)
//
// Returns one entry per company, most recipients first:
//   [{ company, recipients }]
// Recipients with no company at all are left out: there is no card to
// fill in, and {companyGoesBy} resolving blank for them is already a
// Variable Coverage gap.
export function companyGoesByGaps(contacts, goesByOf) {
  const byKey = new Map();
  for (const c of (Array.isArray(contacts) ? contacts : [])) {
    const company = String(c?.company || '').trim();
    if (!company) continue;
    if (String(goesByOf(company) || '').trim()) continue;
    const key = company.toLowerCase();
    const hit = byKey.get(key);
    if (hit) hit.recipients += 1;
    else byKey.set(key, { company, recipients: 1 });
  }
  return [...byKey.values()].sort((a, b) =>
    (b.recipients - a.recipients) || a.company.localeCompare(b.company));
}
