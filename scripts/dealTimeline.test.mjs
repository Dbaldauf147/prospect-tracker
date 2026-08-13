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

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
