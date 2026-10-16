// What the Prospecting > Tiered Activity subtab counts, loaded once for
// whichever subtab needs it: the HubSpot contacts, the email/call index the
// Activity tab writes, your tiered accounts and the newest activity on each.
// The History subtab uses it too, so visiting either one records the day's
// tile percentages (utils/tieredCoverageHistory.js) for History's chart.

import { useEffect, useMemo, useState } from 'react';
import { getHubspotCache } from '../utils/hubspotContactsCache';
import { userLsGet } from '../utils/userLs';
import { useAuth } from '../contexts/AuthContext';
import { SUBSTATUS_HOLD_STATUS } from '../utils/reportingStatus';
import {
  ACTIVE_FIRMS_DAYS, activeFirmsByBucket, lastActivityByAccount, myAccounts, myTieredAccounts,
} from '../utils/tieredAccountActivity';
import { recordActiveFirms } from '../utils/activeFirmsHistory';
import { recordTieredCoverage } from '../utils/tieredCoverageHistory';
import { todayISO } from '../utils/prospectingStatus';

// Where the Hide statuses choice is saved.
export const HIDDEN_STATUSES_KEY = 'prospectingTieredHiddenStatuses';
// The window the tiles count an account as active in, picked above them.
// Saved like the status choice, with a browser copy for the first paint.
export const WINDOW_DAYS_KEY = 'prospectingTieredWindowDays';
export const WINDOW_DAYS_CACHE = 'prospecting-tiered-window-days';
export const WINDOW_DAY_OPTIONS = [7, 14, 30, 60, 90, 120, 180, 365];
export const validWindow = (n) => (WINDOW_DAY_OPTIONS.includes(Number(n)) ? Number(n) : null);
export function readWindowCache() {
  try { return validWindow(localStorage.getItem(WINDOW_DAYS_CACHE)); } catch { return null; }
}
// The same choice cached in this browser, so a refresh shows it before the
// settings document has loaded (and still has it if a save never landed).
// Settings win once they arrive: they are what other devices see.
export const HIDDEN_STATUSES_CACHE = 'prospecting-tiered-hidden-statuses';
export function readHiddenCache() {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_STATUSES_CACHE));
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

// A company with a Substatus is on hold, whatever its Status says: the
// substatus is the reason it's parked. On these pages it reads, filters and
// counts as Hold Off, the same rule My Accounts and the Progress charts
// use (utils/reportingStatus). Only the reading changes; the record's
// Status is left as it is.
export const substatusOf = (p) => String(p?.substatus || '').trim();
export const statusOf = (p) => (substatusOf(p) ? SUBSTATUS_HOLD_STATUS : String(p?.status || '').trim());

function readOutreachIndex() {
  try { return JSON.parse(userLsGet('hubspot-outreach-index') || 'null'); } catch { return null; }
}

// The email/call index the Activity tab writes, re-read when it rewrites it
// (here or in another tab) and when the signed-in user changes.
export function useOutreachIndex(uid) {
  const [outreachIndex, setOutreachIndex] = useState(readOutreachIndex);
  useEffect(() => {
    const reload = () => setOutreachIndex(readOutreachIndex());
    const onStorage = (e) => { if (e.key && e.key.endsWith(':hubspot-outreach-index')) reload(); };
    reload();
    window.addEventListener('hubspot-activity-cache-updated', reload);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('hubspot-activity-cache-updated', reload);
      window.removeEventListener('storage', onStorage);
    };
  }, [uid]);
  return outreachIndex;
}

export function useTieredActivity({ prospects, settings, cdmName = '' }) {
  const { user } = useAuth() || {};
  const uid = user?.uid || '';

  // HubSpot contacts, re-read when a sync lands.
  const [contacts, setContacts] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => { if (!cancelled) setContacts([]); });
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, [uid]);

  const outreachIndex = useOutreachIndex(uid);

  const accounts = useMemo(() => myTieredAccounts(prospects, cdmName), [prospects, cdmName]);
  const localFields = settings?.contactLocalFields || null;
  const links = settings?.companyContactLinks || null;
  const exclusions = settings?.companyContactExclusions || null;
  const activity = useMemo(
    () => (contacts ? lastActivityByAccount({ accounts, contacts, outreachIndex, localFields, links, exclusions }) : null),
    [accounts, contacts, outreachIndex, localFields, links, exclusions],
  );
  const noIndex = !outreachIndex?.emails && !outreachIndex?.phones;

  return { contacts, outreachIndex, noIndex, accounts, activity, localFields, links, exclusions };
}

// Record today's tile percentages for the History chart. Only once the
// reading is real: contacts loaded and non-empty, the email/call index
// present (without it every account looks colder than it is) and at least
// one tiered account, so a half-loaded page never writes a dip.
export function useRecordTieredCoverage({ coverage, windowDays, contacts, noIndex, accounts }) {
  useEffect(() => {
    if (!coverage || noIndex || !contacts?.length || !accounts?.length) return;
    recordTieredCoverage(todayISO(), coverage, windowDays);
  }, [coverage, windowDays, contacts, noIndex, accounts]);
}

// Today's count of firms with activity in the last 120 days, per tier and
// untiered, recorded for History's bar chart under the same conditions as
// the coverage reading above. Returns the counts (null until they're real).
export function useRecordActiveFirms({ prospects, cdmName = '', contacts, outreachIndex, noIndex, localFields, links, exclusions }) {
  const firms = useMemo(() => myAccounts(prospects, cdmName), [prospects, cdmName]);
  const buckets = useMemo(() => {
    if (!contacts?.length || noIndex || !firms.length) return null;
    return activeFirmsByBucket({ accounts: firms, contacts, outreachIndex, localFields, links, exclusions });
  }, [firms, contacts, outreachIndex, noIndex, localFields, links, exclusions]);
  useEffect(() => {
    if (buckets) recordActiveFirms(todayISO(), buckets, ACTIVE_FIRMS_DAYS);
  }, [buckets]);
  return buckets;
}
