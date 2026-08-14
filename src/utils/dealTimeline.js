// The rollout plan a deal implies, as one timeline.
//
// A deal's Scope names services. Each of those services may have a timeline
// template attached (Dropdowns › Timelines) and may declare Dependent
// Rollout Services (Dropdowns › Services) — the things that have to be
// rolled out before it can start. Both facts already existed; nothing put
// them together. Answering "so what does delivering this deal actually look
// like, starting today" meant opening the Timelines page once per service
// and doing the sequencing in your head.
//
// This composes them into a single timeline template, which is the same
// shape the Timelines page authors — so buildTimelineSvg draws it and
// exportTimelineXlsx exports it with no new renderer and no new sheet
// writer. Each service becomes a phase band; its template's steps become
// the steps in that band, shifted to start after everything the service
// depends on has finished.
//
// Two things are deliberately pulled in that the Scope never named:
//   - Dependency services, transitively. A deal that sells B where B needs A
//     is a deal that has to deliver A, and a plan that leaves A out is wrong
//     about when B can start. They're marked so the band says which is which.
//   - A bar for a service with no template at all, sized from its Rollout
//     Time. A service with no plan still takes time, and dropping it would
//     let the services that wait on it start too early.
//
// Everything here is pure: services and templates in, a template out. No
// React, no settings access, no storage — the caller resolves those.

// Extensions included so these resolve under plain Node for the tests.
import { getEffectiveServiceMetadata, rolloutWeeks, formatRolloutWeeks } from '../data/serviceCatalog.js';
import { placeStages, placementBaseMonth, WEEKS_PER_RELATIVE_MONTH } from './timelineDates.js';
import { parseDependsOn, groupStagesByPhase } from './timelineTemplatesStore.js';
// templatesForService is shared with the step pickers, so the timeline a step
// reference resolves against is the same one the composer draws.
import { parseServiceRefs, findTemplateStepIndex, templatesForService } from './serviceStepDeps.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * The services that must be rolled out before `name` can start, as plain
 * names — a step refinement ("Bill payment > st-12") reduces to its service.
 */
export function serviceDependencies(name, serviceOverrides) {
  return serviceDependencyRefs(name, serviceOverrides).map(r => r.service);
}

/**
 * The same list, keeping the step each entry waits for: [{ service, step }],
 * `step` being '' for the usual wait-for-the-whole-service case. This is what
 * the scheduler reads; `serviceDependencies` is the name-only view every
 * other caller wants.
 */
export function serviceDependencyRefs(name, serviceOverrides) {
  const meta = getEffectiveServiceMetadata(String(name ?? '').trim(), serviceOverrides);
  return parseServiceRefs(meta?.dependsOn);
}

/**
 * Every service the deal has to deliver: the ones its Scope names, plus
 * everything those depend on, transitively.
 *
 * `inScope` separates the two — a prerequisite the deal never sold still has
 * to be planned, but it shouldn't read as something the client bought.
 *
 * Self-references are dropped: a service listed as its own dependency would
 * never become ready and would stall the scheduler.
 *
 * Returns [{ name, inScope, dependsOn, waitFor }] in discovery order.
 * `dependsOn` is the service names; `waitFor` is the same list keeping the
 * step each entry waits for, which is what the scheduler reads.
 */
export function expandDealServices(scopeNames, serviceOverrides) {
  const byKey = new Map();
  const out = [];
  const queue = [];

  for (const raw of (Array.isArray(scopeNames) ? scopeNames : [])) {
    const name = String(raw ?? '').trim();
    const key = norm(name);
    if (!key) continue;
    // A service named twice in Scope is one service, and it's in scope.
    if (byKey.has(key)) { byKey.get(key).inScope = true; continue; }
    const entry = { name, inScope: true, waitFor: serviceDependencyRefs(name, serviceOverrides) };
    byKey.set(key, entry);
    out.push(entry);
    queue.push(entry);
  }

  while (queue.length) {
    const entry = queue.shift();
    for (const ref of entry.waitFor) {
      const key = norm(ref.service);
      if (!key || byKey.has(key)) continue;
      const added = { name: ref.service, inScope: false, waitFor: serviceDependencyRefs(ref.service, serviceOverrides) };
      byKey.set(key, added);
      out.push(added);
      queue.push(added);
    }
  }

  for (const entry of out) {
    entry.waitFor = entry.waitFor.filter(r => norm(r.service) && norm(r.service) !== norm(entry.name));
    // The name-only view, which is what the schedule's readiness check, the
    // caller's "Waits on" column and every existing test read.
    entry.dependsOn = entry.waitFor.map(r => r.service);
  }
  return out;
}

