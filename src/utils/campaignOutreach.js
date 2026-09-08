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

import { campaignSubjects, primarySubject } from './campaignSubjects.js';

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

// How long "Pause" parks a campaign for. Two days: long enough to cover a
// wait on someone else — a list to be checked, a colleague to come back —
// without being long enough to forget the campaign exists.
export const CAMPAIGN_PAUSE_DAYS = 2;
const PAUSE_MS = CAMPAIGN_PAUSE_DAYS * 24 * 60 * 60 * 1000;

/**
 * When a pause started now should lift, as an ISO string to store on the
 * campaign's `pausedUntil`.
 */
export function campaignPauseUntil(nowMs = Date.now()) {
  return new Date(nowMs + PAUSE_MS).toISOString();
}

/**
 * Is this campaign currently paused?
 *
 * A pause is a timestamp, not a flag, so it lifts on its own: once
 * `pausedUntil` is in the past the campaign is simply back to whatever it was
 * before, with nothing to remember to undo. An unparseable value reads as not
 * paused — a campaign silently parked forever by a bad date is the one
 * outcome worth ruling out.
 */
export function isCampaignPaused(c, nowMs = Date.now()) {
  const until = c?.pausedUntil ? new Date(c.pausedUntil).getTime() : NaN;
  return Number.isFinite(until) && until > nowMs;
}

/**
 * Whether a campaign counts as Active.
 *
 * A live pause wins over everything: a paused campaign isn't active work, and
 * that is the whole point of pausing it. Otherwise a manual Active/Inactive
 * override wins over the 60-day rule — `manualActive` is a boolean when the
 * user has set the status by hand and undefined when the campaign should
 * follow the automatic check.
 */
export function isCampaignActive(c, nowMs = Date.now()) {
  if (isCampaignPaused(c, nowMs)) return false;
  return typeof c?.manualActive === 'boolean' ? c.manualActive : isCampaignFresh(c, nowMs);
}

/**
 * The campaign's status as one word: 'paused', 'active' or 'inactive'.
 *
 * Both pages read this rather than deciding for themselves, so the Email
 * Campaigns table and the Prospecting ladder can't end up calling the same
 * campaign Paused on one page and Inactive on the other.
 */
export function campaignStatus(c, nowMs = Date.now()) {
  if (isCampaignPaused(c, nowMs)) return 'paused';
  return isCampaignActive(c, nowMs) ? 'active' : 'inactive';
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
  return String(c?.title || primarySubject(c) || '').trim() || '(untitled campaign)';
}

/**
 * Is this campaign's sending finished — 100% of its list sent to?
 *
 * One rule, so the ladder's list and the step's status can't disagree about
 * what "done" is. A campaign with nobody in it is *not* finished: it was
 * saved to be sent and 0% has gone out, which is the campaign at its least
 * done rather than its most.
 */
export function isCampaignFullySent(c) {
  const { total, remaining } = campaignSendStats(c);
  return total > 0 && remaining <= 0;
}

/**
 * Has the market-update outreach already been done, judged by the campaigns
 * themselves rather than by a tick?
 *
 * The Prospecting ladder's market-updates step is hand-marked, which meant
 * ticking a box the data had already answered: every campaign sitting at
 * 100% sent and the step still asking to be marked caught up. So when the
 * campaigns say the sending is finished, the step says so on its own.
 *
 * Paused campaigns are left out — a pause is the user having dealt with a
 * campaign for the next couple of days, so it isn't work owed today (and it
 * rejoins the list, and this answer, when the pause lifts). Everything else
 * short of 100% holds the step open, including a campaign with nobody in it
 * yet: it is listed under the step as work to finish, so it has to hold the
 * status open too — a step reading "all caught up" above a list of campaigns
 * still to send is the one thing this function exists to prevent.
 *
 * Returns:
 *   null   — the campaigns haven't loaded, so nothing is known yet
 *   true   — there is at least one real campaign and none that isn't paused
 *            still has mail to go out
 *   false  — something is still to send, OR there are no campaigns at all:
 *            an empty account proves nothing about today's outreach, so the
 *            step falls back to being marked by hand.
 */
export function campaignsAllSent(campaigns, nowMs = Date.now()) {
  if (!Array.isArray(campaigns)) return null;
  let real = 0;
  for (const c of campaigns) {
    if (!c || typeof c !== 'object') continue;
    real += 1;
    if (!isCampaignFullySent(c) && !isCampaignPaused(c, nowMs)) return false;
  }
  return real > 0;
}

/**
 * The campaigns that aren't finished sending, as rows to print.
 *
 * Every campaign under 100% sent is listed. A campaign with nobody left to
 * send to is done and drops out — that's the "100%" line — and nothing else
 * does, including a campaign saved with no contacts on it yet: 0% sent is a
 * campaign written and never sent, which is exactly the kind that goes
 * quiet. Its row says "no contacts yet" rather than counting a send that
 * hasn't been set up (see `total` on the row).
 *
 * Ordered by what's left to do: the campaign owing the most sends leads,
 * ties broken by the lower percentage and then by name so the list is
 * stable between renders. A campaign with no list yet owes no countable
 * sends, so it sits at the bottom of its group — there is nothing to send
 * until someone is on it. Inactive campaigns sort below the active ones and
 * paused ones below those — all three are still listed, because a parked
 * campaign that never finished is exactly the thing that goes quiet and gets
 * forgotten, but a campaign deliberately paused until a date is the one the
 * user has already dealt with, so it sits at the bottom until its pause
 * lifts and it rejoins the list on its own.
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
    if (isCampaignFullySent(c)) return;
    rows.push({
      index,
      label: campaignOutreachLabel(c),
      // The campaign's first subject line, plus the rest: a campaign can go
      // out under several (an A/B test, a reworded second wave) and it is
      // still one piece of outreach with one list left to finish.
      subject: primarySubject(c),
      subjects: campaignSubjects(c),
      active: isCampaignActive(c, nowMs),
      status: campaignStatus(c, nowMs),
      // When a paused campaign comes back, so the row can say so instead of
      // just reading as parked.
      pausedUntil: isCampaignPaused(c, nowMs) ? c.pausedUntil : null,
      ...stats,
    });
  });
  const rank = { active: 0, inactive: 1, paused: 2 };
  rows.sort((a, b) => (
    (rank[a.status] ?? 1) - (rank[b.status] ?? 1)
    || b.remaining - a.remaining
    || a.pct - b.pct
    || a.label.localeCompare(b.label)
  ));
  return rows;
}
