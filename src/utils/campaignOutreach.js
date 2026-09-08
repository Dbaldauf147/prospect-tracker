// Which saved email campaigns still have mail to go out.
//
// A campaign saved on the Email Campaigns tab is a fixed list of contacts
// plus what has actually been sent to them, so "13 of 33 sent" is a piece
// of outreach half-finished — the twenty people who were meant to hear
// from us and haven't. That is prospecting work owed, and until now the
// only place it showed was a table two tabs away, which meant a campaign
// stalled at 39% just sat there.
//
// This turns the saved list into the rows the Prospecting ladder prints
// under "Reach out to contacts with market updates". Pure: campaigns in,
// rows out, with the clock passed in (scripts/campaignOutreach.test.mjs).

// A saved campaign goes Inactive once it has had no activity — neither a
// save nor a refresh — for 60 days. A campaign with no usable date stays
// Active, so it never greys out purely for missing a timestamp.
const ACTIVE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

export function isCampaignFresh(c, nowMs = Date.now()) {
  const times = [c?.refreshedAt, c?.savedAt]
    .map(d => (d ? new Date(d).getTime() : 0))
    .filter(t => Number.isFinite(t) && t > 0);
  if (!times.length) return true;
  return (nowMs - Math.max(...times)) <= ACTIVE_WINDOW_MS;
}

/**
 * Whether a campaign counts as Active.
 *
 * A manual Active/Inactive override always wins over the 60-day rule:
 * `manualActive` is a boolean when the user has set the status by hand and
 * undefined when the campaign should follow the automatic check.
 */
export function isCampaignActive(c, nowMs = Date.now()) {
  return typeof c?.manualActive === 'boolean' ? c.manualActive : isCampaignFresh(c, nowMs);
}

/**
 * How far one campaign's send has got: { sent, total, remaining, pct }.
 *
 * The same two figures the Saved Campaigns table shows, read the same
 * tolerant way — `totalContacts` is what the campaign was saved against,
 * and older campaigns fall back to the contact list itself (and finally to
 * the recipients, which reads as "everyone we know of has been sent to").
 * `pct` carries one decimal, like the table's % Sent column.
 */
export function campaignSendStats(c) {
  const sent = Number(c?.uniqueRecipients) || 0;
  const total = Number(c?.totalContacts ?? c?.contacts?.length ?? c?.uniqueRecipients) || 0;
  const remaining = Math.max(0, total - sent);
  const pct = total > 0 ? Math.round((sent / total) * 1000) / 10 : 0;
  return { sent, total, remaining, pct };
}

export function campaignOutreachLabel(c) {
  return String(c?.title || c?.subject || '').trim() || '(untitled campaign)';
}

/**
 * The campaigns that aren't finished sending, as rows to print.
 *
 * A campaign with nobody left to send to is done and drops out — that's
 * the "100%" line. So does one with no contacts at all: there is no
 * outreach to finish, and a row reading "0% · 0 to go" is noise.
 *
 * Ordered by what's left to do: the campaign owing the most sends leads,
 * ties broken by the lower percentage and then by name so the list is
 * stable between renders. Inactive campaigns sort last — they're still
 * listed, because a parked campaign that never finished is exactly the
 * thing that goes quiet and gets forgotten, but they don't lead.
 *
 * Rows carry `index`, the campaign's position in the saved list, which is
 * what identifies it on the Email Campaigns tab (subjects need not be
 * unique).
 */
export function unfinishedCampaigns(campaigns, nowMs = Date.now()) {
  const rows = [];
  (Array.isArray(campaigns) ? campaigns : []).forEach((c, index) => {
    if (!c || typeof c !== 'object') return;
    const stats = campaignSendStats(c);
    if (stats.total <= 0 || stats.remaining <= 0) return;
    rows.push({
      index,
      label: campaignOutreachLabel(c),
      subject: String(c?.subject || '').trim(),
      active: isCampaignActive(c, nowMs),
      ...stats,
    });
  });
  rows.sort((a, b) => (
    (a.active === b.active ? 0 : a.active ? -1 : 1)
    || b.remaining - a.remaining
    || a.pct - b.pct
    || a.label.localeCompare(b.label)
  ));
  return rows;
}
