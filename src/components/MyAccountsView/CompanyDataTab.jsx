import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataTable } from '../common/DataTable';
import { COMPANY_DATA_FIELDS, fieldValue, isTextField, missingFields, planCompanyDataPaste } from '../../utils/companyDataFields';
import { sanitizeSheetJsWorkbook } from '../../utils/exportSanitize';
import { makeDecisionMakerLookup } from '../../utils/decisionMakerCoverage';
import { allMissingStepsFor, STEP_FIELDS } from '../../utils/allMissingSteps';
import { ZOOM_SEARCH_LOG_KEY, readLog as readZoomSearchLog, titleSearchesForCompany } from '../../utils/zoomSearchLog';
import { readWorkKey, ZOOM_SEARCH_LOG_EVENT } from '../../utils/mirroredWorkKeys';
import { buildZoomExcludedMatcher, zoomExcludedLabel } from '../../utils/zoomExportExclude';
import { ZoomExcludedCell } from './ZoomExcludedCell';

// My Accounts > Company Data: which of the accounts have their size numbers
// (sites, utility accounts, meters, equipment, electric MWh) and their
// ZoomInfo id / name and company URL filled in, an
// Excel export of the ones that don't, and a paste box that writes the
// numbers back once they've been found.
//
// Reads the company records themselves (the same fields the company popup's
// Scale section edits), so an account that only exists on the Opps sheet,
// with no company record to write to, is counted but not listed.

const MISSING_ANY = '__any';

function MissingChip() {
  return (
    <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: '0.66rem', fontWeight: 700, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>Missing</span>
  );
}

