// Single source of truth for the "Close Not Solds" flow — the Not-Sold
// Opps rows that still have a matching BFO Activity row and therefore
// need closing out in BFO, plus the "what's still missing" check that
// drives both the highlighted rows on the Agents page and the matching
// rows on the Issues page.
//
// Kept here (rather than inline in AgentsView) so the Agents table and
// the Issues tab always agree on which rows are incomplete — there's one
// definition, not two that can drift apart.

// Extension spelled out so this module loads under plain Node too — the
// tests in scripts/ run without Vite's resolver.
import { lookupCloseNotSold } from '../data/closeNotSoldRules.js';

// Comparison key for a BFO Opportunity Name — trimmed, lower-cased,
// internal whitespace collapsed, so a stray double space in either the
// BFO Link or the Opportunity Name doesn't drop the match.
function normalizeName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// The Opps sheet keeps the Salesforce / Lightning URL in the
// "BFO Address" column. Fall back to scanning every field if that one
// happens to be empty so older rows still surface a link when possible.
export function detectBfoUrl(rawOpp) {
  if (!rawOpp) return '';
  const direct = String(rawOpp['BFO Address'] || '').trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  for (const v of Object.values(rawOpp)) {
    if (typeof v !== 'string' || !v) continue;
    const m = v.match(/https?:\/\/\S+/i);
    if (m) return m[0];
  }
  return '';
}

/**
 * The opp record an Activity row should link to.
 *
 * Every Activity row — an email, a HubSpot meeting, a Granola call —
 * lands on an opp the same two ways: the user picked one with the inline
 * picker (the override), or the page matched one by recipient / company.
 * The picked one wins.
 *
 * The second step is the one worth having in a shared function. A BFO
 * Opportunity Name can appear on more than one Opps row, and only some of
 * them carry the BFO Address — so resolving the name to the FIRST record
 * that matches can hand back a duplicate with no address, and the row
 * loses its link even though the opportunity has one. Prefer a record
 * that actually has an address.
 *
 *   oppIndex        { byBfoOpp, allOpps } from the Agents page
 *   overrideBfoOpp  the BFO Opportunity Name the user picked, if any
 *   matchedOpp      the opp the page matched on its own, if any
 */
export function resolveOppForRow(oppIndex, overrideBfoOpp, matchedOpp) {
  const picked = String(overrideBfoOpp || '').trim();
  let opp = picked
    ? oppIndex?.byBfoOpp?.get(picked.toLowerCase()) || null
    : matchedOpp || null;

  const name = picked || opp?.bfoOpp || '';
  if (name && !detectBfoUrl(opp?.raw)) {
    const key = name.toLowerCase();
    const withUrl = (oppIndex?.allOpps || []).find(
      o => o.bfoOpp && o.bfoOpp.toLowerCase() === key && detectBfoUrl(o.raw),
    );
    if (withUrl) opp = withUrl;
  }
  return opp || null;
}

// Blank / placeholder markers Opps uses for "no value yet".
function isPlaceholder(v) {
  const s = String(v ?? '').trim();
  return s === '' || s === '-' || s === '#N/A';
}

/**
 * The BFO Activity column carrying the BFO Opportunity Name.
 *
 * Prefer the exact header BFO's printable view emits. A paste can also
 * carry near-misses — a "Local Opportunity Name" column, or the
 * "Opportunity Name (2)" that parseTSV renames a duplicate to — and
 * taking the first loose match lets one of those win purely by sorting
 * earlier. That indexes a column of blanks, which is indistinguishable
 * from having no BFO data at all.
 */
function findOppNameColumn(headers) {
  const list = headers || [];
  return list.find(h => /^opportunity\s*name$/i.test(String(h || '').trim()))
    || list.find(h => /opportunity\s*name/i.test(String(h || '')))
    || '';
}

/**
 * Normalized BFO Opportunity Name → its BFO Activity row, over the rows
 * pasted on the BFO Activity tab. Empty in the three cases that all mean
 * the same thing — no paste, no Opportunity Name column in it, or no
 * names in that column — so one size check covers all of them.
 */
export function bfoOppNameIndex(bfoActivity) {
  const index = new Map();
  const oppCol = findOppNameColumn(bfoActivity?.headers);
  if (!oppCol) return index;
  for (const r of (bfoActivity?.rows || [])) {
    const k = normalizeName(r[oppCol]);
    if (k && !index.has(k)) index.set(k, r);
  }
  return index;
}

/**
 * Whether the pasted BFO Activity data can answer "is this opp still open
 * in BFO?" at all. False means an empty Close Not Solds list says nothing
 * about the opps — there was nothing to check them against — which is a
 * different message to the user than "none are still open".
 */
export function hasBfoOppNameIndex(bfoActivity) {
  return bfoOppNameIndex(bfoActivity).size > 0;
}

