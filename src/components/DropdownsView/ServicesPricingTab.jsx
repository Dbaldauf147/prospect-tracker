import { useMemo, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { PricingBasesModal } from './PricingBasesModal';
import { SetupFeeModal } from './SetupFeeModal';
import { ServicePricingModal } from './ServicePricingModal';
import { BasisCell, NotesCell, NumberCell } from './pricingCells';
import {
  PRICING_BASES,
  basisFor,
  basisUsage,
  estimateScope,
  formatMoney,
  formatRate,
  getServicePricing,
  parseMoney,
  pricingFor,
  resolvePricingBases,
  pricingBasesTopUp,
  PRICING_BASES_VERSION,
  setPricingField,
  setPricingLine,
  setPricingSetup,
} from '../../utils/servicePricing';
import styles from './DropdownsView.module.css';

// Where this table's column widths, order and visibility are remembered,
// alongside every other table's under settings.tablePrefs.
const PRICING_TABLE_ID = 'dropdowns-service-pricing';

const PRICING_TABLE_COLUMNS = [
  { key: 'name',         label: 'Service',            width: 280 },
  { key: 'serviceBucket',label: 'Service Bucket',     width: 200 },
  { key: 'serviceType',  label: 'Type',               width: 100 },
  { key: 'years',        label: 'Years',              width: 80 },
  { key: 'basisLabel',   label: 'Pricing Basis',      width: 150 },
  // Holds dollars or a percentage depending on the basis, and what it earns
  // is the service's ongoing fee — annual on a recurring service, the job on
  // a project. Two of them: a service quoted as a spread ("$450 to $600 a
  // site") prices to a range, and one left blank prices to a single figure
  // exactly as it did before there was a second column. The low one keeps
  // the `rate` key, so every rate already on the card is already in it.
  { key: 'rate',         label: 'Low Annual Recurring Fee',  width: 175 },
  { key: 'rateHigh',     label: 'High Annual Recurring Fee', width: 175 },
  { key: 'notes',        label: 'Pricing Notes',      width: 260 },
];

// The setup fee, the minimum fee and a fee typed outright are all on the
// card too, but not as columns: three more of them pushed the notes off the
// right edge, and none of the three is a figure you scan a hundred and fifty
// rows of — they are set once per service, when the service is being priced.
// They live in the pricing panel behind the ⤢ instead, which is where every
// other field that answers "what is this one service worth" already is.

// Dropdowns › Services Pricing. The rate card over exactly the services the
// Services subtab lists — the rows come from the same Solutions list, so a
// service added, renamed or retired there is added, renamed or retired here
// without a second edit.
//
// Everything on this tab is the standing price of a service: the basis it is
// charged on, the rate, the floor, what it costs to stand up, and the notes
// behind those. An edit here reaches every deal priced off the service. The
// deal itself — what's in scope, how many sites the account has, what the
// scope comes to — is the Deal Pricing subtab, so the two questions aren't
// answered in the same table.
//
// `scenario` is that estimate, passed in read-only: the service panel shows
// what each rate comes to under it, which is the arithmetic that makes a
// rate checkable. Nothing on this tab writes to it.
export function ServicesPricingTab({ settings, updateSettings, serviceRows = [], scenario }) {
  const [search, setSearch] = useState('');

  const pricing = useMemo(() => getServicePricing(settings), [settings?.servicePricing]);
  // The Pricing Basis vocabulary in force: the edited list when there is
  // one, the built-in eight otherwise. Everything below prices against
  // this, so a basis someone added behaves exactly like one that shipped.
  const bases = useMemo(() => resolvePricingBases(settings), [settings?.pricingBases]);
  const [basesOpen, setBasesOpen] = useState(false);

  // Saving the list back: an edit that lands on the built-in list clears
  // the override instead of storing a copy of it, so a later change to the
  // defaults still reaches anyone who only ever reset.
  function saveBases(next) {
    const same = JSON.stringify(next) === JSON.stringify(PRICING_BASES);
    // Stamped with the version saved against, so a basis added to the
    // built-in list later can tell "never offered it" from "took it out".
    updateSettings?.({ pricingBases: same ? null : next, pricingBasesVersion: PRICING_BASES_VERSION });
    setBasesOpen(false);
  }

  // A saved list from before a basis existed doesn't know about it, and the
  // only way to pick one up by hand is Reset to defaults — which throws
  // away whatever the user added. So the new ones are appended once, and
  // the stamped version stops it happening again (or undoing a delete).
  useEffect(() => {
    const patch = pricingBasesTopUp(settings);
    if (patch) updateSettings?.(patch);
  }, [settings?.pricingBases, settings?.pricingBasesVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // The estimate open on the Deal Pricing subtab, read only so the service
  // panel can show what a rate comes to under it. Memoized rather than a
  // bare `|| {}`: a fresh empty object each render would re-run every
  // estimate below on any keystroke in the search box.
  const inScope = useMemo(
    () => new Set(Array.isArray(scenario?.services) ? scenario.services : []),
    [scenario?.services],
  );
  const counts = useMemo(() => scenario?.counts || {}, [scenario?.counts]);
  const serviceUnits = useMemo(() => scenario?.serviceUnits || {}, [scenario?.serviceUnits]);
  const dealSize = scenario?.dealSize ?? '';

  function savePricingField(name, field, value) {
    updateSettings?.({ servicePricing: setPricingField(pricing, name, field, value, bases) });
  }

  // One row of the fee breakdown: the low and/or high rate this service is
  // charged on one basis. The first one filled in becomes the service's
  // headline basis, which is what the rate card's own columns show.
  function savePricingLine(name, basisKey, patch) {
    updateSettings?.({ servicePricing: setPricingLine(pricing, name, basisKey, patch, bases) });
  }

  // The service whose pricing panel is open, by name. Null when nothing is
  // open. Clicking a row opens it: the table is eleven columns wide, so
  // pricing one service otherwise means scrolling sideways with the name
  // off the left edge.
  const [pricingPanelFor, setPricingPanelFor] = useState(null);

  // The service whose setup fee is open in the panel, by name. Null when
  // the panel is closed, which is nearly always.
  const [setupFor, setSetupFor] = useState(null);
  function saveSetup(name, components) {
    updateSettings?.({ servicePricing: setPricingSetup(pricing, name, components, bases) });
    setSetupFor(null);
  }

  // What every service comes to under the estimate on the Deal Pricing
  // subtab. Nothing in the table shows these — they are one deal's numbers
  // and the table is the card — but the service panel does, because a rate
  // with no arithmetic under it can't be checked.
  const allEstimates = useMemo(() => {
    const { lines } = estimateScope({
      rows: serviceRows,
      services: serviceRows.map(r => r.name),
      pricing, counts, dealSize, bases, serviceUnits,
    });
    return new Map(lines.map(l => [l.name, l]));
  }, [serviceRows, pricing, counts, dealSize, bases, serviceUnits]);

  // Priced = there's a figure behind it, however it got there: a basis to
  // work one out, or a fee typed straight into the service's Typed fee box.
  const pricedCount = useMemo(
    () => serviceRows.filter(r => {
      const entry = pricingFor(pricing, r.name, bases);
      return !!entry.basis || entry.avgFee !== null;
    }).length,
    [serviceRows, pricing, bases],
  );

  const term = search.trim().toLowerCase();
  // Every service as a table row, before the search box has its say. The
  // panels open a service by name and stay open while the user types behind
  // them, so they read from this rather than from the filtered list.
  const allRows = useMemo(() => serviceRows
    .map(({ name, meta, bucket }) => {
      const entry = pricingFor(pricing, name, bases);
      const basis = basisFor(entry.basis, bases);
      const est = allEstimates.get(name);
      const ownUnits = parseMoney(serviceUnits[name]);
      return {
        id: name,
        name,
        serviceBucket: bucket,
        serviceType: meta?.serviceType || '',
        years: meta?.years || '',
        basis: entry.basis,
        basisLabel: basis?.label || '',
        rate: entry.rate,
        rateHigh: entry.rateHigh,
        minFee: entry.minFee,
        // The fee typed outright against this service, as stored. The
        // column shows the card's own figure rather than what any deal
        // works out to: this is the card.
        avgFee: entry.avgFee,
        // The components as stored, and what they come to under the
        // estimate on the Deal Pricing subtab — the panel shows the second,
        // the table's cell shows the first.
        setup: entry.setup,
        _setupFee: est?.setup ?? 0,
        // Every basis this service is charged on and what each comes to, so
        // the pricing panel can show the fee as the sum of its lines rather
        // than as one number with a single basis behind it.
        _breakdown: est?.breakdown || [],
        _recurringFee: est?.priced ? est.recurringFee : null,
        _recurringFeeHigh: est?.priced ? est.recurringFeeHigh : null,
        _extraLines: entry.lines.length,
        notes: entry.notes,
        // What the panel prices against: the deal's own figure for this
        // service first, then the card's standing one, then the shared
        // count the estimate carries.
        units: ownUnits !== null ? ownUnits : (entry.units !== null ? entry.units : (est?.units ?? null)),
        _unitsTyped: ownUnits !== null || entry.units !== null,
        _unitsOwn: ownUnits !== null,
        _unit: basis?.unit || null,
        _unitLabel: basis?.unitLabel || '',
        fee: est?.priced ? est.fee : null,
        feeHigh: est?.priced ? est.feeHigh : null,
        _kind: basis?.kind || '',
        _note: est?.note || '',
        _typed: !!est?.typed,
        _scoped: inScope.has(name),
      };
    }),
  [serviceRows, pricing, bases, allEstimates, inScope, serviceUnits]);

  const rows = useMemo(
    () => (term
      ? allRows.filter(r => [r.name, r.serviceBucket, r.basisLabel, r.notes]
        .some(v => String(v).toLowerCase().includes(term)))
      : allRows),
    [allRows, term],
  );

  const columns = PRICING_TABLE_COLUMNS.map(col => {
    const base = { key: col.key, label: col.label, defaultWidth: col.width };
    switch (col.key) {
      // The name carries the button that opens the service's pricing panel.
      // Every other cell in the row is an editor that swallows its own
      // click, so without an affordance of its own the row click is
      // something you'd have to find by accident.
      case 'name':
        return {
          ...base,
          render: (row) => (
            <div className={styles.pricingNameCell}>
              <button
                type="button"
                className={styles.serviceDetailsBtn}
                onClick={(e) => { e.stopPropagation(); setPricingPanelFor(row.name); }}
                title={`Open ${row.name} — every pricing field on one screen`}
                aria-label={`Open pricing for ${row.name}`}
              >⤢</button>
              <span className={styles.pricingNameText} title={row.name}>{row.name}</span>
            </div>
          ),
        };
      case 'basisLabel':
        return {
          ...base,
          render: (row) => (
            <div className={styles.pricingBasisCell}>
              <BasisCell value={row.basis} bases={bases} onCommit={(v) => savePricingField(row.name, 'basis', v)} />
              {/* A service priced on several bases shows the headline one in
                  this column and its rate in the two beside it — so without
                  this a fee off this card reads as arithmetic nobody can
                  follow. The count is the cue; the panel behind the ⤢ has
                  the rows. */}
              {row._extraLines > 0 && (
                <span
                  className={styles.pricingBasisMore}
                  title={`Priced on ${row._extraLines + 1} lines: ${row._breakdown.map(p => p.basisLabel).join(', ')}. The rate columns show the first. Open the service to see the breakdown.`}
                >{`+${row._extraLines}`}</span>
              )}
            </div>
          ),
        };
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
              title={row.avgFee !== null && row.basis
                ? 'Not in use: a fee is typed against this service, which wins. Clear it in the pricing panel to price off this rate again.'
                : row.basis
                  ? (row._kind === 'percent'
                    ? 'Percentage of the deal size. On its own it prices one figure; add a High Rate to price a range.'
                    : `Dollars — ${row.basisLabel.toLowerCase()}. On its own it prices one figure; add a High Rate to price a range.`)
                  : 'Pick a pricing basis first'}
              onCommit={(v) => savePricingField(row.name, 'rate', v)}
            />
          ),
        };
      // The top of the range. Blank is the normal case and means exactly
      // what it did before this column existed: one rate, one fee.
      case 'rateHigh':
        return {
          ...base,
          getSortValue: (row) => row.rateHigh,
          render: (row) => (
            <NumberCell
              value={row.rateHigh}
              display={row.rateHigh === null ? '' : (row._kind === 'percent' ? `${row.rateHigh}%` : formatMoney(row.rateHigh))}
              placeholder={row._kind === 'percent' ? '%' : '$'}
              step="0.01"
              title={row.avgFee !== null && row.basis
                ? 'Not in use: a fee is typed against this service, which wins. Clear it in the pricing panel to price off these rates again.'
                : !row.basis
                  ? 'Pick a pricing basis first'
                  : row.rate === null
                    ? 'Set the Low Rate first — a range needs both ends.'
                    : row.rateHigh === null
                      ? 'Optional. Type the top of the rate range and every fee for this service reads as a range; leave it blank for a single figure.'
                      : `Top of the range: this service prices between ${formatRate({ basis: row.basis, rate: row.rate }, bases)} and ${formatRate({ basis: row.basis, rate: row.rateHigh }, bases)}. Clear it to go back to one figure.`}
              onCommit={(v) => savePricingField(row.name, 'rateHigh', v)}
            />
          ),
        };
      case 'notes':
        return { ...base, render: (row) => <NotesCell value={row.notes} onCommit={(v) => savePricingField(row.name, 'notes', v)} /> };
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
        <button
          type="button"
          className={styles.showHiddenBtn}
          onClick={() => setBasesOpen(true)}
          title="Add, rename, reorder or remove the options in the Pricing Basis column"
        >Pricing bases ({bases.length})</button>
        <span className={styles.resultCount}>
          {term ? `${rows.length} of ${serviceRows.length} services` : `${serviceRows.length} services`}
          {` · ${pricedCount} priced`}
        </span>
      </div>

      {/* Said once, at the top: this table is the standing price of a
          service, and the deal that price is being quoted on is a subtab
          over. Without it the rate card reads as though it had lost its
          estimator rather than handed it to a tab of its own. */}
      <div className={styles.oppImportNote}>
        The standing price of each service — what it is charged on, at what rate, and what it costs
        to stand up. An edit here reaches every deal. To price one deal — tick a scope, enter the
        account&rsquo;s counts and read the totals — use the <strong>Deal Pricing</strong> subtab.
      </div>

      <div className={styles.serviceTableWrap}>
        <DataTable
          tableId={PRICING_TABLE_ID}
          columns={columns}
          rows={rows}
          alwaysVisible={['name']}
          // Every cell that does something with a click swallows it first,
          // so this fires for the row itself — the name, the read-only
          // cells, and the padding around the editors.
          onRowClick={(row) => setPricingPanelFor(row.name)}
          rowClassName={(row) => (row._scoped ? styles.pricingRowScoped : undefined)}
          exportFileName="Services Pricing"
          settings={settings}
          updateSettings={updateSettings}
          emptyMessage={serviceRows.length === 0
            ? 'The Solutions dropdown list is empty. Add services on the Services subtab and they show up here.'
            : `No services match "${search}".`}
        />
      </div>

      {basesOpen && (
        <PricingBasesModal
          bases={bases}
          usage={basisUsage(pricing)}
          onSave={saveBases}
          onClose={() => setBasesOpen(false)}
        />
      )}

      {/* One service's pricing on one screen. Rendered before the setup
          panel so that, when the setup builder is opened from in here, it
          stacks on top and closing it comes back to this. */}
      {pricingPanelFor && (() => {
        const row = rows.find(r => r.name === pricingPanelFor)
          // A row filtered out by the search box is still a row the user
          // opened: fall back to the unfiltered set rather than closing the
          // panel under them when they type behind it.
          || allRows.find(r => r.name === pricingPanelFor);
        if (!row) return null;
        return (
          <ServicePricingModal
            row={row}
            bases={bases}
            // The setup builder answers Escape while it's open; without this
            // both panels would close on the one key press.
            escapeCloses={!setupFor}
            onSaveField={(field, value) => savePricingField(row.name, field, value)}
            onSaveLine={(basisKey, patch) => savePricingLine(row.name, basisKey, patch)}
            onEditSetup={() => setSetupFor(row.name)}
            onClose={() => setPricingPanelFor(null)}
          />
        );
      })()}

      {setupFor && (() => {
        const row = rows.find(r => r.name === setupFor) || allRows.find(r => r.name === setupFor);
        const basis = basisFor(row?.basis, bases);
        return (
          <SetupFeeModal
            serviceName={setupFor}
            setup={row?.setup || []}
            bases={bases}
            counts={counts}
            // A component charged on the same unit the service is follows
            // the count the deal being priced carries, exactly as the
            // estimate does.
            ownUnit={basis?.unit || null}
            ownUnits={row?.units ?? null}
            onSave={(components) => saveSetup(setupFor, components)}
            onClose={() => setSetupFor(null)}
          />
        );
      })()}
    </>
  );
}
