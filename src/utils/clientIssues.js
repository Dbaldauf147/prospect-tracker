// Issue detection for the Issues tab. The Issues tab aggregates
// "outstanding items that need to be addressed" across the app; each
// detector below turns one class of problem into a flat issue row.
//
// The Clients-tab "Days Until" computation lives here so the Issues tab
// and the Clients tab agree on what's expired — there's one definition
// of soonest expiration, not two that can drift apart.
import { RENEWAL_WARNING_DAYS } from './renewalWindow';
import { asDate, fmtDate } from './dealsFormat';
import { matchesCdm } from './cdmMatch';
import { computeNewBfoOpps, computeNewBfoMissingData, normalizeBfoCompany } from './newBfoOpps';
import { computeCloseNotSoldOpps, computeCloseNotSoldMissingData } from './closeNotSoldOpps';
import { dealSoldDate, daysToFollowUpGoal, followUpGoalDate, postSaleFollowUpRows } from './postSaleFollowUp';
import { incompleteHandoffDeals } from './dealHandoff';
import {
  buildOppStagesByClient,
  buildServiceCatalog,
  computeServiceCoverage,
  coverageClientsOf,
  serviceLabelMap,
} from './serviceCoverage';

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
function detectNegativeDaysUntil({ prospects, cdmName, dealsByClient, untrackedMap, clientStatusMap }) {
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
      company: p.company || '-',
      prospectId: p.id,
      daysUntil: next.days,
      expirationDate: next.date,
      // Whether the Clients tab still has this row tinted red. An expired
      // contract is an issue either way — that's why it's listed here — but
      // one with a Status set is already being handled, so it isn't renewal
      // work the Prospecting ladder should still be counting.
      noStatus: hasNoClientStatus(clientStatusMap, ck),
      detail: next.date
        ? `Soonest contract End Date (${fmtDate(next.date)}) passed ${ago} day${ago === 1 ? '' : 's'} ago`
        : `Soonest contract End Date passed ${ago} day${ago === 1 ? '' : 's'} ago`,
    });
  }
  return issues;
}

// The renewal window itself lives in renewalWindow.js — see the note
// there. Re-exported so this stays the import site everything already
// uses.
export { RENEWAL_WARNING_DAYS };

// A Clients-tab Status cell counts as "unset" when it's blank or just a
// dash placeholder. Matches the noStatus check in ClientsView.
function hasNoClientStatus(statusMap, clientKey) {
  const s = String(statusMap?.[clientKey] || '').trim();
  return s === '' || s === '-' || s === '\u2014' || s === '\u2013';
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
      type: 'Renewal: no status',
      company: p.company || '-',
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
      company: p.company || '-',
      prospectId: p.id,
      daysUntil: null,
      expirationDate: null,
      detail: 'No contract End Date on file: add a contract (or check Don\'t Track on the Clients tab) so its renewal can be tracked',
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
    const company = (live && live.company) || f.company || '-';
    const liveStatus = live ? (live.status || '-') : (f.status || '-');
    if (f.kind === 'tier') {
      issues.push({
        id: `tier-mismatch:${f.id}`,
        source: 'My Accounts',
        type: 'Tier mismatch',
        company,
        prospectId: f.id,
        daysUntil: null,
        expirationDate: null,
        detail: `Your tier "${f.myTier || '-'}" doesn't match Target Accounts tier "${f.targetTier || '-'}"`,
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
        detail: `Status "${liveStatus}" doesn't match Opps-suggested status "${f.suggestedStatus || '-'}"`,
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
      company: lead.company || '-',
      prospectId: null,
      daysUntil: null,
      expirationDate: null,
      detail: `${name}: status "${status}" (not Closed-Converted or Closed-Recycle)`,
    });
  }
  return issues;
}

// ---- BFO Opportunity Names not tagged to an opp on Opps ----
// Mirrors the ⚠ warning on the BFO Activity / Agents pages: an Opportunity
// Name in the pasted BFO Activity data that has no matching opp (by "BFO
// Link") on the Opps tab. One issue row per untagged name so each can be
// snoozed / actioned individually. Suppressed until the Opps cache has
// loaded (tagged set empty) so we don't flag every row before there's
// anything to match against — same guard the source pages use.
const BFO_BLANK_SENTINELS = new Set(['', '-', '#n/a', 'n/a']);
function bfoLinkName(r) {
  const v = String(r?.['BFO Link'] || '').trim();
  return BFO_BLANK_SENTINELS.has(v.toLowerCase()) ? '' : v;
}

