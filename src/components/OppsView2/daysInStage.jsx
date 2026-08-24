// "Days in Stage" logic + Kanban board for the Opps 2 tab.
//
// Factored out of OppsView2 (which is otherwise a single ~9k-line file)
// so the board, its row builder, and the tracked-stage constants live in
// one focused module. Operates on Opps 2 rows (which carry
// `_stageEnteredAt`, `_stageHistory`, `Stage`, `Scope`, `Follow Up`, …).
import { toISODate, formatDateDisplay, daysFromToday, resolveCallIn } from '../../utils/oppsCallIn';
import { isPullThroughOpp } from '../../utils/pullThrough';

// Stages the Days-in-Stage board reports on. Ordered to mirror the
// pipeline progression so a row stays under one bucket as it moves
// forward. Closed stages (Sold / Not Sold) are intentionally excluded —
// the board tracks how long active opps are stalling in each step.
export const TRACKED_STAGES = ['Not Started', 'Lead', 'Qualifying', 'Quoting', 'Quoted', 'Contracting', 'Agreement Sent'];
export const TRACKED_STAGES_SET = new Set(TRACKED_STAGES);

// The numbered sales stages these columns roll up into, in board order.
// Two board columns can share one stage — Qualifying and Quoting are both
// Stage 4, Quoted and Contracting both Stage 5 — so the board bands its
// columns rather than labelling each one. Not Started sits ahead of the
// numbered stages and carries no band label. `stages` between them must
// cover TRACKED_STAGES exactly, in the same order.
const STAGE_BANDS = [
  { label: '', name: '', stages: ['Not Started'] },
  { label: 'Stage 3', name: 'Qualify Opportunity', stages: ['Lead'] },
  { label: 'Stage 4', name: 'Influence and Develop', stages: ['Qualifying', 'Quoting'] },
  { label: 'Stage 5', name: 'Prepare & Bid', stages: ['Quoted', 'Contracting'] },
  { label: 'Stage 6', name: 'Negotiate to Win', stages: ['Agreement Sent'] },
];

const BAND_BY_STAGE = new Map(STAGE_BANDS.flatMap(b => b.stages.map(s => [s, b])));

// The numbered stage a board column rolls up into, or null for a column
// with no number (Not Started).
function stageBandFor(stage) {
  const band = BAND_BY_STAGE.get(String(stage || '').trim());
  return band && band.label ? band : null;
}

// When an opp entered its current *numbered* stage — not its current
// column. Qualifying → Quoting is a move inside Stage 4, so the clock
// keeps running rather than restarting at the column boundary; the same
// goes for Quoted → Contracting in Stage 5.
//
// Walks back through `_stageHistory` (entries record the stage being
// left, oldest first) while the previous stage belongs to the same band,
// then falls back to `_stageEnteredAt` and finally Start Date, so an opp
// that has never had a stage change still reports something.
export function stageBandEnteredISO(row) {
  const entered = toISODate(row?._stageEnteredAt) || toISODate(row?.['Start Date']);
  const band = BAND_BY_STAGE.get(String(row?.['Stage'] || '').trim());
  if (!band || band.stages.length < 2) return entered;
  const hist = Array.isArray(row?._stageHistory) ? row._stageHistory : [];
  let earliest = entered;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (!band.stages.includes(String(hist[i]?.stage || '').trim())) break;
    const e = toISODate(hist[i]?.enteredAt);
    if (!e) break;
    earliest = e;
  }
  return earliest;
}

// Stage-specific "stalled too long" thresholds. An opp that has sat in
// one of these stages for more than `days` calendar days surfaces as a
// flagged card with the paired suggestion. Stages not listed (Not
// Started, Quoting, Contracting, Agreement Sent) have no threshold, so
// they never raise an action prompt. Not Started is intentionally
// excluded — a brand-new opp shouldn't nag to qualify-or-kill.
export const STAGE_ACTION_THRESHOLDS = {
  'Lead':        { days: 90,  suggestion: 'Qualify or kill' },
  'Qualifying':  { days: 60,  suggestion: 'Quote or kill' },
  'Quoted':      { days: 90,  suggestion: 'Contract or kill' },
};

// The stage-action rule an opp has tripped, or null if it's within the
// limit (or its stage has no limit). Shared by the board so flagged opps
// render inline with their suggestion instead of in a separate list.
export function stageActionFor(stage, days) {
  const rule = STAGE_ACTION_THRESHOLDS[stage];
  if (!rule || days == null || days <= rule.days) return null;
  return rule;
}

