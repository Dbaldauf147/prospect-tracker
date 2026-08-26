import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { addProspectsIfNew, readAllProspects } from '../utils/firestoreSync';
import { userLsGet } from '../utils/userLs';
import { readSheetSync, SHEET_SYNC_KEY } from '../utils/sheetSyncSettings';
import { spreadsheetIdFromUrl as extractSpreadsheetId } from '../utils/sheetCompanyRename';
import { companyDedupeKey } from '../utils/companyKey.js';
import { getOppsSheetDisplayUrl } from '../utils/oppsSheetUrl';
import { useAuth } from '../contexts/AuthContext';
import styles from './SyncPanel.module.css';


const VALID_FRAMEWORKS = new Set(['RECA', 'CSRD', 'CDP', 'GRESB', 'SBT', 'Ecovadis', 'UN PRI', 'CA SB', 'NZAM']);

function parseProspectsFromSheetData(rows) {
  // rows is an array of prospect objects from the API
  return rows;
}

function csvFromProspects(prospects) {
  const headers = [
    'Company', 'CDM', 'Status', 'Type', 'Geography', 'Public/Private',
    'Asset Types', 'PE AUM (billions)', 'RE AUM (billions)', 'Number of Sites',
    'Rank', 'Tier', 'HQ Region', 'Frameworks', 'Notes', 'Website', 'Email Domain',
  ];
  const escape = (val) => {
    const str = val == null ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  };
  const rows = [headers.map(escape).join(',')];
  for (const p of prospects) {
    rows.push([
      p.company, p.cdm, p.status, p.type, p.geography, p.publicPrivate,
      (p.assetTypes || []).join(', '), p.peAum, p.reAum, p.numberOfSites,
      p.rank, p.tier, p.hqRegion, (p.frameworks || []).join(', '),
      p.notes, p.website, p.emailDomain,
    ].map(escape).join(','));
  }
  return rows.join('\n');
}

