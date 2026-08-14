// Assertion tests for the deal rollout composer. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/dealTimeline.test.mjs
//
// The thing worth testing is the sequencing. Drawing a service's steps is
// already the Timelines page's job; what's new here is deciding WHEN each
// service starts, which depends on the Dependent Rollout Services chain and
// on how long each service takes. Get that wrong and the chart is confidently
// wrong — every band drawn, every one in the wrong month — which is worse
// than not drawing it.
import {
  expandDealServices, scheduleDealServices, serviceDependencies, buildDealTimeline,
  isAgreementStep,
} from '../src/utils/dealTimeline.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}

// Services are described entirely through overrides, so the tests don't
// depend on whatever the seed catalog happens to hold.
const overrides = {
  // A ← B ← C: Meters before Monitoring before Reporting.
  'Meters': { rolloutTime: '4' },                                  // 1 month
  'Monitoring': { dependsOn: 'Meters', rolloutTime: '8' },         // 2 months
  'Reporting': { dependsOn: 'Monitoring', rolloutTime: '4' },      // 1 month
  // Independent of the chain above.
  'Audits': { rolloutTime: '12' },                                 // 3 months
  // Two prerequisites, the longer one governing.
  'Dashboards': { dependsOn: 'Meters, Audits', rolloutTime: '4' },
  // Neither a timeline nor a rollout time.
  'Mystery': {},
  // A service that lists itself.
  'Selfish': { dependsOn: 'Selfish', rolloutTime: '4' },
  // A two-service loop.
  'Loop A': { dependsOn: 'Loop B', rolloutTime: '4' },
  'Loop B': { dependsOn: 'Loop A', rolloutTime: '4' },
};

// --- dependencies come off the service metadata ---------------------------
same('a service lists its prerequisites', serviceDependencies('Dashboards', overrides), ['Meters', 'Audits']);
same('and none when it has none', serviceDependencies('Audits', overrides), []);
same('an unknown service has none', serviceDependencies('Nope', overrides), []);

// --- expansion pulls prerequisites in, transitively -----------------------
const expanded = expandDealServices(['Reporting'], overrides);
same('a deal for Reporting has to deliver three services',
  expanded.map(e => e.name), ['Reporting', 'Monitoring', 'Meters']);
same('and only the sold one is in scope',
  expanded.map(e => e.inScope), [true, false, false]);

// A service named in Scope that is also someone's prerequisite stays in scope.
const bothWays = expandDealServices(['Reporting', 'Meters'], overrides);
same('a sold service that is also a prerequisite stays in scope',
  bothWays.filter(e => e.inScope).map(e => e.name).sort(), ['Meters', 'Reporting']);
check('and is listed once', bothWays.filter(e => e.name === 'Meters').length, 1);

// Scope order and casing.
check('Scope naming the same service twice collapses it',
  expandDealServices(['Audits', 'audits'], overrides).length, 1);
check('an empty Scope expands to nothing', expandDealServices([], overrides).length, 0);
check('blank entries are ignored', expandDealServices(['', '   '], overrides).length, 0);

// A self-reference must not survive into the scheduler.
same('a service listing itself drops the self-dependency',
  expandDealServices(['Selfish'], overrides)[0].dependsOn, []);

// --- scheduling -----------------------------------------------------------
// Everything one month long, so the months ARE the chain positions.
const oneMonth = () => 1;
const chain = scheduleDealServices(expandDealServices(['Reporting'], overrides), oneMonth);
same('a three-link chain runs one service per month',
  chain.placed.map(p => [p.name, p.startMonth]),
  [['Meters', 1], ['Monitoring', 2], ['Reporting', 3]]);
check('and needs no cycle break', chain.cycleBroken, false);

// Real spans: Meters 1, Monitoring 2, Reporting 1.
const spanOf = (e) => ({ Meters: 1, Monitoring: 2, Reporting: 1, Audits: 3, Dashboards: 1 }[e.name] || 1);
const spanned = scheduleDealServices(expandDealServices(['Reporting'], overrides), spanOf);
same('a service starts the month after its prerequisite ends',
  spanned.placed.map(p => [p.name, p.startMonth, p.endMonth]),
  [['Meters', 1, 1], ['Monitoring', 2, 3], ['Reporting', 4, 4]]);

