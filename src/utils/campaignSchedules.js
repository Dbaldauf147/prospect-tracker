// Yearly email campaigns.
//
// Some campaigns come round every year: the holiday note, the budget-season
// check-in, the invite to the same conference. A schedule is the recipe for
// one of them - its title and subject lines, the month and day it should
// appear, and whether it starts from last year's contact list - and on or
// after that date each year the app creates the year's campaign on the
// Email Campaigns tab by itself.
//
// `{year}` in a title or subject line is replaced with the year being
// created, so "Holiday greetings {year}" becomes "Holiday greetings 2026".
// Without it every year's campaign would share one subject line, and the
// campaign report matches sent mail by subject, so the years would claim
// each other's sends.
//
// Schedules live in settings.campaignSchedules (they follow the user to
// their other machine). Each created campaign carries `scheduleId` and
// `scheduleYear`, which is what makes creation idempotent: a year that
// already has its campaign is never created twice, whichever device or tab
// gets there first.
//
// Everything here is pure (scripts/campaignSchedules.test.mjs).
import { normalizeSubjects, primarySubject, withSubjects, parseSubjectLines } from './campaignSubjects.js';
import { withEventUrl } from './campaignEventLink.js';
import { withoutInternalRows } from './campaignRoster.js';
import { responseRateOf } from './campaignContactHold.js';

export const SCHEDULES_SETTINGS_KEY = 'campaignSchedules';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const YEAR_TOKEN = /\{\s*year\s*\}/gi;

/** `text` with every {year} replaced by `year`. */
export function fillYear(text, year) {
  return String(text ?? '').replace(YEAR_TOKEN, String(year));
}

/** Does this text carry the {year} token? */
export function hasYearToken(text) {
  return new RegExp(YEAR_TOKEN.source, 'i').test(String(text ?? ''));
}

const pad = (n) => String(n).padStart(2, '0');

/** A Date as YYYY-MM-DD in local time - the user's calendar day. */
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysIn(year, month) {
  return new Date(year, month, 0).getDate();
}

/** The schedule's month (1-12) and day, clamped to something real. */
export function scheduleMonthDay(s) {
  const month = Math.min(12, Math.max(1, Math.round(Number(s?.month)) || 1));
  const day = Math.min(31, Math.max(1, Math.round(Number(s?.day)) || 1));
  return { month, day };
}

/**
 * The date (YYYY-MM-DD) the schedule creates its campaign in `year`. A day
 * past the end of the month lands on the month's last day, so Feb 29 is
 * Feb 28 in a common year rather than never.
 */
export function occurrenceDate(s, year) {
  const { month, day } = scheduleMonthDay(s);
  return `${year}-${pad(month)}-${pad(Math.min(day, daysIn(year, month)))}`;
}

/** "March 15" */
export function scheduleWhenLabel(s) {
  const { month, day } = scheduleMonthDay(s);
  return `${MONTH_NAMES[month - 1]} ${day}`;
}

export const isScheduleEnabled = (s) => s?.enabled !== false;

/** The schedule's subject lines, as stored (still carrying {year}). */
export function scheduleSubjects(s) {
  return normalizeSubjects(Array.isArray(s?.subjects) ? s.subjects : parseSubjectLines(s?.subjects || ''));
}

/** The campaign this schedule created for `year`, if any. */
export function campaignForYear(campaigns, scheduleId, year) {
  return (campaigns || []).find(c => c?.scheduleId === scheduleId && Number(c?.scheduleYear) === Number(year)) || null;
}

/** The most recent year this schedule has a campaign for, or null. */
export function lastCreatedYear(campaigns, scheduleId) {
  let best = null;
  for (const c of campaigns || []) {
    if (c?.scheduleId !== scheduleId) continue;
    const y = Number(c.scheduleYear);
    if (Number.isFinite(y) && (best == null || y > best)) best = y;
  }
  return best;
}

/**
 * When the schedule next creates a campaign, as YYYY-MM-DD: this year's date
 * if it is still ahead (or due and not yet created), else next year's.
 */
export function nextOccurrence(s, campaigns, today = localDay()) {
  const year = Number(today.slice(0, 4));
  const thisYear = occurrenceDate(s, year);
  // Still ahead, or come round already and about to be made: either way
  // this year's is the next one, unless it exists or predates the schedule.
  const pending = !campaignForYear(campaigns, s?.id, year)
    && (thisYear >= today || firstDueDay(s) <= thisYear);
  return pending ? thisYear : occurrenceDate(s, year + 1);
}

// The first calendar day the schedule may create on: the day it was set up.
// A schedule made on Oct 30 for Jan 15 waits for next January rather than
// back-filling this year's campaign the moment it is saved ("Create now" is
// there for that).
function firstDueDay(s) {
  return String(s?.createdOn || '').slice(0, 10) || '0000-00-00';
}

/** Is a campaign already using any of these subject lines? */
function subjectTaken(campaigns, subjects) {
  const want = new Set(subjects.map(x => x.toLowerCase()));
  return (campaigns || []).some(c => {
    const own = normalizeSubjects([c?.subject, ...(Array.isArray(c?.subjects) ? c.subjects : [])]);
    return own.some(x => want.has(x.toLowerCase()));
  });
}

