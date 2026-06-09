import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  saveList as saveListToIDB,
  loadList as loadListFromIDB,
  clearList as clearListFromIDB,
} from '../../utils/uploadedListStore';
import { parseBestSheet } from '../../utils/xlsxParse';
import { findFuzzyMatch } from '../../utils/utilityNameMatch';
import { UtilityPasteImportModal } from './UtilityPasteImportModal';
import styles from './SitesView.module.css';

// IndexedDB key for the uploaded "utilities → interval data availability"
// list. Mirrors the SITES_STORAGE_KEY / utility-rates pattern so the list
// survives refreshes and syncs to Firestore via uploadedListStore.
const INTERVAL_LIST_KEY = 'utility-interval-list-override';

// Header heuristics for the two columns we care about in the uploaded
// file: the utility/provider name, and the interval-data-availability
// flag. Everything else on the row is preserved as-is so the user can
// keep extra notes columns in their source file.
function pickUtilityNameColumn(headers) {
  return headers.find(h => /\b(utility|provider|lse|ldc|company|name)\b/i.test(String(h))) || headers[0] || '';
}
function pickIntervalColumn(headers) {
  return headers.find(h => /interval|\bami\b|granular|smart\s*meter|green\s*button|availab/i.test(String(h))) || '';
}

// Interval data is "available" when the cell carries a real positive
// value. Treat the usual negatives / blanks / placeholders as
// unavailable; anything else (including a granularity like "15-min" or
// "hourly") counts as available.
function intervalIsAvailable(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return false;
  return !/^(no|n|none|false|0|unavailable|not\s*available|n\/a|na|tbd|unknown|-)$/.test(s);
}

