import { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { DataTable } from '../common/DataTable';
import { dbGet, dbPut } from '../../utils/db';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { CompareTab } from './CompareTab';
import { loadOpps2Newest } from '../../utils/opps2Store';
import { buildActiveOppsIndex, activeOppsForCompany, findUntiedActiveOpps } from '../../utils/targetAccountOpps';
import styles from './TargetAccountsView.module.css';

const STORE_NAME = 'target-accounts';

async function loadCache() {
  try { return (await dbGet(STORE_NAME, 'data')) || null; }
  catch { return null; }
}

async function saveCache(data) {
  try { await dbPut(STORE_NAME, data, 'data'); }
  catch (err) { console.error('Failed to save to IndexedDB:', err); }
}

// Firestore persistence for target accounts
async function loadFromFirestore(userId) {
  try {
    const ref = doc(db, 'targetAccounts', userId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const raw = snap.data();
      // Data is stored as JSON string to handle large payloads
      if (raw.json) return JSON.parse(raw.json);
      return raw;
    }
  } catch (err) {
    console.error('Failed to load target accounts from Firestore:', err);
  }
  return null;
}

async function saveToFirestore(userId, data) {
  try {
    const ref = doc(db, 'targetAccounts', userId);
    // Store as JSON string to avoid Firestore nested field limits
    await setDoc(ref, { json: JSON.stringify(data), updatedAt: new Date().toISOString() });
    console.log('Target accounts saved to Firestore');
  } catch (err) {
    console.error('Failed to save target accounts to Firestore:', err);
    alert('Failed to save Target Accounts to cloud: ' + err.message);
  }
}

// Load target accounts: try Firestore first, fall back to IndexedDB
export async function loadTargetAccountsFromDB(userId) {
  if (userId) {
    const firestoreData = await loadFromFirestore(userId);
    if (firestoreData) {
      // Also cache in IndexedDB for faster loads
      saveCache(firestoreData);
      return firestoreData;
    }
  }
  // Fall back to IndexedDB
  return loadCache();
}

// Persisted set of lowercased-trimmed account names that should be
// suppressed from fuzzy-lookup suggestions everywhere in the app
// (My Accounts column on every Lists subtab + picker dropdowns).
// Stored as a JSON array under target-accounts:blocked-names.
const BLOCKED_KEY = 'target-accounts:blocked-names';
const BLOCKED_EVENT = 'target-accounts:blocked-changed';

function loadBlockedAccountNames() {
  try {
    const raw = userLsGet(BLOCKED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(s => String(s).toLowerCase().trim()).filter(Boolean) : []);
  } catch { return new Set(); }
}

function persistBlockedAccountNames(set) {
  try {
    userLsSet(BLOCKED_KEY, JSON.stringify([...set]));
  } catch { /* noop */ }
  try { window.dispatchEvent(new Event(BLOCKED_EVENT)); } catch { /* noop */ }
}

// ── Company-rename hooks (called by the company-rename cascade) ─────────
// Persist a target-accounts payload to both Firestore (canonical) and the
// IndexedDB cache, mirroring how the view saves after an inline edit.
export async function saveTargetAccountsToDB(userId, data) {
  if (userId) await saveToFirestore(userId, data);
  await saveCache(data);
}

// Rewrite the account-name column (the leftmost column of each sheet, which
// is the name by this view's own convention: nameKey = headers[0]) so target
// rows follow a company rename. Pure — returns { data, count }.
export function renameTargetAccountRows(data, oldName, newName) {
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim();
  if (!data?.sheets || !o || !n || o === n.toLowerCase()) return { data, count: 0 };
  let count = 0;
  const sheets = {};
  for (const [name, sheet] of Object.entries(data.sheets)) {
    const key = sheet?.headers?.[0];
    if (!key || !Array.isArray(sheet.records)) { sheets[name] = sheet; continue; }
    sheets[name] = {
      ...sheet,
      records: sheet.records.map(r => {
        if (String(r?.[key] || '').trim().toLowerCase() === o) { count++; return { ...r, [key]: n }; }
        return r;
      }),
    };
  }
  return count > 0 ? { data: { ...data, sheets }, count } : { data, count: 0 };
}

// Blocked-account-name set (suppress-from-suggestions), keyed by lowercased
// account name — move the entry so the suppression follows a rename.
export function countBlockedAccountRename(oldName, newName) {
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim().toLowerCase();
  if (!o || !n || o === n) return 0;
  return loadBlockedAccountNames().has(o) ? 1 : 0;
}

export function renameBlockedAccountName(oldName, newName) {
  if (!countBlockedAccountRename(oldName, newName)) return 0;
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim().toLowerCase();
  const set = loadBlockedAccountNames();
  set.delete(o);
  set.add(n);
  persistBlockedAccountNames(set);
  return 1;
}

function InlineEditCell({ value, rowIndex, colKey, onSave }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  function startEdit() { setEditValue(value || ''); setEditing(true); }
  function save() {
    setEditing(false);
    if (editValue !== (value || '')) onSave(rowIndex, colKey, editValue);
  }

  if (editing) {
    return <input
      style={{ width: '100%', padding: '0.2rem 0.3rem', border: '1px solid var(--color-accent)', borderRadius: '4px', fontSize: 'var(--font-size-sm)', fontFamily: 'inherit' }}
      value={editValue}
      onChange={e => setEditValue(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
      autoFocus
    />;
  }
  return <span style={{ cursor: 'default', padding: '1px 3px', borderRadius: '4px' }} onDoubleClick={startEdit}>{value || '—'}</span>;
}

export function TargetAccountsView({ onDataLoaded, settings, updateSettings, cdmName, onListUploaded }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [search, setSearch] = useState('');
  const [activeSheet, setActiveSheet] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [blockedAccountNames, setBlockedAccountNamesState] = useState(loadBlockedAccountNames);
  // Sub-section within Target Accounts: the canonical list or a
  // diff view that compares an ad-hoc upload against the current list
  // filtered to the configured CDM.
  const [innerTab, setInnerTab] = useState('list');
  // Active opps from the Opps 2 tab, loaded once so the list can show a
  // per-company active-opp count and flag opps for companies that aren't
  // tied to the configured CDM on the list.
  const [oppsRecords, setOppsRecords] = useState([]);
  const fileRef = useRef(null);
  function toggleBlockedAccount(rawName) {
    const key = String(rawName || '').toLowerCase().trim();
    if (!key) return;
    setBlockedAccountNamesState(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistBlockedAccountNames(next);
      return next;
    });
  }

  // Load from Firestore (then IndexedDB fallback) on mount
  useEffect(() => {
    loadTargetAccountsFromDB(user?.uid).then(cached => {
      if (cached) {
        setData(cached);
        if (onDataLoaded) onDataLoaded(cached);
        if (cached.sheetNames?.length > 0) setActiveSheet(cached.sheetNames[0]);
      }
      setLoading(false);
    });
  }, [user]);

  // Load the Opps 2 dataset (newest of local cache / Firestore) so the
  // list can tie opps to accounts. Independent of the target-list load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await loadOpps2Newest(user?.uid);
        const recs = Array.isArray(d?.records) ? d.records : [];
        if (!cancelled) setOppsRecords(recs);
      } catch { if (!cancelled) setOppsRecords([]); }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // One-time migration so the new "Active Opps" column surfaces for users
  // who've customized this table's visible columns (DataTable otherwise
  // keeps any column added later hidden). Adds it to their saved set —
  // both the localStorage copy and the Firestore-synced tablePrefs. Sticky
  // flag; only ADDs.
  useEffect(() => {
    if (!settings) return;
    const tid = 'target-accounts';
    const flag = `${tid}:mig-active-opps-col`;
    let alreadyDone = true;
    try { alreadyDone = !!localStorage.getItem(flag); } catch { /* storage blocked */ }
    if (alreadyDone) return;
    const remote = settings.tablePrefs?.[tid]?.visible;
    let lsSaved = null;
    try {
      const raw = JSON.parse(localStorage.getItem(`prospect-col-visible-${tid}`));
      if (Array.isArray(raw)) lsSaved = raw;
    } catch { /* ignore malformed */ }
    const saved = Array.isArray(remote) && remote.length > 0
      ? remote
      : (Array.isArray(lsSaved) && lsSaved.length > 0 ? lsSaved : null);
    try { localStorage.setItem(flag, '1'); } catch { /* storage blocked */ }
    if (!saved || saved.includes('__activeOpps__')) return;
    // Slot it just after the account-name column (the first non-control
    // key) when we can find one, else append.
    const next = [...saved];
    const firstDataIdx = next.findIndex(k => !String(k).startsWith('__'));
    if (firstDataIdx >= 0) next.splice(firstDataIdx + 1, 0, '__activeOpps__');
    else next.push('__activeOpps__');
    try { localStorage.setItem(`prospect-col-visible-${tid}`, JSON.stringify(next)); } catch { /* storage blocked */ }
    if (updateSettings) {
      const curEntry = settings.tablePrefs?.[tid] || {};
      updateSettings({ tablePrefs: { ...(settings.tablePrefs || {}), [tid]: { ...curEntry, visible: next } } });
    }
  }, [settings, updateSettings]);

  // Index of active opps by account, plus the set of active opps whose
  // company isn't tied to the configured CDM on the target list.
  const oppsIndex = useMemo(() => buildActiveOppsIndex(oppsRecords), [oppsRecords]);
  const untiedOpps = useMemo(
    () => findUntiedActiveOpps(oppsRecords, data, cdmName, settings?.targetCdmColumn),
    [oppsRecords, data, cdmName, settings?.targetCdmColumn]
  );

  function processFile(file) {
    if (!file) return;
    setLoading(true);
    setError(null);
    setStatus(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target.result;
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        const sheets = {};
        for (const sheetName of workbook.SheetNames) {
          const ws = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (json.length < 2) continue;

          const headers = json[0].map(h => String(h || '').trim());
          const records = [];
          for (let i = 1; i < json.length; i++) {
            const row = json[i];
            const record = { _id: i };
            let hasData = false;
            for (let j = 0; j < headers.length; j++) {
              const h = headers[j];
              if (!h) continue;
              const val = row[j] != null ? String(row[j]).trim() : '';
              record[h] = val;
              if (val) hasData = true;
            }
            if (hasData) records.push(record);
          }

          if (records.length > 0) {
            sheets[sheetName] = { headers, records };
          }
        }

        const sheetNames = Object.keys(sheets);
        if (sheetNames.length === 0) {
          setError('No data found in the file');
          setLoading(false);
          return;
        }

        const result = {
          fileName: file.name,
          sheets,
          sheetNames,
          uploadedAt: new Date().toISOString(),
        };

        setData(result);
        saveCache(result);
        if (user?.uid) saveToFirestore(user.uid, result);
        if (onDataLoaded) onDataLoaded(result);
        // A new list is a fresh slate — clear any previously-dismissed tier
        // mismatches so they re-surface against the newly uploaded tiers.
        let clearedNote = '';
        if (onListUploaded) {
          const cleared = onListUploaded();
          if (cleared) clearedNote = ` — reset ${cleared} tier-mismatch dismissal${cleared > 1 ? 's' : ''}`;
        }
        setActiveSheet(sheetNames[0]);
        setStatus(`Uploaded "${file.name}" — ${sheetNames.length} sheet${sheetNames.length > 1 ? 's' : ''}, ${sheetNames.map(n => `${sheets[n].records.length} rows in ${n}`).join(', ')}${clearedNote}`);
      } catch (err) {
        setError(`Failed to parse file: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => { setError('Failed to read file'); setLoading(false); };
    reader.readAsArrayBuffer(file);
  }

  function handleFileChange(e) {
    processFile(e.target.files?.[0]);
    e.target.value = '';
  }

  function handleCellEdit(rowIndex, colKey, newValue) {
    setData(prev => {
      if (!prev?.sheets || !activeSheet) return prev;
      const sheet = prev.sheets[activeSheet];
      const updated = { ...prev, sheets: { ...prev.sheets, [activeSheet]: { ...sheet, records: sheet.records.map((r, i) => i === rowIndex ? { ...r, [colKey]: newValue } : r) } } };
      saveCache(updated);
      if (user?.uid) saveToFirestore(user.uid, updated);
      if (onDataLoaded) onDataLoaded(updated);
      return updated;
    });
  }

  // Permanently remove an account from the Target Accounts sheet so it
  // stops surfacing in any fuzzy-match suggestion across the app. Drops
  // the row from `records` (re-numbering _id so downstream renders stay
  // stable), unblocks the name as well so the blocked-list doesn't
  // accumulate stale entries, and persists the new state through both
  // local cache + Firestore + the global targetAccountsData prop chain.
  function handleDeleteRow(record) {
    if (!record || !nameKey) return;
    const name = String(record[nameKey] || '').trim();
    const confirmText = name
      ? `Delete "${name}" from the Target Accounts list? This removes it everywhere — including the suggested-name fuzzy match. The original Excel file is unchanged.`
      : 'Delete this row from the Target Accounts list?';
    if (!window.confirm(confirmText)) return;
    setData(prev => {
      if (!prev?.sheets || !activeSheet) return prev;
      const sheet = prev.sheets[activeSheet];
      const filteredRecords = sheet.records
        .filter(r => r._id !== record._id)
        .map((r, i) => ({ ...r, _id: i + 1 }));
      const updated = {
        ...prev,
        sheets: { ...prev.sheets, [activeSheet]: { ...sheet, records: filteredRecords } },
      };
      saveCache(updated);
      if (user?.uid) saveToFirestore(user.uid, updated);
      if (onDataLoaded) onDataLoaded(updated);
      return updated;
    });
    // Drop the deleted name from the blocked-list too — keeping it
    // around would just be dead weight since the row is gone.
    if (name) {
      const key = name.toLowerCase();
      setBlockedAccountNamesState(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        persistBlockedAccountNames(next);
        return next;
      });
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  // Current sheet data
  const currentSheet = data?.sheets?.[activeSheet || data?.sheetNames?.[0]];
  const headers = currentSheet?.headers || [];
  const records = currentSheet?.records || [];

  // Build columns from headers — all cells are editable. The leftmost
  // "Blocked" column toggles per-row; blocked accounts are suppressed
  // from fuzzy-match suggestions across the app.
  const nameKey = headers[0];
  const columns = useMemo(() => {
    const seen = new Set();
    const dataCols = headers
      .filter(h => { if (!h || seen.has(h)) return false; seen.add(h); return true; })
      .map(h => ({
        key: h,
        label: h,
        defaultWidth: h.length > 25 ? 180 : h.length > 15 ? 140 : 110,
        sticky: h === headers[0],
        render: (row) => {
          const isBlocked = nameKey ? blockedAccountNames.has(String(row[nameKey] || '').toLowerCase().trim()) : false;
          return (
            <span style={{ textDecoration: isBlocked ? 'line-through' : 'none', color: isBlocked ? 'var(--color-text-muted)' : 'inherit', display: 'inline-block' }}>
              <InlineEditCell value={row[h]} rowIndex={row._id - 1} colKey={h} onSave={handleCellEdit} />
            </span>
          );
        },
      }));
    const blockCol = {
      key: '__blocked__',
      label: '',
      defaultWidth: 50,
      render: (row) => {
        const accountName = nameKey ? String(row[nameKey] || '').trim() : '';
        const isBlocked = !!accountName && blockedAccountNames.has(accountName.toLowerCase());
        return (
          <input
            type="checkbox"
            checked={isBlocked}
            disabled={!accountName}
            onChange={() => toggleBlockedAccount(accountName)}
            onClick={e => e.stopPropagation()}
            title={isBlocked
              ? `"${accountName}" is blocked — uncheck to show in fuzzy-match suggestions again`
              : `Block "${accountName}" from appearing in fuzzy-match suggestions across every Lists subtab and picker`}
            style={{ cursor: accountName ? 'pointer' : 'not-allowed', accentColor: '#DC2626' }}
            aria-label={`Block ${accountName} from fuzzy lookups`}
          />
        );
      },
    };
    const deleteCol = {
      key: '__delete__',
      label: '',
      defaultWidth: 44,
      render: (row) => {
        const accountName = nameKey ? String(row[nameKey] || '').trim() : '';
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleDeleteRow(row); }}
            disabled={!accountName}
            title={accountName
              ? `Delete "${accountName}" from the Target Accounts list — removes it from every fuzzy-match suggestion across the app.`
              : 'Delete row'}
            style={{
              border: 'none', background: 'transparent',
              color: accountName ? '#94A3B8' : '#E2E8F0',
              fontSize: '1rem', cursor: accountName ? 'pointer' : 'not-allowed',
              padding: '0 6px', lineHeight: 1, fontFamily: 'inherit',
            }}
            onMouseEnter={e => { if (accountName) e.currentTarget.style.color = '#DC2626'; }}
            onMouseLeave={e => { if (accountName) e.currentTarget.style.color = '#94A3B8'; }}
          >×</button>
        );
      },
    };
    // Active opps (from the Opps 2 tab) tied to this account. Count badge
    // with a hover breakdown of each opp's Account → Stage; sorts by count
    // and filters on Has active opps / None.
    const oppsCol = {
      key: '__activeOpps__',
      label: 'Active Opps',
      defaultWidth: 110,
      getSortValue: (row) => activeOppsForCompany(nameKey ? row[nameKey] : '', oppsIndex).length,
      getFilterValue: (row) => activeOppsForCompany(nameKey ? row[nameKey] : '', oppsIndex).length > 0 ? 'Has active opps' : 'None',
      render: (row) => {
        const opps = activeOppsForCompany(nameKey ? row[nameKey] : '', oppsIndex);
        if (opps.length === 0) return <span style={{ color: '#CBD5E1' }}>—</span>;
        const tip = opps
          .slice(0, 12)
          .map(o => `${o.account} — ${o.stage || 'No stage'}`)
          .join('\n') + (opps.length > 12 ? `\n…and ${opps.length - 12} more` : '');
        return (
          <span
            title={tip}
            style={{ display: 'inline-block', minWidth: 22, textAlign: 'center', padding: '1px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, background: '#DCFCE7', color: '#166534' }}
          >{opps.length}</span>
        );
      },
    };
    return [blockCol, deleteCol, ...(dataCols.length > 0 ? [dataCols[0], oppsCol, ...dataCols.slice(1)] : [oppsCol])];
  }, [headers, blockedAccountNames, nameKey, oppsIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Union of column headers across every sheet — feeds the "Salesperson /
  // CDM column" picker so the mapping works no matter which sheet is
  // active. My Accounts (and other pages) read settings.targetCdmColumn to
  // resolve the salesperson/CDM column from this exact header.
  const allHeaderOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const name of data?.sheetNames || []) {
      for (const h of (data?.sheets?.[name]?.headers || [])) {
        const key = String(h || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
      }
    }
    return out;
  }, [data]);
  // The column that holds the salesperson/CDM who owns each account.
  // My Accounts (and the prospect modal, bulk Agenda, etc.) use this to
  // decide whose account a row is, instead of guessing by header keyword.
  const cdmColumn = String(settings?.targetCdmColumn || '');

  // Filtered records — text search only.
  const filtered = useMemo(() => {
    let result = records;
    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(r =>
        Object.values(r).some(v => v && String(v).toLowerCase().includes(term))
      );
    }
    return result;
  }, [records, search]);

  // Set active sheet on first load
  if (data && !activeSheet && data.sheetNames?.length > 0) {
    setActiveSheet(data.sheetNames[0]);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Target Accounts List</h2>
          {data?.uploadedAt && (
            <span className={styles.lastUpload}>
              {data.fileName} — uploaded {new Date(data.uploadedAt).toLocaleString()}
            </span>
          )}
          <div className={styles.tierLegend}>
            <div><strong>Tier 1:</strong> Existing Clients</div>
            <div><strong>Tier 2:</strong> Critical/Major Prospects (10 total)</div>
            <div><strong>Tier 3:</strong> All remaining assigned in your segments</div>
          </div>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.uploadBtn}>
            Upload Excel / CSV
            <input ref={fileRef} className={styles.fileInput} type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={handleFileChange} />
          </label>
        </div>
      </div>

      <div className={styles.sheetTabs} style={{ marginBottom: 0 }}>
        <button
          className={innerTab === 'list' ? styles.sheetTabActive : styles.sheetTab}
          onClick={() => setInnerTab('list')}
        >Current List</button>
        <button
          className={innerTab === 'compare' ? styles.sheetTabActive : styles.sheetTab}
          onClick={() => setInnerTab('compare')}
          title={cdmName ? `Upload a list and diff it against the current Target Accounts filtered to ${cdmName}` : 'Upload a list and diff it against the current Target Accounts'}
        >Compare upload</button>
      </div>

      {innerTab === 'compare' ? (
        <CompareTab currentData={data} cdmName={cdmName} />
      ) : (
        <ListSection
          error={error}
          status={status}
          data={data}
          loading={loading}
          dragOver={dragOver}
          setDragOver={setDragOver}
          handleDrop={handleDrop}
          fileRef={fileRef}
          activeSheet={activeSheet}
          setActiveSheet={setActiveSheet}
          search={search}
          setSearch={setSearch}
          filtered={filtered}
          handleFileChange={handleFileChange}
          columns={columns}
          settings={settings}
          updateSettings={updateSettings}
          cdmColumn={cdmColumn}
          allHeaderOptions={allHeaderOptions}
          untiedOpps={untiedOpps}
          cdmName={cdmName}
        />
      )}
    </div>
  );
}

// Top-of-page warning listing active opps whose company isn't tied to the
// configured CDM on the target list — i.e. opps you're working for
// companies missing from (or attributed to someone else on) your list.
// Collapsed to a one-line summary by default; expands to the per-company
// breakdown. Renders nothing when there's nothing to flag.
function UntiedOppsWarning({ untiedOpps, cdmName }) {
  const [open, setOpen] = useState(false);
  if (!untiedOpps || untiedOpps.totalCompanies === 0) return null;
  const { groups, totalOpps, totalCompanies } = untiedOpps;
  const who = cdmName || 'your CDM';
  return (
    <div style={{ margin: '0 0 0.75rem', border: '1px solid #FCA5A5', background: '#FEF2F2', borderRadius: 8, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 0.85rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
      >
        <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠️</span>
        <span style={{ fontSize: '0.8rem', color: '#991B1B', fontWeight: 700 }}>
          {totalOpps} active opp{totalOpps === 1 ? '' : 's'} across {totalCompanies} compan{totalCompanies === 1 ? 'y' : 'ies'} not tied to {who}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#B91C1C', fontWeight: 700 }}>{open ? 'Hide ▲' : 'Show ▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 0.85rem 0.75rem' }}>
          <div style={{ fontSize: '0.72rem', color: '#7F1D1D', margin: '0 0 0.5rem' }}>
            These companies have active opportunities in the Opps tab but don&apos;t appear on the Target Accounts list under {who}. Add them to your list (or fix the account owner) so they&apos;re tracked.
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #FECACA', borderRadius: 6, background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
              <thead>
                <tr style={{ background: '#FFF1F2', position: 'sticky', top: 0 }}>
                  <th style={{ textAlign: 'left', padding: '0.35rem 0.6rem', color: '#9F1239', fontWeight: 700, borderBottom: '1px solid #FECACA' }}>Company</th>
                  <th style={{ textAlign: 'center', padding: '0.35rem 0.6rem', color: '#9F1239', fontWeight: 700, borderBottom: '1px solid #FECACA', width: 70 }}>Opps</th>
                  <th style={{ textAlign: 'left', padding: '0.35rem 0.6rem', color: '#9F1239', fontWeight: 700, borderBottom: '1px solid #FECACA' }}>Stages</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={g.account} style={{ background: i % 2 ? '#FFFBFB' : '#fff' }}>
                    <td style={{ padding: '0.3rem 0.6rem', color: '#1E293B', fontWeight: 600, borderBottom: '1px solid #FEE2E2' }}>{g.account}</td>
                    <td style={{ padding: '0.3rem 0.6rem', textAlign: 'center', color: '#991B1B', fontWeight: 700, borderBottom: '1px solid #FEE2E2' }}>{g.count}</td>
                    <td style={{ padding: '0.3rem 0.6rem', color: '#64748B', borderBottom: '1px solid #FEE2E2' }}>{g.stages.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ListSection({
  error, status, data, loading, dragOver, setDragOver, handleDrop, fileRef,
  activeSheet, setActiveSheet, search, setSearch, filtered, handleFileChange,
  columns, settings, updateSettings, cdmColumn, allHeaderOptions,
  untiedOpps, cdmName,
}) {
  return (
    <>
      {error && <div className={styles.error}>{error}</div>}
      {status && <div className={styles.success}>{status}</div>}
      {data && <UntiedOppsWarning untiedOpps={untiedOpps} cdmName={cdmName} />}

      {!data && !loading && (
        <>
          <div
            className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <div className={styles.dropTitle}>Drop your Excel or CSV file here</div>
            <div className={styles.dropSub}>or click to browse — supports .xlsx, .xls, .csv</div>
          </div>
          <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text)', marginTop: 0, marginBottom: '0.5rem' }}>Expected Format</h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', margin: '0 0 0.5rem 0' }}>
              Your Excel file should have columns matching these names (flexible matching — exact names not required):
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', borderBottom: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Column</th>
                    <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', borderBottom: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Required</th>
                    <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', borderBottom: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Example Values</th>
                    <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', borderBottom: '1px solid var(--color-border)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Matches</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Account / Company Name', 'Yes', 'CBRE, Prologis, Simon Property Group', 'Account, Company, Name, Client'],
                    ['CDM / Salesperson', 'Yes', 'Dan Baldauf', 'CDM, Salesperson, Sales Rep, Account Owner, Rep'],
                    ['Tier', 'Yes', 'Tier 1, Tier 2, 1, 2', 'Tier, Account Tier, Target'],
                  ].map(([col, req, example, matches], i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '0.35rem 0.6rem', fontWeight: 600, color: 'var(--color-text)' }}>{col}</td>
                      <td style={{ padding: '0.35rem 0.6rem', color: req === 'Yes' ? '#DC2626' : 'var(--color-text-secondary)', fontWeight: req === 'Yes' ? 600 : 400 }}>{req}</td>
                      <td style={{ padding: '0.35rem 0.6rem', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>{example}</td>
                      <td style={{ padding: '0.35rem 0.6rem', color: '#6B7280', fontSize: '0.7rem' }}>{matches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '0.72rem', color: '#9CA3AF', margin: '0.5rem 0 0 0' }}>
              Additional columns are preserved and displayed. Multiple sheets are supported — each sheet is shown as a separate tab.
            </p>
            <button
              onClick={() => {
                const wb = XLSX.utils.book_new();
                const wsData = [
                  ['Account Name', 'CDM', 'Tier'],
                  ['CBRE', 'Dan Baldauf', 'Tier 1'],
                  ['Prologis', 'Dan Baldauf', 'Tier 1'],
                  ['Simon Property Group', 'Dan Baldauf', 'Tier 2'],
                ];
                const ws = XLSX.utils.aoa_to_sheet(wsData);
                XLSX.utils.book_append_sheet(wb, ws, 'Target Accounts');
                XLSX.writeFile(wb, 'Target_Accounts_Template.xlsx');
              }}
              style={{ marginTop: '0.6rem', padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'var(--color-surface)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-accent)' }}
            >
              Download Template (.xlsx)
            </button>
          </div>
        </>
      )}

      {loading && <div className={styles.loading}>Processing file...</div>}

      {data && data.sheetNames?.length > 1 && (
        <div className={styles.sheetTabs}>
          {data.sheetNames.map(name => (
            <button
              key={name}
              className={activeSheet === name ? styles.sheetTabActive : styles.sheetTab}
              onClick={() => setActiveSheet(name)}
            >
              {name}
              <span className={styles.tabCount}>{data.sheets[name]?.records.length}</span>
            </button>
          ))}
        </div>
      )}

      {data && (
        <>
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <label
              title="Pick which column holds the salesperson / CDM who owns each account. My Accounts (and the prospect modal, Agenda, and other pages) use this column to decide whose account a row is, instead of guessing by header name — leave on Auto to keep the keyword guess."
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}
            >
              Salesperson / CDM column
              <select
                value={cdmColumn}
                onChange={e => updateSettings({ targetCdmColumn: e.target.value })}
                style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff', fontSize: '0.72rem', fontFamily: 'inherit', color: 'var(--color-text)', maxWidth: 200 }}
              >
                <option value="">Auto (guess)</option>
                {allHeaderOptions.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <label className={styles.uploadBtn} style={{ fontSize: 'var(--font-size-xs)', padding: '0.3rem 0.6rem' }}>
              Re-upload
              <input className={styles.fileInput} type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={handleFileChange} />
            </label>
          </div>
          <DataTable
            tableId="target-accounts"
            columns={columns}
            rows={filtered}
            alwaysVisible={[]}
            enableColumnFilters
            emptyMessage="No records found"
            settings={settings}
            updateSettings={updateSettings}
          />
        </>
      )}
    </>
  );
}