// Build the Days-in-Stage rows for a set of opp records. `days` counts
// time in the numbered stage (Stage 3 / 4 / 5 / 6), so an opp that moved
// Qualifying → Quoting keeps its Stage 4 clock instead of restarting at
// the column boundary — see stageBandEnteredISO. Falls back to Start Date
// so pre-existing opps that have never had a stage change still
// contribute something instead of showing blank. Sorted descending by
// days so the longest-stalling opps lead each column.
//
// Gates (identical to the Opps 2 board): tracked stage, has a Call In
// (on a callback schedule), and not a pull-through.
export function buildStageDaysRows(records) {
  const rows = [];
  for (const r of (Array.isArray(records) ? records : [])) {
    const stage = String(r['Stage'] || '').trim();
    if (!TRACKED_STAGES_SET.has(stage)) continue;
    if (resolveCallIn(r) == null) continue;
    if (isPullThroughOpp(r)) continue;
    const enteredISO = stageBandEnteredISO(r);
    const days = enteredISO ? -daysFromToday(enteredISO) : null;
    const scope = String(r['Scope'] ?? '').trim();
    const band = stageBandFor(stage);
    rows.push({
      id: r._id,
      Account: r['Account'] || '',
      Stage: stage,
      // The numbered stage the day count is measured over ('' for Not
      // Started, which sits ahead of the numbered stages).
      bandLabel: band ? band.label : '',
      days,
      enteredAt: enteredISO || '',
      // The column's own entry date, so the hover can say when the opp
      // reached this step as well as when its numbered stage started.
      columnEnteredAt: toISODate(r._stageEnteredAt) || toISODate(r['Start Date']) || '',
      startDate: toISODate(r['Start Date']) || '',
      scope: scope && scope !== '-' && scope !== '#N/A' ? scope : '',
      _hasExplicitEntry: !!toISODate(r._stageEnteredAt),
      ignoreStall: !!r._ignoreStallFlag,
    });
  }
  rows.sort((a, b) => {
    if (a.days == null && b.days == null) return 0;
    if (a.days == null) return 1;
    if (b.days == null) return -1;
    return b.days - a.days;
  });
  return rows;
}

// Group Days-in-Stage rows by stage so the board can render one column
// per stage with its cards stacked beneath. `rows` is pre-sorted
// descending by days, so each bucket's order falls out for free.
export function groupStageDaysByStage(rows) {
  const map = new Map(TRACKED_STAGES.map(s => [s, []]));
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (map.has(r.Stage)) map.get(r.Stage).push(r);
  }
  return map;
}

