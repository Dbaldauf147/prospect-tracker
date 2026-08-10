// Prospecting tab — the ranked order of prospecting work. The list is the
// point: start at the top and only move down once the step above is clear,
// so the warmest paths in get worked before the coldest ones.
//
// Each step links to the tab where that work actually happens, so the page
// is a starting point for the day rather than a wall of text. Editing the
// playbook means editing PROSPECTING_STEPS — nothing else reads the order.
//
// The Status column answers the question the ladder implies but didn't
// answer: is this step clear? Steps with a real number behind them
// (overdue Call Ins, client renewals still needing a status) categorize
// themselves; the rest the user marks caught up for the day. See
// utils/prospectingStatus.js for why a manual mark expires overnight.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { loadOpps2Newest } from '../../utils/opps2Store';
import { countOverdueCallIns } from '../../utils/oppsCallIn';
import {
  categorizeStep,
  caughtUpSnapshot,
  countRenewalWork,
  countServiceGaps,
  isMarkedCaughtUp,
  readCaughtUpSnapshot,
  setStepCaughtUp,
  subscribeCaughtUp,
} from '../../utils/prospectingStatus';
import { useAuth } from '../../contexts/AuthContext';

const PROSPECTING_STEPS = [
  {
    key: 'opps',
    title: 'Follow up on current opps',
    detail: 'Opportunities already in flight. Nothing new gets worked until these are moving.',
    view: 'opps2',
    viewLabel: 'Opps',
    // Steps carrying a `workLabel` are counted for the user; the rest are
    // marked caught up by hand.
    workLabel: n => `${n} overdue`,
    workTitle: n => `${n} open ${n === 1 ? 'opp is' : 'opps are'} past their Call In date`,
    clearTitle: 'No open opp is past its Call In date',
  },
  {
    key: 'market-updates',
    title: 'Reach out to contacts with market updates',
    detail: 'Give the contacts you already know a reason to reply: what the market is doing right now.',
    view: 'contacts',
    viewLabel: 'Contacts',
  },
  {
    key: 'renewals',
    title: 'Follow up with current client renewals',
    detail: 'Contracts coming up on clients you already hold — the shortest path to the next conversation.',
    view: 'clients',
    viewLabel: 'Clients',
    workLabel: n => `${n} to work`,
    workTitle: n => `${n} client ${n === 1 ? 'renewal needs' : 'renewals need'} attention: expired, or renewing soon with no Renewal Status set`,
    clearTitle: 'No client renewal is expired or waiting on a Renewal Status',
  },
  {
    key: 'targeted-services',
    title: 'Reach out to existing clients for targeted services',
    detail: 'Services an existing client has not explored yet. The relationship is already there.',
    view: 'clients',
    viewLabel: 'Clients',
    workLabel: n => `${n} service${n === 1 ? '' : 's'}`,
    workTitle: n => `${n} tracked ${n === 1 ? 'service is' : 'services are'} below 100% coverage across your active clients`,
    clearTitle: 'Every tracked service has been explored by all of your active clients',
  },
  {
    key: 'pe-intros',
    title: 'Reach out to PE partners about intros for top PCs',
    detail: 'Warm intros through the PE relationship into their highest-scoring portfolio companies.',
    view: 'pe',
    viewLabel: 'PE Portfolio',
  },
  {
    key: 'cold',
    title: 'Cold prospect outreach',
    detail: 'Names with no relationship yet. Last, because everything above has a warmer way in.',
    view: 'accounts',
    viewLabel: 'My Accounts',
  },
];

// Rank 1 carries the strongest accent and it cools down the list, so the
// order reads at a glance without anyone having to count the numbers.
const RANK_COLORS = [
  { badge: '#0A66C2', ring: '#BFDBFE', tint: '#F5F9FF' },
  { badge: '#2563EB', ring: '#C7D8FD', tint: '#F7FAFF' },
  { badge: '#4F63D2', ring: '#D2D9F7', tint: '#F9FAFE' },
  { badge: '#6366F1', ring: '#DDDCFB', tint: '#FAFAFE' },
  { badge: '#7C7FE0', ring: '#E3E4FA', tint: '#FBFBFE' },
  { badge: '#94A3B8', ring: '#E2E8F0', tint: '#FCFCFD' },
];

