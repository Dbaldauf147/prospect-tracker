import { useMemo, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { asNumber, asDate, fmtCurrency, fmtPercent, fmtDate } from '../../utils/dealsFormat';
import { loadCommissions, saveCommissionsOverride, clearCommissionsOverride } from '../../utils/commissionsStore';
import { CommissionsPasteImportModal, COMMISSIONS_CANONICAL } from './CommissionsPasteImportModal';
import { loadOppsFromCache, findOppByBfoLink } from '../../utils/oppsCache';

// Lookup columns the user adds at the front of the table. Account Name
// is an autocomplete against the Table View prospect roster; BFO Name is
// the BFO Opportunity Name the user pastes from the Opps tab; Scope is
// a read-only lookup that resolves BFO Name against the cached Opps
// records.
const ACCOUNT_NAME_KEY = 'Account Name';
const BFO_NAME_KEY = 'BFO Name';
const SCOPE_KEY = 'Scope';

// Shared <datalist> id for the Account Name autocomplete — every cell
// editor on the column points at this list via `list="..."`.
const ACCOUNT_NAME_LIST_ID = 'commissions-account-name-suggestions';

// Inline cell editor: shows the formatted value, swaps to a text input on
// double-click, commits on Enter / blur, cancels on Escape. `listId`
// hooks the input up to a <datalist> for autocomplete (Account Name).
function EditableCell({ value, render, onSave, listId }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => {
    if (!editing) setDraft(value == null ? '' : String(value));
  }, [value, editing]);

  function commit(next) {
    onSave(next == null ? '' : String(next));
    setEditing(false);
  }

  if (!editing) {
    return (
      <span
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title="Double-click to edit"
        style={{ display: 'inline-block', width: '100%', cursor: 'text' }}
      >
        {render(value)}
      </span>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      value={draft}
      list={listId}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(value == null ? '' : String(value)); setEditing(false); }
      }}
      style={{
        width: '100%', padding: '0.15rem 0.3rem',
        border: '1px solid #3B82F6', borderRadius: 4,
        fontSize: '0.7rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B',
        boxSizing: 'border-box',
      }}
    />
  );
}

// Detect a "<m>/1/<y>" header so the column renderer can flip to
// currency formatting. The plain-date header is the commission $ for
// that month; the "<m>/1/<y> Revenue" variant is the underlying project
// revenue that produced it.
const MONTH_KEY_RE = /^\d{1,2}\/1\/\d{4}$/;
function isMonthCommissionKey(k) { return MONTH_KEY_RE.test(String(k || '').trim()); }
function isMonthRevenueKey(k) {
  const s = String(k || '').trim();
  return /^\d{1,2}\/1\/\d{4}\s+Revenue$/i.test(s);
}
const FY_REVENUE_RE = /^FY(\d{4})\s+Revenue$/i;
function isFYRevenueKey(k) { return FY_REVENUE_RE.test(String(k || '').trim()); }

// The fiscal year the canonical month columns cover. Pulled out of the
// canonical FY Revenue header so the matching FY Commission column we
// add below tracks the same year without needing the paste-import
// modal to export it separately.
const CANONICAL_YEAR = (() => {
  for (const k of COMMISSIONS_CANONICAL) {
    const m = FY_REVENUE_RE.exec(String(k).trim());
    if (m) return Number(m[1]);
  }
  return new Date().getFullYear();
})();
const FY_COMMISSION_KEY = `FY${CANONICAL_YEAR} Commission`;
const PAYMENT_STATUS_KEY = 'Payment Status';

const CURRENCY_KEYS = new Set();
const DATE_KEYS = new Set(['Comm Start Date', 'Comm End Date']);
const PERCENT_KEYS = new Set(['%']);

function defaultWidth(k) {
  if (k === ACCOUNT_NAME_KEY) return 200;
  if (k === BFO_NAME_KEY) return 200;
  if (k === SCOPE_KEY) return 180;
  if (k === FY_COMMISSION_KEY) return 130;
  if (k === PAYMENT_STATUS_KEY) return 110;
  if (k === 'Name') return 170;
  if (k === 'Project Name') return 280;
  if (DATE_KEYS.has(k)) return 120;
  if (PERCENT_KEYS.has(k)) return 70;
  if (isFYRevenueKey(k)) return 130;
  if (isMonthRevenueKey(k) || isMonthCommissionKey(k)) return 110;
  return 130;
}