// Independent services share month 1.
const parallel = scheduleDealServices(expandDealServices(['Audits', 'Meters'], overrides), spanOf);
same('independent services both start at kickoff',
  parallel.placed.map(p => [p.name, p.startMonth]), [['Audits', 1], ['Meters', 1]]);

// The longest prerequisite governs.
const twoDeps = scheduleDealServices(expandDealServices(['Dashboards'], overrides), spanOf);
same('a service waits on its LAST prerequisite, not its first',
  twoDeps.placed.map(p => [p.name, p.startMonth, p.endMonth]),
  [['Meters', 1, 1], ['Audits', 1, 3], ['Dashboards', 4, 4]]);

// --- a dependency loop still produces a plan ------------------------------
const looped = scheduleDealServices(expandDealServices(['Loop A'], overrides), oneMonth);
check('a loop is reported', looped.cycleBroken, true);
check('and every service still gets placed', looped.placed.length, 2);
same('with the loop broken rather than collapsed onto month 1',
  looped.placed.map(p => p.startMonth), [1, 2]);

// --- the composed template ------------------------------------------------
const templates = [{
  id: 'tl-1',
  name: 'Monitoring rollout',
  services: ['Monitoring'],
  positionMode: 'months',
  format: 'phased',
  stages: [
    { id: 'st-1', name: 'Install', owner: 'Schneider Electric', startMonth: 1, months: 2, kind: 'timeline', dependsOn: '' },
    { id: 'st-2', name: 'Go live', owner: 'Both', startMonth: 3, months: 1, kind: 'milestone', dependsOn: 'st-1' },
  ],
}];

const built = buildDealTimeline({
  scopeServices: ['Monitoring'],
  templates,
  serviceOverrides: overrides,
  anchorMonth: '2026-08',
  clientName: 'Acme',
});

check('the deal pulls in the prerequisite', built.services.length, 2);
same('ordered prerequisite first', built.services.map(s => s.name), ['Meters', 'Monitoring']);
check('the prerequisite is 1 month from its 4-week Rollout Time', built.services[0].months, 1);
check('and is sized from rollout, not a timeline', built.services[0].source, 'rollout');
check('the sold service is sized from its timeline', built.services[1].source, 'template');
check('which is 3 months long', built.services[1].months, 3);
check('so it starts in month 2', built.services[1].startMonth, 2);
check('and the plan runs 4 months', built.monthsNeeded, 4);

check('the band names the prerequisite as one', built.services[0].band, 'Meters (prerequisite)');
check('and leaves a sold service unlabelled', built.services[1].band, 'Monitoring');

// The template handed to the renderers.
const t = built.template;
check('renders as the implementation format', t.format, 'phased');
check('placed by month', t.positionMode, 'months');
check('against a real calendar', t.monthMode, 'calendar');
check('anchored to the kickoff month', t.anchorMonth, '2026-08');
// Not left blank: "auto" floors at 12 columns, which would draw eight empty
// months after the last step of a four-month plan.
check('with a window fitted to the plan, plus label headroom', t.monthCount, 5);
check('carrying the client name', t.clientName, 'Acme');
// The plan starts today, so no bar in the first month may be drawn as
// already under way. Opt-in, because an ordinary timeline anchored to a
// past month has bars that really did start before today.
check('and asking the renderers not to draw work before today', t.clampBarsToToday, true);
check('with one step per prerequisite plus the template steps', t.stages.length, 3);

const install = t.stages.find(s => s.name === 'Install');
const golive = t.stages.find(s => s.name === 'Go live');
check('a template step is shifted past the prerequisite', install.startMonth, 2);
check('keeping its span', install.months, 2);
check('a milestone stays a milestone', golive.kind, 'milestone');
check('and is shifted too', golive.startMonth, 4);
check('step ids are namespaced by service', install.id, 'monitoring::st-1');
same('so a step dependency still points inside its own band',
  [golive.dependsOn], ['monitoring::st-1']);
check('authoring dates are cleared so months are the only placement', install.start, '');

