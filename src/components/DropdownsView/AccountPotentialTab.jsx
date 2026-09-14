import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { useAuth } from '../../contexts/AuthContext';
import { loadOpps2Newest, setOppFields } from '../../utils/opps2Store';
import { oppScenario } from '../../utils/oppPricingImport';
import { loadPricingEstimate, savePricingEstimate } from '../../utils/pricingEstimateStore';
import { ANALYSIS_FIELD, ESTIMATED_FEE_COLUMN, buildPricingAnalysis } from '../../utils/pricingAnalysis';
import { OppImportModal } from './OppImportModal';
import { CountInput, NumberCell } from './pricingCells';
import { ColumnFilterCombo } from '../common/ColumnFilterCombo';
import { accountPotential } from '../../utils/accountPotential';
import { clientCounts } from '../../utils/clientDealSizing';
import { buildOppStagesByClient } from '../../utils/serviceCoverage';
import { findProspectByCompany } from '../../utils/companyLookup';
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
  scopeYear1Lines,
} from '../../utils/servicePricing';
import styles from './DropdownsView.module.css';

// Where this table's column widths, order and visibility are remembered,
// alongside every other table's under settings.tablePrefs. Deliberately
// still the Deal Pricing id: the columns are the same columns, and a new id
// would silently reset every width anybody had dragged.
const DEAL_TABLE_ID = 'dropdowns-deal-pricing';

// The scope checkbox sits inside a row whose own click toggles the scope, so
// its click has to stop there or the two would cancel each other out.
const swallow = (e) => e.stopPropagation();

// 1st, 2nd, 3rd, 4th - including the teens, which are all -th however they
// end.
function ordinal(n) {
  const v = Math.abs(Math.trunc(Number(n) || 0));
  const teen = v % 100;
  if (teen >= 11 && teen <= 13) return `${v}th`;
  return `${v}${({ 1: 'st', 2: 'nd', 3: 'rd' })[v % 10] || 'th'}`;
}