// Sum every column on the row whose key matches `match`. Returns null
// when the row has no matching cells at all — the renderer falls back
// to a muted dash for that case so an empty roster row still reads as
// "no data" instead of "$0.00".
function sumMatchingCells(row, match) {
  let total = 0;
  let any = false;
  for (const k of Object.keys(row || {})) {
    if (!match(k)) continue;
    const n = asNumber(row[k]);
    if (n == null) continue;
    total += n;
    any = true;
  }
  return any ? total : null;
}

// "Are payments still rolling in or have they stopped?" — used by the
// Payment Status column. Prefers the explicit Comm End Date when set; if
// the row doesn't have one, falls back to the most recent non-zero
// monthly commission cell and compares it against today.
function paymentStatusFor(row) {
  const end = asDate(row?.['Comm End Date']);
  if (end) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const e = new Date(end); e.setHours(0, 0, 0, 0);
    if (e.getTime() < today.getTime()) {
      return { state: 'stopped', label: 'Stopped', title: `Comm End Date ${fmtDate(end)} is in the past` };
    }
    return { state: 'active', label: 'Active', title: `Comm End Date ${fmtDate(end)}` };
  }
  let lastIdx = -1;
  for (let m = 1; m <= 12; m++) {
    const n = asNumber(row?.[`${m}/1/${CANONICAL_YEAR}`]);
    if (n != null && n !== 0) lastIdx = m - 1;
  }
  if (lastIdx === -1) return { state: 'unknown', label: '—', title: 'No Comm End Date and no commission entries on file' };
  const today = new Date();
  const todayMonthIdx = today.getFullYear() === CANONICAL_YEAR
    ? today.getMonth()
    : (today.getFullYear() < CANONICAL_YEAR ? -1 : 12);
  if (lastIdx >= todayMonthIdx - 1) {
    return { state: 'active', label: 'Active', title: `Most recent commission: ${lastIdx + 1}/${CANONICAL_YEAR}` };
  }
  return { state: 'stopped', label: 'Stopped', title: `Most recent commission: ${lastIdx + 1}/${CANONICAL_YEAR} — no payments since` };
}

function PaymentStatusBadge({ state, label, title }) {
  const palette = state === 'active' ? { bg: '#DCFCE7', fg: '#166534' }
    : state === 'stopped' ? { bg: '#FEE2E2', fg: '#991B1B' }
    : { bg: '#F1F5F9', fg: '#64748B' };
  return (
    <span title={title} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 4, background: palette.bg, color: palette.fg, fontWeight: 600, fontSize: '0.7rem' }}>
      {label}
    </span>
  );
}

// Plain-text cell used by Account Name / BFO Name / pasted Name fields.
function plainTextRender(v) {
  if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  return <span>{String(v)}</span>;
}

// Normalize a Project Name for dedup matching — strips surrounding
// whitespace, collapses internal whitespace, and lowercases so trivial
// typing differences ("Acme — Phase 1" vs "ACME — Phase 1 ") don't
// produce two duplicate rows that fall through the merge.
function normProjectName(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// How many "real" cells on this row carry a value. Used to pick the
// surviving row when two rows share a project name — whichever copy has
// more months / columns filled in beats the stale one.
function countFilledCells(row) {
  let n = 0;
  for (const k of Object.keys(row || {})) {
    if (k === 'id' || k.startsWith('__')) continue;
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s === '') continue;
    n++;
  }
  return n;
}

