// Paste-and-display table for BFO Activity exports. The user copies
// rows from the source CRM and pastes them anywhere on the page; the
// first row is treated as the header. Data persists to IndexedDB so
// it survives reloads. Search + click-to-sort columns; Age cells
// color-coded green/amber/red.

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './BFOActivityView.module.css';
import { dbGet, dbPut, dbDelete } from '../../utils/db';
import { saveBfoActivity } from '../../utils/bfoActivityStore';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { setOppBfoLink } from '../../utils/opps2Store';
import { normalizeCompany } from '../../utils/companyNorm';
import { parseTSV, compareValues, cleanHeader } from '../../utils/tsvTable';
import { LastUpdatedLine } from './LastUpdatedLine';
import { useAuth } from '../../contexts/AuthContext';
import { PasteTableView } from './PasteTableView';
import {
  autoDetectLeadMapping, leadRowsFromTable, planLeadImport, summariseLeadNames,
} from '../../utils/marketingLeadsImport';

// IndexedDB store shared by both subtabs (a generic key-value store).
// The Leads subtab persists under its own keys so it never collides with
// the main BFO Activity data.
const LEADS_DATA_KEY = 'leads-current';
const LEADS_PREFS_KEY = 'leads-prefs';
const LEADS_PLACEHOLDER = 'Name\tCompany\tEmail\tLead Status\t…\nJane Doe\tAcme Inc.\tjane@acme.com\tOpen\t…';

// Readable label for an Opps 2 opp shown as an assignment target —
// Scope plus Stage / Open Year context, falling back to the row id.
function oppTargetLabel(r) {
  const scope = String(r?.Scope || '').trim();
  const meta = [r?.Stage, r?.['Open Year']].map(v => String(v || '').trim()).filter(Boolean).join(' · ');
  const base = scope || `Opp ${r?._id}`;
  return meta ? `${base} (${meta})` : base;
}

const STORE = 'bfo-activity';
const KEY = 'current';
const PREFS_KEY = 'prefs';
const LEAD_SOURCE_COL = 'Lead Source';

// Values an Opps 2 "BFO Link" (BFO Opportunity Name) cell can hold that
// mean "no name yet". New opps are seeded with a dash placeholder (see
// makeBlankOpp in OppsView2), and sheet imports leave #N/A — neither is
// a real tag, so they must not count as "already tagged".
const BFO_BLANK_SENTINELS = new Set(['', '-', '#n/a', 'n/a']);

// The opp's BFO Opportunity Name, or '' when it holds only a blank
// placeholder. Use this everywhere we decide whether an opp is tagged.
function bfoOppName(r) {
  const v = String(r?.['BFO Link'] || '').trim();
  return BFO_BLANK_SENTINELS.has(v.toLowerCase()) ? '' : v;
}

