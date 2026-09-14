// One period's worth of HubSpot activity, fetched server-side.
//
// The Activity tab pages the *whole* HubSpot history (5k+ emails) because
// it is building a browsable grid. A scheduled report only ever needs one
// week, so this asks for that window directly with an hs_timestamp filter
// — a page or two instead of fifty.
//
// What comes back is shaped exactly like the browser's activity cache
// (flattened properties, a `fetchedAt` stamp) so utils/weeklyReport's
// computeActivity can count it with the same filters the tab counts with.
// Re-deriving "emails sent" here with a different rule is the one thing
// that would let the mailed figure and the on-screen figure disagree.

const BASE = 'https://api.hubapi.com';
const DAY_MS = 24 * 60 * 60 * 1000;

// The window is padded before the records are filtered exactly. A meeting
// is counted by hs_meeting_start_time, which can sit either side of the
// hs_timestamp this search filters on, and an email logged late carries a
// timestamp of when it was logged. computeActivity does the precise
// windowing afterwards, so the padding only costs a few extra rows.
const PAD_MS = 7 * DAY_MS;

// Enough pages for any plausible week; a runaway filter stops here rather
// than paging a whole history one hundred records at a time.
const MAX_PAGES = 30;
const PAGE = 100;

const PROPERTIES = {
  email: ['hs_email_subject', 'hs_email_status', 'hs_email_direction', 'hs_timestamp',
    'hs_email_to_email', 'hs_email_from_email', 'hs_email_to_firstname', 'hs_email_to_lastname',
    'hs_email_from_firstname', 'hs_email_from_lastname'],
  call: ['hs_call_title', 'hs_call_status', 'hs_call_direction', 'hs_call_duration',
    'hs_timestamp', 'hs_call_disposition'],
  meeting: ['hs_meeting_title', 'hs_meeting_start_time', 'hs_meeting_end_time',
    'hs_meeting_outcome', 'hs_timestamp'],
};
const OBJECTS = { email: 'emails', call: 'calls', meeting: 'meetings' };

// HubSpot's rate limiter answers 429; a burst clears in well under a
// second. Same climb the Activity route uses.
async function postRetrying(path, token, body, { fetchImpl = fetch, sleep } = {}) {
  const wait = sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const opts = {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  let res = await fetchImpl(`${BASE}${path}`, opts);
  for (let i = 0; i < 3 && (res.status === 429 || res.status >= 500); i += 1) {
    const after = Number(res.headers?.get?.('retry-after'));
    await wait(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 15000) : 500 * (2 ** i));
    res = await fetchImpl(`${BASE}${path}`, opts);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HubSpot API ${res.status}: ${String(text).slice(0, 200)}`);
  }
  return res.json();
}

async function fetchType(type, token, from, to, opts) {
  const objectType = OBJECTS[type];
  const out = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = {
      limit: PAGE,
      sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
      properties: PROPERTIES[type],
      filterGroups: [{
        filters: [
          { propertyName: 'hs_timestamp', operator: 'GTE', value: String(from) },
          { propertyName: 'hs_timestamp', operator: 'LTE', value: String(to) },
        ],
      }],
    };
    if (after) body.after = String(after);
    // Sequential by necessity: each page's cursor comes from the last.
    const data = await postRetrying(`/crm/v3/objects/${objectType}/search`, token, body, opts);
    for (const r of (data.results || [])) out.push({ id: r.id, type, ...r.properties });
    after = data.paging?.next?.after || null;
    if (!after) break;
  }
  return out;
}

/**
 * The emails, calls and meetings around a window, shaped like the browser's
 * `hubspot-activity-cache`. `fetchedAt` is stamped now, which is what makes
 * utils/weeklyActivityLog.liveCacheCovers treat it as an answer for the
 * window rather than a feed that predates it.
 *
 * Throws if HubSpot refuses — the caller decides whether to fall back to
 * the recorded weekly totals or give up on a live rebuild.
 */
export async function fetchActivityWindow(token, start, end, opts = {}) {
  if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN is not configured');
  const from = Math.max(0, Number(start) - PAD_MS);
  const to = Number(end) + PAD_MS;
  const [emails, calls, meetings] = await Promise.all([
    fetchType('email', token, from, to, opts),
    fetchType('call', token, from, to, opts),
    fetchType('meeting', token, from, to, opts),
  ]);
  return { emails, calls, meetings, fetchedAt: new Date().toISOString() };
}