// Comparison key for a BFO Opportunity Name — trimmed, lower-cased,
// internal whitespace collapsed. Same shape the Agents page uses, and
// shared by both directions of the Opps ⇄ BFO Activity match so a stray
// double space can't make one detector see a match and the other a miss.
function normBfoOppName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// The BFO Activity tab's Opportunity Name / Account columns, or null when
// the pasted data has no Opportunity Name column to match on.
function bfoActivityColumns(bfoActivity) {
  if (!bfoActivity?.headers?.length) return null;
  const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
  if (!oppCol) return null;
  const acctCol = bfoActivity.headers.find(h => /^account(\s*name)?$/i.test(String(h).trim()))
    || bfoActivity.headers.find(h => /account/i.test(h));
  return { oppCol, acctCol };
}

function detectUntaggedBfoOppNames({ bfoActivity, oppsCache }) {
  const cols = bfoActivityColumns(bfoActivity);
  if (!cols) return [];
  const { oppCol, acctCol } = cols;
  const tagged = new Set();
  for (const r of (oppsCache?.records || [])) {
    const k = normBfoOppName(bfoLinkName(r));
    if (k) tagged.add(k);
  }
  if (tagged.size === 0) return [];
  const seen = new Set();
  const issues = [];
  for (const row of bfoActivity.rows) {
    const raw = String(row[oppCol] || '').trim();
    if (!raw) continue;
    const k = normBfoOppName(raw);
    if (tagged.has(k) || seen.has(k)) continue;
    seen.add(k);
    const account = acctCol ? String(row[acctCol] || '').trim() : '';
    issues.push({
      id: `bfo-untagged:${k}`,
      source: 'Opps',
      type: 'BFO Opp not tagged',
      company: account || raw,
      prospectId: null,
      daysUntil: null,
      expirationDate: null,
      detail: `BFO Opportunity Name "${raw}" is not tagged to an opp on Opps${account ? `: from ${account}` : ''}`,
    });
  }
  return issues;
}

// ---- Active Opps whose BFO Opp Name isn't on the BFO Activity tab ----
// Stages that mean the opp is closed (no longer active). Mirrors the
// Agents page's CLOSED_OPP_STAGES so "active opp" means the same thing on
// both pages.
const CLOSED_OPP_STAGES = new Set(['sold', 'not sold']);

// The mirror image of detectUntaggedBfoOppNames: an ACTIVE opp on the
// Opps tab (Stage not Sold / Not Sold) carries a BFO Opportunity Name in
// its "BFO Link" column that appears nowhere in the pasted BFO Activity
// data. That means the tag on Opps points at a BFO opp that was renamed,
// closed out, or never created — so the two sides have drifted apart.
// One issue row per opp (not per name) so opps sharing a name can be
// snoozed / actioned individually.
//
// Suppressed until the BFO Activity paste actually holds Opportunity
// Names: with no Activity data (never pasted, or cleared) every tagged
// opp would otherwise be flagged. Blank / "-" / "#N/A" BFO Link values
// are skipped — those are the "no name yet" placeholders the New BFO Opp
// flow handles, not a mismatch.
function detectOppBfoNameNotInActivity({ bfoActivity, oppsCache, prospects = [] }) {
  const cols = bfoActivityColumns(bfoActivity);
  if (!cols) return [];
  const activityNames = new Set();
  for (const row of (bfoActivity.rows || [])) {
    const k = normBfoOppName(row[cols.oppCol]);
    if (k) activityNames.add(k);
  }
  if (activityNames.size === 0) return [];

  // Normalized company → Table View prospect id, so the Issues row can
  // link through to the account. First match wins, matching the lookup
  // detectNewBfoMissingData uses.
  const prospectIdByNorm = new Map();
  for (const p of prospects) {
    const norm = normalizeBfoCompany(p.company);
    if (norm && !prospectIdByNorm.has(norm)) prospectIdByNorm.set(norm, p.id);
  }

  const issues = [];
  for (const r of (oppsCache?.records || [])) {
    const name = bfoLinkName(r);
    if (!name) continue;
    const stage = String(r.Stage || '').trim();
    if (CLOSED_OPP_STAGES.has(stage.toLowerCase())) continue;
    if (activityNames.has(normBfoOppName(name))) continue;
    const account = String(r.Account || '').trim();
    const scope = String(r.Scope || '').trim();
    const context = [scope, stage].filter(Boolean).join(' · ');
    issues.push({
      id: `opp-bfo-name-missing:${r._id != null ? r._id : `${account}|${name}`}`,
      source: 'Opps',
      type: 'BFO Opp name not on Activity',
      company: account || name,
      prospectId: prospectIdByNorm.get(normalizeBfoCompany(account)) || null,
      daysUntil: null,
      expirationDate: null,
      detail: `Active opp${context ? ` (${context})` : ''} is tagged to BFO Opportunity Name "${name}", which isn't on the BFO Activity tab: re-paste the latest BFO Activity export, or fix the name on Opps.`,
    });
  }
  return issues;
}

