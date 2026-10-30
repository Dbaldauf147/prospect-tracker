// Q4 Focus: what to work on to close the year out strong.
//
// Feeds the "Q4 Focus" tab of the Pipeline page's one-page Excel export
// (pipelineWorkbook.js). Everything here is read off numbers the report
// already carries - the quota, the per-stage close rates, the renewals,
// the post-sale follow-ups, the flagged opps - plus the Opps tab records,
// which are the only place an open deal's Close Date lives. No guesswork
// beyond that: each proposal says which figure it came from.
//
// Pure, with `today` passed in (scripts/q4Focus.test.mjs).
import { parseMoney } from './oppsMetrics.js';
import { bfoOppNameOf } from './pipelineFunnelData.js';

// Which numbered BFO stage an Opps-tab stage rolls up into (stageBands.js,
// with Repricing alongside Quoted the way activeStageRank places it).
const STAGE_NUMBER = {
  Lead: 3,
  Qualifying: 4, Quoting: 4,
  Quoted: 5, Repricing: 5, Contracting: 5,
  'Agreement Sent': 6,
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY = 86400000;

function parseDay(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ts = Date.parse(s);
  return Number.isNaN(ts) ? '' : ymd(new Date(ts));
}

function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
}

// Fourth Thursday of November.
function thanksgiving(year) {
  const first = new Date(year, 10, 1).getDay();
  return `${year}-11-${pad(1 + ((4 - first + 7) % 7) + 21)}`;
}

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (list, max = 4) => {
  const shown = list.slice(0, max).join(', ');
  return list.length > max ? `${shown} and ${list.length - max} more` : shown;
};

/**
 * Close odds for each numbered stage: the live actual where there is one,
 * else the goal. `stages` is the report payload's stage list.
 */
export function stageOdds(stages) {
  const out = {};
  for (const s of stages || []) {
    const n = Number(String(s?.label || '').replace(/[^0-9]/g, ''));
    if (!n) continue;
    const actual = Number(s.closeActual);
    const goal = Number(s.closeGoal);
    out[n] = Number.isFinite(actual) && actual > 0 ? actual : (Number.isFinite(goal) ? goal : 0);
  }
  return out;
}

/** An open Opps-tab record as a Q4 deal row, or null for a closed one. */
function openDeal(r, odds) {
  const stage = String(r?.Stage || '').trim();
  const n = STAGE_NUMBER[stage];
  if (!n) return null;
  const amount = parseMoney(r['Quoted Amount']);
  const amt = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const p = odds[n] ?? 0;
  return {
    account: String(r.Account || '').trim() || '(no account)',
    opp: bfoOppNameOf(r) || String(r.Scope || '').trim() || '-',
    stage,
    stageNumber: n,
    closeDate: parseDay(r['Close Date']),
    amount: amt,
    odds: p,
    weighted: amt * p,
  };
}

/**
 * Everything the Q4 Focus tab shows.
 *
 * input: { today: 'YYYY-MM-DD', oppsRecords, stages, quota: { target,
 * closedYTD }, coverage: { goal, actual }, renewals: { rows },
 * postSaleFollowUp: { rows }, newOppsByMonth, serviceCoverage: { rows } }
 */
