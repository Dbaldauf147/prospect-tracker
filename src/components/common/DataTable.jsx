import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import styles from './DataTable.module.css';

const COL_WIDTHS_PREFIX = 'prospect-col-widths-';
const COL_VISIBLE_PREFIX = 'prospect-col-visible-';
const COL_NAMES_PREFIX = 'prospect-col-names-';

function loadColNames(tableId) {
  try { return JSON.parse(localStorage.getItem(COL_NAMES_PREFIX + tableId)) || {}; } catch { return {}; }
}
function saveColNames(tableId, names) { localStorage.setItem(COL_NAMES_PREFIX + tableId, JSON.stringify(names)); }

function loadColWidths(tableId) {
  try { return JSON.parse(localStorage.getItem(COL_WIDTHS_PREFIX + tableId)) || {}; } catch { return {}; }
}
function saveColWidths(tableId, w) { localStorage.setItem(COL_WIDTHS_PREFIX + tableId, JSON.stringify(w)); }

function loadColVisible(tableId, allKeys) {
  try {
    const saved = JSON.parse(localStorage.getItem(COL_VISIBLE_PREFIX + tableId));
    if (saved) return new Set(saved);
    return new Set(allKeys);
  } catch { return new Set(allKeys); }
}
function saveColVisible(tableId, set) { localStorage.setItem(COL_VISIBLE_PREFIX + tableId, JSON.stringify([...set])); }

