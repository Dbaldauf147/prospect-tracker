// Ordering and type-ahead matching for the "add to a campaign" pickers (the
// contact popup's Email Campaign control and Draft Emails' "Add to existing
// campaign").
//
// Most recent first, where recent means the latest thing that happened on
// the campaign: its save, or the last email sent under it. A campaign that
// is still going out keeps rising to the top even though it was saved
// months ago, and one made today is up there before anything has gone out.
// Ties (and campaigns with no dates at all, saved before savedAt existed)
// keep their stored order, which is newest first: new campaigns are put at
// the front of the list when they are saved.
//
// Everything here is pure (scripts/campaignPicker.test.mjs).

const time = (v) => {
  if (v == null || v === '') return 0;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : 0;
};

/** The latest save or send on a campaign, as ms since epoch (0 if none). */
export function campaignRecency(c) {
  let best = Math.max(time(c?.savedAt), time(c?.createdAt), time(c?.lastSentDate));
  for (const row of (Array.isArray(c?.contacts) ? c.contacts : [])) {
    const t = time(row?.sentDate);
    if (t > best) best = t;
  }
  return best;
}

/**
 * The campaigns, most recent first, each with its index in the list as
 * given (callers write back by index or by subject).
 */
export function campaignsByRecency(campaigns) {
  return (Array.isArray(campaigns) ? campaigns : [])
    .map((campaign, index) => ({ campaign, index, recency: campaignRecency(campaign) }))
    .sort((a, b) => (b.recency - a.recency) || (a.index - b.index));
}

const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9@.&'-]+/i).filter(Boolean);

/**
 * Type-ahead over picker options. `options` are { label, text? } in the
 * order they should show with nothing typed; `text` is anything else worth
 * matching (other subject lines). Each typed word has to start a word of the
 * option ("q3 erc" finds "Q3 update: ERCOT"); failing that, the whole query
 * appearing anywhere still counts. Ranked: label starts with the query, then
 * every word matched at a word start, then anywhere; order kept within each.
 */
export function matchPickerOptions(options, query) {
  const list = Array.isArray(options) ? options : [];
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [...list];
  const qWords = words(q);
  const starts = [], wordStarts = [], anywhere = [];
  for (const o of list) {
    const label = String(o?.label ?? '').toLowerCase();
    const all = `${label} ${String(o?.text ?? '').toLowerCase()}`;
    if (label.startsWith(q)) { starts.push(o); continue; }
    const optWords = words(all);
    if (qWords.length && qWords.every(w => optWords.some(ow => ow.startsWith(w)))) { wordStarts.push(o); continue; }
    if (all.includes(q)) anywhere.push(o);
  }
  return [...starts, ...wordStarts, ...anywhere];
}

const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The grey line under a campaign in the picker: roster size and last activity. */
export function campaignPickerDetail(c) {
  const count = c?.totalContacts ?? (Array.isArray(c?.contacts) ? c.contacts.length : 0);
  const parts = [`${count} contact${count === 1 ? '' : 's'}`];
  const t = campaignRecency(c);
  if (t) parts.push(`last activity ${fmtDay(t)}`);
  return parts.join(' · ');
}
