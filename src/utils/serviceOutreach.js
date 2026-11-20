// Outreach by service: how much prospecting went out for each service, over
// time. Feeds the Draft Emails > Outreach by Service sub-tab.
//
// The source is the saved email campaigns (emailCampaigns/{uid}): a campaign
// is tagged with the services it is about (utils/campaignServices.js), and
// each roster row with a sentDate is one email that went out. A campaign
// tagged with two services counts toward both, since it was outreach for
// both; one with no services counts under NO_SERVICE.
//
// Pure: scripts/serviceOutreach.test.mjs runs it under plain Node.
import { campaignServices } from './campaignServices.js';

export const NO_SERVICE = 'No service tagged';

export const OUTREACH_PERIODS = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
];

export const OUTREACH_METRICS = [
  { key: 'sends', label: 'Emails sent', help: 'Every campaign email that went out' },
  { key: 'contacts', label: 'People', help: 'Different people emailed in the period' },
  { key: 'companies', label: 'Companies', help: 'Different companies emailed in the period' },
  { key: 'replies', label: 'Replies', help: 'Replies to those emails, dated by when they replied' },
];

export const OUTREACH_RANGES = [
  { key: '3m', label: '3M', months: 3 },
  { key: '6m', label: '6M', months: 6 },
  { key: '12m', label: '12M', months: 12 },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A date string or Date as a local Date, or null. "2026-11-03" is that day locally. */
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The first day of the period `d` falls in (weeks start Monday). */
export function periodStart(d, period) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (period === 'week') {
    const dow = (x.getDay() + 6) % 7; // Monday = 0
    x.setDate(x.getDate() - dow);
    return x;
  }
  if (period === 'quarter') return new Date(x.getFullYear(), Math.floor(x.getMonth() / 3) * 3, 1);
  return new Date(x.getFullYear(), x.getMonth(), 1);
}

