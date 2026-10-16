// The Excel download behind Prospecting History's "Contacts with activity"
// charts: click a day on a roster's chart and get that roster's raw data.
//
//   Summary   the clicked day's counts per band, then every day on the chart
//   Contacts  everyone on the list, with their last HubSpot email, call or
//             contact and the band it puts them in
//
// The history keeps counts only (rosterActivityHistory.js), so the people
// are always today's list measured against today; on an earlier day the
// Summary says so. Pure: returns sheets as arrays of rows, the caller writes
// them with xlsx.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The band a last-activity time falls in, measured from `nowMs`. */
export function activityBand(lastMs, nowMs) {
  if (lastMs == null) return 'No activity in 120 days';
  const days = (nowMs - lastMs) / MS_PER_DAY;
  if (days <= 30) return 'Last 30 days';
  if (days <= 90) return '31-90 days';
  if (days <= 120) return '91-120 days';
  return 'No activity in 120 days';
}

const BAND_ORDER = ['Last 30 days', '31-90 days', '91-120 days', 'No activity in 120 days'];

const nameOf = (c) => String(c?.name || [c?.firstname, c?.lastname].filter(Boolean).join(' ') || '').trim();

const share = (n, total) => (n == null || !total ? null : Math.round((n / total) * 1000) / 10);

// A chart row's four band counts, or nulls where the day wasn't recorded
// (or was recorded before the 90-day window was tracked).
function bandCounts(r) {
  if (!r?.recorded || r.w30 == null || r.w90 == null || r.w120 == null || r.total == null) return null;
  return [r.w30, r.w90 - r.w30, r.w120 - r.w90, r.total - r.w120];
}

/**
 * { filename, sheets: [{ name, rows }] } for one roster.
 *   label    the roster's name ("Dan Key Target")
 *   day      the clicked chart row ({ iso, label, weekday, ... })
 *   data     every chart row, oldest first
 *   people   [{ contact, lastMs }] on the roster today (rosterActivityPeople)
 *   today    YYYY-MM-DD
 */
export function rosterActivityWorkbook({ label, day, data = [], people = [], today, nowMs = Date.now() }) {
  const summary = [[`${label}: contacts with activity`], [`Day clicked: ${day?.weekday ? `${day.weekday}, ` : ''}${day?.iso || ''}`]];
  const counts = bandCounts(day);
  if (day?.iso !== today) {
    summary.push(['The history keeps the counts for each day only, so the Contacts sheet is today\'s list measured against today.']);
  }
  summary.push([]);
  summary.push(['Band', 'Contacts', '% of the list']);
  if (counts) {
    BAND_ORDER.forEach((b, i) => summary.push([b, counts[i], share(counts[i], day.total)]));
    summary.push(['On the list', day.total, 100]);
  } else {
    summary.push([day?.recorded ? 'Recorded before the 90-day window was tracked' : 'Not recorded']);
  }
  summary.push([]);
  summary.push(['Every day on the chart']);
  summary.push(['Date', 'Recorded', 'On the list', ...BAND_ORDER, ...BAND_ORDER.map(b => `${b} %`)]);
  for (const r of data) {
    const c = bandCounts(r);
    summary.push([
      r.iso, r.recorded ? 'Yes' : 'No', r.total ?? null,
      ...(c || [null, null, null, null]),
      ...(c ? c.map(n => share(n, r.total)) : [null, null, null, null]),
    ]);
  }

  const contacts = [['Name', 'Email', 'Company', 'Title', 'Phone', 'Last activity', 'Days since', 'Band']];
  const sorted = [...people].sort((a, b) => (b.lastMs ?? -Infinity) - (a.lastMs ?? -Infinity) || nameOf(a.contact).localeCompare(nameOf(b.contact)));
  for (const { contact: c, lastMs } of sorted) {
    contacts.push([
      nameOf(c), c?.email || '', c?.company || '', c?.jobtitle || '', c?.phone || c?.mobilephone || '',
      lastMs == null ? '' : isoOf(lastMs),
      lastMs == null ? null : Math.max(0, Math.floor((nowMs - lastMs) / MS_PER_DAY)),
      activityBand(lastMs, nowMs),
    ]);
  }

  const slug = String(label || 'roster').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    filename: `${slug}-activity-${day?.iso || today}.xlsx`,
    sheets: [{ name: 'Summary', rows: summary }, { name: 'Contacts', rows: contacts }],
  };
}
