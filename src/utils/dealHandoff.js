// The "ready to invoice" handoff checklist behind the Deals subtab's
// Progress column — the X/N pill on every deal row — and the rules for
// what counts as a completed step.
//
// Two surfaces read it now: the Deals subtab (which renders the pill and
// edits the fields in its popover) and the Issues tab (which flags a deal
// that hasn't finished the checklist), so the definition lives here rather
// than inside DealsView. A field that's done on one is done on the other,
// by construction.
//
// Extension-explicit imports so plain `node scripts/*.test.mjs` can load
// this module the way the repo's other util tests load theirs.
import { isIgnoredDeal } from './postSaleFollowUp.js';

// The handoff fields the user wants to see at a glance on every deal.
// `label` is what shows up in the Progress popover (and in the Issues
// row's detail); `key` is the canonical field name on the deal row;
// `href` hangs a link off the label; `yesno` marks a field whose only
// completed answer is "Yes"; `date` gets the shared calendar picker in
// the popover instead of a text box.
export const HANDOFF_FIELDS = [
  // First on the list because it's the date everything else on the deal is
  // measured from — the Year column derives from it, and the post-sale
  // follow-up clock starts there. Still its own column on the grid; this is
  // the same value, editable from the popover as well.
  { key: 'Original Contract Start', label: 'Original Contract Start', date: true },
  { key: 'BFO - Close after contract execution email has been sent', label: 'BFO opp name' },
  { key: 'Commission Sheet Sent to Kathy', label: 'Commission Sheet Sent to Kathy' },
  { key: 'Paperwork completed', label: 'Paperwork' },
  { key: 'Billing information collected', label: 'Billing Letter' },
  { key: 'Closed Won', label: 'Closed Won', href: 'https://servicedesk.ems.schneider-electric.com/servicedesk/customer/portal/35/create/3562' },
  { key: 'Setup', label: 'Setup' },
  { key: 'Recurring Revenue', label: 'Recurring' },
  { key: 'Commission', label: 'Commission' },
  { key: '__siaUploadedToBFO', label: 'SIA line items uploaded to BFO?', yesno: true },
];

// A handoff field counts as "done" when the user has put a real value in
// it — a date, a note, a "Yes", whatever. We treat empty strings and bare
// dash placeholders ("-", "—", "–") as not filled so a workbook that uses
// a dash for "blank" doesn't bump the X/N progress count.
const DASH_PLACEHOLDERS = new Set(['-', '–', '—']);
export function isFilled(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (s === '') return false;
  if (DASH_PLACEHOLDERS.has(s)) return false;
  return true;
}

// Completion test for a single handoff field. Yes/No fields only count as
// done when the answer is an explicit "Yes" — a "No" is a real answer but
// still an outstanding handoff step. Every other field counts as done once
// it carries any real value.
export function isHandoffFieldDone(row, field) {
  if (field?.yesno) return String(row?.[field.key] ?? '').trim().toLowerCase() === 'yes';
  return isFilled(row?.[field.key]);
}

// The X/N tally for one deal, plus the fields still outstanding. `missing`
// is in checklist order so the Issues detail reads the same way the
// popover does.
export function handoffProgress(row) {
  const missing = HANDOFF_FIELDS.filter(f => !isHandoffFieldDone(row, f));
  const total = HANDOFF_FIELDS.length;
  return { done: total - missing.length, total, missing };
}

// A blank spacer row in an uploaded workbook — no client and no agreement.
// Nothing to chase, so it never counts as an incomplete handoff. Mirrors
// the same skip in postSaleFollowUpRows.
function isSpacerRow(row) {
  const client = String(row?.['Client Name'] ?? row?.['Client Name '] ?? '').trim();
  const agreement = String(row?.['Agreement Name'] ?? '').trim();
  return !client && !agreement;
}

// Every uploaded deal that still has an outstanding handoff item, as
// { deal, done, total, missing }. Deals marked "Ignore this deal" on the
// Deals subtab are skipped — that flag is the user saying they're done
// chasing the row, which is exactly what greys out its pill there — and so
// are blank spacer rows.
//
// Sorted most-outstanding first, then by client name, so the worst-off
// deals lead regardless of upload order.
export function incompleteHandoffDeals(dealsList) {
  const out = [];
  for (const d of (dealsList || [])) {
    if (isSpacerRow(d)) continue;
    if (isIgnoredDeal(d)) continue;
    const progress = handoffProgress(d);
    if (progress.missing.length === 0) continue;
    out.push({ deal: d, ...progress });
  }
  out.sort((a, b) => (
    b.missing.length - a.missing.length
    || String(a.deal['Client Name'] ?? '').localeCompare(String(b.deal['Client Name'] ?? ''))
  ));
  return out;
}