const DEAL_TABLE_COLUMNS = [
  { key: 'scope',        label: 'In Scope',            width: 78 },
  // Where this service came in the money order. A fixed position rather
  // than the row's index, so re-sorting by name or bucket to find one
  // still tells you what it is worth relative to the rest.
  { key: 'rank',         label: '#',                   width: 56 },
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
  // The one money column. There was an Est. Deal Value beside it, the same
  // services priced over their contract term, and two totals for one
  // service is one more than a reader can hold: the term figure is bigger,
  // so it is the one that gets quoted, and this page is asked about year
  // one.
  { key: 'fee',          label: 'Estimated Year 1 Fee', width: 210 },
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
export function AccountPotentialTab({ settings, updateSettings, serviceRows = [], scenario, setScenario, prospects = [] }) {
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

  // ---- the account this potential is being read for -------------------
  const company = String(scenario?.company || '').trim();
  const companyOptions = useMemo(
    () => [...new Set((prospects || []).map(p => String(p?.company || '').trim()).filter(Boolean))].sort(),
    [prospects],
  );
  // The record behind the typed name. A name that matches nothing leaves
  // this null, which the page shows as "no record" rather than pretending
  // to have found one - the counts and the statuses both come off the
  // record, so a wrong match would price the page against somebody else.
  const client = useMemo(
    () => (company ? findProspectByCompany(prospects, company) : null),
    [prospects, company],
  );

  // What this account's opportunities say about each service. The company
  // page treats an opp whose Scope names a service as having explored it,
  // so this page has to as well or the two disagree about what is still
  // open. Needs the opp store, which is loaded lazily - until it arrives
  // only the manual statuses are read, which is the same page with fewer
  // services ruled out rather than a wrong one.
  const oppStages = useMemo(() => {
    if (!client || !Array.isArray(oppRecords)) return null;
    return buildOppStagesByClient([client], oppRecords).get(client) || new Map();
  }, [client, oppRecords]);

  // The account's own figures, with anything typed on the page winning.
  // Sites and meters are facts about the company and belong to its record;
  // typing over one is a what-if, and a what-if has to beat the fact or the
  // box would not do anything.
  const effectiveCounts = useMemo(
    () => (client ? clientCounts(client, { counts }).counts : counts),
    [client, counts],
  );
  const countSourceByUnit = useMemo(
    () => (client ? clientCounts(client, { counts }).sources : {}),
    [client, counts],
  );

  // The page itself: what is left to sell this account, in prize order.
  const potential = useMemo(() => accountPotential({
    client,
    serviceRows,
    pricing,
    bases,
    counts: effectiveCounts,
    serviceUnits,
    oppStages,
    // Which services drag others in behind them. The Services tab's own
    // Auto-add cells, read through the same overrides the Scope picker
    // reads, so a bundle here is the bundle that would actually be ticked.
    overrides: settings?.serviceOverrides,
  }), [client, serviceRows, pricing, bases, effectiveCounts, serviceUnits, oppStages,
    settings?.serviceOverrides]);

  // What the account has already ruled on, said in words. A count alone
  // ("29 left out") reads as a filter that might be wrong; naming the
  // outcomes says why each one went, which is the difference between a
  // number somebody trusts and one they come and ask about.
  const decidedSentence = useMemo(() => {
    const c = potential.decidedCounts;
    const total = potential.decided.length;
    if (!total) return 'Nothing ruled out yet - every service is still open.';
    const parts = [];
    if (c.sold) parts.push(`${c.sold} sold`);
    if (c.inProgress) parts.push(`${c.inProgress} in flight`);
    if (c.notSold) parts.push(`${c.notSold} not sold`);
    if (c.na) parts.push(`${c.na} N/A`);
    return `${total} left out: ${parts.join(', ')}`;
  }, [potential]);

  // Only the undecided services reach the table. A service this account
  // already buys is not potential, and neither is one they turned down, one
  // marked N/A, or one already sitting in a live opp - that money is in the
  // pipeline and counting it here would count it twice in the same review.
  const openRows = potential.open;

  function setCompany(name) {
    const next = String(name || '').trim();
    if (next === company) return;
    // Picking an account changes which services are even on the page, so a
    // scope ticked against the last one is not a scope against this one.
    // The typed counts go too: sites belong to a company, and carrying one
    // account's estate onto another's page is the quiet way to price a deal
    // against the wrong estate.
    setScenario(s2 => ({ ...s2, company: next, services: [], counts: {}, serviceUnits: {} }));
    setOppImport(null);
    setPinnedNames(null);
    if (next) ensureOpps();
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
      scenario: { services: [...inScope], counts, serviceUnits },
      pinned: pinnedNames ? [...pinnedNames] : null,
      oppImport,
    });
  }, [user?.uid, inScope, counts, serviceUnits, pinnedNames, oppImport]);

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
        totals, counts: effectiveCounts, bases, account: oppImport.account,
      });
      await setOppFields(user?.uid, oppId, {
        [ANALYSIS_FIELD]: analysis,
        [ESTIMATED_FEE_COLUMN]: formatMoneyRange(analysis.year1Total, analysis.year1TotalHigh) || '$0',
      });
      setSaved({ ok: true, at: Date.now() });
    } catch (err) {
      console.error('Account Potential: could not save the analysis to the opp', err);
      setSaved({ ok: false, error: err?.message || 'The save did not go through.' });
    } finally {
      setSaving(false);
    }
  }

  // A "saved" note goes stale the moment the estimate moves under it, so it
  // clears itself rather than going on claiming figures that are no longer
  // the ones on the opp. Saving doesn't touch these, so the note survives
  // its own save.
  useEffect(() => { setSaved(null); }, [inScope, counts, serviceUnits]);

  // The Opps 2 dataset, fetched once and shared by the two things that need
  // it: the import picker, and the statuses an account's opportunities
  // imply. Pulled lazily either way - it is the whole opp store, and a
  // visit that only reads the rate card shouldn't be charged for it.
  async function ensureOpps() {
    if (oppRecords || oppLoading) return;
    setOppLoading(true);
    setOppError('');
    try {
      const data = await loadOpps2Newest(user?.uid);
      setOppRecords(Array.isArray(data?.records) ? data.records : []);
    } catch (err) {
      console.error('Account Potential: could not load opps', err);
      setOppError('Could not load the opportunities. Open the Opps 2 tab to sync them, then try again.');
      setOppRecords([]);
    } finally {
      setOppLoading(false);
    }
  }

  function openOppPicker() {
    setOppPicker(true);
    ensureOpps();
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
      const basis = basisFor(entry.basis, bases);
      if (!basis) { noPrice.push(name); continue; }
      if (basis.unit && entry.units === null) needed.add(basis.unit);
    }

    setScenario({ services: scen.services, counts: scen.counts, serviceUnits: {} });
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

  // Ticking a lead ticks what comes with it, and unticking it takes them
  // back out.
  //
  // Otherwise the row would advertise a Year 1 fee of $91,380 and then add
  // $75,000 to the bar when you ticked it, which is the page disagreeing
  // with itself about the same sale. The Scope picker already works this
  // way when somebody picks a service, so a scope built here and a scope
  // built there come out the same.
  //
  // Symmetric on the way out, unlike the Scope picker's rule, which only
  // ever adds. There, unticking an auto-added service is a person saying
  // "not that one" and has to stick. Here nobody ticked them individually
  // - they arrived with the lead - so leaving them behind would leave the
  // estimate holding money for services nobody chose.
  function toggleScope(name) {
    const next = new Set(inScope);
    const withIt = (potential.bundleOf.get(name)?.adds || [])
      .filter(a => a.open).map(a => a.name);
    if (next.has(name)) {
      next.delete(name);
      for (const add of withIt) next.delete(add);
    } else {
      next.add(name);
      for (const add of withIt) next.add(add);
    }
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

  // The estimate for every service on the page, in scope or not — the fee
  // column shows what a service would add if it were ticked, which is what
  // makes the table itself answer "what would adding this cost?".
  // Taken off the potential run rather than computed again: that already
  // priced every open service, and a second pass would be a second opinion.
  const allEstimates = useMemo(
    () => new Map(potential.estimate.lines.map(l => [l.name, l])),
    [potential],
  );

  // The deal itself: only what's ticked.
  //
  // Percentage services are priced against the bundle the potential run put
  // them in, not against the ticked scope: Client management is a cut of the
  // bill payment deal it comes with whether or not somebody has ticked both
  // boxes, and re-deriving it from the scope would move the fee every time
  // an unrelated service was ticked.
  const totals = useMemo(
    () => estimateScope({
      rows: openRows, services: [...inScope], pricing, counts: effectiveCounts, bases, serviceUnits,
      dealSizeByService: potential.dealSizes,
    }),
    [openRows, inScope, pricing, effectiveCounts, bases, serviceUnits, potential],
  );
  // Whether there is a setup fee in the scope at all. Either end of it: a
  // fee quoted from nothing up to a figure is still a setup fee.
  const hasSetup = totals.setup > 0 || totals.setupHigh > 0;

  // The ticked scope as a breakdown: what each service bills in year one
  // and its share of the deal. Read off the same estimate the bar's totals
  // come from, so the panel and the headline can never disagree.
  const scopeLines = useMemo(() => scopeYear1Lines(totals), [totals]);

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
  const sharedProjects = parseMoney(effectiveCounts?.[PROJECT_UNIT]);

  // Where each count came from, by unit, so the box can say so. Three
  // answers: the company record, an import, or the user - and only the
  // first two are worth naming, because a number somebody typed came from
  // them and they know it.
  //
  // The import wins where both speak: it is the more specific claim (this
  // opp's own site count, or a saved site list) and it is what the note
  // under the bar is already describing.
  const countSources = useMemo(() => {
    const fromRecord = Object.fromEntries(Object.entries(countSourceByUnit || {})
      .filter(([, src]) => src === 'client')
      .map(([unit]) => [unit, `the ${company} record`]));
    return {
      ...fromRecord,
      ...Object.fromEntries((oppImport?.filled || []).map(f => [f.unit, f.source])),
    };
  }, [countSourceByUnit, company, oppImport]);

  // Count boxes are shown for the units the scope actually needs, so the bar
  // asks for meters on a bill-pay deal and not on a reporting one. A unit
  // that already has a number keeps its box even after the service that
  // wanted it is un-ticked — otherwise a typed figure would vanish.
  //
  // There is no deal size box among them any more. Every count on this bar
  // is a fact about the account that the page can check, and a deal size
  // was the one figure nobody could: a number typed once, sitting on the
  // bar reading like an input to the totals beside it, and quietly setting
  // the biggest line on the page. A percentage service is now a cut of the
  // bundle it is sold with - see dealSizesByBundle - which is a deal this
  // page can actually point at.

  const visibleUnits = useMemo(() => units.filter(u =>
    totals.unitsUsed.has(u.unit)
    || potential.estimate.unitsUsed.has(u.unit)
    || (effectiveCounts?.[u.unit] !== '' && effectiveCounts?.[u.unit] != null)
  ), [units, totals.unitsUsed, potential, effectiveCounts]);

  const term = search.trim().toLowerCase();
  // Every service as a table row, before the search box has its say.
  // Lead services only. An auto-added service is counted inside its lead's
  // figure, and a row of its own would count it a second time.
  const leadRows = useMemo(
    () => openRows.filter(r => !potential.bundledNames.has(r.name)),
    [openRows, potential],
  );

  const allRows = useMemo(() => leadRows
    .map(({ name, meta, bucket }) => {
      const entry = pricingFor(pricing, name, bases);
      const basis = basisFor(entry.basis, bases);
      const est = allEstimates.get(name);
      const bundle = potential.bundleOf.get(name);
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
        // What the setup lines come to under this scenario. The rates
        // themselves are rate card data and are edited there.
        setupLines: entry.setupLines,
        _setupFee: est?.setup ?? 0,
        _setupFeeHigh: est?.setupHigh ?? 0,
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
        // The money column carries the BUNDLE, because the bundle is what
        // gets sold: a lead quoted without the services its Auto-add cell
        // drags in behind it is quoted short by whatever they come to. The
        // breakdown under the row says how the figure splits, so a number
        // nobody can account for never reaches the page.
        fee: bundle?.totals.priced ? bundle.totals.fee : null,
        feeHigh: bundle?.totals.priced ? bundle.totals.feeHigh : null,
        // The lead's own share of that, for the first line of the
        // breakdown.
        _ownFee: est?.priced ? est.fee : null,
        _ownFeeHigh: est?.priced ? est.feeHigh : null,
        _adds: bundle?.adds || [],
        _kind: basis?.kind || '',
        _note: est?.note || '',
        _scoped: inScope.has(name),
        _pinned: !!pinnedNames?.has(name),
        _rank: potential.rank.get(name) ?? null,
      };
    }),
  [leadRows, pricing, bases, allEstimates, inScope, serviceUnits, pinnedNames, potential]);

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

  // Which bundles are opened up. A set of lead names rather than of row
  // ids because they are the same thing here, and a name survives the
  // table being re-sorted or searched.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleBundle = (name) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  // A bundle that is no longer on the page should not spring open when a
  // service by that name comes back.
  useEffect(() => { setExpanded(new Set()); }, [company]);

  // What the lead's Year 1 fee is made of, as a table. Bulleted lines with
  // the money beside them rather than a sentence: the question this answers
  // is "where does that figure come from", and a column of figures that
  // adds up to the one above it answers it at a glance where prose does
  // not.
  const renderBundle = useCallback((row) => {
    const share = (fee) => (row.fee > 0 && fee > 0 ? `${Math.round((fee / row.fee) * 100)}%` : '');
    const line = (name, fee, feeHigh, open, isLead) => (
      <tr key={name} className={isLead ? styles.bundleLeadRow : undefined}>
        <td className={styles.bundleCellName}>
          <span className={styles.bundleBullet}>{'\u2022'}</span>
          {name}
          {isLead && <span className={styles.bundleLeadMark}>lead</span>}
        </td>
        <td className={styles.bundleCellMoney}>
          {open
            ? (fee === null ? <span className={styles.serviceMutedCell}>no rate on the card</span>
              : formatMoneyRange(fee, feeHigh))
            : <span className={styles.serviceMutedCell}>already on the card here</span>}
        </td>
        <td className={styles.bundleCellShare}>{open && fee !== null ? share(fee) : ''}</td>
      </tr>
    );
    return (
      <div className={styles.bundlePanel}>
        <div className={styles.bundleTitle}>
          {`Sold with ${row.name}. Year 1 fee, and each service's share of it.`}
        </div>
        <table className={styles.bundleTable}>
          <tbody>
            {line(row.name, row._ownFee, row._ownFeeHigh, true, true)}
            {row._adds.map(a => line(
              a.name,
              a.open ? (a.line?.priced ? a.line.fee : null) : null,
              a.open ? (a.line?.priced ? a.line.feeHigh : null) : null,
              a.open,
              false,
            ))}
            <tr className={styles.bundleTotalRow}>
              <td className={styles.bundleCellName}>Estimated Year 1 fee</td>
              <td className={styles.bundleCellMoney}>
                {row.fee === null ? '-' : formatMoneyRange(row.fee, row.feeHigh)}
              </td>
              <td className={styles.bundleCellShare} />
            </tr>
          </tbody>
        </table>
        {/* An add-on the account has already ruled on comes with the sale
            but is not new money, so it is named and not charged for. */}
        {row._adds.some(a => !a.open) && (
          <div className={styles.bundleFoot}>
            Services already sold, quoted or ruled out here come with the deal but add nothing to it, so they are left out of the figure.
          </div>
        )}
      </div>
    );
  }, [company]);

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
      case 'rank':
        return {
          ...base,
          // A service the rate card cannot price has no rank rather than a
          // last one: it is not worth nothing, it is unknown, and that is
          // the reason to go and price it.
          getSortValue: (row) => (row._rank ?? Number.MAX_SAFE_INTEGER),
          exportValue: (row) => (row._rank ?? ''),
          render: (row) => (
            <span
              className={styles.pricingRank}
              title={row._rank
                ? `${row.name} is the ${ordinal(row._rank)} biggest untapped service on this account`
                : 'Not ranked - the rate card cannot price this service yet'}
            >{row._rank ?? '-'}</span>
          ),
        };
      case 'name':
        return {
          ...base,
          render: (row) => (
            <span className={styles.pricingNameText} title={row._adds.length
              ? `${row.name} - sold with ${row._adds.length} other ${row._adds.length === 1 ? 'service' : 'services'}. Click the arrow for the split.`
              : `${row.name} - click the row to tick it in or out of the scope`}
            >
              {row._adds.length > 0 && (
                <button
                  type="button"
                  className={styles.bundleToggle}
                  onClick={(e) => { swallow(e); toggleBundle(row.name); }}
                  title={expanded.has(row.name) ? 'Hide what comes with it' : 'Show what comes with it'}
                  aria-label={`What comes with ${row.name}`}
                  aria-expanded={expanded.has(row.name)}
                >{expanded.has(row.name) ? '\u25be' : '\u25b8'}</button>
              )}
              {row.name}
              {row._adds.length > 0 && (
                <span className={styles.bundleChip}>{`+${row._adds.length}`}</span>
              )}
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
                ? <span title={`${row.basisLabel} - set on the Services Pricing subtab`}>{row.basisLabel}</span>
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
            if (!rate) {
              return (
                <span className={styles.serviceMutedCell} title="No rate on the card yet - set one on the Services Pricing subtab.">-</span>
              );
            }
            // The rate itself, not the arithmetic: a per-unit phrase
            // repeats the figure it starts with, and the Units column
            // beside it already says what it's multiplied by. The working
            // goes in the tooltip, where it can be read in full.
            return (
              <span title={row._how
                ? `${row._how} - from the rate card on the Services Pricing subtab.`
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
                title={row._unitsOwn
                  ? `Typed in for this estimate: charged on ${row.units.toLocaleString('en-US')} ${unit}, whatever the ${row._unitLabel} box above says. It belongs to this analysis alone - no other deal and no account record moves. Clear the cell to go back to that count.`
                  : row._unitsTyped
                    ? `A standing figure on the rate card: ${row.units.toLocaleString('en-US')} ${unit} on every deal. Type here to charge this estimate on its own number instead.`
                    : `From the ${row._unitLabel} box above. Type a figure to charge this service on its own number of ${unit} in this estimate.`}
                onCommit={(v) => setServiceUnits(row.name, v)}
              />
            );
          },
        };
      // What standing the service up costs on this deal: the setup lines off
      // the rate card, with the per-unit ones following the counts above.
      // Quoted as a range when the card quotes one, exactly as the fee
      // beside it is — the two are negotiated together.
      case 'setup':
        return {
          ...base,
          getSortValue: (row) => row._setupFee,
          render: (row) => (row.setupLines.length === 0
            ? <span className={styles.serviceMutedCell} title="No setup fee on the card. Set its rates on the Services Pricing subtab.">-</span>
            : (
              <span title="Billed once on this deal. The rates are on the Services Pricing subtab.">
                {formatMoneyRange(row._setupFee, row._setupFeeHigh) || '$0'}
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
                title={`Not priced yet${row._note ? ` - ${row._note.toLowerCase()}` : ''}. Set a basis and a rate on the Services Pricing subtab.`}
              >-</span>
            )
            : (
              <span
                className={row._scoped ? styles.pricingEstScoped : undefined}
                title={row._note || 'Worked out from the rate card against the counts above'}
              >{formatMoneyRange(row.fee, row.feeHigh)}</span>
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
        {/* Rows and services are not the same number once services bundle,
            and the table's own badge counts rows - so this says both
            rather than leaving "8 rows" to argue with "12 services". */}
        <span className={styles.resultCount}>
          {term ? `${rows.length} of ${leadRows.length} rows` : `${leadRows.length} rows`}
          {leadRows.length === openRows.length ? '' : ` · ${openRows.length} services`}
          {` · ${inScope.size} in scope`}
        </span>
      </div>

      {/* The account. Everything below reads off it: its own site and meter
          figures price the services, and its Services Explored decides
          which services are on the page at all. */}
      <div className={styles.potentialBar}>
        <div className={styles.potentialPick}>
          <span className={styles.pricingBarTitle}>Account potential</span>
          <div className={styles.potentialCombo}>
            <ColumnFilterCombo
              value={company}
              onChange={setCompany}
              suggestions={companyOptions}
              label="Company"
              placeholder="Type a company…"
            />
          </div>
          {company && !client && (
            <span className={styles.potentialWarn} title="Nothing in the client list matches this name, so no counts and no service statuses could be read. The services below are priced on whatever is typed in the boxes.">
              No record for this name
            </span>
          )}
          {client && oppLoading && (
            <span className={styles.potentialNote}>Reading their opportunities…</span>
          )}
          {client && (
            <span className={styles.potentialNote}>
              {decidedSentence}
            </span>
          )}
          {company && (
            <button
              type="button"
              className={styles.showHiddenBtn}
              onClick={() => setCompany('')}
              title="Go back to the whole catalogue with nothing ruled out"
            >Clear account</button>
          )}
        </div>
        <div className={styles.pricingTotals}>
          {/* The biggest single thing left to sell them. First among the
              tiles because it is the one line of this page anybody reads
              out loud - "the biggest thing open at BRE is Rate analysis,
              two and a quarter million" - and a total alone never answers
              the question that follows it, which is "of what?". */}
          <div className={styles.potentialTop} title={potential.top
            ? `${potential.top.name} is the biggest untapped service on this account, at ${formatMoneyRange(potential.top.fee, potential.top.feeHigh)} in its first year`
            : 'Nothing here can be priced from the rate card yet'}
          >
            <span className={styles.pricingTotalLabel}>Biggest deal</span>
            {potential.top ? (
              <>
                <span className={styles.pricingTotalValue}>
                  {formatMoneyRange(potential.top.fee, potential.top.feeHigh)}
                </span>
                <span className={styles.potentialTopName}>{potential.top.name}</span>
              </>
            ) : (
              <span className={styles.potentialTopNone}>Nothing priced yet</span>
            )}
          </div>
          <div className={styles.pricingTotal}>
            <span className={styles.pricingTotalLabel}>Untapped services</span>
            <span className={styles.pricingTotalValue}>{openRows.length}</span>
          </div>
          {/* The whole account in its first year. The term total used to
              sit beside this as the headline, and it is the bigger number
              of the two - which is exactly why it went: a page read in a
              pipeline review answers one question, and answering it twice
              at two sizes is how the wrong one gets quoted. */}
          <div
            className={styles.pricingTotalMain}
            title="Every service this account has not ruled on, priced over its first twelve months. What the account is worth in year one if we sold them all of it."
          >
            <span className={styles.pricingTotalLabel}>Year 1 potential</span>
            <span className={styles.pricingTotalValueMain}>
              {formatMoneyRange(potential.estimate.year1Total, potential.estimate.year1TotalHigh) || '$0'}
            </span>
          </div>
        </div>
      </div>

      {/* What the rate card cannot answer yet. Said out loud rather than
          left as a row of dashes: an unpriced service is not worth nothing,
          it is unknown, and the total above is short by however much it
          turns out to be. */}
      {client && potential.estimate.unpriced.length > 0 && (
        <div className={styles.potentialGap}>
          {`${potential.estimate.unpriced.length} of these ${openRows.length} have no rate on the card, so the totals above leave them out: `}
          <span className={styles.potentialGapNames}>
            {potential.estimate.unpriced.slice(0, 6).join(', ')}
            {potential.estimate.unpriced.length > 6 ? `, and ${potential.estimate.unpriced.length - 6} more` : ''}
          </span>
        </div>
      )}

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
              value={effectiveCounts?.[u.unit] ?? ''}
              title={`${u.label} this estimate prices against`
                + (countSources[u.unit] ? ` - filled from ${countSources[u.unit]}.` : '.')
                + ' Editing it re-prices this estimate only: the account record and every other deal stay as they are.'}
              onCommit={(v) => setCount(u.unit, v)}
            />
          ))}
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
              implementation charge off as project work. A setup fee quoted
              as a range says so in the tooltip rather than reporting its
              low end as the figure. */}
          <div className={styles.pricingTotal}>
            <span className={styles.pricingTotalLabel}>
              {hasSetup ? 'One-off + setup' : 'One-off projects'}
            </span>
            <span
              className={styles.pricingTotalValue}
              title={hasSetup
                ? `Billed once: ${formatMoneyRange(totals.setup, totals.setupHigh)} of setup fees${totals.oneTime > totals.setup ? ` and ${formatMoney(totals.oneTime - totals.setup)} of one-off project work` : ''}.`
                : undefined}
            >{formatMoneyRange(totals.oneTime, totals.oneTimeHigh) || '$0'}</span>
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
                + (totals.ranged ? ' A range, because some of these services are quoted on a low and a high rate - each end is the sum of that end.' : '')}
            >{formatMoneyRange(totals.year1Total, totals.year1TotalHigh) || '$0'}</span>
          </div>
        </div>
      </div>

      {/* The scope, itemised. The bar above states one figure and the table
          below states a hundred and forty, and between them nothing said
          what the deal on the bar is made of: the only breakdown on the
          page was the panel under one bundle's own row, which answers for
          that bundle and not for the deal.
          So: every ticked service, biggest first, with its share of the
          first year. Setup is carried inside each line rather than beside
          it, because the question here is what the account pays in year
          one and that is one figure per service - which is also what lets
          this foot exactly to the headline it sits under. A total nobody
          can take apart is a total nobody can check. */}
      {scopeLines.length > 0 && (
        <div className={styles.scopePanel}>
          <div className={styles.bundleTitle}>
            {`This deal, service by service. What each one bills in year one${hasSetup ? ', setup included' : ''}, and its share of the deal.`}
          </div>
          <table className={styles.bundleTable}>
            <tbody>
              {scopeLines.map(line => (
                <tr key={line.name}>
                  <td className={styles.bundleCellName}>
                    <span className={styles.bundleBullet}>{'\u2022'}</span>
                    {line.name}
                    {line.setupNote && (
                      <span className={styles.scopeSetupMark} title={line.setupNote}>incl. setup</span>
                    )}
                  </td>
                  <td className={styles.bundleCellMoney}>
                    {line.priced
                      ? <span title={line.note || undefined}>{formatMoneyRange(line.year1, line.year1High) || '$0'}</span>
                      : (
                        <span className={styles.serviceMutedCell} title={line.note || undefined}>
                          no rate on the card
                        </span>
                      )}
                  </td>
                  <td className={styles.bundleCellShare}>{line.share}</td>
                </tr>
              ))}
              <tr className={styles.bundleTotalRow}>
                <td className={styles.bundleCellName}>Estimated Year 1 deal size</td>
                <td className={styles.bundleCellMoney}>
                  {formatMoneyRange(totals.year1Total, totals.year1TotalHigh) || '$0'}
                </td>
                <td className={styles.bundleCellShare} />
              </tr>
            </tbody>
          </table>
          {/* No footnote about the unpriced ones. The row says "no rate on
              the card" where the figure would be, and the warning under
              the numbers already names them once - saying it a third time
              here is how a panel starts arguing with the page it is on. */}
        </div>
      )}

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
                ? 'Projects count above, which is empty - so it comes out at $0 until one of them has a number.'
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
                return (
                  <tr key={line.name}>
                    <td className={styles.projectTableName}>{line.name}</td>
                    <td className={styles.projectTableRate}>
                      {formatRate(line.entry, bases) || <span className={styles.serviceMutedCell}>No rate set</span>}
                    </td>
                    <td className={styles.projectTableNum}>
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
          {' - ticked '}{oppImport.services}{' service'}{oppImport.services === 1 ? '' : 's'}
          {pinnedNames && ' and pinned them to the top of the table'}
          {oppImport.filled.length > 0 && (
            <>{'; filled '}{oppImport.filled.map(f => `${f.label} ${f.value.toLocaleString('en-US')} from ${f.source}`).join(', ')}</>
          )}
          {'.'}
          {oppImport.missing.length > 0 && (
            <span className={styles.oppImportGap}>
              {' Nothing on file for '}{oppImport.missing.join(', ')} - the services priced on {oppImport.missing.length === 1 ? 'it' : 'those'} count as $0 until you enter {oppImport.missing.length === 1 ? 'it' : 'them'} above.
            </span>
          )}
          {oppImport.unmatchedTokens.length > 0 && (
            <span className={styles.oppImportGap}>
              {' Nothing in the Scope matched: '}{oppImport.unmatchedTokens.join(', ')}.
            </span>
          )}
          {saved?.ok && (
            <span className={styles.oppSavedNote}>
              {' Saved to the '}{oppImport.account}{' opp - '}{formatMoneyRange(totals.year1Total, totals.year1TotalHigh) || '$0'}
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
              title="Let the pinned services fall back into the table's own order - the scope and the estimate stay as they are"
            >Unpin</button>
          )}
        </div>
      )}

      {/* Said once, under the numbers, rather than as a footnote on every
          row: a service nobody has priced contributes nothing, so the total
          is short by however many of them are ticked. */}
      {totals.unpriced.length > 0 && (
        <div className={styles.pricingWarn}>
          Not counted - no pricing basis or rate set yet on the Services Pricing subtab: {totals.unpriced.join(', ')}
        </div>
      )}

      <div className={styles.serviceTableWrap}>
        <DataTable
          tableId={DEAL_TABLE_ID}
          columns={columns}
          rows={rows}
          // Biggest prize first, because that is the question the page
          // answers. Alphabetical is what the table did as a rate card,
          // where every row was as interesting as every other; here the
          // top of the list IS the output, and a reader who has to sort a
          // column to find it has been handed a spreadsheet instead of an
          // answer. A header click still re-sorts, and the # column
          // carries the money order into whatever order that is.
          defaultSort={{ key: 'rank', direction: 'asc' }}
          alwaysVisible={['scope', 'name']}
          // The Units cell swallows its own click, so this fires for the
          // row itself — the name, the read-only cells, and the padding
          // around them. Ticking the scope is the one thing this table is
          // for, so that is what the row click does.
          onRowClick={(row) => toggleScope(row.name)}
          rowGroup={pinnedRowGroup}
          expandedRowIds={expanded}
          renderExpansion={renderBundle}
          rowClassName={(row) => [
            row._scoped ? styles.pricingRowScoped : '',
            row._pinned ? styles.pricingRowPinned : '',
          ].filter(Boolean).join(' ') || undefined}
          exportFileName="Account Potential"
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

export default AccountPotentialTab;