export function BFOActivityView({ prospects = [], settings, updateSettings } = {}) {
  // Which subtab is showing: the rich BFO Activity table, or the generic
  // Leads-list paste table.
  const [subtab, setSubtab] = useState('bfo'); // 'bfo' | 'leads'
  const [data, setData] = useState({ headers: [], rows: [] });
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState(null); // { col, dir: 'asc'|'desc' }
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');
  const [colWidths, setColWidths] = useState({}); // { [headerName]: pixelWidth }
  const [hiddenCols, setHiddenCols] = useState({}); // { [headerName]: true }
  const [colMenuOpen, setColMenuOpen] = useState(false);
  // Opps cache drives the Lead Source lookup column. We refresh on
  // mount and whenever the window regains focus so that pasting on
  // the Opps tab and switching back here surfaces the new sources.
  const [opps, setOpps] = useState(null);
  const { user } = useAuth();
  const [assigning, setAssigning] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadOppsFromCache().then(o => { if (!cancelled) setOpps(o || null); }).catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);
  const hydratedRef = useRef(false);

  // Pasting the Salesforce Leads list into the Leads subtab also maps any
  // lead that isn't on Contacts → Marketing Leads over to it, so the one
  // paste feeds both. Additive only: a lead already there is left exactly
  // as it is (statuses and links are edited on the Marketing Leads page),
  // and a lead hidden there stays hidden.
  function mapPastedLeadsToMarketingLeads({ headers, rows }) {
    if (!updateSettings) return '';
    const mapping = autoDetectLeadMapping(headers);
    // No Name column means we can't tell who these rows are about — say
    // so rather than silently mapping nothing.
    if (!mapping.name) return 'No Name column found, so nothing was added to Marketing Leads.';
    const incoming = leadRowsFromTable({ headers, rows, mapping });
    if (!incoming.length) return '';
    const saved = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    const hiddenIds = Array.isArray(settings?.marketingLeadsHiddenLeads)
      ? settings.marketingLeadsHiddenLeads : [];
    // Match on name as well as email here: the Leads printable view often
    // carries no Email column at all, and without a name match every
    // paste would add the whole list over again.
    const plan = planLeadImport({ incoming, saved, hiddenIds, matchByName: true });
    if (plan.additions.length) {
      updateSettings({ marketingLeads: [...plan.savedAfter, ...plan.additions] });
    }
    const n = plan.additions.length;
    const notes = [n
      ? `${n} new lead${n === 1 ? '' : 's'} added to Marketing Leads: ${summariseLeadNames(plan.additions)}.`
      : 'No new leads for Marketing Leads.'];
    const h = plan.blockedHidden.length;
    if (h) {
      notes.push(
        `${h} skipped as hidden there (${summariseLeadNames(plan.blockedHidden)}) — ` +
        `unhide from "Show hidden" on Marketing Leads to bring ${h === 1 ? 'it' : 'them'} back.`
      );
    }
    return notes.join(' ');
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await dbGet(STORE, KEY);
        if (!cancelled && saved && saved.headers && saved.rows) {
          // Older saved data may contain "Sorted Ascending/Descending"
          // baked into header names. Strip that suffix on load and
          // remap row keys so downstream column lookups work without
          // requiring a fresh paste.
          const cleaned = saved.headers.map(cleanHeader);
          const needsRemap = cleaned.some((h, i) => h !== saved.headers[i]);
          // updatedAt travels with the rows rather than in its own state:
          // the save effect below fires on `data`, so a separate field would
          // save twice on every paste and, worse, could save the new rows
          // against the old timestamp.
          const updatedAt = typeof saved.updatedAt === 'number' ? saved.updatedAt : null;
          if (needsRemap) {
            const rows = saved.rows.map(r => {
              const next = {};
              saved.headers.forEach((h, i) => { next[cleaned[i] || h] = r[h]; });
              return next;
            });
            setData({ headers: cleaned, rows, updatedAt });
          } else {
            setData({ headers: saved.headers, rows: saved.rows, updatedAt });
          }
        }
        // Prefs in a separate key so Clear can wipe data without losing
        // column widths or visibility.
        const prefs = await dbGet(STORE, PREFS_KEY);
        if (!cancelled && prefs) {
          if (prefs.colWidths) setColWidths(prefs.colWidths);
          if (prefs.hiddenCols) setHiddenCols(prefs.hiddenCols);
        }
        // Back-compat: if prefs are still embedded in the legacy
        // combined record, lift them out.
        if (!cancelled && !prefs && saved) {
          if (saved.colWidths) setColWidths(saved.colWidths);
          if (saved.hiddenCols) setHiddenCols(saved.hiddenCols);
        }
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    // Mirrored to Firestore (see utils/bfoActivityStore) so the pasted rows
    // survive a cleared browser.
    saveBfoActivity({ headers: data.headers, rows: data.rows, updatedAt: data.updatedAt ?? null })
      .catch(err => console.warn('BFO data save failed', err));
  }, [data]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, { colWidths, hiddenCols }, PREFS_KEY).catch(err => console.warn('BFO prefs save failed', err));
  }, [colWidths, hiddenCols]);

  function toggleHidden(col) {
    setHiddenCols(h => {
      const next = { ...h };
      if (next[col]) delete next[col];
      else next[col] = true;
      return next;
    });
  }

  function startColResize(col, evt) {
    evt.preventDefault();
    evt.stopPropagation();
    const startX = evt.clientX;
    const startW = colWidths[col] ?? 160;
    const onMove = (e) => {
      const next = Math.max(60, startW + (e.clientX - startX));
      setColWidths(w => ({ ...w, [col]: next }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function importPaste(text) {
    const parsed = parseTSV(text);
    if (parsed.rows.length === 0) {
      setFlash('Pasted text had no data rows.');
      window.setTimeout(() => setFlash(''), 2500);
      return;
    }
    setData({ ...parsed, updatedAt: Date.now() });
    setFlash(`Imported ${parsed.rows.length} rows · ${parsed.headers.length} columns.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  function handlePagePaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
    e.preventDefault();
    importPaste(text);
  }

  function clearAll() {
    if (!confirm('Clear all BFO activity data?')) return;
    setData({ headers: [], rows: [], updatedAt: null });
    dbDelete(STORE, KEY).catch(() => {});
  }

  function exportCsv() {
    if (data.rows.length === 0) return;
    const escape = (v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    // Amount columns come in as "USD 15,000.00" — export just the dollar
    // amount, dropping the leading ISO currency code so the cell is a plain
    // number.
    const isAmountHeader = (h) => /amount/i.test(h);
    const stripCurrency = (v) => String(v ?? '').replace(/^\s*[A-Z]{3}\s+/, '').trim();
    const cellFor = (r, h) => (isAmountHeader(h) ? stripCurrency(r[h]) : r[h]);
    const lines = [
      data.headers.map(escape).join(','),
      ...data.rows.map(r => data.headers.map(h => escape(cellFor(r, h))).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bfo-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Lead Source lookup: map BFO Link (lowercase trimmed) → Source string.
  // Source on the Opps tab can be labeled either "Lead Source" or just
  // "Source" — try both. BFO Link on the Opps tab IS the BFO
  // Opportunity Name (we renamed the visible label earlier; the data
  // key is still "BFO Link").
  const leadSourceByOppName = useMemo(() => {
    const map = new Map();
    const records = (opps && Array.isArray(opps.records)) ? opps.records : [];
    for (const r of records) {
      const k = bfoOppName(r).toLowerCase();
      if (!k) continue;
      const src = (r['Lead Source'] || r['Source'] || '').toString().trim();
      if (src) map.set(k, src);
    }
    return map;
  }, [opps]);

  // Set of BFO Opportunity Names that exist on Opps 2 (keyed by the
  // "BFO Link" field, lowercased + trimmed) used to flag BFO Activity
  // rows whose Opportunity Name has no matching opp.
  const oppNameKeys = useMemo(() => {
    const set = new Set();
    const records = (opps && Array.isArray(opps.records)) ? opps.records : [];
    for (const r of records) {
      const k = bfoOppName(r).toLowerCase();
      if (k) set.add(k);
    }
    return set;
  }, [opps]);

  // Opportunity Names in the pasted BFO data that don't match any opp
  // on Opps 2, paired with the BFO Account they came from (used to
  // suggest assignment targets). Only meaningful once the Opps 2 cache
  // has loaded — when it hasn't (oppNameKeys empty) we suppress the
  // warning rather than flag every row.
  const unmatchedOppNames = useMemo(() => {
    if (!data?.headers?.length || oppNameKeys.size === 0) return [];
    const oppCol = data.headers.find(h => /opportunity\s*name/i.test(h));
    if (!oppCol) return [];
    const acctCol = data.headers.find(h => /^account(\s*name)?$/i.test(h.trim()))
      || data.headers.find(h => /account/i.test(h));
    const seen = new Set();
    const missing = [];
    for (const r of data.rows) {
      const raw = String(r[oppCol] || '').trim();
      if (!raw) continue;
      const k = raw.toLowerCase();
      if (oppNameKeys.has(k) || seen.has(k)) continue;
      seen.add(k);
      missing.push({ name: raw, account: acctCol ? String(r[acctCol] || '').trim() : '' });
    }
    return missing;
  }, [data, oppNameKeys]);

  // Map of normalized company name → that company's BFO Company Name,
  // sourced from the Table View company records (prospects). Lets us
  // match a BFO Activity row to Opps 2 opps on the shared BFO Company
  // Name rather than relying on the raw Account text lining up.
  const bfoCompanyByAccount = useMemo(() => {
    const map = new Map();
    for (const p of (prospects || [])) {
      const key = normalizeCompany(p?.company || '');
      const bfo = String(p?.bfoCompanyName || '').trim();
      if (key && bfo) map.set(key, bfo);
    }
    return map;
  }, [prospects]);

  // Opps 2 opps that have NO BFO Opportunity Name yet, indexed by every
  // key we might match a BFO Activity row on: the normalized Account, the
  // opp's own normalized BFO Company Name field, and the normalized BFO
  // Company Name carried on the matching Table View company. Indexing on
  // the opp's BFO Company Name lets a row whose Account reads "Simon
  // Property Group" still match a BFO row for "Simon Property Group, Inc.
  // - Headquarters" when that fuller name is stored on the opp.
  // Closed opps (Stage "Sold" / "Not Sold") are excluded — there's no
  // point tagging a finished deal with a BFO Opportunity Name.
  const unlinkedOppsByKey = useMemo(() => {
    const map = new Map();
    const add = (key, opp) => {
      if (!key) return;
      let list = map.get(key);
      if (!list) { list = []; map.set(key, list); }
      if (!list.some(o => o._id === opp._id)) list.push(opp);
    };
    const isClosedStage = (stage) => {
      const s = String(stage || '').trim().toLowerCase();
      return s === 'sold' || s === 'not sold';
    };
    const records = (opps && Array.isArray(opps.records)) ? opps.records : [];
    for (const r of records) {
      if (bfoOppName(r) !== '') continue;
      if (isClosedStage(r.Stage)) continue;
      const acctKey = normalizeCompany(r.Account || '');
      add(acctKey, r);
      add(normalizeCompany(r['BFO Company Name'] || ''), r);
      const bfo = bfoCompanyByAccount.get(acctKey);
      if (bfo) add(normalizeCompany(bfo), r);
    }
    return map;
  }, [opps, bfoCompanyByAccount]);

  // Tag the chosen Opps 2 opp with the BFO Opportunity Name, persist
  // through the shared Opps 2 store, then refresh the local opps cache
  // so the warning + Lead Source column reflect the new tag.
  async function assignBfoName(oppId, bfoName) {
    if (assigning) return;
    setAssigning(true);
    try {
      await setOppBfoLink(user?.uid, oppId, bfoName);
      const refreshed = await loadOppsFromCache();
      setOpps(refreshed || null);
      setFlash(`Tagged an Opps opp with "${bfoName}".`);
    } catch (err) {
      setFlash(`Could not tag opp: ${err?.message || err}`);
    } finally {
      setAssigning(false);
      window.setTimeout(() => setFlash(''), 3500);
    }
  }

  // Build a derived view of the BFO data with the synthetic Lead
  // Source column injected. Persisted `data` is left untouched so the
  // saved BFO snapshot doesn't accumulate the lookup column on each
  // load — we add it here only for filter / sort / render.
  const displayData = useMemo(() => {
    if (!data?.headers?.length) return data;
    const oppCol = data.headers.find(h => /opportunity\s*name/i.test(h));
    if (!oppCol || leadSourceByOppName.size === 0) return data;
    const headers = data.headers.includes(LEAD_SOURCE_COL)
      ? data.headers
      : [...data.headers, LEAD_SOURCE_COL];
    const rows = data.rows.map(r => {
      const k = String(r[oppCol] || '').trim().toLowerCase();
      const src = leadSourceByOppName.get(k) || '';
      return { ...r, [LEAD_SOURCE_COL]: src };
    });
    return { ...data, headers, rows };
  }, [data, leadSourceByOppName]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = displayData.rows;
    if (q) {
      rows = rows.filter(r => displayData.headers.some(h => String(r[h] ?? '').toLowerCase().includes(q)));
    }
    if (sortBy) {
      const col = sortBy.col;
      const dir = sortBy.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => compareValues(a[col], b[col]) * dir);
    }
    return rows;
  }, [displayData, search, sortBy]);

  function toggleSort(col) {
    setSortBy(prev => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return null;
    });
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.subtabBar} role="tablist" aria-label="BFO Activity subtabs">
        <button
          type="button"
          role="tab"
          aria-selected={subtab === 'bfo'}
          className={subtab === 'bfo' ? styles.subtabActive : styles.subtab}
          onClick={() => setSubtab('bfo')}
        >BFO Activity</button>
        <button
          type="button"
          role="tab"
          aria-selected={subtab === 'leads'}
          className={subtab === 'leads' ? styles.subtabActive : styles.subtab}
          onClick={() => setSubtab('leads')}
        >Leads</button>
      </div>

      {subtab === 'leads' ? (
        <PasteTableView
          title="Leads"
          subtitle="Paste rows from the Salesforce Leads printable view (⌘V / Ctrl+V) anywhere on this page. First row is the header."
          placeholder={LEADS_PLACEHOLDER}
          storeName={STORE}
          dataKey={LEADS_DATA_KEY}
          prefsKey={LEADS_PREFS_KEY}
          csvPrefix="leads"
          flipNameColumn
          onRowsPasted={mapPastedLeadsToMarketingLeads}
          emptyHint="Open the Salesforce Leads list, click Printable View, select the table (including the header row), copy, then paste anywhere on this page. The data persists in your browser until you clear or replace it."
        />
      ) : (
      <div className={styles.pane} onPaste={handlePagePaste}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>BFO Activity</h1>
          <span className={styles.subtitle}>
            Paste rows from BFO (⌘V / Ctrl+V) anywhere on this page. First row is the header.
          </span>
          <LastUpdatedLine updatedAt={data.updatedAt} hasRows={data.rows.length > 0} />
        </div>
        <div className={styles.toolbar}>
          <input
            className={styles.searchInput}
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
            {pasteOpen ? 'Hide paste box' : 'Paste from BFO…'}
          </button>
          {data.headers.length > 0 && (
            <div className={styles.colsMenuWrap}>
              <button type="button" className={styles.btn} onClick={() => setColMenuOpen(o => !o)}>
                Columns ▾
              </button>
              {colMenuOpen && (
                <div className={styles.colsMenu}>
                  {displayData.headers.map(h => (
                    <label key={h} className={styles.colsMenuItem}>
                      <input
                        type="checkbox"
                        checked={!hiddenCols[h]}
                        onChange={() => toggleHidden(h)}
                      />
                      <span>{h}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {data.rows.length > 0 && (
            <>
              <button type="button" className={styles.btn} onClick={exportCsv}>Export CSV</button>
              <button type="button" className={styles.btnDanger} onClick={clearAll}>Clear</button>
            </>
          )}
        </div>
      </div>

      {flash && (
        <div style={{ padding: '0 1.25rem 0.25rem' }}>
          <div className={styles.pasteFlash}>{flash}</div>
        </div>
      )}

      {unmatchedOppNames.length > 0 && (
        <div style={{ padding: '0 1.25rem 0.5rem' }}>
          <div className={styles.warning}>
            <strong>
              ⚠ {unmatchedOppNames.length} BFO Opportunity Name{unmatchedOppNames.length === 1 ? '' : 's'} not tagged to an opp on Opps
            </strong>
            <div className={styles.warningHint}>
              Click an Opps opp below to tag it with the BFO Opportunity Name. Only opps that don&apos;t already have a BFO Opportunity Name are listed.
            </div>
            <ul className={styles.warnList}>
              {unmatchedOppNames.map(({ name, account }) => {
                const candidates = unlinkedOppsByKey.get(normalizeCompany(account)) || [];
                return (
                  <li key={name} className={styles.warnItem}>
                    <div className={styles.warnName}>
                      <span className={styles.warnNameText}>{name}</span>
                      {account && <span className={styles.warnAcct}> · {account}</span>}
                    </div>
                    {candidates.length === 0 ? (
                      <div className={styles.warnNone}>
                        No untagged Opps opps{account ? ` for “${account}”` : ''} to assign.
                      </div>
                    ) : (
                      <div className={styles.warnChips}>
                        {candidates.map(c => (
                          <button
                            key={c._id}
                            type="button"
                            className={styles.assignChip}
                            disabled={assigning}
                            title={`Tag this opp's BFO Opportunity Name as "${name}"`}
                            onClick={() => assignBfoName(c._id, name)}
                          >
                            + {oppTargetLabel(c)}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className={styles.body}>
        {pasteOpen && (
          <div className={styles.pasteBox}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
              Paste tab-separated rows from BFO. First row is treated as the header.
            </div>
            <textarea
              className={styles.pasteArea}
              rows={8}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'Account Name\tOpportunity Name\tAmount\t…\nDivco Capital\tSB - SUECO ...\tUSD 15,000.00\t…'}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => { importPaste(pasteText); setPasteText(''); setPasteOpen(false); }}
              >Import</button>
              <button
                type="button"
                className={styles.btn}
                onClick={() => setPasteOpen(false)}
              >Cancel</button>
            </div>
          </div>
        )}

        {data.rows.length === 0 ? (
          <div className={styles.empty}>
            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>No BFO data yet.</div>
            <div style={{ fontSize: 'var(--font-size-xs)' }}>
              Select your BFO Activity rows (including the header), copy, then paste anywhere on this page. We'll auto-detect columns and render a sortable table. The data persists in your browser until you clear or replace it.
            </div>
          </div>
        ) : (
          <>
            <div className={styles.summary}>
              {(() => {
                const visible = displayData.headers.filter(h => !hiddenCols[h]);
                const hidden = displayData.headers.length - visible.length;
                return `${filtered.length} of ${displayData.rows.length} rows${search ? ` matching "${search}"` : ''} · ${visible.length} of ${displayData.headers.length} columns visible${hidden ? ` (${hidden} hidden)` : ''}`;
              })()}
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {displayData.headers.filter(h => !hiddenCols[h]).map(h => {
                      const isSorted = sortBy?.col === h;
                      return (
                        <th key={h} style={{ width: colWidths[h] ?? 160 }}>
                          <span className={styles.thInner}>
                            <span onClick={() => toggleSort(h)} title="Click to sort" style={{ flex: 1 }}>
                              {h}
                              {isSorted && <span className={styles.sortArrow}>{sortBy.dir === 'asc' ? '▲' : '▼'}</span>}
                            </span>
                            <span
                              className={styles.colResizer}
                              onMouseDown={(e) => startColResize(h, e)}
                              title="Drag to resize column"
                            />
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={i}>
                      {displayData.headers.filter(h => !hiddenCols[h]).map(h => {
                        const v = r[h] ?? '';
                        const isAge = /^age$/i.test(h);
                        const isAmount = /^amount$/i.test(h);
                        const classes = [
                          (isAge || isAmount) ? styles.nowrapCell : '',
                        ].filter(Boolean).join(' ');
                        return <td key={h} className={classes}>{v}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      </div>
      )}
    </div>
  );
}