/**
 * When each service can start and finish, in months from kickoff (1-based).
 *
 * A service starts the month after the last of its prerequisites ends, so a
 * chain of three one-month services runs 1, 2, 3 and two independent ones
 * both run in month 1.
 *
 * A prerequisite refined to a step is waited for only as far as that step:
 * Budgets waiting on "Bill payment > Bill Redirection & Go Live" starts the
 * month after THAT step lands, not after the whole Bill payment programme.
 * `stepEndOf(serviceName, step)` supplies where the step finishes inside its
 * own service, 1-based, and returning null falls back to the whole service —
 * which is what a renamed or deleted step does. Omit the argument entirely
 * and every dependency is whole-service, exactly as before.
 *
 * A dependency cycle can't be ordered, and refusing to draw anything would
 * be a worse answer than an imperfect plan. The cycle is broken at its
 * least-blocked member — that one starts as if unblocked, everything else
 * still sequences behind it — and `cycleBroken` says it happened so the
 * caller can warn.
 *
 * Returns { placed: [{ ...entry, startMonth, endMonth, months }], cycleBroken }.
 */
export function scheduleDealServices(entries, spanOf, stepEndOf) {
  const list = Array.isArray(entries) ? entries : [];
  const byKey = new Map(list.map(e => [norm(e.name), e]));
  // Only dependencies we actually have an entry for can be waited on. An
  // entry with no `waitFor` (a caller building entries by hand, and every
  // test that predates step refinement) reads as whole-service waits.
  const waits = new Map(list.map(e => [
    norm(e.name),
    (e.waitFor || (e.dependsOn || []).map(service => ({ service, step: '' })))
      .filter(w => norm(w.service) && norm(w.service) !== norm(e.name) && byKey.has(norm(w.service))),
  ]));
  // The name-only view the readiness check and the cycle break work on: a
  // step refinement changes WHEN a service is free, never WHETHER it is
  // ordered after the one it waits on.
  const deps = new Map([...waits].map(([k, ws]) => [k, ws.map(w => norm(w.service))]));

  // Starts as well as ends, because a step's absolute month is measured from
  // the start of the service that carries it.
  const start = new Map();
  const end = new Map();
  const placed = [];
  const remaining = new Set(byKey.keys());
  let cycleBroken = false;

  while (remaining.size > 0) {
    const ready = [...remaining].filter(k => deps.get(k).every(d => end.has(d)));
    let batch = ready;
    if (batch.length === 0) {
      cycleBroken = true;
      // Break at the member waiting on the fewest unplaced prerequisites, so
      // the rest of the cycle still sequences behind it rather than the whole
      // cycle collapsing onto month 1. Ties resolve by name, so the same
      // cycle always breaks in the same place.
      batch = [[...remaining].sort((a, b) => (
        deps.get(a).filter(d => !end.has(d)).length - deps.get(b).filter(d => !end.has(d)).length
        || a.localeCompare(b)
      ))[0]];
    }
    for (const key of batch) {
      const entry = byKey.get(key);
      // The month each prerequisite stops blocking this one: its own end
      // normally, or the end of the named step when it's been refined.
      // The month each prerequisite stops blocking this one, kept per
      // prerequisite rather than reduced on the spot. Only the latest of them
      // decides the start, and with five prerequisites on a service that is
      // not something a reader can work out from a list of names — so which
      // one it was travels back out with the plan.
      const readyFrom = waits.get(key).map((w) => {
        const dk = norm(w.service);
        const depEnd = end.get(dk);
        // Only reachable when the cycle break placed this one early; an
        // unplaced prerequisite can't hold anything back.
        if (depEnd == null) return { ...w, until: null };
        if (!w.step || typeof stepEndOf !== 'function') return { ...w, until: depEnd };
        const rel = stepEndOf(w.service, w.step);
        if (rel == null) return { ...w, until: depEnd };  // stale — wait for all of it
        // Never past the service's own end: a step can't finish after the
        // thing that contains it, and a bad number shouldn't push work out.
        return { ...w, until: Math.min(start.get(dk) + rel - 1, depEnd) };
      });
      const ends = readyFrom.map(w => w.until).filter(v => v != null);
      const blockedUntil = ends.length ? Math.max(...ends) : null;
      const startMonth = blockedUntil == null ? 1 : blockedUntil + 1;
      const months = Math.max(1, Math.floor(Number(spanOf(entry)) || 1));
      start.set(key, startMonth);
      end.set(key, startMonth + months - 1);
      placed.push({
        ...entry,
        startMonth,
        months,
        endMonth: startMonth + months - 1,
        // `governs` marks the prerequisite(s) that actually set this start.
        // Several can tie, and then they all do.
        readyFrom: readyFrom.map(w => ({ ...w, governs: w.until != null && w.until === blockedUntil })),
      });
    }
    for (const key of batch) remaining.delete(key);
  }

  // Read top-to-bottom in start order; discovery order breaks ties so the
  // services the deal actually sold stay above the prerequisites pulled in
  // for them where both start together.
  const discovery = new Map(list.map((e, i) => [norm(e.name), i]));
  placed.sort((a, b) => a.startMonth - b.startMonth
    || discovery.get(norm(a.name)) - discovery.get(norm(b.name)));
  return { placed, cycleBroken };
}