// The sheet configuration lives on the user's settings document (see
// utils/sheetSyncSettings) rather than in this browser's localStorage, so
// signing in on another computer finds the sync already set up instead of
// a blank panel. `settings` / `updateSettings` are the app's own, which
// makes every edit here a Firestore write that reaches the other devices.
export function SyncPanel({ prospects, onClose, settings: userSettings, updateSettings }) {
  const { isAdmin } = useAuth();
  // Local mirror of the stored configuration, so the panel's many
  // handlers keep editing one object. Re-seeded whenever the settings
  // document changes, which is how an edit made on another computer
  // shows up here.
  const [settings, setSettings] = useState(() => readSheetSync(userSettings));
  const storedSheetSync = userSettings?.[SHEET_SYNC_KEY];
  // Keyed on the sheet-sync value rather than the whole settings object,
  // which changes identity on every unrelated settings write in the app.
  useEffect(() => { setSettings(readSheetSync(userSettings)); }, [storedSheetSync]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveSettings = useCallback((next) => {
    if (updateSettings) updateSettings({ [SHEET_SYNC_KEY]: next });
  }, [updateSettings]);
  // The OppsView/AgentsView/ProgressView Opps sheet URL is resolved
  // via getOppsSheetCsvUrl elsewhere — here we just display it so the
  // user can see what's being pulled. It is a key on the settings
  // document (settings.oppsSheetUrl), not part of the sheet-sync config,
  // so it reads from userSettings — passing the sync config here meant a
  // user who had set their own URL never saw it.
  const oppsSheetDisplayUrl = getOppsSheetDisplayUrl({ isAdmin, settings: userSettings });
  const [url, setUrl] = useState(settings.sheetsUrl || '');
  const [sheetName, setSheetName] = useState(settings.sheetName || 'Accounts');
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(settings.lastSync || null);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');

  const FREQ_OPTIONS = [
    { value: 1, label: '1 min' },
    { value: 5, label: '5 min' },
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
    { value: 60, label: '1 hour' },
    { value: 1440, label: 'Daily (midnight)' },
    { value: 0, label: 'Manual only' },
  ];

  // All connected sheets: main + any extras
  const connectedSheets = [
    ...(settings.sheetsUrl ? [{
      label: 'Table View (Accounts)',
      url: settings.sheetsUrl,
      sheetName: settings.sheetName || 'Accounts',
      lastSync: settings.lastSync,
      type: 'main',
      freq: settings.mainFreq ?? 5,
      paused: !!settings.mainPaused,
    }] : []),
    ...(oppsSheetDisplayUrl ? [{
      label: 'Opps - Old',
      url: oppsSheetDisplayUrl,
      sheetName: 'Opps',
      lastSync: userLsGet('opps-cache') ? (() => { try { return JSON.parse(userLsGet('opps-cache'))?.fetchedAt; } catch { return null; } })() : null,
      type: 'opps',
      freq: settings.oppsFreq ?? 5,
      paused: !!settings.oppsPaused,
    }] : []),
    ...(settings.extraSheets || []).map(s => ({ ...s, type: 'extra' })),
  ];

  function updateFreq(type, idx, value) {
    const freq = parseInt(value);
    if (type === 'main') {
      const s = { ...settings, mainFreq: freq };
      setSettings(s);
      saveSettings(s);
    } else if (type === 'opps') {
      const s = { ...settings, oppsFreq: freq };
      setSettings(s);
      saveSettings(s);
    } else if (type === 'extra') {
      const extras = [...(settings.extraSheets || [])];
      extras[idx] = { ...extras[idx], freq };
      const s = { ...settings, extraSheets: extras };
      setSettings(s);
      saveSettings(s);
    }
  }

  function saveUrl() {
    const s = { ...settings, sheetsUrl: url.trim(), sheetName: sheetName.trim() };
    setSettings(s);
    saveSettings(s);
    setStatus({ type: 'success', message: 'Google Sheets URL saved' });
  }

  function addExtraSheet() {
    if (!newUrl.trim() || !newName.trim()) return;
    const extras = settings.extraSheets || [];
    const entry = { label: newName.trim(), url: newUrl.trim(), sheetName: 'Sheet1', lastSync: null };
    const s = { ...settings, extraSheets: [...extras, entry] };
    setSettings(s);
    saveSettings(s);
    setNewUrl('');
    setNewName('');
    setStatus({ type: 'success', message: `Added "${entry.label}"` });
  }

  function togglePause(type, idx) {
    if (type === 'main') {
      const s = { ...settings, mainPaused: !settings.mainPaused };
      setSettings(s);
      saveSettings(s);
    } else if (type === 'opps') {
      const s = { ...settings, oppsPaused: !settings.oppsPaused };
      setSettings(s);
      saveSettings(s);
    } else if (type === 'extra') {
      const extras = [...(settings.extraSheets || [])];
      extras[idx] = { ...extras[idx], paused: !extras[idx].paused };
      const s = { ...settings, extraSheets: extras };
      setSettings(s);
      saveSettings(s);
    }
  }

  function removeExtraSheet(idx) {
    const extras = [...(settings.extraSheets || [])];
    extras.splice(idx, 1);
    const s = { ...settings, extraSheets: extras };
    setSettings(s);
    saveSettings(s);
  }

  function handleExportCsv() {
    const csv = csvFromProspects(prospects);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus({ type: 'success', message: `Exported ${prospects.length} prospects as CSV` });
  }

  async function handleTwoWaySync() {
    const spreadsheetId = extractSpreadsheetId(url);
    if (!spreadsheetId) {
      setStatus({ type: 'error', message: 'Invalid Google Sheets URL. Make sure it looks like: https://docs.google.com/spreadsheets/d/...' });
      return;
    }

    setSyncing(true);
    setStatus({ type: 'loading', message: `Step 1/3: Reading from Google Sheets (ID: ${spreadsheetId.slice(0, 8)}..., sheet: ${sheetName})...` });

    try {
      // 1. Read from Google Sheets
      const readRes = await apiFetch(`/api/sheets-sync?spreadsheetId=${spreadsheetId}&sheetName=${encodeURIComponent(sheetName)}&_t=${Date.now()}`);
      if (!readRes.ok) {
        const text = await readRes.text();
        throw new Error(`Sheets API returned ${readRes.status}: ${text.slice(0, 200)}`);
      }
      const readData = await readRes.json();
      if (readData.error) throw new Error(readData.error);
      const sheetProspects = readData.prospects || [];

      setStatus({ type: 'loading', message: `Step 2/3: Merging ${sheetProspects.length} sheet rows with ${prospects.length} website rows...` });

      // 2. Merge: build a combined list keyed by company name (lowercase)
      // Website data is the source of truth for matching records; sheet fills gaps
      const merged = new Map();
      // Second index over the same entries, keyed by companyDedupeKey —
      // the key the app uses everywhere else to decide two names are one
      // company. Matching on the lowercased name alone read every
      // spelling variant as a company the site was missing ("Lend Lease"
      // against a roster holding "LendLease"), and each one it "added"
      // became a second account with none of the first one's Target
      // Account / divisions / HQ mappings. The exact-name index stays the
      // first thing consulted so an unambiguous match is never routed
      // through the fuzzier one.
      const byDedupeKey = new Map();
      const indexEntry = (key, entry) => {
        const dk = companyDedupeKey(entry.company);
        if (dk && !byDedupeKey.has(dk)) byDedupeKey.set(dk, entry);
        merged.set(key, entry);
      };

      // Start with website data
      for (const p of prospects) {
        const key = (p.company || '').toLowerCase();
        if (key) indexEntry(key, { ...p });
      }

      // Merge in sheet data: add new records, update fields that are empty on website
      let sheetsAdded = 0;
      let sheetsUpdated = 0;
      for (const sp of sheetProspects) {
        const key = (sp.company || '').toLowerCase();
        if (!key) continue;
        const existing = merged.get(key) || byDedupeKey.get(companyDedupeKey(sp.company));
        if (existing) {
          // Merge: for each field, if website version is empty but sheet has data, use sheet
          let changed = false;
          for (const field of ['cdm', 'status', 'type', 'geography', 'publicPrivate', 'tier', 'hqRegion', 'rank', 'notes']) {
            if (!existing[field] && sp[field]) {
              existing[field] = sp[field];
              changed = true;
            }
          }
          for (const field of ['peAum', 'reAum', 'numberOfSites']) {
            if (existing[field] == null && sp[field] != null) {
              existing[field] = sp[field];
              changed = true;
            }
          }
          for (const field of ['assetTypes', 'frameworks']) {
            if ((!existing[field] || existing[field].length === 0) && sp[field]?.length > 0) {
              existing[field] = sp[field];
              changed = true;
            }
          }
          if (changed) sheetsUpdated++;
        } else {
          indexEntry(key, { ...sp });
          sheetsAdded++;
        }
      }

      const mergedList = Array.from(merged.values());

      // 3. Write merged data back to Google Sheets (merge mode preserves formulas)
      // Skip Firestore bulk write — the auto-sync hook (useSheetSync) handles
      // pulling from Sheets into Firestore on its own schedule. Writing 4000+
      // docs in batch triggers the real-time listener and freezes the browser.
      setStatus({ type: 'loading', message: `Step 3/3: Writing ${mergedList.length} prospects back to Google Sheets...` });
      const writeRes = await apiFetch('/api/sheets-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId,
          sheetName,
          mode: 'merge',
          prospects: mergedList,
        }),
      });
      const writeData = await writeRes.json();
      if (writeData.error) throw new Error(writeData.error);

      const syncTime = new Date().toISOString();
      const s = { ...settings, sheetsUrl: url.trim(), sheetName, lastSync: syncTime };
      setSettings(s);
      saveSettings(s);
      setLastSync(syncTime);

      setStatus({
        type: 'success',
        message: `Synced! ${mergedList.length} total prospects. ${sheetsAdded} added from Sheets, ${sheetsUpdated} enriched from Sheets. Both sides updated.`
      });
    } catch (err) {
      console.error('Sync error:', err);
      setStatus({ type: 'error', message: `Sync failed: ${err.message}` });
    } finally {
      setSyncing(false);
    }
  }

  async function handlePushToSheets() {
    const spreadsheetId = extractSpreadsheetId(url);
    if (!spreadsheetId) {
      setStatus({ type: 'error', message: 'Invalid Google Sheets URL' });
      return;
    }

    setSyncing(true);
    setStatus({ type: 'loading', message: 'Pushing website data to Google Sheets...' });

    try {
      const res = await apiFetch('/api/sheets-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId,
          sheetName,
          mode: 'merge',
          prospects,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const now = new Date().toISOString();
      saveSettings({ ...settings, lastSync: now });
      setLastSync(now);
      setStatus({ type: 'success', message: `Pushed to Sheets: ${data.updated} updated, ${data.added} added` });
    } catch (err) {
      setStatus({ type: 'error', message: `Push failed: ${err.message}` });
    } finally {
      setSyncing(false);
    }
  }

  async function handlePullFromSheets() {
    const spreadsheetId = extractSpreadsheetId(url);
    if (!spreadsheetId) {
      setStatus({ type: 'error', message: 'Invalid Google Sheets URL' });
      return;
    }

    setSyncing(true);
    setStatus({ type: 'loading', message: 'Pulling data from Google Sheets...' });

    try {
      const res = await apiFetch(`/api/sheets-sync?spreadsheetId=${spreadsheetId}&sheetName=${encodeURIComponent(sheetName)}&_t=${Date.now()}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const parsed = data.prospects || [];
      if (parsed.length === 0) {
        setStatus({ type: 'error', message: 'No prospects found in Google Sheets' });
        setSyncing(false);
        return;
      }

      setStatus({ type: 'loading', message: `Merging ${parsed.length} rows into database...` });

      // Read the roster straight from Firestore rather than trusting the
      // subscription's copy: this button can be pressed before that has
      // delivered, and an empty roster would read every sheet row as
      // missing. Additive-only — an existing row is never overwritten
      // from Sheets.
      //
      // The decision and the writes both belong to addProspectsIfNew, so
      // this button uses the same "same company?" rule as everything else.
      // It used to compare lowercased names character for character here,
      // which made a second account out of every spelling variant.
      const roster = await readAllProspects();
      const { added, skipped } = await addProspectsIfNew(parsed, roster);

      const now = new Date().toISOString();
      saveSettings({ ...settings, lastSync: now });
      setLastSync(now);
      setStatus({ type: 'success', message: `Added ${added} new rows from Sheets · ${skipped} existing rows left untouched` });
    } catch (err) {
      setStatus({ type: 'error', message: `Pull failed: ${err.message}` });
    } finally {
      setSyncing(false);
    }
  }

  const hasUrl = url.trim() && extractSpreadsheetId(url.trim());

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Google Sheets Sync</h2>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.body}>
          {/* Connected Sheets Overview */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Connected Sheets</h3>
            <p className={styles.sectionDesc}>All Google Sheets synced with this website.</p>
            {connectedSheets.length > 0 ? (
              <div className={styles.sheetsList}>
                {connectedSheets.map((sheet, i) => {
                  const extraIdx = i - (settings.sheetsUrl ? 1 : 0) - 1;
                  return (
                    <div key={i} className={styles.sheetItem}>
                      <div className={styles.sheetItemInfo}>
                        <span className={styles.sheetItemLabel}>{sheet.label}</span>
                        <span className={styles.sheetItemUrl}>{sheet.url.replace(/^https?:\/\/docs\.google\.com\/spreadsheets\/d\//, '').slice(0, 40)}...</span>
                        <span className={styles.sheetItemSync}>
                          {sheet.lastSync ? `Last synced: ${new Date(sheet.lastSync).toLocaleString()}` : 'Not synced yet'}
                        </span>
                      </div>
                      <div className={styles.sheetItemActions}>
                        <button
                          className={sheet.paused ? styles.pausedBtn : styles.activeBtn}
                          onClick={() => togglePause(sheet.type, extraIdx)}
                          title={sheet.paused ? 'Resume sync' : 'Pause sync'}
                        >
                          {sheet.paused ? 'Paused' : 'Active'}
                        </button>
                        <select
                          className={styles.freqSelect}
                          value={sheet.freq ?? 5}
                          onChange={e => updateFreq(sheet.type, extraIdx, e.target.value)}
                          disabled={sheet.paused}
                        >
                          {FREQ_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {sheet.type === 'main' && <span className={styles.badgeMain}>Main</span>}
                        {sheet.type === 'opps' && <span className={styles.badgeOpps}>Opps - Old</span>}
                        {sheet.type === 'extra' && (
                          <button className={styles.sheetRemoveBtn} onClick={() => removeExtraSheet(extraIdx)} title="Remove">&times;</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.savedUrl}>No sheets connected yet</p>
            )}
          </div>

          {status && (
            <div className={`${styles.syncProgress} ${
              status.type === 'success' ? styles.syncProgressSuccess :
              status.type === 'error' ? styles.syncProgressError :
              styles.syncProgressLoading
            }`}>
              {status.type === 'loading' && <span className={styles.spinner} />}
              {status.message}
            </div>
          )}

          {/* Main Sheet Connection */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Table View Sheet</h3>
            <p className={styles.sectionDesc}>
              The main Google Sheet for the Table View (Accounts data).
            </p>
            <div className={styles.urlRow}>
              <input
                className={styles.urlInput}
                type="text"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={url}
                onChange={e => setUrl(e.target.value)}
              />
            </div>
            <div className={styles.urlRow}>
              <input
                className={styles.urlInput}
                type="text"
                placeholder="Sheet tab name (e.g. Accounts)"
                value={sheetName}
                onChange={e => setSheetName(e.target.value)}
                style={{ maxWidth: 200 }}
              />
              <button className={styles.btnSecondary} onClick={saveUrl}>Save</button>
            </div>
          </div>

          {/* Two-way sync */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Two-Way Sync</h3>
            <p className={styles.sectionDesc}>
              Merges data from both sources. New records from either side are added. Existing records are enriched (empty fields filled from the other source).
            </p>
            <button className={styles.btnPrimary} onClick={handleTwoWaySync} disabled={syncing || !hasUrl}>
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>

          {/* One-way options */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>One-Way Sync</h3>
            <div className={styles.btnRow}>
              <button className={styles.btnSecondary} onClick={handlePushToSheets} disabled={syncing || !hasUrl}>
                Website → Sheets
              </button>
              <button
                className={styles.btnSecondary}
                onClick={handlePullFromSheets}
                disabled={syncing || !hasUrl}
                title="Adds companies from the sheet that aren't in the Table View yet. Existing Table View rows are never overwritten."
              >
                Sheets → Website (add new only)
              </button>
              <button className={styles.btnSecondary} onClick={handleExportCsv}>
                Download CSV
              </button>
            </div>
          </div>

          {status && (
            <p className={`${styles.status} ${
              status.type === 'success' ? styles.statusSuccess :
              status.type === 'error' ? styles.statusError :
              styles.statusLoading
            }`}>
              {status.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
