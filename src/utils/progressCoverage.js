// The two account-coverage charts, defined once.
//
// The Progress tab draws them (a line per tier, a point per week) off the
// weekly snapshots it writes to progressHistory; the Weekly Report email
// carries the same two series as bars. Both read the same four snapshot
// fields, and a label or a colour that drifted between the two would be
// the same measure arriving under two names.
//
// No imports on purpose: the Progress tab, the report tab and the
// serverless build all pull this in, and none of them should have to drag
// the others' dependencies along to read four field names.

// Tier 1 red and Tier 2 blue, the pair used across the Progress charts.
export const COVERAGE_T1 = '#DC2626';
export const COVERAGE_T2 = '#3B82F6';

// `t1Key` / `t2Key` are the fields ProgressView writes into each weekly
// snapshot. A snapshot that predates one of them reports null for that
// week rather than zero: a week nobody recorded is not a week at 0%.
export const COVERAGE_CHARTS = [
  {
    id: 'contactPct',
    label: '% of Accounts with HubSpot Contacts',
    t1Key: 't1ContactPct',
    t2Key: 't2ContactPct',
  },
  {
    id: 'dmPct',
    label: '% of Accounts with Decision Maker Identified',
    t1Key: 't1DMPct',
    t2Key: 't2DMPct',
  },
];
