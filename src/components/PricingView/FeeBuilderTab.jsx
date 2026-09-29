import { Fragment, useState } from 'react';
import { sanitizeExcelWorkbook } from '../../utils/exportSanitize';
import styles from './ServicesTab.module.css';
import own from './FeeBuilderTab.module.css';
import { serviceKey, groupFeeRows } from '../../utils/pricingServices';
import { addFeeSummarySheet, addFeeComparisonSheet } from '../../utils/feeSummarySheets';

const fmtMoney = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '');
const fmtPct = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '');
const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
// The From cell for a fee line: every service the fee covers, comma
// separated. A fee several services wrote lists all of them, those whose
// row was left off for having no fee of its own included, since the one
// row that stays bills their costs too.
const feeKey = (name) => String(name || '').trim().toLowerCase();
function coveredByFee(shared) {
  const m = new Map();
  for (const c of shared || []) m.set(feeKey(c.fee), [...c.services, ...(c.unpriced || [])]);
  return m;
}
function fromLabel(g, covered) {
  const names = [];
  const add = (n) => { if (n && !names.includes(n)) names.push(n); };
  for (const r of g.subRows.length ? g.subRows : [g.row]) add(r.service);
  for (const n of covered.get(feeKey(g.row.name)) || []) add(n);
  const onSchedule = (g.subRows.length ? g.subRows : [g.row]).some(r => !r.service);
  if (onSchedule) add('On the schedule');
  return names.join(', ');
}