// Fixed widths so the two right-hand cells line up as columns across
// rows of different heights — and so the header labels sit over them.
const STATUS_COL = 132;
const ACTION_COL = 128;

const STATUS_STYLES = {
  'caught-up': { background: '#DCFCE7', border: '#BBF7D0', color: '#166534' },
  work: { background: '#FEE2E2', border: '#FECACA', color: '#991B1B' },
  open: { background: '#fff', border: '#CBD5E1', color: '#64748B' },
};

// Read the Opps 2 store the way the other consumer pages do — newest of the
// local cache and Firestore. Kept local rather than imported from
// KeyContactsView so this lazy chunk doesn't pull that whole page in for a
// twelve-line hook.
function useOppsRecords(userId) {
  const [records, setRecords] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadOpps2Newest(userId);
        const recs = Array.isArray(data?.records) ? data.records : null;
        if (!cancelled && recs) setRecords(recs);
      } catch { /* leave null so the step shows no count rather than a wrong one */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  return records;
}

// One cell of the Status column. Untracked steps render a button (the
// mark is the user's to set); counted steps render static text, since
// clicking couldn't change what the data says.
function StatusCell({ state, label, title, onToggle }) {
  if (state === 'unknown') return <div style={{ width: STATUS_COL, flexShrink: 0 }} />;
  const c = STATUS_STYLES[state];
  const base = {
    // Explicit border-box so the pill and the button below it are the
    // same 132px wide — a button gets it from the UA stylesheet, a div
    // only from the app's own reset.
    width: STATUS_COL, boxSizing: 'border-box', flexShrink: 0, alignSelf: 'center',
    padding: '0.3rem 0.5rem', borderRadius: 999,
    border: `1px solid ${c.border}`, background: c.background, color: c.color,
    fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700,
    letterSpacing: '0.02em', textAlign: 'center', whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis',
  };
  if (!onToggle) return <div style={base} title={title}>{label}</div>;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-pressed={state === 'caught-up'}
      style={{ ...base, cursor: 'pointer' }}
    >
      {label}
    </button>
  );
}

