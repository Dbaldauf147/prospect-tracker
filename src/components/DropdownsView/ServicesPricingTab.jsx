import { useMemo, useRef, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { useAuth } from '../../contexts/AuthContext';
import { loadOpps2Newest, setOppFields } from '../../utils/opps2Store';
import { oppScenario } from '../../utils/oppPricingImport';
import { loadPricingEstimate, savePricingEstimate } from '../../utils/pricingEstimateStore';
import { ANALYSIS_FIELD, ESTIMATED_FEE_COLUMN, buildPricingAnalysis } from '../../utils/pricingAnalysis';
import { OppImportModal } from './OppImportModal';
import { PricingBasesModal } from './PricingBasesModal';
import {
  PRICING_BASES,
  basisFor,
  basisUsage,
  estimateScope,
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
  pricingBasesTopUp,
  PRICING_BASES_VERSION,
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
  // names both rather than picking one and lying about half the rows. Two
  // of them: a service quoted as a spread ("$450 to $600 a site") prices
  // to a range, and one left blank prices to a single figure exactly as it
  // did before there was a second column. The low one keeps the `rate`
  // key, so every rate already on the card is already in it.
  { key: 'rate',         label: 'Low Rate ($ or %)',  width: 130 },
  { key: 'rateHigh',     label: 'High Rate ($ or %)', width: 130 },
  { key: 'minFee',       label: 'Min Fee ($)',        width: 110 },
  { key: 'units',        label: 'Units',              width: 80 },
  // The two estimate columns are the scenario in the bar above applied to
  // this one row: the fee it earns in the first year, and what that comes to
  // over the term. The fee is annual for a recurring service and the whole
  // job for a project, so year one is what it states either way — the title
  // says so rather than leaving "Est. Fee" to be read as the term.
  // Wide enough for a range: "$1,105,650 – $1,474,200" is what these hold
  // once a service is quoted on two rates, and a clipped figure is a wrong
  // figure. A saved width still wins — this is only the default.
  { key: 'fee',          label: 'Estimated Year 1 Fee', width: 210 },
  { key: 'value',        label: 'Est. Deal Value',      width: 210 },
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
function BasisCell({ value, bases, onCommit }) {
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
      {bases.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
    </select>
  );
}

// One count box in the estimator bar. Held as text while the user types so a
// half-typed number doesn't re-run the whole estimate on every keystroke as
// a different figure; commits on blur / Enter.
function CountInput({ label, value, onCommit, placeholder, wide, title }) {
  const [draft, setDraft] = useState(null);
  const shown = draft !== null ? draft : (value === '' || value == null ? '' : String(value));
  function commit() {
    if (draft === null) return;
    const typed = draft.trim();
    setDraft(null);
    onCommit(typed === '' ? '' : (parseMoney(typed) ?? ''));
  }
  return (
    <label className={styles.pricingField} title={title}>
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
export function ServicesPricingTab({ settings, updateSettings, serviceRows = [], scenario, setScenario, prospects = [] }) {
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
  // the whole opp store — thousands of rows — and most visits to this tab
  // are to edit a rate, not to import a deal, so loading it on mount would
  // charge every visit for something few of them use.
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

  function savePricingField(name, field, value) {
    updateSettings?.({ servicePricing: setPricingField(pricing, name, field, value) });
  }

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
      console.error('Services Pricing: could not save the analysis to the opp', err);
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
      console.error('Services Pricing: could not load opps', err);
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

  // Priced = there's a figure behind it, however it got there: a basis to
  // work one out, or a fee typed straight into the Year 1 Fee column.
  const pricedCount = useMemo(
    () => serviceRows.filter(r => {
      const entry = pricingFor(pricing, r.name, bases);
      return !!entry.basis || entry.avgFee !== null;
    }).length,
    [serviceRows, pricing, bases],
  );

  const term = search.trim().toLowerCase();
  const rows = useMemo(() => serviceRows
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
        notes: entry.notes,
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
    })
    .filter(r => !term || [r.name, r.serviceBucket, r.basisLabel, r.notes].some(v => String(v).toLowerCase().includes(term))),
  [serviceRows, pricing, bases, allEstimates, inScope, serviceUnits, pinnedNames, term]);

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
        return { ...base, render: (row) => <BasisCell value={row.basis} bases={bases} onCommit={(v) => savePricingField(row.name, 'basis', v)} /> };
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
              title={row._typed && row.basis
                ? 'Not in use: the Estimated Year 1 Fee column has a fee typed into it, which wins. Clear that cell to price off this rate again.'
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
              title={row._typed && row.basis
                ? 'Not in use: the Estimated Year 1 Fee column has a fee typed into it, which wins. Clear that cell to price off these rates again.'
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
      // How many units this service is charged on. It opens on the shared
      // count from the estimator, so trimming a deal to "invoice processing
      // at 40 of the 819 sites" is a click and a retype; clearing the cell
      // hands the row back to that count. Only a per-unit basis has
      // anything to count, so the rest of the rows stay read-only.
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
                    : 'Pick a per-unit pricing basis first.'}
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
                title={row._unitsOwn
                  ? `Typed in for this estimate: charged on ${row.units.toLocaleString('en-US')} ${unit}, whatever the ${row._unitLabel} box above says. It belongs to this analysis alone — no other deal and no account record moves. Clear the cell to go back to that count.`
                  : row._unitsTyped
                    ? `A standing figure on the rate card: ${row.units.toLocaleString('en-US')} ${unit} on every deal. Type here to charge this estimate on its own number instead.`
                    : `From the ${row._unitLabel} box above. Type a figure to charge this service on its own number of ${unit} in this estimate.`}
                onCommit={(v) => setServiceUnits(row.name, v)}
              />
            );
          },
        };
      // The fee is the one estimate cell you can write into: typing a
      // figure sets it as this service's fee outright, for when the answer
      // is "it goes for about forty grand" rather than a rate times a
      // count. It opens prefilled with whatever the basis worked out, so
      // adjusting a modelled number is a click and a retype, and clearing
      // it hands the row back to the model.
      case 'fee':
        return {
          ...base,
          getSortValue: (row) => row.fee,
          render: (row) => (
            <NumberCell
              // The editor opens on whatever is showing — the typed figure,
              // or the one the basis worked out — so adjusting a modelled
              // number is a retype rather than a re-derivation. Committing
              // an unchanged value writes nothing (see NumberCell), so
              // opening a computed cell and clicking away can't turn it
              // into an override.
              // A ranged row opens its editor on the bottom of the range:
              // typing over it is stating the fee outright, and the bottom
              // is the half that reads as "the fee" when someone quotes one
              // number off a spread.
              value={row.fee}
              display={row.fee === null
                ? ''
                : (
                  <span className={row._typed
                    ? styles.pricingEstTyped
                    : (row._scoped ? styles.pricingEstScoped : undefined)}
                  >{formatMoneyRange(row.fee, row.feeHigh)}</span>
                )}
              placeholder="$"
              step="100"
              title={row._typed
                ? 'Typed in: this is the fee, whatever the basis works out to. Clear the cell to go back to the basis.'
                : row.fee === null
                  ? `Not priced yet${row._note ? ` — ${row._note.toLowerCase()}` : ''}. Type an average fee here, or set a basis and rate.`
                  : row.feeHigh > row.fee
                    ? `The low and high rates across this scope${row._note ? ` — ${row._note.toLowerCase()}` : ''}. Type a figure to quote one number instead.`
                    : `Worked out from the basis${row._note ? ` — ${row._note.toLowerCase()}` : ''}. Type a figure to use that instead.`}
              onCommit={(v) => savePricingField(row.name, 'avgFee', v)}
            />
          ),
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
          <div className={styles.pricingTotal}>
            <span className={styles.pricingTotalLabel}>One-off projects</span>
            <span className={styles.pricingTotalValue}>{formatMoneyRange(totals.oneTime, totals.oneTimeHigh) || '$0'}</span>
          </div>
          {/* The term total still has to be somewhere — it's the number a
              multi-year deal is signed at — but it's no longer the headline,
              so it sits with the other supporting figures. */}
          <div className={styles.pricingTotal}>
            <span className={styles.pricingTotalLabel}>Contract value</span>
            <span
              className={styles.pricingTotalValue}
              title="Every service across its full term: a recurring fee times its years, plus the one-off projects."
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
              title={'The first twelve months: each recurring service’s annual fee plus every one-off project in full. The sum of the Estimated Year 1 Fee column.'
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
                        ? <span className={styles.serviceMutedCell}>Fee typed on the rate card</span>
                        : (formatRate(line.entry, bases) || <span className={styles.serviceMutedCell}>No rate set</span>)}
                    </td>
                    <td className={styles.projectTableNum}>
                      {typedFee ? (
                        <span
                          className={styles.serviceMutedCell}
                          title="This service’s fee is typed straight into the rate card, so a project count doesn’t change it. Clear the Est. Year 1 Fee cell in the table below to price it per project instead."
                        >-</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          inputMode="decimal"
                          className={own === undefined || own === null || own === ''
                            ? styles.projectTableInput
                            : `${styles.projectTableInput} ${styles.projectTableInputTyped}`}
                          placeholder={line.units === null ? '0' : String(line.units)}
                          value={own === undefined || own === null ? '' : String(own)}
                          title={own === undefined || own === null
                            ? 'How many of this project the deal carries. Blank falls back to the shared Projects count.'
                            : 'Typed in for this estimate. Clear it to fall back to the shared Projects count.'}
                          onChange={(e) => setServiceUnits(line.name, e.target.value)}
                        />
                      )}
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
          Not counted — no pricing basis or rate set yet: {totals.unpriced.join(', ')}
        </div>
      )}

      <div className={styles.serviceTableWrap}>
        <DataTable
          tableId={PRICING_TABLE_ID}
          columns={columns}
          rows={rows}
          alwaysVisible={['scope', 'name']}
          rowGroup={pinnedRowGroup}
          rowClassName={(row) => [
            row._scoped ? styles.pricingRowScoped : '',
            row._pinned ? styles.pricingRowPinned : '',
          ].filter(Boolean).join(' ') || undefined}
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