// --- the agreement is signed at kickoff, not after the prerequisites ------
// The contract is what starts the engagement. Carried along by its service's
// dependency offset, a deal signed today drew its own agreement six months
// out — which is a false statement about a date the client will read.
check('an agreement step is recognised', isAgreementStep({ name: 'Agreement signed' }), true);
check('so is a contract', isAgreementStep({ name: 'Contract executed' }), true);
check('and an SOW', isAgreementStep({ name: 'SOW countersigned' }), true);
check('and a statement of work', isAgreementStep({ name: 'Statement of Work returned' }), true);
// Deliberately narrow — these are work, not paperwork.
check('a sign-off is not an agreement', isAgreementStep({ name: 'Sign-off' }), false);
check('nor is a design review', isAgreementStep({ name: 'Design review' }), false);
check('nor is an unnamed step', isAgreementStep({ name: '' }), false);

const withAgreement = [{
  id: 'tl-2', name: 'Budget timeline', services: ['Monitoring'],
  positionMode: 'months', format: 'phased',
  stages: [
    { id: 'a1', name: 'Agreement signed', owner: 'Client', startMonth: 1, months: 1, kind: 'milestone' },
    { id: 'a2', name: 'Inputs due', owner: 'Client', startMonth: 2, months: 1, kind: 'timeline', dependsOn: 'a1' },
    { id: 'a3', name: 'Delivery', owner: 'Schneider Electric', startMonth: 3, months: 1, kind: 'milestone', dependsOn: 'a2' },
  ],
}];
// Monitoring waits on Meters (1 month), so its band starts in month 2.
const pinnedPlan = buildDealTimeline({
  scopeServices: ['Monitoring'], templates: withAgreement, serviceOverrides: overrides,
  anchorMonth: '2026-08', kickoffDate: '2026-08-13',
});
const at = (n) => pinnedPlan.template.stages.find(s => s.name === n);
check('the agreement sits at kickoff', at('Agreement signed').startMonth, 1);
check('while the work still waits on the prerequisite', at('Inputs due').startMonth, 3);
check('and so does everything after it', at('Delivery').startMonth, 4);
check('the service reports that its agreement was pinned',
  pinnedPlan.services.find(s => s.name === 'Monitoring').pinnedAgreement, true);
check('a service with no agreement step says so',
  pinnedPlan.services.find(s => s.name === 'Meters').pinnedAgreement, false);
// The band still starts where its dependencies put it — pinning moves the
// contract step, not the service.
check('the band itself has not moved', pinnedPlan.services.find(s => s.name === 'Monitoring').startMonth, 2);
check('and the plan is still as long as the delivery takes', pinnedPlan.monthsNeeded, 4);

// Carrying the kickoff DAY is what puts the marker on the today line: the
// renderers place a milestone at monthDayFraction(start) across its column,
// and a dateless one lands in the middle of the month instead.
check('the pinned agreement carries the kickoff day', at('Agreement signed').start, '2026-08-13');
check('and ends the same day', at('Agreement signed').end, '2026-08-13');
check('while a work step still carries no date', at('Inputs due').start, '');
// No kickoff date given: the pin still works, the marker just centres.
check('a pin without a kickoff date is still pinned', buildDealTimeline({
  scopeServices: ['Monitoring'], templates: withAgreement, serviceOverrides: overrides,
}).template.stages.find(s => s.name === 'Agreement signed').startMonth, 1);

// With nothing to wait on, the pin changes nothing.
const noWait = buildDealTimeline({
  scopeServices: ['Audits'],
  templates: [{ id: 'x', name: 'A', services: ['Audits'], positionMode: 'months',
    stages: [{ id: 'x1', name: 'Agreement signed', startMonth: 1, months: 1 },
             { id: 'x2', name: 'Work', startMonth: 2, months: 1 }] }],
  serviceOverrides: overrides,
});
same('an unblocked service is unaffected',
  noWait.template.stages.map(s => [s.name, s.startMonth]), [['Agreement signed', 1], ['Work', 2]]);

