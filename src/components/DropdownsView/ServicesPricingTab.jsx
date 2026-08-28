import { useMemo, useRef, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import {
  PRICING_BASES,
  PRICING_UNITS,
  basisFor,
  estimateScope,
  formatMoney,
  getServicePricing,
  parseMoney,
  pricingFor,
  setPricingField,
} from '../../utils/servicePricing';
import styles from './DropdownsView.module.css';

// Where this table's column widths, order and visibility are remembered,
// alongside every other table's under settings.tablePrefs.
const PRICING_TABLE_ID = 'dropdowns-service-pricing';

const PRICING_TABLE_COLUMNS = [
  { key: 'scope',        label: 'In Scope',           width: 78 },
  { key: 'name',         label: 'Service',            width: 280 },
  { key: 'serviceBucket',label: 'Service Bucket',     width: 200 },
  { key: 'serviceType',  label: 'Type',               width: 100 },
  { key: 'years',        label: 'Years',              width: 80 },
  { key: 'basisLabel',   label: 'Pricing Basis',      width: 150 },
  // Holds dollars or a percentage depending on the basis, so the header
  // names both rather than picking one and lying about half the rows.
  { key: 'rate',         label: 'Rate ($ or %)',      width: 130 },
  { key: 'minFee',       label: 'Min Fee ($)',        width: 110 },
  { key: 'units',        label: 'Units',              width: 80 },
  // The two estimate columns are the scenario in the bar above applied to
  // this one row: the fee it earns, and what that comes to over the term.
  { key: 'fee',          label: 'Est. Fee',           width: 120 },
  { key: 'value',        label: 'Est. Deal Value',    width: 140 },
  { key: 'notes',        label: 'Pricing Notes',      width: 260 },
];

// Every cell in this table edits something, so no click inside one should
// reach the row underneath it.
const swallow = (e) => e.stopPropagation();

// A number cell that shows a formatted figure and edits as a bare number.
// Commits on blur / Enter, cancels on Escape, and only writes when the value
// actually changed — clicking in and back out again can't blank a rate.
function NumberCell({ value, display, placeholder, step = '1', title, onCommit }) {
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const editing = draft !== null;
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const initial = value === null || value === undefined ? '' : String(value);

  function commit() {
    const typed = (draft ?? '').trim();
    setDraft(null);
    if (typed === initial) return;
    if (typed === '') { onCommit(''); return; }
    const n = parseMoney(typed);
    // Not a number: leave what's stored alone rather than clearing it.
    if (n === null || n < 0) return;
    onCommit(n);
  }

  if (!editing) {
    return (
      <span
        onClick={(e) => { swallow(e); setDraft(initial); }}
        title={title}
        style={{ display: 'inline-block', width: '100%', cursor: 'text', minHeight: '1em' }}
      >
        {display || <span className={styles.serviceMutedCell}>-</span>}
      </span>
    );
  }
  return (
    <input
      ref={inputRef}
      type="number"
      min="0"
      step={step}
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      onClick={swallow}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
      }}
      style={{
        width: '100%', padding: '3px 6px',
        border: '1px solid var(--color-accent)', borderRadius: 4,
        fontSize: '0.75rem', fontFamily: 'inherit',
        background: '#fff', color: 'var(--color-text)', boxSizing: 'border-box',
      }}
    />
  );
}

// Free-text cell for the pricing notes — the assumptions behind a number,
// which is the part a rate on its own always loses.
function NotesCell({ value, onCommit }) {
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const editing = draft !== null;
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commit() {
    const trimmed = (draft ?? '').trim();
    setDraft(null);
    if (trimmed === (value || '')) return;
    onCommit(trimmed);
  }

  if (!editing) {
    return (
      <span
        onClick={(e) => { swallow(e); setDraft(value || ''); }}
        title={value || 'Click to add a note'}
        style={{ display: 'inline-block', width: '100%', cursor: 'text', minHeight: '1em' }}
      >
        {value || <span className={styles.serviceMutedCell}>-</span>}
      </span>
    );
  }
  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onClick={swallow}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
      }}
      style={{
        width: '100%', padding: '3px 6px',
        border: '1px solid var(--color-accent)', borderRadius: 4,
        fontSize: '0.75rem', fontFamily: 'inherit',
        background: '#fff', color: 'var(--color-text)', boxSizing: 'border-box',
      }}
    />
  );
}

