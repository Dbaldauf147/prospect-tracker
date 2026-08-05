// Assertion tests for the corporate disclosure deadline table. Plain Node.
// Run:  node scripts/corporateComplianceDeadlines.test.mjs
import {
  CORPORATE_MANDATE_DEADLINES, DEADLINE_JURISDICTIONS, DEADLINE_STATUS,
  STATUS_COLOR, STATUS_LABEL,
  mandateDeadlines, mandateLanes, nextMandateDeadline, statusCounts,
  quarterLabelOf, daysUntil,
} from '../src/data/corporateComplianceDeadlines.js';
import { JURISDICTION_QUESTIONS, REGULATIONS_BY_JURISDICTION } from '../src/data/corporateComplianceScreening.js';

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log('PASS ', n)) : (fail++, console.log('FAIL ', n));
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n} (got ${JSON.stringify(a)})`);

// --- shape: every milestone is complete and well-formed ---------------------
const REQUIRED = ['key', 'jurisdictionKey', 'regulation', 'mandate', 'chip', 'shortDue',
  'reportingOn', 'due', 'dueLabel', 'precision', 'status', 'requirement', 'note', 'source'];
for (const d of CORPORATE_MANDATE_DEADLINES) {
  const missing = REQUIRED.filter(f => !d[f]);
  ok(missing.length === 0, `${d.key}: all fields present${missing.length ? ` (missing ${missing})` : ''}`);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(d.due), `${d.key}: due is an ISO date`);
  ok(DEADLINE_STATUS.includes(d.status), `${d.key}: known status`);
  ok(/^https:\/\//.test(d.source), `${d.key}: https source`);
  // A chart chip wider than this collides with its neighbours in a lane.
  ok(d.chip.length <= 10, `${d.key}: chip fits the timeline (${d.chip.length} chars)`);
}
{
  const keys = CORPORATE_MANDATE_DEADLINES.map(d => d.key);
  eq(keys.length, new Set(keys).size, 'milestone keys are unique');
}

// --- the two tables agree about which jurisdictions and regulations exist ---
{
  const screeningKeys = new Set(JURISDICTION_QUESTIONS.map(q => q.key));
  const laneKeys = DEADLINE_JURISDICTIONS.map(j => j.key);
  ok(laneKeys.every(k => screeningKeys.has(k)), 'every lane maps to a screening question');
  eq(laneKeys.length, JURISDICTION_QUESTIONS.length, 'a lane for every screening question');
  for (const d of CORPORATE_MANDATE_DEADLINES) {
    const regs = (REGULATIONS_BY_JURISDICTION[d.jurisdictionKey] || []).map(r => r.regulation);
    ok(regs.includes(d.regulation), `${d.key}: regulation "${d.regulation}" exists under ${d.jurisdictionKey}`);
  }
  // Nothing screened on the page should be silently missing a deadline.
  for (const [jk, regs] of Object.entries(REGULATIONS_BY_JURISDICTION)) {
    for (const r of regs) {
      const has = CORPORATE_MANDATE_DEADLINES.some(d => d.jurisdictionKey === jk && d.regulation === r.regulation);
      ok(has, `${jk} / ${r.regulation}: has at least one dated milestone`);
    }
  }

  // Regression guard on the three rows whose `timeline` text had gone stale
  // against the regulators. A general text-vs-data rule doesn't work here —
  // the strings legitimately vary between "yearly, on the company's cycle" and
  // a named year — so these pin the specific facts that were wrong.
  // Looked up by exact name, so a rename in the data has to be mirrored
  // here. It used to throw when it missed, which took the whole file down
  // with it — every assertion below this block silently stopped running.
  // Report the miss and carry on instead.
  const timelineOf = (jk, reg) => {
    const found = (REGULATIONS_BY_JURISDICTION[jk] || []).find(r => r.regulation === reg);
    ok(!!found, `${jk}: a regulation named "${reg}" exists`);
    return found ? found.timeline : '';
  };
  {
    // Said "2026 data (reporting starts 2027)". CARB's first cycle covers
    // FY2025 and scope 1 & 2 landed on 10 Nov 2026.
    const sb253 = timelineOf('california', 'SB 253');
    ok(sb253.includes('2025') && sb253.includes('10 Nov 2026'), `SB 253 timeline names the FY2025 cycle and its date (says "${sb253}")`);
    ok(!sb253.includes('reporting starts 2027'), 'SB 253 timeline no longer claims reporting starts in 2027');

    // Said "2027 data (reporting starts 2028)". The first report was the
    // FY2025 one due 1 Jan 2026, now stayed — so the text must not assert a
    // live deadline.
    const sb261 = timelineOf('california', 'SB 261');
    ok(sb261.includes('2025') && /stayed/i.test(sb261), `SB 261 timeline names the FY2025 cycle and the stay (says "${sb261}")`);

    // Said "2026 data (reporting starts 2027)" — that mandatory phase was
    // withdrawn by CVM Resolution 244; comply-or-explain runs from 2027.
    const cvm = timelineOf('brazil', 'Brazil: CVM');
    ok(cvm.includes('2027') && /comply-or-explain/i.test(cvm), `CVM timeline describes comply-or-explain from 2027 (says "${cvm}")`);
    ok(!/^2026 data/.test(cvm), 'CVM timeline no longer claims a mandatory 2026 phase');
  }
}

// --- every status is drawable and labelled ---------------------------------
for (const s of DEADLINE_STATUS) {
  ok(/^#[0-9A-F]{6}$/i.test(STATUS_COLOR[s]), `status ${s}: has a colour`);
  ok(!!STATUS_LABEL[s], `status ${s}: has a label`);
}

// --- filtering --------------------------------------------------------------
{
  const all = mandateDeadlines(null);
  eq(all.length, CORPORATE_MANDATE_DEADLINES.length, 'null filter -> everything');
  const sortedAscending = all.every((d, i) => i === 0 || all[i - 1].due <= d.due);
  ok(sortedAscending, 'milestones come back earliest-first');

  eq(mandateDeadlines([]).length, 0, 'empty filter -> nothing');

  const ca = mandateDeadlines(['california']);
  ok(ca.length > 0 && ca.every(d => d.jurisdictionKey === 'california'), 'filter keeps only California');

  const two = mandateDeadlines(['uk', 'brazil']);
  eq([...new Set(two.map(d => d.jurisdictionKey))].sort(), ['brazil', 'uk'], 'filter keeps both jurisdictions');
  ok(mandateDeadlines(['atlantis']).length === 0, 'unknown jurisdiction -> nothing');
}

// --- lanes ------------------------------------------------------------------
{
  const lanes = mandateLanes(mandateDeadlines(null));
  eq(lanes.map(l => l.key), DEADLINE_JURISDICTIONS.map(j => j.key), 'lanes follow the screening column order');
  ok(lanes.every(l => l.items.length > 0), 'no empty lanes');
  eq(lanes.reduce((n, l) => n + l.items.length, 0), CORPORATE_MANDATE_DEADLINES.length, 'lanes hold every milestone');

  const oneLane = mandateLanes(mandateDeadlines(['mexico']));
  eq(oneLane.length, 1, 'jurisdictions with nothing to show are dropped');
  eq(mandateLanes([]).length, 0, 'no milestones -> no lanes');
}

// --- next deadline ----------------------------------------------------------
{
  const all = mandateDeadlines(null);
  const next = nextMandateDeadline(all, '2026-07-31');
  eq(next.key, 'au-g1-fy26', 'next after 31 Jul 2026 is the ASRS Group 1 lodgement');
  // Brazil's 30 Sep 2026 filing is nearer than nothing, but it is a paused
  // mandate — a live date wins over it.
  ok(next.due <= '2026-09-30', 'next is the earliest live date, not just the earliest row');

  // SB 261's stayed 1 Jan 2026 date is not "next" even on the day itself —
  // the next live submission is the 30 Apr 2026 cluster.
  eq(nextMandateDeadline(all, '2026-01-01').due, '2026-04-30', 'a 1 Jan 2026 "today" skips the stayed SB 261 date');
  eq(nextMandateDeadline(all, '2030-01-01'), null, 'nothing left -> null');
  eq(nextMandateDeadline([], '2026-07-31'), null, 'empty list -> null');

  // Only paused rows remain -> fall back rather than report "nothing".
  const paused = all.filter(d => d.status === 'paused' && d.due > '2027-01-01');
  ok(nextMandateDeadline(paused, '2027-01-01') !== null, 'falls back to a paused date when it is all there is');
}

// --- status counts ----------------------------------------------------------
{
  const counts = statusCounts(mandateDeadlines(null));
  eq(Object.keys(counts).sort(), [...DEADLINE_STATUS].sort(), 'every status is keyed, even at zero');
  eq(Object.values(counts).reduce((a, b) => a + b, 0), CORPORATE_MANDATE_DEADLINES.length, 'counts sum to the total');
  eq(statusCounts([]).fixed, 0, 'empty list counts zero');
}

// --- date helpers -----------------------------------------------------------
eq(quarterLabelOf('2026-11-10'), 'Q4 2026', 'Nov 2026 -> Q4 2026');
eq(quarterLabelOf('2026-01-01'), 'Q1 2026', 'Jan 2026 -> Q1 2026');
eq(quarterLabelOf('2026-09-30'), 'Q3 2026', 'Sep 2026 -> Q3 2026');
eq(quarterLabelOf(''), '', 'no date -> no quarter label');
eq(daysUntil('2026-08-10', '2026-07-31'), 10, 'daysUntil counts forward');
eq(daysUntil('2026-07-01', '2026-07-31'), -30, 'daysUntil goes negative once passed');
eq(daysUntil('2026-07-31', '2026-07-31'), 0, 'same day -> 0');
eq(daysUntil('nope', '2026-07-31'), null, 'unparseable date -> null');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
