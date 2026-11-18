// Email Campaigns > Email Schedule: when the next campaign goes to each of
// the three audiences (Clients, Key Contacts, Prospects), read off the
// planned dates on Saved Campaigns' Sent To column (campaignAudience
// scheduledFor), and the earliest day each audience can be mailed without
// most of its people going over the outreach cap.
//
// The cap: no more than OUTREACH_LIMIT emails to one person in any
// OUTREACH_WINDOW_DAYS days, the new one included. So a send on day D is
// fine for a person when they had at most LIMIT - 1 emails in the window
// that ends on D (D - 20 through D).
//
// Who has been emailed when comes from the saved campaigns' rosters: each
// roster row's sendHistory (or its sentDate when it has none), credited to
// every address on a grouped send. Planned sends to the same audience that
// fall before the day being checked count as well, as one email to every
// member, since that is what they will be by then.
//
// Pure: campaigns, members and dates in, rows out
// (scripts/emailSchedule.test.mjs).
import { CAMPAIGN_AUDIENCES, campaignAudience, campaignSchedule } from './campaignAudience.js';
import { primarySubject } from './campaignSubjects.js';
import { followUpInfo } from './campaignFollowUp.js';

export const OUTREACH_LIMIT = 3;
export const OUTREACH_WINDOW_DAYS = 21;
// "Most contacts": the share of an audience that has to be under the cap
// for a day to count as a target date.
export const DEFAULT_MOST_SHARE = 0.8;
// How far ahead to look for a target date before giving up.
const SEARCH_DAYS = 180;

const pad = (n) => String(n).padStart(2, '0');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A local 'YYYY-MM-DD' for a Date, an ISO timestamp or a bare day. */
export function localDay(value) {
  if (!value) return '';
  if (typeof value === 'string' && DAY_RE.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' plus `n` days (n may be negative). */
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + n));
}

const isWeekend = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  const w = new Date(y, m - 1, d).getDay();
  return w === 0 || w === 6;
};

/** The first weekday on or after `day`. */
export function nextWeekday(day) {
  let d = day;
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/**
 * Every campaign email each address has had: Map<lowercased email,
 * sorted 'YYYY-MM-DD'[]> (one entry per send, so two sends on one day
 * are two).
 */
export function outreachLog(campaigns) {
  const log = new Map();
  for (const camp of campaigns || []) {
    for (const ct of camp?.contacts || []) {
      const info = followUpInfo(ct);
      if (!info.sent) continue;
      const days = (info.history.length ? info.history.map(h => h?.date) : [ct.sentDate])
        .map(localDay).filter(Boolean);
      if (!days.length) continue;
      for (const part of String(ct.email || '').split(/[;,]/)) {
        const em = part.trim().toLowerCase();
        if (!em) continue;
        if (!log.has(em)) log.set(em, []);
        log.get(em).push(...days);
      }
    }
  }
  for (const days of log.values()) days.sort();
  return log;
}

/** Emails in the window that ends on `day` (day - 20 through day). */
export function sendsInWindow(days, day, windowDays = OUTREACH_WINDOW_DAYS) {
  const from = addDays(day, -(windowDays - 1));
  let n = 0;
  for (const d of days || []) if (d >= from && d <= day) n += 1;
  return n;
}

/**
 * How an audience stands for a send on `day`: { total, ok, over, share }.
 * `planned` is the audience's other planned send days (each one email to
 * every member); only those in the window count. A member is ok when the
 * new email keeps them at or under the cap. An empty audience reads as
 * share 1: there is nobody to go over.
 */
export function readinessOn({ members, log, planned = [], day, limit = OUTREACH_LIMIT, windowDays = OUTREACH_WINDOW_DAYS }) {
  const extra = sendsInWindow(planned, day, windowDays);
  let total = 0, ok = 0;
  for (const em of members || []) {
    total += 1;
    if (sendsInWindow(log.get(em), day, windowDays) + extra + 1 <= limit) ok += 1;
  }
  return { total, ok, over: total - ok, share: total ? ok / total : 1 };
}

/** The first weekday from `fromDay` on where at least `most` of the audience is ok, or ''. */
export function targetDate({ members, log, planned = [], fromDay, most = DEFAULT_MOST_SHARE, limit, windowDays }) {
  let day = nextWeekday(fromDay);
  for (let i = 0; i < SEARCH_DAYS; i += 1) {
    if (!isWeekend(day) && readinessOn({ members, log, planned, day, limit, windowDays }).share >= most) return day;
    day = addDays(day, 1);
  }
  return '';
}

/**
 * Every planned, not yet sent, audience send:
 * [{ id, audience, audienceLabel, index, title, subject, date }],
 * soonest first. `index` is the campaign's place in the saved list.
 */
export function plannedSends(campaigns) {
  const out = [];
  (campaigns || []).forEach((c, index) => {
    const sent = campaignAudience(c);
    const dates = campaignSchedule(c);
    for (const a of CAMPAIGN_AUDIENCES) {
      if (sent[a.key] || !dates[a.key]) continue;
      out.push({
        id: `${index}|${a.key}`,
        audience: a.key,
        audienceLabel: a.label,
        index,
        title: String(c?.title || '').trim() || primarySubject(c) || '(untitled campaign)',
        subject: primarySubject(c) || '',
        date: dates[a.key],
      });
    }
  });
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.audienceLabel.localeCompare(y.audienceLabel));
}

