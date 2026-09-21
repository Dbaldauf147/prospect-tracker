// Where an account stands on a service, as one reading.
//
// Three layers, in this order — the same order the company card and the
// Scope services board already use, and the one src/utils/serviceAutoNa.js
// documents:
//
//   manual status on the company card
//     > the stage of another opp on this account naming the service
//       > N/A implied by something the account has already bought
//
// The board owned this rule and nothing else could ask it, so the Deal Size
// estimate table — the other screen where you are looking at the same list
// of services for the same account — had no way to say whether a service on
// it was already sold, already lost, or never asked about. Both read it from
// here now, so the two boards cannot drift into disagreeing about the same
// account.
//
// Derived, never written: nothing in here saves a status anywhere. A status
// is stored only when somebody picks one, and that write is the caller's.
//
// Explicit .js extensions: pinned by a plain-Node test
// (scripts/scopeServiceStatus.test.mjs), which resolves the paths itself
// rather than through Vite.
import { companiesMatch } from './listFlags.js';
import { scopeTokens, scopeTokenMatchesService } from './scopeMatch.js';
import { collectAutoNa, isSoldStatus, autoNaTitle } from './serviceAutoNa.js';

// Which stage wins when several of an account's opps name the same service.
// Mirrors the company card's ordering: closed-won beats in-flight beats lost.
export const SERVICE_STAGE_PRIORITY = {
  'Sold': 4, 'Verbal': 3, 'Quoted': 3, 'Quoting': 2,
  'Qualifying': 2, 'Lead': 1, 'Not Started': 1, 'Not Sold': 0,
};

/**
 * The automatic status per service: the best stage among the account's opps
 * that name it. This is the fallback the company card shows when no manual
 * status has been set, so every board agrees on what "auto" means.
 *
 * `currentOppId` is excluded where the caller is looking at one opp's own
 * scope: counting it would echo the selection back as if it were history.
 */
export function buildAutoStatuses({ account, oppRows, items, currentOppId }) {
  const out = new Map();
  const name = String(account || '').trim();
  if (!name) return out;

  for (const row of oppRows || []) {
    if (currentOppId != null && row?._id === currentOppId) continue;
    if (!companiesMatch(row?.Account, name)) continue;
    const stage = String(row?.Stage || '').trim();
    if (!stage) continue;
    for (const token of scopeTokens(row?.Scope)) {
      for (const item of items) {
        if (!scopeTokenMatchesService(token, item)) continue;
        const existing = out.get(item);
        const pri = SERVICE_STAGE_PRIORITY[stage] ?? 1;
        const existingPri = existing ? (SERVICE_STAGE_PRIORITY[existing] ?? 1) : -1;
        if (pri > existingPri) out.set(item, stage);
      }
    }
  }
  return out;
}

// A manual status, looked up however the name happens to be spelled. Scope
// text is typed and the card's keys are the board's own spelling, so an
// exact-key lookup drops the status of a service written "bill payment" on
// one screen and "Bill Payment" on the other.
function manualLookup(manualStatuses) {
  const byLower = new Map();
  for (const [key, value] of Object.entries(manualStatuses || {})) {
    const k = String(key || '').trim().toLowerCase();
    if (!k) continue;
    byLower.set(k, value);
  }
  return (name) => {
    const v = byLower.get(String(name || '').trim().toLowerCase());
    const s = String(v ?? '').trim();
    return s && s !== '-' ? s : '';
  };
}

/**
 * Every service's standing on one account, as service name → reading.
 *
 * Each reading carries the layer it came from as well as the answer, so a
 * board can say WHY a service reads N/A rather than only that it does:
 *
 *   { status, manual, auto, autoNa, derived }
 *
 * `status` is the effective one ('' where nothing has an opinion), `manual`
 * / `auto` are the first two layers as they stand, `autoNa` is the sold
 * services that retire this one (null where none do), and `derived` marks a
 * status nobody picked — which is what a board paints in italic.
 *
 * `soldElsewhere` widens the auto-N/A layer past the services being asked
 * about: an account that bought the platform has it on its card whether or
 * not this deal's scope mentions it, and that sale is exactly what retires
 * the pieces underneath it.
 */
export function scopeServiceStatuses({
  services, account, oppRows, currentOppId, manualStatuses, serviceOverrides,
  soldElsewhere = true,
}) {
  const names = (services || []).map(s => String(s ?? '').trim()).filter(Boolean);
  const out = new Map();
  if (names.length === 0) return out;

  const manualFor = manualLookup(manualStatuses);
  const auto = buildAutoStatuses({ account, oppRows, items: names, currentOppId });

  // What this account has bought, for the auto-N/A layer. The card's own
  // sales count wherever they sit in the catalog, not just the ones this
  // scope happens to list.
  const sold = [];
  for (const name of names) {
    const m = manualFor(name);
    if (m ? isSoldStatus(m) : isSoldStatus(auto.get(name))) sold.push(name);
  }
  if (soldElsewhere) {
    for (const [key, value] of Object.entries(manualStatuses || {})) {
      const name = String(key || '').trim();
      if (!name || !isSoldStatus(value)) continue;
      if (!sold.some(s => s.toLowerCase() === name.toLowerCase())) sold.push(name);
    }
  }

  // Spell an Auto-N/A cell's target the way the services here are spelled,
  // so a name typed with different casing lands on the row rather than on
  // nothing.
  const byLower = new Map(names.map(n => [n.toLowerCase(), n]));
  const canonical = (name) => byLower.get(String(name || '').trim().toLowerCase()) || name;
  const autoNa = sold.length > 0
    ? collectAutoNa(sold, serviceOverrides, { canonical, names })
    : new Map();

  for (const name of names) {
    const manual = manualFor(name);
    const autoStage = auto.get(name) || '';
    const reasons = autoNa.get(name) || null;
    const naBySale = !manual && !autoStage && !!reasons?.length;
    const status = manual || autoStage || (naBySale ? 'N/A' : '');
    out.set(name, {
      status,
      manual,
      auto: autoStage,
      autoNa: naBySale ? reasons : null,
      derived: !manual && !!status,
    });
  }
  return out;
}

/**
 * The sentence a status control carries, so the same answer is explained the
 * same way on every board that shows it.
 *
 * `disabledReason` is what a read-only control says instead: with nowhere to
 * write a status, why it cannot be picked is more use than where the current
 * one came from.
 */
export function scopeStatusTitle({ item, manual, auto, autoNa, disabledReason = '' }) {
  if (disabledReason) return disabledReason;
  if (manual) {
    return `Manual override: ${manual}.${auto
      ? ` Automatic status from another opp: ${auto}.`
      : ' No matching opp, so the automatic status is blank.'} Pick "- (auto)" to revert.`;
  }
  if (auto) return `Automatic status from another opp on this account: ${auto}. Pick a status to set a manual override.`;
  if (autoNa?.length) return autoNaTitle(item, autoNa);
  return 'No status yet. Pick one to set it on the company card.';
}