// Concatenate existing + newly-pasted commission rows and dedup by
// normalized Project Name. Rows without a project name pass through
// untouched (we have no key to group them by); for rows with one, the
// copy with more filled cells survives. Newer (incoming) rows win ties
// so a re-paste of an equally-filled row picks up any edits.
export function mergeAndDedupCommissions(existing, incoming) {
  const out = [];
  const winnerByKey = new Map();
  function consider(row, isIncoming) {
    const key = normProjectName(row['Project Name']);
    if (!key) { out.push(row); return; }
    const score = countFilledCells(row);
    const prev = winnerByKey.get(key);
    if (!prev || score > prev.score || (score === prev.score && isIncoming)) {
      winnerByKey.set(key, { row, score });
    }
  }
  for (const r of (existing || [])) consider(r, false);
  for (const r of (incoming || [])) consider(r, true);
  for (const { row } of winnerByKey.values()) out.push(row);
  return out;
}

// Build the three lookup columns the user adds in front of the imported
// roster: Account Name (autocomplete from prospects), BFO Name (free
// text — the BFO Opportunity Name the user pastes), and Scope (read-only
// lookup that resolves BFO Name against the cached Opps records).
function buildFrontColumns(oppsCache) {
  return [
    {
      key: ACCOUNT_NAME_KEY,
      label: ACCOUNT_NAME_KEY,
      defaultWidth: defaultWidth(ACCOUNT_NAME_KEY),
      sticky: true,
      render: (row) => (
        <EditableCell
          value={row[ACCOUNT_NAME_KEY]}
          render={plainTextRender}
          onSave={(v) => row.__onUpdate?.(row.id, ACCOUNT_NAME_KEY, v)}
          listId={ACCOUNT_NAME_LIST_ID}
        />
      ),
      exportValue: (row) => row[ACCOUNT_NAME_KEY] ?? '',
    },
    {
      key: BFO_NAME_KEY,
      label: BFO_NAME_KEY,
      defaultWidth: defaultWidth(BFO_NAME_KEY),
      render: (row) => (
        <EditableCell
          value={row[BFO_NAME_KEY]}
          render={plainTextRender}
          onSave={(v) => row.__onUpdate?.(row.id, BFO_NAME_KEY, v)}
        />
      ),
      exportValue: (row) => row[BFO_NAME_KEY] ?? '',
    },
    {
      key: SCOPE_KEY,
      label: SCOPE_KEY,
      defaultWidth: defaultWidth(SCOPE_KEY),
      // Scope is derived from the Opps cache — sort and export off the
      // resolved value, not whatever (nothing) is stored on the row.
      getSortValue: (row) => {
        const opp = findOppByBfoLink(oppsCache, row[BFO_NAME_KEY]);
        return opp ? String(opp[SCOPE_KEY] || '') : '';
      },
      render: (row) => {
        const bfo = String(row[BFO_NAME_KEY] || '').trim();
        if (!bfo) return <span style={{ color: 'var(--color-text-muted)' }} title="Paste a BFO Opportunity Name in the previous column to look up its Scope">—</span>;
        const opp = findOppByBfoLink(oppsCache, bfo);
        if (!opp) return <span style={{ color: '#B91C1C' }} title="No Opps row matches this BFO Opportunity Name">no match</span>;
        const scope = String(opp[SCOPE_KEY] || '').trim();
        if (!scope) return <span style={{ color: 'var(--color-text-muted)' }} title="Matching Opps row has no Scope set">—</span>;
        return <span title={`From Opps row for "${bfo}"`}>{scope}</span>;
      },
      exportValue: (row) => {
        const opp = findOppByBfoLink(oppsCache, row[BFO_NAME_KEY]);
        return opp ? (opp[SCOPE_KEY] || '') : '';
      },
    },
  ];
}

// Pill-style currency cell used by the auto-summed FY Revenue / FY
// Commission columns so they read as derived totals, not editable cells.
function renderSumCell(total, emptyTitle, sumTitle) {
  if (total == null) {
    return <span style={{ color: 'var(--color-text-muted)' }} title={emptyTitle}>—</span>;
  }
  return (
    <span
      title={sumTitle}
      style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A', fontWeight: 600 }}
    >
      {fmtCurrency(total)}
    </span>
  );
}