// One board column: the stage's header and its cards, stacked descending
// by days-in-stage. Split out so StageDaysBoard reads as the band layout
// it now is rather than three levels of nested map.
function StageColumn({ stage, items, onCardClick }) {
  return (
    <div style={{
      flex: '0 0 220px', width: 220,
      background: '#F1F5F9', borderRadius: 6, padding: 8,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline',
        justifyContent: 'space-between',
        padding: '2px 4px 6px',
        borderBottom: '1px solid #CBD5E1',
      }}>
        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{stage}</span>
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>{items.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.length === 0 ? (
          <div style={{
            color: '#94A3B8', fontSize: '0.72rem',
            textAlign: 'center', padding: '8px 0',
          }}>-</div>
        ) : items.map(row => {
          // The badge counts time in the numbered stage, so the hover
          // names it — and adds the column's own entry date when the two
          // differ, which is exactly the Qualifying → Quoting (and
          // Quoted → Contracting) case the band exists for.
          const what = row.bandLabel || 'Stage';
          const movedWithinBand = row.columnEnteredAt && row.columnEnteredAt !== row.enteredAt;
          const dayBadgeTitle = row.enteredAt
            ? `${what} entered ${formatDateDisplay(row.enteredAt)}${row._hasExplicitEntry ? '' : ' (fallback to Start Date)'}`
              + (movedWithinBand ? `\nReached ${row.Stage} ${formatDateDisplay(row.columnEnteredAt)}` : '')
            : 'No entry date recorded.';
          // Flagged opps (stalled past the stage's limit) stay in
          // the same column but render in amber, with the suggested
          // move on the card and in the hover — so the board
          // doubles as the "needs action" list. Opps the user
          // ignored on the Opps tab don't flag here.
          const action = row.ignoreStall ? null : stageActionFor(row.Stage, row.days);
          const accountTitle = action
            ? `Stalled ${row.days}d in ${what} (> ${action.days}d) → ${action.suggestion}${row.scope ? `\nScope: ${row.scope}` : ''}`
            : (row.scope ? `Scope: ${row.scope}` : 'No scope set on this opp.');
          return (
            <div
              key={row.id}
              onClick={onCardClick ? () => onCardClick(row) : undefined}
              style={{
                background: action ? '#FEF3C7' : '#FFFFFF', borderRadius: 4,
                border: `1px solid ${action ? '#FCD34D' : '#E2E8F0'}`,
                padding: '6px 8px',
                display: 'flex', flexDirection: 'column', gap: 3,
                cursor: onCardClick ? 'pointer' : 'default',
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', gap: 8,
              }}>
                <span
                  title={accountTitle}
                  style={{
                    fontSize: '0.8rem', fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    minWidth: 0, cursor: 'help',
                  }}
                >
                  {action && <span title="Stalled past its stage limit">⚠ </span>}
                  {row.Account || <span style={{ color: '#94A3B8' }}>(no account)</span>}
                </span>
                <span
                  title={dayBadgeTitle}
                  style={{
                    fontSize: '0.72rem', fontWeight: action ? 700 : 600,
                    color: action ? '#B45309' : (row.days != null && row.days > 30 ? '#DC2626' : '#475569'),
                    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                  }}
                >
                  {row.days == null ? '-' : `${row.days}d`}
                </span>
              </div>
              {action && (
                <span style={{
                  fontSize: '0.68rem', fontWeight: 600, color: '#B45309',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {action.suggestion}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The Days-in-Stage Kanban board: one column per tracked stage, banded
// under the numbered sales stage each column rolls up into, cards stacked
// descending by days-in-stage, flagged amber when stalled past the stage's
// limit (with the suggested move on the card and hover).
//
// `byStage` is a Map<stage, rows[]> (from groupStageDaysByStage);
// `hideNotStarted` / `setHideNotStarted` drive the "Hide Not Started"
// toggle; `onCardClick` (optional) fires with a row when a card is
// clicked, so callers can open the underlying opp.
export function StageDaysBoard({ byStage, hideNotStarted, setHideNotStarted, onCardClick }) {
  const notStartedCount = (byStage.get('Not Started') || []).length;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0 0.5rem' }}>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          fontSize: '0.72rem', color: '#64748B', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={hideNotStarted}
            onChange={e => setHideNotStarted(e.target.checked)}
          />
          Hide Not Started ({notStartedCount})
        </label>
        <span style={{ fontSize: '0.72rem', color: '#B45309', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 10, height: 10, borderRadius: 2,
            background: '#FEF3C7', border: '1px solid #FCD34D', display: 'inline-block',
          }} />
          ⚠ flagged = stalled past its stage limit (hover for the suggested move) · days count time in the numbered stage, not the column
        </span>
      </div>
      <div style={{
        display: 'flex', gap: 12, overflowX: 'auto',
        padding: '12px 0', alignItems: 'flex-start',
      }}>
        {STAGE_BANDS.map(band => {
          const stages = band.stages.filter(s => !(hideNotStarted && s === 'Not Started'));
          if (stages.length === 0) return null;
          return (
            <div key={band.label || band.stages[0]} style={{
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              {/* The band spans its columns, so a stage covering two of
                  them reads as one step rather than two. Not Started has
                  no number: the placeholder keeps its column aligned with
                  the banded ones instead of riding 20px higher. */}
              <div
                title={band.name ? `${band.label}: ${band.name}` : undefined}
                style={{
                  fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
                  textTransform: 'uppercase', textAlign: 'center',
                  color: band.label ? '#475569' : 'transparent',
                  background: band.label ? '#E2E8F0' : 'transparent',
                  borderRadius: 4, padding: '3px 8px',
                  cursor: band.name ? 'help' : 'default',
                }}
              >{band.label || '\u00A0'}</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {stages.map(stage => (
                  <StageColumn
                    key={stage}
                    stage={stage}
                    items={byStage.get(stage) || []}
                    onCardClick={onCardClick}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