// --- showing only what the opportunity sold -------------------------------
// The bands come out; the dates must not move. A deal doesn't deliver
// sooner because the chart stopped drawing the work it waits on.
const scoped = buildDealTimeline({
  scopeServices: ['Monitoring'],
  templates,
  serviceOverrides: overrides,
  anchorMonth: '2026-08',
  showPrerequisites: false,
});
same('only the sold service gets a band', scoped.services.map(s => s.name), ['Monitoring']);
same('and the prerequisite is reported as hidden', scoped.hidden.map(s => s.name), ['Meters']);
check('its steps are gone from the chart', scoped.template.stages.length, 2);
check('but it still starts in month 2', scoped.services[0].startMonth, 2);
same('and still says what it is waiting for', scoped.services[0].dependsOn, ['Meters']);
check('the plan is still 4 months, hidden work included', scoped.monthsNeeded, 4);
// The window follows what's drawn, not what's counted — columns past the
// last visible bar would be empty months on screen.
check('the chart is sized to the drawn bands', scoped.template.monthCount, 5);

check('showing them is still the default', buildDealTimeline({
  scopeServices: ['Monitoring'], templates, serviceOverrides: overrides,
}).services.length, 2);
same('and nothing is hidden then', buildDealTimeline({
  scopeServices: ['Monitoring'], templates, serviceOverrides: overrides,
}).hidden, []);

// A deal with no prerequisites at all is unaffected by the switch.
const noDeps = buildDealTimeline({
  scopeServices: ['Audits'], templates: [], serviceOverrides: overrides, showPrerequisites: false,
});
same('a deal with no prerequisites hides nothing', noDeps.hidden, []);
check('and keeps its own service', noDeps.services.length, 1);

// A prerequisite the Scope ALSO names is a sold service, so it stays drawn.
const alsoSold = buildDealTimeline({
  scopeServices: ['Monitoring', 'Meters'], templates, serviceOverrides: overrides, showPrerequisites: false,
});
same('a prerequisite the deal also sold keeps its band',
  alsoSold.services.map(s => s.name), ['Meters', 'Monitoring']);
same('and nothing is hidden', alsoSold.hidden, []);

// --- waiting on a STEP of a prerequisite, not all of it -------------------
// The real shape of this: Budgets doesn't need the whole Bill payment
// programme, it needs the bills actually redirected. Waiting for the tail of
// the service above — report carding, first accrual — pushed every downstream
// date out by weeks that nobody was actually waiting on.
const billing = [{
  id: 'tl-bill', name: 'Bill payment timeline', services: ['Bill payment'],
  positionMode: 'months', format: 'phased',
  stages: [
    { id: 'st-1', name: 'Project Kickoff', owner: 'Both', startMonth: 1, months: 1, kind: 'timeline' },
    { id: 'st-2', name: 'Programming & Testing', owner: 'Both', startMonth: 2, months: 2, kind: 'timeline' },
    { id: 'st-3', name: 'Bill Redirection & Go Live', owner: 'Both', startMonth: 4, months: 1, kind: 'timeline' },
    { id: 'st-4', name: 'Report Carding & First Accrual', owner: 'Both', startMonth: 5, months: 2, kind: 'timeline' },
  ],
}];
const billingOverrides = {
  'Bill payment': {},
  'Budgets whole': { dependsOn: 'Bill payment', rolloutTime: '4' },
  'Budgets step': { dependsOn: 'Bill payment > st-3', rolloutTime: '4' },
  'Budgets stale': { dependsOn: 'Bill payment > st-99', rolloutTime: '4' },
  'Budgets named': { dependsOn: 'Bill payment > Bill Redirection & Go Live', rolloutTime: '4' },
};
const planFor = (svc) => buildDealTimeline({
  scopeServices: [svc], templates: billing, serviceOverrides: billingOverrides, anchorMonth: '2026-08',
});
const startOf = (plan, name) => plan.services.find(s => s.name === name).startMonth;

// Bill payment runs months 1-6; st-3 lands in month 4.
check('the prerequisite still runs its full length', planFor('Budgets whole').services[0].endMonth, 6);
check('waiting for the whole service starts the month after it ends', startOf(planFor('Budgets whole'), 'Budgets whole'), 7);
check('waiting for a step starts the month after THAT step', startOf(planFor('Budgets step'), 'Budgets step'), 5);
// The prerequisite is untouched — refining the wait shortens the plan, it
// doesn't shorten the service being waited on.
check('and the prerequisite is unchanged by the refinement', planFor('Budgets step').services[0].endMonth, 6);
check('so the plan finishes when the longer of the two does', planFor('Budgets step').monthsNeeded, 6);
check('where waiting for all of it runs longer', planFor('Budgets whole').monthsNeeded, 7);