// ---- New BFO Opp prompt missing data ----
// Mirrors the red banner on the Agents page: an opp that needs a fresh
// BFO Guided Opportunity created ("BFO Link" == "-") but is missing one
// of the fields the New BFO Opp prompt needs — BFO Company Name (from the
// company's Table View record) or Product Line / Type / Region / Scope /
// Local Project Name (from Dropdowns › Services for the opp's Scope). One
// issue row per affected opp so each can be snoozed / actioned on its own.
// Suppressed until BOTH the Opps cache and the Table View prospects have
// loaded, so we don't flag every opp's "BFO Company Name" as missing
// during the pre-load window (empty prospects → empty lookup).
function detectNewBfoMissingData({ prospects = [], oppsCache = null, serviceOverrides = {} }) {
  if (!oppsCache?.records?.length || prospects.length === 0) return [];
  const newBfoOpps = computeNewBfoOpps({ oppsCache, prospects, serviceOverrides });
  const missingList = computeNewBfoMissingData(newBfoOpps);
  if (missingList.length === 0) return [];
  // Normalized company → Table View prospect id, so the Issues row can
  // link to the account (where the BFO Company Name is fixed). First
  // match wins, matching the util's own lookup.
  const prospectIdByNorm = new Map();
  for (const p of prospects) {
    const norm = normalizeBfoCompany(p.company);
    if (norm && !prospectIdByNorm.has(norm)) prospectIdByNorm.set(norm, p.id);
  }
  return missingList.map((m) => ({
    id: `new-bfo-missing:${m.id}`,
    source: 'Agents',
    type: 'New BFO Opp missing data',
    company: m.company || '-',
    prospectId: prospectIdByNorm.get(normalizeBfoCompany(m.company)) || null,
    daysUntil: null,
    expirationDate: null,
    detail: `New BFO Opp prompt is missing ${m.missing.join(', ')}: BFO Company Name comes from the company's Table View record; Product Line / Type / Region / Local Project Name come from Dropdowns › Services for the opp's Scope.`,
  }));
}

// ---- Close Not Solds prompt missing data ----
// Mirrors the highlighted / red "Missing" cells in the Agents page's
// "AI Prompt (Close Not Solds)" table: a Not-Sold opp that still has an
// open BFO Activity row but is missing something the close-out prompt
// needs — Reason Not Sold, Competition, the BFO Address link, or a
// Reason Not Sold + Competition pair that isn't in the mapping table (so
// no BFO Status / Reason can be derived and the row is dropped from the
// prompt block). One issue row per opp so each can be snoozed / actioned
// on its own. Suppressed until the Opps cache has loaded.
function detectCloseNotSoldMissingData({ oppsCache = null, bfoActivity = null, prospects = [] }) {
  if (!oppsCache?.records?.length) return [];
  const missingList = computeCloseNotSoldMissingData(computeCloseNotSoldOpps({ oppsCache, bfoActivity }));
  if (missingList.length === 0) return [];
  // Normalized company → Table View prospect id, so the Issues row can
  // link through to the account. First match wins, matching the lookup
  // the other BFO detectors use.
  const prospectIdByNorm = new Map();
  for (const p of prospects) {
    const norm = normalizeBfoCompany(p.company);
    if (norm && !prospectIdByNorm.has(norm)) prospectIdByNorm.set(norm, p.id);
  }
  return missingList.map((m) => ({
    id: `close-not-sold-missing:${m.id}`,
    source: 'Agents',
    type: 'Close Not Sold missing data',
    company: m.account || m.name || '-',
    prospectId: prospectIdByNorm.get(normalizeBfoCompany(m.account)) || null,
    daysUntil: null,
    expirationDate: null,
    // Lets the Issues tab edit the pair that drives the mapping (Reason
    // Not Sold + Competition) inline, writing straight back to the opp.
    // `oppId` can be undefined on older cached rows with no _id — the
    // editor treats that as read-only rather than saving to nothing.
    closeNotSold: {
      oppId: m.oppId,
      name: m.name,
      account: m.account,
      reasonNotSold: m.reasonNotSold,
      competition: m.competition,
    },
    detail: `Close Not Solds prompt is missing ${m.missing.join(', ')} for "${m.name}": Reason Not Sold / Competition / BFO Address come from the opp's row on Opps${m.unmapped ? '; an unmapped pair either needs those fields corrected or the Reason Not Sold + Competition → BFO mapping extended' : ''}.`,
  }));
}