// A template's own length in whole months, measured the same way every
// renderer measures it.
function templateMonths(tpl) {
  const stages = Array.isArray(tpl?.stages) ? tpl.stages : [];
  if (!stages.length) return 0;
  return Math.max(...templatePlacements(tpl).map(pos => pos.month + pos.span - 1), 1);
}

// Where a service's own template puts its steps, sequencing the ones it
// never placed behind what they wait on — the same placement the renderers
// use. Measured here as well as drawn, so a ten-step chain makes its
// service's band ten months long instead of one, and the services waiting on
// that one start after it really finishes.
function templatePlacements(tpl) {
  const stages = Array.isArray(tpl?.stages) ? tpl.stages : [];
  if (!stages.length) return [];
  const base = placementBaseMonth(tpl, stages);
  const mode = tpl?.positionMode === 'months' ? 'months' : 'dates';
  return placeStages(stages, base, mode);
}

// A service with no timeline still takes time. Its Rollout Time is stored in
// weeks, and the chart's month is four weeks, so the bar rounds up to whole
// months — a 6-week service reads as 2 months rather than being flattened to
// one and letting whatever waits on it start a month early.
function rolloutMonths(name, serviceOverrides) {
  const meta = getEffectiveServiceMetadata(String(name ?? '').trim(), serviceOverrides);
  const weeks = rolloutWeeks(meta?.rolloutTime);
  if (weeks == null || weeks <= 0) return 0;
  return Math.max(1, Math.ceil(weeks / WEEKS_PER_RELATIVE_MONTH));
}

// A step that records the contract being signed rather than work being done.
//
// It has to be matched on the name — a template carries no other signal —
// so the test is deliberately narrow. "Sign" on its own is not enough:
// "Sign-off" is a project's end, not its start, and a looser test would
// catch "Design" too.
const AGREEMENT_STEP = /\b(agreement|contract|sow|statements? of work)\b/i;

/** True when a stage is the engagement's paperwork rather than its work. */
export function isAgreementStep(stage) {
  return AGREEMENT_STEP.test(String(stage?.name ?? ''));
}

// What the phase band is called. A prerequisite says so on the band itself:
// on the chart and in the Excel that label is the only place the distinction
// can live, and a plan that shows unsold work as sold work is misleading.
function bandLabel(entry) {
  return entry.inScope ? entry.name : `${entry.name} (prerequisite)`;
}

