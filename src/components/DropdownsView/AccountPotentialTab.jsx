import { useCallback, useMemo, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { useAuth } from '../../contexts/AuthContext';
import { loadOpps2Newest } from '../../utils/opps2Store';
import { loadPricingEstimate, savePricingEstimate } from '../../utils/pricingEstimateStore';
import { ScopeLineMathModal } from './ScopeLineMathModal';
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
export function AccountPotentialTab({
  settings, updateSettings, serviceRows = [], scenario, setScenario, prospects = [],
  // The account this page is about, when the page it is embedded in already
  // knows. On the company card there is nothing to pick: the card IS the
  // account, and a combo offering to switch to somebody else's potential
  // inside their popup is a way to misread a page you did not mean to open.
  lockedCompany = null,
  // The opp store, when the host already holds it. The company card loads
  // it for its own sections and works out the same "what is still open"
  // answer for its Biggest Deal field, so it hands the records over rather
  // than letting this page read them again: two reads of the same store are
  // two chances for the card and the page to name a different deal.
  //
  // Leave the prop off and this page pulls them itself. `null` means the
  // host has them in flight, which is not the same as there being none.
  oppRecords: hostOppRecords,
}) {
  // `|| {}` so the tab still renders outside the AuthProvider (tests,
  // harnesses): with no user it reads the local opps cache and skips the
  // Firestore pull, which is exactly the right behaviour there.
  const { user } = useAuth() || {};

  // The account this page is about, when the host already knows it.
  const locked = String(lockedCompany ?? '').trim();

  // The account's own opportunities: their stages are what rules a service
  // out as sold, quoted or already in flight. Taken from the host when it
  // has them, pulled here when it doesn't - it's the whole opp store,
  // thousands of rows, so nobody reads it twice and a visit that never
  // names an account never reads it at all.
  const hostOwnsOpps = hostOppRecords !== undefined;
  const [ownOppRecords, setOwnOppRecords] = useState(null);
  const [ownOppLoading, setOwnOppLoading] = useState(false);
  const oppRecords = hostOwnsOpps ? hostOppRecords : ownOppRecords;
  const oppLoading = hostOwnsOpps ? hostOppRecords === null : ownOppLoading;

  // Which service in the scope breakdown has its working open, by name. A
  // name rather than the line itself, so the panel re-reads a live estimate:
  // edit a count with it open and the arithmetic behind it moves too.
  const [mathFor, setMathFor] = useState('');

  const pricing = useMemo(() => getServicePricing(settings), [settings?.servicePricing]);
  // The Pricing Basis vocabulary in force: the edited list when there is
  // one, the built-in eight otherwise. Everything below prices against
  // this, so a basis someone added behaves exactly like one that shipped.
  const bases = useMemo(() => resolvePricingBases(settings), [settings?.pricingBases]);
  const units = useMemo(() => pricingUnits(bases), [bases]);

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
  // What is in the box, and what everything else matches on. Two values,
  // because they are two different things: the box has to hold exactly
  // what was typed - a space in the middle of "Blue Owl" included - and
  // every lookup below wants the name without its edges. Trimming what the
  // box shows is what used to eat the space bar: "Blue " trimmed back to
  // "Blue", which equalled the value already there, so the keystroke was
  // dropped and the word could never be finished.
  // Locked to the card's own account when embedded, and whatever is in the
  // box otherwise. The scenario still carries the name either way, so the
  // scope, the counts and the saved estimate behave identically in both.
  const companyTyped = locked || String(scenario?.company ?? '');
  const company = companyTyped.trim();
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
  // open - and a service still open here is money this page is offering to
  // go and sell.
  //
  // Matched against the services this page actually prices rather than the
  // seed catalogue, so a service the user added to the board is ruled out
  // by an opp naming it exactly like a built-in one.
  //
  // Null until the records arrive: that is the same page with fewer
  // services ruled out rather than a wrong one, and the bar says it is
  // still reading them.
  const oppStages = useMemo(() => {
    if (!client || !Array.isArray(oppRecords)) return null;
    const names = serviceRows.map(r => r.name);
    return buildOppStagesByClient([client], oppRecords, names).get(client) || new Map();
  }, [client, oppRecords, serviceRows]);

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
    if (locked) return;
    const typed = String(name ?? '');
    const next = typed.trim();
    if (typed === companyTyped) return;
    // Still the same account, just spaced differently - somebody typing
    // the space in "Blue Owl", or trailing one off. Keep what is ticked:
    // wiping a scope mid-word would be a page that punishes typing.
    if (next === company) {
      setScenario(s2 => ({ ...s2, company: typed }));
      return;
    }
    // A different account changes which services are even on the page, so a
    // scope ticked against the last one is not a scope against this one.
    // The typed counts go too: sites belong to a company, and carrying one
    // account's estate onto another's page is the quiet way to price a deal
    // against the wrong estate.
    setScenario(s2 => ({ ...s2, company: typed, services: [], counts: {}, serviceUnits: {} }));
  }

  // Keep the stored estimate in step with the one on screen. Written from
  // here rather than split across the two components that hold it: the
  // scenario is the parent's state but it is only ever edited from this
  // tab, so one writer covering all of it means a reload can't come back
  // with an opp's scope and someone else's counts. Emptying the estimator
  // writes nothing and clears the record (see savePricingEstimate).
  useEffect(() => {
    // Which account it is for, so the next visit can tell whether the stored
    // estimate is the one it is looking at. There is one record and there
    // are hundreds of company cards.
    const next = {
      scenario: { company: companyTyped, services: [...inScope], counts, serviceUnits },
    };
    // A card that has only been LOOKED at has produced no estimate, and
    // writing one would throw away whatever is stored for another account.
    // Only ever skipped for somebody else's record: an emptied estimator on
    // the account the record belongs to still clears it, which is what
    // Clear scope has always done.
    if (locked) {
      const nothingHere = inScope.size === 0
        && Object.keys(counts).length === 0
        && Object.keys(serviceUnits).length === 0;
      const storedFor = String(loadPricingEstimate(user?.uid)?.scenario?.company ?? '').trim();
      if (nothingHere && storedFor && storedFor.toLowerCase() !== locked.toLowerCase()) return;
    }
    savePricingEstimate(user?.uid, next);
  }, [user?.uid, companyTyped, locked, inScope, counts, serviceUnits]);

  // The Opps 2 dataset, fetched once: what an account's opportunities imply
  // about each service's status. Pulled lazily, since it is the whole opp
  // store and a visit that only reads the rate card shouldn't be charged
  // for it.
  //
  // A failure leaves the records empty rather than stopping the page: every
  // service then reads as undecided, which is what the page shows for an
  // account with no opportunities anyway, and the rate card half of it is
  // unaffected.
  async function ensureOpps() {
    if (ownOppRecords || ownOppLoading) return;
    setOwnOppLoading(true);
    try {
      const data = await loadOpps2Newest(user?.uid);
      setOwnOppRecords(Array.isArray(data?.records) ? data.records : []);
    } catch (err) {
      console.error('Account Potential: could not load opps', err);
      setOwnOppRecords([]);
    } finally {
      setOwnOppLoading(false);
    }
  }

  // Pulled the moment the page knows which account it is about, whoever
  // said so. It used to hang off the company combo, which a card embedding
  // this page never shows - so the card priced its potential with nothing
  // ruled out by an opportunity, and offered a service already being
  // quoted as the biggest thing left to sell.
  useEffect(() => {
    if (company && !hostOwnsOpps) ensureOpps();
    // ensureOpps is re-created every render and guards itself; the account
    // changing is the only thing that should start a pull.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, hostOwnsOpps]);

  function clearScope() {
    // The per-service units go with the scope: they're this deal's slice of
    // the account, and leaving them behind would quietly re-price whatever
    // is estimated next against the last deal's numbers.
    setScenario(s => ({ ...s, services: [], serviceUnits: {} }));
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

  // The same lines with their working still attached, for the panel that
  // opens off a bullet. scopeYear1Lines trims an estimate down to what the
  // breakdown prints — a name, a figure and a share — and the rate, the
  // count and the setup line that produced the figure are exactly what the
  // popup is for, so it reads the estimate itself rather than the trimmed
  // copy. Keyed by name, which is what the estimate and the breakdown agree
  // on.
  const estimateByName = useMemo(
    () => new Map((totals.lines || []).map(l => [l.name, l])),
    [totals.lines],
  );
  // Held open by name, so a line that falls out of scope while its panel is
  // up closes it rather than going on explaining a service the deal no
  // longer has.
  const mathLine = mathFor ? estimateByName.get(mathFor) || null : null;

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

  // Where each count came from, by unit, so the box can say so. Two
  // answers, and only one of them is worth naming: a figure read off the
  // company record, or a figure somebody typed - and they know they typed
  // it.
  const countSources = useMemo(() => Object.fromEntries(
    Object.entries(countSourceByUnit || {})
      .filter(([, src]) => src === 'client')
      .map(([unit]) => [unit, `the ${company} record`]),
  ), [countSourceByUnit, company]);

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

  // Every service as a table row. Lead services only. An auto-added service is counted inside its lead's
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
      const row = {
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
        // never got as far as counting. The rate card used to sit between
        // the two with a standing figure of its own; it no longer does, and
        // nothing is left that can be typed once and charge every deal (see
        // pricingFor).
        units: ownUnits !== null ? ownUnits : (est?.units ?? null),
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
        _rank: potential.rank.get(name) ?? null,
      };
      return row;
    }),
  [leadRows, pricing, bases, allEstimates, inScope, serviceUnits, potential]);

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
          // The add-ons are NAMED in the tooltip, not just counted. A
          // service that comes with something else has no row of its own,
          // so a reader looking for it by name has nowhere to find it -
          // which reads as the page having dropped it.
          render: (row) => (
            <span className={styles.pricingNameText} title={row._adds.length
              ? `${row.name} - sold with ${row._adds.map(a => a.name).join(', ')}. Click the arrow for the split.`
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
                    <span className={row._unitsOwn ? styles.pricingUnitsTyped : undefined}>
                      {row.units.toLocaleString('en-US')}
                    </span>
                  )}
                placeholder={row._unitLabel}
                title={row._unitsOwn
                  ? `Typed in for this estimate: charged on ${row.units.toLocaleString('en-US')} ${unit}, whatever the ${row._unitLabel} box above says. It belongs to this analysis alone - no other deal and no account record moves. Clear the cell to go back to that count.`
                  : row._unit === PROJECT_UNIT && sharedProjects === null
                    ? `One ${unit.replace(/s$/, '')}, which is what a project service is charged on until somebody says otherwise. Type a figure here, or fill the ${row._unitLabel} box above, to charge this estimate on more of them.`
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
      {/* The account. Everything below reads off it: its own site and meter
          figures price the services, and its Services Explored decides
          which services are on the page at all. */}
      <div className={styles.potentialBar}>
        <div className={styles.potentialPick}>
          <span className={styles.pricingBarTitle}>Account potential</span>
          {locked ? (
            <strong className={styles.potentialLockedName} title="The account this card is about. Everything below is priced against its own figures.">
              {locked}
            </strong>
          ) : (
            <div className={styles.potentialCombo}>
              <ColumnFilterCombo
                value={companyTyped}
                onChange={setCompany}
                suggestions={companyOptions}
                label="Company"
                placeholder="Type a company…"
              />
            </div>
          )}
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
          {company && !locked && (
            <button
              type="button"
              className={styles.showHiddenBtn}
              onClick={() => setCompany('')}
              title="Go back to the whole catalogue with nothing ruled out"
            >Clear account</button>
          )}
        </div>
      </div>

      {/* The estimator. Everything in it is a scenario rather than saved
          data, so it reads left to right as one sentence: this many sites,
          on a deal this big, with these services ticked, comes to this. */}
      <div className={styles.pricingBar}>
        <div className={styles.pricingInputs}>
          <span className={styles.pricingBarTitle}>Deal estimate</span>
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
              {/* Every bullet opens its own working. The figure beside it
                  is the end of a sum whose parts are on three other
                  subtabs, and a range quoted to a client is the number
                  most likely to be challenged - so the row that states it
                  is also the way to see how it was reached. */}
              {scopeLines.map(line => (
                <tr
                  key={line.name}
                  className={styles.scopeRow}
                  role="button"
                  tabIndex={0}
                  aria-label={`How ${line.name} is priced`}
                  title={`How ${line.name} got to this figure: the rates, the counts and the setup behind it.`}
                  onClick={() => setMathFor(line.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setMathFor(line.name);
                    }
                  }}
                >
                  <td className={styles.bundleCellName}>
                    <span className={styles.bundleBullet}>{'\u2022'}</span>
                    <span className={styles.scopeRowName}>{line.name}</span>
                    {line.setupNote && (
                      <span className={styles.scopeSetupMark} title={line.setupNote}>incl. setup</span>
                    )}
                    <span className={styles.scopeRowWhy} aria-hidden="true">how?</span>
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
                ? 'Projects count above, which is empty - so each one is priced as a single project until somebody says otherwise.'
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
          rows={allRows}
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
          expandedRowIds={expanded}
          renderExpansion={renderBundle}
          rowClassName={(row) => (row._scoped ? styles.pricingRowScoped : undefined)}
          exportFileName="Account Potential"
          settings={settings}
          updateSettings={updateSettings}
          emptyMessage='The Solutions dropdown list is empty. Add services on the Services subtab and they show up here.'
        />
      </div>

      {mathLine && (
        <ScopeLineMathModal
          line={mathLine}
          dealTotal={totals.year1Total}
          bases={bases}
          onClose={() => setMathFor('')}
        />
      )}
    </>
  );
}

export default AccountPotentialTab;
