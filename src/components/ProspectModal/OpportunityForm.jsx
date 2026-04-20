import { useState, useEffect, useMemo, useRef } from 'react';
import { loadOppsFromCache, searchOpps } from '../../utils/oppsCache';

// Default form schema. Edit these arrays to change the template.
// `autofill` is the Opps sheet column whose value should populate the field
// when an opportunity is linked.
export const DEFAULT_FORM_TEMPLATE = {
  fields: [
    { key: 'account', label: 'Account', type: 'text', autofill: 'Account' },
    { key: 'contact', label: 'Contact', type: 'text', autofill: 'Contact' },
    { key: 'stage', label: 'Stage', type: 'text', autofill: 'Stage' },
    { key: 'status', label: 'Status', type: 'text', autofill: 'Status' },
    { key: 'scope', label: 'Scope', type: 'text', autofill: 'Scope' },
    { key: 'quotedAmount', label: 'Quoted Amount', type: 'text', autofill: 'Quoted Amount' },
    { key: 'startDate', label: 'Start Date', type: 'text', autofill: 'Start Date' },
    { key: 'closeDate', label: 'Close Date', type: 'text', autofill: 'Close Date' },
    { key: 'meetingDate', label: 'Meeting Date', type: 'date' },
    { key: 'attendees', label: 'Attendees', type: 'text' },
    { key: 'summary', label: 'Meeting Summary / Notes', type: 'textarea' },
    { key: 'nextSteps', label: 'Next Steps', type: 'textarea' },
  ],
  tables: [
    {
      key: 'actionItems',
      label: 'Action Items',
      columns: [
        { key: 'item', label: 'Action Item' },
        { key: 'owner', label: 'Owner' },
        { key: 'due', label: 'Due Date' },
        { key: 'status', label: 'Status' },
      ],
    },
    {
      key: 'risks',
      label: 'Risks / Open Items',
      columns: [
        { key: 'item', label: 'Item' },
        { key: 'notes', label: 'Notes' },
      ],
    },
  ],
};

function emptyFormData(template = DEFAULT_FORM_TEMPLATE) {
  const fieldValues = {};
  for (const f of template.fields) fieldValues[f.key] = '';
  const tables = {};
  for (const t of template.tables) {
    tables[t.key] = Array.from({ length: 2 }, () =>
      Object.fromEntries(t.columns.map(c => [c.key, '']))
    );
  }
  return { fieldValues, tables, linkedBfoLink: null };
}

