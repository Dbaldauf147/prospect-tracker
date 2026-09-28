import { useMemo, useState } from 'react';
import styles from './ServicesTab.module.css';
import {
  SERVICE_STATUS, FEE_STRUCTURE_TYPES, FEE_STRUCTURE_UNITS, serviceKey,
  newFeeStructureId, blankFeeStructureRow, feeStructureRowsFromFees, costTotalsByLineItem,
  standardFeesForStructure, costKey, COST_BUCKET_UPFRONT, addLaterCostFees, FIRST_YEAR_MONTHS,
  costTypeConversion, moveCostAllocation, feeBucket,
} from '../../utils/pricingServices';
import { RATE_CHECK } from '../../utils/serviceRateCheck';
import { unitLabelFor, unitNoun } from '../../utils/servicePricing';

const fmtMoney = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '');
const fmtPct = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '');

const STATUS_CLASS = {
  [SERVICE_STATUS.ACTIVE]: 'statusActive',
  [SERVICE_STATUS.RETIRED]: 'statusRetired',
  [SERVICE_STATUS.HIDDEN]: 'statusHidden',
  [SERVICE_STATUS.OFF_LIST]: 'statusOffList',
};

// Services subtab: the Dropdowns tab's service catalog, each service's
// status carried over, with the ones the loaded SIA covers pinned to the
// top. Picking a service shows the cost lines mapped to it (Linked To ›
// Line Item → Services) and the fee rows those costs price, as the
// Alternative Fee schedule has them or would build them.
//
//   services        buildPricingServiceList rows
//   detailFor       (serviceName) => { items, fees } for the active option
//   feeStructures   saved fee structures per service (serviceKey)
//   previewFeeRow   (structureRow) => what it bills on the active option
//   previewOnOption (serviceName, structure|null) => the option with it in place
//   applyFeeStructure (serviceName, structure) => writes it to the schedule
//   unlinked        unmappedLineItems() for the active option: cost lines
//                   with no service yet, warned about above the list
//   tagOptions      the Dropdowns catalog a cost line can be tagged to
//   onTagLineItem   (lineItemKey, serviceName) => adds the service
//   onIgnoreLineItem (lineItemKey) => marks the line item Ignore
//   onSetItemType   (itemId, type) => overrides a cost line's Type ('' clears it)
export function ServicesTab({
  workbook, activeOption, setActiveOption, services = [], detailFor, numYears = 1, termMonths = 36, onOpenLinkedTo,
  onSetCount, onIgnoreForCheck, feeStructures = {}, setFeeStructures, previewFeeRow, previewOnOption, applyFeeStructure, onSetItemType,
  unlinked = null, tagOptions = [], onTagLineItem, onIgnoreLineItem,
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [showInactive, setShowInactive] = useState(true);

  const opt = workbook?.options?.find(o => o.optionNumber === activeOption) || workbook?.options?.[0] || null;
  const scopeCount = services.filter(s => s.inScope).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter(s => {
      if (!showInactive && !s.inScope && (s.status === SERVICE_STATUS.RETIRED || s.status === SERVICE_STATUS.HIDDEN)) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || String(s.bucket || '').toLowerCase().includes(q);
    });
  }, [services, query, showInactive]);

  const current = services.find(s => s.name === selected) || null;
  const detail = current && detailFor ? detailFor(current.name) : null;

  const costTotals = useMemo(
    () => costTotalsByLineItem((opt?.sections || []).flatMap(sec => sec.items || [])),
    [opt],
  );
  // The picked service can take a one-click tag only when it's one the
  // Dropdowns catalog still offers; tagging to anything else would leave
  // the warning standing.
  const quickTag = current && tagOptions.some(o => String(o).trim().toLowerCase() === current.name.trim().toLowerCase())
    ? current.name
    : null;

  return (
    <div className={styles.wrapper}>
      <p className={styles.intro}>
        Every service on the Dropdowns tab, with its status there. Services tied to a cost line on the
        attached SIA are tagged <span className={styles.scopeTag}>In SIA scope</span> and listed first.
        A cost line is tied to a service on the <strong>Linked To</strong> subtab (Line Item → Services).
      </p>

      {workbook && workbook.options.length > 1 && (
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

      {workbook && unlinked && unlinked.all.length > 0 && (
        <UnlinkedWarning
          unlinked={unlinked}
          costTotals={costTotals}
          optionName={opt?.sheetName}
          tagOptions={tagOptions}
          quickTag={quickTag}
          onTag={(key, service) => { onTagLineItem?.(key, service); setSelected(services.find(x => x.name.toLowerCase() === service.toLowerCase())?.name || selected); }}
          onIgnore={onIgnoreLineItem}
          onOpenLinkedTo={onOpenLinkedTo}
        />
      )}

      <div className={styles.layout}>
        <div className={styles.listPane}>
          <div className={styles.listTools}>
            <input
              type="search"
              className={styles.search}
              placeholder="Search services"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className={styles.toggle}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show retired / hidden
            </label>
          </div>
          <div className={styles.listSummary}>
            {workbook
              ? `${scopeCount} of ${services.length} service${services.length === 1 ? '' : 's'} in SIA scope${opt ? ` (${opt.sheetName})` : ''}`
              : `${services.length} service${services.length === 1 ? '' : 's'}. Upload an SIA on the Pricing subtab to see which are in scope.`}
          </div>
          <ul className={styles.list}>
            {visible.map((s, i) => {
              const prev = visible[i - 1];
              const divider = i > 0 && prev.inScope && !s.inScope;
              return (
                <li key={s.name} className={divider ? styles.dividerItem : undefined}>
                  <button
                    type="button"
                    className={`${styles.serviceBtn} ${s.name === selected ? styles.serviceBtnActive : ''} ${s.status === SERVICE_STATUS.RETIRED || s.status === SERVICE_STATUS.HIDDEN ? styles.serviceMuted : ''}`}
                    onClick={() => setSelected(s.name === selected ? null : s.name)}
                  >
                    <span className={styles.serviceName}>{s.name}</span>
                    <span className={styles.serviceTags}>
                      {s.inScope && <span className={styles.scopeTag}>In SIA scope</span>}
                      <span className={styles[STATUS_CLASS[s.status]]}>{s.status}</span>
                    </span>
                    {s.bucket && <span className={styles.bucket}>{s.bucket}</span>}
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && <li className={styles.empty}>No services match.</li>}
          </ul>
        </div>

        <div className={styles.detailPane}>
          {!current ? (
            <div className={styles.placeholder}>Pick a service to see its cost line items and fee structure.</div>
          ) : (
            <ServiceDetail
              key={current.name}
              service={current}
              saved={feeStructures[serviceKey(current.name)] || null}
              setSaved={(updater) => setFeeStructures?.(prev => {
                const k = serviceKey(current.name);
                const before = prev[k] || { structures: [], standardId: null };
                const after = updater(before);
                const next = { ...prev };
                if (!after || after.structures.length === 0) delete next[k];
                else next[k] = after;
                return next;
              })}
              previewFeeRow={previewFeeRow}
              previewOnOption={previewOnOption}
              onSetItemType={onSetItemType}
              applyFeeStructure={applyFeeStructure}
              detail={detail}
              hasWorkbook={!!workbook}
              optionName={opt?.sheetName}
              numYears={numYears}
              termMonths={termMonths}
              siteCount={detail?.sia?.sites ?? opt?.siteCount}
              accountCount={detail?.sia?.accounts ?? opt?.accountCount}
              onOpenLinkedTo={onOpenLinkedTo}
              onSetCount={onSetCount}
              onIgnoreForCheck={onIgnoreForCheck ? (itemId, on) => onIgnoreForCheck(current.name, itemId, on) : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Cost lines on the active option that no service covers yet (nothing
// picked, or only picks the Dropdowns catalog has since dropped), each with
// a way to tag it right here: a one-click button for the service picked in
// the list, a menu of every catalog service, or Ignore.
function UnlinkedWarning({ unlinked, costTotals, optionName, tagOptions, quickTag, onTag, onIgnore, onOpenLinkedTo }) {
  const [open, setOpen] = useState(true);
  const n = unlinked.all.length;
  const offList = new Set(unlinked.offList.map(r => r.key));
  return (
    <div className={styles.unlinked} role="alert">
      <div className={styles.unlinkedHead}>
        <span aria-hidden="true">⚠</span>
        <span className={styles.unlinkedText}>
          <strong>{n} cost line item{n === 1 ? '' : 's'}</strong>
          {optionName ? ` on ${optionName}` : ''} {n === 1 ? 'is' : 'are'} not linked to a service.
          {' '}{quickTag
            ? <>Tag {n === 1 ? 'it' : 'each one'} to <strong>{quickTag}</strong> with one click, or pick any service from the menu.</>
            : <>Pick a service from the menu, or select one in the list below for one-click tagging.</>}
        </span>
        <button type="button" className={styles.linkBtn} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <ul className={styles.unlinkedList}>
          {unlinked.all.map(row => {
            const t = costTotals[row.key];
            return (
              <li key={row.key} className={styles.unlinkedRow}>
                <span className={styles.unlinkedName}>
                  {row.name}
                  <span className={styles.subNote}>
                    {t ? `${t.count} cost line${t.count === 1 ? '' : 's'}${t.cts ? `, ${fmtMoney(t.cts)} CTS` : ''}` : 'Saved mapping, not on this option'}
                    {offList.has(row.key) && ', tagged only to a service the Dropdowns list no longer has'}
                  </span>
                </span>
                <span className={styles.unlinkedActions}>
                  {quickTag && (
                    <button type="button" className={styles.tagBtn} onClick={() => onTag(row.key, quickTag)} title={`Tag "${row.name}" to ${quickTag}`}>
                      Tag to {quickTag}
                    </button>
                  )}
                  <select
                    className={styles.tagSelect}
                    value=""
                    onChange={(e) => { if (e.target.value) onTag(row.key, e.target.value); }}
                    aria-label={`Tag ${row.name} to a service`}
                  >
                    <option value="">{tagOptions.length ? 'Tag to a service...' : 'No services on the Dropdowns tab'}</option>
                    {tagOptions.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  {onIgnore && (
                    <button type="button" className={styles.ignoreBtn} onClick={() => onIgnore(row.key)} title="This cost line needs no service. Undo on the Linked To subtab.">
                      Ignore
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {open && onOpenLinkedTo && (
        <div className={styles.unlinkedFoot}>
          Tags land on the <button type="button" className={styles.linkBtn} onClick={onOpenLinkedTo}>Linked To</button> subtab (Line Item → Services), where they can be changed or removed.
        </div>
      )}
    </div>
  );
}

function ServiceDetail({ service, detail, hasWorkbook, optionName, numYears, termMonths, siteCount, accountCount, onOpenLinkedTo, onSetCount, onIgnoreForCheck, saved, setSaved, previewFeeRow, previewOnOption, applyFeeStructure, onSetItemType }) {
  const items = detail?.items || [];
  const fees = detail?.fees || [];
  const structures = saved?.structures || [];
  const standardId = saved?.standardId || null;
  // Which fee structure tab is open: 'sia' (what the loaded SIA sets up)
  // or a saved structure's id. Opens on the standard one when there is one.
  const [view, setView] = useState(() => (standardId && structures.some(x => x.id === standardId) ? standardId : (hasWorkbook ? 'sia' : (structures[0]?.id || 'sia'))));
  const openStructure = structures.find(x => x.id === view) || null;
  const [flash, setFlash] = useState('');
  const say = (msg) => { setFlash(msg); window.setTimeout(() => setFlash(''), 3500); };

  function addStructure(fromSia) {
    const id = newFeeStructureId();
    const rows = fromSia ? feeStructureRowsFromFees(fees) : [];
    const name = fromSia
      ? (structures.length === 0 ? 'Standard' : `Option ${structures.length + 1}`)
      : `Option ${structures.length + 1}`;
    setSaved(prev => ({
      structures: [...prev.structures, { id, name, rows: rows.length ? rows : [blankFeeStructureRow()] }],
      standardId: prev.standardId || id,
    }));
    setView(id);
  }
  function updateStructure(id, fn) {
    setSaved(prev => ({ ...prev, structures: prev.structures.map(x => (x.id === id ? fn(x) : x)) }));
  }
  function duplicateStructure(st) {
    const id = newFeeStructureId();
    setSaved(prev => ({ ...prev, structures: [...prev.structures, { id, name: `${st.name} (copy)`, rows: st.rows.map(r => ({ ...r })), allocations: { ...(st.allocations || {}) } }] }));
    setView(id);
  }
  function deleteStructure(st) {
    if (!window.confirm(`Delete the fee structure "${st.name}"?`)) return;
    setSaved(prev => {
      const rest = prev.structures.filter(x => x.id !== st.id);
      return { structures: rest, standardId: prev.standardId === st.id ? (rest[0]?.id || null) : prev.standardId };
    });
    setView('sia');
  }
  const costTotal = items.reduce((s, it) => s + (typeof it.cts === 'number' ? it.cts : 0), 0);
  const ignoredCount = items.filter(it => it.ignored).length;
  const ignoredTotal = items.reduce((s, it) => s + (it.ignored && typeof it.cts === 'number' ? it.cts : 0), 0);
  const meta = service.meta || {};

  // Each cost line's type against the fee that prices it in the pricing
  // standard: the starred structure's fee covering the cost, else that
  // structure's fee type when all its fees bill one way, else the
  // Dropdowns service type. A mismatch offers the type that fits.
  const standard = structures.find(x => x.id === standardId) || null;
  const stdCosts = standard && hasWorkbook
    ? standardFeeContext(standard, items, { termMonths, siteCount, accountCount }).std.costs
    : [];
  const stdBuckets = standard ? [...new Set((standard.rows || []).map(r => feeBucket(r.type)).filter(Boolean))] : [];
  const stdOneType = stdBuckets.length === 1 ? (standard.rows.find(r => feeBucket(r.type))?.type || '') : '';
  const typeFit = items.map((it, i) => {
    const co = stdCosts[i];
    const row = co && co.rowIdx >= 0 ? standard.rows[co.rowIdx] : null;
    let feeType = '';
    let from = '';
    if (row?.type) { feeType = row.type; from = `${row.feeName || 'the fee'} on the ★ ${standard.name || 'standard'} structure`; }
    else if (stdOneType) { feeType = stdOneType; from = `the ★ ${standard.name || 'standard'} structure`; }
    else if (meta.serviceType) { feeType = meta.serviceType; from = 'the Dropdowns service type'; }
    const conv = it.passThrough ? null : costTypeConversion(it.type, feeType);
    return conv ? { ...conv, feeType, from } : null;
  });
  const mismatches = typeFit.filter(Boolean).length;
  function convertType(it, toType) {
    if (!onSetItemType) return;
    // Back to the SIA's own type clears the override rather than pinning it.
    onSetItemType(it.id, toType === it.siaType ? '' : toType);
    const fromKey = costKey(it.description, it.type, it.startMonth);
    const toKey = costKey(it.description, toType, it.startMonth);
    setSaved(prev => ({ ...prev, structures: moveCostAllocation(prev.structures, fromKey, toKey) }));
  }

  const facts = [
    service.bucket && ['Group', service.bucket],
    meta.productLine && ['Product line', meta.productLine],
    meta.serviceType && ['Service type', meta.serviceType],
    meta.years && ['Contract years', meta.years],
  ].filter(Boolean);

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <h3 className={styles.detailTitle}>{service.name}</h3>
        {service.inScope && <span className={styles.scopeTag}>In SIA scope</span>}
        <span className={styles[STATUS_CLASS[service.status]]}>{service.status}</span>
      </div>
      {facts.length > 0 && (
        <div className={styles.facts}>
          {facts.map(([k, v]) => <span key={k}><span className={styles.factKey}>{k}:</span> {String(v)}</span>)}
        </div>
      )}

      {!hasWorkbook ? (
        <div className={styles.placeholder}>Upload an SIA on the Pricing subtab to see the cost lines and fees behind this service.</div>
      ) : (
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>
              Cost line items{optionName ? ` on ${optionName}` : ''} ({items.length})
            </h4>
            {mismatches > 0 && (
              <div className={styles.note}>
                {mismatches === 1 ? 'One cost line has' : `${mismatches} cost lines have`} a type that doesn't bill the way
                the pricing standard does. Convert {mismatches === 1 ? 'it' : 'them'} below: a one-time or setup cost on a
                monthly fee becomes Rolled, spread over the {termMonths}-month term.
              </div>
            )}
            {items.length === 0 ? (
              <div className={styles.note}>
                No cost line on this option is tied to this service.
                {onOpenLinkedTo && (
                  <> Tie one on the <button type="button" className={styles.linkBtn} onClick={onOpenLinkedTo}>Linked To</button> subtab.</>
                )}
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Line Item</th>
                    <th>Type</th>
                    <th className={styles.num}>CTS</th>
                    <th className={styles.num}>Start Month</th>
                    <th>Fee Name</th>
                    <th>Unit</th>
                    <th>Pass-through</th>
                    {onIgnoreForCheck && <th title="Untick to leave a line out of the price check below.">In price check</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.id} className={it.ignored ? styles.ignoredRow : undefined}>
                      <td>
                        {it.description}
                        {it.otherServices.length > 0 && (
                          <div className={styles.subNote}>Also covers {it.otherServices.join(', ')}</div>
                        )}
                      </td>
                      <td>
                        {it.type}
                        {it.siaType && it.siaType !== it.type && (
                          <div className={styles.subNote}>
                            SIA: {it.siaType}
                            {onSetItemType && (
                              <> <button type="button" className={styles.linkBtn} onClick={() => convertType(it, it.siaType)}>Undo</button></>
                            )}
                          </div>
                        )}
                        {typeFit[i] && (
                          <div className={styles.typeFit}>
                            <span className={styles.warnText}>
                              Standard fee type: {typeFit[i].feeType}
                            </span>
                            {typeFit[i].convertTo && onSetItemType ? (
                              <button
                                type="button"
                                className={styles.tagBtn}
                                onClick={() => convertType(it, typeFit[i].convertTo)}
                                title={`Priced by ${typeFit[i].from}. ${typeFit[i].feeBucket === 'recurring'
                                  ? `Rolled spreads this cost over the ${termMonths}-month term so the monthly fee recovers it.`
                                  : 'Plain bills this cost upfront, the way the fee does.'} Changes the type on ${optionName || 'this option'}, the same as the Type column on the Pricing subtab.`}
                              >
                                Convert to {typeFit[i].convertTo}
                              </button>
                            ) : !typeFit[i].convertTo && (
                              <span className={styles.subNote}>Point it at a monthly fee instead</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className={styles.num}>{fmtMoney(it.cts)}</td>
                      <td className={styles.num}>{it.startMonth || ''}</td>
                      <td>
                        {it.feeName || <span className={styles.muted}>none</span>}
                        {it.automatedName && it.automatedName.toLowerCase() !== it.feeName.toLowerCase() && (
                          <div className={styles.subNote}>Automated Fee Name: {it.automatedName}</div>
                        )}
                      </td>
                      <td>{it.unit}</td>
                      <td>{it.passThrough ? 'Yes' : ''}</td>
                      {onIgnoreForCheck && (
                        <td className={styles.center}>
                          <input
                            type="checkbox"
                            checked={!it.ignored}
                            onChange={(e) => onIgnoreForCheck(it.id, !e.target.checked)}
                            title={it.ignored ? 'Left out of the price check. Tick to count it again.' : 'Counted in the price check. Untick to leave it out.'}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total CTS</td>
                    <td className={styles.num}>
                      {fmtMoney(costTotal)}
                      {ignoredCount > 0 && <div className={styles.subNote}>{fmtMoney(costTotal - ignoredTotal)} in price check</div>}
                    </td>
                    <td colSpan={onIgnoreForCheck ? 5 : 4} />
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
      )}

      {hasWorkbook && detail?.rateCheck && (
        <RateCheck check={detail.rateCheck} counts={detail.counts} entered={detail.enteredCounts} fromSia={detail.fromSia} sia={detail.sia} ignoredCount={ignoredCount} onSetCount={onSetCount} optionName={optionName} />
      )}

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Fee structure</h4>
            <FeeStructureTabs
              structures={structures}
              standardId={standardId}
              view={view}
              setView={setView}
              hasWorkbook={hasWorkbook}
              onAdd={addStructure}
            />
            {flash && <div className={styles.flash}>{flash}</div>}
            {(view === 'sia' || !openStructure) && !hasWorkbook ? (
              <p className={styles.note}>
                {structures.length
                  ? 'Pick a saved fee structure above, or upload an SIA to see how it sets this service up.'
                  : 'No saved fee structures yet. Add one above, or upload an SIA and save its setup as one.'}
              </p>
            ) : view === 'sia' || !openStructure ? (
              <>
                <p className={styles.note}>
                  As the loaded SIA sets it up. Fees come from the fee names on the cost lines above. A fee
                  already on the Alternative Fee schedule shows as it is there; one that isn't yet shows what
                  Build from Automated Fee Names would add. Save it as a fee structure to edit it.
                </p>
            {fees.length === 0 ? (
                <div className={styles.note}>No fee name on these cost lines, so no fee is set up for this service.</div>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Fee</th>
                      <th>Source</th>
                      <th>Type</th>
                      <th className={styles.num}>Fee / Unit</th>
                      <th>Unit</th>
                      <th className={styles.num}>Unit Count</th>
                      <th className={styles.num}>Start Month</th>
                      {Array.from({ length: numYears }, (_, i) => <th key={i} className={styles.num}>{`Y${i + 1}`}</th>)}
                      <th className={styles.num}>Fee GM%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fees.map((f, i) => f.missing ? (
                      <tr key={`m-${i}`}>
                        <td>{f.name}</td>
                        <td colSpan={6 + numYears + 1} className={styles.muted}>
                          No cost behind this name yet, so there is no fee to derive.
                        </td>
                      </tr>
                    ) : (
                      <tr key={`${f.name}-${f.type}-${i}`}>
                        <td>
                          {f.name}
                          {f.sharedWith.length > 0 && (
                            <div className={styles.subNote}>Shared with {f.sharedWith.join(', ')}</div>
                          )}
                        </td>
                        <td>
                          <span className={f.onSchedule ? styles.srcSchedule : styles.srcAuto}>
                            {f.onSchedule ? 'On schedule' : 'Would be built'}
                          </span>
                        </td>
                        <td>{f.type}</td>
                        <td className={styles.num}>
                          {fmtMoney(f.feePerUnit)}
                          {f.feePerUnit != null && <div className={styles.subNote}>{f.feeIsManual ? 'typed' : 'auto'}</div>}
                        </td>
                        <td>{f.unit}</td>
                        <td className={styles.num}>{f.unitCount}</td>
                        <td className={styles.num}>{f.startMonth || ''}</td>
                        {Array.from({ length: numYears }, (_, yi) => (
                          <td key={yi} className={styles.num}>{f.years[yi] > 0 ? fmtMoney(f.years[yi]) : ''}</td>
                        ))}
                        <td className={styles.num}>{f.passThrough ? 'pass' : fmtPct(f.gmPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              </>
            ) : (
              <FeeStructureEditor
                structure={openStructure}
                isStandard={openStructure.id === standardId}
                hasWorkbook={hasWorkbook}
                optionName={optionName}
                numYears={numYears}
                termMonths={termMonths}
                siteCount={siteCount}
                accountCount={accountCount}
                costs={items}
                feeNameSuggestions={[...new Set([...fees.map(f => f.name), ...items.map(i => i.feeName)].filter(Boolean))]}
                previewFeeRow={previewFeeRow}
                onChange={(fn) => updateStructure(openStructure.id, fn)}
                onMakeStandard={() => setSaved(prev => ({ ...prev, standardId: openStructure.id }))}
                onDuplicate={() => duplicateStructure(openStructure)}
                onDelete={() => deleteStructure(openStructure)}
                onApply={(filled) => {
                  if (applyFeeStructure?.(service.name, filled)) {
                    say(`Applied "${openStructure.name}" to the Alternative Fee schedule on ${optionName || 'the option'}.`);
                  }
                }}
              />
            )}
          </section>

      {hasWorkbook && previewOnOption && (
        <OptionPreview
          preview={previewOnOption(service.name, openStructure
            ? standardFeeContext(openStructure, items, { termMonths, siteCount, accountCount }).filled
            : null)}
          structureName={openStructure ? `fee structure "${openStructure.name || 'Untitled'}"` : 'the SIA setup'}
          isSia={!openStructure}
        />
      )}
    </div>
  );
}

// A structure with its blank Fee cells filled by the standard fee, the
// rows Apply writes and the option preview bills. One helper for both so
// the preview never shows a different fee from the one Apply would write.
function costInputsFor(costs) {
  return (costs || []).map(c => ({
    key: costKey(c.description, c.type, c.startMonth),
    description: c.description,
    type: c.type,
    price: c.price,
    startMonth: c.startMonth,
    feeNames: [c.feeName, c.automatedName].filter(Boolean),
  }));
}

function standardFeeContext(structure, costs, { termMonths = 36, siteCount, accountCount } = {}) {
  const rows = structure?.rows || [];
  const costInputs = costInputsFor(costs);
  const std = standardFeesForStructure({ rows, costs: costInputs, allocations: structure?.allocations || {}, termMonths, siteCount, accountCount });
  const standardFee = (idx) => std.perRow[idx]?.standardFee ?? null;
  const billed = (r, idx) => (r.fee == null && standardFee(idx) != null ? { ...r, fee: standardFee(idx) } : r);
  return { std, standardFee, billed, filled: structure ? { ...structure, rows: rows.map(billed) } : null };
}

const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
const marginOf = (fee, cost) => (fee > 0 ? (fee - cost) / fee : null);

// The option as it would read with the picked fee structure in place for
// this service: the fee rows it bills, the service's cost against them,
// and the option's totals now next to with it.
function OptionPreview({ preview, structureName, isSia }) {
  if (!preview) return null;
  const { optionName, numYears, fees, feeByYear, costByYear, unbilled, before, after } = preview;
  const yearIdx = Array.from({ length: numYears }, (_, i) => i);
  const yearHeads = yearIdx.map(i => <th key={i} className={styles.num}>{`Y${i + 1}`}</th>);
  const money = (n) => (n ? fmtMoney(n) : '');
  const svcMargin = yearIdx.map(i => marginOf(feeByYear[i], costByYear[i]));
  const svcTermMargin = marginOf(sum(feeByYear), sum(costByYear));
  const changed = !isSia || sum(after.feeByYear) !== sum(before.feeByYear) || sum(after.costByYear) !== sum(before.costByYear);
  const deltaFee = yearIdx.map(i => after.feeByYear[i] - before.feeByYear[i]);
  const signed = (n) => (Math.abs(n) < 0.005 ? '' : `${n > 0 ? '+' : '-'}${fmtMoney(Math.abs(n))}`);
  const optRows = changed
    ? [['Now on the schedule', before], [isSia ? 'With the SIA setup' : 'With this structure', after]]
    : [['On the schedule', before]];

  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>
        How {optionName} looks with {structureName}
      </h4>
      <p className={styles.note}>
        {isSia
          ? `The fees the SIA sets up for this service, as ${optionName} would bill them.`
          : `A preview of ${optionName} with this structure in place of the service's current fee rows. Nothing changes until you apply it.`}
      </p>

      <div className={styles.previewLabel}>Fees billed for this service</div>
      {fees.length === 0 ? (
        <div className={styles.note}>No named fees, so this service bills nothing on {optionName}.</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Fee</th>
              <th>Type</th>
              <th className={styles.num}>Fee / Unit</th>
              <th>Unit</th>
              <th className={styles.num}>Unit Count</th>
              <th className={styles.num}>Start Month</th>
              {yearHeads}
              <th className={styles.num}>Term</th>
            </tr>
          </thead>
          <tbody>
            {fees.map((f, i) => (
              <tr key={`${f.name}-${i}`}>
                <td>{f.name}{f.passThrough && <div className={styles.subNote}>Pass-through</div>}</td>
                <td>{f.type}</td>
                <td className={styles.num}>{fmtMoney(f.feePerUnit)}</td>
                <td>{f.unit}</td>
                <td className={styles.num}>{f.unitCount}</td>
                <td className={styles.num}>{f.startMonth || ''}</td>
                {yearIdx.map(i2 => <td key={i2} className={styles.num}>{money(f.years[i2])}</td>)}
                <td className={styles.num}>{money(f.term)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={styles.previewLabel}>This service, fee against cost</div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th />
            {yearHeads}
            <th className={styles.num}>Term</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Fee</td>
            {yearIdx.map(i => <td key={i} className={styles.num}>{money(feeByYear[i])}</td>)}
            <td className={styles.num}>{money(sum(feeByYear))}</td>
          </tr>
          <tr>
            <td>Cost</td>
            {yearIdx.map(i => <td key={i} className={styles.num}>{money(costByYear[i])}</td>)}
            <td className={styles.num}>{money(sum(costByYear))}</td>
          </tr>
          <tr>
            <td>Margin</td>
            {yearIdx.map(i => <td key={i} className={styles.num}>{feeByYear[i] || costByYear[i] ? fmtMoney(feeByYear[i] - costByYear[i]) : ''}</td>)}
            <td className={styles.num}>{fmtMoney(sum(feeByYear) - sum(costByYear))}</td>
          </tr>
          <tr>
            <td>Margin %</td>
            {yearIdx.map(i => <td key={i} className={styles.num}>{fmtPct(svcMargin[i])}</td>)}
            <td className={styles.num}>{fmtPct(svcTermMargin)}</td>
          </tr>
        </tbody>
      </table>
      <p className={styles.note}>
        Cost is every cost line tied to this service, with tech depreciation, recurring lines escalated by the cost escalator.
      </p>
      {unbilled.length > 0 && (
        <div className={styles.warnNote}>
          {unbilled.length === 1 ? 'One cost line is' : `${unbilled.length} cost lines are`} priced by a fee name
          this doesn't bill, so {optionName}'s Deal margin leaves {unbilled.length === 1 ? 'it' : 'them'} out:{' '}
          {unbilled.map((u, i) => (
            <span key={i}>
              {i > 0 && '; '}
              {u.description} ({u.feeName ? `fee name ${u.feeName}` : 'no fee name'}, {fmtMoney(u.termCost)} over the term)
            </span>
          ))}.
        </div>
      )}

      <div className={styles.previewLabel}>{optionName} totals</div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th />
            {yearHeads}
            <th className={styles.num}>Term</th>
            <th className={styles.num}>Deal margin</th>
          </tr>
        </thead>
        <tbody>
          {optRows.map(([label, t]) => (
            <tr key={label}>
              <td>{label}</td>
              {yearIdx.map(i => <td key={i} className={styles.num}>{money(t.feeByYear[i])}</td>)}
              <td className={styles.num}>{money(sum(t.feeByYear))}</td>
              <td className={styles.num}>{fmtPct(t.margin?.finalMargin)}</td>
            </tr>
          ))}
          {changed && (
            <tr className={styles.deltaRow}>
              <td>Change</td>
              {yearIdx.map(i => <td key={i} className={styles.num}>{signed(deltaFee[i])}</td>)}
              <td className={styles.num}>{signed(sum(deltaFee))}</td>
              <td className={styles.num}>
                {typeof before.margin?.finalMargin === 'number' && typeof after.margin?.finalMargin === 'number'
                  && Math.abs(after.margin.finalMargin - before.margin.finalMargin) >= 0.0005
                  ? `${after.margin.finalMargin > before.margin.finalMargin ? '+' : '-'}${(Math.abs(after.margin.finalMargin - before.margin.finalMargin) * 100).toFixed(1)} pts`
                  : ''}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className={styles.note}>
        Total fee billed on {optionName} each year. Deal margin is over the full term, pass-through netted out, the same as the Pricing subtab.
      </p>
    </section>
  );
}

const RATE_BADGE = {
  [RATE_CHECK.WITHIN]: ['rateWithin', 'Within range'],
  [RATE_CHECK.BELOW]: ['rateOutside', 'Below range'],
  [RATE_CHECK.ABOVE]: ['rateOutside', 'Above range'],
  [RATE_CHECK.UNPRICED]: ['rateUnknown', 'No rate card'],
  [RATE_CHECK.INCOMPLETE]: ['rateUnknown', 'Missing a count'],
  [RATE_CHECK.NO_COST]: ['rateUnknown', 'No cost to check'],
  [RATE_CHECK.NOT_ON_CARD]: ['rateUnknown', 'Not on rate card'],
};

// A per-unit rate keeps its cents ($22.50/account); a total doesn't.
const fmtRate = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })
  : '');

const fmtWhole = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  : '');

// The service's first-year cost on the SIA, marked up, set against the
// price range its Dropdowns › Services Pricing rate card quotes.
function RateCheck({ check, counts = {}, entered = {}, fromSia = {}, sia = {}, ignoredCount = 0, onSetCount, optionName }) {
  const [cls, label] = RATE_BADGE[check.status];
  const markupPct = Math.round(check.markup * 100);
  const range = check.low == null ? '' : (Math.round(check.low) === Math.round(check.high)
    ? fmtWhole(check.low)
    : `${fmtWhole(Math.min(check.low, check.high))} – ${fmtWhole(Math.max(check.low, check.high))}`);
  // Each count the card prices on, and whether it is the SIA's or typed.
  const sheetOf = (k) => (k === 'accounts' ? sia.accountsFrom : sia.sitesFrom);
  const countText = [
    ...(check.unitsUsed || []).filter(k => counts[k] != null).map(k => {
      const typed = typeof entered[k] === 'number';
      const src = typed ? 'typed' : (fromSia[k] != null ? `from the SIA${sheetOf(k) ? ` (${sheetOf(k)})` : ''}` : '');
      return `${Number(counts[k]).toLocaleString('en-US')} ${unitLabelFor(k).toLowerCase()}${src ? `, ${src}` : ''}`;
    }),
    typeof entered.dealSize === 'number' && `${fmtWhole(entered.dealSize)} deal size`,
  ].filter(Boolean).join('; ');
  let gap = '';
  if (check.status === RATE_CHECK.BELOW) gap = `${fmtWhole(Math.min(check.low, check.high) - check.price)} under the low end`;
  if (check.status === RATE_CHECK.ABOVE) gap = `${fmtWhole(check.price - Math.max(check.low, check.high))} over the high end`;

  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>
        Price check <span className={styles[cls]}>{label}</span>
      </h4>
      <div className={styles.rateGrid}>
        <span><span className={styles.factKey}>Year 1 cost:</span> <span className={styles.rateFigure}>{fmtWhole(check.cost)}</span></span>
        <span><span className={styles.factKey}>Marked up {markupPct}%:</span> <span className={styles.rateFigure}>{fmtWhole(check.price)}</span></span>
        <span>
          <span className={styles.factKey}>Rate card range:</span>{' '}
          <span className={styles.rateFigure}>{check.noFee ? 'No fee' : (check.status === RATE_CHECK.INCOMPLETE && !(check.high > 0) ? 'Unknown' : (range || 'not set'))}</span>
        </span>
        {gap && <span className={styles.factKey}>{gap}</span>}
      </div>
      <RateMeter check={check} />
      {check.parts?.length > 0 && <FeeParts parts={check.parts} markup={check.markup} />}
      {onSetCount && (
        <CheckCounts missing={check.missing} used={check.unitsUsed} entered={entered} fromSia={fromSia} onSetCount={onSetCount} optionName={optionName} />
      )}
      <p className={styles.note}>
        {check.status === RATE_CHECK.INCOMPLETE && (
          `Part of this service's rate card is priced on ${check.missing.map(m => m.label.toLowerCase()).join(' and ')}, which the SIA doesn't carry, so the range ${check.high > 0 ? 'reads low and' : 'is unknown and'} isn't judged until it's filled in. `
        )}
        {check.status === RATE_CHECK.UNPRICED
          ? (check.noFee
            ? 'This service is marked No Fee on Dropdowns › Services Pricing, so there is no range to check against.'
            : 'No rate set for this service on Dropdowns › Services Pricing, so there is no range to check against.')
          : `Year 1 cost is the CTS on the lines above, months 1 to 12 only (a recurring line counts the months it runs in year 1)${check.later ? `, ${check.later} line${check.later === 1 ? '' : 's'} starting after month 12 left out` : ''}${check.passThrough ? ', pass-through lines left out' : ''}${ignoredCount ? `, ${ignoredCount} line${ignoredCount === 1 ? '' : 's'} unticked above left out` : ''}. The range is the Year 1 fee (plus setup) from Dropdowns › Services Pricing${countText ? `, priced on ${countText}` : ''}.`}
         {check.parts?.length > 0 && ' In the table, ongoing costs are a full year of the monthly cost, like the annual fee on the card, and a part quoted per unit is judged per unit: the marked-up cost divided by the count.'}
        {check.status !== RATE_CHECK.INCOMPLETE && check.notes.length > 0 && ` Rate card note: ${check.notes.join('; ')}.`}
      </p>
    </section>
  );
}

// Boxes for the counts the rate card needs and the SIA doesn't carry, plus
// any already typed so they can be changed or cleared. Saved on the option.
//
// A count the SIA supplies (sites, accounts, and sites standing in for
// sites w/ mandate) shows as the box's grey placeholder: blank means the
// SIA's, and a typed number overrides it until "Use SIA" clears it.
function CheckCounts({ missing = [], used = [], entered = {}, fromSia = {}, onSetCount, optionName }) {
  const fields = [...missing];
  const add = (key) => {
    if (!fields.some(f => f.key === key)) fields.push({ key, label: key === 'dealSize' ? 'Deal size' : unitLabelFor(key) });
  };
  for (const key of used) if (fromSia[key] != null) add(key);
  for (const key of Object.keys(entered)) add(key);
  if (fields.length === 0) return null;
  return (
    <div className={styles.countRow}>
      <span className={styles.factKey}>Counts for {optionName || 'this option'}:</span>
      {fields.map(f => {
        const isMoney = f.key === 'dealSize';
        const v = entered[f.key];
        const siaV = fromSia[f.key];
        return (
          <label key={f.key} className={styles.countField}>
            {f.label}
            <DraftInput
              value={typeof v === 'number' ? (isMoney ? fmtPlain(v) : String(v)) : ''}
              placeholder={isMoney ? '$' : (siaV != null ? String(siaV) : 'Enter')}
              align="right"
              width={isMoney ? 110 : 72}
              className={`${styles.cellInput} ${v == null && siaV == null ? styles.countNeeded : ''}`}
              onCommit={(raw) => {
                const n = isMoney ? parseMoney(raw) : parseCount(raw);
                if (n !== undefined) onSetCount(f.key, n);
              }}
            />
            {siaV != null && (typeof v === 'number' && v !== siaV
              ? (
                <button type="button" className={styles.linkBtn} onClick={() => onSetCount(f.key, null)} title={`Clear the typed count and use the SIA's ${siaV.toLocaleString('en-US')}.`}>
                  Use SIA ({siaV.toLocaleString('en-US')})
                </button>
              )
              : <span className={styles.subNote}>from SIA</span>)}
          </label>
        );
      })}
    </div>
  );
}

// The same check split by the parts of the fee model: setup against the
// card's setup lines, ongoing against its recurring ones, one-time against
// the rest. A part the card quotes per unit is judged per unit, which is
// how the fee is actually written.
function FeeParts({ parts, markup }) {
  const markupPct = Math.round(markup * 100);
  return (
    <table className={`${styles.table} ${styles.partsTable}`}>
      <thead>
        <tr>
          <th>Fee part</th>
          <th className={styles.num}>Cost</th>
          <th className={styles.num}>Marked up {markupPct}%</th>
          <th className={styles.num}>Rate card</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {parts.map(p => {
          const [cls, label] = RATE_BADGE[p.status];
          const noun = p.perUnit ? unitNoun(p.perUnit.unitLabel) : '';
          const per = p.key === 'recurring' ? `/${noun}/yr` : `/${noun}`;
          const cardRange = p.low == null ? '' : (Math.round(p.low) === Math.round(p.high)
            ? fmtWhole(p.low) : `${fmtWhole(p.low)} – ${fmtWhole(p.high)}`);
          const basis = p.cardLines.map(b => b.basisLabel).join(' + ');
          const meter = p.perUnit
            ? { status: p.status, price: p.perUnit.price, low: p.perUnit.rateLow, high: p.perUnit.rateHigh, cost: p.perUnit.price / (1 + markup), fmt: fmtRate }
            : { status: p.status, price: p.price, low: p.low, high: p.high, cost: p.cost, fmt: fmtWhole };
          return (
            <tr key={p.key}>
              <td>
                {p.label}
                {basis && <div className={styles.subNote}>{basis}</div>}
              </td>
              <td className={styles.num}>
                {p.cost > 0 ? fmtWhole(p.cost) : <span className={styles.muted}>none</span>}
                {p.monthly && p.cost > 0 && <div className={styles.subNote}>{fmtRate(p.cost / 12)}/mo × 12</div>}
              </td>
              <td className={styles.num}>
                {p.cost > 0 ? fmtWhole(p.price) : ''}
                {p.monthly && p.cost > 0 && <div className={styles.subNote}>{fmtRate(p.price / 12)}/mo</div>}
                {p.perUnit && <div className={styles.subNote}>{fmtRate(p.perUnit.price)}{per}</div>}
              </td>
              <td className={styles.num}>
                {cardRange || <span className={styles.muted}>no line</span>}
                {p.perUnit && (
                  <div className={styles.subNote}>
                    {p.perUnit.rateLow === p.perUnit.rateHigh
                      ? fmtRate(p.perUnit.rateLow)
                      : `${fmtRate(p.perUnit.rateLow)} – ${fmtRate(p.perUnit.rateHigh)}`}{per} × {p.perUnit.units.toLocaleString('en-US')}
                  </div>
                )}
              </td>
              <td>
                <div className={styles.partResult}>
                  <span className={styles[cls]}>{label}</span>
                  <RateMeter check={meter} compact />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Where the marked-up price lands on a line from $0, with the rate card
// range shaded on it. Nothing to draw without a range above $0.
function RateMeter({ check, compact = false }) {
  if (check.low == null || check.price == null) return null;
  const lo = Math.min(check.low, check.high);
  const hi = Math.max(check.low, check.high);
  if (hi <= 0) return null;
  const max = Math.max(hi, check.price) * 1.15;
  const at = (v) => Math.max(0, Math.min(100, (v / max) * 100));
  // Keep a centred label from running off either end.
  const labelAt = (v) => Math.max(6, Math.min(94, at(v)));
  const tone = check.status === RATE_CHECK.WITHIN ? styles.meterIn
    : (check.status === RATE_CHECK.BELOW || check.status === RATE_CHECK.ABOVE) ? styles.meterOut
      : styles.meterUnknown;
  const fmt = check.fmt || fmtWhole;
  // Per-unit rates are small numbers, so "the same" is to the cent there.
  const single = fmt(lo) === fmt(hi);
  // Two range labels closer than this share one, so they never overlap.
  const joined = single || at(hi) - at(lo) < 18;
  const priceTip = `Marked-up price ${fmt(check.price)} (cost ${fmt(check.cost)})`;
  const rangeTip = single ? `Rate card: ${fmt(lo)}` : `Rate card range: ${fmt(lo)} – ${fmt(hi)}`;
  const track = (
    <div className={styles.meterTrack}>
      <div
        className={single ? styles.meterTick : styles.meterBand}
        style={single ? { left: `${at(lo)}%` } : { left: `${at(lo)}%`, width: `${at(hi) - at(lo)}%` }}
        title={rangeTip}
      />
      <div className={styles.meterCost} style={{ left: `${at(check.cost)}%` }} title={`Cost ${fmt(check.cost)}`} />
      <div className={`${styles.meterDot} ${tone}`} style={{ left: `${at(check.price)}%` }} title={priceTip} />
    </div>
  );
  // In a table row the figures sit in the columns beside it, so the line
  // goes on its own.
  if (compact) {
    return <div className={styles.meterCompact} role="img" aria-label={`${priceTip}. ${rangeTip}.`}>{track}</div>;
  }

  return (
    <div className={styles.meter} role="img" aria-label={`${priceTip}. ${rangeTip}.`}>
      <div className={styles.meterTop}>
        <span className={`${styles.meterPriceLabel} ${tone}`} style={{ left: `${labelAt(check.price)}%` }}>
          {fmtWhole(check.price)}
        </span>
      </div>
      {track}
      <div className={styles.meterScale}>
        <span className={styles.meterScaleLabel} style={{ left: 0, transform: 'none' }}>$0</span>
        {joined ? (
          <span className={styles.meterScaleLabel} style={{ left: `${labelAt((lo + hi) / 2)}%` }}>
            {single ? `Rate card ${fmtWhole(lo)}` : `${fmtWhole(lo)} – ${fmtWhole(hi)}`}
          </span>
        ) : (
          <>
            <span className={styles.meterScaleLabel} style={{ left: `${labelAt(lo)}%` }}>{fmtWhole(lo)}</span>
            <span className={styles.meterScaleLabel} style={{ left: `${labelAt(hi)}%` }}>{fmtWhole(hi)}</span>
          </>
        )}
      </div>
      <div className={styles.meterLegend}>
        <span><span className={styles.meterKeyBand} /> Rate card range</span>
        <span><span className={`${styles.meterKeyDot} ${tone}`} /> Marked-up price</span>
        <span><span className={styles.meterKeyCost} /> Cost</span>
      </div>
    </div>
  );
}

// "From SIA" plus one tab per saved structure (the standard one starred),
// and the buttons that start a new one.
function FeeStructureTabs({ structures, standardId, view, setView, hasWorkbook, onAdd }) {
  return (
    <div className={styles.structTabs}>
      {hasWorkbook && (
        <button
          type="button"
          className={view === 'sia' ? styles.structTabActive : styles.structTab}
          onClick={() => setView('sia')}
          title="How the loaded SIA sets this service up. Read only."
        >
          From SIA
        </button>
      )}
      {structures.map(st => (
        <button
          key={st.id}
          type="button"
          className={view === st.id ? styles.structTabActive : styles.structTab}
          onClick={() => setView(st.id)}
          title={st.id === standardId ? 'Standard fee structure for this service' : undefined}
        >
          {st.id === standardId && <span className={styles.star} aria-label="Standard">★</span>}
          {st.name || 'Untitled'}
        </button>
      ))}
      {hasWorkbook && (
        <button type="button" className={styles.structAdd} onClick={() => onAdd(true)} title="Save how the SIA sets this service up as an editable fee structure.">
          + Save SIA setup as structure
        </button>
      )}
      <button type="button" className={styles.structAdd} onClick={() => onAdd(false)} title="Start a new fee structure from a blank row.">
        + New blank structure
      </button>
    </div>
  );
}

// Text / number cell that commits on blur or Enter, so a half-typed value
// isn't parsed on every keystroke.
function DraftInput({ value, onCommit, placeholder, align, className, list, width }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (value ?? '');
  return (
    <input
      className={className || styles.cellInput}
      style={{ textAlign: align || 'left', width }}
      value={shown}
      placeholder={placeholder}
      list={list}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) { onCommit(draft); setDraft(null); } }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }}
    />
  );
}

const parseMoney = (v) => {
  const t = String(v ?? '').replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const parseCount = (v) => {
  const t = String(v ?? '').replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const parsePct = (v) => {
  const t = String(v ?? '').replace('%', '').trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return n > 1 ? n / 100 : n;
};
const fmtPlain = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '');

// One saved structure, editable. Blank Fee / Unit Count / Start Month /
// GM% cells derive, and the placeholder shows what they derive to on the
// loaded SIA, the same way the Alternative Fee schedule reads.
function FeeStructureEditor({
  structure, isStandard, hasWorkbook, optionName, numYears, termMonths = 36, siteCount, accountCount, costs = [],
  feeNameSuggestions, previewFeeRow, onChange, onMakeStandard, onDuplicate, onDelete, onApply,
}) {
  const listId = `fs-names-${structure.id}`;
  const rows = structure.rows || [];
  const setRow = (idx, patch) => onChange(st => {
    const next = { ...st, rows: st.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)) };
    // Renaming a fee keeps every cost it covers (picked, or matched by
    // the old name) on it.
    const before = String(st.rows[idx]?.feeName || '').trim().toLowerCase();
    const after = String(patch.feeName ?? '').trim().toLowerCase();
    if ('feeName' in patch && before && after && before !== after) {
      const alloc = { ...(st.allocations || {}) };
      for (const co of std.costs) {
        if (co.rowIdx === idx) alloc[co.key] = { ...(alloc[co.key] || {}), fee: after };
      }
      next.allocations = alloc;
    }
    return next;
  });
  const removeRow = (idx) => onChange(st => ({ ...st, rows: st.rows.filter((_, i) => i !== idx) }));
  const moveRow = (idx, dir) => onChange(st => {
    const next = st.rows.slice();
    const j = idx + dir;
    if (j < 0 || j >= next.length) return st;
    [next[idx], next[j]] = [next[j], next[idx]];
    return { ...st, rows: next };
  });
  // The standard fee behind each row: what recovers the service's costs
  // pointed at it (see standardFeesForStructure). A blank Fee cell bills
  // it, and Apply writes it into the schedule.
  const { std, standardFee, billed } = standardFeeContext(structure, costs, { termMonths, siteCount, accountCount });
  const setAllocation = (key, patch) => onChange(st => ({
    ...st,
    allocations: { ...(st.allocations || {}), [key]: { ...((st.allocations || {})[key] || {}), ...patch } },
  }));
  const previews = rows.map((r, idx) => (previewFeeRow && hasWorkbook ? previewFeeRow(billed(r, idx)) : null));
  const totals = Array.from({ length: numYears }, (_, yi) => previews.reduce((s, p) => s + (p?.years?.[yi] || 0), 0));

  return (
    <div className={styles.editor}>
      <div className={styles.editorBar}>
        <label className={styles.nameLabel}>
          Name
          <DraftInput
            value={structure.name}
            className={styles.nameInput}
            onCommit={(v) => onChange(st => ({ ...st, name: String(v).trim() || st.name }))}
          />
        </label>
        {isStandard
          ? <span className={styles.standardTag}>★ Standard</span>
          : <button type="button" className={styles.barBtn} onClick={onMakeStandard} title="Make this the standard fee structure for this service.">☆ Make standard</button>}
        <button type="button" className={styles.barBtn} onClick={onDuplicate}>Duplicate</button>
        <button type="button" className={styles.barBtnDanger} onClick={onDelete}>Delete</button>
        <span className={styles.barSpacer} />
        <button
          type="button"
          className={styles.applyBtn}
          disabled={!hasWorkbook}
          onClick={() => onApply({ ...structure, rows: rows.map(billed) })}
          title={hasWorkbook
            ? `Replace this service's fee rows on ${optionName || 'the active option'}'s Alternative Fee schedule with this structure.`
            : 'Upload an SIA to apply a structure to its fee schedule.'}
        >
          Apply to {optionName || 'schedule'}
        </button>
      </div>
      <p className={styles.note}>
        Leave Fee, Unit Count, Start Month or GM% blank to derive it from the SIA, the same as a blank cell on the
        Alternative Fee schedule; the grey value shows what it derives to on {hasWorkbook ? (optionName || 'the loaded option') : 'the loaded SIA'}.
        Saved structures stay with the service across SIAs.
      </p>
      <datalist id={listId}>
        {feeNameSuggestions.map(n => <option key={n} value={n} />)}
      </datalist>
      <table className={`${styles.table} ${styles.editTable}`}>
        <thead>
          <tr>
            <th style={{ width: 36 }} />
            <th>Fee</th>
            <th>Type</th>
            <th className={styles.num}>Fee / Unit</th>
            <th>Unit</th>
            <th className={styles.num}>Unit Count</th>
            <th className={styles.num}>Start Month</th>
            {hasWorkbook && Array.from({ length: numYears }, (_, i) => <th key={i} className={styles.num}>{`Y${i + 1}`}</th>)}
            <th className={styles.num}>Fee GM%</th>
            <th>Pass</th>
            <th style={{ width: 28 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const p = previews[idx];
            return (
              <tr key={idx}>
                <td className={styles.moveCell}>
                  <button type="button" className={styles.iconBtn} disabled={idx === 0} onClick={() => moveRow(idx, -1)} title="Move up">↑</button>
                  <button type="button" className={styles.iconBtn} disabled={idx === rows.length - 1} onClick={() => moveRow(idx, 1)} title="Move down">↓</button>
                </td>
                <td>
                  <DraftInput value={r.feeName} list={listId} placeholder="Fee name" width={150} onCommit={(v) => setRow(idx, { feeName: String(v).trim() })} />
                </td>
                <td>
                  <select className={styles.cellSelect} style={{ width: 128 }} value={r.type || ''} onChange={(e) => setRow(idx, { type: e.target.value })}>
                    <option value="">-</option>
                    {FEE_STRUCTURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className={styles.num}>
                  <DraftInput
                    value={typeof r.fee === 'number' ? fmtPlain(r.fee) : ''}
                    placeholder={standardFee(idx) != null ? fmtPlain(standardFee(idx)) : (p?.autoFee != null ? fmtPlain(p.autoFee) : 'auto')}
                    align="right"
                    width={80}
                    onCommit={(v) => { const n = parseMoney(v); if (n !== undefined) setRow(idx, { fee: n }); }}
                  />
                  {standardFee(idx) != null && (
                    <div
                      className={typeof r.fee === 'number' && Math.abs(r.fee - standardFee(idx)) > 0.005 ? styles.stdFeeOff : styles.stdFee}
                      title={`Standard fee: recovers the ${std.perRow[idx].costIdx.length} cost line${std.perRow[idx].costIdx.length === 1 ? '' : 's'} this fee covers at their marked-up price.${typeof r.fee === 'number' ? '' : ' The blank cell bills it.'}`}
                    >
                      ★ {fmtMoney(standardFee(idx))}
                    </div>
                  )}
                </td>
                <td>
                  <select className={styles.cellSelect} style={{ width: 96 }} value={r.unit || ''} onChange={(e) => setRow(idx, { unit: e.target.value })}>
                    <option value="">-</option>
                    {FEE_STRUCTURE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </td>
                <td className={styles.num}>
                  <DraftInput
                    value={r.unitCount ?? ''}
                    placeholder={p?.alt ? String(p.alt.unitCount) : 'auto'}
                    align="right"
                    width={56}
                    onCommit={(v) => { const n = parseCount(v); if (n !== undefined) setRow(idx, { unitCount: n }); }}
                  />
                </td>
                <td className={styles.num}>
                  <DraftInput
                    value={r.startMonth ?? ''}
                    placeholder={p?.autoStartMonth ? String(p.autoStartMonth) : '1'}
                    align="right"
                    width={44}
                    onCommit={(v) => { const n = parseCount(v); if (n !== undefined) setRow(idx, { startMonth: n == null ? null : Math.round(n) }); }}
                  />
                </td>
                {hasWorkbook && Array.from({ length: numYears }, (_, yi) => (
                  <td key={yi} className={styles.num}>{p?.years?.[yi] > 0 ? fmtMoney(p.years[yi]) : ''}</td>
                ))}
                <td className={styles.num}>
                  {r.passThrough ? <span className={styles.muted}>pass</span> : (
                    <DraftInput
                      value={typeof r.feeGmPct === 'number' ? (r.feeGmPct * 100).toFixed(1) : ''}
                      placeholder={p?.gmPct != null ? fmtPct(p.gmPct) : 'auto'}
                      align="right"
                      width={60}
                      onCommit={(v) => { const n = parsePct(v); if (n !== undefined) setRow(idx, { feeGmPct: n }); }}
                    />
                  )}
                </td>
                <td>
                  <input type="checkbox" checked={r.passThrough === true} onChange={(e) => setRow(idx, { passThrough: e.target.checked })} />
                </td>
                <td>
                  <button type="button" className={styles.iconBtn} onClick={() => removeRow(idx)} title="Remove fee">×</button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={hasWorkbook ? 10 + numYears : 10} className={styles.muted}>No fees yet.</td></tr>
          )}
        </tbody>
        {hasWorkbook && rows.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={7}>Total</td>
              {totals.map((t, i) => <td key={i} className={styles.num}>{t > 0 ? fmtMoney(t) : ''}</td>)}
              <td colSpan={3} />
            </tr>
          </tfoot>
        )}
      </table>
      <div>
        <button type="button" className={styles.barBtn} onClick={() => onChange(st => ({ ...st, rows: [...st.rows, blankFeeStructureRow()] }))}>
          + Add fee
        </button>
      </div>
      {(() => {
        // Costs starting after the first year that no fee bills from
        // their own year: offer them a standard fee of their own.
        const later = std.costs.filter(co => co.later && (co.rowIdx < 0 || co.billedEarly));
        if (later.length === 0) return null;
        const months = [...new Set(later.map(co => co.startMonth))].sort((a, b) => a - b);
        return (
          <div className={styles.laterNote}>
            <span>
              {later.length === 1 ? 'One cost starts' : `${later.length} costs start`} after month {FIRST_YEAR_MONTHS}
              {` (month ${months.join(', ')})`} but {later.length === 1 ? 'is' : 'are'} not on a fee that bills from then,
              so {later.length === 1 ? 'it is' : 'they are'} billed early or not at all.
            </span>
            <button
              type="button"
              className={styles.barBtn}
              onClick={() => onChange(st => addLaterCostFees(st, costInputsFor(costs), { termMonths, siteCount, accountCount }))}
              title="Add a fee row per start month for these costs, starting the month they do, and point them at it. Its standard fee recovers exactly them."
            >
              + Add standard fee for costs after month {FIRST_YEAR_MONTHS}
            </button>
          </div>
        );
      })()}
      {costs.length > 0 && (
        <div className={styles.coverage}>
          <h5 className={styles.coverageTitle}>Costs covered</h5>
          <p className={styles.note}>
            Which fee recovers each of this service's costs on {optionName || 'the loaded option'}. The ★ standard
            fee above is built from these. A one-time or setup cost on a monthly fee can be rolled over the
            {` ${termMonths}-month`} term so the monthly fee recovers it.
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Line Item</th>
                <th>Cost Type</th>
                <th className={styles.num}>Start Month</th>
                <th className={styles.num}>Price</th>
                <th>Covered by</th>
                <th>Format</th>
              </tr>
            </thead>
            <tbody>
              {costs.map((c, ci) => {
                const co = std.costs[ci];
                const key = co.key;
                const row = co.rowIdx >= 0 ? rows[co.rowIdx] : null;
                const rollMonths = co.rowIdx >= 0 ? std.perRow[co.rowIdx].rollMonths : termMonths;
                const namedRows = rows.map((r, i) => ({ name: String(r.feeName || '').trim(), i })).filter(x => x.name);
                return (
                  <tr key={`${key}-${ci}`} className={co.issue || co.billedEarly ? styles.issueRow : undefined}>
                    <td>{c.description}</td>
                    <td>{c.type}</td>
                    <td className={styles.num}>{c.startMonth || ''}</td>
                    <td className={styles.num}>{fmtMoney(c.price)}</td>
                    <td>
                      <select
                        className={styles.cellSelect}
                        value={co.rowIdx >= 0 ? String(row.feeName || '').trim().toLowerCase() : ''}
                        onChange={(e) => setAllocation(key, { fee: e.target.value })}
                      >
                        <option value="">Not covered</option>
                        {namedRows.map(x => (
                          <option key={x.i} value={x.name.toLowerCase()}>{x.name}</option>
                        ))}
                      </select>
                      {co.defaulted && co.rowIdx >= 0 && <div className={styles.subNote}>matched by fee name</div>}
                      {co.billedEarly && (
                        <div className={styles.warnText}>
                          Starts month {co.startMonth}; this fee bills from month {Math.round(Number(row.startMonth) || 1)}
                        </div>
                      )}
                    </td>
                    <td>
                      {co.rowIdx < 0 ? (
                        <span className={styles.warnText}>Not recovered by any fee</span>
                      ) : co.canRoll ? (
                        <label className={styles.rollLabel}>
                          <input
                            type="checkbox"
                            checked={co.rolled}
                            onChange={(e) => setAllocation(key, { roll: e.target.checked, fee: String(row.feeName || '').trim().toLowerCase() })}
                          />
                          Roll over term
                          {co.rolled
                            ? <span className={styles.subNote}> {fmtMoney(c.price)} / {rollMonths} mo = {fmtMoney(c.price / rollMonths)} a month</span>
                            : <span className={styles.warnText}> {row.type} fee, {c.type} cost: not billed until rolled</span>}
                        </label>
                      ) : co.issue === 'recurringOnUpfront' ? (
                        <span className={styles.warnText}>Monthly cost on a {row.type} fee: point it at a monthly fee</span>
                      ) : co.bucket === COST_BUCKET_UPFRONT || co.rolled ? (
                        <span className={styles.subNote}>{co.rolled ? `Rolled over ${rollMonths} months` : 'Matches the fee'}</span>
                      ) : (
                        <span className={styles.subNote}>Matches the fee</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
