// Prospecting tab — the ranked order of prospecting work. The list is the
// point: start at the top and only move down once the step above is clear,
// so the warmest paths in get worked before the coldest ones.
//
// Each step links to the tab where that work actually happens, so the page
// is a starting point for the day rather than a wall of text. Editing the
// playbook means editing PROSPECTING_STEPS — nothing else reads the order.

const PROSPECTING_STEPS = [
  {
    key: 'opps',
    title: 'Follow up on current opps',
    detail: 'Opportunities already in flight. Nothing new gets worked until these are moving.',
    view: 'opps2',
    viewLabel: 'Opps',
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
  },
  {
    key: 'targeted-services',
    title: 'Reach out to existing clients for targeted services',
    detail: 'Services an existing client has not explored yet. The relationship is already there.',
    view: 'clients',
    viewLabel: 'Clients',
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

export function ProspectingView({ onNavigate }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', flexShrink: 0 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Prospecting</h2>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
          The order prospecting work gets done, ranked. Start at the top and work down —
          each step is warmer than the one below it.
        </div>
      </div>

      <div style={{ padding: '0.25rem 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 860 }}>
        {PROSPECTING_STEPS.map((step, i) => {
          const rank = i + 1;
          const colors = RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)];
          const isLast = rank === PROSPECTING_STEPS.length;
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
              </div>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate(step.view)}
                  title={`Open the ${step.viewLabel} tab`}
                  style={{
                    flexShrink: 0, alignSelf: 'center',
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
