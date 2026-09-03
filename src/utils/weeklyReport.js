// Weekly / daily work-summary computations for the Weekly Report tab.
//
// Everything here is pure (no React, no I/O) so it can be unit-reasoned
// and reused. The caller passes in the already-loaded data blobs — the
// HubSpot activity cache, the Opps 2 records, the Daily Success goals,
// and the pipeline snapshot — plus a [start, end) millisecond window,
// and gets back structured stats + a plain-text serialization suitable
// for the clipboard and for handing to the report LLM.

// ---- Date-range helpers -------------------------------------------------

// Local midnight of an ISO (YYYY-MM-DD) or Date. Falls back to today.
function midnight(dateLike) {
  const d = dateLike instanceof Date ? new Date(dateLike) : parseIso(dateLike);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseIso(iso) {
  const [y, m, d] = String(iso || '').split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The [start, end) ms window for the ISO date's whole calendar day.
export function dayBounds(iso) {
  const start = midnight(iso).getTime();
  return { start, end: start + DAY_MS };
}

// The [start, end) ms window for the Monday–Sunday week containing the
// ISO date (weeks start Monday, the way a sales week reads).
export function weekBounds(iso) {
  const d = midnight(iso);
  const dow = d.getDay(); // 0 = Sun … 6 = Sat
  const backToMonday = (dow + 6) % 7;
  const start = d.getTime() - backToMonday * DAY_MS;
  return { start, end: start + 7 * DAY_MS };
}

// Human label for the period, e.g. "Mon Jul 6 – Sun Jul 12, 2026" for a
// week, or "Wednesday, Jul 8, 2026" for a single day.
export function periodLabel(iso, mode) {
  if (mode === 'day') {
    return parseIso(iso).toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
    });
  }
  const { start, end } = weekBounds(iso);
  const s = new Date(start);
  const e = new Date(end - DAY_MS); // inclusive Sunday
  const fmt = (dt, withYear) => dt.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}),
  });
  return `${fmt(s, false)} – ${fmt(e, true)}`;
}

function inWin(t, start, end) {
  return t != null && Number.isFinite(t) && t >= start && t < end;
}

// ---- Activity (HubSpot cache) -------------------------------------------

