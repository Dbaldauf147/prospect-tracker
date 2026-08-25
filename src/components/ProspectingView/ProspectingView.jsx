// Prospecting tab — the ranked order of prospecting work. The list is the
// point: start at the top and only move down once the step above is clear,
// so the warmest paths in get worked before the coldest ones.
//
// Each step links to the tab where that work actually happens, so the page
// is a starting point for the day rather than a wall of text. The ladder
// itself is the user's: Edit steps opens the list for reordering, retitling
// and adding steps of their own, stored in settings (see
// utils/prospectingPlaybook.js for the defaults and the merge).
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

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { loadOpps2Newest } from '../../utils/opps2Store';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
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
import {
  isCustomStep,
  moveStep,
  newStepKey,
  PROSPECTING_STEPS_SETTING,
  readSteps,
  serializeSteps,
  isCustomized,
  STEP_VIEW_OPTIONS,
  viewLabelFor,
} from '../../utils/prospectingPlaybook';
import { collectTopPcIntros } from '../../utils/topPcOutreach';
import { ROSTER_CATEGORIES } from '../../utils/contactRosters';
import { useContactEditSettings } from '../../hooks/useContactEditSettings';
import { useAuth } from '../../contexts/AuthContext';

// The contact popup, loaded when one is actually opened. It lives in
// ProspectModal, which is the largest module in the app — a static import
// would bolt all of it onto a page whose own job is a twelve-row ladder, and
// most visits here never open a contact. App already prefetches that chunk
// while the browser is idle, so by the time a name is clicked it's usually
// warm anyway.
const ContactEditModal = lazy(() =>
  import('../ProspectModal/ProspectModal').then(m => ({ default: m.ContactEditModal })),
);

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
// How many contacts one roster lists inline before it defers to the
// Contacts page. Long enough that a roster you can actually work through
// fits; short enough that opening "All" on a full book doesn't paint
// thousands of rows into a step on a ladder.
const TAG_LIST_LIMIT = 200;

