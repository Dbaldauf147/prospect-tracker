import { useEffect, useRef } from 'react';
import { collection, writeBatch, doc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

const SYNC_SETTINGS_KEY = 'prospect-sync-settings';
const LAST_AUTO_SYNC_KEY = 'prospect-last-auto-sync';
const DEFAULT_INTERVAL = 5 * 60 * 1000; // 5 minutes
const VALID_FRAMEWORKS = new Set(['GRESB', 'CDP', 'UN PRI', 'SBT', 'NZAM']);

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SYNC_SETTINGS_KEY)) || {}; } catch { return {}; }
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

export function useSheetSync(user) {
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!user) return;

    async function autoSync() {
      const settings = loadSettings();
      const sheetsUrl = settings.sheetsUrl;
      if (!sheetsUrl) return; // No sheet configured

      if (settings.mainPaused) return; // Paused
      const freqMin = settings.mainFreq ?? 5;
      if (freqMin === 0) return; // Manual only
      const intervalMs = freqMin * 60 * 1000;

      // Check if enough time has passed
      const lastSync = localStorage.getItem(LAST_AUTO_SYNC_KEY);
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

        // Get existing Firestore data
        const existing = await getDocs(collection(db, 'prospects'));
        const existingMap = new Map();
        for (const d of existing.docs) {
          existingMap.set((d.data().company || '').toLowerCase(), d);
        }

        // Last-edit-wins merge: if the website record was edited after the
        // last auto-sync, preserve those fields; otherwise take sheet values.
        const lastSyncTime = localStorage.getItem(LAST_AUTO_SYNC_KEY);
        const lastSyncDate = lastSyncTime ? new Date(parseInt(lastSyncTime)) : new Date(0);

        let updated = 0, added = 0, skipped = 0;
        for (let i = 0; i < sheetProspects.length; i += 450) {
          const batch = writeBatch(db);
          const chunk = sheetProspects.slice(i, i + 450);
          for (const p of chunk) {
            const key = (p.company || '').toLowerCase();
            const existingDoc = existingMap.get(key);
            if (existingDoc) {
              const existingData = existingDoc.data();
              const existingUpdated = existingData.updatedAt ? new Date(existingData.updatedAt) : new Date(0);
              const wasEditedOnWebsite = existingUpdated > lastSyncDate;

              if (wasEditedOnWebsite) {
                // Website was edited more recently than last sync — only fill empty fields
                const updates = {};
                let hasUpdates = false;
                for (const [field, val] of Object.entries(p)) {
                  if (field === 'updatedAt' || field === 'createdAt') continue;
                  const existing = existingData[field];
                  const isEmpty = existing == null || existing === '' || (Array.isArray(existing) && existing.length === 0);
                  const sheetHasData = val != null && val !== '' && !(Array.isArray(val) && val.length === 0);
                  if (isEmpty && sheetHasData) {
                    updates[field] = val;
                    hasUpdates = true;
                  }
                }
                if (hasUpdates) {
                  batch.update(existingDoc.ref, updates);
                  updated++;
                } else {
                  skipped++;
                }
              } else {
                // Sheet is newer — overwrite non-empty fields
                const updates = {};
                for (const [field, val] of Object.entries(p)) {
                  if (field === 'updatedAt' || field === 'createdAt') continue;
                  if (val != null && val !== '' && !(Array.isArray(val) && val.length === 0)) {
                    updates[field] = val;
                  }
                }
                updates.updatedAt = new Date().toISOString();
                batch.update(existingDoc.ref, updates);
                updated++;
              }
            } else {
              const ref = doc(collection(db, 'prospects'));
              batch.set(ref, { ...p, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
              added++;
            }
          }
          await batch.commit();
        }

        localStorage.setItem(LAST_AUTO_SYNC_KEY, String(Date.now()));
        console.log(`Auto-sync from Google Sheets: ${updated} updated, ${added} added, ${skipped} preserved (edited on website)`);
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
