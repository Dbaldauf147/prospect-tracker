// The account Status that Opps suggests, and the opps behind it.
//
// My Accounts raises a "status mismatch" flag when an account's Status
// disagrees with what its opps imply. The rule lives here so the Issues
// tab's Resolution popup can show the very opps that produced the
// suggestion, classified the same way My Accounts classified them.

import { buildCompanyIndex, findMatchesInIndex } from './companyIndex.js';

const SOLD_STAGES = new Set(['sold', 'won', 'closed won', 'sold - won']);
const NOT_SOLD_STAGES = new Set(['not sold', 'lost', 'closed lost', 'lost - not sold']);
// Case-sensitive on purpose: this is the list My Accounts has always used.
const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

/** 'sold' | 'notSold' | 'active' for an opp's Stage, or null when it counts for nothing. */
export function oppStageBucket(stage) {
  const s = String(stage || '').trim();
  const lower = s.toLowerCase();
  if (SOLD_STAGES.has(lower)) return 'sold';
  if (NOT_SOLD_STAGES.has(lower)) return 'notSold';
  if (s && !CLOSED_STAGES.has(s) && !INVALID_STAGES.has(s)) return 'active';
  return null;
}

/** Sold wins, then anything still open, then Not Sold. '' when there is nothing to go on. */
export function suggestedStatusFromCounts({ sold = 0, notSold = 0, active = 0 } = {}) {
  if (sold > 0) return 'Client';
  if (active > 0) return 'Qualifying';
  if (notSold > 0) return 'Lost - Not Sold';
  return '';
}

const BUCKET_FOR_STATUS = { Client: 'sold', Qualifying: 'active', 'Lost - Not Sold': 'notSold' };
const plural = (n) => `${n} opp${n === 1 ? '' : 's'}`;

/**
 * The Opps Account (lowercase) a company's status suggestion comes from,
 * found the way My Accounts finds it: for each of the company's names (its
 * own, then its divisions'), an exact Account match first, then the fuzzy
 * company-name match, taking the first account that suggests a status.
 * '' when no account with opps matches.
 */
export function suggestionAccountFor(records, names) {
  const counts = {};
  for (const r of records || []) {
    const account = String(r?.Account || '').trim().toLowerCase();
    const bucket = account && oppStageBucket(r.Stage);
    if (!bucket) continue;
    if (!counts[account]) counts[account] = { sold: 0, notSold: 0, active: 0 };
    counts[account][bucket]++;
  }
  const keys = Object.keys(counts).filter(k => suggestedStatusFromCounts(counts[k]));
  if (keys.length === 0) return '';
  const have = new Set(keys);
  const index = buildCompanyIndex(keys);
  for (const raw of names || []) {
    const name = String(raw || '').trim().toLowerCase();
    if (!name) continue;
    if (have.has(name)) return name;
    for (const match of findMatchesInIndex(index, name)) if (have.has(match)) return match;
  }
  return '';
}

/**
 * The opps behind a suggested status. `names` are the company's names (any
 * case), matched to an Opps Account by suggestionAccountFor.
 *
 * Returns { account, opps, otherCount, reason }: `opps` are the records
 * that produce the suggestion (the sold ones for Client, the open ones for
 * Qualifying, the Not Sold ones for Lost - Not Sold) and `otherCount` the
 * account's remaining counted opps.
 */
export function oppsBehindSuggestion(records, names, suggestedStatus) {
  const want = BUCKET_FOR_STATUS[suggestedStatus];
  const empty = { account: '', opps: [], otherCount: 0, reason: '' };
  if (!want) return empty;
  const k = suggestionAccountFor(records, names);
  if (!k) return empty;
  const mine = [];
  let account = '';
  let counted = 0;
  for (const r of records || []) {
    const raw = String(r?.Account || '').trim();
    if (raw.toLowerCase() !== k) continue;
    const bucket = oppStageBucket(r.Stage);
    if (!bucket) continue;
    if (!account) account = raw;
    counted++;
    if (bucket === want) mine.push(r);
  }
  if (mine.length === 0) return { ...empty, account };
  const n = mine.length;
  const reason = want === 'sold'
    ? `${plural(n)} on Opps ${n === 1 ? 'is' : 'are'} Sold, and a sold opp makes the account a Client.`
    : want === 'active'
      ? `${plural(n)} on Opps ${n === 1 ? 'is' : 'are'} still open and none are Sold.`
      : `${n === 1 ? 'The only opp' : `All ${n} opps`} on Opps for this account ${n === 1 ? 'is' : 'are'} Not Sold. None are Sold or still open.`;
  return { account, opps: mine, otherCount: counted - n, reason };
}

// The opps that make Opps suggest a status, as the Issues tab's Resolution
// popup table (`r` is the issue row's resolve payload): the account's Sold
// opps for Client, its open ones for Qualifying, its Not Sold ones for Lost
// - Not Sold. `divisionNames` are the company's divisions, which My
// Accounts also matches opps under. When the opps can't be found the table
// has no rows and its caption says why, so the popup never just stays
// silent about where the suggestion came from.
export function suggestionOppsTable(r, prospect, oppsRecords, oppNumbers, divisionNames = []) {
  const { account, opps, otherCount, reason } = oppsBehindSuggestion(
    oppsRecords, [prospect?.company, ...divisionNames, r.oppsAccount], r.suggestedStatus,
  );
  if (opps.length === 0) {
    return {
      caption: (oppsRecords || []).length === 0
        ? 'The Opps data has not loaded here yet, so the opps behind this cannot be listed. Open the Opps tab once, then reopen this.'
        : account
          ? `The opps under the Opps account "${account}" no longer point to this status. Open My Accounts to refresh the suggestion.`
          : 'No opps on the Opps tab match this company by name any more. Open My Accounts to refresh the suggestion.',
      columns: [],
      rows: [],
    };
  }
  const cell = (v) => { const s = String(v ?? '').trim(); return s || '-'; };
  const lost = r.suggestedStatus === 'Lost - Not Sold';
  const notes = [reason];
  if (account && account.toLowerCase() !== String(prospect?.company || '').trim().toLowerCase()) {
    notes.push(`They are under the Opps account "${account}".`);
  }
  if (otherCount > 0) notes.push(`${otherCount} other opp${otherCount === 1 ? '' : 's'} on the account ${otherCount === 1 ? 'is' : 'are'} not shown.`);
  return {
    caption: notes.join(' '),
    columns: [
      { key: 'number', label: 'Opp #' },
      { key: 'scope', label: 'Scope', wide: true },
      { key: 'stage', label: 'Stage' },
      { key: 'quoted', label: 'Quoted', align: 'right' },
      { key: 'closeDate', label: 'Close Date' },
      ...(lost ? [{ key: 'reason', label: 'Reason Not Sold', wide: true }] : []),
      { key: 'source', label: 'Source' },
    ],
    rows: opps.map((o, i) => ({
      key: o._id ?? i,
      number: oppNumbers?.get(o._id) != null ? `#${oppNumbers.get(o._id)}` : '-',
      scope: cell(o.Scope),
      stage: cell(o.Stage),
      quoted: cell(o['Quoted Amount']),
      closeDate: cell(o['Close Date']),
      reason: cell(o['Reason Not Sold']),
      source: cell(o.Source),
    })),
  };
}