// The as-built schedule as a workbook: a fee several services share is one
// line with a grouped (collapsible) sub-row per service under it, then the
// total and the option's totals now and as built. Group lines and totals
// are styled apart from the rows under them so they read as totals.
async function exportPlan(plan) {
  const { Workbook } = await import('exceljs');
  const numYears = plan.numYears || 1;
  const yearIdx = Array.from({ length: numYears }, (_, i) => i);
  const money = (n) => (typeof n === 'number' && Number.isFinite(n) && n !== 0 ? Math.round(n * 100) / 100 : null);
  const pct = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
  const MONEY = '$#,##0.00';
  const PCT = '0.0%';
  const thin = { style: 'thin', color: { argb: 'FFCBD5E1' } };
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

  const wb = new Workbook();
  const sub = `${plan.optionName || 'Option'}  ·  as built by the Fee Builder`;
  // Fee Summary reads the way a client would: lines with the same name and
  // structure are one fee. The As built sheet below keeps every line.
  addFeeSummarySheet(wb, { rows: plan.rows, subtitle: `${sub}  ·  like fees combined`, condense: true });
  const ws = wb.addWorksheet('As built', { properties: { outlineProperties: { summaryBelow: false } } });
  const headers = ['Fee', 'From', 'Type', 'Fee / Unit', 'Unit', 'Unit Count', 'Start Month', ...yearIdx.map(i => `Y${i + 1}`), 'Term', 'Margin'];
  const moneyCols = [4, ...yearIdx.map(i => 8 + i), 8 + numYears];
  const marginCol = 9 + numYears;
  ws.columns = [30, 34, 20, 12, 12, 11, 11, ...yearIdx.map(() => 14), 14, 10].map(width => ({ width }));

  const head = ws.addRow(headers);
  head.eachCell(c => { c.font = { bold: true }; c.fill = fill('FFF1F5F9'); c.border = { bottom: thin }; });
  const formats = (row) => {
    for (const c of moneyCols) row.getCell(c).numFmt = MONEY;
    row.getCell(marginCol).numFmt = PCT;
  };
  const line = (r, name, from) => ws.addRow([
    name, from, r.type || '', typeof r.feePerUnit === 'number' ? r.feePerUnit : null, r.unit || '',
    r.unitCount ?? null, r.startMonth ?? null, ...yearIdx.map(i => money(r.years?.[i])), money(r.term), pct(r.margin),
  ]);

  const covered = coveredByFee(plan.shared);
  for (const g of groupFeeRows(plan.rows)) {
    const top = line(g.row, g.row.name, fromLabel(g, covered));
    formats(top);
    if (g.subRows.length) {
      top.eachCell({ includeEmpty: true }, c => { c.font = { bold: true }; c.fill = fill('FFEEF2FF'); });
    }
    for (const sr of g.subRows) {
      const sub = line(sr, sr.name, sr.service || 'On the schedule');
      formats(sub);
      sub.outlineLevel = 1;
      sub.getCell(1).alignment = { indent: 2 };
      sub.getCell(1).font = { color: { argb: 'FF64748B' } };
    }
  }
  const termAll = sum(plan.rows.map(r => r.term));
  const costAll = sum(plan.rows.map(r => r.cost));
  const total = ws.addRow(['Total', '', '', null, '', null, null, ...yearIdx.map(i => money(plan.after.feeByYear[i])),
    money(sum(plan.after.feeByYear)), termAll > 0 ? (termAll - costAll) / termAll : null]);
  formats(total);
  total.eachCell({ includeEmpty: true }, c => {
    c.font = { bold: true };
    c.fill = fill('FFE2E8F0');
    c.border = { top: thin, bottom: { style: 'double', color: { argb: 'FF64748B' } } };
  });

  ws.addRow([]);
  const th = ws.addRow([`${plan.optionName} totals`, ...yearIdx.map(i => `Y${i + 1} fees`), 'Term fees', 'Term cost', 'Deal margin']);
  th.eachCell(c => { c.font = { bold: true }; c.fill = fill('FFF1F5F9'); c.border = { bottom: thin }; });
  for (const [label, t] of [['Now on the schedule', plan.before], ['As built', plan.after]]) {
    const r = ws.addRow([label, ...yearIdx.map(i => money(t.feeByYear[i])), money(sum(t.feeByYear)), money(sum(t.costByYear)),
      t.margin?.finalMargin != null ? t.margin.finalMargin : null]);
    for (let c = 2; c <= numYears + 3; c++) r.getCell(c).numFmt = MONEY;
    r.getCell(numYears + 4).numFmt = PCT;
    if (label === 'As built') r.eachCell(c => { c.font = { bold: true }; });
  }

  addFeeComparisonSheet(wb, {
    costLines: plan.costLines || [],
    pricing: { rows: plan.beforeRows || [], totals: plan.before },
    builder: { rows: plan.rows, totals: plan.after },
    numYears,
    subtitle: sub,
  });

  sanitizeExcelWorkbook(wb);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fee-schedule-${String(plan.optionName || 'option').replace(/[^\w.-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Fee Builder subtab: one row per service in SIA scope (and any other
// service that has saved fee structures), each with a pick of the fee
// structures saved for it on the Services subtab. The picks together
// rebuild the option's Alternative Fee schedule: a preview first, then one
// Build button writes it.
//
//   setPicks      updates { [serviceKey]: structureId | '' }, '' = leave as
//                 is, absent = the service's standard structure when in scope
//   planFor       () => the services, their picks, the rebuilt schedule and
//                 the option's totals for the active option
//   onApply       (plan) => writes it, true when it did
export function FeeBuilderTab({
  workbook, activeOption, setActiveOption, setPicks, planFor, onApply, onOpenServices,
}) {
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [flash, setFlash] = useState('');
  const opt = workbook?.options?.find(o => o.optionNumber === activeOption) || workbook?.options?.[0] || null;

  if (!workbook) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.intro}>
          Pick a fee structure for each service and the Alternative Fee schedule is built from them.
          Upload an SIA on the <strong>Pricing</strong> subtab to start.
        </p>
      </div>
    );
  }

  const plan = planFor ? planFor() : null;
  const rows = plan?.services || [];
  const listed = rows.filter(r => r.inScope || showAll);
  const hiddenCount = rows.length - listed.length;
  const noStructures = listed.filter(r => r.structures.length === 0).length;
  const setPick = (name, id) => setPicks?.(prev => ({ ...prev, [serviceKey(name)]: id }));
  const setAll = (mode) => setPicks?.(() => {
    const next = {};
    for (const r of rows) {
      if (mode === 'none') next[serviceKey(r.name)] = '';
    }
    return next;
  });
  const numYears = plan?.numYears || 1;
  const yearIdx = Array.from({ length: numYears }, (_, i) => i);
  const building = plan?.perService?.length || 0;
  const covered = coveredByFee(plan?.shared);

  return (
    <div className={styles.wrapper}>
      <p className={styles.intro}>
        Pick a fee structure for each service and the Alternative Fee schedule on the option is built from them.
        Each service starts on its <span className={styles.star}>★</span> standard structure. Blank fees are filled
        with the standard fee from the service&apos;s costs, the same as <strong>Apply to Option</strong> on the
        Services subtab. Fee structures are set up per service on the <strong>Services</strong> subtab.
      </p>

      {workbook.options.length > 1 && (
        <div className={styles.optionStrip}>
          {workbook.options.map(o => (
            <button
              key={o.sheetName}
              type="button"
              className={o.optionNumber === opt?.optionNumber ? styles.optionActive : styles.option}
              onClick={() => setActiveOption(o.optionNumber)}
            >
              {o.sheetName}
            </button>
          ))}
        </div>
      )}

      <section className={styles.section}>
        <div className={own.bar}>
          <h4 className={styles.sectionTitle}>Fee structure by service</h4>
          <span className={styles.barSpacer} />
          <button type="button" className={own.smallBtn} onClick={() => setAll('standard')}>Use standard for all</button>
          <button type="button" className={own.smallBtn} onClick={() => setAll('none')}>Leave all as is</button>
          <label className={own.toggle}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show services outside SIA scope{hiddenCount > 0 && !showAll ? ` (${hiddenCount})` : ''}
          </label>
        </div>
        {listed.length === 0 ? (
          <p className={styles.note}>
            No services in SIA scope on {plan?.optionName || 'this option'}. Tie cost lines to services on the <strong>Linked To</strong> subtab.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Service</th>
                <th className={styles.num}>Cost lines</th>
                <th className={styles.num}>CTS</th>
                <th>On the schedule now</th>
                <th>Fee structure</th>
                <th>Fees it writes</th>
              </tr>
            </thead>
            <tbody>
              {listed.map(r => {
                const built = plan.perService.find(p => p.service === r.name);
                return (
                  <tr key={r.name}>
                    <td>
                      <div>{r.name}</div>
                      <div className={styles.subNote}>
                        {r.inScope ? <span className={styles.scopeTag}>In SIA scope</span> : 'Not in SIA scope'}
                        {r.bucket ? ` ${r.bucket}` : ''}
                      </div>
                    </td>
                    <td className={styles.num}>{r.costCount || ''}</td>
                    <td className={styles.num}>{r.costCts ? fmtMoney(r.costCts) : ''}</td>
                    <td className={own.muted}>{r.currentFees.length ? r.currentFees.join(', ') : 'Nothing'}</td>
                    <td>
                      {r.structures.length === 0 ? (
                        <button type="button" className={styles.linkBtn} onClick={onOpenServices}>
                          No saved structures, set one up
                        </button>
                      ) : (
                        <select
                          className={own.select}
                          value={r.pickedId}
                          onChange={(e) => setPick(r.name, e.target.value)}
                        >
                          <option value="">Leave as is</option>
                          {r.structures.map(st => (
                            <option key={st.id} value={st.id}>
                              {st.id === r.standardId ? '★ ' : ''}{st.name || 'Untitled'}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      {built ? (
                        <>
                          {built.added.map(a => a.altItem).join(', ') || <span className={own.muted}>No named fees</span>}
                          {built.removed.length > 0 && (
                            <div className={styles.subNote}>Replaces {built.removed.map(x => x.altItem).join(', ')}</div>
                          )}
                        </>
                      ) : <span className={own.muted}>Unchanged</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {noStructures > 0 && (
          <p className={styles.note}>
            {noStructures} service{noStructures === 1 ? ' has' : 's have'} no saved fee structure yet, so {noStructures === 1 ? 'its' : 'their'} fees
            stay as they are. Save one from the SIA setup on the Services subtab.
          </p>
        )}
      </section>

      {plan && (
        <section className={styles.section}>
          <div className={own.bar}>
            <h4 className={styles.sectionTitle}>Alternative Fee schedule on {plan.optionName}, as built</h4>
            <span className={styles.barSpacer} />
            <button
              type="button"
              className={own.smallBtn}
              disabled={plan.rows.length === 0}
              onClick={() => { exportPlan(plan).catch(err => window.alert(`Export failed: ${err?.message || err}`)); }}
              title="Download this schedule as an Excel file. A fee shared by several services is grouped with a sub-row for each."
            >
              Export to Excel
            </button>
            <button
              type="button"
              className={styles.applyBtn}
              disabled={building === 0}
              onClick={() => {
                if (onApply?.(plan)) {
                  setFlash(`Built the Alternative Fee schedule on ${plan.optionName} from ${building} service fee structure${building === 1 ? '' : 's'}.`);
                  window.setTimeout(() => setFlash(''), 4000);
                }
              }}
            >
              Build fee schedule on {plan.optionName}
            </button>
          </div>
          {flash && <div className={styles.flash}>{flash}</div>}
          <p className={styles.note}>
            A preview. Nothing changes on the Pricing subtab until you build it. Rows marked with a service come from its
            picked structure; the rest are already on the schedule and stay.
          </p>
          {plan.shared.length > 0 && (
            <div className={own.info}>
              Fee names written by more than one service keep a row for each, grouped under the fee below:{' '}
              {plan.shared.map(c => `${c.fee} (${c.services.join(', ')})`).join('; ')}.
              {plan.shared.filter(c => c.unpriced.length).map(c => (
                <Fragment key={c.fee}>
                  {' '}{c.unpriced.join(', ')} had no fee of {c.unpriced.length === 1 ? 'its' : 'their'} own for {c.fee}, so
                  that row is left off rather than billing the other service&apos;s costs twice.
                </Fragment>
              ))}
            </div>
          )}
          {plan.rows.length === 0 ? (
            <p className={styles.note}>No fee rows.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Fee</th>
                  <th>From</th>
                  <th>Type</th>
                  <th className={styles.num}>Fee / Unit</th>
                  <th>Unit</th>
                  <th className={styles.num}>Unit Count</th>
                  <th className={styles.num}>Start Month</th>
                  {yearIdx.map(i => <th key={i} className={styles.num}>{`Y${i + 1}`}</th>)}
                  <th className={styles.num}>Term</th>
                  <th className={styles.num} title="Term fees against the term cost of the cost lines the fee prices">Margin</th>
                </tr>
              </thead>
              <tbody>
                {groupFeeRows(plan.rows).map((g, gi) => {
                  const key = String(g.row.name || '').trim().toLowerCase();
                  const isGroup = g.subRows.length > 0;
                  const open = isGroup && !collapsed[key];
                  const cells = (r) => (
                    <>
                      <td className={styles.num}>{fmtMoney(r.feePerUnit)}</td>
                      <td>{r.unit}</td>
                      <td className={styles.num}>{r.unitCount ?? ''}</td>
                      <td className={styles.num}>{r.startMonth ?? ''}</td>
                      {yearIdx.map(yi => <td key={yi} className={styles.num}>{r.years[yi] ? fmtMoney(r.years[yi]) : ''}</td>)}
                      <td className={styles.num}>{r.term ? fmtMoney(r.term) : ''}</td>
                      <td className={styles.num}>{fmtPct(r.margin)}</td>
                    </>
                  );
                  if (!isGroup) {
                    const r = g.row;
                    return (
                      <tr key={`${key}-${gi}`} className={r.service ? own.newRow : undefined}>
                        <td>{r.name}{r.passThrough && <span className={styles.subNote}> pass-through</span>}</td>
                        <td className={r.service ? undefined : own.muted}>{fromLabel(g, covered)}</td>
                        <td>{r.type}</td>
                        {cells(r)}
                      </tr>
                    );
                  }
                  return (
                    <Fragment key={`${key}-${gi}`}>
                      <tr className={own.groupRow}>
                        <td>
                          <button
                            type="button"
                            className={own.caretBtn}
                            onClick={() => setCollapsed(prev => ({ ...prev, [key]: open }))}
                            aria-expanded={open}
                            title={open ? 'Hide the rows behind this fee' : 'Show the rows behind this fee'}
                          >
                            <span aria-hidden="true">{open ? '▾' : '▸'}</span> {g.row.name}
                          </button>
                        </td>
                        <td>{fromLabel(g, covered)}</td>
                        <td>{g.row.type}</td>
                        {cells(g.row)}
                      </tr>
                      {open && g.subRows.map((r, si) => (
                        <tr key={si} className={`${own.subRow} ${r.service ? own.newRow : ''}`}>
                          <td>{r.name}{r.passThrough && <span className={styles.subNote}> pass-through</span>}</td>
                          <td className={r.service ? undefined : own.muted}>{r.service || 'On the schedule'}</td>
                          <td>{r.type}</td>
                          {cells(r)}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                <tr className={own.totalRow}>
                  <td colSpan={7}>Total</td>
                  {yearIdx.map(yi => <td key={yi} className={styles.num}>{fmtMoney(plan.after.feeByYear[yi])}</td>)}
                  <td className={styles.num}>{fmtMoney(sum(plan.after.feeByYear))}</td>
                  <td
                    className={styles.num}
                    title="Fees against the cost lines they price. Deal margin below also counts cost no fee prices."
                  >
                    {(() => { const t = sum(plan.rows.map(r => r.term)); return t > 0 ? fmtPct((t - sum(plan.rows.map(r => r.cost))) / t) : ''; })()}
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          <div className={styles.previewLabel}>{plan.optionName} totals</div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th />
                {yearIdx.map(i => <th key={i} className={styles.num}>{`Y${i + 1} fees`}</th>)}
                <th className={styles.num}>Term fees</th>
                <th className={styles.num}>Term cost</th>
                <th className={styles.num}>Deal margin</th>
              </tr>
            </thead>
            <tbody>
              {[['Now on the schedule', plan.before], ['As built', plan.after]].map(([label, t]) => (
                <tr key={label}>
                  <td>{label}</td>
                  {yearIdx.map(yi => <td key={yi} className={styles.num}>{fmtMoney(t.feeByYear[yi])}</td>)}
                  <td className={styles.num}>{fmtMoney(sum(t.feeByYear))}</td>
                  <td className={styles.num}>{fmtMoney(sum(t.costByYear))}</td>
                  <td className={styles.num}>{t.margin?.finalMargin != null ? fmtPct(t.margin.finalMargin) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