function buildColumns(oppsCache) {
  const front = buildFrontColumns(oppsCache);
  const canonical = COMMISSIONS_CANONICAL.map((k) => {
    const isCurrency = CURRENCY_KEYS.has(k) || isMonthRevenueKey(k) || isFYRevenueKey(k) || isMonthCommissionKey(k);
    const isDate = DATE_KEYS.has(k);
    const isPercent = PERCENT_KEYS.has(k);
    // FY Revenue is computed at render time from the 12 monthly revenue
    // cells to its left — the user wants a live total, not whatever was
    // pasted. Sort / export both follow the same computed number.
    if (isFYRevenueKey(k)) {
      return {
        key: k,
        label: k,
        defaultWidth: defaultWidth(k),
        getSortValue: (row) => sumMatchingCells(row, isMonthRevenueKey),
        render: (row) => renderSumCell(
          sumMatchingCells(row, isMonthRevenueKey),
          'No monthly revenue entries on this row',
          `Sum of the 12 monthly revenue cells for ${CANONICAL_YEAR}`,
        ),
        exportValue: (row) => sumMatchingCells(row, isMonthRevenueKey) ?? '',
      };
    }
    return {
      key: k,
      label: k,
      defaultWidth: defaultWidth(k),
      ...(isDate ? { getSortValue: (row) => { const d = asDate(row[k]); return d ? d.getTime() : null; } } : {}),
      ...(isCurrency || isPercent ? { getSortValue: (row) => asNumber(row[k]) } : {}),
      render: (row) => {
        const v = row[k];
        if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
        if (isCurrency) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtCurrency(v)}</span>;
        if (isPercent) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtPercent(v)}</span>;
        if (isDate) return <span style={{ color: '#334155' }}>{fmtDate(v)}</span>;
        return <span>{String(v)}</span>;
      },
      exportValue: (row) => {
        const v = row[k];
        if (v == null) return '';
        if (isCurrency || isPercent) {
          const n = asNumber(v);
          return n != null ? n : v;
        }
        return v;
      },
    };
  });
  // Mirror of the FY Revenue column, but summing the 12 monthly
  // commission cells — sits at the tail of the table where the user
  // wanted it. Followed by the derived Payment Status pill.
  const fyCommissionCol = {
    key: FY_COMMISSION_KEY,
    label: FY_COMMISSION_KEY,
    defaultWidth: defaultWidth(FY_COMMISSION_KEY),
    getSortValue: (row) => sumMatchingCells(row, isMonthCommissionKey),
    render: (row) => renderSumCell(
      sumMatchingCells(row, isMonthCommissionKey),
      'No monthly commission entries on this row',
      `Sum of the 12 monthly commission cells for ${CANONICAL_YEAR}`,
    ),
    exportValue: (row) => sumMatchingCells(row, isMonthCommissionKey) ?? '',
  };
  const paymentStatusCol = {
    key: PAYMENT_STATUS_KEY,
    label: PAYMENT_STATUS_KEY,
    defaultWidth: defaultWidth(PAYMENT_STATUS_KEY),
    getSortValue: (row) => paymentStatusFor(row).state,
    render: (row) => {
      const s = paymentStatusFor(row);
      return <PaymentStatusBadge state={s.state} label={s.label} title={s.title} />;
    },
    exportValue: (row) => paymentStatusFor(row).label,
  };
  return [...front, ...canonical, fyCommissionCol, paymentStatusCol];
}

