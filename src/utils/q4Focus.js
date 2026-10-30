// Q4 Focus: what to work on to close the year out strong.
//
// Feeds the "Q4 Focus" tab of the Pipeline page's one-page Excel export
// (pipelineWorkbook.js). The year-end number is the YOY Annual Sales
// chart's Projected bar (annualSalesProjection, with any value pinned on
// the chart), and the tab breaks down the open deals that make up the gap
// between what is sold and that projection, each with room for its risks.
// The rest is read off numbers the report already carries - the quota, the
// renewals, the post-sale follow-ups, the flagged opps - plus the Opps tab
// records, the only place an open deal's Close Date lives. Each proposal
// says which figure it came from.
//
// Pure, with `today` passed in (scripts/q4Focus.test.mjs).
import { parseMoney, annualSalesProjection, applyProjectionOverride } from './oppsMetrics.js';
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

/** An open Opps-tab record as a Q4 deal row, or null for a closed one. */
function openDeal(r) {
  const stage = String(r?.Stage || '').trim();
  const n = STAGE_NUMBER[stage];
  if (!n) return null;
  const amount = parseMoney(r['Quoted Amount']);
  return {
    account: String(r.Account || '').trim() || '(no account)',
    opp: bfoOppNameOf(r) || String(r.Scope || '').trim() || '-',
    stage,
    stageNumber: n,
    closeDate: parseDay(r['Close Date']),
    amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : 0,
  };
}

/**
 * Everything the Q4 Focus tab shows.
 *
 * input: { today: 'YYYY-MM-DD', oppsRecords, yoyOverrides, stages,
 * quota: { target, closedYTD }, coverage: { goal, actual },
 * renewals: { rows }, postSaleFollowUp: { rows }, newOppsByMonth,
 * serviceCoverage: { rows } }
 */