// The contacts behind one Tagged chip: who is on that roster, and how far
// through the tag questions each of them is. Least-tagged first, so the
// names the percentage is waiting on lead.
function TagContactList({ cell, bucket, onNavigate, onClose, onOpenContact }) {
  const people = Array.isArray(bucket?.people) ? bucket.people : [];
  const shown = people.slice(0, TAG_LIST_LIMIT);
  // A name opens that contact's popup — the same one the contacts pages
  // open, so the tags this percentage is counting can be answered from the
  // list that names them rather than a tab away. Underlined so it reads as
  // clickable at 0.7rem, where a colour change alone doesn't.
  const nameStyle = {
    padding: 0, border: 0, background: 'none', font: 'inherit', textAlign: 'left',
    fontWeight: 700, color: '#1E293B', flexShrink: 0, cursor: 'pointer',
    textDecoration: 'underline', textDecorationColor: '#CBD5E1', textUnderlineOffset: 2,
  };
  return (
    <div style={{
      marginTop: 6, border: `1px solid ${cell.border}`, borderRadius: 8,
      background: '#fff', overflow: 'hidden', width: '100%',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '5px 9px', background: cell.bg, borderBottom: `1px solid ${cell.border}`,
      }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 800, color: cell.color }}>{cell.label}</span>
        <span style={{ fontSize: '0.68rem', color: '#475569' }}>
          {people.length} contact{people.length === 1 ? '' : 's'}
          {bucket?.pct != null && <> · {bucket.pct}% tagged</>}
        </span>
        <span style={{ flex: 1 }} />
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            style={{
              padding: '1px 7px', background: '#fff', border: '1px solid #CBD5E1', borderRadius: 5,
              fontSize: '0.66rem', fontWeight: 700, fontFamily: 'inherit', color: '#0A66C2', cursor: 'pointer',
            }}
          >Open in Contacts</button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close the ${cell.label} contact list`}
          style={{
            padding: '1px 7px', background: 'transparent', border: '1px solid transparent', borderRadius: 5,
            fontSize: '0.8rem', lineHeight: 1, fontFamily: 'inherit', color: '#64748B', cursor: 'pointer',
          }}
        >×</button>
      </div>
      {people.length === 0 ? (
        <div style={{ padding: '7px 9px', fontSize: '0.68rem', color: '#94A3B8' }}>
          No contacts on this roster.
        </div>
      ) : (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {shown.map((person, i) => (
            <div
              key={person.id || `${person.email}-${i}`}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 8,
                padding: '4px 9px', borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                fontSize: '0.7rem',
              }}
            >
              {/* Rows imported without a HubSpot record behind them have no
                  contact to open, so those names stay plain text. */}
              {onOpenContact && person.contact ? (
                <button
                  type="button"
                  onClick={() => onOpenContact(person.contact)}
                  title={`Open ${person.name}`}
                  style={nameStyle}
                >{person.name}</button>
              ) : (
                <span style={{ fontWeight: 700, color: '#1E293B', flexShrink: 0 }}>{person.name}</span>
              )}
              <span style={{
                color: '#64748B', flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{person.company || person.email}</span>
              {/* What this contact contributes to the percentage above. */}
              <span
                title={`${person.answered} of ${person.total} tag questions answered`}
                style={{
                  flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                  color: person.done ? '#166534' : '#B45309',
                }}
              >{person.done ? '✓' : `${person.answered}/${person.total}`}</span>
            </div>
          ))}
        </div>
      )}
      {people.length > shown.length && (
        <div style={{
          padding: '4px 9px', borderTop: '1px solid #F1F5F9',
          fontSize: '0.66rem', color: '#94A3B8',
        }}>
          Showing {shown.length} of {people.length} — open in Contacts for the rest.
        </div>
      )}
    </div>
  );
}

function TagCoverageBar({ coverage, onNavigate, missing = [], onOpenContact }) {
  // Which chip's contacts are listed underneath, if any. Local to the row:
  // it's a look, not a setting, and it should be closed again next visit.
  const [openKey, setOpenKey] = useState(null);
  const cells = [
    { key: 'all', label: 'All', bg: '#F1F5F9', border: '#CBD5E1', color: '#334155' },
    ...ROSTER_CATEGORIES,
  ];
  // Nothing on any roster — the cache is loaded but empty. A row of "—"
  // would just be noise. Checked after the hook above, not before it, so
  // the hook order stays stable across a coverage that arrives late.
  if (!coverage || !coverage.all.contacts) return null;
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
          : `${label}: ${pct}% of the tag questions across ${contacts} contact${contacts === 1 ? '' : 's'} have an answer — the same figure the All Contacts page's Tagged row shows for this group. Click to list them.`;
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
        // An empty roster has no list to open, so it stays a plain chip.
        if (empty) return <span key={key} style={style} title={title}>{body}</span>;
        const isOpen = openKey === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setOpenKey(isOpen ? null : key)}
            title={title}
            aria-expanded={isOpen}
            style={{
              ...style,
              cursor: 'pointer',
              boxShadow: isOpen ? `0 0 0 2px ${border}` : 'none',
            }}
          >
            {body}
          </button>
        );
      })}
      {/* How many rosters still have tagging to finish, one apiece. Shown
          whatever the rest of the ladder is doing: marking every step caught
          up turns this page green without touching a single tag, so the one
          number nothing else surfaces is exactly the one that shouldn't go
          quiet when the page stops saying anything else. */}
      {missing.length > 0 && (() => {
        // The pill counts groups, so clicking it goes to a group: the roster
        // behind it, or the first of them when several are short. A missing
        // roster always has contacts — the debt rule only counts a roster
        // whose percentage exists — so the list is never opened empty.
        const target = missing[0].key;
        const isOpen = openKey === target;
        const which = missing.length === 1
          ? `Click to list the ${missing[0].label} contacts, least-tagged first.`
          : `Click to list the ${missing[0].label} contacts, least-tagged first — then the other chips for the rest.`;
        return (
          <button
            data-tag-debt
            type="button"
            onClick={() => setOpenKey(isOpen ? null : target)}
            aria-expanded={isOpen}
            title={`${missing.length} contact ${missing.length === 1 ? 'roster is' : 'rosters are'} short of fully mapped tags: ${missing.map(m => m.label).join(', ')}. Counted one per roster, however many contacts are behind it. Active is left out — it's a rolling window rather than a book to work through — and All is the union of the rest. ${which}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '1px 8px', borderRadius: 999,
              background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B',
              fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit',
              cursor: 'pointer',
              boxShadow: isOpen ? '0 0 0 2px #FCA5A5' : 'none',
            }}
          >
            <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{missing.length}</span>
            {missing.length === 1 ? 'group missing tags' : 'groups missing tags'}
          </button>
        );
      })()}
      {openKey && (
        <TagContactList
          cell={cells.find(c => c.key === openKey)}
          bucket={coverage[openKey]}
          onNavigate={onNavigate}
          onClose={() => setOpenKey(null)}
          onOpenContact={onOpenContact}
        />
      )}
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

// --- Edit mode ------------------------------------------------------------
//
// Reordering, retitling and adding steps all live behind one "Edit steps"
// toggle rather than being always-on. The page is read at the start of the
// day and edited once in a while, so the reading version stays clean and
// the editing controls only appear when they're wanted.

const EDIT_INPUT = {
  width: '100%', boxSizing: 'border-box', padding: '0.3rem 0.45rem',
  border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff',
  fontFamily: 'inherit', color: '#1E293B', outline: 'none',
};
const EDIT_BTN = {
  padding: '0.25rem 0.5rem', borderRadius: 5, cursor: 'pointer',
  border: '1px solid #CBD5E1', background: '#fff', color: '#475569',
  fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap',
};

// The tab a step's action button opens. "No tab" is a real choice — a step
// that's a reminder rather than a hand-off has nowhere to send anyone, and
// the button is left off that row entirely.
function ViewPicker({ value, onChange, id }) {
  return (
    <select
      id={id}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      style={{ ...EDIT_INPUT, width: 'auto', fontSize: '0.7rem', cursor: 'pointer' }}
      title="The tab this step's button opens"
    >
      <option value="">No tab</option>
      {STEP_VIEW_OPTIONS.map(o => <option key={o.view} value={o.view}>{o.label}</option>)}
    </select>
  );
}

// Move / remove for one row. The arrows are the whole reordering story:
// they work by keyboard and on touch, which a drag handle doesn't, and the
// ladder is six-ish rows long — far enough from a drag-worthy list.
function StepEditControls({ index, total, onMove, onRemove }) {
  const arrow = { ...EDIT_BTN, padding: '0 0.4rem', lineHeight: '1.15rem', fontSize: '0.72rem' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, alignSelf: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 3 }}>
        <button
          type="button" onClick={() => onMove(-1)} disabled={index === 0}
          title="Move up" aria-label="Move step up"
          style={{ ...arrow, opacity: index === 0 ? 0.35 : 1, cursor: index === 0 ? 'default' : 'pointer' }}
        >&#9650;</button>
        <button
          type="button" onClick={() => onMove(1)} disabled={index === total - 1}
          title="Move down" aria-label="Move step down"
          style={{ ...arrow, opacity: index === total - 1 ? 0.35 : 1, cursor: index === total - 1 ? 'default' : 'pointer' }}
        >&#9660;</button>
      </div>
      <button
        type="button" onClick={onRemove} title="Remove this step"
        style={{ ...arrow, color: '#B91C1C', border: '1px solid #FECACA' }}
      >Remove</button>
    </div>
  );
}

// The "add a step" form at the bottom of the edit list. A title is the only
// thing required — a step with no detail and no tab is still a line on the
// ladder, and the rest can be filled in afterwards like any other row.
function AddStepForm({ onAdd }) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [view, setView] = useState('');
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onAdd({ title: t, detail: detail.trim(), view });
    setTitle(''); setDetail(''); setView('');
  };
  return (
    <div style={{ border: '1px dashed #CBD5E1', borderRadius: 8, padding: '0.7rem 0.85rem', background: '#fff' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: 6 }}>
        Add a step
      </div>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        placeholder="What the step is — e.g. “Work the conference follow-up list”"
        style={{ ...EDIT_INPUT, fontSize: '0.84rem', fontWeight: 700 }}
      />
      <input
        value={detail}
        onChange={e => setDetail(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        placeholder="Why it sits where it does (optional)"
        style={{ ...EDIT_INPUT, fontSize: '0.74rem', marginTop: 5 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 6 }}>
        <ViewPicker value={view} onChange={setView} />
        <button
          type="button" onClick={submit} disabled={!title.trim()}
          style={{
            ...EDIT_BTN, border: '1px solid #0A66C2', background: title.trim() ? '#0A66C2' : '#E2E8F0',
            color: title.trim() ? '#fff' : '#94A3B8', cursor: title.trim() ? 'pointer' : 'default',
          }}
        >Add step</button>
        <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>
          Added at the bottom — move it up with the arrows.
        </span>
      </div>
    </div>
  );
}

export function ProspectingView({ onNavigate, issues = null, serviceGaps = null, prospects = null, onSelectProspect, settings = null, updateSettings = null, tagCoverage = null, tagDebt = null }) {
  const { user } = useAuth();
  const oppsRecords = useOppsRecords(user?.uid);
  // Tag-review coverage per roster, printed under the market-updates step —
  // handed down from App rather than worked out here, so this row and the
  // sidebar badge are literally the same numbers rather than two runs of the
  // same rule over inputs that can land at different moments.
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

  // The contact whose popup is open, straight off the row that was clicked —
  // the tag list carries the HubSpot record, so there's nothing to look up.
  const [editingContact, setEditingContact] = useState(null);
  const openContact = useCallback((contact) => { if (contact) setEditingContact(contact); }, []);
  const closeContact = useCallback(() => setEditingContact(null), []);
  // The popup saves through HubSpot and the shared cache itself, so there's
  // nothing for this page to write back — the coverage above recomputes off
  // the hubspot-cache-updated event like every other reader. A `silent` save
  // is the popup's tag autosave, which must not close it.
  const saveContact = useCallback((_updated, opts) => { if (!opts?.silent) setEditingContact(null); }, []);

  // The rest of the book, for the popup's Reports-To picker: the manager
  // being named is often someone the rosters don't list. Read on the first
  // open rather than on mount — the ladder doesn't need it, and most visits
  // never open a contact — and kept afterwards, since it's the same cache
  // every time.
  const [allContacts, setAllContacts] = useState(null);
  useEffect(() => {
    if (!editingContact || allContacts) return;
    let cancelled = false;
    getHubspotCache()
      .then(c => { if (!cancelled) setAllContacts(c?.contacts || []); })
      // An empty list only costs the popup its autocomplete, so failing
      // quietly beats blocking the edit.
      .catch(() => { if (!cancelled) setAllContacts([]); });
    return () => { cancelled = true; };
  }, [editingContact, allContacts]);

  // Colleagues at the open contact's company, and the account's email
  // domains — the same two lookups the other pages hand the popup.
  const editCompanyContacts = useMemo(() => {
    const k = String(editingContact?.company || '').trim().toLowerCase();
    if (!k || !allContacts) return [];
    return allContacts.filter(c => String(c?.company || '').trim().toLowerCase() === k);
  }, [editingContact, allContacts]);
  const editEmailDomains = useMemo(() => {
    const k = String(editingContact?.company || '').trim().toLowerCase();
    if (!k) return [];
    const matched = (prospects || []).find(p => String(p.company || '').trim().toLowerCase() === k);
    return matched?.emailDomain
      ? String(matched.emailDomain).split(/[\n;,]+/).map(x => x.trim()).filter(Boolean)
      : [];
  }, [editingContact, prospects]);
  const editCompanyNames = useMemo(() => (prospects || []).map(p => p.company).filter(Boolean), [prospects]);
  const contactEditSettings = useContactEditSettings({ settings, updateSettings });

  const counts = useMemo(
    () => ({
      opps: overdueCallIns,
      renewals: renewalWork,
      'targeted-services': serviceWork,
      'pe-intros': topPcIntros ? topPcIntros.length : null,
    }),
    [overdueCallIns, renewalWork, serviceWork, topPcIntros],
  );


  // The ladder itself: the defaults until the user edits it, their stored
  // order and text after that. Editing is only offered when the page was
  // handed an updateSettings — without one there's nowhere to save to.
  const steps = useMemo(() => readSteps(settings), [settings]);

  const canEdit = typeof updateSettings === 'function';
  const [editing, setEditing] = useState(false);
  // Text as it's being typed, keyed by step. Held here rather than written
  // through on every keystroke: a settings write per character round-trips
  // to Firestore and fights the cursor. Committed on blur.
  const [drafts, setDrafts] = useState({});

  const commitSteps = (next) => {
    setDrafts({});
    updateSettings?.({ [PROSPECTING_STEPS_SETTING]: serializeSteps(next) });
  };
  const draftFor = (step) => drafts[step.key] || { title: step.title, detail: step.detail || '' };
  const setDraft = (step, patch) => setDrafts(d => ({ ...d, [step.key]: { ...draftFor(step), ...patch } }));
  // A blank title would leave an unreadable row, so an emptied one snaps
  // back rather than saving. Anything else commits only when it changed.
  const commitDraft = (step) => {
    const d = drafts[step.key];
    if (!d) return;
    const title = d.title.trim();
    const detail = (d.detail || '').trim();
    if (!title) {
      setDrafts((d2) => { const rest = { ...d2 }; delete rest[step.key]; return rest; });
      return;
    }
    if (title === step.title && detail === (step.detail || '')) return;
    commitSteps(steps.map(s => (s.key === step.key ? { ...s, title, detail } : s)));
  };
  const setStepView = (step, view) => commitSteps(
    steps.map(s => (s.key === step.key ? { ...s, view, viewLabel: viewLabelFor(view, '') } : s)),
  );
  const removeStep = (step) => {
    // Removing a built-in step also removes whatever counts it: worth
    // saying out loud, since the count is the reason those rows earn their
    // place and it isn't obvious that the two travel together.
    const warning = isCustomStep(step.key)
      ? `Remove “${step.title}”?`
      : `Remove “${step.title}”?\n\nThis is one of the built-in steps. Anything it counts or lists for you goes with it — “Reset to defaults” brings it back.`;
    if (!window.confirm(warning)) return;
    commitSteps(steps.filter(s => s.key !== step.key));
  };
  const addStep = ({ title, detail, view }) => commitSteps([
    ...steps,
    { key: newStepKey(), title, detail, view, viewLabel: viewLabelFor(view, '') },
  ]);
  const resetSteps = () => {
    if (!window.confirm('Restore the original steps, in their original order? Any step you added will be removed.')) return;
    setDrafts({});
    // null rather than the default array: absent means "never touched", so
    // the page keeps tracking the shipped copy from here on.
    updateSettings?.({ [PROSPECTING_STEPS_SETTING]: null });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
      <div style={{ padding: '1rem 1.25rem 0.5rem', flexShrink: 0, maxWidth: 860 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Prospecting</h2>
          {canEdit && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {editing && isCustomized(settings) && (
                <button type="button" onClick={resetSteps} style={{ ...EDIT_BTN, color: '#B91C1C', border: '1px solid #FECACA' }}>
                  Reset to defaults
                </button>
              )}
              <button
                type="button"
                onClick={() => { setDrafts({}); setEditing(v => !v); }}
                style={editing
                  ? { ...EDIT_BTN, background: '#0A66C2', border: '1px solid #0A66C2', color: '#fff' }
                  : EDIT_BTN}
              >
                {editing ? 'Done' : 'Edit steps'}
              </button>
            </div>
          )}
        </div>
        <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
          {editing
            ? 'Reorder with the arrows, click a title or description to rewrite it, and add steps of your own at the bottom. Changes save as you go.'
            : `The order prospecting work gets done, ranked. Start at the top and work down —
               each step is warmer than the one below it. The Status column says whether a step
               is clear: counted steps answer for themselves, the rest you mark caught up for the day.`}
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
          {!editing && <div style={{ width: STATUS_COL, flexShrink: 0, textAlign: 'center' }}>Status</div>}
          {!editing && onNavigate && <div style={{ width: ACTION_COL, flexShrink: 0 }} />}
        </div>

        {steps.length === 0 && (
          <div style={{ padding: '1rem', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: '0.75rem', color: '#64748B' }}>
            No steps yet. {editing ? 'Add one below, or reset to the originals.' : 'Use “Edit steps” to add one, or reset to the originals.'}
          </div>
        )}

        {steps.map((step, i) => {
          const rank = i + 1;
          const colors = RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)];
          const isLast = rank === steps.length;
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
                {editing ? (
                  <>
                    <input
                      value={draftFor(step).title}
                      onChange={e => setDraft(step, { title: e.target.value })}
                      onBlur={() => commitDraft(step)}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      aria-label="Step title"
                      style={{ ...EDIT_INPUT, fontSize: '0.88rem', fontWeight: 700 }}
                    />
                    <input
                      value={draftFor(step).detail}
                      onChange={e => setDraft(step, { detail: e.target.value })}
                      onBlur={() => commitDraft(step)}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      placeholder="Why it sits where it does (optional)"
                      aria-label="Step description"
                      style={{ ...EDIT_INPUT, fontSize: '0.74rem', color: '#64748B', marginTop: 5 }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 700 }}>Opens:</span>
                      <ViewPicker value={step.view} onChange={v => setStepView(step, v)} />
                      {/* Which rows answer for themselves and which the user
                          ticks isn't visible once the status pills are off
                          screen, and it's the one thing about a step that
                          can't be edited — so say it here. */}
                      <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>
                        {tracked ? 'Counted automatically' : 'Marked caught up by hand'}
                      </span>
                    </div>
                  </>
                ) : (
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
                )}
                {!editing && step.detail && (
                  <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: 3 }}>
                    {step.detail}
                  </div>
                )}
                {!editing && step.key === 'market-updates' && (
                  <TagCoverageBar
                    coverage={tagCoverage}
                    onNavigate={onNavigate ? () => onNavigate('contacts') : null}
                    missing={tagDebt || []}
                    onOpenContact={openContact}
                  />
                )}
                {!editing && step.key === 'targeted-services' && <ServiceGapList gaps={serviceGaps} />}
                {!editing && step.key === 'pe-intros' && (
                  <TopPcIntroList
                    rows={topPcIntros}
                    expanded={showAllTopPcs}
                    onExpand={() => setShowAllTopPcs(v => !v)}
                    onSelectProspect={onSelectProspect}
                    byId={prospectById}
                  />
                )}
              </div>
              {editing ? (
                <StepEditControls
                  index={i}
                  total={steps.length}
                  onMove={delta => commitSteps(moveStep(steps, i, delta))}
                  onRemove={() => removeStep(step)}
                />
              ) : (
                <>
                  <StatusCell
                    state={state}
                    label={label}
                    title={title}
                    align={hasList ? 'flex-start' : 'center'}
                    onToggle={tracked ? null : () => setStepCaughtUp(step.key, !marked, today)}
                  />
                  {onNavigate && (step.view ? (
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
                  ) : (
                    // A step pointed at no tab still holds the column, so
                    // the buttons on the rows above and below stay lined up.
                    <div style={{ width: ACTION_COL, flexShrink: 0 }} />
                  ))}
                </>
              )}
            </div>
          );
        })}

        {editing && <AddStepForm onAdd={addStep} />}
      </div>

      {/* No fallback: the popup is a modal, and a "Loading…" panel flashing
          where it's about to appear is worse than the click taking a beat. */}
      {editingContact && (
        <Suspense fallback={null}>
          <ContactEditModal
            contact={editingContact}
            onSave={saveContact}
            onClose={closeContact}
            {...contactEditSettings}
            companyContacts={editCompanyContacts}
            allContacts={allContacts}
            emailDomains={editEmailDomains}
            companyNames={editCompanyNames}
          />
        </Suspense>
      )}
    </div>
  );
}