/**
 * The whole schedule. `members` is { clients, keyContacts, prospects },
 * each an iterable of lowercased emails.
 *
 * Returns { rows, groups }:
 *   rows    plannedSends, each with `sendDay` (its date, or today when it
 *           is overdue and still to go), `readiness` on that day, `target`
 *           (the earliest ok day counting the audience's earlier planned
 *           sends) and `early` (planned before its target).
 *   groups  one per audience: { key, label, total, next (its first row or
 *           null), nextTarget (the earliest ok day for a further send after
 *           everything planned), planned (row count) }.
 */
export function buildEmailSchedule({ campaigns, members, today, most = DEFAULT_MOST_SHARE, limit = OUTREACH_LIMIT, windowDays = OUTREACH_WINDOW_DAYS }) {
  const log = outreachLog(campaigns);
  const rows = [];
  const groups = [];
  const all = plannedSends(campaigns);
  for (const a of CAMPAIGN_AUDIENCES) {
    const list = [...(members?.[a.key] || [])];
    const mine = all.filter(r => r.audience === a.key);
    const before = [];
    const groupRows = mine.map(r => {
      const sendDay = r.date < today ? today : r.date;
      const readiness = readinessOn({ members: list, log, planned: before, day: sendDay, limit, windowDays });
      const target = targetDate({ members: list, log, planned: before, fromDay: today, most, limit, windowDays });
      before.push(sendDay);
      return { ...r, sendDay, overdue: r.date < today, readiness, target, early: !!target && sendDay < target };
    });
    rows.push(...groupRows);
    groups.push({
      key: a.key,
      label: a.label,
      total: list.length,
      next: groupRows[0] || null,
      planned: groupRows.length,
      // A further send goes after the last planned one.
      nextTarget: targetDate({ members: list, log, planned: before, fromDay: before.length ? addDays(before[before.length - 1], 1) : today, most, limit, windowDays }),
      nowReadiness: readinessOn({ members: list, log, planned: before, day: today, limit, windowDays }),
    });
  }
  rows.sort((x, y) => x.sendDay.localeCompare(y.sendDay) || x.audienceLabel.localeCompare(y.audienceLabel));
  return { rows, groups };
}

/**
 * Who is in each audience, as Sets of lowercased emails, from the HubSpot
 * contacts and the roster gates (contactRosters makeRosterGates). Kept apart
 * so nobody counts twice, the way Client Campaigns splits them:
 *   clients      on the Client roster
 *   keyContacts  tagged Dan Key Target, not at a client
 *   prospects    Decision Makers at a Tier 1-3 account, not Key, not client
 * Accounts the Clients tab flags as cancelling or Don't Track are left out.
 */
export function audienceMembers(contacts, gates) {
  const out = { clients: new Set(), keyContacts: new Set(), prospects: new Set() };
  if (!gates) return out;
  for (const c of contacts || []) {
    const em = String(c?.email || '').trim().toLowerCase();
    if (!em || gates.clientExclusionOf?.(c)) continue;
    if (gates.isClient(c)) out.clients.add(em);
    else if (gates.isKey(c)) out.keyContacts.add(em);
    else if (gates.isKeyProspect(c)) out.prospects.add(em);
  }
  return out;
}

/**
 * The weeks a month's calendar shows: rows of seven 'YYYY-MM-DD' days,
 * Sunday first, from the Sunday on or before the 1st through the Saturday
 * on or after the last day. `month` is 'YYYY-MM'.
 */
export function calendarWeeks(month) {
  const [y, m] = month.split('-').map(Number);
  return weeksSpanning(`${y}-${pad(m)}-01`, localDay(new Date(y, m, 0)));
}

/**
 * The whole weeks, Sunday first, that hold every day from `first` through
 * `last` ('YYYY-MM-DD'): the grid for a run of days that is not a month,
 * such as the next 60.
 */
export function weeksSpanning(first, last) {
  const [y, m, d] = first.split('-').map(Number);
  let day = addDays(first, -new Date(y, m - 1, d).getDay());
  const weeks = [];
  while (day <= last) {
    const week = [];
    for (let i = 0; i < 7; i += 1) { week.push(day); day = addDays(day, 1); }
    weeks.push(week);
  }
  return weeks;
}

/** 'YYYY-MM' plus `n` months (n may be negative). */
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/**
 * What the Email Schedule calendar puts on each day, from
 * buildEmailSchedule's { rows, groups }: Map<'YYYY-MM-DD', entry[]>.
 *   { kind: 'send', row }      a planned send, on its sendDay (an overdue
 *                              one sits on today, where it now counts)
 *   { kind: 'target', row }    the target date of a send planned too soon,
 *                              the day it would have to move to. A send
 *                              that is on track gets no marker: its target
 *                              is behind it and has nothing to say.
 *   { kind: 'open', group }    the audience's earliest day for a further
 *                              send after everything planned
 * Sends come first on a day, then targets, then open days.
 */
export function scheduleCalendarEntries({ rows, groups }) {
  const byDay = new Map();
  const put = (day, entry) => {
    if (!day) return;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
  };
  for (const row of rows || []) put(row.sendDay, { kind: 'send', row });
  for (const row of rows || []) if (row.early) put(row.target, { kind: 'target', row });
  for (const group of groups || []) put(group.nextTarget, { kind: 'open', group });
  return byDay;
}
