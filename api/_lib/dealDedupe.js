// Is this the same deal as that one, when two outlets word it differently?
//
// An exact "target|date" key let one deal through twice in a single
// digest: "Stake in BMG Unit" and "stake in BMG music rights", same day,
// same $1.25B. What identifies a deal is the distinctive name in its target
// (BMG), not the words wrapped around it (stake, unit, music rights), and
// the date can drift by a few days between the announcement and the
// outlets that pick it up late.

// Words that describe what was bought rather than name it.
const FILLER = new Set([
  'a', 'an', 'the', 'of', 'in', 'and', 'for', 'to', 'its', 'from', 'with',
  'stake', 'stakes', 'majority', 'minority', 'controlling', 'interest', 'interests',
  'unit', 'units', 'business', 'businesses', 'division', 'divisions', 'arm', 'segment',
  'assets', 'asset', 'portfolio', 'operations', 'rights', 'music', 'catalog', 'catalogue',
  'company', 'companies', 'group', 'holdings', 'holding', 'inc', 'llc', 'ltd', 'corp',
  'corporation', 'plc', 'co', 'sa', 'ag', 'gmbh', 'deal', 'platform', 'brand', 'brands',
  'remaining', 'additional', 'part', 'parts', 'share', 'shares', 'owner', 'maker',
]);

// How far apart two reports of one deal can be dated.
export const SAME_DEAL_DAYS = 7;

export function dealTokens(target) {
  return String(target || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 2 && !/^\d+$/.test(w) && !FILLER.has(w));
}

function dayGap(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b ? 0 : Infinity;
  return Math.abs(ta - tb) / 86400000;
}

// Two targets, each with a date (YYYY-MM-DD). Same deal when they are
// within SAME_DEAL_DAYS of each other and share at least two thirds of the
// shorter one's distinctive words - all of them when it has one or two, so
// "Acme Logistics" and "Beta Logistics" stay two deals. A target with no distinctive words
// ("a stake") only matches its exact self.
export function sameDeal(a, b) {
  // Buying a company and selling it are two deals, however alike the name.
  if ((a?.kind || 'Acquisition') !== (b?.kind || 'Acquisition')) return false;
  if (dayGap(a?.date, b?.date) > SAME_DEAL_DAYS) return false;
  const ta = new Set(dealTokens(a?.target));
  const tb = new Set(dealTokens(b?.target));
  if (ta.size === 0 || tb.size === 0) {
    return String(a?.target || '').trim().toLowerCase() === String(b?.target || '').trim().toLowerCase();
  }
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let shared = 0;
  for (const w of small) if (big.has(w)) shared += 1;
  return shared > 0 && shared * 3 >= small.size * 2;
}

// Fold duplicate deals together, keeping the first of each and filling any
// field it left empty (a value, a sector) from the later reports.
export function dedupeDeals(deals) {
  const out = [];
  for (const d of deals || []) {
    const hit = out.find(o => sameDeal({ target: o.target, date: o.announcedOn, kind: o.kind }, { target: d.target, date: d.announcedOn, kind: d.kind }));
    if (!hit) { out.push({ ...d }); continue; }
    for (const k of ['value', 'sector', 'sites', 'dealType', 'counterparty']) {
      if (!hit[k] && d[k]) hit[k] = d[k];
    }
  }
  return out;
}
