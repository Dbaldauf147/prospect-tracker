import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ServicesTab.module.css';
import {
  SERVICE_STATUS, FEE_STRUCTURE_TYPES, FEE_STRUCTURE_UNITS, serviceKey,
  newFeeStructureId, blankFeeStructureRow, feeStructureRowsFromFees, costTotalsByLineItem,
  costKey, costKeysFor, allocationFor, addLaterCostFees, FIRST_YEAR_MONTHS, feeStructureCostInputs,
  costTypeConversion, moveCostAllocation, feeBucket, standardFeeContext,
  passThroughFeeRows, addPassThroughFees, usageRatesFor,
} from '../../utils/pricingServices';
import { isUsageUnit, fmtFeePerUnit } from '../../utils/siaUsageCounts';
import { RATE_CHECK, checkPartOf, PASS_THROUGH_MODELS, passThroughModelOf, feeUnitCountsFor } from '../../utils/serviceRateCheck';
import { unitLabelFor } from '../../utils/servicePricing';

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
//   escalators      { feeEscalator, costEscalator }: the page's Escalator and
//                   Cost Esc., which the standard fees price in
//   autoStartMonthFor (altRow) => the month a fee with no Start Month of its
//                   own bills from (priced into its standard fee)
//   previewOnOption (serviceName, structure|null) => the option with it in place
//   applyFeeStructure (serviceName, structure) => writes it to the schedule
//   unlinked        unmappedLineItems() for the active option: cost lines
//                   with no service yet, warned about above the list
//   tagOptions      the Dropdowns catalog a cost line can be tagged to
//   onTagLineItem   (lineItemKey, serviceName) => adds the service
//   onMoveLineItem  ({ description, type }, fromService, toService) => swaps
//                   one service for another on that one cost line (type as
//                   the SIA gives it); the line item's other cost lines stay
//   onIgnoreLineItem (lineItemKey) => marks the line item Ignore
//   sharedToSplit   sharedLineItemsToSplit() for the active option: line
//                   items tied to several services with no priority order,
//                   whose cost lines are asked which service they go to
//   onSplitCostLine ({ description, type }, service) => points that cost
//                   line at the one service on the active option only
//                   ('' puts it back on the list)
//   onKeepShared    (sharedToSplit row) => keeps the line item shared on
//                   the active option
//   onPickItemServices ([{ item, service }]) => the Pick services popup's
//                   answer: each SIA row pointed at one service on the
//                   active option ('' puts it back to shared)
//   onSetItemType   (itemId, type) => overrides a cost line's Type ('' clears it)
//   onSetPassThrough (description, type, on) => the Linked To pass-through
//                   setting for that Line Item + Type pair
//   onSetCompleted  (serviceName, on) => marks the service done on every
//                   option (its list row turns green)
//   onSetItemAnnual (itemId, on) => turns a one-time cost into an annual one
//                   (CTS ÷ 12, Recurring monthly), or back
//   onSetFeeComponent (serviceName, itemId, componentId) => points a cost
//                   line at one of the rate card's fee components for the
//                   price check ('' puts it back on Auto)
export function ServicesTab({
  workbook, activeOption, setActiveOption, services = [], detailFor, numYears = 1, termMonths = 36, onOpenLinkedTo,
  onSetCount, onIgnoreForCheck, onSetFeeComponent, feeStructures = {}, setFeeStructures, previewFeeRow, autoStartMonthFor, escalators = {}, previewOnOption, applyFeeStructure, onSetItemType, onSetItemAnnual, onSetPassThrough,
  unlinked = null, tagOptions = [], onTagLineItem, onMoveLineItem, onIgnoreLineItem, sharedToSplit = [], onSplitCostLine, onKeepShared, onPickItemServices, onSetCompleted, completedServices = [], globalGmPct = null,
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [showInactive, setShowInactive] = useState(true);
  // The service list stays in view while the detail beside it scrolls, and
  // runs to the bottom of the visible area. How tall that area is depends
  // on how far the Pricing header above wraps, so it is measured rather
  // than guessed at in CSS.
  const wrapperRef = useRef(null);
  const [listMaxHeight, setListMaxHeight] = useState(null);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      // Less the top padding it pins under and a small gap at the foot.
      const pad = (parseFloat(getComputedStyle(el).paddingTop) || 0) + 12;
      const h = el.clientHeight - pad;
      setListMaxHeight(h > 300 ? Math.floor(h) : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const opt = workbook?.options?.find(o => o.optionNumber === activeOption) || workbook?.options?.[0] || null;
  const scopeCount = services.filter(s => s.inScope).length;
  // Completed means the service's fee structure is settled, which holds on
  // every option and SIA, so it is saved apart from the workbook
  // (completedServices). Marks older saves kept on an option still count.
  const completed = new Set([...completedServices, ...(workbook?.options || []).flatMap(o => o.servicesCompleted || [])].map(k => String(k).trim().toLowerCase()));
  const isDone = (name) => completed.has(String(name ?? '').trim().toLowerCase());
  const doneInScope = services.filter(s => s.inScope && isDone(s.name)).length;

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
  // Every cost line's CTS on the active option, the whole the picked
  // service's Total CTS is shown as a share of.
  const optionCtsTotal = useMemo(
    () => (opt?.sections || []).flatMap(sec => sec.items || [])
      .reduce((sum, it) => sum + (typeof it.cts === 'number' && Number.isFinite(it.cts) ? it.cts : 0), 0),
    [opt],
  );
  // In-scope services whose price check on the active option lands outside
  // the rate card's range, flagged with a ! in the list.
  const outOfRange = useMemo(() => {
    const out = new Map();
    if (!workbook || !detailFor) return out;
    for (const s of services) {
      if (!s.inScope) continue;
      const d = detailFor(s.name);
      if (!d?.rateCheck) continue;
      const { status } = rateVerdict(d.rateCheck, ctsShareOf(d.items, optionCtsTotal));
      if (status === RATE_CHECK.BELOW || status === RATE_CHECK.ABOVE) out.set(s.name, status);
    }
    return out;
  }, [workbook, detailFor, services, optionCtsTotal]);

  // The picked service can take a one-click tag only when it's one the
  // Dropdowns catalog still offers; tagging to anything else would leave
  // the warning standing.
  const quickTag = current && tagOptions.some(o => String(o).trim().toLowerCase() === current.name.trim().toLowerCase())
    ? current.name
    : null;

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <p className={styles.intro}>
        Every service on the Dropdowns tab, with its status there. Services tied to a cost line on the
        attached SIA are marked with a blue dot <span className={styles.scopeDot} aria-hidden="true" /> and listed first.
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

      {workbook && sharedToSplit.length > 0 && onSplitCostLine && (
        <SharedSplitPrompt
          rows={sharedToSplit}
          optionName={opt?.sheetName}
          onSplit={onSplitCostLine}
          onKeepShared={onKeepShared}
          onPickItems={onPickItemServices}
          option={opt}
          onOpenLinkedTo={onOpenLinkedTo}
        />
      )}

      <div className={styles.layout}>
        <div className={styles.listPane} style={listMaxHeight ? { maxHeight: listMaxHeight } : undefined}>
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
              ? `${scopeCount} of ${services.length} service${services.length === 1 ? '' : 's'} in SIA scope${opt ? ` (${opt.sheetName})` : ''}${scopeCount ? `, ${doneInScope} completed` : ''}`
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
                    className={`${styles.serviceBtn} ${isDone(s.name) ? styles.serviceDone : ''} ${s.name === selected ? styles.serviceBtnActive : ''} ${s.status === SERVICE_STATUS.RETIRED || s.status === SERVICE_STATUS.HIDDEN ? styles.serviceMuted : ''}`}
                    onClick={() => setSelected(s.name === selected ? null : s.name)}
                  >
                    <span className={styles.serviceName}>{isDone(s.name) && <span className={styles.doneCheck} title="Completed">✓ </span>}{s.name}</span>
                    <span className={styles.serviceTags}>
                      {outOfRange.has(s.name) && (
                        <span
                          className={styles.rangeWarn}
                          title={`Price check ${outOfRange.get(s.name) === RATE_CHECK.BELOW ? 'below' : 'above'} the rate card range on ${opt?.sheetName || 'this option'}`}
                          aria-label="Outside the rate card range"
                        >!</span>
                      )}
                      {s.inScope && <span className={styles.scopeDot} title="In SIA scope" aria-label="In SIA scope" />}
                      {s.status !== SERVICE_STATUS.ACTIVE && <span className={styles[STATUS_CLASS[s.status]]}>{s.status}</span>}
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
              autoStartMonthFor={autoStartMonthFor}
              escalators={escalators}
              previewOnOption={previewOnOption}
              onSetItemType={onSetItemType}
              onSetItemAnnual={onSetItemAnnual}
              onSetPassThrough={onSetPassThrough}
              moveTargets={services.filter(s => s.inScope && s.name !== current.name).map(s => s.name)}
              onMoveItem={workbook && onMoveLineItem ? (line, to) => onMoveLineItem(line, current.name, to) : null}
              onOpenService={setSelected}
              applyFeeStructure={applyFeeStructure}
              detail={detail}
              detailForStructure={detailFor ? (st) => detailFor(current.name, st) : null}
              hasWorkbook={!!workbook}
              optionName={opt?.sheetName}
              optionCtsTotal={optionCtsTotal}
              numYears={numYears}
              termMonths={termMonths}
              siteCount={feeUnitCountsFor(detail).siteCount ?? opt?.siteCount}
              accountCount={feeUnitCountsFor(detail).accountCount ?? opt?.accountCount}
              kwhCount={feeUnitCountsFor(detail).kwhCount ?? opt?.kwhCount}
              dthCount={feeUnitCountsFor(detail).dthCount ?? opt?.dthCount}
              onOpenLinkedTo={onOpenLinkedTo}
              onSetCount={onSetCount ? (key, value) => onSetCount(current.name, key, value) : null}
              onIgnoreForCheck={onIgnoreForCheck ? (itemId, on) => onIgnoreForCheck(current.name, itemId, on) : null}
              onSetFeeComponent={onSetFeeComponent ? (itemId, id) => onSetFeeComponent(current.name, itemId, id) : null}
              globalGmPct={globalGmPct}
              completed={isDone(current.name)}
              onSetCompleted={workbook && onSetCompleted ? (on) => onSetCompleted(current.name, on) : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// The services a cost line can be split to: its line item's list, plus
// whatever the line is on now, deduped case-insensitively.
function splitChoices(row, line) {
  const seen = new Set();
  return [...row.services, ...line.choices].filter(s => {
    const k = String(s).trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Line items on the active option tied to several services with no
// priority order, so each service counts the whole cost. Each cost line
// (line item + SIA type) gets a menu of those services to say which one it
// really belongs to; Keep shared settles it as it is.
function SharedSplitPrompt({ rows, optionName, onSplit, onKeepShared, onPickItems, option, onOpenLinkedTo }) {
  const [open, setOpen] = useState(true);
  // The row whose Pick services popup is open, by key, so it follows the
  // row as the picks it saves re-derive the list.
  const [pickingKey, setPickingKey] = useState(null);
  const picking = rows.find(r => r.key === pickingKey) || null;
  const n = rows.length;
  return (
    <div className={styles.unlinked} role="alert">
      <div className={styles.unlinkedHead}>
        <span aria-hidden="true">⚠</span>
        <span className={styles.unlinkedText}>
          <strong>{n} line item{n === 1 ? '' : 's'}</strong>
          {optionName ? ` on ${optionName}` : ''} {n === 1 ? 'is' : 'are'} tied to several services with no priority order,
          so every one of them counts the full cost. Pick the service each cost line belongs to on this option, or keep it shared. Other options and the Linked To subtab are not changed.
        </span>
        <button type="button" className={styles.linkBtn} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <ul className={styles.unlinkedList}>
          {rows.map(row => (
            <li key={row.key} className={styles.splitRow}>
              <div className={styles.splitHead}>
                <span className={styles.unlinkedName}>
                  {row.name}
                  <span className={styles.subNote}>Shared by {row.services.join(', ')}</span>
                </span>
                <span className={styles.splitActions}>
                  {onPickItems && (
                    <button
                      type="button"
                      className={styles.tagBtn}
                      onClick={() => setPickingKey(row.key)}
                      title="Match each cost line of this line item to the service it belongs to, on this option"
                    >
                      Pick services
                    </button>
                  )}
                  {onKeepShared && (
                    <button
                      type="button"
                      className={styles.ignoreBtn}
                      onClick={() => onKeepShared(row)}
                      title="Every service listed keeps counting this cost on this option. Asks again if the list of services changes."
                    >
                      Keep shared
                    </button>
                  )}
                </span>
              </div>
              {row.lines.map(line => (
                <div key={line.type || '(none)'} className={styles.splitLine}>
                  <span className={styles.splitLineName}>
                    {line.type || 'No type'}
                    <span className={styles.subNote}>
                      {`${line.count} cost line${line.count === 1 ? '' : 's'}${line.cts ? `, ${fmtMoney(line.cts)} CTS` : ''}`}
                    </span>
                  </span>
                  <select
                    className={`${styles.tagSelect} ${line.pick ? '' : styles.splitPending}`}
                    value={line.mixed ? MIXED : (line.pick || '')}
                    onChange={(e) => { if (e.target.value !== MIXED) onSplit({ description: line.description, type: line.type, items: line.items.map(r => r.item) }, e.target.value); }}
                    aria-label={`Service for ${row.name}, ${line.type || 'no type'}`}
                  >
                    {line.mixed && <option value={MIXED} disabled>Picked per cost line</option>}
                    <option value="">Shared by all ({row.services.length})</option>
                    {splitChoices(row, line).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <PickServicesModal
          key={picking.key}
          row={picking}
          option={option}
          optionName={optionName}
          onSave={(picks) => { onPickItems(picks); setPickingKey(null); }}
          onClose={() => setPickingKey(null)}
        />
      )}
      {open && onOpenLinkedTo && (
        <div className={styles.unlinkedFoot}>
          To make the list a priority order instead, tick First in scope only on the{' '}
          <button type="button" className={styles.linkBtn} onClick={onOpenLinkedTo}>Linked To</button> subtab.
        </div>
      )}
    </div>
  );
}

// The line menu's value while its cost lines are picked one by one.
const MIXED = '__mixed__';
// "Shared by all" in the popup's set-every-line menu, whose blank value is
// its placeholder.
const SHARED = '__shared__';

// Pick services popup: every SIA row of one shared line item on the
// active option (all its types), each with its own service menu, so three
// One Time rows of Communication Support can go to three services. A menu
// at the top sets every row at once. Save hands back only the rows that
// changed; nothing is written until then.
function PickServicesModal({ row, option, optionName, onSave, onClose }) {
  // Which section of the option each row sits in, for telling apart rows
  // that share a description and a type.
  const sectionOf = useMemo(() => {
    const m = new Map();
    for (const sec of option?.sections || []) for (const it of sec.items || []) m.set(it.id, sec.title);
    return m;
  }, [option]);
  const entries = useMemo(() => row.lines.flatMap(line => line.items.map(r => ({ ...r, line }))), [row]);
  const [picks, setPicks] = useState(() => Object.fromEntries(entries.map(r => [r.item.id, r.pick || ''])));
  const choices = splitChoices(row, { choices: [] });
  const changed = entries.filter(r => (picks[r.item.id] || '') !== (r.pick || ''));

  // Running CTS per service as picked, shared rows counted under "Shared".
  const totals = useMemo(() => {
    const m = new Map();
    for (const r of entries) {
      const k = picks[r.item.id] || 'Shared by all';
      m.set(k, (m.get(k) || 0) + (typeof r.item.cts === 'number' ? r.item.cts : 0));
    }
    return [...m.entries()];
  }, [entries, picks]);

  const backdropDown = useRef(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className={styles.pickBackdrop}
      onMouseDown={(e) => { backdropDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropDown.current) onClose(); }}
    >
      <div className={styles.pickModal} role="dialog" aria-label={`Pick services for ${row.name}`}>
        <div className={styles.pickHead}>
          <div className={styles.pickTitle}>Pick services: {row.name}</div>
          <div className={styles.pickSub}>
            Match each cost line to the service it belongs to{optionName ? ` on ${optionName}` : ''}.
            Other options and the Linked To subtab are not changed.
          </div>
        </div>
        <div className={styles.pickBody}>
          <label className={styles.pickAll}>
            Set every cost line to
            <select
              className={styles.tagSelect}
              value=""
              onChange={(e) => {
                const v = e.target.value === SHARED ? '' : e.target.value;
                setPicks(Object.fromEntries(entries.map(r => [r.item.id, v])));
              }}
            >
              <option value="" disabled>(Choose)</option>
              <option value={SHARED}>Shared by all ({row.services.length})</option>
              {choices.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <table className={styles.pickTable}>
            <thead>
              <tr>
                <th>Section</th>
                <th>Type</th>
                <th>Start</th>
                <th>Comments</th>
                <th className={styles.pickNum}>CTS</th>
                <th>Service</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(r => (
                <tr key={r.item.id}>
                  <td>{sectionOf.get(r.item.id) || '-'}</td>
                  <td>{r.item.type || 'No type'}</td>
                  <td>{r.item.startMonth || '-'}</td>
                  <td>{r.item.comments || '-'}</td>
                  <td className={styles.pickNum}>{fmtMoney(r.item.cts) || '-'}</td>
                  <td>
                    <select
                      className={`${styles.tagSelect} ${picks[r.item.id] ? '' : styles.splitPending}`}
                      value={picks[r.item.id] || ''}
                      onChange={(e) => setPicks(p => ({ ...p, [r.item.id]: e.target.value }))}
                      aria-label={`Service for ${row.name}, ${r.item.type || 'no type'}, ${fmtMoney(r.item.cts) || 'no CTS'}`}
                    >
                      <option value="">Shared by all ({row.services.length})</option>
                      {choices.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.pickTotals}>
            {totals.map(([k, v]) => <span key={k}><strong>{k}</strong>: {fmtMoney(v)}</span>)}
          </div>
        </div>
        <div className={styles.pickFoot}>
          <button type="button" className={styles.ignoreBtn} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={styles.pickSave}
            disabled={changed.length === 0}
            style={changed.length === 0 ? { opacity: 0.5, cursor: 'default' } : undefined}
            onClick={() => onSave(changed.map(r => ({ item: r.item, service: picks[r.item.id] || '' })))}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
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

function ServiceDetail({ service, globalGmPct, completed = false, onSetCompleted, detail: standardDetail, detailForStructure = null, hasWorkbook, optionName, optionCtsTotal = 0, numYears, termMonths, siteCount, accountCount, kwhCount, dthCount, onOpenLinkedTo, onSetCount, onIgnoreForCheck, onSetFeeComponent, saved, setSaved, previewFeeRow, autoStartMonthFor, escalators = {}, previewOnOption, applyFeeStructure, onSetItemType, onSetItemAnnual, onSetPassThrough, moveTargets = [], onMoveItem = null, onOpenService }) {
  const structures = saved?.structures || [];
  const standardId = saved?.standardId || null;
  // Which saved fee structure is open. Opens on the standard one, and falls
  // back to it (or the first) when the open one is deleted.
  const [view, setView] = useState(() => standardId || structures[0]?.id || null);
  const openStructure = structures.find(x => x.id === view)
    || structures.find(x => x.id === standardId)
    || structures[0]
    || null;
  // The price check's fee components follow the open structure's fees, so
  // a structure other than the standard one reads its own check.
  const standardStructure = structures.find(x => x.id === standardId) || structures[0] || null;
  const detail = openStructure && openStructure !== standardStructure && detailForStructure
    ? detailForStructure(openStructure)
    : standardDetail;
  const items = detail?.items || [];
  const fees = detail?.fees || [];
  const [flash, setFlash] = useState('');
  const say = (msg) => { setFlash(msg); window.setTimeout(() => setFlash(''), 3500); };
  // Lines left out of the price check are hidden from the cost table and
  // its total. "Show" brings them back so they can be ticked in again.
  const [showIgnored, setShowIgnored] = useState(false);
  // The last cost line moved off to another service, said above the table
  // since the line itself leaves it.
  const [moved, setMoved] = useState(null);
  // A move is one cost line: its line item and the type the SIA gives it.
  // Two lines alike in both (rare) can't be told apart, so they go together.
  const lc = (v) => String(v ?? '').trim().toLowerCase();
  const sameLine = (a, b) => lc(a.description) === lc(b.description) && lc(a.siaType) === lc(b.siaType);
  function moveItem(it, to) {
    if (!onMoveItem || !to) return;
    const count = items.filter(x => sameLine(x, it)).length;
    onMoveItem({ description: it.description, type: it.siaType }, to);
    setMoved({ name: it.description, type: it.type, to, count });
  }

  function addStructure(fromSia) {
    const id = newFeeStructureId();
    const rows = fromSia ? feeStructureRowsFromFees(fees) : [];
    const name = fromSia
      ? (structures.length === 0 ? 'Standard' : `Option ${structures.length + 1}`)
      : `Option ${structures.length + 1}`;
    setSaved(prev => ({
      structures: [...prev.structures, { id, name, rows: rows.length ? rows : [blankFeeStructureRow()], needsAllocation: items.length > 0 }],
      standardId: prev.standardId || id,
    }));
    setView(id);
  }
  function updateStructure(id, fn) {
    setSaved(prev => ({ ...prev, structures: prev.structures.map(x => (x.id === id ? fn(x) : x)) }));
  }
  function duplicateStructure(st) {
    const id = newFeeStructureId();
    setSaved(prev => ({ ...prev, structures: [...prev.structures, { id, name: `${st.name} (copy)`, rows: st.rows.map(r => ({ ...r })), allocations: { ...(st.allocations || {}) }, needsAllocation: items.length > 0 }] }));
    setView(id);
  }
  function deleteStructure(st) {
    if (!window.confirm(`Delete the fee structure "${st.name}"?`)) return;
    setSaved(prev => {
      const rest = prev.structures.filter(x => x.id !== st.id);
      return { structures: rest, standardId: prev.standardId === st.id ? (rest[0]?.id || null) : prev.standardId };
    });
    setView(null);
  }
  // Which fee of the open structure each cost line goes on. Each structure
  // keeps its own (structure.allocations, by cost key): Auto lets a cost
  // fall to the fee carrying its fee name, else the first fee that can
  // bill it; a pick points it at one fee, or at none ("Not covered").
  const openStd = openStructure && hasWorkbook
    ? standardFeeContext(openStructure, items, { termMonths, siteCount, accountCount, kwhCount, dthCount, startMonthFor: autoStartMonthFor, ...escalators })
    : null;
  const openFees = openStructure
    ? [...new Map((openStructure.rows || []).map(r => String(r.feeName || '').trim()).filter(Boolean).map(n => [n.toLowerCase(), n])).values()]
    : [];
  const showStructureFee = !!openStructure && items.length > 0;
  // Keyed per line, so two lines with the same line item, type and start
  // month each keep their own pick.
  const itemKeys = costKeysFor(items);
  const allocOf = (i) => allocationFor(openStructure?.allocations, itemKeys[i]);
  const structureFeeValue = (i) => {
    const a = allocOf(i);
    if (!a || typeof a.fee !== 'string') return '';
    if (a.fee === '') return '__none';
    return openFees.find(n => n.toLowerCase() === a.fee) || '';
  };
  const autoFeeLabel = (i) => {
    const co = openStd?.std?.costs?.[i];
    const row = co && co.rowIdx >= 0 ? openStructure.rows[co.rowIdx] : null;
    return row?.feeName ? `Auto: ${row.feeName}` : 'Auto: not covered';
  };
  function setStructureFee(i, value) {
    if (!openStructure) return;
    const k = itemKeys[i];
    const base = k.replace(/::n\d+$/, '');
    updateStructure(openStructure.id, st => {
      const alloc = { ...(st.allocations || {}) };
      // A pick saved under the shared key before lines were told apart
      // covered every line of the group. Pin it on each other line first,
      // so changing this one leaves them where they were.
      if (alloc[base]) {
        itemKeys.forEach(ok => {
          if (ok !== k && ok !== base && ok.replace(/::n\d+$/, '') === base && !alloc[ok]) alloc[ok] = { ...alloc[base] };
        });
      }
      const { fee: _fee, ...rest } = allocationFor(alloc, k) || {};
      if (value === '') {
        // An empty entry on a later line keeps it on Auto rather than
        // falling back to the shared pick.
        if (Object.keys(rest).length || (k !== base && alloc[base])) alloc[k] = rest; else delete alloc[k];
      } else {
        alloc[k] = { ...rest, fee: value === '__none' ? '' : value.toLowerCase() };
      }
      return { ...st, allocations: alloc };
    });
  }
  const costTotal = items.reduce((s, it) => s + (typeof it.cts === 'number' ? it.cts : 0), 0);
  const ignoredCount = items.filter(it => it.ignored).length;
  const ignoredTotal = items.reduce((s, it) => s + (it.ignored && typeof it.cts === 'number' ? it.cts : 0), 0);
  // A Fee component column when the rate card prices a part of the fee
  // model on more than one component, so each cost can be pointed at one.
  const componentChoices = (hasWorkbook && detail?.rateCheck?.componentChoices) || {};
  // Pass-through lines get the column too: each picks how it is shown in
  // its own row below the price check (a fixed fee, or per account).
  const hasPassThrough = hasWorkbook && items.some(it => it.passThrough && !it.ignored);
  const showComponents = !!onSetFeeComponent && (Object.keys(componentChoices).length > 0 || hasPassThrough);
  const meta = service.meta || {};

  // Each cost line's type against the fee that prices it in the pricing
  // standard: the starred structure's fee covering the cost, else that
  // structure's fee type when all its fees bill one way, else the
  // Dropdowns service type. A mismatch offers the type that fits.
  const standard = structures.find(x => x.id === standardId) || null;
  const stdCosts = standard && hasWorkbook
    ? standardFeeContext(standard, items, { termMonths, siteCount, accountCount, kwhCount, dthCount, startMonthFor: autoStartMonthFor, ...escalators }).std.costs
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
  // A card that charges no setup leaves a Setup cost nothing to recover
  // it but the ongoing fee, so such a line is rolled over the term as soon
  // as it shows here, the same as its Convert to Setup Rolled button.
  const setupOffCard = hasWorkbook && !!detail?.rateCheck?.setupOffCard;
  const isPlainSetup = (t) => /^setup$/i.test(String(t || '').trim());
  const toRoll = setupOffCard && onSetItemType
    ? items.filter(it => !it.typeSet && !it.passThrough && !it.ignored && typeof it.cts === 'number' && isPlainSetup(it.type))
    : [];
  const toRollKey = toRoll.map(it => it.id).join('|');
  function convertType(it, toType) {
    if (!onSetItemType) return;
    // Back to the SIA's own type clears the override rather than pinning
    // it, except for a Setup the card has no setup fee for: that one is
    // pinned, so it isn't rolled again the moment it is put back.
    const pin = setupOffCard && isPlainSetup(toType);
    onSetItemType(it.id, toType === it.siaType && !pin ? '' : toType);
    const fromKey = costKey(it.description, it.type, it.startMonth);
    const toKey = costKey(it.description, toType, it.startMonth);
    setSaved(prev => ({ ...prev, structures: moveCostAllocation(prev.structures, fromKey, toKey) }));
  }
  useEffect(() => {
    toRoll.forEach(it => convertType(it, 'Setup Rolled'));
    // Keyed on the lines still to roll; each drops out once converted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toRollKey]);
  // A one-time cost that really comes round every year: billed as a twelfth
  // of it each month, so a monthly fee recovers it. Undo puts the SIA's
  // figure and type back.
  function convertAnnual(it, on) {
    if (!onSetItemAnnual) return;
    onSetItemAnnual(it.id, on);
    const fromKey = costKey(it.description, it.type, it.startMonth);
    const toKey = costKey(it.description, on ? 'Recurring (monthly)' : it.siaType, it.startMonth);
    setSaved(prev => ({ ...prev, structures: moveCostAllocation(prev.structures, fromKey, toKey) }));
  }
  const canAnnualize = (it) => !!onSetItemAnnual && it.annualFrom == null && typeof it.cts === 'number'
    && /^one\s*time$/i.test(String(it.type || '').trim());

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <h3 className={styles.detailTitle}>{service.name}</h3>
        {service.inScope && <span className={styles.scopeTag}>In SIA scope</span>}
        <span className={styles[STATUS_CLASS[service.status]]}>{service.status}</span>
        {onSetCompleted && (
          <button
            type="button"
            className={completed ? styles.doneBtnOn : styles.doneBtn}
            onClick={() => onSetCompleted(!completed)}
            title={completed ? 'Fee structure settled, completed on every option. Click to mark it not completed.' : 'Mark this service completed: its fee structure is established and ready to go. Applies to every option.'}
          >
            {completed ? '✓ Completed' : 'Mark completed'}
          </button>
        )}
      </div>

      {!hasWorkbook ? (
        <div className={styles.placeholder}>Upload an SIA on the Pricing subtab to see the cost lines and fees behind this service.</div>
      ) : (
          <section className={styles.section}>
            {mismatches > 0 && (
              <div className={styles.note}>
                {mismatches === 1 ? 'One cost line has' : `${mismatches} cost lines have`} a type that doesn't bill the way
                the pricing standard does. Convert {mismatches === 1 ? 'it' : 'them'} below: a one-time or setup cost on a
                monthly fee becomes Rolled, spread over the {termMonths}-month term, or an annual cost (a twelfth of it
                each month) when it comes round every year.
              </div>
            )}
            {showStructureFee && openStructure.needsAllocation && (
              <div className={styles.laterNote}>
                <span>
                  New fee structure &quot;{openStructure.name}&quot;: pick the fee each cost line goes on in the
                  highlighted <strong>Fee in {openStructure.name}</strong> column, so this structure has its own fee setup.
                  {openFees.length === 0 && ' Name its fees below first.'}
                </span>
                <button
                  type="button"
                  className={styles.barBtn}
                  onClick={() => updateStructure(openStructure.id, st => { const { needsAllocation: _n, ...rest } = st; return rest; })}
                >
                  Done
                </button>
              </div>
            )}
            {moved && (
              <div className={styles.movedNote}>
                <span>
                  Moved {moved.count === 1 ? '' : `${moved.count} cost lines of `}&quot;{moved.name}&quot;{moved.type ? ` (${moved.type})` : ''} to <strong>{moved.to}</strong>.
                </span>
                {onOpenService && (
                  <button type="button" className={styles.linkBtn} onClick={() => onOpenService(moved.to)}>Open {moved.to}</button>
                )}
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
                    <th>Unit</th>
                    <th>Pass-through</th>
                    {showComponents && <th title={openStructure ? `Which of the rate card's fee components this cost pays for, in the price check below: the one matching the unit of the fee it goes on in "${openStructure.name}". Auto checks it with the other lines left on Auto.` : "Which of the rate card's fee components this cost pays for, in the price check below. Auto checks it with the other unpicked lines."}>Fee component</th>}
                    {onIgnoreForCheck && <th title="Untick to leave a line out of the price check below.">In price check</th>}
                    {showStructureFee && (
                      <th
                        className={openStructure.needsAllocation ? styles.allocHead : undefined}
                        title={`Which fee of the "${openStructure.name}" fee structure below this cost goes on. Each fee structure keeps its own.`}
                      >
                        Fee in {openStructure.name}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (it.ignored && !showIgnored) ? null : (
                    <tr key={it.id} className={it.ignored ? styles.ignoredRow : undefined}>
                      <td>
                        {it.description}
                        {it.otherServices.length > 0 && (
                          <div className={styles.subNote}>Also covers {it.otherServices.join(', ')}</div>
                        )}
                        {onMoveItem && moveTargets.length > 0 && (
                          <div className={styles.moveRow}>
                            <select
                              className={styles.moveSelect}
                              value=""
                              onChange={(e) => moveItem(it, e.target.value)}
                              aria-label={`Move ${it.description} to another service`}
                              title={(() => {
                                const n = items.filter(x => sameLine(x, it)).length;
                                return `Move this one cost line to another service in scope on ${optionName || 'this option'}. `
                                  + `Only this "${it.description}" line moves${it.siaType ? ` (${it.siaType})` : ''}; other lines with the same Line Item stay where they are. `
                                  + `It holds on every option${n > 1 ? `, and the ${n} identical lines move together` : ''}.`;
                              })()}
                            >
                              <option value="">Move to...</option>
                              {moveTargets.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </div>
                        )}
                      </td>
                      <td>
                        {it.type}
                        {it.annualFrom != null ? (
                          <div className={styles.subNote}>
                            SIA: {it.siaType} {fmtMoney(it.annualFrom)}, now annual ({fmtMoney(it.annualFrom)} ÷ 12)
                            {onSetItemAnnual && (
                              <> <button type="button" className={styles.linkBtn} onClick={() => convertAnnual(it, false)}>Undo</button></>
                            )}
                          </div>
                        ) : it.siaType && it.siaType !== it.type && (
                          <div className={styles.subNote}>
                            SIA: {it.siaType}
                            {setupOffCard && isPlainSetup(it.siaType) && /rolled/i.test(it.type) && ', rolled: no setup fee on the rate card'}
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
                            ) : null}
                            {typeFit[i].feeBucket === 'recurring' && canAnnualize(it) && (
                              <button
                                type="button"
                                className={styles.tagBtn}
                                onClick={() => convertAnnual(it, true)}
                                title={`For a cost that comes round every year. Bills ${fmtMoney(it.cts)} a year as ${fmtMoney(it.cts / 12)} a month (Recurring (monthly)), so the monthly fee recovers it every year of the term. Changes the cost on ${optionName || 'this option'}. Undo puts the SIA's figure back.`}
                              >
                                Convert to annual cost
                              </button>
                            )}
                            {!typeFit[i].convertTo && (
                              <span className={styles.subNote}>Point it at a monthly fee instead</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className={styles.num}>{fmtMoney(it.cts)}</td>
                      <td className={styles.num}>{it.startMonth || ''}</td>
                      <td>
                        {it.unit}
                        {/* The counts the price check prices on (the SIA's, or
                            typed), shown against the lines they price. They are
                            this service's own, so every line shows the same boxes. */}
                        {hasWorkbook && onSetCount && detail?.rateCheck && !it.ignored && (
                          <CheckCounts
                            missing={detail.rateCheck.missing}
                            used={detail.rateCheck.unitsUsed}
                            entered={detail.enteredCounts}
                            fromSia={detail.fromSia}
                            onSetCount={onSetCount}
                          />
                        )}
                      </td>
                      <td className={onSetPassThrough ? styles.center : undefined}>
                        {onSetPassThrough ? (
                          <input
                            type="checkbox"
                            checked={it.passThrough === true}
                            onChange={(e) => onSetPassThrough(it.description, it.type, e.target.checked)}
                            title={`Bill this cost at cost, with no margin. Same setting as the Linked To subtab: applies to every "${it.description}" line typed ${it.type || 'blank'}, on every option.`}
                          />
                        ) : (it.passThrough ? 'Yes' : '')}
                      </td>
                      {showComponents && (
                        <td>
                          {(() => {
                            // With a fee structure the component follows the
                            // structure fee the line goes on, by its unit, so
                            // it is shown rather than picked.
                            const from = it.componentFrom;
                            if (from && !it.ignored) {
                              const part = checkPartOf(it);
                              const choices = part ? componentChoices[part] : null;
                              if (!it.passThrough && !choices) return null;
                              const label = it.passThrough
                                ? PASS_THROUGH_MODELS.find(m => m.id === passThroughModelOf(it))?.label
                                : (choices.find(c => c.id === it.feeComponent)?.label || 'Auto');
                              return (
                                <span
                                  title={from.fee
                                    ? `Follows "${from.fee}" (${from.unit || 'no unit'}) in the "${from.structure}" fee structure. Change the fee this line goes on, or that fee's unit, to change it.`
                                    : `On no fee in the "${from.structure}" fee structure, so it is checked on Auto.`}
                                >
                                  {label}
                                  <div className={styles.subNote}>{from.fee ? `from ${from.fee}` : 'on no fee'}</div>
                                </span>
                              );
                            }
                            if (it.passThrough && !it.ignored) {
                              return (
                                <select
                                  className={styles.tagSelect}
                                  value={passThroughModelOf(it)}
                                  onChange={(e) => onSetFeeComponent(it.id, e.target.value)}
                                  aria-label={`Pass-through fee model for ${it.description}`}
                                  title="Pass-through: billed at cost, on its own line below the price check rather than in the rate card's components."
                                >
                                  {PASS_THROUGH_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                </select>
                              );
                            }
                            const part = it.ignored ? null : checkPartOf(it);
                            const choices = part ? componentChoices[part] : null;
                            if (!choices) return null;
                            const value = choices.some(c => c.id === it.feeComponent) ? it.feeComponent : '';
                            return (
                              <select
                                className={styles.tagSelect}
                                value={value}
                                onChange={(e) => onSetFeeComponent(it.id, e.target.value)}
                                aria-label={`Fee component for ${it.description}`}
                              >
                                <option value="">Auto</option>
                                {choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                              </select>
                            );
                          })()}
                        </td>
                      )}
                      {onIgnoreForCheck && (
                        <td className={styles.center}>
                          <input
                            type="checkbox"
                            checked={!it.ignored}
                            onChange={(e) => onIgnoreForCheck(it.id, !e.target.checked)}
                            title={it.ignored ? 'Left out of the price check on every option. Tick to count it again.' : 'Counted in the price check. Untick to leave it out, on every option and the next SIA with this line.'}
                          />
                        </td>
                      )}
                      {showStructureFee && (
                        <td className={openStructure.needsAllocation ? styles.allocCell : undefined}>
                          <select
                            className={styles.tagSelect}
                            value={structureFeeValue(i)}
                            onChange={(e) => setStructureFee(i, e.target.value)}
                            aria-label={`Fee in ${openStructure.name} for ${it.description}`}
                          >
                            <option value="">{autoFeeLabel(i)}</option>
                            {openFees.map(n => <option key={n} value={n}>{n}</option>)}
                            <option value="__none">Not covered</option>
                          </select>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total CTS</td>
                    <td className={styles.num}>
                      {fmtMoney(costTotal - ignoredTotal)}
                      {optionCtsTotal > 0 && (
                        <div
                          className={styles.subNote}
                          title={`This service's Total CTS as a share of the CTS on every cost line on ${optionName || 'this option'}. A line tied to more than one service counts in full for each.`}
                        >
                          {fmtPct((costTotal - ignoredTotal) / optionCtsTotal)} of {fmtMoney(optionCtsTotal)} total
                        </div>
                      )}
                      {ignoredTotal > 0 && (
                        <div className={styles.subNote}>
                          {fmtMoney(ignoredTotal)} left out, not counted
                        </div>
                      )}
                    </td>
                    <td colSpan={3 + (onIgnoreForCheck ? 1 : 0) + (showComponents ? 1 : 0) + (showStructureFee ? 1 : 0)}>
                      {ignoredCount > 0 && (
                        <span className={styles.subNote}>
                          {ignoredCount === 1 ? '1 line' : `${ignoredCount} lines`} left out of the price check.{' '}
                          <button type="button" className={styles.linkBtn} onClick={() => setShowIgnored(v => !v)}>
                            {showIgnored ? 'Hide' : 'Show'}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
      )}

      {hasWorkbook && (/sourcing/i.test(service?.name || '') || structures.some(st => (st.rows || []).some(r => isUsageUnit(r.unit)))) && (
        <EnergyVolume
          kwhCount={kwhCount}
          dthCount={dthCount}
          rates={usageRatesFor(items, { termMonths, kwhCount, dthCount, startMonthFor: autoStartMonthFor, ...escalators })}
        />
      )}

      {hasWorkbook && detail?.rateCheck && (
        <RateCheck
          check={detail.rateCheck}
          ctsShare={ctsShareOf(items, optionCtsTotal)}
        />
      )}

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Fee structure</h4>
            <FeeStructureTabs
              structures={structures}
              standardId={standardId}
              view={view}
              setView={setView}
              onAdd={addStructure}
            />
            {flash && <div className={styles.flash}>{flash}</div>}
            {!openStructure ? (
              <p className={styles.note}>No saved fee structures yet. Start one with + New blank structure.</p>
            ) : (
              <FeeStructureEditor
                structure={openStructure}
                globalGmPct={globalGmPct}
                isStandard={openStructure.id === standardId}
                hasWorkbook={hasWorkbook}
                optionName={optionName}
                numYears={numYears}
                termMonths={termMonths}
                siteCount={siteCount}
                accountCount={accountCount}
                kwhCount={kwhCount}
                dthCount={dthCount}
                costs={items}
                feeNameSuggestions={[...new Set([...fees.map(f => f.name), ...items.map(i => i.feeName)].filter(Boolean))]}
                previewFeeRow={previewFeeRow}
                autoStartMonthFor={autoStartMonthFor}
                escalators={escalators}
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
          preview={previewOnOption(service.name, openStd ? openStd.filled : null)}
        />
      )}
    </div>
  );
}

const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
const marginOf = (fee, cost) => (fee > 0 ? (fee - cost) / fee : null);

// This service's fee against its cost on the option, with the picked fee
// structure in place (or the SIA setup when none is open).
function OptionPreview({ preview }) {
  if (!preview) return null;
  const { numYears, feeByYear, costByYear } = preview;
  const yearIdx = Array.from({ length: numYears }, (_, i) => i);
  const yearHeads = yearIdx.map(i => <th key={i} className={styles.num}>{`Y${i + 1}`}</th>);
  const money = (n) => (n ? fmtMoney(n) : '');
  const svcMargin = yearIdx.map(i => marginOf(feeByYear[i], costByYear[i]));
  const svcTermMargin = marginOf(sum(feeByYear), sum(costByYear));

  return (
    <section className={styles.section}>
      <div className={styles.previewLabel}>This service, fee against cost</div>
      <p className={styles.note}>Pass-through fees and costs are left out: they bill at cost and carry no margin.</p>
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

// A per-unit rate reads to the cent: $6.75 an account, not $7.
const fmtRate = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '');
const fmtWhole = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  : '');

// A card priced as a % of deal size, read against the service's share of
// the option's total CTS: the two percentages side by side, so the cut
// the card takes can be set against the cut of the cost this service is.
// Every cost is marked up the same, so the service's share of the cost is
// its share of the price. On a card that is nothing but a % of deal size,
// that share is the check: the deal size it waits on would only scale
// both sides. A card with other components keeps its own verdict, the
// share shown beside it. Shared by the Price check and the list's ! flag.
function rateVerdict(check, ctsShare = null) {
  const pctLines = (check.parts || []).flatMap(pt => pt.cardLines).filter(b => b.kind === 'percent');
  const pctShare = pctLines.length > 0 && typeof ctsShare === 'number' && Number.isFinite(ctsShare)
    ? (() => {
      const rates = pctLines.flatMap(b => [b.rate, b.rateHigh ?? b.rate]).map(Number).filter(Number.isFinite);
      if (rates.length === 0) return null;
      const lo = Math.min(...rates) / 100;
      const hi = Math.max(...rates) / 100;
      return { share: ctsShare, lo, hi, status: ctsShare < lo ? RATE_CHECK.BELOW : (ctsShare > hi ? RATE_CHECK.ABOVE : RATE_CHECK.WITHIN) };
    })()
    : null;
  const pctOnly = !!pctShare
    && (check.parts || []).every(pt => pt.cardLines.every(b => b.kind === 'percent'))
    && (check.missing || []).every(m => m.key === 'dealSize');
  return { pctShare, pctOnly, status: pctOnly ? pctShare.status : check.status };
}

// The share of the option's CTS a service's cost lines make up, less the
// lines left out of its price check.
function ctsShareOf(items, optionCtsTotal) {
  if (!(optionCtsTotal > 0)) return null;
  const counted = (items || []).reduce((s, it) => s + (!it.ignored && typeof it.cts === 'number' ? it.cts : 0), 0);
  return counted / optionCtsTotal;
}

// The service's first-year cost on the SIA, marked up, set against the
// price range its Dropdowns › Services Pricing rate card quotes.
function RateCheck({ check, ctsShare = null }) {
  // A card that is one per-unit rate is read per unit: cost and price over
  // the same count, against the rate itself.
  const pu = check.perUnit;
  const per = pu ? ` ${String(pu.basisLabel || `per ${pu.unitLabel || 'unit'}`).toLowerCase()}${pu.perMonth ? ' a month' : ''}` : '';
  // A card quoted per month is checked against a month's cost, not year 1's.
  const period = pu?.perMonth ? 'Monthly' : 'Year 1';
  const shown = pu
    ? { ...check, cost: pu.cost, price: pu.price, low: pu.rateLow, high: pu.rateHigh }
    : check;
  const fmt = pu ? fmtRate : fmtWhole;
  const pct = (n) => `${Math.round(n * 1000) / 10}%`;
  const deprNote = check.techDeprPct > 0 ? ` + ${pct(check.techDeprPct)} tech depr.` : '';
  const markupLabel = typeof check.margin === 'number'
    ? `At ${pct(check.margin)} margin${deprNote}`
    : `At each line's margin${deprNote}`;
  const range = shown.low == null ? '' : (fmt(shown.low) === fmt(shown.high)
    ? fmt(shown.low)
    : `${fmt(Math.min(shown.low, shown.high))} – ${fmt(Math.max(shown.low, shown.high))}`);

  // Which of the rate card's fee components the check reads (Dropdowns ›
  // Services Pricing): the one it is checked at when that is a single
  // component, else every component on the card, each with the part of the
  // fee model it prices.
  const components = (() => {
    const all = (check.parts || []).flatMap(pt => pt.cardLines.map(b => ({ label: b.basisLabel, part: pt.label, monthly: b.monthly })));
    const one = pu?.part ? all.filter(c => c.part === pu.part && (!pu.basisLabel || c.label === pu.basisLabel)) : all;
    const list = one.length ? one : all;
    const multiParts = new Set(all.map(c => c.part)).size > 1;
    return list.map(c => `${c.label}${c.monthly ? ', monthly' : ''}${multiParts || pu?.part ? ` (${c.part})` : ''}`).join(', ');
  })();

  const { pctShare, pctOnly, status } = rateVerdict(check, ctsShare);
  const [cls, label] = RATE_BADGE[status];
  const pctRange = pctShare
    ? (pct(pctShare.lo) === pct(pctShare.hi) ? pct(pctShare.lo) : `${pct(pctShare.lo)} – ${pct(pctShare.hi)}`)
    : '';
  const pctMeter = pctShare && (
    <RateMeter
      check={{ status: pctShare.status, low: pctShare.lo, high: pctShare.hi, price: pctShare.share, cost: null }}
      fmt={pct}
      zero="0%"
      priceName="Share of total CTS"
    />
  );

  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>
        Price check <span className={styles[cls]}>{label}</span>
      </h4>
      <div className={styles.rateGrid}>
        <span><span className={styles.factKey}>{pu?.perMonth || pu?.part === 'Ongoing' || !pu ? 'Cost' : 'Year 1 cost'}{per}{(pu?.part === 'Ongoing' && !pu.perMonth) || !pu ? ' a year' : ''}:</span> <span className={styles.rateFigure}>{fmt(shown.cost)}</span></span>
        <span><span className={styles.factKey}>{markupLabel}:</span> <span className={styles.rateFigure}>{fmt(shown.price)}{per}</span></span>
        {!pu && typeof check.year1Price === 'number' && Math.abs(check.year1Price - check.price) >= 0.5 && (
          <span
            className={styles.factKey}
            title="Ongoing lines are read over a full year (monthly x 12), the way the rate card quotes them. Year 1 is shorter when a line starts after month 1."
          >
            Year 1 only: {fmtWhole(check.year1Cost)} cost, {fmtWhole(check.year1Price)} priced
          </span>
        )}
        {components && (
          <span><span className={styles.factKey}>Fee component:</span> <span className={styles.rateFigure}>{components}</span></span>
        )}
        <span>
          <span className={styles.factKey}>Rate card{pu ? '' : ' range'}:</span>{' '}
          <span className={styles.rateFigure}>{check.noFee ? 'No fee' : (pctOnly ? `${pctRange} of deal size` : (check.status === RATE_CHECK.INCOMPLETE && !(check.high > 0) ? 'Unknown' : (range ? `${range}${per}` : 'not set')))}</span>
        </span>
        {pctOnly && (
          <span title="This service's Total CTS as a share of every cost line's CTS on the option. Every cost is marked up the same, so it is also the service's share of the price.">
            <span className={styles.factKey}>Share of total CTS:</span>{' '}
            <span className={styles.rateFigure}>{pct(pctShare.share)}</span>
          </span>
        )}
        {pctShare && !pctOnly && (
          <span title="This service's Total CTS as a share of every cost line's CTS on the option, set against the % of deal size range on its rate card.">
            <span className={styles.factKey}>Share of total CTS:</span>{' '}
            <span className={styles.rateFigure}>{pct(pctShare.share)}</span>{' '}
            <span className={styles.factKey}>vs rate card</span>{' '}
            <span className={styles.rateFigure}>{pctRange}</span>{' '}
            <span className={styles[RATE_BADGE[pctShare.status][0]]}>{RATE_BADGE[pctShare.status][1]}</span>
          </span>
        )}
      </div>
      {pu && (
        <p className={styles.note}>
          {pu.part && !pu.perMonth ? `${pu.part} cost for a year` : `${period} cost`} of {fmtWhole(pu.totalCost ?? check.cost)}, priced at {fmtWhole(pu.totalPrice ?? check.price)}, over {pu.units.toLocaleString('en-US')} {String(pu.unitLabel || 'units').toLowerCase()}.
          {check.leftOut?.length > 0 && ` Also on the rate card but not in this check, the SIA having no cost for it: ${check.leftOut.map(b => `${b.basisLabel} (${fmtMoneyRange(b.fee, b.feeHigh)})`).join(', ')}.`}
        </p>
      )}
      {pctOnly ? pctMeter : (
        <>
          {componentMeters(check.parts) || <RateMeter check={shown} fmt={fmt} />}
          {pctShare && (
            <div className={styles.meterStack}>
              <div>
                <div className={styles.meterLabel}>% of deal size, against the share of total CTS</div>
                {pctMeter}
              </div>
            </div>
          )}
        </>
      )}
      <FeeComponents parts={check.parts} />
      <PassThroughLines lines={check.passThroughLines} />
      {pctOnly && (
        <p className={styles.note}>
          Priced as a % of deal size, so this service is checked on its share of the option's total CTS
          ({pct(pctShare.share)}). Every cost is marked up the same, so that is also its share of the price.
        </p>
      )}
      {!pctOnly && (check.status === RATE_CHECK.INCOMPLETE || check.status === RATE_CHECK.UNPRICED) && (
        <p className={styles.note}>
          {check.status === RATE_CHECK.INCOMPLETE
            ? `Part of this service's rate card is priced on ${check.missing.map(m => m.label.toLowerCase()).join(' and ')}, which the SIA doesn't carry, so the range ${check.high > 0 ? 'reads low and' : 'is unknown and'} isn't judged until it's filled in.`
            : (check.noFee
              ? 'This service is marked No Fee on Dropdowns › Services Pricing, so there is no range to check against.'
              : 'No rate set for this service on Dropdowns › Services Pricing, so there is no range to check against.')}
        </p>
      )}
    </section>
  );
}

// A card split into fee components gets a meter per component, each in
// that component's own terms (a per-unit rate is drawn per unit), in place
// of the one meter for the whole service. A part left whole draws its own
// meter beside them. Null when nothing on the card is split.
function componentMeters(parts = []) {
  if (!parts.some(pt => pt.components)) return null;
  const meters = [];
  const add = (key, label, row) => {
    if (!(row.lineCount > 0 || row.cost > 0) || row.low == null) return;
    const pu = row.perUnit;
    meters.push({
      key,
      label,
      fmt: pu ? fmtRate : fmtWhole,
      check: pu
        ? { status: row.status, low: pu.rateLow, high: pu.rateHigh, price: pu.price, cost: row.cost / pu.units / (pu.perMonth ? 12 : 1) }
        : { status: row.status, low: row.low, high: row.high, price: row.price, cost: row.cost },
    });
  };
  for (const pt of parts) {
    const split = pt.components;
    if (!split) {
      if (pt.cardLines.length) add(pt.key, pt.label, pt);
      continue;
    }
    for (const r of split.rows) if (!r.shared) add(r.id, `${pt.label}, ${r.card.basisLabel}`, r);
    if (split.shared) add(`${pt.key}:shared`, `${pt.label}, ${split.shared.labels.join(' + ')} together`, split.shared);
  }
  if (meters.length === 0) return null;
  return (
    <div className={styles.meterStack}>
      {meters.map(m => (
        <div key={m.key}>
          <div className={styles.meterLabel}>{m.label}</div>
          <RateMeter check={m.check} fmt={m.fmt} />
        </div>
      ))}
    </div>
  );
}

// Pass-through lines, one row each, under the rate card's components and
// never inside them: the card never priced them and they bill at cost. Each
// reads as a fixed fee or per account, as picked in the cost line table.
function PassThroughLines({ lines = [] }) {
  if (!lines.length) return null;
  const when = (l) => (l.annual ? ' a year' : ' one-time');
  return (
    <table className={styles.componentTable}>
      <thead>
        <tr>
          <th>Pass-through line</th>
          <th>Fee model</th>
          <th className={styles.num}>Billed at cost</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={l.id ?? i}>
            <td>
              {l.description}
              <div className={styles.subNote}>{l.partLabel}, pass-through</div>
            </td>
            <td>{PASS_THROUGH_MODELS.find(m => m.id === l.model)?.label}</td>
            <td className={styles.num}>
              {l.model === 'pass:per_account'
                ? (l.needsAccounts
                  ? <span className={styles.muted}>No account count on the SIA</span>
                  : (
                    <>
                      {fmtRate(l.perUnit)} per account{when(l)}
                      <div className={styles.subNote}>{fmtWhole(l.amount)}{when(l)} over {l.accounts.toLocaleString('en-US')} accounts</div>
                    </>
                  ))
                : <>{fmtWhole(l.amount)}{when(l)}</>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const fmtMoneyRange = (lo, hi) => (fmtWhole(lo) === fmtWhole(hi) ? fmtWhole(lo) : `${fmtWhole(Math.min(lo, hi))} – ${fmtWhole(Math.max(lo, hi))}`);

// The rate card's fee components (Dropdowns › Services Pricing), one row
// per part of the fee model, each against what the SIA's costs for that
// part price at. Shown when the card has more than one component, so the
// range above can be read back to the rates it is made of.
//
// A part the card prices on more than one component (Ongoing as a flat fee
// a year plus so much per account) gets a row per component, each checked
// on the cost lines picked for it in the cost line table above. Lines left
// on Auto are checked together against whichever components have none.
function FeeComponents({ parts = [] }) {
  const lines = parts.reduce((n, pt) => n + pt.cardLines.length, 0);
  if (lines < 2) return null;
  const month = (key, b) => (b.monthly ? ' a month' : (key === 'recurring' ? ' a year' : ''));
  const cardText = (key, b) => (b.kind === 'unit'
    ? `${fmtRateRange(b.rate, b.rateHigh ?? b.rate)} ${String(b.basisLabel || '').toLowerCase()}${month(key, b)}`
    : `${b.basisLabel}: ${fmtMoneyRange(b.fee, b.feeHigh ?? b.fee)}`);
  const badgeOf = (status) => {
    const badge = RATE_BADGE[status];
    return badge ? <span className={styles[badge[0]]}>{badge[1]}</span> : null;
  };
  const priced = (row, b) => (row.cost > 0
    ? (row.perUnit
      ? `${fmtRate(row.perUnit.price)} ${String(b?.basisLabel || '').toLowerCase()}${row.perUnit.perMonth ? ' a month' : ''}`
      : fmtWhole(row.price))
    : <span className={styles.muted}>No cost on the SIA</span>);
  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const anyShared = parts.some(pt => pt.components?.shared);

  return (
    <>
      <table className={styles.componentTable}>
        <thead>
          <tr>
            <th>Fee component</th>
            <th className={styles.num}>Rate card</th>
            <th className={styles.num}>SIA cost, priced</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {parts.flatMap(pt => {
            const split = pt.components;
            if (!split) {
              const card = pt.cardLines.length === 0
                ? <span className={styles.muted}>Not on the card</span>
                : pt.cardLines.map((b, i) => <div key={i}>{cardText(pt.key, b)}</div>);
              return [(
                <tr key={pt.key}>
                  <td>{pt.label}</td>
                  <td className={styles.num}>{card}</td>
                  <td className={styles.num}>{priced(pt, pt.cardLines[0])}</td>
                  <td>{badgeOf(pt.status)}</td>
                </tr>
              )];
            }
            const rows = split.rows.map(r => (
              <tr key={r.id}>
                <td>{pt.label}, {r.card.basisLabel}</td>
                <td className={styles.num}>{cardText(pt.key, r.card)}</td>
                <td className={styles.num}>
                  {r.shared
                    ? <span className={styles.muted}>Checked together below</span>
                    : (
                      <>
                        {priced(r, r.card)}
                        {(r.picked > 0 || r.auto > 0) && (
                          <div className={styles.subNote}>
                            {r.picked > 0 ? `${plural(r.picked, 'line')} picked` : `${plural(r.auto, 'line')} on Auto`}
                          </div>
                        )}
                      </>
                    )}
                </td>
                <td>{!r.shared && badgeOf(r.status)}</td>
              </tr>
            ));
            if (split.shared) {
              const sh = split.shared;
              rows.push(
                <tr key={`${pt.key}:shared`}>
                  <td>{pt.label}, {sh.labels.join(' + ')} together</td>
                  <td className={styles.num}>{fmtMoneyRange(sh.low, sh.high)}{pt.key === 'recurring' ? ' a year' : ''}</td>
                  <td className={styles.num}>
                    {priced(sh)}
                    <div className={styles.subNote}>{plural(sh.lineCount, 'line')} on Auto</div>
                  </td>
                  <td>{badgeOf(sh.status)}</td>
                </tr>,
              );
            }
            if (split.loose) {
              rows.push(
                <tr key={`${pt.key}:loose`}>
                  <td>{pt.label}, not picked</td>
                  <td className={styles.num}><span className={styles.muted}>Every component has its own lines</span></td>
                  <td className={styles.num}>
                    {fmtWhole(split.loose.price)}
                    <div className={styles.subNote}>{plural(split.loose.lineCount, 'line')} on Auto, in no component</div>
                  </td>
                  <td />
                </tr>,
              );
            }
            return rows;
          })}
        </tbody>
      </table>
      {anyShared && (
        <p className={styles.note}>
          Point each cost line at a fee in the fee structure (its unit picks the component), or pick a fee component
          in the column above, to check each component on its own.
        </p>
      )}
    </>
  );
}

const fmtRateRange = (lo, hi) => (fmtRate(lo) === fmtRate(hi) ? fmtRate(lo) : `${fmtRate(Math.min(lo, hi))} – ${fmtRate(Math.max(lo, hi))}`);

// The SIA's monthly electric and gas volumes, for a service priced on the
// energy it buys (Strategic Sourcing): each with the rate per kWh or per
// Dth per month that spreads all of the service's costs over it. A Per kWh
// or Per Dth fee in the fee structure below bills on the same volume, so
// its ★ standard fee is the rate for the cost lines pointed at it.
function EnergyVolume({ kwhCount, dthCount, rates }) {
  const rows = [
    { label: 'Electric', count: kwhCount, unit: 'kWh', rate: rates?.perKwh, feeUnit: 'Per kWh' },
    { label: 'Gas', count: dthCount, unit: 'Dth', rate: rates?.perDth, feeUnit: 'Per Dth' },
  ];
  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>Energy volume from the SIA, per month</h4>
      <table className={styles.table}>
        <thead>
          <tr>
            <th />
            <th className={styles.num}>Volume / month</th>
            <th className={styles.num}>Rate / month for all of this service&apos;s costs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.unit}>
              <td>{r.label}</td>
              <td className={styles.num}>
                {typeof r.count === 'number' ? `${r.count.toLocaleString('en-US')} ${r.unit}` : <span className={styles.muted}>Not on the SIA</span>}
              </td>
              <td className={styles.num}>
                {typeof r.rate === 'number' ? `${fmtFeePerUnit(r.rate, r.feeUnit)} per ${r.unit} per month` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.note}>
        The SIA&apos;s kWh and Dth are read as monthly amounts. Each rate spreads every cost line of this service over
        that volume alone, at the Global GM%, with setup and one-time costs rolled over the term. To split the costs
        between electric and gas, give the fee structure a Recurring (monthly) fee Per kWh and one Per Dth and point
        each cost line at one: the ★ standard fee on each is its rate per month.
      </p>
    </section>
  );
}

// Boxes for the counts the rate card needs and the SIA doesn't carry, plus
// any already typed so they can be changed or cleared. Saved on the option.
// Only the counts this service's own fee components price on are offered:
// a count typed for another service (sites w/ mandate for BBS) stays with
// the services whose card uses it.
//
// A count the SIA supplies (sites, accounts, and sites standing in for
// sites w/ mandate) shows as the box's grey placeholder: blank means the
// SIA's, and a typed number overrides it until "Use SIA" clears it.
// Shown in the Unit column of the cost line table, one count per line.
function CheckCounts({ missing = [], used = [], entered = {}, fromSia = {}, onSetCount }) {
  const fields = [...missing];
  const add = (key) => {
    if (!fields.some(f => f.key === key)) fields.push({ key, label: key === 'dealSize' ? 'Deal size' : unitLabelFor(key) });
  };
  for (const key of used) if (fromSia[key] != null) add(key);
  for (const key of Object.keys(entered)) if (used.includes(key)) add(key);
  if (fields.length === 0) return null;
  return (
    <div className={styles.countStack}>
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

// Where the marked-up price lands on a line from $0, with the rate card
// range shaded on it. Nothing to draw without a range above $0.
function RateMeter(props) {
  const { check } = props;
  if (check.low == null || check.price == null) return null;
  if (Math.max(check.low, check.high) <= 0) return null;
  return <RateMeterLine {...props} />;
}

// Lays the scale labels out left to right once their widths are known: each
// sits centred on its mark where there is room, else is pushed just clear of
// the one before it (and kept inside the line), so a range close to $0
// never prints on top of the $0.
function useNoOverlapLabels(scaleRef, deps) {
  useLayoutEffect(() => {
    const box = scaleRef.current;
    if (!box) return undefined;
    const place = () => {
      const width = box.clientWidth;
      const gap = 8;
      let right = -Infinity;
      for (const el of box.children) {
        el.style.transform = 'none';
        el.style.left = '0px';
        const w = el.offsetWidth;
        const want = el.dataset.anchor === 'start' ? 0 : (parseFloat(el.dataset.at) / 100) * width - w / 2;
        const left = Math.max(0, Math.min(width - w, Math.max(want, right + gap)));
        el.style.left = `${left}px`;
        right = left + w;
      }
    };
    place();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(place);
    ro.observe(box);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function RateMeterLine({ check, fmt = fmtWhole, zero = '$0', priceName = 'Marked-up price' }) {
  const scaleRef = useRef(null);
  const lo = Math.min(check.low, check.high);
  const hi = Math.max(check.low, check.high);
  const max = Math.max(hi, check.price) * 1.15;
  const at = (v) => Math.max(0, Math.min(100, (v / max) * 100));
  // Keep a centred label from running off either end.
  const labelAt = (v) => Math.max(6, Math.min(94, at(v)));
  const tone = check.status === RATE_CHECK.WITHIN ? styles.meterIn
    : (check.status === RATE_CHECK.BELOW || check.status === RATE_CHECK.ABOVE) ? styles.meterOut
      : styles.meterUnknown;
  const single = fmt(lo) === fmt(hi);
  // Two range labels closer than this share one, so they never overlap.
  const joined = single || at(hi) - at(lo) < 18;
  useNoOverlapLabels(scaleRef, [lo, hi, joined, single, zero, fmt]);
  const priceTip = check.cost == null ? `${priceName} ${fmt(check.price)}` : `${priceName} ${fmt(check.price)} (cost ${fmt(check.cost)})`;
  const rangeTip = single ? `Rate card: ${fmt(lo)}` : `Rate card range: ${fmt(lo)} – ${fmt(hi)}`;
  const track = (
    <div className={styles.meterTrack}>
      <div
        className={single ? styles.meterTick : styles.meterBand}
        style={single ? { left: `${at(lo)}%` } : { left: `${at(lo)}%`, width: `${at(hi) - at(lo)}%` }}
        title={rangeTip}
      />
      {check.cost != null && (
        <div className={styles.meterCost} style={{ left: `${at(check.cost)}%` }} title={`Cost ${fmt(check.cost)}`} />
      )}
      <div className={`${styles.meterDot} ${tone}`} style={{ left: `${at(check.price)}%` }} title={priceTip} />
    </div>
  );
  return (
    <div className={styles.meter} role="img" aria-label={`${priceTip}. ${rangeTip}.`}>
      <div className={styles.meterTop}>
        <span className={`${styles.meterPriceLabel} ${tone}`} style={{ left: `${labelAt(check.price)}%` }}>
          {fmt(check.price)}
        </span>
      </div>
      {track}
      <div className={styles.meterScale} ref={scaleRef}>
        <span className={styles.meterScaleLabel} data-anchor="start" style={{ left: 0, transform: 'none' }}>{zero}</span>
        {joined ? (
          <span className={styles.meterScaleLabel} data-at={at((lo + hi) / 2)} style={{ left: `${labelAt((lo + hi) / 2)}%` }}>
            {single ? `Rate card ${fmt(lo)}` : `${fmt(lo)} – ${fmt(hi)}`}
          </span>
        ) : (
          <>
            <span className={styles.meterScaleLabel} data-at={at(lo)} style={{ left: `${labelAt(lo)}%` }}>{fmt(lo)}</span>
            <span className={styles.meterScaleLabel} data-at={at(hi)} style={{ left: `${labelAt(hi)}%` }}>{fmt(hi)}</span>
          </>
        )}
      </div>
    </div>
  );
}

// One tab per saved structure (the standard one starred), and the button
// that starts a new one.
function FeeStructureTabs({ structures, standardId, view, setView, onAdd }) {
  return (
    <div className={styles.structTabs}>
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
const fmtPlain = (n) => (typeof n === 'number' && Number.isFinite(n)
  ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '');

// One saved structure, editable. Blank Fee / Unit Count / Start Month /
// GM% cells derive, and the placeholder shows what they derive to on the
// loaded SIA, the same way the Alternative Fee schedule reads.
function FeeStructureEditor({
  structure, globalGmPct, isStandard, hasWorkbook, optionName, numYears, termMonths = 36, siteCount, accountCount, kwhCount, dthCount, costs = [],
  feeNameSuggestions, previewFeeRow, autoStartMonthFor, escalators = {}, onChange, onMakeStandard, onDuplicate, onDelete, onApply,
}) {
  const listId = `fs-names-${structure.id}`;
  const rows = structure.rows || [];
  const setRow = (idx, patch) => onChange(st => {
    const next = { ...st, rows: st.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)) };
    // Renaming a fee keeps every cost it covers (picked, or matched by
    // the old name) on it. A cost that only fell to it for want of a row
    // with its own fee name keeps falling the same way, so it isn't pinned.
    const before = String(st.rows[idx]?.feeName || '').trim().toLowerCase();
    const after = String(patch.feeName ?? '').trim().toLowerCase();
    if ('feeName' in patch && before && after && before !== after) {
      const alloc = { ...(st.allocations || {}) };
      for (const co of std.costs) {
        if (co.rowIdx === idx && !co.fellBack) alloc[co.key] = { ...(allocationFor(alloc, co.key) || {}), fee: after };
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
  const { std, standardFee, billed } = standardFeeContext(structure, costs, { termMonths, siteCount, accountCount, kwhCount, dthCount, startMonthFor: autoStartMonthFor, ...escalators });
  // A fee starting after a monthly cost it covers catches up the months it
  // missed, so the term still recovers the cost.
  const catchUpNote = (idx) => {
    const missed = Math.max(0, ...(std.perRow[idx]?.costIdx || []).map(ci => std.costs[ci]?.catchUpMonths || 0));
    if (!missed) return '';
    const start = std.perRow[idx].startMonth;
    return ` It starts in month ${start}, after ${missed === 1 ? 'a cost it covers' : 'costs it covers'}, so it is raised to catch up the ${missed === 1 ? 'month' : `${missed} months`} before then over the ${std.perRow[idx].rollMonths} months it bills.`;
  };
  const previews = rows.map((r, idx) => (previewFeeRow && hasWorkbook ? previewFeeRow(billed(r, idx), { siteCount, accountCount, kwhCount, dthCount }) : null));
  // Pass-through lines with no fee row of their own yet, billed per account
  // or as a fixed fee as picked in the price check.
  const passOpts = { unitOf: (it) => (passThroughModelOf(it) === 'pass:per_account' ? 'Per Account' : 'Fixed') };
  const passToAdd = passThroughFeeRows(structure, costs, passOpts).length;
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
        <button
          type="button"
          className={styles.barBtn}
          onClick={() => onChange(st => ({ ...st, rows: [...(st.rows || []), blankFeeStructureRow()] }))}
          title="Add a blank fee row to this structure."
        >
          + Add fee
        </button>
        {passToAdd > 0 && (
          <button
            type="button"
            className={styles.barBtn}
            onClick={() => onChange(st => addPassThroughFees(st, costs, passOpts))}
            title="Add a fee row for each pass-through cost line that has none: ticked Pass so it bills at cost, per account or as a fixed fee as picked in the price check, and that cost pointed at it."
          >
            + Add pass-through fees ({passToAdd})
          </button>
        )}
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
      <datalist id={listId}>
        {feeNameSuggestions.map(n => <option key={n} value={n} />)}
      </datalist>
      <p className={styles.note}>
        Blank fees are priced from the service&apos;s costs at the Global GM%
        {typeof globalGmPct === 'number' ? ` (${fmtPct(globalGmPct)})` : ''} at the top of the page, so they move with it. A monthly
        fee also allows for the Escalator and Cost Esc., so it lands on that margin over the whole term.
      </p>
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
                    value={typeof r.fee === 'number' ? fmtFeePerUnit(r.fee, r.unit, { currency: false }) : ''}
                    placeholder={standardFee(idx) != null ? fmtFeePerUnit(standardFee(idx), r.unit, { currency: false }) : (p?.autoFee != null ? fmtFeePerUnit(p.autoFee, r.unit, { currency: false }) : 'auto')}
                    align="right"
                    width={80}
                    onCommit={(v) => {
                      const n = parseMoney(v);
                      if (n === undefined) return;
                      setRow(idx, { fee: n });
                    }}
                  />
                  {standardFee(idx) != null && (
                    <div
                      className={typeof r.fee === 'number' && Math.abs(r.fee - standardFee(idx)) > 0.005 ? styles.stdFeeOff : styles.stdFee}
                      title={`Standard fee: recovers the ${std.perRow[idx].costIdx.length} cost line${std.perRow[idx].costIdx.length === 1 ? '' : 's'} this fee covers at their marked-up price (the Global GM% at the top of the page).${catchUpNote(idx)}${typeof r.fee === 'number' ? '' : ' The blank cell bills it.'}`}
                    >
                      ★ {fmtFeePerUnit(standardFee(idx), r.unit)}
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
                    width={isUsageUnit(r.unit) ? 84 : 56}
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
            <tr><td colSpan={hasWorkbook ? 9 + numYears : 9} className={styles.muted}>No fees yet.</td></tr>
          )}
        </tbody>
        {hasWorkbook && rows.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={7}>Total</td>
              {totals.map((t, i) => <td key={i} className={styles.num}>{t > 0 ? fmtMoney(t) : ''}</td>)}
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
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
              onClick={() => onChange(st => addLaterCostFees(st, feeStructureCostInputs(costs), { termMonths, siteCount, accountCount, kwhCount, dthCount, startMonthFor: autoStartMonthFor, ...escalators }))}
              title="Add a fee row per start month for these costs, starting the month they do, and point them at it. Its standard fee recovers exactly them."
            >
              + Add standard fee for costs after month {FIRST_YEAR_MONTHS}
            </button>
          </div>
        );
      })()}
    </div>
  );
}
