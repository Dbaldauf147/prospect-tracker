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
// (overdue Call Ins, client renewals still needing a status, services
// under full coverage, Top PCs not yet at Qualifying) categorize
// themselves; the rest the user marks caught up for the day. See
// utils/prospectingStatus.js for why a manual mark expires overnight.
//
// Two steps list their work in place rather than only counting it: the
// services still short of coverage, and the Top PC of every PE firm that
// isn't already Qualifying — so the calls to make are on the page rather
// than a tab away.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { loadOpps2Newest } from '../../utils/opps2Store';
import { countOverdueCallIns } from '../../utils/oppsCallIn';
import { RENEWAL_WARNING_DAYS } from '../../utils/clientIssues';
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
import { collectTopPcIntros } from '../../utils/topPcOutreach';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { loadClientStatusMap, CLIENT_STATUS_EVENT } from '../../utils/clientManagerStore';
import { makeRosterGates, rosterTagCoverage, ROSTER_CATEGORIES } from '../../utils/contactRosters';
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
    // Opps marked "No Further Action Today" are settled for the day, so
    // they're left out of the count — same rule the sidebar's Opps badge
    // uses. The tooltips say so, since a number that skips rows the user
    // can see on the Opps tab is otherwise just wrong-looking.
    workTitle: n => `${n} open ${n === 1 ? 'opp is' : 'opps are'} past their Call In date, not counting any marked "No Further Action Today"`,
    clearTitle: 'No open opp is past its Call In date, other than ones marked "No Further Action Today"',
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
    // Named the same way the Clients tab names its red rows, because they
    // are the same rows.
    workTitle: n => `${n} client${n === 1 ? '' : 's'} whose soonest contract expires within ${RENEWAL_WARNING_DAYS} days (or already has) with the Status column still blank`,
    clearTitle: `No client with a contract expiring within ${RENEWAL_WARNING_DAYS} days is missing a Status`,
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
    workLabel: n => `${n} to ask`,
    workTitle: n => `${n} Top ${n === 1 ? 'PC is' : 'PCs are'} not at Qualifying yet — an intro still to ask the PE partner for`,
    clearTitle: 'Every PE firm\'s Top PC is already at Qualifying',
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

// Tag-review coverage per contact roster, for the market-updates step.
// Everything it needs is already cached locally — the HubSpot contacts, the
// Clients tab's status map, the opps records and the Table View prospects —
// so the readout paints with the page rather than after a round trip.
// Returns null until the contact cache answers, so the row shows nothing
// instead of a 0% that only means "not loaded yet".
function useRosterTagCoverage({ prospects, cdmName, oppsRecords, settings }) {
  const [contacts, setContacts] = useState(null);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getHubspotCache()
        .then(c => { if (!cancelled) setContacts(c?.contacts || []); })
        .catch(() => { if (!cancelled) setContacts([]); });
    }
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Same store and the same events the contacts pages listen to, so a
  // company switched to "Cancelling for Sure" drops out of these numbers
  // without a reload.
  const [clientStatusMap, setClientStatusMap] = useState(() => loadClientStatusMap());
  useEffect(() => {
    function onStorage(e) { if (e.key === 'clients-status-map') setClientStatusMap(loadClientStatusMap()); }
    function onStatus() { setClientStatusMap(loadClientStatusMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(CLIENT_STATUS_EVENT, onStatus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CLIENT_STATUS_EVENT, onStatus);
    };
  }, []);

  // Visible mode, matching the Totals pills on All Contacts: the figure
  // should describe the rosters as they're worked, not the hidden-review view.
  const gates = useMemo(
    () => makeRosterGates({ prospects: prospects || [], cdmName, oppsRecords, clientStatusMap, showHidden: false }),
    [prospects, cdmName, oppsRecords, clientStatusMap],
  );
  return useMemo(() => {
    if (contacts == null) return null;
    return rosterTagCoverage({
      contacts,
      gates,
      tagReviewMap: settings?.contactTagReview || {},
      localFields: settings?.contactLocalFields || null,
    });
  }, [contacts, gates, settings?.contactTagReview, settings?.contactLocalFields]);
}