// The services still short of full coverage, listed under their step. This
// is the work itself, not a summary of it: which service, how far along it
// is, and who is left to talk to. It used to sit on the Issues tab, where
// it read as something broken rather than as the next set of calls.
const COVERAGE_NAMES_SHOWN = 6;
function ServiceGapList({ gaps }) {
  if (!gaps || gaps.length === 0) return null;
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
      {gaps.map((g) => {
        const left = g.notExplored.length;
        const shown = g.notExplored.slice(0, COVERAGE_NAMES_SHOWN).join(', ');
        const extra = left - COVERAGE_NAMES_SHOWN;
        return (
          <div
            key={g.id}
            title={`${g.explored} of ${g.total} client${g.total === 1 ? '' : 's'} (${g.pct}%) have explored ${g.label}`}
            style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', fontSize: '0.72rem', lineHeight: 1.35 }}
          >
            <span style={{ fontWeight: 700, color: '#334155', flexShrink: 0 }}>{g.label}</span>
            {/* The percentage is the Pipeline table's own figure, so the two
                pages read the same. Tabular figures keep the column straight
                down the list. */}
            <span style={{ color: '#94A3B8', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {g.pct}% · {left} to go
            </span>
            <span style={{ color: '#64748B', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {shown}{extra > 0 ? ` +${extra} more` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ProspectingView({ onNavigate, issues = null, serviceGaps = null }) {
  const { user } = useAuth();
  const oppsRecords = useOppsRecords(user?.uid);
  // The hand-marked steps, straight off localStorage: another tab's mark,
  // the user id landing after login, and the date rolling over all reach
  // the page this way rather than through mirrored state.
  const snapshot = useSyncExternalStore(subscribeCaughtUp, caughtUpSnapshot);
  const { today, map: caughtUpMap } = useMemo(() => readCaughtUpSnapshot(snapshot), [snapshot]);
  // null until the store answers — a "0 overdue" badge shown while the read
  // is still in flight would read as "you're all clear" when it isn't known.
  const overdueCallIns = useMemo(
    () => (oppsRecords ? countOverdueCallIns(oppsRecords) : null),
    [oppsRecords],
  );
  // Renewal work comes from the issue rows the Issues tab already builds,
  // so this step and that tab can't disagree. null until they arrive.
  const renewalWork = useMemo(() => countRenewalWork(issues), [issues]);
  // Tracked services still under 100% coverage. Same rows the list under
  // the step prints, so the badge and the list can't disagree.
  const serviceWork = useMemo(() => countServiceGaps(serviceGaps), [serviceGaps]);

  const counts = useMemo(
    () => ({ opps: overdueCallIns, renewals: renewalWork, 'targeted-services': serviceWork }),
    [overdueCallIns, renewalWork, serviceWork],
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', flexShrink: 0 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Prospecting</h2>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
          The order prospecting work gets done, ranked. Start at the top and work down —
          each step is warmer than the one below it. The Status column says whether a step
          is clear: counted steps answer for themselves, the rest you mark caught up for the day.
        </div>
      </div>

      <div style={{ padding: '0.25rem 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 860 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0 calc(0.85rem + 1px)',
            fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: '#94A3B8',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }} />
          <div style={{ width: STATUS_COL, flexShrink: 0, textAlign: 'center' }}>Status</div>
          {onNavigate && <div style={{ width: ACTION_COL, flexShrink: 0 }} />}
        </div>

        {PROSPECTING_STEPS.map((step, i) => {
          const rank = i + 1;
          const colors = RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)];
          const isLast = rank === PROSPECTING_STEPS.length;
          const tracked = typeof step.workLabel === 'function';
          const count = tracked ? counts[step.key] : undefined;
          const marked = isMarkedCaughtUp(caughtUpMap, step.key, today);
          const state = categorizeStep({ count, marked });
          const label = state === 'work' ? step.workLabel(count)
            : state === 'caught-up' ? 'All caught up'
              : 'Mark caught up';
          const title = state === 'work' ? step.workTitle(count)
            : state === 'caught-up'
              ? (tracked ? step.clearTitle : 'Marked caught up today — clears tomorrow. Click to undo.')
              : 'Nothing counts this step automatically — click once you\'ve worked it today';
          return (
            <div
              key={step.key}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                padding: '0.7rem 0.85rem',
                background: colors.tint,
                border: `1px solid ${colors.ring}`,
                borderLeft: `4px solid ${colors.badge}`,
                borderRadius: 8,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: colors.badge, color: '#fff',
                  fontSize: '0.78rem', fontWeight: 700, lineHeight: 1,
                }}
              >
                {rank}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1E293B' }}>
                    {step.title}
                  </span>
                  {rank === 1 && (
                    <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', background: '#DBEAFE', color: '#1E40AF' }}>
                      Start here
                    </span>
                  )}
                  {isLast && (
                    <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', background: '#F1F5F9', color: '#475569' }}>
                      Last
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: 3 }}>
                  {step.detail}
                </div>
                {step.key === 'targeted-services' && <ServiceGapList gaps={serviceGaps} />}
              </div>
              <StatusCell
                state={state}
                label={label}
                title={title}
                onToggle={tracked ? null : () => setStepCaughtUp(step.key, !marked, today)}
              />
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate(step.view)}
                  title={`Open the ${step.viewLabel} tab`}
                  style={{
                    width: ACTION_COL, flexShrink: 0, alignSelf: 'center',
                    padding: '0.3rem 0.7rem', borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${colors.ring}`, background: '#fff',
                    color: colors.badge, fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = colors.tint; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                >
                  {step.viewLabel} →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