// A hand-typed step name resolves too, as long as it has no comma in it.
check('a step named in full resolves the same way', startOf(planFor('Budgets named'), 'Budgets named'), 5);

// A refinement pointing at a step that no longer exists must not silently
// start the service early — that would be a confidently wrong plan. It falls
// back to the whole service and says so.
check('a stale step reference waits for the whole service', startOf(planFor('Budgets stale'), 'Budgets stale'), 7);
const staleSvc = planFor('Budgets stale').services.find(s => s.name === 'Budgets stale');
same('and is reported as stale so the caller can flag it',
  staleSvc.waitsOn, [{ service: 'Bill payment', step: 'st-99', stepName: '', stale: true, until: 6, governs: true }]);

// What the caller shows in its "Waits on" column.
same('a refined dependency names the step it waits for',
  planFor('Budgets step').services.find(s => s.name === 'Budgets step').waitsOn,
  [{ service: 'Bill payment', step: 'st-3', stepName: 'Bill Redirection & Go Live', stale: false, until: 4, governs: true }]);
same('a whole-service dependency carries no step',
  planFor('Budgets whole').services.find(s => s.name === 'Budgets whole').waitsOn,
  [{ service: 'Bill payment', step: '', stepName: '', stale: false, until: 6, governs: true }]);
// The name-only view every other consumer reads is unchanged either way.
same('dependsOn stays the plain service names',
  planFor('Budgets step').services.find(s => s.name === 'Budgets step').dependsOn, ['Bill payment']);

// A service with no timeline has no steps to wait for, so a refinement
// against it degrades to the whole service rather than to nothing.
check('a refinement against a rollout-sized service waits for all of it', buildDealTimeline({
  scopeServices: ['Waiter'], templates: [], serviceOverrides: {
    ...overrides, Waiter: { dependsOn: 'Audits > st-1', rolloutTime: '4' },
  },
}).services.find(s => s.name === 'Waiter').startMonth, 4);

// Refinement decides WHEN, never WHETHER: a step-refined dependency still
// pulls its service into the plan and still orders behind it.
same('a step-refined prerequisite is still pulled in',
  planFor('Budgets step').services.map(s => s.name), ['Bill payment', 'Budgets step']);

// --- which prerequisite actually sets the start ---------------------------
// A service with five prerequisites starts after the LAST of them, so refining
// one that isn't the latest moves nothing at all. From a list of names that is
// invisible, and it reads as the refinement having been ignored — which is
// exactly how it was first reported. Every prerequisite now carries the month
// it stops blocking and whether it was the one that decided.
const crowded = {
  'Bill payment': {},
  'Slow prerequisite': { rolloutTime: '24' },   // 6 months, same as Bill payment
  'Quick prerequisite': { rolloutTime: '4' },   // 1 month
  Budgets: {
    dependsOn: 'Bill payment > st-3, Slow prerequisite, Quick prerequisite',
    rolloutTime: '4',
  },
};
const crowdedPlan = buildDealTimeline({
  scopeServices: ['Budgets'], templates: billing, serviceOverrides: crowded, anchorMonth: '2026-08',
});
const budgets = crowdedPlan.services.find(s => s.name === 'Budgets');
// Bill payment's step frees it in month 4, but the 6-month prerequisite
// doesn't until month 6 — so the refinement is applied and still not the
// constraint. This is the case that looked like a bug.
check('the refined step still frees it early', budgets.waitsOn.find(w => w.service === 'Bill payment').until, 4);
check('but a longer prerequisite decides the start', budgets.startMonth, 7);
same('and only that one is marked as governing',
  budgets.waitsOn.filter(w => w.governs).map(w => w.service), ['Slow prerequisite']);
same('every prerequisite reports the month it frees this one',
  budgets.waitsOn.map(w => [w.service, w.until]),
  [['Bill payment', 4], ['Slow prerequisite', 6], ['Quick prerequisite', 1]]);

// Refining the one that DOES govern is what moves the plan.
const fixed = buildDealTimeline({
  scopeServices: ['Budgets'], templates: billing, anchorMonth: '2026-08',
  serviceOverrides: { ...crowded, 'Slow prerequisite': { rolloutTime: '4' } },
});
check('shortening the governing prerequisite moves the start', fixed.services.find(s => s.name === 'Budgets').startMonth, 5);