// The tag-review coverage, roster by roster, under the market-updates step.
// A market update is only worth sending to someone you've placed, so how
// far the tagging has actually been worked through is the readiness check
// for this step — and it's the one number that says which slice of the book
// is ready and which isn't.
//
// The figures come from the same function the All Contacts page's own
// Tagged row runs on (rosterTagCoverage), so the two pages read one number
// rather than two: of every tag question askable about a group's contacts,
// the share that has an answer.
function TagCoverageBar({ coverage, onNavigate }) {
  if (!coverage) return null;
  const cells = [
    { key: 'all', label: 'All', bg: '#F1F5F9', border: '#CBD5E1', color: '#334155' },
    ...ROSTER_CATEGORIES,
  ];
  // Nothing on any roster — the cache is loaded but empty. A row of "—"
  // would just be noise.
  if (!coverage.all.contacts) return null;
  return (
    <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.02em' }}>
        Tagged:
      </span>
      {cells.map(({ key, label, bg, border, color }) => {
        const { pct, contacts } = coverage[key];
        const empty = pct == null;
        const title = empty
          ? `No contacts on the ${label} roster yet`
          : `${label}: ${pct}% of the tag questions across ${contacts} contact${contacts === 1 ? '' : 's'} have an answer — the same figure the All Contacts page's Tagged row shows for this group${onNavigate ? '. Click to open Contacts.' : ''}`;
        const body = (
          <>
            <span style={{ fontWeight: 700 }}>{label}</span>
            <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {empty ? '—' : `${pct}%`}
            </span>
          </>
        );
        const style = {
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '1px 8px', borderRadius: 999,
          background: empty ? '#F8FAFC' : bg,
          border: `1px solid ${empty ? '#E2E8F0' : border}`,
          color: empty ? '#94A3B8' : color,
          fontSize: '0.68rem', fontFamily: 'inherit',
        };
        if (!onNavigate) return <span key={key} style={style} title={title}>{body}</span>;
        return (
          <button key={key} type="button" onClick={onNavigate} title={title} style={{ ...style, cursor: 'pointer' }}>
            {body}
          </button>
        );
      })}
    </div>
  );
}