/**
 * The deal's services as one timeline template, kicked off this month.
 *
 * `anchorMonth` pins month 1 to a real calendar month ('YYYY-MM'). Pass the
 * current month and the chart reads as "starting today", with the today
 * marker in the first column; pass a later one and the whole plan is drawn
 * from that month, which is how a deal planned around a target signature
 * date is laid out.
 *
 * `showPrerequisites` decides whether the services the Scope never named get
 * a band of their own. They ALWAYS drive the schedule either way — a deal
 * doesn't finish sooner because its plan stopped drawing the work it waits
 * on — so hiding them moves nothing; it only takes the bands out of the
 * chart and the rows out of the caller's summary. The service they were
 * pulled in for still lists them under `dependsOn`, which is what explains
 * why it starts when it does.
 *
 * `excludeServices` drops named services from the chart the same way and for
 * the same reason: the schedule is computed over every service first, so
 * hiding one never lets the services waiting on it start earlier. It is a
 * presentation filter, not a change of plan. Matching is case-insensitive on
 * the service name, and a name that isn't in the plan is simply ignored.
 *
 * Returns:
 *   {
 *     template,      // feed straight to buildTimelineSvg / exportTimelineXlsx
 *     services,      // the ones with a band, in start order
 *     hidden,        // prerequisites left out, [] when they're shown
 *     excluded,      // services dropped by excludeServices, in start order
 *     monthsNeeded,  // whole months of the FULL plan, hidden work included
 *     cycleBroken,   // a dependency loop had to be broken to order these
 *   }
 *
 * Every service lands in exactly one of `services` / `hidden` / `excluded`.
 *
 * A service entry is { name, inScope, dependsOn, startMonth, endMonth,
 * months, band, order, templateName, extraTemplates, source, pinnedAgreement }.
 * `order` is its position in the full plan, so a caller listing the drawn and
 * the excluded together can restore the chart's own top-to-bottom order.
 * `source` is where the band's length came from: 'template' (a timeline is
 * attached), 'rollout' (no timeline, sized from Rollout Time), or 'unknown'
 * (neither — a one-month placeholder, which the caller should flag).
 * `pinnedAgreement` says the service carried a contract step, which sits at
 * kickoff rather than behind the service's prerequisites — see
 * isAgreementStep.
 */
