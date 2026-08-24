import { useEffect, useRef } from 'react';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { usesSharedProspects } from '../utils/firestoreSync';
import { newSheetRows } from '../utils/sheetSyncDiff';
import { userLsGet, userLsSet } from '../utils/userLs';

const SYNC_SETTINGS_KEY = 'prospect-sync-settings';
const LAST_AUTO_SYNC_KEY = 'prospect-last-auto-sync';
const DEFAULT_INTERVAL = 5 * 60 * 1000; // 5 minutes
const VALID_FRAMEWORKS = new Set(['RECA', 'CSRD', 'CDP', 'GRESB', 'SBT', 'Ecovadis', 'UN PRI', 'CA SB', 'NZAM']);

function loadSettings() {
  try { return JSON.parse(userLsGet(SYNC_SETTINGS_KEY)) || {}; } catch { return {}; }
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
export function useSheetSync(user, prospects = [], prospectsLoaded = false) {
  const syncingRef = useRef(false);
  // Read through refs so the effect keeps its [user] dependency: adding
  // `prospects` to the deps would tear down and re-arm the timer on every
  // roster change, and re-run the sync on each one.
  const prospectsRef = useRef(prospects);
  prospectsRef.current = prospects;
  const loadedRef = useRef(prospectsLoaded);
  loadedRef.current = prospectsLoaded;

  useEffect(() => {
    if (!user) return;

    async function autoSync() {
      // The roster hasn't arrived yet: every sheet row would look new and
      // the import would re-add the entire sheet as duplicates.
      if (!loadedRef.current) return;
      // The import writes into the shared `prospects` collection, so it only
      // makes sense for the account whose roster IS that collection. On a
      // per-user roster the two are different collections, and diffing one
      // against the other would read every sheet row as missing. (Before,
      // this was decided by the security rules rejecting the read.)
      if (!usesSharedProspects()) return;

      const settings = loadSettings();
      const sheetsUrl = settings.sheetsUrl;
      if (!sheetsUrl) return; // No sheet configured

      if (settings.mainPaused) return; // Paused
      const freqMin = settings.mainFreq ?? 5;
      if (freqMin === 0) return; // Manual only
      const intervalMs = freqMin * 60 * 1000;

      // Check if enough time has passed
      const lastSync = userLsGet(LAST_AUTO_SYNC_KEY);
      if (lastSync && (Date.now() - parseInt(lastSync)) < intervalMs) return;

      if (syncingRef.current) return;
      syncingRef.current = true;

      try {
        // Extract spreadsheet ID and build CSV URL
        const match = sheetsUrl.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (!match) return;
        const id = match[1];
        const sheetName = settings.sheetName || 'Accounts';
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
          userLsSet(LAST_AUTO_SYNC_KEY, String(Date.now()));
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

        userLsSet(LAST_AUTO_SYNC_KEY, String(Date.now()));
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