/**
 * Not-Sold opps that still have a corresponding BFO row open. Each pulls
 * its Reason Not Sold + Competition from Opps and maps the pair to the
 * Status + Reason values BFO expects when closing the opp out. Rows whose
 * combination isn't in the rules table fall through with `unmapped: true`
 * so the user can see them and either update the row or extend the table.
 *
 * Filter:
 *   • Stage is "Not Sold"
 *   • "BFO Link" is set (not blank / "-" / "#N/A")
 *   • the BFO Opportunity Name is still on the BFO Activity paste
 *
 * A missing BFO Address isn't a gate: the row still surfaces (with an
 * empty `bfoUrl`) so the user can patch the Opps row.
 *
 * Returns nothing at all when the BFO Activity paste can't answer the
 * third question — see hasBfoOppNameIndex.
 */
export function computeCloseNotSoldOpps({ oppsCache, bfoActivity }) {
  const records = oppsCache?.records || [];
  if (!records.length) return [];
  // Index BFO Activity by opportunity name so we can quickly check
  // whether an Opps row has a corresponding open BFO opp.
  const bfoByName = bfoOppNameIndex(bfoActivity);
  // Nothing to check against — fail closed. Every row this returns
  // asserts "Not Sold on Opps but STILL OPEN in BFO", and with no BFO
  // rows in hand there is no evidence for the second half. An empty
  // index used to mean "no opinion", which let every Not-Sold opp
  // carrying a BFO Link through: a page whose paste hadn't loaded yet
  // (or whose paste had no Opportunity Name column) produced a full
  // list of opps to close out, most of them closed already. Callers
  // that want to explain the empty list ask hasBfoOppNameIndex.
  if (bfoByName.size === 0) return [];
  const rows = [];
  const seen = new Set();
  for (const r of records) {
    const stage = String(r.Stage || '').trim().toLowerCase();
    if (stage !== 'not sold') continue;
    const bfoOpp = String(r['BFO Link'] || '').trim();
    if (isPlaceholder(bfoOpp)) continue;
    const key = normalizeName(bfoOpp);
    if (seen.has(key)) continue;
    // Only surface opps that still exist on the BFO Activity tab — the
    // prompt is about closing them out in BFO, so a BFO row is required.
    if (!bfoByName.has(key)) continue;
    const bfoUrl = detectBfoUrl(r);
    const reasonNotSold = String(r['Reason Not Sold'] || '').trim();
    // Competition (set via the Sold / Not Sold close-out popups or
    // inline on Opps) is half of the mapping key AND feeds the
    // Competitor Name the AI enters on Lost opps. A blank / placeholder
    // Competition can't map, so the row surfaces as unmapped until the
    // user fills it in.
    const competitionRaw = String(r['Competition'] || '').trim();
    const competition = isPlaceholder(competitionRaw) ? '' : competitionRaw;
    const map = lookupCloseNotSold(competition, reasonNotSold);
    seen.add(key);
    rows.push({
      id: `${key}|${bfoUrl || bfoOpp}`,
      // The Opps record id, so a consumer can write Reason Not Sold /
      // Competition straight back to the row (the Issues tab's inline
      // editor does exactly that).
      oppId: r._id,
      name: bfoOpp,
      account: String(r.Account || '').trim(),
      reasonNotSold,
      status: map?.status || '',
      reason: map?.reason || '',
      competition,
      unmapped: !map,
      bfoUrl,
    });
  }
  rows.sort((a, b) => a.account.localeCompare(b.account));
  return rows;
}

/**
 * The data the Close Not Solds prompt needs but doesn't have — the same
 * cells the Agents table paints as "Missing". The prompt emits
 * "BFO Link\tStatus\tReason\tCompetition" per row, so a row is incomplete
 * when any of those is blank (Status + Reason are blank exactly when the
 * Reason Not Sold + Competition pair isn't in the mapping table).
 * Returns one entry per affected row, carrying the opp id + its current
 * Reason Not Sold / Competition so a consumer can offer an inline fix:
 * { id, oppId, name, account, reasonNotSold, competition, missing, unmapped }.
 */
export function computeCloseNotSoldMissingData(closeNotSoldOpps) {
  const out = [];
  for (const o of (closeNotSoldOpps || [])) {
    const missing = [];
    if (!o.account) missing.push('Account');
    if (!o.reasonNotSold) missing.push('Reason Not Sold');
    if (!o.competition) missing.push('Competition');
    // Status + Reason are derived, so report them as the one thing that's
    // actually wrong: no rule for this Reason Not Sold + Competition pair.
    if (o.unmapped) missing.push('Status + Reason (no mapping for this Reason Not Sold + Competition)');
    if (!o.bfoUrl) missing.push('BFO Address (link)');
    if (missing.length) {
      out.push({
        id: o.id,
        oppId: o.oppId,
        name: o.name,
        account: o.account,
        reasonNotSold: o.reasonNotSold,
        competition: o.competition,
        missing,
        unmapped: !!o.unmapped,
      });
    }
  }
  return out;
}