function tsMs(v) {
  if (v == null || v === '') return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function splitAddrs(raw) {
  return String(raw || '')
    .split(/[;,]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function hasExternal(toRaw) {
  return splitAddrs(toRaw).some(a => !a.endsWith('@se.com'));
}

// The counting rules, exported so anything that tallies the same feed
// (the Activity tab's weekly recorder) counts exactly what the Weekly
// Report's tiles count. Change a rule here and both move together.

// A send of the user's own that reached at least one address outside
// @se.com. With no workEmail set, the sender check is skipped and any
// outbound-looking record with an external recipient counts.
export function isSentExternalEmail(e, senderEmail) {
  const subj = String(e?.hs_email_subject || '').toLowerCase();
  if (subj.includes('(sample email)')) return false;
  const me = String(senderEmail || '').toLowerCase().trim();
  if (me && String(e?.hs_email_from_email || '').toLowerCase().trim() !== me) return false;
  return hasExternal(e?.hs_email_to_email);
}

// Outbound + unknown-direction calls; clearly inbound ones drop.
export function isCountedCall(c) {
  return String(c?.hs_call_direction || '').toUpperCase() !== 'INBOUND';
}

export function emailTs(e) { return tsMs(e?.hs_timestamp); }
export function callTs(c) { return tsMs(c?.hs_timestamp); }
export function meetingTs(m) { return tsMs(m?.hs_meeting_start_time || m?.hs_timestamp); }

// Sent emails, logged calls, and meetings inside the window. Emails are
// scoped to the user's own outbound (workEmail) with at least one
// external recipient — the same rule the Agents tab uses. Calls/meetings
// come straight from the HubSpot cache.
export function computeActivity(cache, senderEmail, start, end) {
  const emailsAll = Array.isArray(cache?.emails) ? cache.emails : [];
  const callsAll = Array.isArray(cache?.calls) ? cache.calls : [];
  const meetingsAll = Array.isArray(cache?.meetings) ? cache.meetings : [];
  const me = String(senderEmail || '').toLowerCase().trim();

  const emails = emailsAll.filter(e =>
    inWin(emailTs(e), start, end) && isSentExternalEmail(e, me)
  ).map(e => ({
    ts: emailTs(e),
    subject: String(e.hs_email_subject || '').trim(),
    to: splitAddrs(e.hs_email_to_email).filter(a => !a.endsWith('@se.com')),
  }));

  const calls = callsAll.filter(c =>
    inWin(callTs(c), start, end) && isCountedCall(c)
  ).map(c => ({
    ts: callTs(c),
    title: String(c.hs_call_title || '').trim(),
  }));

  const meetings = meetingsAll.filter(m =>
    inWin(meetingTs(m), start, end)
  ).map(m => ({
    ts: meetingTs(m),
    title: String(m.hs_meeting_title || '').trim(),
    outcome: String(m.hs_meeting_outcome || '').trim(),
  }));

  emails.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  calls.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  meetings.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return { emails, calls, meetings };
}

// ---- Opp changes (Opps 2 field timestamps) ------------------------------

const CLOSED_STAGES = new Set(['sold', 'not sold']);

function parseMoneyNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function oppSummary(r, extra) {
  return {
    id: r._id,
    account: String(r.Account || '').trim(),
    scope: String(r.Scope || '').trim(),
    ...extra,
  };
}

// Bucket every opp change that landed in the window by type. Change times
// come from the per-field `_fieldUpdatedAt` stamps (epoch ms), falling
// back to the row-level `_rowUpdatedAt` for un-stamped (imported) rows.
//
// "New opps" is a best-effort estimate: an opp whose earliest tracked
// timestamp lands in the window is treated as first appearing this period
// (the data model carries no dedicated creation stamp). Deals that closed
// in-window are always reported, even if the opp is also new. Other edit
// types are attributed only to opps that already existed before the
// window, to avoid double-counting a brand-new opp's initial data entry.
export function computeOppChanges(records, start, end) {
  const out = {
    newOpps: [], stageChanges: [], closed: [],
    closeDateMoves: [], amountUpdates: [], bfoTags: [],
    closedAmount: 0,
  };
  for (const r of (records || [])) {
    const stamps = (r._fieldUpdatedAt && typeof r._fieldUpdatedAt === 'object') ? r._fieldUpdatedAt : null;
    const fieldTimes = stamps
      ? Object.values(stamps).filter(t => Number.isFinite(t))
      : [];
    const rowT = Number.isFinite(r._rowUpdatedAt) ? r._rowUpdatedAt : null;
    const firstTouch = Math.min(...[...fieldTimes, ...(rowT != null ? [rowT] : [])].filter(Number.isFinite));
    const isNew = Number.isFinite(firstTouch) && inWin(firstTouch, start, end);

    const stageT = stamps ? stamps['Stage'] : null;
    const stageInWin = inWin(stageT, start, end);
    const stageVal = String(r.Stage || '').trim();
    const isClosedStage = CLOSED_STAGES.has(stageVal.toLowerCase());

    // Closed deals: always surfaced when the stage flipped to a closed
    // value inside the window.
    if (stageInWin && isClosedStage) {
      out.closed.push(oppSummary(r, { stage: stageVal, amount: String(r['Quoted Amount'] || '').trim() }));
      const amt = parseMoneyNumber(r['Quoted Amount']);
      if (amt != null) out.closedAmount += amt;
    }

    if (isNew) {
      out.newOpps.push(oppSummary(r, { stage: stageVal }));
      continue; // don't re-attribute this opp's initial data entry
    }

    if (!stamps) continue; // existing un-stamped row — nothing to attribute

    if (stageInWin && !isClosedStage) {
      out.stageChanges.push(oppSummary(r, { stage: stageVal }));
    }
    // Close-date move — skip the auto-stamp that fires alongside a
    // Sold/Not Sold close (same timestamp as the Stage stamp).
    const cdT = stamps['Close Date'];
    if (inWin(cdT, start, end) && !(stageInWin && isClosedStage && cdT === stageT)) {
      out.closeDateMoves.push(oppSummary(r, { closeDate: String(r['Close Date'] || '').trim() }));
    }
    if (inWin(stamps['Quoted Amount'], start, end)) {
      out.amountUpdates.push(oppSummary(r, { amount: String(r['Quoted Amount'] || '').trim() }));
    }
    if (inWin(stamps['BFO Link'], start, end)) {
      out.bfoTags.push(oppSummary(r, { bfo: String(r['BFO Link'] || '').trim() }));
    }
  }
  return out;
}

// ---- Goals progress -----------------------------------------------------

// Goals created and archived (completed/dropped) inside the window, plus
// the current active-goal roster ranked by priority. Goal timestamps
// (`createdAt`, `archivedAt`) are epoch ms.
export function computeGoalsProgress(goals, start, end) {
  const list = Array.isArray(goals) ? goals : [];
  const created = list.filter(g => inWin(g.createdAt, start, end));
  const archived = list.filter(g => inWin(g.archivedAt, start, end));
  const active = list
    .filter(g => !g.archivedAt)
    .sort((a, b) => {
      const pa = a.priority == null ? 9999 : a.priority;
      const pb = b.priority == null ? 9999 : b.priority;
      if (pa !== pb) return pa - pb;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  return { created, archived, active };
}

// ---- Serialization ------------------------------------------------------

const fmtMoney = (n) => (Number.isFinite(n)
  ? `$${Math.round(n).toLocaleString('en-US')}`
  : '');

// Compact plain-text block for the clipboard and as the LLM's input. Kept
// deterministic (no AI) so "copy" always works even without the network.
// `emailsSent` lets the caller pass the number it is actually showing —
// the Weekly Report falls back to the Activity tab's recording for a week
// the live feed no longer covers, and the copied text has to say the same
// thing the tile does. Omit it and the live count is used.
export function serializeReport({ label, activity, oppChanges, goals, pipelineSummary, emailsSent }) {
  const L = [];
  L.push(`WORK SUMMARY: ${label}`);
  L.push('');
  L.push('ACTIVITY');
  L.push(`- Emails sent: ${Number.isFinite(emailsSent) ? emailsSent : activity.emails.length}`);
  L.push(`- Calls: ${activity.calls.length}`);
  L.push(`- Meetings: ${activity.meetings.length}`);
  L.push('');
  L.push('OPPORTUNITY CHANGES');
  L.push(`- New opps: ${oppChanges.newOpps.length}`);
  L.push(`- Deals closed: ${oppChanges.closed.length}${oppChanges.closedAmount ? ` (${fmtMoney(oppChanges.closedAmount)} quoted)` : ''}`);
  L.push(`- Stage changes: ${oppChanges.stageChanges.length}`);
  L.push(`- Close-date moves: ${oppChanges.closeDateMoves.length}`);
  L.push(`- Amount updates: ${oppChanges.amountUpdates.length}`);
  L.push(`- BFO Opportunity Names tagged: ${oppChanges.bfoTags.length}`);
  const detail = (title, arr, fmt) => {
    if (!arr.length) return;
    L.push('');
    L.push(title);
    for (const x of arr.slice(0, 25)) L.push(`  • ${fmt(x)}`);
    if (arr.length > 25) L.push(`  • …and ${arr.length - 25} more`);
  };
  const who = (x) => [x.account, x.scope].filter(Boolean).join(': ') || `Opp ${x.id}`;
  detail('Deals closed:', oppChanges.closed, x => `${who(x)} → ${x.stage}${x.amount ? ` (${x.amount})` : ''}`);
  detail('New opps:', oppChanges.newOpps, x => `${who(x)}${x.stage ? ` (${x.stage})` : ''}`);
  detail('Stage changes:', oppChanges.stageChanges, x => `${who(x)} → ${x.stage}`);
  detail('Close-date moves:', oppChanges.closeDateMoves, x => `${who(x)}${x.closeDate ? ` → ${x.closeDate}` : ''}`);
  detail('Amount updates:', oppChanges.amountUpdates, x => `${who(x)}${x.amount ? ` → ${x.amount}` : ''}`);
  detail('BFO tags:', oppChanges.bfoTags, x => `${who(x)}${x.bfo ? ` → ${x.bfo}` : ''}`);

  L.push('');
  L.push('GOALS');
  L.push(`- Goals set this period: ${goals.created.length}`);
  L.push(`- Goals completed/closed this period: ${goals.archived.length}`);
  L.push(`- Active goals: ${goals.active.length}`);
  if (goals.active.length) {
    for (const g of goals.active.slice(0, 10)) {
      L.push(`  • ${g.priority != null ? `#${g.priority} ` : ''}${String(g.text || '').trim()}`);
    }
  }
  if (pipelineSummary && pipelineSummary.trim()) {
    L.push('');
    L.push('PIPELINE SNAPSHOT');
    L.push(pipelineSummary.trim());
  }
  return L.join('\n');
}

// Read the persisted pipeline dashboard snapshot into a few summary lines
// (all fields optional — the snapshot may not carry them). Mirrors the
// buildPipelineSummary helper the Daily Success goals flow uses.
export function pipelineSnapshotLines(pipeline) {
  if (!pipeline || typeof pipeline !== 'object') return '';
  const lines = [];
  const money = (v) => (typeof v === 'number'
    ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    : (v || ''));
  if (pipeline.quotaProgressPct != null) lines.push(`Quota progress: ${Math.round(pipeline.quotaProgressPct)}%`);
  if (pipeline.quotaSold != null) lines.push(`Quota sold YTD: ${money(pipeline.quotaSold)}`);
  if (pipeline.newOppsActual != null && pipeline.newOppsGoal != null) {
    lines.push(`New opps: ${pipeline.newOppsActual} actual vs ${pipeline.newOppsGoal} goal`);
  }
  if (pipeline.activityActual != null && pipeline.activityGoal != null) {
    lines.push(`Activity: ${pipeline.activityActual} actual vs ${pipeline.activityGoal} goal`);
  }
  return lines.join('\n');
}
