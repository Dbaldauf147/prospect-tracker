// PE Overview → Services Report.
//
// Pick a handful of services, then see where every company under the
// selected PE firm stands on each of them: a company × service grid, a
// per-service roll-up, and a Schneider-branded Excel export of the same
// thing.
//
// The status in each cell is the one that company's own page would show —
// a manual Services Explored value if there is one, otherwise the stage of
// an opp whose Scope names the service (see serviceCoverage). A report
// that disagreed with the page a user opens to check it would be worse
// than no report.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sanitizeExcelWorkbook } from '../../utils/exportSanitize.js';
import { buildOppStagesByClient, buildServiceCatalog, serviceLabelMap } from '../../utils/serviceCoverage.js';
import { buildPeServicesReport, sortReportRows, PE_SERVICES_SORTS } from '../../utils/peServicesReport.js';
import { SERVICE_BUCKETS, serviceStatusColor } from '../../utils/serviceStatusColors.js';

const BUCKET_BY_KEY = new Map(SERVICE_BUCKETS.map(b => [b.key, b]));

// Settings key holding the last picked services, so the report opens ready
// to re-run rather than empty every time.
const SELECTION_KEY = 'peServicesReportSelection';

const btn = (primary = false) => ({
  padding: '0.4rem 0.8rem',
  border: `1px solid ${primary ? '#7C3AED' : '#E2E8F0'}`,
  borderRadius: 6,
  background: primary ? '#7C3AED' : '#fff',
  color: primary ? '#fff' : '#334155',
  fontSize: '0.72rem',
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

function StatusChip({ status, bucket }) {
  if (!status) {
    return <span style={{ color: '#CBD5E1', fontSize: '0.72rem' }}>—</span>;
  }
  const colors = serviceStatusColor(status);
  const meta = BUCKET_BY_KEY.get(bucket);
  return (
    <span
      title={`${status}${meta && meta.label !== status ? ` · ${meta.label}` : ''}`}
      style={{
        display: 'inline-block', maxWidth: '100%', padding: '1px 7px', borderRadius: 999,
        fontSize: '0.66rem', fontWeight: 700, whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis',
        background: colors.bg || '#F1F5F9',
        color: colors.color || '#475569',
      }}
    >{status}</span>
  );
}

export function PEServicesReportModal({
  companies = [],
  firmLabel = 'PE firm',
  scopeNote = '',
  oppsRecords = [],
  settings = {},
  updateSettings,
  onClose,
  onSelectProspect,
}) {
  const catalog = useMemo(() => buildServiceCatalog(settings), [settings]);
  const labelOf = useMemo(() => serviceLabelMap(catalog), [catalog]);
  // Every key the catalogue still offers — a saved selection naming a
  // service since hidden or removed must not resurrect it.
  const validKeys = useMemo(() => {
    const s = new Set();
    for (const cat of catalog) for (const it of cat.items) s.add(it.key);
    return s;
  }, [catalog]);

  const [picked, setPicked] = useState(() => {
    const saved = Array.isArray(settings?.[SELECTION_KEY]) ? settings[SELECTION_KEY] : [];
    return saved.filter(k => typeof k === 'string');
  });
  // Two steps on purpose: picking is a decision about what you're pushing,
  // reading is a different task, and a live grid that reflows on every
  // checkbox makes both harder.
  const [step, setStep] = useState('pick');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('company');
  const [gapsOnly, setGapsOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const backdropMouseDown = useRef(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selected = useMemo(() => picked.filter(k => validKeys.has(k)), [picked, validKeys]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Opp-derived statuses for exactly these companies, so a service with no
  // manual status still reports the stage of the opp naming it.
  const oppStagesByClient = useMemo(
    () => buildOppStagesByClient(companies, oppsRecords),
    [companies, oppsRecords],
  );

  const report = useMemo(() => buildPeServicesReport({
    companies,
    serviceKeys: selected,
    oppStagesByClient,
    labelOf,
  }), [companies, selected, oppStagesByClient, labelOf]);

  const visibleRows = useMemo(() => {
    const rows = gapsOnly ? report.rows.filter(r => r.explored < selected.length) : report.rows;
    return sortReportRows(rows, sortKey);
  }, [report.rows, gapsOnly, selected.length, sortKey]);

  const toggle = (key) => setPicked(prev => (
    prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
  ));

  const setCategory = (cat, on) => setPicked(prev => {
    const keys = cat.items.map(it => it.key);
    if (!on) return prev.filter(k => !keys.includes(k));
    const next = [...prev];
    for (const k of keys) if (!next.includes(k)) next.push(k);
    return next;
  });

  function runReport() {
    if (selected.length === 0) return;
    // Remember the picks for next time. Fire-and-forget: a settings write
    // that fails must not stop the report the user asked for.
    try { updateSettings?.({ [SELECTION_KEY]: selected }); } catch { /* noop */ }
    setStep('report');
  }

  // Schneider-branded workbook: a Summary sheet (one row per service) and
  // a Detail sheet (the company × service grid), matching the styling of
  // the PE Overview table's own export.
  async function exportExcel() {
    setExporting(true);
    try {
      const { Workbook } = await import('exceljs');
      const SE_GREEN = 'FF3DCD58';
      const SE_GREEN_DARK = 'FF009530';
      const SE_BORDER = 'FFD4DDE1';
      const SE_TEXT = 'FF1E293B';
      const ZEBRA = 'FFF1F8F4';

      const wb = new Workbook();
      wb.creator = 'Schneider Electric · Prospect Tracker';
      wb.created = new Date();

      const banner = (ws, width, subtitle) => {
        ws.mergeCells(1, 1, 1, width);
        const title = ws.getCell(1, 1);
        title.value = 'Schneider Electric';
        title.font = { name: 'Nunito Sans', bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
        title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
        title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(1).height = 30;

        ws.mergeCells(2, 1, 2, width);
        const sub = ws.getCell(2, 1);
        sub.value = subtitle;
        sub.font = { name: 'Nunito Sans', italic: true, size: 10, color: { argb: 'FF64748B' } };
        sub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(2).height = 20;
      };

      const headerRow = (ws, headers) => {
        const row = ws.getRow(3);
        headers.forEach((h, i) => {
          const cell = row.getCell(i + 1);
          cell.value = h;
          cell.font = { name: 'Nunito Sans', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
          cell.border = {
            top: { style: 'thin', color: { argb: SE_BORDER } },
            bottom: { style: 'thin', color: { argb: SE_BORDER } },
            left: { style: 'thin', color: { argb: SE_BORDER } },
            right: { style: 'thin', color: { argb: SE_BORDER } },
          };
        });
        row.height = 26;
      };

      const body = (ws, values, startRow = 4) => {
        values.forEach((vals, ri) => {
          const r = ws.getRow(startRow + ri);
          vals.forEach((val, ci) => {
            const cell = r.getCell(ci + 1);
            cell.value = val === '' || val == null ? null : val;
            cell.font = { name: 'Nunito Sans', size: 10, color: { argb: SE_TEXT } };
            cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
            if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
            cell.border = {
              bottom: { style: 'thin', color: { argb: SE_BORDER } },
              left: { style: 'thin', color: { argb: SE_BORDER } },
              right: { style: 'thin', color: { argb: SE_BORDER } },
            };
          });
        });
      };

      const subtitle = `Services Report · ${firmLabel} · ${report.totals.companies} compan`
        + `${report.totals.companies === 1 ? 'y' : 'ies'} · ${report.totals.services} service`
        + `${report.totals.services === 1 ? '' : 's'}${scopeNote ? ` · ${scopeNote}` : ''}`;

      // --- Summary -------------------------------------------------------
      const sumHeaders = ['Service', ...SERVICE_BUCKETS.map(b => b.label), 'Explored', 'Coverage %'];
      const summary = wb.addWorksheet('Summary', {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ state: 'frozen', ySplit: 3 }],
      });
      summary.columns = sumHeaders.map((h, i) => ({ width: i === 0 ? 38 : Math.max(h.length + 4, 13) }));
      banner(summary, sumHeaders.length, subtitle);
      headerRow(summary, sumHeaders);
      body(summary, report.services.map(s => [
        s.label,
        ...SERVICE_BUCKETS.map(b => s[b.key]),
        `${s.explored} of ${s.total}`,
        s.pct / 100,
      ]));
      report.services.forEach((s, i) => {
        summary.getRow(4 + i).getCell(sumHeaders.length).numFmt = '0%';
      });
      summary.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: sumHeaders.length } };

      // --- Detail --------------------------------------------------------
      const detHeaders = ['Company', ...report.services.map(s => s.label), 'Explored', 'Sold'];
      const detail = wb.addWorksheet('Detail', {
        properties: { tabColor: { argb: SE_GREEN } },
        views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }],
      });
      detail.columns = detHeaders.map((h, i) => ({ width: i === 0 ? 34 : Math.max(h.length + 4, 16) }));
      banner(detail, detHeaders.length, subtitle);
      headerRow(detail, detHeaders);
      body(detail, visibleRows.map(r => [
        r.company,
        ...report.services.map(s => r.statuses[s.key] || 'Not explored'),
        `${r.explored} of ${report.totals.services}`,
        r.sold,
      ]));
      detail.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: detHeaders.length } };

      sanitizeExcelWorkbook(wb);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const safe = (firmLabel || 'pe_firm').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}_services_report_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Services report export failed', err);
      window.alert(`Could not build the Excel file: ${err?.message || err}`);
    } finally {
      setExporting(false);
    }
  }

  const q = search.trim().toLowerCase();
  const pickCatalog = q
    ? catalog
      .map(cat => ({ ...cat, items: cat.items.filter(it => it.label.toLowerCase().includes(q)) }))
      .filter(cat => cat.items.length > 0)
    : catalog;

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: step === 'pick' ? 720 : 1100, maxWidth: '95vw', maxHeight: '90vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.85rem 1rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Services Report: {firmLabel}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
              {step === 'pick'
                ? `Pick the services to report on across ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}${scopeNote ? ` · ${scopeNote}` : ''}`
                : `${report.totals.services} service${report.totals.services === 1 ? '' : 's'} · ${report.totals.companies} compan${report.totals.companies === 1 ? 'y' : 'ies'} · ${report.totals.pct}% of the grid explored${scopeNote ? ` · ${scopeNote}` : ''}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{ flexShrink: 0, background: 'none', border: 'none', fontSize: '1.3rem', lineHeight: 1, color: '#94A3B8', cursor: 'pointer' }}
          >×</button>
        </div>

        {step === 'pick' ? (
          <>
            <div style={{ padding: '0.6rem 1rem', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter services…"
                style={{ flex: 1, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
              />
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: selected.length ? '#7C3AED' : '#94A3B8', whiteSpace: 'nowrap' }}>
                {selected.length} selected
              </span>
              {selected.length > 0 && (
                <button type="button" onClick={() => setPicked([])} style={btn()}>Clear</button>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem', minHeight: 0 }}>
              {pickCatalog.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: '#64748B', fontStyle: 'italic' }}>No services match “{search.trim()}”.</div>
              ) : pickCatalog.map(cat => {
                const keys = cat.items.map(it => it.key);
                const allOn = keys.every(k => selectedSet.has(k));
                return (
                  <div key={cat.name} style={{ marginBottom: '0.9rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#475569' }}>
                        {cat.name}
                      </div>
                      <button
                        type="button"
                        onClick={() => setCategory(cat, !allOn)}
                        style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.68rem', fontWeight: 600, color: '#7C3AED', cursor: 'pointer', fontFamily: 'inherit' }}
                      >{allOn ? 'none' : 'all'}</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.15rem 0.75rem' }}>
                      {cat.items.map(it => (
                        <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.76rem', color: '#1E293B', cursor: 'pointer', padding: '0.15rem 0' }}>
                          <input type="checkbox" checked={selectedSet.has(it.key)} onChange={() => toggle(it.key)} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem', padding: '0.75rem 1rem', borderTop: '1px solid #E2E8F0', background: '#FBFBFC' }}>
              <button type="button" onClick={onClose} style={btn()}>Cancel</button>
              <button
                type="button"
                onClick={runReport}
                disabled={selected.length === 0 || companies.length === 0}
                title={companies.length === 0 ? 'No companies to report on' : selected.length === 0 ? 'Pick at least one service' : `Report on ${selected.length} service${selected.length === 1 ? '' : 's'}`}
                style={{ ...btn(true), opacity: selected.length === 0 || companies.length === 0 ? 0.5 : 1, cursor: selected.length === 0 || companies.length === 0 ? 'not-allowed' : 'pointer' }}
              >Run report</button>
            </div>
          </>
        ) : (
          <>
            {/* Per-service roll-up */}
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: '0.5rem', overflowX: 'auto', flexShrink: 0 }}>
              {report.services.map(s => (
                <div key={s.key} style={{ flex: '0 0 auto', minWidth: 190, border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.5rem 0.6rem', background: '#fff' }}>
                  <div title={s.label} style={{ fontSize: '0.74rem', fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#64748B', margin: '0.15rem 0 0.3rem' }}>
                    {s.explored} of {s.total} explored · {s.pct}%
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem' }}>
                    {SERVICE_BUCKETS.filter(b => s[b.key] > 0).map(b => (
                      <span
                        key={b.key}
                        title={`${s[b.key]} ${b.label.toLowerCase()}`}
                        style={{
                          padding: '0 6px', borderRadius: 999, fontSize: '0.64rem', fontWeight: 700,
                          background: b.key === 'none' ? '#F8FAFC' : b.bg,
                          color: b.color,
                          border: b.key === 'none' ? '1px solid #E2E8F0' : 'none',
                        }}
                      >{b.label} {s[b.key]}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Controls */}
            <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', flexShrink: 0 }}>
              <button type="button" onClick={() => setStep('pick')} style={btn()}>← Change services</button>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', fontWeight: 600, color: '#475569' }}>
                Sort
                <select
                  value={sortKey}
                  onChange={e => setSortKey(e.target.value)}
                  style={{ padding: '0.3rem 0.4rem', border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff', fontSize: '0.74rem', fontFamily: 'inherit', cursor: 'pointer' }}
                >
                  {PE_SERVICES_SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
                <input type="checkbox" checked={gapsOnly} onChange={e => setGapsOnly(e.target.checked)} />
                Only companies with a gap
              </label>
              <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
                {visibleRows.length} of {report.rows.length} shown
                {report.totals.untouched > 0 && ` · ${report.totals.untouched} with nothing explored`}
              </span>
              <div style={{ marginLeft: 'auto' }}>
                <button
                  type="button"
                  onClick={exportExcel}
                  disabled={exporting}
                  title="Download this report as a Schneider-branded Excel file (Summary + Detail sheets)"
                  style={{ ...btn(true), opacity: exporting ? 0.6 : 1, cursor: exporting ? 'wait' : 'pointer' }}
                >{exporting ? 'Building…' : '⬇ Excel'}</button>
              </div>
            </div>

            {/* Company × service grid */}
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              {visibleRows.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.8rem', color: '#64748B', fontStyle: 'italic' }}>
                  {gapsOnly ? 'Every company has all of these services explored.' : 'No companies to report on.'}
                </div>
              ) : (
                <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: '0.76rem' }}>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 3, background: '#F8FAFC', textAlign: 'left', padding: '0.45rem 0.75rem', borderBottom: '1px solid #E2E8F0', borderRight: '1px solid #E2E8F0', fontSize: '0.7rem', fontWeight: 700, color: '#475569', minWidth: 200 }}>
                        Company
                      </th>
                      {report.services.map(s => (
                        <th
                          key={s.key}
                          title={s.label}
                          style={{ position: 'sticky', top: 0, zIndex: 2, background: '#F8FAFC', textAlign: 'left', padding: '0.45rem 0.6rem', borderBottom: '1px solid #E2E8F0', fontSize: '0.7rem', fontWeight: 700, color: '#475569', minWidth: 140, maxWidth: 200 }}
                        >
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</div>
                        </th>
                      ))}
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#F8FAFC', textAlign: 'left', padding: '0.45rem 0.6rem', borderBottom: '1px solid #E2E8F0', fontSize: '0.7rem', fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                        Explored
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, ri) => (
                      <tr key={r.id} style={{ background: ri % 2 === 1 ? '#FBFCFD' : '#fff' }}>
                        <td style={{ position: 'sticky', left: 0, zIndex: 1, background: 'inherit', padding: '0.35rem 0.75rem', borderBottom: '1px solid #F1F5F9', borderRight: '1px solid #E2E8F0', maxWidth: 260 }}>
                          {onSelectProspect ? (
                            <button
                              type="button"
                              onClick={() => { onClose?.(); onSelectProspect(r._prospect); }}
                              title={`Open “${r.company}”`}
                              style={{ background: 'none', border: 'none', padding: 0, color: '#7C3AED', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', textAlign: 'left', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}
                            >{r.company || '-'}</button>
                          ) : (
                            <span style={{ fontWeight: 600 }}>{r.company || '-'}</span>
                          )}
                        </td>
                        {report.services.map(s => (
                          <td key={s.key} style={{ padding: '0.35rem 0.6rem', borderBottom: '1px solid #F1F5F9', maxWidth: 200 }}>
                            <StatusChip status={r.statuses[s.key]} bucket={r.buckets[s.key]} />
                          </td>
                        ))}
                        <td style={{ padding: '0.35rem 0.6rem', borderBottom: '1px solid #F1F5F9', color: r.explored === 0 ? '#94A3B8' : '#475569', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {r.explored}/{report.totals.services}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