/**
 * Where the new year's contacts come from: last year's campaign from this
 * schedule, else the campaign the schedule was set up from (`copyFrom`, a
 * primary subject line). Null when there is nothing to copy or copying is
 * off.
 */
export function contactSource(s, campaigns, year) {
  if (s?.carryContacts === false) return null;
  let prior = null;
  for (const c of campaigns || []) {
    if (c?.scheduleId !== s?.id) continue;
    const y = Number(c.scheduleYear);
    if (!(y < year)) continue;
    if (!prior || y > Number(prior.scheduleYear)) prior = c;
  }
  if (prior) return prior;
  const key = String(s?.copyFrom || '').trim().toLowerCase();
  if (!key) return null;
  return (campaigns || []).find(c => primarySubject(c).toLowerCase() === key) || null;
}

/**
 * A copied roster row: who they are and whether they are to be emailed,
 * with last year's activity (send, reply, RSVP, notes) left behind.
 */
function freshRow(c) {
  return {
    email: String(c?.email || '').trim(),
    name: String(c?.name || '').trim(),
    company: String(c?.company || '').trim(),
    sentDate: '', replied: false, eventStatus: '',
    recipientCount: Number(c?.recipientCount) || 1,
    outreach: c?.outreach || '', holdUntil: c?.holdUntil || '', notes: '',
  };
}

function counts(contacts) {
  const sent = contacts.filter(c => !!c?.sentDate).length;
  const replies = contacts.filter(c => c?.replied).length;
  return {
    totalContacts: contacts.length, sent, replies,
    uniqueRecipients: sent, uniqueRepliers: replies,
    responseRate: responseRateOf(contacts),
  };
}

/** The campaign `s` creates for `year`, built against the saved list. */
export function buildScheduledCampaign(s, year, campaigns, nowIso = new Date().toISOString()) {
  const subjects = scheduleSubjects(s).map(x => fillYear(x, year));
  const source = contactSource(s, campaigns, year);
  const contacts = source
    ? withoutInternalRows(source.contacts || []).map(freshRow).filter(r => r.email)
    : [];
  const campaign = withEventUrl(withSubjects({
    title: fillYear(s?.title, year).trim() || subjects[0] || '',
    savedAt: nowIso,
    ...counts(contacts),
    totalEmails: 0,
    autoRepliesSuppressed: 0,
    suppressed: null,
    removedEmails: [],
    contacts,
    scheduleId: s.id,
    scheduleYear: Number(year),
  }, subjects), fillYear(s?.eventUrl || '', year));
  if (source && Array.isArray(source.targetCompanies) && source.targetCompanies.length) {
    campaign.targetCompanies = source.targetCompanies.map(t => ({ ...t }));
  }
  return campaign;
}

/**
 * Why `s` can't create its `year` campaign right now, or '' when it can.
 * Shared by the automatic run and "Create now", so they refuse alike.
 */
export function cannotCreateReason(s, year, campaigns) {
  if (!s?.id) return 'This schedule has no id.';
  const subjects = scheduleSubjects(s).map(x => fillYear(x, year));
  if (!subjects.length) return 'Give the schedule a subject line.';
  if (campaignForYear(campaigns, s.id, year)) return `The ${year} campaign already exists.`;
  if (subjectTaken(campaigns, subjects)) return `A saved campaign already uses the subject "${subjects[0]}". Add {year} to the subject line so each year's is its own.`;
  return '';
}

/**
 * Every schedule whose date has come round this year without its campaign
 * being made. Disabled schedules, ones set up after this year's date, and
 * ones whose subject is already taken are left alone.
 */
export function dueSchedules(schedules, campaigns, today = localDay()) {
  const year = Number(today.slice(0, 4));
  return (schedules || []).filter(s => {
    if (!isScheduleEnabled(s)) return false;
    const date = occurrenceDate(s, year);
    if (date > today || date < firstDueDay(s)) return false;
    return !cannotCreateReason(s, year, campaigns);
  }).map(s => ({ schedule: s, year }));
}

/**
 * The saved list with every due schedule's campaign added (newest first,
 * the way a hand-made campaign goes in), plus the ones created.
 */
export function applyDueSchedules(campaigns, schedules, today = localDay(), nowIso = new Date().toISOString()) {
  let list = campaigns || [];
  const created = [];
  for (const { schedule, year } of dueSchedules(schedules, list, today)) {
    // Re-checked against the growing list: two schedules with the same
    // subject must not both go in.
    if (cannotCreateReason(schedule, year, list)) continue;
    const campaign = buildScheduledCampaign(schedule, year, list, nowIso);
    list = [campaign, ...list];
    created.push(campaign);
  }
  return { campaigns: list, created };
}

/** A new schedule's id. */
export function newScheduleId() {
  return `sch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Turn a campaign title or subject into a yearly template: a four-digit year
 * in it (this year or last) becomes {year}. "Holiday 2025" -> "Holiday {year}".
 */
export function templateFromText(text, year) {
  const s = String(text ?? '');
  if (hasYearToken(s)) return s;
  for (const y of [year, year - 1, year + 1]) {
    const re = new RegExp(`\\b${y}\\b`, 'g');
    if (re.test(s)) return s.replace(re, '{year}');
  }
  return s;
}
