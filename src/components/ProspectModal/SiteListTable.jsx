// The company popup's saved Site List as a table: the shared DataTable, so
// every column can be filtered (the search / pick-list row under the
// headers), sorted, resized, hidden and reordered, with the layout saved
// per user. "Expand" opens the same table in a near full screen popup for
// a long list.
//
// The list's columns are whatever the saved sheet carried, so they are
// built from its headers. Every list shares one tableId: a column a
// company's list doesn't have is simply absent.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';

const TABLE_ID = 'company-site-list';

// "510,000", "$1.2", "45%" sort as numbers; anything else as text.
function sortValue(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = s.replace(/[$,%\s]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(n)) return Number(n);
  return s.toLowerCase();
}

function useSiteListTable(list) {
  const headers = useMemo(() => (list?.headers || []).filter(Boolean), [list]);
  const rows = useMemo(
    () => (list?.rows || []).map((r, i) => ({ ...r, _id: `site-${i}` })),
    [list],
  );
  // Starting width from the longest of the header and the first rows'
  // values, so a site name isn't cut to a few letters.
  const widthOf = (h) => {
    let longest = h.length * 1.15;
    for (const r of (list?.rows || []).slice(0, 200)) longest = Math.max(longest, String(r[h] ?? '').length);
    return Math.round(Math.min(320, Math.max(80, longest * 7.2 + 28)));
  };
  const columns = useMemo(() => headers.map((h) => ({
    key: h,
    label: h,
    defaultWidth: widthOf(h),
    getFilterValue: (r) => String(r[h] ?? ''),
    getSortValue: (r) => sortValue(r[h]),
    exportValue: (r) => r[h] ?? '',
    render: (r) => {
      const v = String(r[h] ?? '');
      return v ? <span title={v.length > 30 ? v : undefined}>{v}</span> : '';
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [headers, list]);
  return { headers, rows, columns };
}

/**
 * The inline table, plus the button that opens it full screen. `title`
 * names the popup (the company).
 */
export function SiteListTable({ list, title = '', settings, updateSettings }) {
  const { rows, columns } = useSiteListTable(list);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setExpanded(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]);

  if (!rows.length) return null;
  const table = (
    <DataTable
      tableId={TABLE_ID}
      columns={columns}
      rows={rows}
      fitWidth={false}
      emptyMessage="No sites match these filters"
      exportFileName={`${title || 'Company'} Site List`}
      settings={settings}
      updateSettings={updateSettings}
    />
  );

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title="Open the site list in a large popup"
          style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', fontWeight: 600 }}
        >⤢ Expand</button>
      </div>
      {!expanded && (
        // DataTable fills its parent's height: room for the rows up to a
        // bounded box, then it scrolls.
        <div style={{ height: `min(420px, ${130 + rows.length * 30}px)`, display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid var(--color-border-light)', borderRadius: 6 }}>
          {table}
        </div>
      )}
      {expanded && createPortal(
        <div
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${title ? `${title} ` : ''}Site List`}
            style={{ width: '96vw', height: '92vh', background: 'var(--color-surface, #fff)', borderRadius: 10, boxShadow: '0 20px 50px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', padding: '0.75rem 1rem', minHeight: 0 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>{title ? `${title}: ` : ''}Site List</div>
              <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{rows.length.toLocaleString()} {rows.length === 1 ? 'site' : 'sites'}</span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="Close"
                title="Close (Esc)"
                style={{ marginLeft: 'auto', fontSize: '0.8rem', padding: '0.3rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', fontWeight: 600 }}
              >Close</button>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {table}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
