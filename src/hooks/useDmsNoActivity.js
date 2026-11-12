// The DMs Without Activity list (Prospecting > DMs Without Activity), as a
// hook so the Agents tab's BFO History task can walk the same companies the
// tab shows. One list per window chip; the chip the user last picked on the
// tab is remembered per browser and the Agents task follows it.
import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOpps2Data } from './useOpps2Data';
import { useRosterGates } from './useRosterTagCoverage';
import { useTieredActivity } from './useTieredActivity';
import { makeMyCdmContactAccount, makeMyCdmContactGate } from '../utils/myCdmContacts';
import { decisionMakersWithoutActivity, DMS_HIDDEN_ACCOUNT_STATUSES } from '../utils/tieredAccountActivity';

const WINDOW_KEY = 'prospecting-dms-no-activity:window';
// null is "no activity ever".
export const DMS_WINDOWS = [null, 30, 60, 90, 120];

export function readDmsWindow() {
  try {
    const v = localStorage.getItem(WINDOW_KEY);
    if (v === null || v === 'never') return null;
    const n = Number(v);
    return DMS_WINDOWS.includes(n) ? n : null;
  } catch { return null; }
}

export function writeDmsWindow(w) {
  try { localStorage.setItem(WINDOW_KEY, w == null ? 'never' : String(w)); } catch { /* per-viewer convenience only */ }
}

export const dmsWindowLabel = (w) => (w == null ? 'No activity ever' : `None in ${w} days`);

// { lists, accountOf, noIndex }. lists is a Map window -> [{ contact, lastMs }]
// (null while the contacts or roster gates are still loading). Decision
// makers at a Hold Off, Lost - Not Sold, Old Client or Client account are
// left off all of them.
export function useDmsNoActivity({ prospects, settings, cdmName = '' }) {
  const { user } = useAuth() || {};
  const { contacts, outreachIndex, noIndex, localFields } = useTieredActivity({ prospects, settings, cdmName });
  const oppsRecords = useOpps2Data(user?.uid)?.records ?? null;
  const gates = useRosterGates({ prospects, cdmName, oppsRecords, userId: user?.uid, connected: settings?.contactConnected || null });
  const myCdmGate = useMemo(() => makeMyCdmContactGate({ prospects: prospects || [], cdmName, localFields }), [prospects, cdmName, localFields]);
  const accountOf = useMemo(() => makeMyCdmContactAccount({ prospects: prospects || [], cdmName, localFields }), [prospects, cdmName, localFields]);

  const lists = useMemo(() => {
    if (!contacts || !gates) return null;
    return new Map(DMS_WINDOWS.map(w => [w, decisionMakersWithoutActivity({
      contacts, gates, myCdmGate, outreachIndex, localFields, days: w,
      accountOf, hiddenStatuses: DMS_HIDDEN_ACCOUNT_STATUSES,
    })]));
  }, [contacts, gates, myCdmGate, outreachIndex, localFields, accountOf]);

  return { lists, accountOf, noIndex };
}