export function buildQ4Focus(input) {
  const today = input.today;
  const year = Number(today.slice(0, 4));
  const q4Start = `${year}-10-01`;
  const yearEnd = `${year}-12-31`;
  const daysLeft = Math.max(0, daysBetween(today, yearEnd) + 1);
  const weeksLeft = Math.max(0, Math.ceil(daysLeft / 7));
  const odds = stageOdds(input.stages);

  const target = Number(input.quota?.target) || 0;
  const closedYTD = Number(input.quota?.closedYTD) || 0;
  const gap = Math.max(0, target - closedYTD);

  const open = (input.oppsRecords || []).map(r => openDeal(r, odds)).filter(Boolean);
  // Dated to close by Dec 31 - this quarter, plus anything whose date has
  // already gone by without it closing (still owed this year).
  const closeThisYear = open
    .filter(d => d.closeDate && d.closeDate <= yearEnd)
    .map(d => ({ ...d, pastDue: d.closeDate < today }))
    .sort((a, b) => b.weighted - a.weighted || b.amount - a.amount);
  const pastDue = closeThisYear.filter(d => d.pastDue);
  // Late-stage deals dated early next year: the ones a push could land in Q4.
  const nextQ1End = `${year + 1}-03-31`;
  const pullIn = open
    .filter(d => d.stageNumber >= 5 && d.closeDate > yearEnd && d.closeDate <= nextQ1End)
    .sort((a, b) => b.amount - a.amount);
  const undated = open.filter(d => !d.closeDate && d.stageNumber >= 5);

  // Sold so far this quarter, from the same records.
  let closedQ4 = 0;
  for (const r of input.oppsRecords || []) {
    if (String(r?.Stage || '').trim() !== 'Sold') continue;
    const cd = parseDay(r['Close Date']);
    if (!cd || cd < q4Start || cd > yearEnd) continue;
    const amt = parseMoney(r['Quoted Amount']);
    if (typeof amt === 'number' && Number.isFinite(amt)) closedQ4 += amt;
  }

  const weightedQ4 = closeThisYear.reduce((s, d) => s + d.weighted, 0);
  const faceQ4 = closeThisYear.reduce((s, d) => s + d.amount, 0);
  const projected = closedYTD + weightedQ4;

  const priorities = [];
  const add = (priority, focus, why, action) => priorities.push({ priority, focus, why, action });

  // 1. The number.
  if (target > 0 && gap > 0) {
    const covers = gap ? weightedQ4 / gap : 0;
    add(
      'High',
      `Close the ${money(gap)} gap to target`,
      `Closed YTD is ${money(closedYTD)} of ${money(target)} (${pct(closedYTD / target)}). The ${plural(closeThisYear.length, 'deal')} dated to close by Dec 31 are worth ${money(faceQ4)}, ${money(weightedQ4)} weighted by stage close rate, which covers ${pct(covers)} of the gap.`,
      covers >= 1
        ? `Work the Deals to Close list top down. About ${money(gap / Math.max(1, weeksLeft))} has to book each of the ${plural(weeksLeft, 'week')} left.`
        : `The weighted pipeline will not get there on its own: pull deals in from next year (below) and add upside on the biggest Stage 5 and 6 deals. About ${money(gap / Math.max(1, weeksLeft))} has to book each of the ${plural(weeksLeft, 'week')} left.`,
    );
  } else if (target > 0) {
    add(
      'Medium',
      'Target is met: bank the upside',
      `Closed YTD is ${money(closedYTD)}, ${pct(closedYTD / target)} of the ${money(target)} target.`,
      'Keep closing what is dated for this year, and line up the next-year deals so January starts with signed work rather than an empty quarter.',
    );
  }

  // 2. Signatures.
  const agreements = closeThisYear.filter(d => d.stageNumber === 6);
  if (agreements.length) {
    add(
      'High',
      `Get ${plural(agreements.length, 'agreement')} signed`,
      `${money(agreements.reduce((s, d) => s + d.amount, 0))} sits at Agreement Sent with a close date this year: ${names(agreements.map(d => d.account))}.`,
      'Confirm the signer, the paperwork path (legal, procurement, PO) and the date for each. Holiday calendars close fast after mid-December.',
    );
  }

  // 3. Dates that have already gone by.
  if (pastDue.length) {
    add(
      'High',
      `Fix ${plural(pastDue.length, 'past-due close date')}`,
      `Open deals whose close date has passed: ${names(pastDue.map(d => d.account))}. Worth ${money(pastDue.reduce((s, d) => s + d.amount, 0))}.`,
      'Get a real decision date from each, then close it, move it to a real date or mark it Not Sold. A forecast built on stale dates overstates Q4.',
    );
  }

  // 4. Pull-ins.
  if (pullIn.length) {
    add(
      gap > weightedQ4 ? 'High' : 'Medium',
      `Pull ${plural(pullIn.length, 'late-stage deal')} into Q4`,
      `Stage 5 and 6 deals dated Jan to Mar ${year + 1}: ${names(pullIn.map(d => d.account))}. Worth ${money(pullIn.reduce((s, d) => s + d.amount, 0))}.`,
      'Ask whether a December signature helps them too (year-end budget to spend, a price hold, an earlier start). Move the close date only when they agree to it.',
    );
  }

  // 5. Late-stage with no date.
  if (undated.length) {
    add(
      'Medium',
      `Put a close date on ${plural(undated.length, 'late-stage deal')}`,
      `Stage 5 and 6 deals with no Close Date on the Opps tab: ${names(undated.map(d => d.account))}.`,
      'Without a date they are left out of the Q4 forecast. Confirm timing with each.',
    );
  }

  // 6. Renewals.
  const renewals = (input.renewals?.rows || []).filter(r => Number.isFinite(Number(r.daysUntil)));
  if (renewals.length) {
    const overdue = renewals.filter(r => Number(r.daysUntil) < 0);
    add(
      overdue.length ? 'High' : 'Medium',
      `Lock in ${plural(renewals.length, 'renewal')}`,
      `Contracts expiring within ${input.renewals.windowDays || 90} days: ${names(renewals.map(r => r.company))}${overdue.length ? `. ${plural(overdue.length, 'is', 'are')} already past expiration` : ''}.`,
      'Get each renewal agreed before year end, and use the conversation to raise the next service they are not buying yet.',
    );
  }

  // 7. Stale opps.
  const stale = (input.stages || []).filter(s => s.flaggedCount > 0);
  if (stale.length) {
    const count = stale.reduce((s, x) => s + x.flaggedCount, 0);
    add(
      'Medium',
      `Push or kill ${plural(count, 'opp')} past the life goal`,
      stale.map(s => `${s.label}: ${names(s.flaggedNames || [], 3)}`).join('. ') + '.',
      'One call each: either it moves to the next stage this quarter or it comes out of the pipeline. Cleaner coverage numbers going into the new year.',
    );
  }

  // 8. Post-sale.
  const postSale = input.postSaleFollowUp?.rows || [];
  if (postSale.length) {
    add(
      'Medium',
      `Clear ${plural(postSale.length, 'post-sale follow-up')}`,
      `Sold deals with no Follow Up On Sale logged: ${names(postSale.map(r => r.client))}.`,
      'Check in on delivery and ask for the referral or the next scope while the win is fresh. These are the quickest new opps for Q1.',
    );
  }

  // 9. Pipeline for next year.
  const months = (input.newOppsByMonth || []).slice(-3);
  if (months.length) {
    const avg = months.reduce((s, m) => s + (Number(m.count) || 0), 0) / months.length;
    if (avg < 5) {
      add(
        'Medium',
        'Build the Q1 pipeline now',
        `New opps averaged ${avg.toFixed(1)} a month over ${months.map(m => m.label).join(', ')}, under the goal of 5.`,
        'Block prospecting time every week through December. Opps opened now are the ones that close in Q1 and Q2.',
      );
    }
  }
  const cov = input.coverage || {};
  if (Number(cov.goal) > 0 && Number.isFinite(Number(cov.actual)) && cov.actual !== null && Number(cov.actual) < Number(cov.goal)) {
    add(
      'Medium',
      'Raise pipeline coverage',
      `Coverage is ${Number(cov.actual).toFixed(2)}x against a ${Number(cov.goal).toFixed(2)}x goal.`,
      'Add qualified Stage 3 and 4 opps so next year does not start short.',
    );
  }

  // 10. Cross-sell.
  const services = (input.serviceCoverage?.rows || []).filter(r => r.total > 0).sort((a, b) => a.pct - b.pct);
  if (services.length) {
    const s = services[0];
    add(
      'Low',
      `Cross-sell ${s.service}`,
      `Explored with ${s.explored} of ${s.total} clients (${pct(s.pct)}), the lowest of the services you track.`,
      'Raise it in every renewal and year-end review meeting this quarter.',
    );
  }

  const rank = { High: 0, Medium: 1, Low: 2 };
  priorities.sort((a, b) => rank[a.priority] - rank[b.priority]);

  // The calendar between now and Dec 31, in the windows a year-end close
  // actually runs on.
  const tg = thanksgiving(year);
  const tgEve = `${year}-11-${pad(Number(tg.slice(8)) - 1)}`;
  const plan = [
    { from: today, to: `${year}-11-15`, focus: 'Confirm the decision date, signer and paperwork path on every deal dated this year. Fix past-due dates. Ask the pull-in question on next year’s late-stage deals.' },
    { from: `${year}-11-16`, to: tgEve, focus: 'Final proposals out. Anything still needing legal or procurement review goes to them now, before the Thanksgiving week.' },
    { from: tg, to: `${year}-12-12`, focus: 'Agreements out and signatures chased. Renewals agreed. Last call on pull-ins.' },
    { from: `${year}-12-13`, to: yearEnd, focus: 'Signatures and POs only. Decision makers start leaving around Dec 19, so the last week is for paperwork, not new asks. Book Q1 kickoff meetings.' },
  ].filter(w => w.to >= today).map(w => ({ ...w, from: w.from < today ? today : w.from }));

  return {
    year, today, daysLeft, weeksLeft,
    target, closedYTD, gap, closedQ4,
    weightedQ4, faceQ4, projected,
    deals: closeThisYear,
    pullIn,
    priorities,
    plan,
  };
}
