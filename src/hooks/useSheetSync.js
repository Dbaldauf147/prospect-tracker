import { useEffect, useRef } from 'react';
import { collection, writeBatch, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { usesSharedProspects } from '../utils/firestoreSync';
import { newSheetRows } from '../utils/sheetSyncDiff';
import { autoSyncSchedule, readSheetSync, LEGACY_STAMP_KEY } from '../utils/sheetSyncSettings';
import { userLsGet, userLsSet } from '../utils/userLs';

const VALID_FRAMEWORKS = new Set(['RECA', 'CSRD', 'CDP', 'GRESB', 'SBT', 'Ecovadis', 'UN PRI', 'CA SB', 'NZAM']);

// When the additive import last ran, for THIS ACCOUNT rather than this
// browser. It used to be a localStorage stamp, so a machine that had
// never run one saw no stamp at all and imported the moment it loaded,
// however recently another machine had already done it — and every extra
// device added its own unthrottled timer on top.
//
// Its own document rather than a field on the settings document: it is
// rewritten on every completed pass, and putting a value that churns
// that often onto the settings document would bump the _lastWriteAt that
// every cross-device settings save is compared against, sending ordinary
// edits down the stale-merge path and re-rendering the app on each tick.
function autoSyncClockRef(userId) {
  return doc(db, 'userSettings', userId, 'syncState', 'sheetAutoSync');
}

function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field); field = '';
        if (ch === '\r') i++;
        rows.push(current); current = [];
      } else field += ch;
    }
  }
  if (field || current.length > 0) { current.push(field); rows.push(current); }
  return rows;
}

function parseNumber(val) {
  if (!val || val.trim() === '' || val === 'Missing Data') return null;
  const n = parseFloat(val.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function parseFrameworks(val) {
  if (!val) return [];
  return val.split(',').map(s => s.trim()).filter(f => VALID_FRAMEWORKS.has(f));
}

function parseAssetTypes(val) {
  if (!val) return [];
  return val.split(',').map(s => s.trim()).filter(Boolean).filter(s =>
    s !== 'Strategic Account' && s !== 'Largest' && s.length > 1
  );
}

function parseProspectsFromCsv(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => { const key = h.trim(); if (key && !(key in idx)) idx[key] = i; });

  const prospects = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const company = (row[idx['Company']] || '').trim();
    if (!company) continue;
    // Status: use first "Status" column (idx ensures first-occurrence).
    // If the value is TRUE/FALSE/#N/A, it came from the wrong column — ignore it.
    let status = (row[idx['Status']] || '').trim();
    const BAD_STATUS = new Set(['TRUE', 'FALSE', '#N/A', '#REF!', '#VALUE!', '#NAME?']);
    if (BAD_STATUS.has(status.toUpperCase())) {
      // Try column C (index 2) directly as fallback
      const colC = (row[2] || '').trim();
      status = BAD_STATUS.has(colC.toUpperCase()) ? '' : colC;
    }

    prospects.push({
      company,
      cdm: (row[idx['CDM']] || '').trim(),
      status,
      type: (row[idx['Type']] || '').trim(),
      geography: (row[idx['Geography']] || '').trim(),
      publicPrivate: (row[idx['Public/ Private']] || row[idx['Public/Private']] || '').trim(),
      assetTypes: parseAssetTypes(row[idx['Asset Types']]),
      peAum: parseNumber(row[idx['PE AUM (billions)']]),
      reAum: parseNumber(row[idx['RE AUM (billions)']]),
      numberOfSites: parseNumber(row[idx['Number of Sites']]),
      rank: (row[idx['Rank']] || '').trim(),
      tier: (row[idx['Tier']] || '').trim(),
      hqRegion: (row[idx['HQ Region']] || '').trim(),
      frameworks: parseFrameworks(row[idx['Frameworks']]),
      notes: (row[idx['Notes']] || '').trim(),
      bfoCompanyId: (row[idx['BFO Company ID']] || '').trim(),
      bfoCompanyName: (row[idx['BFO Company Name']] || '').trim(),
      zoomCompanyId: (row[idx['Zoom Company ID']] || '').trim(),
      zoomCompanyName: (row[idx['Zoom Company Name']] || '').trim(),
      website: (row[idx['Zoom Webiste']] || row[idx['Zoom Website']] || row[idx['Website']] || '').trim(),
      emailDomain: (row[idx['Email Domain']] || '').trim(),
      contacts: parseNumber(row[idx['Contacts']]),
      contactTypes: (row[idx['Contact Types']] || '').trim(),
      salesperson: (row[idx['Salesperson Tiered List']] || '').trim(),
      peOrRe: (row[idx['PE OR RE']] || '').trim(),
      tierList: (row[idx['Tier List']] || '').trim(),
    });
  }
  return prospects;
}