// ---- Service Exploration Coverage below 100% ----
// Mirrors the Pipeline page's "Service Exploration Coverage" table: each
// tracked service is a row showing what share of your active clients have
// explored it. Any row under 100% has clients still to talk to.
//
// These are not Issues-tab rows. Nothing here is wrong or overdue — a
// service under 100% is a list of conversations still to have, which is
// prospecting work, so it belongs on the Prospecting ladder's "Reach out
// to existing clients for targeted services" step rather than in a queue
// of things to fix. The row is returned structured (rather than as a
// pre-written sentence) because that step draws it as its own list.
//
// `coverageServices` is the tracked-service list persisted with the
// Pipeline dashboard; with none tracked there's nothing to check. The
// client set, the opp-derived statuses and the percentage all come from
// utils/serviceCoverage, so this can't disagree with the table it mirrors.
// Suppressed while there are no matching clients (pre-load, or no clients
// for the CDM) — that's the table's own "No active clients found" state,
// where every row would otherwise read 0%.
export function computeServiceCoverageGaps({ prospects = [], cdmName, coverageServices = [], oppsCache = null, serviceCatalogSettings = {}, clientStatusMap = {}, untrackedMap = {} }) {
  if (!Array.isArray(coverageServices) || coverageServices.length === 0) return [];
  // Same client set as the table — including its "Cancelling for Sure" /
  // "Don't Track" exclusions, so a warning can't count clients the table
  // left out.
  const clients = coverageClientsOf(prospects, cdmName, { statusMap: clientStatusMap, untrackedMap });
  if (clients.length === 0) return [];
  const oppStagesByClient = buildOppStagesByClient(clients, oppsCache?.records || []);
  const labels = serviceLabelMap(buildServiceCatalog(serviceCatalogSettings));
  const rows = [];
  for (const key of coverageServices) {
    const cov = computeServiceCoverage(clients, key, oppStagesByClient);
    if (cov.pct >= 100 && cov.notExplored.length === 0) continue;
    rows.push({
      id: `svc-coverage:${key}`,
      service: key,
      label: labels.get(key) || key,
      pct: cov.pct,
      explored: cov.explored.length,
      total: cov.total,
      notExplored: cov.notExplored.map(({ p }) => p.company || '-'),
    });
  }
  // Widest gap first: the service with the most clients left to talk to is
  // the one with the most outreach in it.
  rows.sort((a, b) => b.notExplored.length - a.notExplored.length || a.label.localeCompare(b.label));
  return rows;
}

// Issue #10: a sold deal whose post-sale follow-up is past the 60-day goal.
// Reads the same rows the Pipeline dashboard's Post-Sale Follow-Up table
// shows — via the shared postSaleFollowUp helpers — and keeps the ones the
// table prints as "Nd overdue". Deals with no sold date can't be overdue, so
// they're left to the table, which lists them as undated.
//
// Not CDM-scoped: the tables this mirrors run off the uploaded deals list
// rather than the prospect list, so filtering here would hide rows that the
// Pipeline and Clients tabs both still show as overdue.
function detectPostSaleFollowUpOverdue({ dealsList = [], prospects = [] }) {
  // Company → prospect id, so an overdue row can open its account like the
  // other client issues do. Deals whose client isn't a tracked prospect still
  // raise the issue; they just aren't clickable.
  const idByCompany = new Map();
  for (const p of prospects) {
    const k = normClientName(p.company);
    if (k && !idByCompany.has(k)) idByCompany.set(k, p.id);
  }
  const issues = [];
  for (const d of postSaleFollowUpRows(dealsList)) {
    const left = daysToFollowUpGoal(d['Original Contract Start']);
    if (left == null || left >= 0) continue;
    const company = String(d['Client Name'] ?? d['Client Name '] ?? '').trim() || '-';
    const agreement = String(d['Agreement Name'] ?? '').trim();
    const sold = dealSoldDate(d);
    const over = Math.abs(left);
    issues.push({
      // Client + agreement identifies the row; a client can have several
      // agreements overdue at once and each is its own follow-up.
      id: `postsale-overdue:${normClientName(company)}:${agreement.toLowerCase()}`,
      source: 'Clients',
      type: 'Post-sale follow-up overdue',
      company,
      prospectId: idByCompany.get(normClientName(company)) || null,
      daysUntil: left,
      expirationDate: followUpGoalDate(d['Original Contract Start']),
      detail: `Sold ${sold ? fmtDate(sold) : '-'}, no Follow Up On Sale ${over} day${over === 1 ? '' : 's'} past the 60-day goal${agreement ? `: ${agreement}` : ''}`,
    });
  }
  return issues;
}