export function CompanyDataTab({ accounts = [], prospects = [], contacts = null, onUpdate, onSelect, settings, updateSettings, filterBar }) {
  const [show, setShow] = useState(MISSING_ANY);
  const [pasteOpen, setPasteOpen] = useState(false);

  const prospectById = useMemo(() => new Map((prospects || []).map(p => [p.id, p])), [prospects]);
  // Same match the Zoom CSV downloads drop rows by, so the column and the
  // export can't disagree about a company.
  const isZoomExcluded = useMemo(() => buildZoomExcludedMatcher(prospects), [prospects]);

  // Steps remaining on each company's Contacts > By Category ladder, counted
  // by the same rule the popup's own Steps remaining column uses
  // (utils/dmSteps). Who a company's decision makers are comes from the
  // shared lookup (name match, plus the contacts linked or matched on the
  // email domain, less those removed by hand). Null while contacts load, so
  // a company isn't shown as owing every step before we know.
  const localFields = settings?.contactLocalFields || null;
  const links = settings?.companyContactLinks || null;
  const exclusions = settings?.companyContactExclusions || null;
  const tagReview = settings?.contactTagReview || null;
  const dmLookup = useMemo(
    () => (contacts ? makeDecisionMakerLookup(contacts, { localFields, links, exclusions }) : null),
    [contacts, localFields, links, exclusions],
  );

  // The Zoom title searches logged on Bulk Add > Zoom Search Log: a logged
  // search for a category does its Zoom search ran step, the same as in the
  // popup. Re-read when the log changes elsewhere.
  const [zoomLog, setZoomLog] = useState(() => readZoomSearchLog(readWorkKey(ZOOM_SEARCH_LOG_KEY)));
  useEffect(() => {
    const reload = () => setZoomLog(readZoomSearchLog(readWorkKey(ZOOM_SEARCH_LOG_KEY)));
    window.addEventListener(ZOOM_SEARCH_LOG_EVENT, reload);
    return () => window.removeEventListener(ZOOM_SEARCH_LOG_EVENT, reload);
  }, []);

  // One row per account with a company record behind it, its numbers read
  // off that record so an edit made anywhere shows here at once.
  const { rows, noRecord } = useMemo(() => {
    const out = [];
    let missing = 0;
    for (const a of accounts) {
      const p = prospectById.get(a.id);
      if (!p) { missing += 1; continue; }
      const row = { id: p.id, company: p.company || a.company || '', tier: a.myTier || a.tier || '', status: p.status || '', cdm: p.cdm || '' };
      for (const f of COMPANY_DATA_FIELDS) row[f.key] = fieldValue(f, p[f.key]);
      row.zoomExcluded = isZoomExcluded({ id: p.id, company: p.company || a.company, zoomId: p.zoomCompanyId });
      row.missing = missingFields(row);
      row.missingCount = row.missing.length;
      const steps = dmLookup ? allMissingStepsFor({
        dms: dmLookup.forAccount(p), record: p, tagReview,
        titleSearches: titleSearchesForCompany(zoomLog.searches, { company: p.company || a.company, zoomCompanyId: p.zoomCompanyId, zoomCompanyName: p.zoomCompanyName }),
      }) : null;
      row.stepsRemaining = steps ? steps.stepsRemaining : null;
      row.stepsDetail = steps ? steps.perBucket.map(b => `${b.bucket.label}: ${b.left}`).join('\n') : '';
      row.missingData = STEP_FIELDS.filter(f => row[f.key] === null).length;
      row.allMissingSteps = steps ? steps.allMissingSteps : null;
      out.push(row);
    }
    return { rows: out, noRecord: missing };
  }, [accounts, prospectById, dmLookup, tagReview, isZoomExcluded, zoomLog]);

  const missingCounts = useMemo(() => {
    const m = {};
    for (const f of COMPANY_DATA_FIELDS) m[f.key] = rows.filter(r => r[f.key] === null).length;
    m[MISSING_ANY] = rows.filter(r => r.missingCount > 0).length;
    return m;
  }, [rows]);

  const shown = useMemo(() => {
    if (show === MISSING_ANY) return rows.filter(r => r.missingCount > 0);
    if (show) return rows.filter(r => r[show] === null);
    return rows;
  }, [rows, show]);

  const columns = useMemo(() => [
    {
      key: 'company', label: 'Company', defaultWidth: 240, sticky: true,
      render: (row) => (
        <button
          type="button"
          onClick={() => { const p = prospectById.get(row.id); if (p) onSelect?.(p); }}
          style={{ padding: 0, border: 'none', background: 'none', color: '#1D4ED8', fontWeight: 600, fontSize: 'inherit', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}
        >{row.company}</button>
      ),
    },
    { key: 'tier', label: 'Tier', defaultWidth: 80 },
    { key: 'status', label: 'Status', defaultWidth: 120 },
    { key: 'cdm', label: 'CDM', defaultWidth: 130 },
    {
      key: 'zoomExcluded', label: 'ZoomInfo', defaultWidth: 110,
      headerTitle: 'Whether the company is excluded from ZoomInfo exports (the Exclude from ZoomInfo button on its company popup)',
      getSortValue: (row) => (row.zoomExcluded ? 1 : 0),
      getFilterValue: (row) => zoomExcludedLabel(row.zoomExcluded),
      exportValue: (row) => zoomExcludedLabel(row.zoomExcluded),
      render: (row) => <ZoomExcludedCell excluded={row.zoomExcluded} />,
    },
    ...COMPANY_DATA_FIELDS.map(f => ({
      key: f.key, label: f.label, defaultWidth: f.key === 'website' ? 200 : isTextField(f) ? 160 : 120,
      getFilterValue: (row) => (row[f.key] === null ? 'Missing' : String(row[f.key])),
      render: (row) => {
        const v = row[f.key];
        if (v === null) return <MissingChip />;
        if (f.key === 'website') {
          const href = /^https?:\/\//i.test(v) ? v : `https://${v}`;
          return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#1D4ED8' }}>{v}</a>;
        }
        return isTextField(f) ? v : v.toLocaleString();
      },
    })),
    {
      key: 'stepsRemaining', label: 'Steps Remaining', defaultWidth: 150,
      getFilterValue: (row) => (row.stepsRemaining === null ? '' : String(row.stepsRemaining)),
      render: (row) => (row.stepsRemaining === null
        ? <span style={{ color: '#94A3B8' }} title="Contacts are still loading">-</span>
        : (
          <span
            title={`Steps left on the Contacts > By Category ladder, per category:\n${row.stepsDetail}`}
            style={{ fontWeight: 700, color: row.stepsRemaining === 0 ? '#16A34A' : '#1E293B' }}
          >{row.stepsRemaining}</span>
        )),
    },
    {
      key: 'missingData', label: 'Missing Data', defaultWidth: 120,
      getFilterValue: (row) => String(row.missingData),
      render: (row) => (
        <span
          title={`Missing: ${STEP_FIELDS.filter(f => row[f.key] === null).map(f => f.label).join(', ') || 'none'}`}
          style={{ fontWeight: 700, color: row.missingData === 0 ? '#16A34A' : '#B91C1C' }}
        >{row.missingData}</span>
      ),
    },
    {
      key: 'allMissingSteps', label: 'All Missing Steps', defaultWidth: 150,
      getFilterValue: (row) => (row.allMissingSteps === null ? '' : String(row.allMissingSteps)),
      render: (row) => (row.allMissingSteps === null
        ? <span style={{ color: '#94A3B8' }} title="Contacts are still loading">-</span>
        : (
          <span
            title={`Steps remaining (${row.stepsRemaining}) + missing sites, utility accounts and equipment (${row.missingData})`}
            style={{ fontWeight: 700, color: row.allMissingSteps === 0 ? '#16A34A' : '#1E293B' }}
          >{row.allMissingSteps}</span>
        )),
    },
    {
      key: 'missingCount', label: 'Missing', defaultWidth: 90,
      getFilterValue: (row) => String(row.missingCount),
      render: (row) => (row.missingCount === 0
        ? <span style={{ color: '#16A34A', fontWeight: 700 }}>Complete</span>
        : <span style={{ color: '#B91C1C', fontWeight: 700 }}>{row.missingCount} of {COMPANY_DATA_FIELDS.length}</span>),
    },
  ], [prospectById, onSelect]);

  // The table's own Export Excel writes the whole page: the rows as listed
  // (with the column filters, sort and shown columns applied), then a
  // Summary sheet carrying the missing / filled counts from the cards.
  const showLabel = show === MISSING_ANY ? 'Missing any value'
    : show ? `Missing ${COMPANY_DATA_FIELDS.find(f => f.key === show)?.label || show}` : 'All companies';
  const summarySheet = useMemo(() => ({
    name: 'Summary',
    rows: [
      ...COMPANY_DATA_FIELDS.map(f => ({
        Field: f.label,
        Missing: missingCounts[f.key],
        Filled: rows.length - missingCounts[f.key],
        Companies: rows.length,
      })),
      { Field: 'Missing any value', Missing: missingCounts[MISSING_ANY], Filled: rows.length - missingCounts[MISSING_ANY], Companies: rows.length },
      { Field: `Listed in this export: ${showLabel}`, Missing: '', Filled: '', Companies: shown.length },
    ],
  }), [missingCounts, rows.length, shown.length, showLabel]);

  // The export is the paste-back template: ID and Company first (what the
  // paste matches on), then every field, filled where the company already
  // has a number and blank where it doesn't. The step counts ride along at
  // the end for reference; Paste values ignores their headers.
  async function exportMissing() {
    const list = shown.filter(r => r.missingCount > 0);
    if (list.length === 0) { alert('Nothing is missing for the companies shown.'); return; }
    const XLSX = await import('xlsx');
    const data = list.map(r => {
      const o = { ID: r.id, Company: r.company, Tier: r.tier, Status: r.status };
      for (const f of COMPANY_DATA_FIELDS) o[f.label] = r[f.key] === null ? '' : r[f.key];
      o['Steps Remaining'] = r.stepsRemaining ?? '';
      o['Missing Data'] = r.missingData;
      o['All Missing Steps'] = r.allMissingSteps ?? '';
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 22 }, { wch: 40 }, { wch: 9 }, { wch: 16 }, ...COMPANY_DATA_FIELDS.map(f => ({ wch: isTextField(f) ? 28 : 16 })), { wch: 16 }, { wch: 13 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Missing company data');
    sanitizeSheetJsWorkbook(wb);
    XLSX.writeFile(wb, `Company data missing ${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const btn = { padding: '0.3rem 0.7rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {filterBar}
        <select
          value={show}
          onChange={e => setShow(e.target.value)}
          title="Which companies to list"
          style={{ ...btn, border: '1px solid #CBD5E1', background: '#fff', color: '#334155' }}
        >
          <option value={MISSING_ANY}>{`Missing any value (${missingCounts[MISSING_ANY]})`}</option>
          {COMPANY_DATA_FIELDS.map(f => <option key={f.key} value={f.key}>{`Missing ${f.label} (${missingCounts[f.key]})`}</option>)}
          <option value="">{`All companies (${rows.length})`}</option>
        </select>
        <button
          type="button"
          onClick={exportMissing}
          title="Download the companies listed that are missing a value, as an Excel sheet to fill in. Paste the filled-in rows back with Paste values."
          style={{ ...btn, border: '1px solid #16A34A', background: '#F0FDF4', color: '#166534' }}
        >{`Export missing (${shown.filter(r => r.missingCount > 0).length})`}</button>
        <button
          type="button"
          onClick={() => setPasteOpen(true)}
          title="Paste rows copied from the filled-in export to write the values onto the companies"
          style={{ ...btn, border: '1px solid #2563EB', background: '#EFF6FF', color: '#1D4ED8' }}
        >Paste values</button>
        {noRecord > 0 && (
          <span style={{ fontSize: '0.7rem', color: '#64748B' }}>
            {noRecord} account{noRecord === 1 ? '' : 's'} with no company record (Opps sheet only) left out.
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.6rem 0' }}>
        {COMPANY_DATA_FIELDS.map(f => {
          const n = missingCounts[f.key];
          const have = rows.length - n;
          const active = show === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setShow(active ? MISSING_ANY : f.key)}
              title={`Show the ${n} compan${n === 1 ? 'y' : 'ies'} missing ${f.label}`}
              style={{ flex: '1 1 140px', minWidth: 140, textAlign: 'left', padding: '0.55rem 0.75rem', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', background: active ? '#EFF6FF' : '#fff', border: `1px solid ${active ? '#2563EB' : '#E2E8F0'}`, borderLeft: `4px solid ${n === 0 ? '#16A34A' : '#DC2626'}` }}
            >
              <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{f.label}</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1E293B' }}>{n} missing</div>
              <div style={{ fontSize: '0.68rem', color: '#64748B' }}>{have} of {rows.length} filled</div>
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <DataTable
          tableId="my-accounts-company-data"
          settings={settings}
          updateSettings={updateSettings}
          columns={columns}
          rows={shown}
          alwaysVisible={['company']}
          defaultSort={{ key: 'missingCount', direction: 'desc' }}
          enableColumnFilters
          emptyMessage={show === '' ? 'No companies to show.' : 'Nothing missing here.'}
          exportFileName="my_accounts_company_data"
          exportPrimarySheetName="Company data"
          exportExtraSheets={[summarySheet]}
        />
      </div>

      {pasteOpen && (
        <PasteValuesModal
          records={rows}
          onUpdate={onUpdate}
          onClose={() => setPasteOpen(false)}
        />
      )}
    </>
  );
}

function PasteValuesModal({ records, onUpdate, onClose }) {
  const [text, setText] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(null);
  const plan = useMemo(() => (text.trim() ? planCompanyDataPaste(text, records, { overwrite }) : null), [text, records, overwrite]);
  const writes = plan ? plan.updates.reduce((n, u) => n + u.changes.length, 0) : 0;

  async function apply() {
    if (!plan || plan.updates.length === 0) return;
    setApplying(true);
    let ok = 0;
    const errors = [];
    for (const u of plan.updates) {
      try { await onUpdate?.(u.id, u.patch); ok += 1; }
      catch (err) { errors.push(`${u.company}: ${err?.message || err}`); }
    }
    setApplying(false);
    setDone({ ok, errors });
    setText('');
  }

  const fmt = (v) => (v === null ? 'blank' : typeof v === 'string' ? v : Number(v).toLocaleString());
  const section = { fontSize: '0.72rem', lineHeight: 1.5, padding: '0.45rem 0.6rem', borderRadius: 6 };

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }} onClick={() => { if (!applying) onClose(); }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, width: 720, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>Paste company values</div>
            <div style={{ fontSize: '0.72rem', color: '#64748B', lineHeight: 1.45 }}>
              Copy the rows from the filled-in export, header row included, and paste them here. Rows find their company by the ID column, or by name. Blank cells are left alone.
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={applying} style={{ border: 'none', background: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', overflowY: 'auto' }}>
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setDone(null); }}
            disabled={applying}
            rows={8}
            placeholder={`ID\tCompany\t${COMPANY_DATA_FIELDS.map(f => f.label).join('\t')}\n...`}
            style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', resize: 'vertical' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: '#334155' }}>
            <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} disabled={applying} />
            Also replace values a company already has (off: only blanks are filled)
          </label>

          {done && (
            <div style={{ ...section, background: done.errors.length ? '#FEF2F2' : '#F0FDF4', color: done.errors.length ? '#991B1B' : '#166534' }}>
              Updated {done.ok} compan{done.ok === 1 ? 'y' : 'ies'}.
              {done.errors.length > 0 && <> {done.errors.length} failed: {done.errors.slice(0, 5).join('; ')}</>}
            </div>
          )}

          {plan?.error && <div style={{ ...section, background: '#FEF3C7', color: '#92400E' }}>{plan.error}</div>}

          {plan && !plan.error && (
            <>
              <div style={{ ...section, background: '#F8FAFC', color: '#334155' }}>
                <strong>{writes} value{writes === 1 ? '' : 's'}</strong> to write on <strong>{plan.updates.length} compan{plan.updates.length === 1 ? 'y' : 'ies'}</strong>
                {plan.skipped.length > 0 && <>, {plan.skipped.length} kept because the company already has a value</>}
                {plan.invalid.length > 0 && <>, {plan.invalid.length} not a number</>}
                {plan.unmatched.length > 0 && <>, {plan.unmatched.length} row{plan.unmatched.length === 1 ? '' : 's'} with no matching company</>}.
              </div>
              {plan.updates.length > 0 && (
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                    <tbody>
                      {plan.updates.flatMap(u => u.changes.map(c => (
                        <tr key={`${u.id}-${c.key}`} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '0.25rem 0.5rem', fontWeight: 600, color: '#1E293B' }}>{u.company}</td>
                          <td style={{ padding: '0.25rem 0.5rem', color: '#64748B' }}>{c.label}</td>
                          <td style={{ padding: '0.25rem 0.5rem', color: '#64748B' }}>{fmt(c.from)} → <strong style={{ color: '#166534' }}>{fmt(c.to)}</strong></td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              )}
              {plan.skipped.length > 0 && (
                <div style={{ ...section, background: '#FFFBEB', color: '#92400E' }}>
                  Kept (tick the box above to replace): {plan.skipped.slice(0, 8).map(s => `${s.company} ${s.label} ${fmt(s.from)} (pasted ${fmt(s.to)})`).join('; ')}{plan.skipped.length > 8 ? `; and ${plan.skipped.length - 8} more` : ''}
                </div>
              )}
              {plan.invalid.length > 0 && (
                <div style={{ ...section, background: '#FEF2F2', color: '#991B1B' }}>
                  Not a number, so not written: {plan.invalid.slice(0, 8).map(x => `${x.company} ${x.label} "${x.value}"`).join('; ')}{plan.invalid.length > 8 ? `; and ${plan.invalid.length - 8} more` : ''}
                </div>
              )}
              {plan.unmatched.length > 0 && (
                <div style={{ ...section, background: '#FEF2F2', color: '#991B1B' }}>
                  No company found for: {plan.unmatched.slice(0, 10).join(', ')}{plan.unmatched.length > 10 ? `, and ${plan.unmatched.length - 10} more` : ''}
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ padding: '0.7rem 1rem', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" onClick={onClose} disabled={applying} style={{ padding: '0.45rem 0.9rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.8rem', fontFamily: 'inherit', cursor: 'pointer', color: '#334155' }}>Close</button>
          <button
            type="button"
            onClick={apply}
            disabled={applying || !plan || plan.updates.length === 0}
            style={{ padding: '0.45rem 0.9rem', border: 'none', borderRadius: 6, background: (applying || !plan || plan.updates.length === 0) ? '#94A3B8' : '#2563EB', color: '#fff', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit', cursor: (applying || !plan || plan.updates.length === 0) ? 'not-allowed' : 'pointer' }}
          >{applying ? 'Updating…' : `Update ${plan?.updates.length || 0} compan${plan?.updates.length === 1 ? 'y' : 'ies'}`}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
