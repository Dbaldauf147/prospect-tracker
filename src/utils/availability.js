// Colleague availability for the opp popup's Availability tab.
//
// The app can't read anybody's calendar itself (no Azure app registration
// on the SE tenant, see the Activity page's Outlook note). A Power
// Automate flow running under the user's own account can: it asks
// /api/availability who to check, calls Graph's getSchedule through the
// Office 365 Outlook connector's "Send an HTTP request" action, and posts
// the answer back. getSchedule returns the same free/busy Outlook's
// Scheduling Assistant shows, nothing more.
//
// Everything here is pure so the server (normalising what the flow posts)
// and the tab (drawing the grid) share one reading of it.

// How far ahead the flow is asked to look, and how many people one
// getSchedule call is given. Graph documents no hard cap on schedules but
// throttles big ones; 20 keeps one call well inside it.
export const AVAILABILITY_WINDOW_DAYS = 14;
export const AVAILABILITY_MAX_PEOPLE = 20;
export const AVAILABILITY_SLOT_MINUTES = 30;
// The working day the grid draws, in the viewer's local time.
export const AVAILABILITY_DAY_START_HOUR = 8;
export const AVAILABILITY_DAY_END_HOUR = 18;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normEmail(v) {
  return String(v ?? '').trim().toLowerCase();
}

export function isValidEmail(v) {
  return EMAIL_RE.test(normEmail(v));
}

