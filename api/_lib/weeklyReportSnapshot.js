// The one definition of what a stored/emailable Weekly Report snapshot
// looks like.
//
// The report's numbers are computed in the browser off caches that only
// exist there, so the tab publishes what it rendered and the mailer sends
// that back. Two routes accept one: api/weekly-report-schedules
// (`publishSnapshot`, on every visit to the tab) and
// api/weekly-report-send-now (a test send posts the live screen). Both run
// the payload through this builder so the two paths can't drift — a field
// the cron mails but a test send drops is exactly the bug this avoids —
// and so a posted snapshot is bounded rather than mailed as it arrived.
//
// `capturedAt` is stamped here, at the moment the tab handed the snapshot
// over. That is what the email's freshness line reads; a snapshot with no
// stamp reads "captured at an unknown time", which is what a live test
// send used to say about numbers that were seconds old.

export function clampInt(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

// Keep the stored snapshot small and predictable: it is written on every
// visit to the tab, and Firestore caps a document at ~1 MB.
export function trimList(items, max = 60, len = 300) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, max).map(v => String(v ?? '').slice(0, len));
}

const str = (v, len) => String(v ?? '').slice(0, len);
const strOrNull = (v, len) => (v ? String(v).slice(0, len) : null);

// The funnel travels as text the tab already formatted, not as raw figures:
// the email can't draw the chart, and re-deriving "$833K" server-side is a
// second copy of arithmetic that is free to disagree with the screen.
function funnelDoc(f) {
  if (!f || typeof f !== 'object') return null;
  const stages = (Array.isArray(f.stages) ? f.stages : []).slice(0, 10).map(s => ({
    label: str(s?.label, 80),
    count: clampInt(s?.count, 0, 1e9, 0),
    amount: str(s?.amount, 20),
    life: strOrNull(s?.life, 20),
    closeRate: strOrNull(s?.closeRate, 12),
  }));
  if (!stages.length) return null;
  const o = f.outcome && typeof f.outcome === 'object' ? f.outcome : null;
  return {
    caption: str(f.caption, 300),
    stages,
    outcome: o ? {
      soldLabel: str(o.soldLabel, 40) || 'Closed YTD',
      sold: strOrNull(o.sold, 20),
      weighted: strOrNull(o.weighted, 20),
      total: strOrNull(o.total, 20),
      note: strOrNull(o.note, 100),
    } : null,
  };
}

export function buildSnapshotDoc(input, auth) {
  const s = input || {};
  const oc = s.oppChanges || {};
  const g = s.goals || {};
  return {
    ownerUid: auth?.uid || null,
    ownerEmail: auth?.email || '',
    capturedAt: Date.now(),
    scope: s.scope === 'day' ? 'day' : 'week',
    periodLabel: str(s.periodLabel, 200),
    periodStart: Number.isFinite(Number(s.periodStart)) ? Number(s.periodStart) : null,
    periodEnd: Number.isFinite(Number(s.periodEnd)) ? Number(s.periodEnd) : null,
    kpiCards: (Array.isArray(s.kpiCards) ? s.kpiCards : []).slice(0, 6).map(c => ({
      label: str(c?.label, 80),
      value: str(c?.value, 40),
      status: ['ahead', 'behind'].includes(c?.status) ? c.status : null,
      chip: strOrNull(c?.chip, 40),
      lines: trimList(c?.lines, 6),
    })),
    // The note beside "Where the year stands" on the tab: these three cards
    // are the year to date, not the week the rest of the email covers.
    kpiNote: str(s.kpiNote, 120),
    funnel: funnelDoc(s.funnel),
    tiles: (Array.isArray(s.tiles) ? s.tiles : []).slice(0, 8).map(t => ({
      label: str(t?.label, 60),
      value: clampInt(t?.value, 0, 1e9, 0),
      goal: Number.isFinite(Number(t?.goal)) && Number(t.goal) > 0 ? clampInt(t.goal, 1, 1e9, 0) : null,
      // "recorded Sep 3" — where a number came from when it isn't the live
      // feed. The tile says so on screen, so it says so in the email.
      sub: strOrNull(t?.sub, 60),
      accent: t?.accent === 'green' ? 'green' : 'blue',
    })),
    oppChanges: {
      closed: trimList(oc.closed),
      newOpps: trimList(oc.newOpps),
      stageChanges: trimList(oc.stageChanges),
      closeDateMoves: trimList(oc.closeDateMoves),
      amountUpdates: trimList(oc.amountUpdates),
      bfoTags: trimList(oc.bfoTags),
    },
    goals: {
      created: trimList(g.created, 25),
      completed: trimList(g.completed, 25),
      active: trimList(g.active, 12),
    },
    narrative: str(s.narrative, 8000),
  };
}
