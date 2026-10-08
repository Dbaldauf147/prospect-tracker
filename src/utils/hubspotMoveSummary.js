// Buckets for the HubSpot move comparison (api/hubspot-move.js), shared by
// the tab that shows them and its CSV. Pure.
//
// Every compared record lands in exactly one bucket, so the counts add up
// to the number of records checked, plus a separate "has differences"
// count that overlaps the matched buckets.

export const MOVE_BUCKETS = [
  { key: 'missing-old', label: 'Missing, older', tone: 'danger',
    help: 'In the current portal but not in the new one, and created before the recent window. These are the ones to worry about.' },
  { key: 'missing-recent', label: 'Missing, recent', tone: 'warning',
    help: 'Not in the new portal yet, but created inside the recent window, which is where gaps are expected.' },
  { key: 'other', label: 'Owned by someone else', tone: 'warning',
    help: 'In the new portal, but owned by another HubSpot user. Once the app only shows your records, these would not appear.' },
  { key: 'unowned', label: 'No owner', tone: 'warning',
    help: 'In the new portal with no owner set. Once the app only shows your records, these would not appear.' },
  { key: 'mine', label: 'Yours', tone: 'success',
    help: 'In the new portal and owned by you.' },
  { key: 'no-email', label: 'No email', tone: 'muted',
    help: 'Contacts with no email address, which can only be matched by hand.' },
];

export function moveBucket(row) {
  if (row.status === 'no-email') return 'no-email';
  if (row.status === 'missing') return row.recent ? 'missing-recent' : 'missing-old';
  return row.owner || 'unowned';
}

export function summarizeMoveRows(rows) {
  const counts = Object.fromEntries(MOVE_BUCKETS.map(b => [b.key, 0]));
  let withDiffs = 0;
  for (const r of rows || []) {
    counts[moveBucket(r)] = (counts[moveBucket(r)] || 0) + 1;
    if (r.diffs?.length) withDiffs += 1;
  }
  return { counts, withDiffs, total: (rows || []).length };
}

export function describeDiffs(diffs) {
  return (diffs || []).map(d => `${d.field}: "${d.source}" -> "${d.target || '(blank)'}"`).join('; ');
}
