// When a contact was added: the day HubSpot created the record (createdate),
// for the Contacts > History table. No React in here, so it can be tested.
import { parseHubspotDate } from './contactRosters.js';

// The windows the table's "Added" chips offer; null is any time.
export const ADDED_WINDOWS = [
  { days: null, label: 'Any time' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

// Epoch ms of the contact's create date, or null when HubSpot has none (a
// contact added by hand and not yet synced). Null rather than 0 so the
// table sorts it last instead of in 1970.
export function contactAddedMs(c) {
  const ms = parseHubspotDate(c?.createdate);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Whether a contact created at `ms` falls in the last `days` days. A contact
// with no create date is in no window.
export function addedWithin(ms, days, now = Date.now()) {
  if (ms == null) return false;
  return ms >= now - days * DAY_MS && ms <= now + DAY_MS;
}