export function OpportunityForm({ value, onChange, companyName }) {
  const template = DEFAULT_FORM_TEMPLATE;
  const formData = useMemo(() => {
    const base = emptyFormData(template);
    if (!value) return base;
    return {
      fieldValues: { ...base.fieldValues, ...(value.fieldValues || {}) },
      tables: Object.fromEntries(
        template.tables.map(t => [t.key, (value.tables && value.tables[t.key]) || base.tables[t.key]])
      ),
      linkedBfoLink: value.linkedBfoLink || null,
    };
  }, [value, template]);

  const set = (next) => onChange({ ...formData, ...next });

  const updateField = (key, val) => {
    set({ fieldValues: { ...formData.fieldValues, [key]: val } });
  };

  const updateTableCell = (tableKey, rowIdx, colKey, val) => {
    const rows = [...(formData.tables[tableKey] || [])];
    rows[rowIdx] = { ...rows[rowIdx], [colKey]: val };
    set({ tables: { ...formData.tables, [tableKey]: rows } });
  };

  const addTableRow = (tableKey) => {
    const col = template.tables.find(t => t.key === tableKey);
    if (!col) return;
    const empty = Object.fromEntries(col.columns.map(c => [c.key, '']));
    set({ tables: { ...formData.tables, [tableKey]: [...(formData.tables[tableKey] || []), empty] } });
  };

  const removeTableRow = (tableKey, rowIdx) => {
    const rows = [...(formData.tables[tableKey] || [])];
    rows.splice(rowIdx, 1);
    set({ tables: { ...formData.tables, [tableKey]: rows } });
  };

  // ---- Link opportunity (search the Opps cache by BFO Link or text) ----
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cache, setCache] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!pickerOpen) return;
    loadOppsFromCache().then(c => setCache(c));
  }, [pickerOpen]);

  const results = useMemo(() => searchOpps(cache, search), [cache, search]);

  const linkOpp = (opp) => {
    const nextValues = { ...formData.fieldValues };
    for (const f of template.fields) {
      if (f.autofill && opp[f.autofill] != null) {
        nextValues[f.key] = String(opp[f.autofill]);
      }
    }
    set({
      fieldValues: nextValues,
      linkedBfoLink: opp['BFO Link'] || null,
    });
    setPickerOpen(false);
    setSearch('');
  };

  const unlinkOpp = () => set({ linkedBfoLink: null });

  // ---- Export to Excel ----
  const exportExcel = async () => {
    try {
      const { Workbook } = await import('exceljs');
      const wb = new Workbook();
      wb.creator = 'Prospect Tracker';
      wb.created = new Date();
      const ws = wb.addWorksheet('Opportunity', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      ws.columns = [{ width: 28 }, { width: 60 }];

      const HEADER_FILL = 'FF009530';
      const BORDER = { style: 'thin', color: { argb: 'FFD4DDE1' } };

      const addSectionHeader = (text) => {
        const row = ws.addRow([text, '']);
        ws.mergeCells(row.number, 1, row.number, 2);
        const cell = row.getCell(1);
        cell.font = { name: 'Nunito Sans', bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        row.height = 22;
      };

      const addFieldRow = (label, value) => {
        const row = ws.addRow([label, value]);
        row.getCell(1).font = { name: 'Nunito Sans', bold: true, size: 10 };
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F9F4' } };
        row.getCell(1).alignment = { vertical: 'top', horizontal: 'left', indent: 1 };
        row.getCell(2).font = { name: 'Nunito Sans', size: 10 };
        row.getCell(2).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        row.getCell(1).border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
        row.getCell(2).border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
      };

      // Title
      const titleRow = ws.addRow([`${companyName || 'Opportunity'}`, '']);
      ws.mergeCells(titleRow.number, 1, titleRow.number, 2);
      const titleCell = titleRow.getCell(1);
      titleCell.value = `${companyName || 'Opportunity'}`;
      titleCell.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3DCD58' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      titleRow.height = 28;

      ws.addRow([]);
      addSectionHeader('Details');
      for (const f of template.fields) {
        addFieldRow(f.label, formData.fieldValues[f.key] || '');
      }

      for (const t of template.tables) {
        ws.addRow([]);
        addSectionHeader(t.label);
        // Table header
        const hRow = ws.addRow(t.columns.map(c => c.label));
        // Extend worksheet columns to accommodate table
        while (ws.columnCount < t.columns.length) {
          ws.getColumn(ws.columnCount + 1).width = 22;
        }
        hRow.eachCell((cell, col) => {
          if (col > t.columns.length) return;
          cell.font = { name: 'Nunito Sans', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
          cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
        });
        const rows = formData.tables[t.key] || [];
        for (const r of rows) {
          const values = t.columns.map(c => r[c.key] || '');
          const row = ws.addRow(values);
          row.eachCell((cell, col) => {
            if (col > t.columns.length) return;
            cell.font = { name: 'Nunito Sans', size: 10 };
            cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
            cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
          });
        }
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const safeName = (companyName || 'Opportunity').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName} - Opportunity.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert('Failed to export: ' + (err.message || err));
    }
  };

  // Simple styles inlined so this drops into ProspectModal without a new CSS file.
  const sx = {
    wrap: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
    toolbar: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
    btn: { fontSize: '0.72rem', padding: '0.3rem 0.6rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 },
    primaryBtn: { fontSize: '0.72rem', padding: '0.3rem 0.6rem', border: 'none', background: '#009530', color: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 },
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' },
    fieldLabel: { fontSize: '0.68rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.2rem' },
    input: { width: '100%', padding: '0.4rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.82rem' },
    textarea: { width: '100%', padding: '0.4rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.82rem', minHeight: '60px', resize: 'vertical' },
    sectionTitle: { fontSize: '0.8rem', fontWeight: 700, color: '#1E293B', margin: '0.75rem 0 0.35rem' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' },
    th: { textAlign: 'left', padding: '0.35rem 0.5rem', background: '#F1F5F9', fontWeight: 600, fontSize: '0.7rem', color: '#64748B', border: '1px solid var(--color-border-light)' },
    td: { padding: 0, border: '1px solid var(--color-border-light)', verticalAlign: 'top' },
    cellInput: { width: '100%', border: 'none', padding: '0.4rem 0.5rem', fontFamily: 'inherit', fontSize: '0.82rem', background: 'transparent' },
    rowBtn: { background: 'transparent', border: 'none', color: '#B91C1C', fontWeight: 700, cursor: 'pointer' },
    picker: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff', border: '1px solid var(--color-border)', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', marginTop: 4, maxHeight: 320, overflow: 'auto' },
    pickerItem: { padding: '0.5rem 0.6rem', borderBottom: '1px solid var(--color-border-light)', cursor: 'pointer' },
  };

  return (
    <div style={sx.wrap}>
      <div style={sx.toolbar}>
        <div style={{ position: 'relative' }}>
          <button type="button" style={sx.btn} onClick={() => setPickerOpen(o => !o)}>
            {formData.linkedBfoLink ? 'Change linked opportunity' : 'Link opportunity'}
          </button>
          {pickerOpen && (
            <div style={sx.picker}>
              <div style={{ padding: '0.4rem' }}>
                <input
                  style={sx.input}
                  autoFocus
                  placeholder="Search by Account, Contact, BFO Link, Scope, Stage…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              {cache == null ? (
                <div style={{ padding: '0.75rem', color: '#64748B' }}>Loading opps cache…</div>
              ) : !cache.records?.length ? (
                <div style={{ padding: '0.75rem', color: '#64748B' }}>
                  No opps cached. Open the Opps tab once to populate the cache.
                </div>
              ) : results.length === 0 ? (
                <div style={{ padding: '0.75rem', color: '#64748B' }}>No matches.</div>
              ) : results.map((r, i) => (
                <div
                  key={r._id || i}
                  style={sx.pickerItem}
                  onClick={() => linkOpp(r)}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{r['Account'] || '(no account)'}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                    {[r['Contact'], r['Stage'], r['Scope']].filter(Boolean).join(' · ')}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>BFO: {r['BFO Link'] || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {formData.linkedBfoLink && (
          <>
            <span style={{ fontSize: '0.7rem', color: '#64748B' }}>
              Linked to BFO: <code>{formData.linkedBfoLink}</code>
            </span>
            <button type="button" style={sx.btn} onClick={unlinkOpp}>Unlink</button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" style={sx.primaryBtn} onClick={exportExcel}>Export Excel</button>
      </div>

      <div style={sx.grid}>
        {template.fields.map(f => (
          <div key={f.key} style={f.type === 'textarea' ? { gridColumn: 'span 2' } : undefined}>
            <div style={sx.fieldLabel}>{f.label}</div>
            {f.type === 'textarea' ? (
              <textarea
                style={sx.textarea}
                value={formData.fieldValues[f.key] || ''}
                onChange={e => updateField(f.key, e.target.value)}
              />
            ) : (
              <input
                type={f.type === 'date' ? 'date' : 'text'}
                style={sx.input}
                value={formData.fieldValues[f.key] || ''}
                onChange={e => updateField(f.key, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      {template.tables.map(t => (
        <div key={t.key}>
          <div style={sx.sectionTitle}>{t.label}</div>
          <table style={sx.table}>
            <thead>
              <tr>
                {t.columns.map(c => (
                  <th key={c.key} style={sx.th}>{c.label}</th>
                ))}
                <th style={{ ...sx.th, width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {(formData.tables[t.key] || []).map((row, rIdx) => (
                <tr key={rIdx}>
                  {t.columns.map(c => (
                    <td key={c.key} style={sx.td}>
                      <input
                        style={sx.cellInput}
                        value={row[c.key] || ''}
                        onChange={e => updateTableCell(t.key, rIdx, c.key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td style={sx.td}>
                    <button
                      type="button"
                      style={sx.rowBtn}
                      title="Remove row"
                      onClick={() => removeTableRow(t.key, rIdx)}
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" style={{ ...sx.btn, marginTop: '0.35rem' }} onClick={() => addTableRow(t.key)}>
            + Add row
          </button>
        </div>
      ))}
    </div>
  );
}