// A tie marks both: neither alone is "the" reason.
const tied = buildDealTimeline({
  scopeServices: ['Budgets'], templates: [], anchorMonth: '2026-08',
  serviceOverrides: {
    A: { rolloutTime: '8' }, B: { rolloutTime: '8' },
    Budgets: { dependsOn: 'A, B', rolloutTime: '4' },
  },
});
same('two prerequisites ending together both govern',
  tied.services.find(s => s.name === 'Budgets').waitsOn.filter(w => w.governs).map(w => w.service), ['A', 'B']);

// Nothing to wait for: no governing prerequisite, and it starts at kickoff.
const free = buildDealTimeline({ scopeServices: ['Audits'], templates: [], serviceOverrides: overrides });
same('a service with no prerequisites has none governing', free.services[0].waitsOn, []);
check('and starts at kickoff', free.services[0].startMonth, 1);

// A mutual step refinement is still a cycle — both sides need the other
// placed before their step's month can be known.
const stepLoop = buildDealTimeline({
  scopeServices: ['Loop X'], templates: billing, serviceOverrides: {
    'Loop X': { dependsOn: 'Loop Y > st-1', rolloutTime: '4' },
    'Loop Y': { dependsOn: 'Loop X > st-1', rolloutTime: '4' },
  },
});
check('a step-refined loop is still reported', stepLoop.cycleBroken, true);
check('and both services still get placed', stepLoop.services.length, 2);

// --- planning from a target signature date --------------------------------
// The agreement starts the engagement, so its date is the plan's month 1.
// Moving it re-anchors the calendar; it must NOT re-shuffle the sequencing,
// which is measured in months from kickoff and knows nothing about dates.
const signedLater = buildDealTimeline({
  scopeServices: ['Monitoring'],
  templates,
  serviceOverrides: overrides,
  anchorMonth: '2027-03',
  kickoffDate: '2027-03-15',
});
const signedNow = buildDealTimeline({
  scopeServices: ['Monitoring'], templates, serviceOverrides: overrides,
  anchorMonth: '2026-08', kickoffDate: '2026-08-13',
});
check('a later signature date re-anchors the calendar', signedLater.template.anchorMonth, '2027-03');
same('but the month numbers are unchanged',
  signedLater.services.map(s => [s.name, s.startMonth, s.endMonth]),
  signedNow.services.map(s => [s.name, s.startMonth, s.endMonth]));
check('and the plan is the same length', signedLater.monthsNeeded, signedNow.monthsNeeded);

// The pinned contract step carries the signature date, which is what puts its
// marker on the day rather than in the middle of the month.
const signedPin = buildDealTimeline({
  scopeServices: ['Monitoring'],
  templates: [{ name: 'Sign then work', services: ['Monitoring'], positionMode: 'months',
    stages: [{ id: 'a', name: 'Agreement signed', startMonth: 1, months: 1 },
             { id: 'b', name: 'Work', startMonth: 2, months: 1, dependsOn: 'a' }] }],
  serviceOverrides: overrides,
  anchorMonth: '2027-03',
  kickoffDate: '2027-03-15',
});
const agreement = signedPin.template.stages.find(s => s.name === 'Agreement signed');
check('the contract step is stamped with the signature date', agreement.start, '2027-03-15');
check('and still sits at kickoff', agreement.startMonth, 1);

// Clamping first-month bars to today is right for a plan starting now and
// wrong for a back-dated one, where the early work really did happen.
check('bars are clamped to today by default', signedNow.template.clampBarsToToday, true);
check('and the caller can turn that off for a back-dated plan', buildDealTimeline({
  scopeServices: ['Audits'], templates: [], serviceOverrides: overrides,
  anchorMonth: '2024-01', kickoffDate: '2024-01-10', clampBarsToToday: false,
}).template.clampBarsToToday, false);

