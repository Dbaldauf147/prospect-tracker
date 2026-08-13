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
import { getStageMonths, placementBaseMonth, WEEKS_PER_RELATIVE_MONTH } from './timelineDates.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();

// Comma-separated Solutions names — the shape every multi-value column in
// the app stores. Kept local rather than imported from the columnLinks JSX
// module so this file stays resolvable under plain Node.
function splitNames(value) {
  if (Array.isArray(value)) return value.map(s => String(s).trim()).filter(Boolean);
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

/** The services that must be rolled out before `name` can start. */
export function serviceDependencies(name, serviceOverrides) {
  const meta = getEffectiveServiceMetadata(String(name ?? '').trim(), serviceOverrides);
  return splitNames(meta?.dependsOn);
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
 * Returns [{ name, inScope, dependsOn }] in discovery order.
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
    const entry = { name, inScope: true, dependsOn: serviceDependencies(name, serviceOverrides) };
    byKey.set(key, entry);
    out.push(entry);
    queue.push(entry);
  }

  while (queue.length) {
    const entry = queue.shift();
    for (const dep of entry.dependsOn) {
      const key = norm(dep);
      if (!key || byKey.has(key)) continue;
      const added = { name: dep, inScope: false, dependsOn: serviceDependencies(dep, serviceOverrides) };
      byKey.set(key, added);
      out.push(added);
      queue.push(added);
    }
  }

  for (const entry of out) {
    entry.dependsOn = entry.dependsOn.filter(d => norm(d) && norm(d) !== norm(entry.name));
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
 * A dependency cycle can't be ordered, and refusing to draw anything would
 * be a worse answer than an imperfect plan. The cycle is broken at its
 * least-blocked member — that one starts as if unblocked, everything else
 * still sequences behind it — and `cycleBroken` says it happened so the
 * caller can warn.
 *
 * Returns { placed: [{ ...entry, startMonth, endMonth, months }], cycleBroken }.
 */
export function scheduleDealServices(entries, spanOf) {
  const list = Array.isArray(entries) ? entries : [];
  const byKey = new Map(list.map(e => [norm(e.name), e]));
  // Only dependencies we actually have an entry for can be waited on.
  const deps = new Map(list.map(e => [
    norm(e.name),
    (e.dependsOn || []).map(norm).filter(k => k && k !== norm(e.name) && byKey.has(k)),
  ]));

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
      const ends = deps.get(key).map(d => end.get(d)).filter(v => v != null);
      const startMonth = ends.length ? Math.max(...ends) + 1 : 1;
      const months = Math.max(1, Math.floor(Number(spanOf(entry)) || 1));
      end.set(key, startMonth + months - 1);
      placed.push({ ...entry, startMonth, months, endMonth: startMonth + months - 1 });
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

// The template attached to a service, or null. A service with more than one
// attached timeline uses the first; the caller is told so it can say which.
function templatesForService(templates, name) {
  const key = norm(name);
  return (Array.isArray(templates) ? templates : [])
    .filter(t => (t?.services || []).some(s => norm(s) === key));
}

// A template's own length in whole months, measured the same way every
// renderer measures it.
function templateMonths(tpl) {
  const stages = Array.isArray(tpl?.stages) ? tpl.stages : [];
  if (!stages.length) return 0;
  const base = placementBaseMonth(tpl, stages);
  const mode = tpl?.positionMode === 'months' ? 'months' : 'dates';
  return Math.max(...stages.map((st) => {
    const pos = getStageMonths(st, base, mode);
    return pos.month + pos.span - 1;
  }), 1);
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
 * `anchorMonth` pins month 1 to a real calendar month ('YYYY-MM'); it
 * defaults to the current month, which is what makes the chart read as
 * "starting today" and puts the today marker in the first column.
 *
 * `showPrerequisites` decides whether the services the Scope never named get
 * a band of their own. They ALWAYS drive the schedule either way — a deal
 * doesn't finish sooner because its plan stopped drawing the work it waits
 * on — so hiding them moves nothing; it only takes the bands out of the
 * chart and the rows out of the caller's summary. The service they were
 * pulled in for still lists them under `dependsOn`, which is what explains
 * why it starts when it does.
 *
 * Returns:
 *   {
 *     template,      // feed straight to buildTimelineSvg / exportTimelineXlsx
 *     services,      // the ones with a band, in start order
 *     hidden,        // prerequisites left out, [] when they're shown
 *     monthsNeeded,  // whole months of the FULL plan, hidden work included
 *     cycleBroken,   // a dependency loop had to be broken to order these
 *   }
 *
 * A service entry is { name, inScope, dependsOn, startMonth, endMonth,
 * months, band, templateName, extraTemplates, source, pinnedAgreement }.
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
} = {}) {
  const entries = expandDealServices(scopeServices, serviceOverrides);

  const attached = new Map(entries.map(e => [norm(e.name), templatesForService(templates, e.name)]));
  const spanOf = (entry) => {
    const tpl = attached.get(norm(entry.name))[0];
    return templateMonths(tpl) || rolloutMonths(entry.name, serviceOverrides) || 1;
  };
  const { placed, cycleBroken } = scheduleDealServices(entries, spanOf);

  // Built per service so a hidden band takes its own steps with it.
  const built = placed.map((entry) => {
    const stages = [];
    let pinnedAgreement = false;
    const found = attached.get(norm(entry.name));
    const tpl = found[0] || null;
    const offset = entry.startMonth - 1;
    const band = bandLabel(entry);
    const tplMonths = templateMonths(tpl);

    if (tpl && tplMonths > 0) {
      const base = placementBaseMonth(tpl, tpl.stages);
      const mode = tpl.positionMode === 'months' ? 'months' : 'dates';
      // Ids are namespaced by service: two services can carry the same
      // template, and a step-level dependsOn must not point across bands.
      const stageId = (id) => `${norm(entry.name)}::${id}`;
      for (const st of tpl.stages) {
        const pos = getStageMonths(st, base, mode);
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
          startMonth: pinned ? 1 : offset + pos.month,
          months: pos.span,
          // The step's own dates described where it sat in its template's
          // calendar, which is not where it sits in this plan, so they go.
          // A pinned agreement is the exception: it happens on a day we
          // know, and carrying that day is what lets the renderers draw its
          // marker on the today line rather than mid-month.
          start: pinned ? String(kickoffDate || '') : '',
          end: pinned ? String(kickoffDate || '') : '',
          dependsOn: st.dependsOn ? stageId(st.dependsOn) : '',
        });
      }
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
        startMonth: entry.startMonth,
        endMonth: entry.endMonth,
        months: entry.months,
        band,
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

  const shown = built.filter(b => showPrerequisites || b.service.inScope);
  const stages = shown.flatMap(b => b.stages);
  const services = shown.map(b => b.service);
  const hidden = built.filter(b => !shown.includes(b)).map(b => b.service);

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
      // The plan kicks off today, so nothing in it has started yet. Without
      // this, a bar in the first month draws from the 1st and shows work
      // already under way before the plan begins. Opt-in on the renderers
      // because a timeline anchored to a past month legitimately has bars
      // that start before today.
      clampBarsToToday: true,
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
    monthsNeeded,
    cycleBroken,
  };
}