// One cell of the Status column. Untracked steps render a button (the
// mark is the user's to set); counted steps render static text, since
// clicking couldn't change what the data says. A row tall enough to hold
// a list aligns its cells to the top instead of floating them in the
// middle of all that space.
function StatusCell({ state, label, title, onToggle, align = 'center' }) {
  if (state === 'unknown') return <div style={{ width: STATUS_COL, flexShrink: 0 }} />;
  const c = STATUS_STYLES[state];
  const base = {
    // Explicit border-box so the pill and the button below it are the
    // same 132px wide — a button gets it from the UA stylesheet, a div
    // only from the app's own reset.
    width: STATUS_COL, boxSizing: 'border-box', flexShrink: 0, alignSelf: align,
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

// How many intros show without expanding. They're ranked warmest first,
// so the top of the list is the part worth reading anyway.
const TOP_PC_PREVIEW = 5;

// One intro to ask for: the portfolio company, the firm to ask, and where
// that company already stands. Both names click through to their record
// when there is one — a Top PC with no prospect of its own is plain text,
// which is itself the tell that nobody has opened it yet.
function TopPcRow({ row, onSelectProspect, byId, last }) {
  // Company and firm names run long ("TowerBrook Capital Partners (a Blue
  // Owl co.)"), so each gets its own line and truncates rather than
  // wrapping mid-name. Title attributes carry the full text either way.
  const nameStyle = {
    padding: 0, border: 0, background: 'none', font: 'inherit', textAlign: 'left',
    cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#CBD5E1',
    textUnderlineOffset: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    display: 'block', maxWidth: '100%',
  };
  const flatStyle = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', maxWidth: '100%' };
  const open = (id) => { const p = byId?.get(id); if (p) onSelectProspect(p); };
  // Where the status came from matters when it's the reason a company is
  // (or isn't) on this list — the PE page's own tooltips say the same.
  const statusTitle = !row.status
    ? 'This company has no status on the firm\'s portfolio list and no prospect record of its own'
    : row.statusFromRow
      ? `Status set on ${row.firm}'s Portfolio Companies list`
      : `Table View status${row.statusCompany ? ` of ${row.statusCompany}` : ''}`;
  return (
    <div style={{ padding: '4px 0', borderBottom: last ? 'none' : '1px dashed #EEF0FA', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
        <span
          title="Opportunity Score — the same one the PE Portfolio table ranks by"
          style={{
            flexShrink: 0, minWidth: 26, textAlign: 'center', padding: '1px 5px', borderRadius: 4,
            background: '#EEF2FF', color: '#4338CA', fontSize: '0.65rem', fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {Math.round(row.score)}
        </span>
        <div style={{ flex: 1, minWidth: 0, color: '#1E293B', fontWeight: 700 }}>
          {row.companyId && onSelectProspect
            ? <button type="button" style={{ ...nameStyle, color: '#1E293B', fontWeight: 700 }} onClick={() => open(row.companyId)} title={`Open ${row.company}`}>{row.company}</button>
            : <span style={flatStyle} title={`${row.company} — no prospect record yet`}>{row.company}</span>}
        </div>
        <span
          title={statusTitle}
          style={{
            flexShrink: 0, padding: '0 6px', borderRadius: 999,
            border: '1px solid #E2E8F0', background: '#fff',
            fontSize: '0.62rem', fontWeight: 700,
            color: row.status ? '#334155' : '#94A3B8',
            fontStyle: row.status ? 'normal' : 'italic',
          }}
        >
          {row.status || 'Not tracked'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '0.3rem', paddingLeft: 'calc(26px + 0.8rem)', minWidth: 0, color: '#64748B', fontSize: '0.68rem' }}>
        <span style={{ flexShrink: 0, color: '#94A3B8' }}>via</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {row.firmId && onSelectProspect
            ? <button type="button" style={{ ...nameStyle, color: '#475569', fontWeight: 600 }} onClick={() => open(row.firmId)} title={`Open ${row.firm}`}>{row.firm}</button>
            : <span style={flatStyle}>{row.firm}</span>}
        </div>
      </div>
    </div>
  );
}

// The intros still to ask for, under their step. Long lists preview the
// warmest few and expand on demand, so a 200-firm portfolio doesn't push
// the rest of the ladder off the page.
function TopPcIntroList({ rows, expanded, onExpand, onSelectProspect, byId }) {
  if (!rows || rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, TOP_PC_PREVIEW);
  const hidden = rows.length - shown.length;
  return (
    <div style={{ marginTop: 6, fontSize: '0.72rem' }}>
      <div
        style={{
          border: '1px solid #E3E4FA', borderRadius: 6, background: '#fff',
          padding: '0.25rem 0.5rem',
          maxHeight: expanded ? 260 : 'none', overflowY: expanded ? 'auto' : 'visible',
        }}
      >
        {shown.map((row, i) => (
          <TopPcRow
            key={`${row.firmId || row.firm}:${row.company}`}
            row={row}
            onSelectProspect={onSelectProspect}
            byId={byId}
            last={i === shown.length - 1}
          />
        ))}
      </div>
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={onExpand}
          style={{
            marginTop: 4, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
            border: '1px solid #E3E4FA', background: '#fff', color: '#4F46E5',
            fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700,
          }}
        >
          {expanded ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

export function ProspectingView({ onNavigate, issues = null, serviceGaps = null, prospects = null, onSelectProspect, cdmName = '', settings = null }) {
  const { user } = useAuth();
  const oppsRecords = useOppsRecords(user?.uid);
  // Tag-review coverage per roster, printed under the market-updates step.
  const tagCoverage = useRosterTagCoverage({ prospects, cdmName, oppsRecords, settings });
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
  // Every PE firm's Top PC that isn't at Qualifying yet — the intros still
  // to ask for. null until the prospects load, same reasoning as above.
  const topPcIntros = useMemo(() => collectTopPcIntros(prospects), [prospects]);
  const [showAllTopPcs, setShowAllTopPcs] = useState(false);
  // Click-through for that list: id → the record itself, since the page is
  // handed prospects rather than a lookup.
  const prospectById = useMemo(() => {
    const m = new Map();
    for (const p of (prospects || [])) if (p?.id) m.set(p.id, p);
    return m;
  }, [prospects]);

  const counts = useMemo(
    () => ({
      opps: overdueCallIns,
      renewals: renewalWork,
      'targeted-services': serviceWork,
      'pe-intros': topPcIntros ? topPcIntros.length : null,
    }),
    [overdueCallIns, renewalWork, serviceWork, topPcIntros],
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
          // Two steps print their work under the detail line rather than
          // only counting it — those rows are tall, so their right-hand
          // cells sit at the top rather than floating in the middle.
          const hasList = (step.key === 'targeted-services' && serviceGaps?.length)
            || (step.key === 'pe-intros' && topPcIntros?.length)
            || (step.key === 'market-updates' && tagCoverage?.all?.contacts);
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
                {step.key === 'market-updates' && (
                  <TagCoverageBar
                    coverage={tagCoverage}
                    onNavigate={onNavigate ? () => onNavigate('contacts') : null}
                  />
                )}
                {step.key === 'targeted-services' && <ServiceGapList gaps={serviceGaps} />}
                {step.key === 'pe-intros' && (
                  <TopPcIntroList
                    rows={topPcIntros}
                    expanded={showAllTopPcs}
                    onExpand={() => setShowAllTopPcs(v => !v)}
                    onSelectProspect={onSelectProspect}
                    byId={prospectById}
                  />
                )}
              </div>
              <StatusCell
                state={state}
                label={label}
                title={title}
                align={hasList ? 'flex-start' : 'center'}
                onToggle={tracked ? null : () => setStepCaughtUp(step.key, !marked, today)}
              />
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate(step.view)}
                  title={`Open the ${step.viewLabel} tab`}
                  style={{
                    width: ACTION_COL, flexShrink: 0, alignSelf: hasList ? 'flex-start' : 'center',
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