export function buildQ4Focus(input) {
  const today = input.today;
  const year = Number(today.slice(0, 4));
  const q4Start = `${year}-10-01`;
  const yearEnd = `${year}-12-31`;
  const daysLeft = Math.max(0, daysBetween(today, yearEnd) + 1);
  const weeksLeft = Math.max(0, Math.ceil(daysLeft / 7));
  const records = input.oppsRecords || [];

  // The Annual Sales chart's Projected bar: sold this year plus every open
  // deal at Agreement Sent or Contracting, with the chart's pin applied.
  // Noon, so the year is the user's calendar year whatever the time zone.
  const nowMs = new Date(year, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)), 12).getTime();
  const raw = annualSalesProjection(records, { nowMs, dealFor: r => r });
  const projection = applyProjectionOverride(raw, input.yoyOverrides);
  const hasOpps = records.length > 0;
  const target = Number(input.quota?.target) || 0;
  // Sold YTD by the chart's own rule, so Sold YTD + the deals below adds up
  // to the projection. The dashboard's Closed YTD stands in without Opps.
  const soldYTD = hasOpps ? raw.soldYTD : (Number(input.quota?.closedYTD) || 0);
  const projected = hasOpps ? projection.amount : null;
  const overridden = !!projection.overridden;
  const toProjected = projected == null ? 0 : Math.max(0, projected - soldYTD);
  const gap = Math.max(0, target - soldYTD);
  const projectedShort = projected == null ? null : target - projected;

  // The open deals inside the projection: what stands between Sold YTD and
  // the projected total. Biggest first; each one's share of that gap.
  const projectionDeals = raw.deals
    .filter(r => String(r.Stage || '').trim() !== 'Sold')
    .map(openDeal).filter(Boolean)
    .map(d => ({
      ...d,
      pastDue: !!d.closeDate && d.closeDate < today,
      nextYear: !!d.closeDate && d.closeDate > yearEnd,
      share: raw.lateStageAmount ? d.amount / raw.lateStageAmount : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.account.localeCompare(b.account));
  const projectionDealsTotal = projectionDeals.reduce((s, d) => s + d.amount, 0);
  const inProjection = new Set(['Agreement Sent', 'Contracting']);

  const open = records.map(openDeal).filter(Boolean);
  // Upside: open deals dated by Dec 31 that the projection doesn't count.
  const upside = open
    .filter(d => !inProjection.has(d.stage) && d.closeDate && d.closeDate <= yearEnd)
    .map(d => ({ ...d, pastDue: d.closeDate < today }))
    .sort((a, b) => b.amount - a.amount);
  const pastDue = open.filter(d => d.closeDate && d.closeDate < today);
  // Quoted deals dated early next year: what a push could add on top.
  const nextQ1End = `${year + 1}-03-31`;
  const pullIn = open
    .filter(d => !inProjection.has(d.stage) && d.stageNumber >= 5 && d.closeDate > yearEnd && d.closeDate <= nextQ1End)
    .sort((a, b) => b.amount - a.amount);
  const undated = open.filter(d => !d.closeDate && d.stageNumber >= 5 && !inProjection.has(d.stage));

  // Sold so far this quarter, from the same records.
  let closedQ4 = 0;
  for (const r of records) {
    if (String(r?.Stage || '').trim() !== 'Sold') continue;
    const cd = parseDay(r['Close Date']);
    if (!cd || cd < q4Start || cd > yearEnd) continue;
    const amt = parseMoney(r['Quoted Amount']);
    if (typeof amt === 'number' && Number.isFinite(amt)) closedQ4 += amt;
  }

  const priorities = [];
  const add = (priority, focus, why, action) => priorities.push({ priority, focus, why, action });
  const sum = (list) => list.reduce((s, d) => s + d.amount, 0);

  // 1. The deals behind the projection.
  if (projected != null && projectionDeals.length) {
    const late = projectionDeals.filter(d => d.nextYear);
    add(
      'High',
      `Land the ${money(toProjected)} behind the ${money(projected)} projection`,
      `Sold YTD is ${money(soldYTD)}. The Annual Sales chart projects ${money(projected)}, and the ${plural(projectionDeals.length, 'deal')} at Agreement Sent or Contracting in the Projected Total table make up the difference.${late.length ? ` ${plural(late.length, 'of them is', 'of them are')} dated next year: ${names(late.map(d => d.account))}.` : ''}${overridden ? ' The projection is pinned by hand on the chart, so the deals may not add up to it exactly.' : ''}`,
      `Write the risk next to each deal in that table and work them biggest first. Any deal that cannot sign by Dec 31 comes out of the projection. About ${money(toProjected / Math.max(1, weeksLeft))} has to book each of the ${plural(weeksLeft, 'week')} left.`,
    );
  }

  // 2. The projection against the target.
  if (target > 0 && projected != null) {
    if (projectedShort > 0) {
      add(
        'High',
        `Find ${money(projectedShort)} beyond the projection to hit target`,
        `The ${money(projected)} projection is ${pct(projected / target)} of the ${money(target)} target, even if every deal in it signs.`,
        'The rest has to come from the upside deals dated this year and the pull-ins from next year (both listed below). Move a close date only when the client agrees to it.',
      );
    } else {
      add(
        'Medium',
        `Protect the projection: ${money(-projectedShort)} over target`,
        `The ${money(projected)} projection is ${pct(projected / target)} of the ${money(target)} target.`,
        'The target is made if the deals in the projection sign. Spend the time on their risks, then line up next year so January starts with signed work.',
      );
    }
  } else if (target > 0 && gap > 0) {
    add(
      'High',
      `Close the ${money(gap)} gap to target`,
      `Closed YTD is ${money(soldYTD)} of ${money(target)} (${pct(soldYTD / target)}). Load the Opps tab for the Annual Sales projection and the deals behind it.`,
      `About ${money(gap / Math.max(1, weeksLeft))} has to book each of the ${plural(weeksLeft, 'week')} left.`,
    );
  }

  // 2. Signatures.
  const agreements = projectionDeals.filter(d => d.stage === 'Agreement Sent');
  if (agreements.length) {
    add(
      'High',
      `Get ${plural(agreements.length, 'agreement')} signed`,
      `${money(sum(agreements))} of the projection sits at Agreement Sent: ${names(agreements.map(d => d.account))}.`,
      'Confirm the signer, the paperwork path (legal, procurement, PO) and the date for each. Holiday calendars close fast after mid-December.',
    );
  }

  // 3. Dates that have already gone by.
  if (pastDue.length) {
    add(
      'High',
      `Fix ${plural(pastDue.length, 'past-due close date')}`,
      `Open deals whose close date has passed: ${names(pastDue.map(d => d.account))}. Worth ${money(sum(pastDue))}.`,
      'Get a real decision date from each, then close it, move it to a real date or mark it Not Sold. A forecast built on stale dates overstates Q4.',
    );
  }

  // 4. Pull-ins.
  if (pullIn.length) {
    add(
      projectedShort > 0 ? 'High' : 'Medium',
      `Pull ${plural(pullIn.length, 'quoted deal')} into Q4`,
      `Quoted deals dated Jan to Mar ${year + 1}, outside the projection: ${names(pullIn.map(d => d.account))}. Worth ${money(sum(pullIn))}.`,
      'Ask whether a December signature helps them too (year-end budget to spend, a price hold, an earlier start). Move the close date only when they agree to it.',
    );
  }

  // 5. Late-stage with no date.
  if (undated.length) {
    add(
      'Medium',
      `Put a close date on ${plural(undated.length, 'quoted deal')}`,
      `Quoted deals with no Close Date on the Opps tab: ${names(undated.map(d => d.account))}.`,
      'Without a date they cannot be counted as upside for this year. Confirm timing with each.',
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
    target, soldYTD, gap, closedQ4,
    projected, overridden, toProjected, projectedShort,
    projectionDeals, projectionDealsTotal,
    upside,
    pullIn,
    priorities,
    plan,
  };
}