function ColumnToggle({ columns, visibleCols, onToggle, alwaysVisible, colNames, onRename }) {
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [editName, setEditName] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function startRename(col) {
    setEditingKey(col.key);
    setEditName(colNames[col.key] || col.label);
  }

  function saveRename() {
    if (editingKey && editName.trim()) {
      onRename(editingKey, editName.trim());
    }
    setEditingKey(null);
  }

  return (
    <div className={styles.colToggleWrap} ref={ref}>
      <button className={styles.colToggleBtn} onClick={() => setOpen(p => !p)}>
        Columns ({visibleCols.size}/{columns.length})
      </button>
      {open && (
        <div className={styles.colToggleDropdown}>
          {columns.map(col => (
            <div key={col.key} className={styles.colToggleItem}>
              <input
                type="checkbox"
                checked={visibleCols.has(col.key)}
                onChange={() => onToggle(col.key)}
                disabled={alwaysVisible?.includes(col.key)}
              />
              {editingKey === col.key ? (
                <input
                  className={styles.colRenameInput}
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={saveRename}
                  onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditingKey(null); }}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className={styles.colToggleLabel} onDoubleClick={() => startRename(col)}>
                  {colNames[col.key] || col.label}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Reusable data table with resizable columns and column visibility toggle.
 *
 * Props:
 *   tableId      - unique string for persisting settings (e.g. 'main', 'accounts', 'hubspot')
 *   columns      - array of { key, label, defaultWidth, render(row) }
 *   rows         - array of data objects
 *   onSort       - (key) => void, optional
 *   sortConfig   - { key, direction }, optional
 *   alwaysVisible - array of column keys that can't be hidden
 *   onRowClick   - (row) => void, optional
 *   emptyMessage - string
 */
export function DataTable({
  tableId,
  columns,
  rows,
  onSort: externalSort,
  sortConfig: externalSortConfig,
  alwaysVisible = [],
  onRowClick,
  rowClassName,
  rowStyle,
  emptyMessage = 'No data found',
  exportFileName,
  exportPrimarySheetName,
  // Extra sheets appended to the exported workbook. Each entry is
  // { name, rows: [{ header: value }] }. Column widths auto-fit from
  // the row keys.
  exportExtraSheets,
  // When provided, clicking Export Excel calls onExport with the full
  // export context instead of running the default XLSX writer. Lets a
  // consumer render a fully-branded workbook (Schneider Electric
  // formatting, etc.) while reusing the table's sort / visibility /
  // rename state.
  onExport,
  // When true, every visible column gets a compact text input under
  // its header. Rows are filtered (substring, case-insensitive) by
  // the raw cell value for each column that has a non-empty filter.
  enableColumnFilters = false,
}) {
  const [colWidths, setColWidths] = useState(() => loadColWidths(tableId));
  const [visibleCols, setVisibleCols] = useState(() => loadColVisible(tableId, columns.map(c => c.key)));
  const [colNames, setColNames] = useState(() => loadColNames(tableId));
  const [colFilters, setColFilters] = useState({});
  const resizingRef = useRef(null);

  function renameCol(key, name) {
    setColNames(prev => {
      const next = { ...prev, [key]: name };
      saveColNames(tableId, next);
      return next;
    });
  }

  // Built-in sort state (used when no external sort is provided)
  const [internalSort, setInternalSort] = useState({ key: null, direction: 'asc' });
  const sortConfig = externalSortConfig || internalSort;

  function handleSort(key) {
    if (externalSort) {
      externalSort(key);
    } else {
      setInternalSort(prev => {
        if (prev.key === key) {
          return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
        }
        return { key, direction: 'asc' };
      });
    }
  }

  // Sort rows internally if no external sort
  // Apply per-column text filters on top of the externally-filtered
  // rows prop. Substring match (case-insensitive) against String(row[key]).
  const filteredRows = useMemo(() => {
    const activeFilters = Object.entries(colFilters).filter(([, v]) => v && v.trim());
    if (activeFilters.length === 0) return rows;
    return rows.filter(row => {
      for (const [key, needle] of activeFilters) {
        const n = needle.toLowerCase();
        const hay = String(row[key] ?? '').toLowerCase();
        if (!hay.includes(n)) return false;
      }
      return true;
    });
  }, [rows, colFilters]);

  const sortedRows = useMemo(() => {
    if (externalSortConfig || !internalSort.key) return filteredRows;
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      let aVal = a[internalSort.key];
      let bVal = b[internalSort.key];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      // Try numeric comparison
      const aNum = parseFloat(String(aVal).replace(/[,$%]/g, ''));
      const bNum = parseFloat(String(bVal).replace(/[,$%]/g, ''));
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return internalSort.direction === 'asc' ? aNum - bNum : bNum - aNum;
      }
      // String comparison
      aVal = String(aVal).toLowerCase();
      bVal = String(bVal).toLowerCase();
      if (aVal < bVal) return internalSort.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return internalSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredRows, internalSort, externalSortConfig]);

  const headerRef = useRef(null);
  const bodyRef = useRef(null);

  function handleBodyScroll(e) {
    if (headerRef.current) headerRef.current.scrollLeft = e.target.scrollLeft;
  }

  const getWidth = (col) => colWidths[col.key] || col.defaultWidth || 120;
  const visibleColumns = columns.filter(c => visibleCols.has(c.key) || alwaysVisible.includes(c.key));

  function toggleCol(key) {
    if (alwaysVisible.includes(key)) return;
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveColVisible(tableId, next);
      return next;
    });
  }

  const handleResizeStart = useCallback((e, colKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colKey] || columns.find(c => c.key === colKey)?.defaultWidth || 120;
    resizingRef.current = colKey;

    function onMouseMove(ev) {
      const diff = ev.clientX - startX;
      const newWidth = Math.max(50, startWidth + diff);
      setColWidths(prev => {
        const next = { ...prev, [colKey]: newWidth };
        saveColWidths(tableId, next);
        return next;
      });
    }

    function onMouseUp() {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths, columns, tableId]);

  return (
    <div className={styles.outerWrap}>
      <div className={styles.toolbar}>
        <ColumnToggle columns={columns} visibleCols={visibleCols} onToggle={toggleCol} alwaysVisible={alwaysVisible} colNames={colNames} onRename={renameCol} />
        <button className={styles.resetBtn} onClick={() => { setColWidths({}); saveColWidths(tableId, {}); }}>
          Reset widths
        </button>
        <button className={styles.exportBtn} onClick={() => {
          if (typeof onExport === 'function') {
            onExport({
              columns: visibleColumns,
              rows: sortedRows,
              colNames,
              extraSheets: exportExtraSheets,
            });
            return;
          }
          const exportCols = visibleColumns;
          const data = sortedRows.map(row => {
            const obj = {};
            for (const col of exportCols) {
              const label = colNames[col.key] || col.label;
              let val;
              // Columns with derived data (e.g. values stored under
              // __electricCost__ while the column key is electricCost)
              // can provide an exportValue mapper so the export matches
              // what's on screen.
              if (typeof col.exportValue === 'function') {
                val = col.exportValue(row);
              } else {
                val = row[col.key];
              }
              obj[label] = Array.isArray(val) ? val.join(', ') : (val ?? '');
            }
            return obj;
          });
          const ws = XLSX.utils.json_to_sheet(data);
          ws['!cols'] = exportCols.map(col => ({ wch: Math.max((colNames[col.key] || col.label).length, 12) }));
          const wb = XLSX.utils.book_new();
          const primarySheetName = (exportPrimarySheetName || exportFileName || tableId || 'Export').replace(/[\\/:*?\[\]]+/g, '-').slice(0, 31);
          XLSX.utils.book_append_sheet(wb, ws, primarySheetName);
          if (Array.isArray(exportExtraSheets)) {
            for (const extra of exportExtraSheets) {
              if (!extra || !Array.isArray(extra.rows) || extra.rows.length === 0) continue;
              const extraWs = XLSX.utils.json_to_sheet(extra.rows);
              const extraHeaders = Object.keys(extra.rows[0]);
              extraWs['!cols'] = extraHeaders.map(h => ({ wch: Math.max(h.length + 2, 14) }));
              const extraName = String(extra.name || 'Sheet').replace(/[\\/:*?\[\]]+/g, '-').slice(0, 31);
              XLSX.utils.book_append_sheet(wb, extraWs, extraName);
            }
          }
          const safeName = (exportFileName || tableId || 'export').replace(/[\\/:*?"<>|]+/g, '-');
          XLSX.writeFile(wb, `${safeName} - ${new Date().toISOString().slice(0, 10)}.xlsx`);
        }}>
          Export Excel
        </button>
      </div>
      {sortedRows.length === 0 && !enableColumnFilters ? (
        <div className={styles.empty}>{emptyMessage}</div>
      ) : (
        <>
          <div className={styles.headerWrap} ref={headerRef}>
            <table className={styles.table} style={{ tableLayout: 'fixed', width: visibleColumns.reduce((s, c) => s + getWidth(c), 0) }}>
              <colgroup>
                {visibleColumns.map(col => (
                  <col key={col.key} style={{ width: getWidth(col) }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {visibleColumns.map(col => (
                    <th
                      key={col.key}
                      style={{ width: getWidth(col), position: 'relative' }}
                      onClick={() => handleSort(col.key)}
                      className={col.sticky ? styles.stickyCol : undefined}
                    >
                      {colNames[col.key] || col.label}
                      {sortConfig?.key === col.key && (
                        <span className={styles.sortArrow}>
                          {sortConfig.direction === 'asc' ? '\u25B2' : '\u25BC'}
                        </span>
                      )}
                      <span
                        className={styles.resizeHandle}
                        onMouseDown={e => handleResizeStart(e, col.key)}
                        onClick={e => e.stopPropagation()}
                      />
                    </th>
                  ))}
                </tr>
                {enableColumnFilters && (
                  <tr>
                    {visibleColumns.map(col => {
                      const filterable = !String(col.key || '').startsWith('_');
                      return (
                        <th
                          key={col.key}
                          style={{ width: getWidth(col), padding: '2px 4px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border-light)' }}
                          onClick={e => e.stopPropagation()}
                          className={col.sticky ? styles.stickyCol : undefined}
                        >
                          {filterable ? (
                            <input
                              type="text"
                              value={colFilters[col.key] || ''}
                              onChange={e => setColFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                              onClick={e => e.stopPropagation()}
                              placeholder="Filter..."
                              style={{ width: '100%', padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.68rem', fontFamily: 'inherit', boxSizing: 'border-box' }}
                            />
                          ) : null}
                        </th>
                      );
                    })}
                  </tr>
                )}
              </thead>
            </table>
          </div>
          {sortedRows.length === 0 ? (
            <div className={styles.empty}>{emptyMessage}</div>
          ) : (
            <div className={styles.scrollWrap} ref={bodyRef} onScroll={handleBodyScroll}>
              <table className={styles.table} style={{ tableLayout: 'fixed', width: visibleColumns.reduce((s, c) => s + getWidth(c), 0) }}>
                <colgroup>
                  {visibleColumns.map(col => (
                    <col key={col.key} style={{ width: getWidth(col) }} />
                  ))}
                </colgroup>
                <tbody>
                  {sortedRows.map((row, ri) => (
                    <tr key={row.id || ri} className={rowClassName ? rowClassName(row) : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined} style={{ ...(onRowClick ? { cursor: 'pointer' } : undefined), ...(rowStyle ? rowStyle(row) : undefined) }}>
                      {visibleColumns.map(col => (
                        <td key={col.key} className={col.sticky ? styles.stickyCol : undefined}>
                          {col.render ? col.render(row) : (row[col.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