// Split a pasted line ("a@se.com; b@se.com, Name <c@se.com>") into
// addresses. Anything that isn't one is returned separately so the box
// can say what it couldn't read.
export function parseEmailList(text) {
  const good = [];
  const bad = [];
  for (const raw of String(text ?? '').split(/[;,\n]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const angled = part.match(/<([^>]+)>/);
    const e = normEmail(angled ? angled[1] : part);
    if (isValidEmail(e)) { if (!good.includes(e)) good.push(e); } else bad.push(part);
  }
  return { emails: good, invalid: bad };
}

// Everyone on any of the user's opps, deduped, in a stable order, capped
// at what one getSchedule call is given.
export function availabilityEmails(people) {
  const all = new Set();
  for (const list of Object.values(people || {})) {
    for (const e of list || []) if (isValidEmail(e)) all.add(normEmail(e));
  }
  return [...all].sort().slice(0, AVAILABILITY_MAX_PEOPLE);
}

// The window the flow is asked about: from the top of the current hour,
// AVAILABILITY_WINDOW_DAYS ahead, in UTC.
export function availabilityWindow(now = new Date()) {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// The body the flow hands straight to getSchedule.
export function getScheduleBody(emails, window) {
  const bare = (iso) => String(iso).replace(/\.\d{3}Z$|Z$/, '');
  return {
    schedules: emails,
    startTime: { dateTime: bare(window.start), timeZone: 'UTC' },
    endTime: { dateTime: bare(window.end), timeZone: 'UTC' },
    availabilityViewInterval: AVAILABILITY_SLOT_MINUTES,
  };
}

// Graph's { dateTime, timeZone } to an ISO instant. The flow asks for UTC,
// so a bare dateTime is UTC; one that already carries an offset is kept.
function graphTimeToIso(t) {
  const raw = typeof t === 'string' ? t : t?.dateTime;
  if (!raw) return null;
  const s = String(raw).trim();
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  const tz = String(t?.timeZone || 'UTC').toUpperCase();
  const d = new Date(hasZone || (tz !== 'UTC' && tz !== 'GMT' && tz !== 'COORDINATED UNIVERSAL TIME') ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const STATUSES = new Set(['free', 'tentative', 'busy', 'oof', 'workingelsewhere']);

function normStatus(s) {
  const t = String(s || '').replace(/\s+/g, '').toLowerCase();
  return STATUSES.has(t) ? t : 'busy';
}

// What the flow posted (getSchedule's `value`, or the whole response) to
// one entry per person: { email, items: [{ status, start, end, subject }],
// error }. Free items are dropped, the grid treats a gap as free.
export function normalizeSchedules(payload) {
  const list = Array.isArray(payload) ? payload : (Array.isArray(payload?.value) ? payload.value : []);
  const out = [];
  for (const s of list.slice(0, 50)) {
    const email = normEmail(s?.scheduleId || s?.email);
    if (!email) continue;
    const items = [];
    for (const it of (Array.isArray(s?.scheduleItems) ? s.scheduleItems : []).slice(0, 500)) {
      const status = normStatus(it?.status);
      if (status === 'free') continue;
      const start = graphTimeToIso(it?.start);
      const end = graphTimeToIso(it?.end);
      if (!start || !end || end <= start) continue;
      const subject = it?.isPrivate ? '' : String(it?.subject || '').slice(0, 200);
      items.push({ status, start, end, ...(subject ? { subject } : {}) });
    }
    items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const error = s?.error ? String(s.error.message || s.error.responseCode || 'Could not read this calendar').slice(0, 300) : '';
    out.push({ email, items, ...(error ? { error } : {}) });
  }
  return out;
}

// Worst first: a slot that is busy for one meeting and tentative for
// another reads as busy.
const RANK = { oof: 4, busy: 3, tentative: 2, workingelsewhere: 1, free: 0 };

export const STATUS_LABELS = {
  free: 'Free',
  tentative: 'Tentative',
  busy: 'Busy',
  oof: 'Out of office',
  workingelsewhere: 'Working elsewhere',
  unknown: 'No data yet',
};

// The weekdays in the window, as local midnights, for the day picker.
export function availabilityDays(window, now = new Date()) {
  const days = [];
  const from = new Date(Math.max(now.getTime(), new Date(window?.start || now).getTime()));
  const end = new Date(window?.end || from.getTime() + AVAILABILITY_WINDOW_DAYS * 864e5);
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  // Today's working day is over: start on tomorrow.
  if (from.getHours() >= AVAILABILITY_DAY_END_HOUR) d.setDate(d.getDate() + 1);
  while (d < end) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// The slots of one local working day: [{ start: Date, end: Date }].
export function daySlots(day, { startHour = AVAILABILITY_DAY_START_HOUR, endHour = AVAILABILITY_DAY_END_HOUR, slotMinutes = AVAILABILITY_SLOT_MINUTES } = {}) {
  const slots = [];
  const base = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour, 0, 0, 0);
  const stop = new Date(day.getFullYear(), day.getMonth(), day.getDate(), endHour, 0, 0, 0);
  for (let t = base.getTime(); t < stop.getTime(); t += slotMinutes * 60000) {
    slots.push({ start: new Date(t), end: new Date(t + slotMinutes * 60000) });
  }
  return slots;
}

// One person's status in one slot, and the meeting behind it.
export function slotStatus(schedule, slot) {
  if (!schedule || schedule.error) return { status: 'unknown', item: null };
  const s = slot.start.toISOString();
  const e = slot.end.toISOString();
  let best = { status: 'free', item: null };
  for (const it of schedule.items || []) {
    if (it.end <= s || it.start >= e) continue;
    if (RANK[it.status] > RANK[best.status]) best = { status: it.status, item: it };
  }
  return best;
}

// The grid for one day: a row per person and the slots everyone with a
// calendar on file is free (tentative and working-elsewhere count as
// free enough to propose; busy and out of office don't).
//
// A slot that has already ended is 'past' on the everyone row, so today's
// morning doesn't offer itself as a meeting time.
export function availabilityGrid(schedules, emails, day, opts, now = new Date()) {
  const byEmail = new Map((schedules || []).map(s => [normEmail(s.email), s]));
  const slots = daySlots(day, opts);
  const rows = emails.map(email => {
    const sched = byEmail.get(normEmail(email)) || null;
    return { email, schedule: sched, cells: slots.map(sl => slotStatus(sched, sl)) };
  });
  const known = rows.filter(r => r.schedule && !r.schedule.error);
  const everyone = slots.map((sl, i) => {
    if (sl.end.getTime() <= now.getTime()) return 'past';
    if (known.length === 0) return 'unknown';
    return known.every(r => RANK[r.cells[i].status] <= RANK.tentative) ? 'free' : 'busy';
  });
  return { slots, rows, everyone, knownCount: known.length };
}

// Runs of slots everyone is free, merged: [{ start, end }].
export function freeRanges(grid) {
  const out = [];
  grid.everyone.forEach((st, i) => {
    if (st !== 'free') return;
    const sl = grid.slots[i];
    const last = out[out.length - 1];
    if (last && last.end.getTime() === sl.start.getTime()) last.end = sl.end;
    else out.push({ start: sl.start, end: sl.end });
  });
  return out;
}