// --- hiding a service by name --------------------------------------------
// Clicked off the chart in the rollout popup. Exactly the same contract the
// prerequisites switch has: the band comes out, the schedule does not move.
// If hiding a service let the ones waiting on it slide forward, the popup
// would quietly rewrite the delivery plan every time someone tidied the
// chart for a screenshot — which is the one thing it must never do.
const dropped = buildDealTimeline({
  scopeServices: ['Monitoring', 'Reporting'],
  templates,
  serviceOverrides: overrides,
  anchorMonth: '2026-08',
  excludeServices: ['Monitoring'],
});
same('the hidden service loses its band',
  dropped.services.map(s => s.name), ['Meters', 'Reporting']);
same('and is reported back so the caller can list it',
  dropped.excluded.map(s => s.name), ['Monitoring']);
// Stated as "identical to the same plan with nothing hidden" rather than as
// fixed month numbers: the invariant is that hiding changes no date at all,
// and a hardcoded month would still pass if every band shifted together.
const kept = buildDealTimeline({
  scopeServices: ['Monitoring', 'Reporting'],
  templates,
  serviceOverrides: overrides,
  anchorMonth: '2026-08',
});
const months = (plan) => plan.services.map(s => [s.name, s.startMonth, s.endMonth]);
same('what waits on it does not move up',
  months(dropped), months(kept).filter(([n]) => n !== 'Monitoring'));
check('and the plan is still its full length', dropped.monthsNeeded, kept.monthsNeeded);

// Matching is on the name, case- and space-insensitively, because the caller
// is echoing back a name it read off a row.
check('hiding is case-insensitive', buildDealTimeline({
  scopeServices: ['Audits'], templates: [], serviceOverrides: overrides, excludeServices: ['  aUdItS '],
}).services.length, 0);
same('a name that is not in the plan is ignored', buildDealTimeline({
  scopeServices: ['Audits'], templates: [], serviceOverrides: overrides, excludeServices: ['Nonexistent'],
}).services.map(s => s.name), ['Audits']);
same('and nothing is excluded by default', buildDealTimeline({
  scopeServices: ['Audits'], templates: [], serviceOverrides: overrides,
}).excluded, []);

// Every service lands in exactly one bucket. A prerequisite hidden by hand
// must not ALSO be counted among the ones the prerequisites switch would
// bring back, or the "Show N prerequisites" button lies about what it does.
const both = buildDealTimeline({
  scopeServices: ['Monitoring'],
  templates,
  serviceOverrides: overrides,
  showPrerequisites: false,
  excludeServices: ['Meters'],
});
same('a prerequisite hidden by hand is reported once, as excluded', both.excluded.map(s => s.name), ['Meters']);
same('and not also as toggled-off', both.hidden, []);

// Hiding everything is allowed — the popup still has rows to click to undo it.
const allOff = buildDealTimeline({
  scopeServices: ['Audits'], templates: [], serviceOverrides: overrides, excludeServices: ['Audits'],
});
check('hiding every service draws nothing', allOff.template.stages.length, 0);
same('but the service is still listed as excluded', allOff.excluded.map(s => s.name), ['Audits']);

// `order` is what lets the popup interleave drawn and hidden rows back into
// the chart's own top-to-bottom order.
const ordered = buildDealTimeline({
  scopeServices: ['Reporting'], templates, serviceOverrides: overrides, excludeServices: ['Monitoring'],
});
same('order spans the full plan, not just the drawn bands',
  [...ordered.services, ...ordered.excluded].sort((a, b) => a.order - b.order).map(s => s.name),
  ['Meters', 'Monitoring', 'Reporting']);

// --- a service with nothing attached at all -------------------------------
const bare = buildDealTimeline({ scopeServices: ['Mystery'], templates: [], serviceOverrides: overrides });
check('an unplannable service still gets a band', bare.services.length, 1);
check('flagged as unknown', bare.services[0].source, 'unknown');
check('one month wide', bare.services[0].months, 1);
check('and says why in its description',
  /placeholder/.test(bare.template.stages[0].description), true);

// A service with a Rollout Time but no timeline rounds up to whole months.
const sixWeeks = buildDealTimeline({
  scopeServices: ['Six'], templates: [], serviceOverrides: { Six: { rolloutTime: '6' } },
});
check('6 weeks rounds up to 2 months', sixWeeks.services[0].months, 2);
check('and the bar says where the size came from',
  /Rollout Time \(6 weeks\)/.test(sixWeeks.template.stages[0].description), true);