export function CommissionsView({ settings, updateSettings, prospects = [] }) {
  const [{ data, source }, setStore] = useState(() => loadCommissions());
  const [search, setSearch] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [initialPaste, setInitialPaste] = useState('');
  // Cached Opps records, used by the Scope lookup column. Refreshes on
  // mount and when the window regains focus so pasting on the Opps tab
  // and switching back here reflects new entries without a reload.
  const [oppsCache, setOppsCache] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadOppsFromCache().then(c => { if (!cancelled) setOppsCache(c || null); }).catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'commissions-list-override') setStore(loadCommissions());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Page-level paste handler. When the user hits Ctrl/Cmd+V anywhere on
  // the Commissions tab — including the empty-state placeholder, the
  // toolbar, or the table — pop the import modal open with the
  // clipboard text pre-filled so they don't have to click Paste from
  // Excel first. Skipped while a real input / textarea has focus so the
  // search box and the modal's own textarea keep working normally.
  useEffect(() => {
    function onPaste(e) {
      if (showPaste) return;
      const ae = document.activeElement;
      const tag = ae && ae.tagName ? ae.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (ae && ae.isContentEditable)) return;
      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (!text || !text.trim()) return;
      e.preventDefault();
      setInitialPaste(text);
      setShowPaste(true);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [showPaste]);

  const columns = useMemo(() => buildColumns(oppsCache), [oppsCache]);
  const tableId = useMemo(() => 'commissions:' + columns.map(c => c.key).sort().join('|'), [columns]);

  // Page-level autocomplete pool for the Account Name column —
  // mirrors the Deals tab's Client Name suggestions so the user gets
  // predictive matches against every company already in Table View.
  const accountNameSuggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of (prospects || [])) {
      const c = String(p?.company || '').trim();
      if (!c) continue;
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [prospects]);

  // Save a single cell back to localStorage / the in-memory data array.
  // Empty values delete the key entirely so empty cells render the muted
  // "—" placeholder. Mirrors the DealsView updateCell pattern.
  function updateCell(rowId, key, value) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setStore(prev => {
      const next = [...prev.data];
      const current = { ...(next[idx] || {}) };
      if (value === '' || value == null) delete current[key];
      else current[key] = value;
      next[idx] = current;
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
  }

  const rows = useMemo(
    () => data.map((r, i) => ({ ...r, id: i, __onUpdate: updateCell })),
    [data]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(term)));
  }, [rows, search]);

  function handleImport(records) {
    setStore(prev => {
      // Merge the freshly-pasted records into whatever's already on
      // file, then dedup by Project Name so re-pasting a refreshed
      // commission roster doesn't pile duplicate rows on top of the
      // existing data. When two rows share a project name, the one
      // with more filled cells (months / columns) wins — the user's
      // expectation is that the more complete snapshot survives.
      const merged = mergeAndDedupCommissions(prev.data || [], records);
      try { saveCommissionsOverride(merged); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: merged, source: 'override' };
    });
    setShowPaste(false);
  }

  function handleClear() {
    if (!window.confirm('Clear all imported commissions data?')) return;
    clearCommissionsOverride();
    setStore({ data: [], source: 'empty' });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Predictive-text source for every Account Name cell. Rendered
          once at the view level so each EditableCell input just points
          at it via list="..." — matches the Deals tab pattern. */}
      <datalist id={ACCOUNT_NAME_LIST_ID}>
        {accountNameSuggestions.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>Commissions</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.15rem' }}>
            {rows.length === 0
              ? 'Paste your monthly commission roster from Excel — the next step maps each pasted column to a destination.'
              : `${rows.length} commission row${rows.length === 1 ? '' : 's'} on file.`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            title="Paste tab-separated rows copied from Excel. The next step lets you confirm which pasted column maps to each commission field."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid #16A34A', background: '#16A34A', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >Paste from Excel</button>
          {source === 'override' && (
            <button
              type="button"
              onClick={handleClear}
              title="Remove the imported commissions list"
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
          )}
        </div>
      </div>

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter commissions…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569', textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No commissions yet</div>
            <div style={{ fontSize: '0.78rem' }}>
              Click <strong>Paste from Excel</strong> to drop in copied commission rows. The popup will map each pasted column (Name, Project Name, monthly revenue, monthly commission…) onto its destination.
            </div>
          </div>
        ) : (
          <DataTable
            key={tableId}
            tableId={tableId}
            columns={columns}
            rows={filtered}
            emptyMessage={search ? `No rows match "${search}"` : 'No commissions to display'}
            enableColumnFilters
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>

      {showPaste && (
        <CommissionsPasteImportModal
          onClose={() => { setShowPaste(false); setInitialPaste(''); }}
          onImport={(records) => { handleImport(records); setInitialPaste(''); }}
          initialPaste={initialPaste}
        />
      )}
    </div>
  );
}
