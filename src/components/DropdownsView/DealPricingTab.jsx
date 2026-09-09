import { useMemo, useRef, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { useAuth } from '../../contexts/AuthContext';
import { loadOpps2Newest, setOppFields } from '../../utils/opps2Store';
import { oppScenario } from '../../utils/oppPricingImport';
import { loadPricingEstimate, savePricingEstimate } from '../../utils/pricingEstimateStore';
import { ANALYSIS_FIELD, ESTIMATED_FEE_COLUMN, buildPricingAnalysis } from '../../utils/pricingAnalysis';
import { OppImportModal } from './OppImportModal';
import { CountInput, NumberCell } from './pricingCells';
import {
  basisFor,
  estimateScope,
  feeBasisLabel,
  formatMoney,
  formatMoneyRange,
  formatRate,
  getServicePricing,
  parseMoney,
  pricingFor,
  pricingUnits,
  projectServiceLines,
  PROJECT_UNIT,
  resolvePricingBases,
} from '../../utils/servicePricing';
import styles from './DropdownsView.module.css';

// Where this table's column widths, order and visibility are remembered,
// alongside every other table's under settings.tablePrefs.
const DEAL_TABLE_ID = 'dropdowns-deal-pricing';

// The scope checkbox sits inside a row whose own click toggles the scope, so
// its click has to stop there or the two would cancel each other out.
const swallow = (e) => e.stopPropagation();

const DEAL_TABLE_COLUMNS = [
  { key: 'scope',        label: 'In Scope',            width: 78 },
  { key: 'name',         label: 'Service',             width: 280 },
  { key: 'serviceBucket',label: 'Service Bucket',      width: 200 },
  // What the rate card says, read-only: this tab prices a deal, it doesn't
  // rewrite the card. The basis and the rate behind a fee are what make the
  // fee checkable, so they travel with it rather than being left a subtab away.
  { key: 'basisLabel',   label: 'Pricing Basis',       width: 150 },
  { key: 'rate',         label: 'Rate Card',           width: 190 },
  // The units this deal charges the service on — the one number in the
  // table that belongs to the estimate rather than to the card.
  { key: 'units',        label: 'Units',               width: 90 },
  { key: 'setup',        label: 'Setup Fee',           width: 140 },
  // Wide enough for a range: "$1,105,650 – $1,474,200" is what these hold
  // once a service is quoted on two rates, and a clipped figure is a wrong
  // figure. A saved width still wins — this is only the default.
  { key: 'fee',          label: 'Estimated Year 1 Fee', width: 210 },
  { key: 'value',        label: 'Est. Deal Value',      width: 210 },
];

// Dropdowns › Deal Pricing. One deal at a time, priced off the rate card the
// Services Pricing subtab keeps: tick what's in scope, say how many sites /
// accounts / meters the account has, and read the deal off the bar.
//
// Everything on this tab belongs to the deal being estimated and nothing on
// it writes to the rate card — a count typed here, a service ticked here and
// a units figure typed here re-price this analysis and nothing else. The
// rates themselves are a subtab over, where an edit is meant to reach every
// deal at once.
//
// `scenario` (what's in scope, the counts, the deal size) is held by the
// parent rather than here so switching subtabs and coming back doesn't lose
// a half-built estimate. It's a scratch calculation, so it isn't saved into
// settings — the rate card is the part worth keeping, and that's over there.
export function DealPricingTab({ settings, updateSettings, serviceRows = [], scenario, setScenario, prospects = [] }) {
  const [search, setSearch] = useState('');
  // `|| {}` so the tab still renders outside the AuthProvider (tests,
  // harnesses): with no user it reads the local opps cache and skips the
  // Firestore pull, which is exactly the right behaviour there.
  const { user } = useAuth() || {};

  // What the last visit left in the estimator, read once on mount. The
  // scenario half of it is restored by the parent, which owns that state;
  // the two halves are written together below, so they can't come back out
  // of step with each other.
  const restoredRef = useRef(undefined);
  if (restoredRef.current === undefined) restoredRef.current = loadPricingEstimate(user?.uid);
  const restored = restoredRef.current;

  // The Opps 2 dataset, pulled only when the picker is first opened. It's
  // the whole opp store — thousands of rows — and a visit that only reads
  // the totals back shouldn't be charged for loading it.
  const [oppPicker, setOppPicker] = useState(false);
  const [oppRecords, setOppRecords] = useState(null);
  const [oppError, setOppError] = useState('');
  const [oppLoading, setOppLoading] = useState(false);

  const pricing = useMemo(() => getServicePricing(settings), [settings?.servicePricing]);
  // The Pricing Basis vocabulary in force: the edited list when there is
  // one, the built-in eight otherwise. Everything below prices against
  // this, so a basis someone added behaves exactly like one that shipped.
  const bases = useMemo(() => resolvePricingBases(settings), [settings?.pricingBases]);
  const units = useMemo(() => pricingUnits(bases), [bases]);
  const unitLabels = useMemo(() => Object.fromEntries(units.map(u => [u.unit, u.label])), [units]);

  const inScope = useMemo(
    () => new Set(Array.isArray(scenario?.services) ? scenario.services : []),
    [scenario?.services],
  );
  // Memoized rather than a bare `|| {}`: a fresh empty object each render
  // would re-run every estimate below on any keystroke on the page.
  const counts = useMemo(() => scenario?.counts || {}, [scenario?.counts]);
  // Units typed against a service for THIS estimate. They live with the
  // estimate rather than in the rate card because "invoice processing at 40
  // of the 819 sites" is a fact about one deal: typing it here re-prices
  // this analysis and nothing else — not the other opps, and not the
  // account's own site count, which this tab never writes to at all.
  const serviceUnits = useMemo(() => scenario?.serviceUnits || {}, [scenario?.serviceUnits]);
  const dealSize = scenario?.dealSize ?? '';

  // What the last import filled in, so the bar can say where its numbers
  // came from and what it couldn't answer. Cleared when the scope is.
  const [oppImport, setOppImport] = useState(() => restored?.oppImport || null);

  // The services an import put in scope, held to the top of the table so
  // the five rows the deal is about aren't scattered through a hundred and
  // forty. It's a snapshot of what the import ticked rather than a live
  // read of the scope: ticking a sixth service afterwards shouldn't yank
  // its row out from under the click, and unticking one shouldn't drop it
  // back into the alphabet before you can see what you just did. Null when
  // nothing is pinned.
  const [pinnedNames, setPinnedNames] = useState(() => (restored?.pinned ? new Set(restored.pinned) : null));

  // Keep the stored estimate in step with the one on screen. Written from
  // here rather than split across the two components that hold it: the
  // scenario is the parent's state but it is only ever edited from this
  // tab, so one writer covering all of it means a reload can't come back
  // with an opp's scope and someone else's counts. Emptying the estimator
  // writes nothing and clears the record (see savePricingEstimate).
  useEffect(() => {
    savePricingEstimate(user?.uid, {
      scenario: { services: [...inScope], counts, serviceUnits, dealSize },
      pinned: pinnedNames ? [...pinnedNames] : null,
      oppImport,
    });
  }, [user?.uid, inScope, counts, serviceUnits, dealSize, pinnedNames, oppImport]);

  // The last save, so the note under the bar can say it landed — and say
  // it didn't when it didn't. { ok, at, error }.
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);

  // Freeze the estimate onto the opp it was built for. The whole analysis
  // goes onto the record, and the year-one figure into the visible
  // Estimated Fee column, so the opp shows the number and can open the
  // working behind it. What's written is a copy, not a link: the estimator
  // keeps whatever is on screen, and a rate edited next week doesn't
  // rewrite what this deal was quoted at.
  async function saveToOpp() {
    const oppId = oppImport?.id;
    if (!oppId || saving) return;
    setSaving(true);
    try {
      const analysis = buildPricingAnalysis({
        totals, counts, dealSize, bases, account: oppImport.account,
      });
      await setOppFields(user?.uid, oppId, {
        [ANALYSIS_FIELD]: analysis,
        [ESTIMATED_FEE_COLUMN]: formatMoneyRange(analysis.year1Total, analysis.year1TotalHigh) || '$0',
      });
      setSaved({ ok: true, at: Date.now() });
    } catch (err) {
      console.error('Deal Pricing: could not save the analysis to the opp', err);
      setSaved({ ok: false, error: err?.message || 'The save did not go through.' });
    } finally {
      setSaving(false);
    }
  }

  // A "saved" note goes stale the moment the estimate moves under it, so it
  // clears itself rather than going on claiming figures that are no longer
  // the ones on the opp. Saving doesn't touch these, so the note survives
  // its own save.
  useEffect(() => { setSaved(null); }, [inScope, counts, serviceUnits, dealSize]);

  async function openOppPicker() {
    setOppPicker(true);
    if (oppRecords || oppLoading) return;
    setOppLoading(true);
    setOppError('');
    try {
      const data = await loadOpps2Newest(user?.uid);
      setOppRecords(Array.isArray(data?.records) ? data.records : []);
    } catch (err) {
      console.error('Deal Pricing: could not load opps', err);
      setOppError('Could not load the opportunities. Open the Opps 2 tab to sync them, then try again.');
      setOppRecords([]);
    } finally {
      setOppLoading(false);
    }
  }

  // Apply an opp to the estimator. The scenario is replaced rather than
  // merged: leaving a previous deal's site count behind would quietly
  // inflate this one, and a number nobody typed for this account is worse
  // than a blank the summary asks them to fill.
  function applyOpp(opp) {
    const scen = oppScenario({
      opp,
      prospects,
      siteLists: settings?.companySiteLists,
      serviceNames: serviceRows.map(r => r.name),
    });

    // Which units this scope actually needs, so the summary can name the
    // ones nothing on file could answer.
    const needed = new Set();
    const noPrice = [];
    for (const name of scen.services) {
      const entry = pricingFor(pricing, name, bases);
      // A typed fee already answers the question, so it needs no count and
      // isn't missing a price. Nor does a row carrying its own unit count.
      if (entry.avgFee !== null) continue;
      const basis = basisFor(entry.basis, bases);
      if (!basis) { noPrice.push(name); continue; }
      if (basis.unit && entry.units === null) needed.add(basis.unit);
    }

    setScenario({ services: scen.services, counts: scen.counts, serviceUnits: {}, dealSize: scen.dealSize });
    setPinnedNames(scen.services.length > 0 ? new Set(scen.services) : null);
    setSaved(null);
    setOppImport({
      account: scen.account,
      // The opp's own id, so the finished estimate can be saved back onto
      // the row it was built from without picking it out of the list again.
      id: scen.id,
      stage: scen.stage,
      company: scen.matchedProspect ? scen.company : '',
      services: scen.services.length,
      unmatchedTokens: scen.unmatchedTokens,
      filled: Object.keys(scen.counts).map(unit => ({
        unit,
        label: unitLabels[unit] || unit,
        value: scen.counts[unit],
        source: scen.countSources[unit],
      })),
      dealSizeSource: scen.dealSizeSource,
      missing: [...needed].filter(u => scen.counts[u] === undefined).map(u => unitLabels[u] || u),
      noPrice,
    });
    setOppPicker(false);
  }

  function clearScope() {
    // The per-service units go with the scope: they're this deal's slice of
    // the account, and leaving them behind would quietly re-price whatever
    // is estimated next against the last deal's numbers.
    setScenario(s => ({ ...s, services: [], serviceUnits: {} }));
    setOppImport(null);
    setPinnedNames(null);
    setSaved(null);
  }

  function toggleScope(name) {
    const next = new Set(inScope);
    if (next.has(name)) next.delete(name); else next.add(name);
    setScenario(s => ({ ...s, services: [...next] }));
  }
  // Blank clears the row's own figure rather than storing a zero, which
  // would price the service at nothing instead of handing it back to the
  // shared count.
  function setServiceUnits(name, value) {
    setScenario(s => {
      const next = { ...(s?.serviceUnits || {}) };
      if (value === '' || value == null) delete next[name];
      else next[name] = value;
      return { ...s, serviceUnits: next };
    });
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
      pricing, counts, dealSize, bases, serviceUnits,
    });
    return new Map(lines.map(l => [l.name, l]));
  }, [serviceRows, pricing, counts, dealSize, bases, serviceUnits]);

  // The deal itself: only what's ticked.
  const totals = useMemo(
    () => estimateScope({ rows: serviceRows, services: [...inScope], pricing, counts, dealSize, bases, serviceUnits }),
    [serviceRows, inScope, pricing, counts, dealSize, bases, serviceUnits],
  );

  // The project work in this scope, one row per service. Sites and accounts
  // are facts about the account, so one box each answers for every service
  // reading them; how many projects is a fact about the service, so this
  // asks per service instead of dividing a shared number nobody typed.
  const projectLines = useMemo(
    () => projectServiceLines(totals.lines, bases),
    [totals.lines, bases],
  );
  // Both ends of the project work, so a panel whose rows read as ranges
  // doesn't foot to a single figure.
  const projectTotal = useMemo(
    () => projectLines.reduce((sum, l) => sum + (l.priced ? l.fee : 0), 0),
    [projectLines],
  );
  const projectTotalHigh = useMemo(
    () => projectLines.reduce((sum, l) => sum + (l.priced ? l.feeHigh : 0), 0),
    [projectLines],
  );
  // What a row with no number of its own is priced on. Shown as the input's
  // placeholder so a blank box reads as "using this" rather than as zero.
  const sharedProjects = parseMoney(counts?.[PROJECT_UNIT]);

  // Where each count came from, by unit, so the box can say so. Only an
  // import knows: a number the user typed came from them.
  const countSources = useMemo(() => Object.fromEntries(
    (oppImport?.filled || []).map(f => [f.unit, f.source]),
  ), [oppImport]);

  // Count boxes are shown for the units the scope actually needs, so the bar
  // asks for meters on a bill-pay deal and not on a reporting one. A unit
  // that already has a number keeps its box even after the service that
  // wanted it is un-ticked — otherwise a typed figure would vanish.
  const visibleUnits = useMemo(() => units.filter(u =>
    totals.unitsUsed.has(u.unit) || (counts?.[u.unit] !== '' && counts?.[u.unit] != null)
  ), [units, totals.unitsUsed, counts]);

  const term = search.trim().toLowerCase();
  // Every service as a table row, before the search box has its say.
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
        _entry: entry,
        // How the fee was arrived at, in a few words — the part that makes
        // a number on this tab checkable without going back to the card.
        _how: est ? feeBasisLabel(est, bases) : '',
        _extraLines: entry.lines.length,
        notes: entry.notes,
        // What the setup components come to under this scenario. The
        // components themselves are rate card data and are edited there.
        setup: entry.setup,
        _setupFee: est?.setup ?? 0,
        // Typed against the row when there is one, otherwise whatever the
        // estimator's count works out to — the estimate already prefers the
        // typed figure, except on a row whose fee was typed too, where it
        // never got as far as counting. This estimate's own figure comes
        // first, then the rate card's standing one.
        units: ownUnits !== null ? ownUnits : (entry.units !== null ? entry.units : (est?.units ?? null)),
        _unitsTyped: ownUnits !== null || entry.units !== null,
        _unitsOwn: ownUnits !== null,
        _unit: basis?.unit || null,
        _unitLabel: basis?.unitLabel || '',
        fee: est?.priced ? est.fee : null,
        feeHigh: est?.priced ? est.feeHigh : null,
        value: est?.priced ? est.value : null,
        valueHigh: est?.priced ? est.valueHigh : null,
        _kind: basis?.kind || '',
        _note: est?.note || '',
        _typed: !!est?.typed,
        _scoped: inScope.has(name),
        _pinned: !!pinnedNames?.has(name),
      };
    }),
  [serviceRows, pricing, bases, allEstimates, inScope, serviceUnits, pinnedNames]);

  const rows = useMemo(
    () => (term
      ? allRows.filter(r => [r.name, r.serviceBucket, r.basisLabel, r.notes]
        .some(v => String(v).toLowerCase().includes(term)))
      : allRows),
    [allRows, term],
  );

  // Band 0 is the imported scope, band 1 everything else, so those rows sit
  // at the top of whatever sort or search is active rather than only when
  // the In Scope column happens to be the sort key. Memoized against the
  // pinned set because DataTable memoizes the grouped order against this
  // callback's identity — a fresh arrow every render would regroup the
  // whole table on each keystroke in the search box — and left undefined
  // when nothing is pinned so the table skips the pass entirely.
  const pinnedRowGroup = useMemo(
    () => (pinnedNames ? (row) => (pinnedNames.has(row.name) ? 0 : 1) : undefined),
    [pinnedNames],
  );

  const columns = DEAL_TABLE_COLUMNS.map(col => {
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
      case 'name':
        return {
          ...base,
          render: (row) => (
            <span className={styles.pricingNameText} title={`${row.name} — click the row to tick it in or out of the scope`}>
              {row.name}
            </span>
          ),
        };
      // Read-only: the basis is rate card data, and an edit here would move
      // every other deal priced off the same service.
      case 'basisLabel':
        return {
          ...base,
          render: (row) => (
            <div className={styles.pricingBasisCell}>
              {row.basisLabel
                ? <span title={`${row.basisLabel} — set on the Services Pricing subtab`}>{row.basisLabel}</span>
                : <span className={styles.serviceMutedCell} title="Not priced yet. Set a basis and a rate on the Services Pricing subtab.">-</span>}
              {row._extraLines > 0 && (
                <span
                  className={styles.pricingBasisMore}
                  title={`Priced on ${row._extraLines + 1} lines. The rate column shows the first; the Services Pricing subtab has the breakdown.`}
                >{`+${row._extraLines}`}</span>
              )}
            </div>
          ),
        };
      // What the card charges, in the card's own words. Read-only for the
      // same reason the basis is, and paired with how this row's fee was
      // worked out so the figure beside it can be checked.
      case 'rate':
        return {
          ...base,
          getSortValue: (row) => row.rate,
          render: (row) => {
            const rate = formatRate(row._entry, bases);
            const typedFee = row._typed;
            if (typedFee) {
              return (
                <span
                  className={styles.pricingEstTyped}
                  title="A fee is typed against this service on the Services Pricing subtab, and it wins over any rate."
                >{formatMoney(row._entry.avgFee)} typed</span>
              );
            }
            if (!rate) {
              return (
                <span className={styles.serviceMutedCell} title="No rate on the card yet — set one on the Services Pricing subtab.">-</span>
              );
            }
            // The rate itself, not the arithmetic: a per-unit phrase
            // repeats the figure it starts with, and the Units column
            // beside it already says what it's multiplied by. The working
            // goes in the tooltip, where it can be read in full.
            return (
              <span title={row._how
                ? `${row._how} — from the rate card on the Services Pricing subtab.`
                : 'From the rate card on the Services Pricing subtab.'}
              >{rate}</span>
            );
          },
        };
      // How many units this service is charged on in THIS deal. It opens on
      // the shared count from the bar above, so trimming a deal to "invoice
      // processing at 40 of the 819 sites" is a click and a retype;
      // clearing the cell hands the row back to that count. Only a per-unit
      // basis has anything to count, so the rest stay read-only.
      case 'units':
        return {
          ...base,
          getSortValue: (row) => row.units,
          render: (row) => {
            if (!row._unit) {
              return (
                <span
                  className={styles.serviceMutedCell}
                  title={row.basis
                    ? `${row.basisLabel} isn’t priced per unit, so there’s nothing to count.`
                    : 'Not priced per unit.'}
                >-</span>
              );
            }
            const unit = row._unitLabel.toLowerCase();
            return (
              <NumberCell
                value={row.units}
                display={row.units === null
                  ? ''
                  : (
                    <span className={row._unitsTyped ? styles.pricingUnitsTyped : undefined}>
                      {row.units.toLocaleString('en-US')}
                    </span>
                  )}
                placeholder={row._unitLabel}
                title={row._typed
                  ? (row._unitsOwn
                    ? `This service's fee is typed on the rate card, and this deal carries ${row.units.toLocaleString('en-US')} of them — the fee is that figure ${row.units.toLocaleString('en-US')} times over. Clear the cell to go back to one.`
                    : 'This service’s fee is typed on the rate card, which prices one of them. Type how many this deal carries and the fee multiplies; blank is one. The shared count above never reaches a typed fee.')
                  : row._unitsOwn
                  ? `Typed in for this estimate: charged on ${row.units.toLocaleString('en-US')} ${unit}, whatever the ${row._unitLabel} box above says. It belongs to this analysis alone — no other deal and no account record moves. Clear the cell to go back to that count.`
                  : row._unitsTyped
                    ? `A standing figure on the rate card: ${row.units.toLocaleString('en-US')} ${unit} on every deal. Type here to charge this estimate on its own number instead.`
                    : `From the ${row._unitLabel} box above. Type a figure to charge this service on its own number of ${unit} in this estimate.`}
                onCommit={(v) => setServiceUnits(row.name, v)}
              />
            );
          },
        };
      // What standing the service up costs on this deal: the components off
      // the rate card, with the per-unit half following the counts above.
      case 'setup':
        return {
          ...base,
          getSortValue: (row) => row._setupFee,
          render: (row) => (row.setup.length === 0
            ? <span className={styles.serviceMutedCell} title="No setup fee on the card. Add its components on the Services Pricing subtab.">-</span>
            : (
              <span title={`Billed once on this deal. The components are on the Services Pricing subtab.`}>
                {formatMoney(row._setupFee) || '$0'}
              </span>
            )),
        };
      case 'fee':
        return {
          ...base,
          getSortValue: (row) => row.fee,
          render: (row) => (row.fee === null
            ? (
              <span
                className={styles.serviceMutedCell}
                title={`Not priced yet${row._note ? ` — ${row._note.toLowerCase()}` : ''}. Set a basis and rate, or type a fee, on the Services Pricing subtab.`}
              >-</span>
            )
            : (
              <span
                className={row._typed
                  ? styles.pricingEstTyped
                  : (row._scoped ? styles.pricingEstScoped : undefined)}
                title={row._typed
                  ? 'The fee typed on the rate card, in the first year'
                  : (row._note || 'Worked out from the rate card against the counts above')}
              >{formatMoneyRange(row.fee, row.feeHigh)}</span>
            )),
        };
      case 'value':
        return {
          ...base,
          getSortValue: (row) => row.value,
          render: (row) => (row.value === null
            ? <span className={styles.serviceMutedCell} title={row._note || 'Not priced yet'}>-</span>
            : (
              <span
                className={row._typed
                  ? styles.pricingEstTyped
                  : (row._scoped ? styles.pricingEstScoped : undefined)}
                title={row._typed
                  ? 'The typed fee, across the service’s term'
                  : (row._note || undefined)}
              >{formatMoneyRange(row.value, row.valueHigh)}</span>
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
        <button
          type="button"
          className={styles.importOppBtn}
          onClick={openOppPicker}
          title="Pull an opportunity's scope and its account's site / accounts figures into the estimator"
        >Import opp</button>
        <span className={styles.resultCount}>
          {term ? `${rows.length} of ${serviceRows.length} services` : `${serviceRows.length} services`}
          {` · ${inScope.size} in scope`}
        </span>
      </div>

      {/* The estimator. Everything in it is a scenario rather than saved
          data, so it reads left to right as one sentence: this many sites,
          on a deal this big, with these services ticked, comes to this. */}
      <div className={styles.pricingBar}>
        <div className={styles.pricingInputs}>
          <span className={styles.pricingBarTitle}>Deal estimate</span>
          {oppImport && (
            <span
              className={styles.oppChip}
              title={oppImport.company && oppImport.company !== oppImport.account
                ? `Imported from the ${oppImport.account} opp, matched to ${oppImport.company}`
                : `Imported from the ${oppImport.account} opp`}
            >
              {oppImport.account}
              {oppImport.stage && <span className={styles.oppChipStage}>{oppImport.stage}</span>}
            </span>
          )}
          {/* Where a figure came from is worth saying on the box itself,
              because a count seeded off a company record reads exactly like
              one somebody typed for this deal — and only one of them is
              worth trusting. Editing either only ever moves this estimate:
              nothing on this tab writes to the account. */}
          {visibleUnits.map(u => (
            <CountInput
              key={u.unit}
              label={u.label}
              value={counts?.[u.unit] ?? ''}
              title={`${u.label} this estimate prices against`
                + (countSources[u.unit] ? ` — filled from ${countSources[u.unit]}.` : '.')
                + ' Editing it re-prices this estimate only: the account record and every other deal stay as they are.'}
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
          {oppImport?.id && inScope.size > 0 && (
            <button
              type="button"
              className={styles.saveOppBtn}
              onClick={saveToOpp}
              disabled={saving}
              title={`Freeze this estimate onto the ${oppImport.account} opp: the Estimated Fee column shows the year-one figure, and clicking it opens this working. A copy, so later rate edits don't rewrite it.`}
            >{saving ? 'Saving…' : 'Save to opp'}</button>
          )}
          {inScope.size > 0 && (
            <button
              type="button"
              className={styles.showHiddenBtn}
              onClick={clearScope}
              title="Untick every service and forget the imported opp"
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
            <span className={styles.pricingTotalValue}>{formatMoneyRange(totals.recurringAnnual, totals.recurringAnnualHigh) || '$0'}</span>
          </div>
          {/* One-time money: the projects, plus every setup fee in the
              scope. The label names the setup half only when there is one,
              so a scope without any reads exactly as it did before setup
              fees existed — and one with them can't pass a $8,000
              implementation charge off as project work. */}
          <div className={styles.pricingTotal}>
            <span className={styles.pricingTotalLabel}>
              {totals.setup > 0 ? 'One-off + setup' : 'One-off projects'}
            </span>
            <span
              className={styles.pricingTotalValue}
              title={totals.setup > 0
                ? `Billed once: ${formatMoney(totals.setup)} of setup fees${totals.oneTime > totals.setup ? ` and ${formatMoney(totals.oneTime - totals.setup)} of one-off project work` : ''}.`
                : undefined}
            >{formatMoneyRange(totals.oneTime, totals.oneTimeHigh) || '$0'}</span>
          </div>
          {/* The term total still has to be somewhere — it's the number a
              multi-year deal is signed at — but it's no longer the headline,
              so it sits with the other supporting figures. */}
          <div className={styles.pricingTotal}>
            <span className={styles.pricingTotalLabel}>Contract value</span>
            <span
              className={styles.pricingTotalValue}
              title="Every service across its full term: a recurring fee times its years, plus the one-off projects and every setup fee once."
            >{formatMoneyRange(totals.contractValue, totals.contractValueHigh) || '$0'}</span>
          </div>
          {/* Year one, not the term: the recurring services at one year each
              plus the projects in full. Ties out to the Estimated Year 1 Fee
              column, which is the point — the headline is the sum of what
              each row says. */}
          <div className={styles.pricingTotalMain}>
            <span className={styles.pricingTotalLabel}>Estimated Year 1 deal size</span>
            <span
              className={styles.pricingTotalValueMain}
              title={'The first twelve months: each recurring service’s annual fee, every one-off project in full, and every setup fee. The sum of the Estimated Year 1 Fee column plus the setup fees beside it.'
                + (totals.ranged ? ' A range, because some of these services are quoted on a low and a high rate — each end is the sum of that end.' : '')}
            >{formatMoneyRange(totals.year1Total, totals.year1TotalHigh) || '$0'}</span>
          </div>
        </div>
      </div>

      {/* Project work, itemised. Only shown when the scope actually has
          per-project services in it — on a reporting or bill-pay deal there
          is nothing to count and the panel stays out of the way. */}
      {projectLines.length > 0 && (
        <div className={styles.projectPanel}>
          <div className={styles.projectPanelHead}>
            <span className={styles.pricingBarTitle}>
              Per-project services ({projectLines.length})
            </span>
            <span className={styles.projectPanelHint}>
              How many of each. A row left blank is priced on the shared{' '}
              {sharedProjects === null
                ? 'Projects count above, which is empty — so it comes out at $0 until one of them has a number.'
                : `Projects count above (${sharedProjects.toLocaleString('en-US')}).`}
              {' '}A row with a fee typed on the rate card is priced at that fee each, and blank means one.
              {' '}Numbers here belong to this estimate: no other deal and no rate card moves.
            </span>
          </div>
          <table className={styles.projectTable}>
            <thead>
              <tr>
                <th className={styles.projectTableName}>Service</th>
                <th>Rate / project</th>
                <th className={styles.projectTableNum}>Projects</th>
                <th className={styles.projectTableNum}>Fee</th>
              </tr>
            </thead>
            <tbody>
              {projectLines.map(line => {
                const own = serviceUnits[line.name];
                const typedFee = line.typed;
                return (
                  <tr key={line.name}>
                    <td className={styles.projectTableName}>{line.name}</td>
                    <td className={styles.projectTableRate}>
                      {typedFee
                        ? (
                          <span title="Typed against this service on the Services Pricing subtab. It's the fee for one of them, so the count beside it multiplies it.">
                            {formatMoney(line.entry.avgFee)}
                            <span className={styles.serviceMutedCell}> typed</span>
                          </span>
                        )
                        : (formatRate(line.entry, bases) || <span className={styles.serviceMutedCell}>No rate set</span>)}
                    </td>
                    <td className={styles.projectTableNum}>
                      <input
                        type="number"
                        min="0"
                        inputMode="decimal"
                        className={own === undefined || own === null || own === ''
                          ? styles.projectTableInput
                          : `${styles.projectTableInput} ${styles.projectTableInputTyped}`}
                        // A typed-fee row falls back to one, not to the
                        // shared count: the fee was typed for one job, and
                        // an account-wide figure has nothing to say about
                        // how many of them this deal carries.
                        placeholder={typedFee ? '1' : (line.units === null ? '0' : String(line.units))}
                        value={own === undefined || own === null ? '' : String(own)}
                        title={typedFee
                          ? (own === undefined || own === null
                            ? `How many of this project the deal carries, each at the typed ${formatMoney(line.entry.avgFee)}. Blank is one.`
                            : `Typed in for this estimate: ${formatMoney(line.entry.avgFee)} each. Clear it to go back to one.`)
                          : (own === undefined || own === null
                            ? 'How many of this project the deal carries. Blank falls back to the shared Projects count.'
                            : 'Typed in for this estimate. Clear it to fall back to the shared Projects count.')}
                        onChange={(e) => setServiceUnits(line.name, e.target.value)}
                      />
                    </td>
                    <td className={styles.projectTableNum}>
                      {line.priced
                        ? <span className={line.fee ? undefined : styles.serviceMutedCell} title={line.note || undefined}>{formatMoneyRange(line.fee, line.feeHigh) || '$0'}</span>
                        : <span className={styles.serviceMutedCell} title={line.note || 'Not priced yet'}>-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className={styles.projectTableName}>Project work in this scope</td>
                <td className={styles.projectTableNum}>{formatMoneyRange(projectTotal, projectTotalHigh) || '$0'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* What the import did and didn't manage. Where each number came from
          matters as much as the number: an estimate built on a site count
          nobody checked is one you'd want to know was taken off a company
          record rather than typed for this deal. */}
      {oppImport && (
        <div className={styles.oppImportNote}>
          <strong>{oppImport.account}</strong>
          {' — ticked '}{oppImport.services}{' service'}{oppImport.services === 1 ? '' : 's'}
          {pinnedNames && ' and pinned them to the top of the table'}
          {oppImport.filled.length > 0 && (
            <>{'; filled '}{oppImport.filled.map(f => `${f.label} ${f.value.toLocaleString('en-US')} from ${f.source}`).join(', ')}</>
          )}
          {oppImport.dealSizeSource && <>{'; deal size from '}{oppImport.dealSizeSource}</>}.
          {oppImport.missing.length > 0 && (
            <span className={styles.oppImportGap}>
              {' Nothing on file for '}{oppImport.missing.join(', ')} — the services priced on {oppImport.missing.length === 1 ? 'it' : 'those'} count as $0 until you enter {oppImport.missing.length === 1 ? 'it' : 'them'} above.
            </span>
          )}
          {oppImport.unmatchedTokens.length > 0 && (
            <span className={styles.oppImportGap}>
              {' Nothing in the Scope matched: '}{oppImport.unmatchedTokens.join(', ')}.
            </span>
          )}
          {saved?.ok && (
            <span className={styles.oppSavedNote}>
              {' Saved to the '}{oppImport.account}{' opp — '}{formatMoneyRange(totals.year1Total, totals.year1TotalHigh) || '$0'}
              {' in Estimated Fee, with this working behind it.'}
            </span>
          )}
          {saved && !saved.ok && (
            <span className={styles.oppImportGap}>
              {' Not saved to the opp: '}{saved.error}
            </span>
          )}
          {pinnedNames && (
            <button
              type="button"
              className={styles.unpinBtn}
              onClick={() => setPinnedNames(null)}
              title="Let the pinned services fall back into the table's own order — the scope and the estimate stay as they are"
            >Unpin</button>
          )}
        </div>
      )}

      {/* Said once, under the numbers, rather than as a footnote on every
          row: a service nobody has priced contributes nothing, so the total
          is short by however many of them are ticked. */}
      {totals.unpriced.length > 0 && (
        <div className={styles.pricingWarn}>
          Not counted — no pricing basis or rate set yet on the Services Pricing subtab: {totals.unpriced.join(', ')}
        </div>
      )}

      <div className={styles.serviceTableWrap}>
        <DataTable
          tableId={DEAL_TABLE_ID}
          columns={columns}
          rows={rows}
          alwaysVisible={['scope', 'name']}
          // The Units cell swallows its own click, so this fires for the
          // row itself — the name, the read-only cells, and the padding
          // around them. Ticking the scope is the one thing this table is
          // for, so that is what the row click does.
          onRowClick={(row) => toggleScope(row.name)}
          rowGroup={pinnedRowGroup}
          rowClassName={(row) => [
            row._scoped ? styles.pricingRowScoped : '',
            row._pinned ? styles.pricingRowPinned : '',
          ].filter(Boolean).join(' ') || undefined}
          exportFileName="Deal Pricing"
          settings={settings}
          updateSettings={updateSettings}
          emptyMessage={serviceRows.length === 0
            ? 'The Solutions dropdown list is empty. Add services on the Services subtab and they show up here.'
            : `No services match "${search}".`}
        />
      </div>

      {oppPicker && (
        <OppImportModal
          records={oppRecords}
          loading={oppLoading}
          error={oppError}
          onPick={applyOpp}
          onClose={() => setOppPicker(false)}
        />
      )}
    </>
  );
}

export default DealPricingTab;