// Issue #11: a deal on the Deals subtab that still has an outstanding
// handoff item — its Progress pill reads less than 9/9 (whatever N the
// checklist is at). The checklist and the "which deals still owe
// something" rule live in utils/dealHandoff, so a pill the Deals subtab
// paints red or amber is exactly the row raised here.
//
// Deals the user ticked "Ignore this deal" on are already dropped by
// incompleteHandoffDeals — that flag greys out the pill there and means
// the same thing here, the same way it does for post-sale follow-ups.
//
// Not CDM-scoped, for the same reason detectPostSaleFollowUpOverdue
// isn't: it runs off the uploaded deals list rather than the prospect
// list, so filtering would hide rows the Deals subtab still shows as
// incomplete.
function detectIncompleteHandoff({ dealsList = [], prospects = [] }) {
  // Company → prospect id, so a flagged deal can open its account like the
  // other client issues do. Deals whose client isn't a tracked prospect
  // still raise the issue; they just aren't clickable.
  const idByCompany = new Map();
  for (const p of prospects) {
    const k = normClientName(p.company);
    if (k && !idByCompany.has(k)) idByCompany.set(k, p.id);
  }
  const issues = [];
  // Ids have to survive a re-upload of the workbook, since a snooze is
  // stored against them — so they're built from the deal's own values
  // rather than its position in the list. Client + agreement + contract
  // start is what distinguishes one row from another, including the same
  // agreement renewed in a later year; a `#n` suffix separates rows that
  // are identical even on all three.
  const seenIds = new Map();
  for (const { deal, done, total, missing } of incompleteHandoffDeals(dealsList)) {
    const company = String(deal['Client Name'] ?? deal['Client Name '] ?? '').trim() || '-';
    const agreement = String(deal['Agreement Name'] ?? '').trim();
    const started = String(deal['Original Contract Start'] ?? '').trim();
    const base = `deal-handoff:${normClientName(company)}:${agreement.toLowerCase()}:${started.toLowerCase()}`;
    const nth = (seenIds.get(base) || 0) + 1;
    seenIds.set(base, nth);
    issues.push({
      id: nth === 1 ? base : `${base}#${nth}`,
      source: 'Deals',
      type: 'Handoff items outstanding',
      company,
      prospectId: idByCompany.get(normClientName(company)) || null,
      daysUntil: null,
      expirationDate: null,
      detail: `Handoff ${done}/${total}${agreement ? ` on ${agreement}` : ''} \u2014 still outstanding: ${missing.map(f => f.label).join(', ')}`,
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
      company: p.company || '-',
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
//
// Service Exploration Coverage is deliberately not among them — see
// computeServiceCoverageGaps above; it feeds the Prospecting ladder.
export function computeIssues({ prospects = [], cdmName, dealsList = [], clientMap = {}, untrackedMap = {}, clientStatusMap = {}, myAccountsFlags = [], marketingLeads = [], bfoActivity = null, oppsCache = null, serviceOverrides = {} }) {
  const dealsByClient = groupDealsByClient(dealsList, clientMap);
  const issues = [];
  issues.push(...detectNegativeDaysUntil({ prospects, cdmName, dealsByClient, untrackedMap, clientStatusMap }));
  issues.push(...detectRenewalNoStatus({ prospects, cdmName, dealsByClient, untrackedMap, clientStatusMap }));
  issues.push(...detectMissingExpiration({ prospects, cdmName, dealsByClient, untrackedMap }));
  issues.push(...detectMyAccountsFlags({ myAccountsFlags, prospects }));
  issues.push(...detectMarketingLeadStatuses({ marketingLeads }));
  issues.push(...detectUntaggedBfoOppNames({ bfoActivity, oppsCache }));
  issues.push(...detectOppBfoNameNotInActivity({ bfoActivity, oppsCache, prospects }));
  issues.push(...detectNewBfoMissingData({ prospects, oppsCache, serviceOverrides }));
  issues.push(...detectCloseNotSoldMissingData({ oppsCache, bfoActivity, prospects }));
  issues.push(...detectPostSaleFollowUpOverdue({ dealsList, prospects }));
  issues.push(...detectIncompleteHandoff({ dealsList, prospects }));
  return issues;
}