function nextPeriod(d, period) {
  if (period === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  if (period === 'quarter') return new Date(d.getFullYear(), d.getMonth() + 3, 1);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

/** Axis label for a period's first day. */
export function periodLabel(start, period) {
  if (period === 'week') return `${MONTHS[start.getMonth()]} ${start.getDate()}`;
  if (period === 'quarter') return `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
  return `${MONTHS[start.getMonth()]} ${String(start.getFullYear()).slice(2)}`;
}

const addrs = (raw) => String(raw || '').split(/[;,]/).map(s => s.trim().toLowerCase()).filter(Boolean);

/**
 * One event per sent roster row per service the campaign is tagged with.
 * Returns [{ service, sentAt: Date, replyAt: Date|null, emails, company, campaign }].
 */
export function outreachEvents(campaigns) {
  const out = [];
  // One series per service whatever the case it was typed in on each
  // campaign: the first spelling seen names it.
  const canon = new Map();
  const name = (s) => {
    const k = s.toLowerCase();
    if (!canon.has(k)) canon.set(k, s);
    return canon.get(k);
  };
  for (const camp of campaigns || []) {
    const services = campaignServices(camp).map(name);
    const tags = services.length ? services : [NO_SERVICE];
    const campaign = String(camp?.title || camp?.subject || '').trim();
    for (const ct of camp?.contacts || []) {
      const sentAt = toDate(ct?.sentDate);
      if (!sentAt) continue;
      const replyAt = ct?.replied ? (toDate(ct?.replyDate) || sentAt) : null;
      const emails = addrs(ct?.email);
      const company = String(ct?.company || '').trim().toLowerCase();
      for (const service of tags) out.push({ service, sentAt, replyAt, emails, company, campaign });
    }
  }
  return out;
}

/** Every service the events name, biggest all-time sender first (the colour order). */
export function serviceOrder(events) {
  const n = new Map();
  for (const e of events || []) n.set(e.service, (n.get(e.service) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
}

/**
 * The window a range key stands for, as { from, to } local Dates (to is
 * inclusive). `all` runs from the first event; `custom` uses the given dates.
 */
export function rangeWindow(rangeKey, { now = new Date(), events = [], customFrom = '', customTo = '' } = {}) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const r = OUTREACH_RANGES.find(x => x.key === rangeKey);
  if (r?.months) return { from: new Date(today.getFullYear(), today.getMonth() - r.months, today.getDate() + 1), to: today };
  if (rangeKey === 'ytd') return { from: new Date(today.getFullYear(), 0, 1), to: today };
  if (rangeKey === 'custom') {
    const f = toDate(customFrom);
    const t = toDate(customTo);
    return { from: f || null, to: t || today };
  }
  let first = null;
  for (const e of events) if (!first || e.sentAt < first) first = e.sentAt;
  return { from: first, to: today };
}

/**
 * The chart's rows and the per-service totals for one view.
 *
 * events   outreachEvents(...)
 * services the series to count (others are ignored)
 * period   'week' | 'month' | 'quarter'
 * metric   'sends' | 'contacts' | 'companies' | 'replies'
 * from, to the window, inclusive (Dates)
 *
 * Returns {
 *   rows:   [{ period: 'YYYY-MM-DD', label, [service]: n, _total }]  every period in the window, zeros included
 *   totals: { [service]: n }   distinct across the whole window for people / companies
 *   total:  n                  the same, over every service at once
 * }
 */
export function outreachSeries({ events, services, period = 'month', metric = 'sends', from, to }) {
  const want = new Set(services || []);
  const lo = from ? new Date(from.getFullYear(), from.getMonth(), from.getDate()) : null;
  const hi = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) : null;
  const inWindow = (d) => d && (!lo || d >= lo) && (!hi || d < hi);

  // Period buckets: each holds a counter or a Set per service.
  const distinct = metric === 'contacts' || metric === 'companies';
  const buckets = new Map();
  const whole = new Map(); // service -> counter or Set, across the window
  const wholeAll = distinct ? new Set() : { n: 0 };
  const bump = (map, service, keys) => {
    if (distinct) {
      if (!map.has(service)) map.set(service, new Set());
      for (const k of keys) map.get(service).add(k);
    } else map.set(service, (map.get(service) || 0) + 1);
  };

  for (const e of events || []) {
    if (!want.has(e.service)) continue;
    const when = metric === 'replies' ? e.replyAt : e.sentAt;
    if (!inWindow(when)) continue;
    const keys = metric === 'companies'
      ? (e.company ? [e.company] : [])
      : e.emails;
    if (distinct && keys.length === 0) continue;
    const key = ymd(periodStart(when, period));
    if (!buckets.has(key)) buckets.set(key, new Map());
    bump(buckets.get(key), e.service, keys);
    bump(whole, e.service, keys);
    if (distinct) for (const k of keys) wholeAll.add(k);
    else wholeAll.n += 1;
  }

  const size = (v) => (v instanceof Set ? v.size : (v || 0));
  const rows = [];
  const startD = lo || (buckets.size ? toDate([...buckets.keys()].sort()[0]) : null);
  if (startD && hi) {
    // An all-time view over years of weeks would be thousands of bars; the
    // window is the caller's to keep sensible, but cap it so a stray range
    // can't lock the page.
    for (let d = periodStart(startD, period), guard = 0; d < hi && guard < 600; d = nextPeriod(d, period), guard += 1) {
      const key = ymd(d);
      const b = buckets.get(key);
      const row = { period: key, label: periodLabel(d, period), _total: 0 };
      for (const s of services || []) {
        const n = size(b?.get(s));
        row[s] = n;
        row._total += n;
      }
      rows.push(row);
    }
  }
  const totals = {};
  for (const s of services || []) totals[s] = size(whole.get(s));
  return { rows, totals, total: distinct ? wholeAll.size : wholeAll.n };
}

/** Each row's values as a share (0-100) of that row's total, for the 100% view. */
export function asShares(rows, services) {
  return (rows || []).map(r => {
    const t = (services || []).reduce((a, s) => a + (r[s] || 0), 0);
    const out = { ...r };
    for (const s of services || []) out[s] = t > 0 ? Math.round(((r[s] || 0) / t) * 1000) / 10 : 0;
    return out;
  });
}