// --- nothing to plan ------------------------------------------------------
const empty = buildDealTimeline({ scopeServices: [], templates: [], serviceOverrides: overrides });
check('no services means no stages', empty.template.stages.length, 0);
check('and no months', empty.monthsNeeded, 0);

// --- more than one timeline attached to a service -------------------------
const twoTpls = buildDealTimeline({
  scopeServices: ['Audits'],
  templates: [
    { id: 'a', name: 'Audit plan A', services: ['Audits'], positionMode: 'months', stages: [{ id: 's', name: 'Do it', startMonth: 1, months: 1 }] },
    { id: 'b', name: 'Audit plan B', services: ['Audits'], positionMode: 'months', stages: [{ id: 's', name: 'Other', startMonth: 1, months: 1 }] },
  ],
  serviceOverrides: overrides,
});
check('the first attached timeline is used', twoTpls.services[0].templateName, 'Audit plan A');
same('and the others are named so the caller can say so', twoTpls.services[0].extraTemplates, ['Audit plan B']);
check('only one timeline is drawn', twoTpls.template.stages.length, 1);


// --- a service's own groups survive into the plan -------------------------
// The band a step lands in is its SERVICE, so `phase` is spent naming that.
// The structure the service's timeline had is carried alongside as
// `subPhase`, with the colour it was given there, so the plan can show both
// levels instead of flattening a service to one undifferentiated list.
const grouped = [{
  id: 'tl-g', name: 'Grouped', services: ['Monitoring'], positionMode: 'months', format: 'phased',
  phaseColors: { 'Setup': '#0B7A3B' },
  stages: [
    { id: 'g1', name: 'Install', owner: 'Schneider Electric', phase: 'Setup', startMonth: 1, months: 1 },
    { id: 'g2', name: 'Verify', owner: 'Schneider Electric', phase: 'Setup', startMonth: 2, months: 1 },
    { id: 'g3', name: 'Loose', owner: 'Schneider Electric', phase: '', startMonth: 3, months: 1 },
  ],
}];
const withSubs = buildDealTimeline({
  scopeServices: ['Monitoring'], templates: grouped, serviceOverrides: overrides,
  anchorMonth: '2026-08',
});
const subOf = (n) => withSubs.template.stages.find(s => s.name === n);
check('the band is still the service', subOf('Install').phase, 'Monitoring');
check('and the step keeps its own group beside it', subOf('Install').subPhase, 'Setup');
check('with the colour that group had', subOf('Install').subPhaseColor, '#0B7A3B');
check('a step in no group carries no sub-group', subOf('Loose').subPhase, '');
check('and no colour for one', subOf('Loose').subPhaseColor, '');
// A prerequisite pulled in without a timeline is a single rollout bar, and has
// no group of its own to carry.
check('a service sized from rollout has no sub-group',
  withSubs.template.stages.find(s => s.id.endsWith('::rollout'))?.subPhase ?? '', '');


// --- the signature is stated, not inferred from a step's name -------------
// It used to depend on isAgreementStep matching a step called something like
// "Agreement Executed". Rename that step and the marker vanished, which is
// how a plan lost the one date every band on it is scheduled from.
const noAgreement = [{
  id: 'tl-na', name: 'No agreement step', services: ['Monitoring'],
  positionMode: 'months', format: 'phased',
  stages: [
    { id: 'n1', name: 'Project kickoff', owner: 'Schneider Electric', startMonth: 1, months: 1 },
    { id: 'n2', name: 'Delivery', owner: 'Schneider Electric', startMonth: 2, months: 1 },
  ],
}];
const stated = buildDealTimeline({
  scopeServices: ['Monitoring'], templates: noAgreement, serviceOverrides: overrides,
  anchorMonth: '2026-10', kickoffDate: '2026-10-01',
});
check('no step is taken for the contract', stated.template.stages.some(isAgreementStep), false);
check('but the plan still states where the signature is', stated.template.signatureMonth, 1);
check('and names the day', stated.template.signatureLabel, 'Contract signed 1 Oct 2026');
check('a plan with no kickoff date still marks the column',
  buildDealTimeline({ scopeServices: ['Monitoring'], templates: noAgreement, serviceOverrides: overrides, anchorMonth: '2026-10' })
    .template.signatureLabel, 'Contract signature');

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