export function buildDealTimeline({
  scopeServices = [],
  templates = [],
  serviceOverrides = null,
  anchorMonth = '',
  // The kickoff day itself, ISO. A pinned agreement is stamped with it so
  // the renderers place its marker on the day rather than in the middle of
  // the month — which is what puts it on the today line instead of a
  // fortnight away from it.
  kickoffDate = '',
  name = 'Timeline',
  clientName = '',
  showPrerequisites = true,
  excludeServices = [],
  // Whether bars in the current month are trimmed back to today. Right for a
  // plan kicking off now — nothing in it has started — and wrong for one
  // dated into the past, where work legitimately began before today. The
  // caller knows which, because it knows the kickoff date; this file stays
  // free of `new Date()` so the tests can pin every date they use.
  clampBarsToToday = true,
} = {}) {
  const entries = expandDealServices(scopeServices, serviceOverrides);

  const attached = new Map(entries.map(e => [norm(e.name), templatesForService(templates, e.name)]));
  const spanOf = (entry) => {
    const tpl = attached.get(norm(entry.name))[0];
    return templateMonths(tpl) || rolloutMonths(entry.name, serviceOverrides) || 1;
  };
  // Where a named step finishes inside its own service, 1-based, so a
  // dependency refined to a step waits only that far. Placements are memoized
  // because the scheduler asks once per dependency and a template's layout
  // costs the same every time.
  const placementCache = new Map();
  const placementsOf = (tpl) => {
    if (!placementCache.has(tpl)) placementCache.set(tpl, templatePlacements(tpl));
    return placementCache.get(tpl);
  };
  const stepEndOf = (serviceName, step) => {
    const tpl = attached.get(norm(serviceName))?.[0];
    if (!tpl) return null;  // sized from Rollout Time: it has no steps to wait for
    const i = findTemplateStepIndex(tpl, step);
    if (i < 0) return null;  // renamed or deleted — fall back to the whole service
    const pos = placementsOf(tpl)[i];
    return pos ? pos.month + pos.span - 1 : null;
  };
  const { placed, cycleBroken } = scheduleDealServices(entries, spanOf, stepEndOf);

  // Built per service so a hidden band takes its own steps with it.
  const built = placed.map((entry, order) => {
    const stages = [];
    let pinnedAgreement = false;
    const found = attached.get(norm(entry.name));
    const tpl = found[0] || null;
    const offset = entry.startMonth - 1;
    const band = bandLabel(entry);
    const tplMonths = templateMonths(tpl);

    if (tpl && tplMonths > 0) {
      const placements = templatePlacements(tpl);
      // Ids are namespaced by service: two services can carry the same
      // template, and a step-level dependsOn must not point across bands.
      const stageId = (id) => `${norm(entry.name)}::${id}`;
      // The step's own group inside its service's timeline. The band this
      // plan puts it in is the SERVICE, so `phase` is spent on that — but a
      // service's timeline has its own structure ("System Implementation",
      // "Direct Payment Service Setup"), and flattening the whole service to
      // one list threw it away. Carried across as a sub-group, with the
      // colour it was given in its own timeline, so the plan shows both
      // levels: which service, and which part of that service.
      const subColor = new Map();
      for (const g of groupStagesByPhase(tpl.stages, tpl.phaseColors)) {
        for (const { stage } of g.steps) subColor.set(stage.id, g.color || '');
      }
      tpl.stages.forEach((st, i) => {
        const pos = placements[i];
        // The agreement is signed at the start of the engagement, not after
        // the services this one waits on have been delivered. Left to the
        // dependency offset, a deal signed today drew its own contract six
        // months out. Pinning it to kickoff keeps the contract date honest;
        // the delivery steps still sit behind their prerequisites.
        const pinned = isAgreementStep(st);
        if (pinned) pinnedAgreement = true;
        stages.push({
          ...st,
          id: stageId(st.id),
          phase: band,
          subPhase: String(st.phase || '').trim(),
          subPhaseColor: subColor.get(st.id) || '',
          startMonth: pinned ? 1 : offset + pos.month,
          months: pos.span,
          // The step's own dates described where it sat in its template's
          // calendar, which is not where it sits in this plan, so they go.
          // A pinned agreement is the exception: it happens on a day we
          // know, and carrying that day is what lets the renderers draw its
          // marker on the today line rather than mid-month.
          start: pinned ? String(kickoffDate || '') : '',
          end: pinned ? String(kickoffDate || '') : '',
          // Every predecessor gets the same per-service namespacing, so a
          // step waiting on two still points at both — inside this band.
          dependsOn: parseDependsOn(st.dependsOn).map(stageId).join(', '),
        });
      });
    } else {
      const months = entry.months;
      const rollout = formatRolloutWeeks(
        getEffectiveServiceMetadata(entry.name, serviceOverrides)?.rolloutTime,
      );
      stages.push({
        id: `${norm(entry.name)}::rollout`,
        name: entry.name,
        owner: 'Schneider Electric',
        kind: 'timeline',
        phase: band,
        startMonth: offset + 1,
        months,
        start: '',
        end: '',
        timing: rollout,
        dependsOn: '',
        description: rollout
          ? `No timeline attached to this service — sized from its Rollout Time (${rollout}).`
          : 'No timeline and no Rollout Time set for this service — shown as one month as a placeholder.',
        icon: 'number',
      });
    }

    return {
      stages,
      service: {
        name: entry.name,
        inScope: entry.inScope,
        dependsOn: entry.dependsOn,
        // The same prerequisites, saying which step of each one this service
        // actually waits for. `stepName` is the step's own name where it
        // resolves; a refinement pointing at a step that no longer exists
        // comes back with `stale: true` and was scheduled as whole-service,
        // so the caller can say so rather than quietly planning something
        // else than what was authored.
        waitsOn: (entry.readyFrom || entry.waitFor || []).map((w) => {
          const tpl = attached.get(norm(w.service))?.[0];
          const i = w.step ? findTemplateStepIndex(tpl, w.step) : -1;
          const stepName = i >= 0 ? String(tpl.stages[i]?.name || '').trim() : '';
          return {
            service: w.service,
            step: w.step,
            stepName,
            stale: !!w.step && !stepName,
            // The month this one stops blocking, and whether it's the one
            // that actually set the start. Refining a prerequisite that
            // ISN'T the governing one moves nothing, and that is invisible
            // from a list of names — the caller says which is which.
            until: w.until ?? null,
            governs: !!w.governs,
          };
        }),
        startMonth: entry.startMonth,
        endMonth: entry.endMonth,
        months: entry.months,
        band,
        // Position in the full plan, so a caller showing drawn and excluded
        // services in one list can put them back in the chart's order.
        order,
        templateName: tpl?.name || '',
        // Named so the caller can say which timeline it used when a service
        // has several attached, rather than silently picking one.
        extraTemplates: found.slice(1).map(t => t.name).filter(Boolean),
        source: tplMonths > 0 ? 'template' : (rolloutMonths(entry.name, serviceOverrides) ? 'rollout' : 'unknown'),
        // This service's contract step was moved to kickoff rather than
        // drawn behind its prerequisites, which is worth saying out loud.
        pinnedAgreement,
      },
    };
  });

  // Three buckets, and every service is in exactly one: drawn, dropped by the
  // prerequisites toggle, or dropped by name. An explicit exclusion wins over
  // the toggle so a prerequisite the caller hid by hand doesn't also get
  // counted as one the toggle would bring back.
  const excludedKeys = new Set(
    (Array.isArray(excludeServices) ? excludeServices : []).map(norm).filter(Boolean),
  );
  const isExcluded = (b) => excludedKeys.has(norm(b.service.name));
  const shown = built.filter(b => !isExcluded(b) && (showPrerequisites || b.service.inScope));
  const stages = shown.flatMap(b => b.stages);
  const services = shown.map(b => b.service);
  const hidden = built.filter(b => !isExcluded(b) && !showPrerequisites && !b.service.inScope).map(b => b.service);
  const excluded = built.filter(isExcluded).map(b => b.service);

  // The plan's length, counted over every service — including any whose band
  // is hidden. Dropping the drawn work from the count would say the deal
  // delivers sooner than it does, when nothing about it moved.
  const monthsNeeded = placed.length ? Math.max(...placed.map(p => p.endMonth), 1) : 0;
  // The chart, by contrast, is sized to what it actually draws: columns past
  // the last visible bar are empty months on screen.
  const drawnMonths = stages.length
    ? Math.max(...stages.map(s => Number(s.startMonth) + Number(s.months) - 1), 1)
    : 0;

  return {
    template: {
      id: 'deal-timeline',
      name,
      format: 'phased',
      // Every step carries an explicit month, so months is the only mode
      // that can place them — the dates they were authored with belong to
      // the template's own calendar, not this plan's.
      positionMode: 'months',
      // Kickoff is a real month, so the axis is labelled with real months
      // and the renderers draw the today marker in it.
      monthMode: 'calendar',
      anchorMonth: String(anchorMonth || ''),
      // A plan kicking off today has nothing under way yet. Without this, a
      // bar in the first month draws from the 1st and shows work already
      // done before the plan begins. Opt-in on the renderers because a
      // timeline anchored to a past month legitimately has bars that start
      // before today — see the option above.
      clampBarsToToday: clampBarsToToday !== false,
      // Fitted to the plan rather than left on "auto", which floors at 12
      // months — right for a proposal chart that should read as a year,
      // wrong for a delivery plan, where five empty columns after the last
      // step read as five months of nothing scheduled.
      //
      // Plus one column of headroom: the implementation renderer writes each
      // step's name to the RIGHT of its bar, so a step finishing in the last
      // column has its label clipped off the edge of the chart. The extra
      // month is room to write in, not schedule — `monthsNeeded` is what the
      // plan actually takes, and that's the number to report.
      monthCount: drawnMonths ? drawnMonths + 1 : '',
      rangeStart: '',
      rangeEnd: '',
      clientName: String(clientName || ''),
      note: '',
      services: [],
      stages,
    },
    services,
    hidden,
    excluded,
    monthsNeeded,
    cycleBroken,
  };
}