export function UtilityMappingView({ siteUtilities = [] }) {
  const [list, setList] = useState([]); // [{ name, interval, _raw }]
  const [meta, setMeta] = useState(null); // { fileName, count, nameCol, intervalCol }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const fileRef = useRef(null);

  // Restore any previously-uploaded list on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadListFromIDB(INTERVAL_LIST_KEY);
      if (cancelled || !Array.isArray(saved) || saved.length === 0) return;
      setList(saved);
      const first = saved[0] || {};
      setMeta({
        fileName: first._fileName || 'saved list',
        count: saved.length,
        nameCol: first._nameCol || 'Utility',
        intervalCol: first._intervalCol || 'Interval Data',
      });
    })();
    return () => { cancelled = true; };
  }, []);

  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const { rows, headers } = parseBestSheet(buf);
      if (!rows.length) throw new Error('No data rows found in the file.');
      const nameCol = pickUtilityNameColumn(headers);
      const intervalCol = pickIntervalColumn(headers);
      if (!intervalCol) {
        throw new Error('Could not find an interval-data column. Add a column whose header includes "Interval", "AMI", "Granularity", or "Available".');
      }
      const parsed = rows
        .map(r => ({
          ...r,
          name: String(r[nameCol] ?? '').trim(),
          interval: String(r[intervalCol] ?? '').trim(),
          _fileName: file.name,
          _nameCol: nameCol,
          _intervalCol: intervalCol,
        }))
        .filter(r => r.name);
      if (!parsed.length) throw new Error('No utility names found in the chosen name column.');
      await saveListToIDB(INTERVAL_LIST_KEY, parsed);
      setList(parsed);
      setMeta({ fileName: file.name, count: parsed.length, nameCol, intervalCol });
    } catch (err) {
      setError(err?.message || 'Failed to read the utilities file.');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleClear = useCallback(async () => {
    if (!window.confirm('Remove the uploaded utilities list?')) return;
    await clearListFromIDB(INTERVAL_LIST_KEY);
    setList([]);
    setMeta(null);
  }, []);

  // Pasted data arrives already parsed + column-mapped by the modal, in
  // the same row shape as handleUpload's `parsed`. Persist it the same
  // way so it survives refresh / Firestore sync.
  const handlePasteImport = useCallback(async (parsed, pasteMeta) => {
    setBusy(true);
    setError('');
    try {
      await saveListToIDB(INTERVAL_LIST_KEY, parsed);
      setList(parsed);
      setMeta(pasteMeta);
      setShowPaste(false);
    } catch (err) {
      setError(err?.message || 'Failed to import the pasted utilities.');
    } finally {
      setBusy(false);
    }
  }, []);

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Utility', 'Interval Data Available'],
      ['Pacific Gas & Electric', 'Yes'],
      ['Consolidated Edison', 'Hourly'],
      ['Some Municipal Utility', 'No'],
    ]);
    ws['!cols'] = [{ wch: 32 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Utilities');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Utility Interval Data Template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Resolve each list entry's interval value by utility name. Names are
  // matched fuzzily (same matcher the Utility Lookup uses) so "PG&E" in
  // the portfolio lines up with "Pacific Gas & Electric" in the list.
  const listNames = useMemo(() => list.map(r => r.name).filter(Boolean), [list]);
  const intervalByName = useMemo(() => {
    const m = new Map();
    for (const r of list) if (r.name) m.set(r.name, r.interval);
    return m;
  }, [list]);

  // Roll the portfolio's sites up by their matched electric utility, then
  // resolve interval-data availability for each utility from the list.
  const mapping = useMemo(() => {
    const byUtility = new Map(); // utility name -> site count
    let noUtility = 0;
    for (const s of siteUtilities) {
      const u = (s.electricUtility || '').trim();
      if (!u) { noUtility++; continue; }
      byUtility.set(u, (byUtility.get(u) || 0) + 1);
    }
    const utilities = [...byUtility.entries()].map(([utility, siteCount]) => {
      const hit = listNames.length ? findFuzzyMatch(utility, listNames, { threshold: 40 }) : null;
      const intervalRaw = hit ? intervalByName.get(hit.name) : null;
      const inList = !!hit;
      const available = inList && intervalIsAvailable(intervalRaw);
      return {
        utility,
        siteCount,
        inList,
        matchedName: hit?.name || '',
        interval: intervalRaw || '',
        available,
      };
    }).sort((a, b) => b.siteCount - a.siteCount || a.utility.localeCompare(b.utility));

    const sitesWithUtility = siteUtilities.length - noUtility;
    const availableSites = utilities.filter(u => u.available).reduce((n, u) => n + u.siteCount, 0);
    const unknownSites = utilities.filter(u => !u.inList).reduce((n, u) => n + u.siteCount, 0);
    return {
      utilities,
      noUtility,
      sitesWithUtility,
      availableSites,
      unknownSites,
      pct: sitesWithUtility > 0 ? Math.round((availableSites / sitesWithUtility) * 100) : 0,
    };
  }, [siteUtilities, listNames, intervalByName]);

  const card = { flex: 1, minWidth: 140, padding: '0.75rem 1rem', borderRadius: 8, border: '1px solid var(--color-border)', background: '#fff' };
  const cardNum = { fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1 };
  const cardLabel = { fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 2 };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0.75rem 1rem 2rem' }}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Utility Mapping</h1>
          <div className={styles.subtitle}>
            Map your Utility Lookup portfolio to interval-data availability using an uploaded list of utilities.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={downloadTemplate}
            title="Download a two-column template: Utility name + Interval Data Available."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#1E293B' }}
          >⬇ Template</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setError(''); setShowPaste(true); }}
            title="Paste utility rows copied from Excel / Google Sheets and map the columns."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#1E293B' }}
          >📋 Paste Data</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            title="Upload an Excel/CSV list of utilities with an interval-data-availability column."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >{busy ? 'Working…' : (list.length ? 'Replace Utilities List' : 'Upload Utilities List')}</button>
          {list.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={handleClear}
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: '#fff', color: '#B91C1C', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ margin: '0.5rem 0', padding: '0.5rem 0.75rem', borderRadius: 6, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '0.8rem' }}>
          {error}
        </div>
      )}

      {list.length > 0 && meta && (
        <div style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          ✓ {meta.count.toLocaleString()} utilities loaded from <strong>{meta.fileName}</strong>
          {' '}· matching on “{meta.nameCol}”, availability from “{meta.intervalCol}”
        </div>
      )}

      {list.length === 0 ? (
        <div style={{ marginTop: '1rem', padding: '1.5rem', borderRadius: 8, border: '1px dashed var(--color-border)', background: '#F8FAFC', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          No utilities list yet. Upload an Excel/CSV with a utility-name column and an interval-data-availability column
          (e.g. <em>Yes/No</em> or a granularity like <em>15-min</em>/<em>hourly</em>). The portfolio below is built from the
          sites loaded on the Utility Lookup tab.
        </div>
      ) : siteUtilities.length === 0 ? (
        <div style={{ marginTop: '1rem', padding: '1.5rem', borderRadius: 8, border: '1px dashed var(--color-border)', background: '#F8FAFC', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          No sites loaded. Upload a sites file on the <strong>Utility Lookup</strong> tab and they'll be mapped here automatically.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', margin: '0.5rem 0 1rem' }}>
            <div style={card}>
              <div style={{ ...cardNum, color: '#166534' }}>{mapping.pct}%</div>
              <div style={cardLabel}>portfolio interval-data availability</div>
            </div>
            <div style={card}>
              <div style={cardNum}>{mapping.availableSites.toLocaleString()}<span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', fontWeight: 500 }}> / {mapping.sitesWithUtility.toLocaleString()}</span></div>
              <div style={cardLabel}>sites with interval data available</div>
            </div>
            <div style={card}>
              <div style={{ ...cardNum, color: mapping.unknownSites ? '#92400E' : '#1E293B' }}>{mapping.unknownSites.toLocaleString()}</div>
              <div style={cardLabel}>sites on a utility not in the list</div>
            </div>
            {mapping.noUtility > 0 && (
              <div style={card}>
                <div style={{ ...cardNum, color: '#92400E' }}>{mapping.noUtility.toLocaleString()}</div>
                <div style={cardLabel}>sites with no utility identified</div>
              </div>
            )}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--color-border)' }}>
                <th style={{ padding: '0.4rem 0.5rem' }}>Electric Utility (from portfolio)</th>
                <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}># Sites</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Interval Data</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Matched list entry</th>
              </tr>
            </thead>
            <tbody>
              {mapping.utilities.map((u) => (
                <tr key={u.utility} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600, color: '#1E293B' }}>{u.utility}</td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{u.siteCount.toLocaleString()}</td>
                  <td style={{ padding: '0.4rem 0.5rem' }}>
                    {!u.inList ? (
                      <span style={{ color: '#92400E', fontWeight: 600 }}>Not in list</span>
                    ) : u.available ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#166534', fontWeight: 600 }}>
                        <span aria-hidden="true">✓</span>{u.interval || 'Available'}
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#B91C1C', fontWeight: 600 }}>
                        <span aria-hidden="true">✗</span>{u.interval || 'Not available'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', color: 'var(--color-text-muted)' }}>
                    {u.matchedName || <span style={{ color: '#CBD5E1' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {showPaste && (
        <UtilityPasteImportModal
          onClose={() => setShowPaste(false)}
          onImport={handlePasteImport}
        />
      )}
    </div>
  );
}