// Which of the pricing bases a service is charged on. Clearing it takes the
// rate and floor with it (see setPricingField) — a rate with no basis has
// nothing to multiply.
function BasisCell({ value, onCommit }) {
  return (
    <select
      value={value || ''}
      onClick={swallow}
      onChange={(e) => { if (e.target.value !== (value || '')) onCommit(e.target.value); }}
      title="How this service is priced"
      style={{
        width: '100%', padding: '3px 4px',
        border: '1px solid transparent', borderRadius: 4,
        fontSize: '0.75rem', fontFamily: 'inherit',
        background: 'transparent', color: 'var(--color-text)',
        cursor: 'pointer', boxSizing: 'border-box',
      }}
    >
      <option value="">-</option>
      {PRICING_BASES.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
    </select>
  );
}

// One count box in the estimator bar. Held as text while the user types so a
// half-typed number doesn't re-run the whole estimate on every keystroke as
// a different figure; commits on blur / Enter.
function CountInput({ label, value, onCommit, placeholder, wide }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null ? draft : (value === '' || value == null ? '' : String(value));
  function commit() {
    if (draft === null) return;
    const typed = draft.trim();
    setDraft(null);
    onCommit(typed === '' ? '' : (parseMoney(typed) ?? ''));
  }
  return (
    <label className={styles.pricingField}>
      <span className={styles.pricingFieldLabel}>{label}</span>
      <input
        type="number"
        min="0"
        inputMode="decimal"
        className={wide ? styles.pricingInputWide : styles.pricingInput}
        placeholder={placeholder || '0'}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); e.currentTarget.blur(); }
        }}
      />
    </label>
  );
}