// Additive-only import from the configured Google Sheet, on a timer.
//
// `prospects` is the live roster the app already subscribes to, and
// `prospectsLoaded` says that subscription has delivered. This used to
// re-read the whole `prospects` collection from Firestore on every tick
// purely to build the "which companies do we already have" map — a full
// collection read every 5 minutes, per open tab, forever, whether or not
// the sheet had changed. On a few hundred prospects that is six figures
// of reads a day and it exhausts the project's Firestore quota, at which
// point every read in the app starts coming back RESOURCE_EXHAUSTED. The
// subscription already holds the same rows, so the map is built from
// memory and the tick costs nothing until there is genuinely a new row
// to write.
export function useSheetSync(user, prospects = [], prospectsLoaded = false, settings = null, settingsLoaded = false) {
  const syncingRef = useRef(false);
  // Read through refs so the effect keeps its [user] dependency: adding
  // `prospects` to the deps would tear down and re-arm the timer on every
  // roster change, and re-run the sync on each one.
  const prospectsRef = useRef(prospects);
  prospectsRef.current = prospects;
  const loadedRef = useRef(prospectsLoaded);
  loadedRef.current = prospectsLoaded;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const settingsLoadedRef = useRef(settingsLoaded);
  settingsLoadedRef.current = settingsLoaded;
  // The shared clock, kept live by a subscription rather than re-read on
  // each tick: the tick fires every minute, and a read per tick per tab
  // is the shape of the full-collection read that exhausted the project's
  // Firestore quota before. A subscription costs a read only when the
  // value actually changes — which is once per completed pass.
  const lastSyncAtRef = useRef(0);
  const clockReadyRef = useRef(false);

  useEffect(() => {
    if (!user) return undefined;
    clockReadyRef.current = false;
    lastSyncAtRef.current = 0;
    return onSnapshot(autoSyncClockRef(user.uid), (snap) => {
      lastSyncAtRef.current = Number(snap.data()?.lastAutoSyncAt) || 0;
      clockReadyRef.current = true;
    }, (err) => {
      // Can't read the shared clock (rules not released yet, offline).
      // Fall back to this browser's old stamp rather than either running
      // unthrottled or never running at all.
      console.warn('Sheet auto-sync clock unavailable, using the local stamp:', err?.message || err);
      lastSyncAtRef.current = Number(userLsGet(LEGACY_STAMP_KEY)) || 0;
      clockReadyRef.current = true;
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;

    // Record that a pass just finished. The local mirror is set first so
    // the next tick (a minute away) is throttled whether or not the
    // subscription has echoed the write back yet.
    async function stampRun(userId) {
      const now = Date.now();
      lastSyncAtRef.current = now;
      try {
        await setDoc(autoSyncClockRef(userId), { lastAutoSyncAt: now }, { merge: true });
      } catch (err) {
        // Same fallback as a failed read: keep the browser's own stamp so
        // this device still throttles itself.
        console.warn('Could not record the sheet auto-sync time:', err?.message || err);
        userLsSet(LEGACY_STAMP_KEY, String(now));
      }
    }

    async function autoSync() {
      // The roster hasn't arrived yet: every sheet row would look new and
      // the import would re-add the entire sheet as duplicates.
      if (!loadedRef.current) return;
      // Neither has the configuration, which now lives on the settings
      // document. Running before it lands would read as "no sheet
      // configured" and quietly skip.
      if (!settingsLoadedRef.current) return;
      // Nor has the shared clock. Running before it lands is exactly the
      // unthrottled first pass this is here to prevent.
      if (!clockReadyRef.current) return;
      // The import writes into the shared `prospects` collection, so it only
      // makes sense for the account whose roster IS that collection. On a
      // per-user roster the two are different collections, and diffing one
      // against the other would read every sheet row as missing. (Before,
      // this was decided by the security rules rejecting the read.)
      if (!usesSharedProspects()) return;

      const config = readSheetSync(settingsRef.current);
      const { intervalMs } = autoSyncSchedule(settingsRef.current);
      if (!intervalMs) return; // No sheet configured, paused, or manual only
      const sheetsUrl = config.sheetsUrl;

      // Check if enough time has passed — on any of this account's
      // machines, not just this one.
      if (lastSyncAtRef.current && (Date.now() - lastSyncAtRef.current) < intervalMs) return;

      if (syncingRef.current) return;
      syncingRef.current = true;

      try {
        // Extract spreadsheet ID and build CSV URL
        const match = sheetsUrl.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (!match) return;
        const id = match[1];
        const sheetName = config.sheetName || 'Accounts';
        const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

        const res = await fetch(csvUrl);
        if (!res.ok) return;
        const csvText = await res.text();
        const sheetProspects = parseProspectsFromCsv(csvText);
        if (sheetProspects.length === 0) return;

        const roster = prospectsRef.current || [];
        const fresh = newSheetRows(sheetProspects, roster);

        // Nothing new — the steady state, most of the time. Stop here so a
        // tick against an unchanged sheet costs no Firestore I/O at all.
        if (fresh.length === 0) {
          await stampRun(user.uid);
          return;
        }

        for (let i = 0; i < fresh.length; i += 450) {
          const batch = writeBatch(db);
          for (const p of fresh.slice(i, i + 450)) {
            const ref = doc(collection(db, 'prospects'));
            batch.set(ref, { ...p, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          }
          await batch.commit();
        }

        await stampRun(user.uid);
        console.log(`Auto-sync from Google Sheets (additive-only): ${fresh.length} added, ${sheetProspects.length - fresh.length} existing rows preserved`);
      } catch (err) {
        console.error('Auto-sync error:', err);
      } finally {
        syncingRef.current = false;
      }
    }

    // Run on mount
    autoSync();

    // Check every minute (the sync function itself checks if enough time has passed)
    const interval = setInterval(autoSync, 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);
}
