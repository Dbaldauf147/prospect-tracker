// Issue detection for the Issues tab. The Issues tab aggregates
// "outstanding items that need to be addressed" across the app; each
// detector below turns one class of problem into a flat issue row.
//
// The Clients-tab "Days Until" computation lives here so the Issues tab
// and the Clients tab agree on what's expired — there's one definition
// of soonest expiration, not two that can drift apart.
import { asDate, fmtDate } from './dealsFormat';
import { matchesCdm } from './cdmMatch';

const MS_PER_DAY = 86400000;

// The Paperwork column doubles as a status field — "Cancelled" / "Expired"
// mark agreements that no longer count regardless of their End Date.
const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'expired']);
export function isInactiveAgreement(deal) {
  const status = String(deal?.['Paperwork completed'] || '').trim().toLowerCase();
  return INACTIVE_STATUSES.has(status);
}

export function normClientName(s) {
  return String(s || '').trim().toLowerCase();
}

// Earliest contract End Date across the client's active deals, plus
// integer days from today (negative when the date is already past).
// Cancelled / Expired agreements are skipped; everything else counts
// regardless of whether the date is in the future.
export function soonestExpiration(deals) {
  if (!deals || deals.length === 0) return { date: null, days: null, deal: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  let bestMs = null;
  let bestDeal = null;
  for (const d of deals) {
    if (isInactiveAgreement(d)) continue;
    const parsed = asDate(d['End Date']);
    if (!parsed) continue;
    const dayStart = new Date(parsed);
    dayStart.setHours(0, 0, 0, 0);
    const ms = dayStart.getTime();
    if (bestMs == null || ms < bestMs) { bestMs = ms; bestDeal = d; }
  }
  if (bestMs == null) return { date: null, days: null, deal: null };
  return { date: new Date(bestMs), days: Math.round((bestMs - todayMs) / MS_PER_DAY), deal: bestDeal };
}

// Group deals by client, applying the user's source-name → client-name
// remapping (the helper column on the Deals subtab). Mirrors the
// grouping ClientsView uses so both tabs bucket contracts identically.
export function groupDealsByClient(dealsList, clientMap) {
  const map = new Map();
  for (const d of (dealsList || [])) {
    const raw = normClientName(d['Client Name']);
    if (!raw) continue;
    const mapped = clientMap?.[raw];
    const k = mapped ? normClientName(mapped) : raw;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(d);
  }
  return map;
}

function isClientStatus(p) {
  return String(p?.status || '').trim().toLowerCase() === 'client';
}

// Issue #1: a client whose soonest active contract End Date has already
// passed (negative Days Until) on the Clients tab. Untracked clients are
// skipped — the user has explicitly opted them out of expiration tracking,
// which is exactly why the Clients tab blanks their Days Until.
function detectNegativeDaysUntil({ prospects, cdmName, dealsByClient, untrackedMap }) {
  const issues = [];
  for (const p of prospects) {
    if (!matchesCdm(p.cdm, cdmName)) continue;
    if (!isClientStatus(p)) continue;
    const ck = normClientName(p.company);
    if (untrackedMap?.[ck]) continue;
    const next = soonestExpiration(dealsByClient.get(ck) || []);
    if (next.days == null || next.days >= 0) continue;
    const ago = Math.abs(next.days);
    issues.push({
      id: `neg-days:${p.id}`,
      source: 'Clients',
      type: 'Contract expired',
      company: p.company || '—',
      prospectId: p.id,
      daysUntil: next.days,
      expirationDate: next.date,
      detail: next.date
        ? `Soonest contract End Date (${fmtDate(next.date)}) passed ${ago} day${ago === 1 ? '' : 's'} ago`
        : `Soonest contract End Date passed ${ago} day${ago === 1 ? '' : 's'} ago`,
    });
  }
  return issues;
}

// A client whose soonest renewal falls inside this many days without a
// Status set is surfaced as an issue — mirrors the "needs a status" red
// row tint on the Clients tab (ClientsView's RENEWAL_WARNING_DAYS).
const RENEWAL_WARNING_DAYS = 270;

// A Clients-tab Status cell counts as "unset" when it's blank or just a
// dash placeholder. Matches the noStatus check in ClientsView.
function hasNoClientStatus(statusMap, clientKey) {
  const s = String(statusMap?.[clientKey] || '').trim();
  return s === '' || s === '-' || s === '—' || s === '–';
}

// Issue #4: a client whose soonest active contract renews within
// RENEWAL_WARNING_DAYS but has no Status set on the Clients tab — the same
// clients the Clients tab tints red. Already-expired contracts (negative
// Days Until) are left to the "Contract expired" detector so they aren't
// listed twice; this covers the upcoming-renewal window (0..270 days).
// Untracked clients are skipped, matching the Clients tab (blank Days Until).
function detectRenewalNoStatus({ prospects, cdmName, dealsByClient, untrackedMap, clientStatusMap }) {
  const issues = [];
  for (const p of prospects) {
    if (!matchesCdm(p.cdm, cdmName)) continue;
    if (!isClientStatus(p)) continue;
    const ck = normClientName(p.company);
    if (untrackedMap?.[ck]) continue;
    const next = soonestExpiration(dealsByClient.get(ck) || []);
    if (next.days == null || next.days < 0 || next.days >= RENEWAL_WARNING_DAYS) continue;
    if (!hasNoClientStatus(clientStatusMap, ck)) continue;
    issues.push({
      id: `renewal-no-status:${p.id}`,
      source: 'Clients',
      type: 'Renewal — no status',
      company: p.company || '—',
      prospectId: p.id,
      daysUntil: next.days,
      expirationDate: next.date,
      detail: next.date
        ? `Renews in ${next.days} day${next.days === 1 ? '' : 's'} (${fmtDate(next.date)}) with no Status set`
        : `Renews in ${next.days} day${next.days === 1 ? '' : 's'} with no Status set`,
    });
  }
  return issues;
}

// Issue: an active client (tracked) with NO soonest contract expiration
// date — no active deal carries a parseable End Date, so its renewal can't
// be tracked. Untracked ("Don't Track") clients are skipped, matching the
// Clients tab. Prompts the user to add a contract / End Date (or mark the
// client Don't Track).
function detectMissingExpiration({ prospects, cdmName, dealsByClient, untrackedMap }) {
  const issues = [];
  for (const p of prospects) {
    if (!matchesCdm(p.cdm, cdmName)) continue;
    if (!isClientStatus(p)) continue;
    const ck = normClientName(p.company);
    if (untrackedMap?.[ck]) continue;
    const next = soonestExpiration(dealsByClient.get(ck) || []);
    if (next.date != null) continue; // has an expiration date → fine
    issues.push({
      id: `no-expiration:${p.id}`,
      source: 'Clients',
      type: 'No expiration date',
      company: p.company || '—',
      prospectId: p.id,
      daysUntil: null,
      expirationDate: null,
      detail: 'No contract End Date on file — add a contract (or check Don\'t Track on the Clients tab) so its renewal can be tracked',
    });
  }
  return issues;
}

// Account statuses that MyAccountsView treats as inactive — an account
// parked in one of these isn't chased for a missing HQ Region (mirrors
// the check at MyAccountsView's hqRegion flag). Kept in sync with the
// STATUSES the My Accounts page suppresses.
const ACCOUNT_INACTIVE_STATUSES = new Set(['Old Client', 'Hold Off', 'Lost - Not Sold']);

// Issue #2: tier / status / missing-HQ-Region flags raised on the My
// Accounts page. MyAccountsView computes these against Target Accounts +
// Opps data and publishes a flat snapshot (one record per account+flag)
// to the my-accounts:flags store. That snapshot is only rewritten while
// MyAccountsView is mounted and recomputing, so it can lag behind an
// account the user just edited elsewhere (e.g. accept a status suggestion
// from the account modal) — leaving a row that repeats a stale status.
//
// So before mapping a published flag to a row we re-validate it against
// the LIVE account (matched by id): drop flags whose mismatch has since
// been resolved or whose account no longer exists (merged/deleted), and
// render the live status rather than the snapshot's frozen copy. The
// Opps-derived `suggestedStatus` isn't stored on the prospect, so it's
// still taken from the flag — but the comparison uses the live status.
//
// Re-validation only kicks in once `prospects` is populated; during the
// initial pre-load pass (empty list) we fall back to the stored snapshot
// so the sidebar badge doesn't momentarily undercount.
function detectMyAccountsFlags({ myAccountsFlags = [], prospects = [] }) {
  const issues = [];
  const canValidate = prospects.length > 0;
  const prospectById = new Map();
  if (canValidate) for (const p of prospects) prospectById.set(p.id, p);

  for (const f of myAccountsFlags) {
    if (!f || !f.id || !f.kind) continue;
    // Re-validate against the live account when we have one to check.
    const live = canValidate ? prospectById.get(f.id) : undefined;
    if (canValidate && !live) continue; // account was merged or deleted

    if (live && f.kind === 'status') {
      const suggested = f.suggestedStatus || '';
      // Same predicate MyAccountsView uses to raise the flag, but against
      // the live status — so accepting/dismissing the suggestion clears it.
      const stillMismatched = !live.hideStatusSuggestion
        && suggested && live.status && suggested !== live.status
        && live.dismissedSuggestedStatus !== suggested;
      if (!stillMismatched) continue;
    } else if (live && f.kind === 'hqRegion') {
      // Cleared once an HQ Region is set or the account goes inactive.
      if (live.hqRegion || ACCOUNT_INACTIVE_STATUSES.has(live.status)) continue;
    }

    // Prefer live company/status so the row never shows a stale copy.
    const company = (live && live.company) || f.company || '—';
    const liveStatus = live ? (live.status || '—') : (f.status || '—');
    if (f.kind === 'tier') {
      issues.push({
        id: `tier-mismatch:${f.id}`,
        source: 'My Accounts',
        type: 'Tier mismatch',
        company,
        prospectId: f.id,
        daysUntil: null,
        expirationDate: null,
        detail: `Your tier "${f.myTier || '—'}" doesn't match Target Accounts tier "${f.targetTier || '—'}"`,
      });
    } else if (f.kind === 'status') {
      issues.push({
        id: `status-mismatch:${f.id}`,
        source: 'My Accounts',
        type: 'Status mismatch',
        company,
        prospectId: f.id,
        daysUntil: null,
        expirationDate: null,
        detail: `Status "${liveStatus}" doesn't match Opps-suggested status "${f.suggestedStatus || '—'}"`,
      });
    } else if (f.kind === 'hqRegion') {
      issues.push({
        id: `hq-missing:${f.id}`,
        source: 'My Accounts',
        type: 'HQ Region missing',
        company,
        prospectId: f.id,
        daysUntil: null,
        expirationDate: null,
        detail: 'No HQ Region set',
      });
    }
  }
  return issues;
}

// Marketing Lead statuses that count as "closed out" — a lead in one of
// these needs no further action, so it's NOT an issue. Everything else
// (Working, 1 - New, etc.) is an open lead that still needs to be worked.
// Compared loosely (lower-cased, non-alphanumerics stripped) so hyphen /
// en-dash / spacing differences don't matter ("Closed-Recycle" ==
// "Closed–Recycle").
const MARKETING_LEAD_CLOSED_STATUSES = new Set(['closedconverted', 'closedrecycle']);
function marketingLeadStatusKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Issue #3: a Marketing Lead (Contacts page → Marketing Leads subtab)
// whose Status is set to anything other than Closed-Converted or
// Closed-Recycle — i.e. an open lead that still needs to be pushed to a
// terminal state. Leads with no Status yet are skipped (nothing to act
// on until the lead has been triaged).
function detectMarketingLeadStatuses({ marketingLeads = [] }) {
  const issues = [];
  for (const lead of marketingLeads) {
    const name = String(lead?.name || '').trim();
    const status = String(lead?.status || '').trim();
    if (!name || !status) continue;
    if (MARKETING_LEAD_CLOSED_STATUSES.has(marketingLeadStatusKey(status))) continue;
    const idPart = lead?.id != null ? String(lead.id) : name;
    issues.push({
      id: `marketing-lead-status:${idPart}`,
      source: 'Marketing Leads',
      type: 'Lead not closed out',
      company: lead.company || '—',
      prospectId: null,
      daysUntil: null,
      expirationDate: null,
      detail: `${name} — status "${status}" (not Closed-Converted or Closed-Recycle)`,
    });
  }
  return issues;
}

// Active clients whose soonest contract End Date falls within `withinDays`
// days (default 270 — the Clients-tab renewal-warning threshold). Mirrors
// the Clients-tab row build: CDM match + Status = Client, untracked clients
// skipped, soonest active End Date via soonestExpiration. Already-past
// contracts (negative days) are included — an expired contract needs
// attention most — and the list is sorted soonest / most-overdue first.
// Powers the Pipeline dashboard's renewals table.
export function computeExpiringClients({ prospects = [], cdmName, dealsList = [], clientMap = {}, managerMap = {}, untrackedMap = {}, statusMap = {}, withinDays = 270 }) {
  const dealsByClient = groupDealsByClient(dealsList, clientMap);
  const out = [];
  for (const p of prospects) {
    if (!matchesCdm(p.cdm, cdmName)) continue;
    if (!isClientStatus(p)) continue;
    const ck = normClientName(p.company);
    if (untrackedMap?.[ck]) continue;
    const next = soonestExpiration(dealsByClient.get(ck) || []);
    if (next.days == null || next.days >= withinDays) continue;
    out.push({
      id: p.id,
      company: p.company || '—',
      clientManager: managerMap?.[ck] || '',
      daysUntil: next.days,
      expiration: next.date,
      // Paperwork status of the soonest active contract (blank when the
      // deal row has no Paperwork value). Cancelled/Expired agreements are
      // already excluded by soonestExpiration, so this reflects the live one.
      contractStatus: (next.deal && String(next.deal['Paperwork completed'] || '').trim()) || '',
      // The user's editable "Renewal Status" from the Clients tab (the
      // clients-status-map), keyed by normalized company name — same source
      // and key the Clients page shows in its Renewal Status column.
      renewalStatus: String(statusMap?.[ck] || '').trim(),
    });
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}

// Build the full list of outstanding issues. Each detector contributes
// rows; add more detectors here as new issue classes are mapped.
export function computeIssues({ prospects = [], cdmName, dealsList = [], clientMap = {}, untrackedMap = {}, clientStatusMap = {}, myAccountsFlags = [], marketingLeads = [] }) {
  const dealsByClient = groupDealsByClient(dealsList, clientMap);
  const issues = [];
  issues.push(...detectNegativeDaysUntil({ prospects, cdmName, dealsByClient, untrackedMap }));
  issues.push(...detectRenewalNoStatus({ prospects, cdmName, dealsByClient, untrackedMap, clientStatusMap }));
  issues.push(...detectMissingExpiration({ prospects, cdmName, dealsByClient, untrackedMap }));
  issues.push(...detectMyAccountsFlags({ myAccountsFlags, prospects }));
  issues.push(...detectMarketingLeadStatuses({ marketingLeads }));
  return issues;
}