// Dropdowns › Services Pricing. A rate card over exactly the services the
// Services subtab lists — the rows come from the same Solutions list, so a
// service added, renamed or retired there is added, renamed or retired here
// without a second edit — plus the estimator that rate card exists for: tick
// what's in scope, say how many sites / accounts / meters the account has,
// and read the deal off the bar.
//
// `scenario` (what's in scope, the counts, the deal size) is held by the
// parent rather than here so switching subtabs and coming back doesn't lose
// a half-built estimate. It's a scratch calculation, so it isn't saved — the
// rate card is the part worth keeping, and that's in settings.
export function ServicesPricingTab({ settings, updateSettings, serviceRows = [], scenario, setScenario }) {
  const [search, setSearch] = useState('');

  const pricing = useMemo(() => getServicePricing(settings), [settings?.servicePricing]);

  const inScope = useMemo(
    () => new Set(Array.isArray(scenario?.services) ? scenario.services : []),
    [scenario?.services],
  );
  // Memoized rather than a bare `|| {}`: a fresh empty object each render
  // would re-run every estimate below on any keystroke on the page.
  const counts = useMemo(() => scenario?.counts || {}, [scenario?.counts]);
  const dealSize = scenario?.dealSize ?? '';

  function savePricingField(name, field, value) {
    updateSettings?.({ servicePricing: setPricingField(pricing, name, field, value) });
  }

  function toggleScope(name) {
    const next = new Set(inScope);
    if (next.has(name)) next.delete(name); else next.add(name);
    setScenario(s => ({ ...s, services: [...next] }));
  }
  function setCount(unit, value) {
    setScenario(s => ({ ...s, counts: { ...(s?.counts || {}), [unit]: value } }));
  }

  // The estimate for every service, in scope or not — the two Est. columns
  // show what a service would add if it were ticked, which is what makes the
  // table itself answer "what would adding this cost?".
  const allEstimates = useMemo(() => {
    const { lines } = estimateScope({
      rows: serviceRows,
      services: serviceRows.map(r => r.name),
      pricing, counts, dealSize,
    });
    return new Map(lines.map(l => [l.name, l]));
  }, [serviceRows, pricing, counts, dealSize]);

  // The deal itself: only what's ticked.
  const totals = useMemo(
    () => estimateScope({ rows: serviceRows, services: [...inScope], pricing, counts, dealSize }),
    [serviceRows, inScope, pricing, counts, dealSize],
  );

  // Count boxes are shown for the units the scope actually needs, so the bar
  // asks for meters on a bill-pay deal and not on a reporting one. A unit
  // that already has a number keeps its box even after the service that
  // wanted it is un-ticked — otherwise a typed figure would vanish.
  const visibleUnits = useMemo(() => PRICING_UNITS.filter(u =>
    totals.unitsUsed.has(u.unit) || (counts?.[u.unit] !== '' && counts?.[u.unit] != null)
  ), [totals.unitsUsed, counts]);

  const pricedCount = useMemo(
    () => serviceRows.filter(r => pricingFor(pricing, r.name).basis).length,
    [serviceRows, pricing],
  );

  const term = search.trim().toLowerCase();
  const rows = useMemo(() => serviceRows
    .map(({ name, meta, bucket }) => {
      const entry = pricingFor(pricing, name);
      const basis = basisFor(entry.basis);
      const est = allEstimates.get(name);
      return {
        id: name,
        name,
        serviceBucket: bucket,
        serviceType: meta?.serviceType || '',
        years: meta?.years || '',
        basis: entry.basis,
        basisLabel: basis?.label || '',
        rate: entry.rate,
        minFee: entry.minFee,
        notes: entry.notes,
        units: est?.units ?? null,
        fee: est?.priced ? est.fee : null,
        value: est?.priced ? est.value : null,
        _kind: basis?.kind || '',
        _note: est?.note || '',
        _scoped: inScope.has(name),
      };
    })
    .filter(r => !term || [r.name, r.serviceBucket, r.basisLabel, r.notes].some(v => String(v).toLowerCase().includes(term))),
  [serviceRows, pricing, allEstimates, inScope, term]);

  const columns = PRICING_TABLE_COLUMNS.map(col => {
    const base = { key: col.key, label: col.label, defaultWidth: col.width };
    switch (col.key) {
      case 'scope':
        return {
          ...base,
          getSortValue: (row) => (row._scoped ? 0 : 1),
          render: (row) => (
            <input
              type="checkbox"
              checked={row._scoped}
              onClick={swallow}
              onChange={() => toggleScope(row.name)}
              title={`Include "${row.name}" in the deal estimate above`}
              aria-label={`${row.name} in scope`}
              style={{ cursor: 'pointer' }}
            />
          ),
        };
      case 'basisLabel':
        return { ...base, render: (row) => <BasisCell value={row.basis} onCommit={(v) => savePricingField(row.name, 'basis', v)} /> };
      case 'rate':
        return {
          ...base,
          getSortValue: (row) => row.rate,
          render: (row) => (
            <NumberCell
              value={row.rate}
              display={row.rate === null ? '' : (row._kind === 'percent' ? `${row.rate}%` : formatMoney(row.rate))}
              placeholder={row._kind === 'percent' ? '%' : '$'}
              step="0.01"
              title={row.basis
                ? (row._kind === 'percent' ? 'Percentage of the deal size' : `Dollars — ${row.basisLabel.toLowerCase()}`)
                : 'Pick a pricing basis first'}
              onCommit={(v) => savePricingField(row.name, 'rate', v)}
            />
          ),
        };
      case 'minFee':
        return {
          ...base,
          getSortValue: (row) => row.minFee,
          render: (row) => (
            <NumberCell
              value={row.minFee}
              display={formatMoney(row.minFee)}
              placeholder="$"
              step="100"
              title="Floor: the fee never comes out below this once the service is in scope"
              onCommit={(v) => savePricingField(row.name, 'minFee', v)}
            />
          ),
        };
      case 'notes':
        return { ...base, render: (row) => <NotesCell value={row.notes} onCommit={(v) => savePricingField(row.name, 'notes', v)} /> };
      case 'units':
        return {
          ...base,
          getSortValue: (row) => row.units,
          render: (row) => (row.units === null
            ? <span className={styles.serviceMutedCell}>-</span>
            : row.units.toLocaleString('en-US')),
        };
      case 'fee':
      case 'value':
        return {
          ...base,
          getSortValue: (row) => row[col.key],
          render: (row) => (row[col.key] === null
            ? <span className={styles.serviceMutedCell} title={row._note || 'Not priced yet'}>-</span>
            : (
              <span
                className={row._scoped ? styles.pricingEstScoped : undefined}
                title={row._note || undefined}
              >{formatMoney(row[col.key])}</span>
            )),
        };
      default:
        return { ...base, render: (row) => (row[col.key] || <span className={styles.serviceMutedCell}>-</span>) };
    }
  });

  return (
    <>
      <div className={styles.searchRow}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search services, buckets, pricing notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className={styles.resultCount}>
          {term ? `${rows.length} of ${serviceRows.length} services` : `${serviceRows.length} services`}
          {` · ${pricedCount} priced`}
        </span>
      </div>

      {/* The estimator. Everything in it is a scenario rather than saved
          data, so it reads left to right as one sentence: this many sites,
          on a deal this big, with these services ticked, comes to this. */}
      <div className={styles.pricingBar}>
        <div className={styles.pricingInputs}>
          <span className={styles.pricingBarTitle}>Deal estimate</span>
          {visibleUnits.map(u => (
            <CountInput
              key={u.unit}
              label={u.label}
              value={counts?.[u.unit] ?? ''}
              onCommit={(v) => setCount(u.unit, v)}
            />
          ))}
          {/* Seven digits in a bare number box are easy to misread by a
              factor of ten, and every percentage-based fee is a cut of this
              one figure — so the label reads it back formatted. */}
          <CountInput
            label={dealSize === '' || dealSize == null ? 'Deal size ($)' : `Deal size · ${formatMoney(dealSize)}`}
            wide
            placeholder="for % fees"
            value={dealSize}
            onCommit={(v) => setScenario(s => ({ ...s, dealSize: v }))}
          />
          {inScope.size > 0 && (
            <button
              type="button"
              className={styles.showHiddenBtn}
              onClick={() => setScenario(s => ({ ...s, services: [] }))}
              title="Untick every service"
            >Clear scope</button>
          )}
        </div>

        <div className={styles.pricingTotals}>
          <div className={styles.pricingTotal}>
            <span className={styles.pricingTotalLabel}>Services in scope</span>
            <span className={styles.pricingTotalValue}>{inScope.size}</span>
          </div>
          <div className={styles.pricingTotal}>
            <span className={styles.pricingTotalLabel}>Recurring / year</span>
            <span className={styles.pricingTotalValue}>{formatMoney(totals.recurringAnnual) || '$0'}</span>
          </div>
          <div className={styles.pricingTotal}>
            <span className={styles.pricingTotalLabel}>One-off projects</span>
            <span className={styles.pricingTotalValue}>{formatMoney(totals.oneTime) || '$0'}</span>
          </div>
          <div className={styles.pricingTotalMain}>
            <span className={styles.pricingTotalLabel}>Estimated deal size</span>
            <span className={styles.pricingTotalValueMain}>{formatMoney(totals.contractValue) || '$0'}</span>
          </div>
        </div>
      </div>

      {/* Said once, under the numbers, rather than as a footnote on every
          row: a service nobody has priced contributes nothing, so the total
          is short by however many of them are ticked. */}
      {totals.unpriced.length > 0 && (
        <div className={styles.pricingWarn}>
          Not counted — no pricing basis or rate set yet: {totals.unpriced.join(', ')}
        </div>
      )}

      <div className={styles.serviceTableWrap}>
        <DataTable
          tableId={PRICING_TABLE_ID}
          columns={columns}
          rows={rows}
          alwaysVisible={['scope', 'name']}
          rowClassName={(row) => (row._scoped ? styles.pricingRowScoped : undefined)}
          exportFileName="Services Pricing"
          settings={settings}
          updateSettings={updateSettings}
          emptyMessage={serviceRows.length === 0
            ? 'The Solutions dropdown list is empty. Add services on the Services subtab and they show up here.'
            : `No services match "${search}".`}
        />
      </div>
    </>
  );
}
