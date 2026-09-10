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
// themselves; the rest the user marks caught up for the day. A hand-marked
// step the ladder has reached — everything above it clear — goes red as
// the work owed right now rather than waiting to be noticed, and the
// sidebar dots Prospecting while it stands. See utils/prospectingStatus.js
// for that rule and for why a manual mark expires overnight.
//
// Several steps list their work in place rather than only counting it: the
// services still short of coverage, the Top PC of every PE firm that isn't
// already Qualifying, the email campaigns that haven't finished going out,
// the Key contacts a visit hasn't reached yet, and the accounts with no
// decision maker mapped yet — so the calls to make are on the page rather
// than a tab away.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { setStepCaughtUp, todayISO } from '../../utils/prospectingStatus';
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
import { ROSTER_CATEGORIES } from '../../utils/contactRosters';
import { keyContactsNotMet } from '../../utils/metInPerson';
import { useContactEditSettings } from '../../hooks/useContactEditSettings';
import { companyPopupTarget } from '../../utils/companyLookup';
import { auditablePeople, setQueuedAuditContacts } from '../../utils/tagAuditQueue';

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

// A step that's caught up drops its rank colour for green — the whole row,
// not only the pill 130px away on the right. The ladder is read top to
// bottom to find the first thing still owed, and the rank ramp is what
// answers "where am I", not "what's left": with the status only in the
// right-hand column, seven pale blue rows all look alike and the eye has
// to travel to each pill in turn. Green rows are the ones already dealt
// with, so what is left stands out by not being green.
//
// Deliberately paler than the status pill's own #DCFCE7, so the pill still
// reads as a chip sitting on the row rather than dissolving into it.
const CAUGHT_UP_COLORS = { badge: '#16A34A', ring: '#BBF7D0', tint: '#F2FDF5' };

// Fixed widths so the two right-hand cells line up as columns across
// rows of different heights — and so the header labels sit over them.
// Wide enough for the longest tab name a step can point at ("Email
// Campaigns →", which the market-updates step opens): at 128 its arrow sat
// on top of the button's own border.
const STATUS_COL = 132;
const ACTION_COL = 144;

const STATUS_STYLES = {
  'caught-up': { background: '#DCFCE7', border: '#BBF7D0', color: '#166534' },
  // 'due' wears the same red as a counted step with work on it: the
  // ladder has reached it, so it is owed today just as literally.
  work: { background: '#FEE2E2', border: '#FECACA', color: '#991B1B' },
  due: { background: '#FEE2E2', border: '#FECACA', color: '#991B1B' },
  open: { background: '#fff', border: '#CBD5E1', color: '#64748B' },
};

// The tag-review coverage, roster by roster, under the contact-mapping step.
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
function TagContactList({ cell, bucket, onNavigate, onClose, onOpenContact, onAudit }) {
  const people = Array.isArray(bucket?.people) ? bucket.people : [];
  const shown = people.slice(0, TAG_LIST_LIMIT);
  // The contacts this list is flagging — the ones still short of a full set
  // of answers — as the tag history audit can read them. Not the shown slice:
  // a roster longer than the inline limit still hands over all of them. Left
  // unmemoized deliberately: it is one filter over a list that is already in
  // memory, and memoizing a value derived from a prop array is what the
  // React Compiler refuses to preserve here.
  const flagged = auditablePeople(people);
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
        {/* Straight into the tag history audit with exactly these contacts.
            When tags have gone missing this list is the set worth reading
            HubSpot's history for, and re-finding the names by hand on the
            HubSpot page is the sort of work that stops an audit being run. */}
        {onAudit && flagged.length > 0 && (
          <button
            type="button"
            onClick={() => onAudit(flagged)}
            title={`Send these ${flagged.length} contact${flagged.length === 1 ? '' : 's'} to the tag history audit on the HubSpot page, which reads what tags they used to carry and when they went. Nothing is changed.`}
            style={{
              padding: '1px 7px', background: '#fff', border: '1px solid #FCA5A5', borderRadius: 5,
              fontSize: '0.66rem', fontWeight: 700, fontFamily: 'inherit', color: '#B91C1C', cursor: 'pointer',
            }}
          >Audit tag history ({flagged.length})</button>
        )}
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

function TagCoverageBar({ coverage, onNavigate, missing = [], onOpenContact, onAudit }) {
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
          onAudit={onAudit}
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
// The email campaigns that haven't finished sending, under the
// market-updates step.
//
// "Reach out to contacts with market updates" is exactly what a saved
// campaign is a batch of, and a campaign sitting at 39% sent is that step
// half-done: twenty people who were meant to hear from us and haven't.
// Until this the only place that showed was the Saved Campaigns table two
// tabs away, so a stall was invisible from the page that ranks the work.
//
// Each row reads like the service-coverage rows above it — name, how far
// it got, how many are left — and opens the Email Campaigns tab, where the
// unsent recipients can be pushed into a draft.
//
// Paused campaigns aren't here (see unfinishedCampaigns): a pause is the
// user having dealt with one for a couple of days, and the step's status
// already leaves it out, so listing it under a row reading "All caught up"
// only made the two contradict each other. It comes back on its own when
// the pause lifts.
function CampaignOutreachList({ rows, onNavigate }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.02em' }}>
          Campaigns under 100% sent:
        </span>
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            style={{
              padding: 0, border: 0, background: 'none', font: 'inherit',
              fontSize: '0.68rem', fontWeight: 700, color: '#0A66C2', cursor: 'pointer',
              textDecoration: 'underline', textDecorationColor: '#BFDBFE', textUnderlineOffset: 2,
            }}
          >Open Email Campaigns</button>
        )}
      </div>
      {rows.map((c) => (
        <div
          key={`${c.index}-${c.label}`}
          title={(c.total > 0
            ? `${c.sent} of ${c.total} sent (${c.pct}%) — ${c.remaining} still to go`
            : 'Saved with nobody on it yet — 0% sent. Open the campaign to build its list')
            + (c.active ? '' : ' · Inactive: no save or refresh in the last 60 days, or marked inactive by hand')}
          style={{
            display: 'flex', alignItems: 'baseline', gap: '0.5rem',
            fontSize: '0.72rem', lineHeight: 1.35,
            // An inactive campaign is still listed — a parked one that never
            // finished is exactly what goes quiet — but it doesn't read as
            // live work.
            opacity: c.active ? 1 : 0.6,
          }}
        >
          <span style={{
            fontWeight: 700, color: '#334155', minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{c.label}</span>
          {/* Same figures the Saved Campaigns table prints, through the same
              function, so the two pages can't disagree about a percentage.
              Tabular figures keep the column straight down the list. A
              campaign with no list yet says so instead of printing "0 to
              go", which would read as nothing left to do on the one row
              where everything is. */}
          <span style={{ color: '#94A3B8', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {c.total > 0 ? `${c.pct}% sent · ${c.remaining} to go` : '0% sent · no contacts yet'}
          </span>
          {!c.active && (
            <span style={{
              flexShrink: 0, padding: '0 6px', borderRadius: 999,
              background: '#F1F5F9', color: '#64748B',
              fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase',
            }}>Inactive</span>
          )}
        </div>
      ))}
    </div>
  );
}

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

// How many firms show without expanding. They're ordered by how far the
// relationship has got, so the top of the list is the part worth reading
// anyway.
const PE_FIRM_PREVIEW = 5;

// The PE Stage palette, matching the PE Portfolio board so a firm is the
// same colour in both places. Only the three stages this list can show
// need one — Lead and Not Sold never appear here.
const PE_STAGE_TINT = {
  Discovery: { bg: '#EFF6FF', border: '#BFDBFE', ink: '#2563EB' },
  Piloting: { bg: '#FFFBEB', border: '#FDE68A', ink: '#D97706' },
  'Existing Partnership': { bg: '#ECFDF5', border: '#A7F3D0', ink: '#059669' },
};

// One PE firm with a live relationship and nothing on it: the firm, the
// stage it has reached, and how many portfolio companies it brings to the
// conversation. The name clicks through to the firm's record.
function PeFirmRow({ row, onSelectProspect, byId, last }) {
  const tint = PE_STAGE_TINT[row.stage] || { bg: '#F8FAFC', border: '#E2E8F0', ink: '#64748B' };
  const nameStyle = {
    padding: 0, border: 0, background: 'none', font: 'inherit', textAlign: 'left',
    cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#CBD5E1',
    textUnderlineOffset: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    display: 'block', maxWidth: '100%', color: '#1E293B', fontWeight: 700,
  };
  const flatStyle = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', maxWidth: '100%' };
  const open = () => { const p = byId?.get(row.firmId); if (p) onSelectProspect(p); };
  return (
    <div style={{ padding: '4px 0', borderBottom: last ? 'none' : '1px dashed #EEF0FA', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
        <span
          title={`PE Stage: ${row.stage}. Lead firms and Not Sold ones are left off this list — one hasn’t been opened, the other has answered.`}
          style={{
            flexShrink: 0, padding: '1px 6px', borderRadius: 999,
            background: tint.bg, border: `1px solid ${tint.border}`, color: tint.ink,
            fontSize: '0.62rem', fontWeight: 700, whiteSpace: 'nowrap',
          }}
        >{row.stage}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {row.firmId && onSelectProspect
            ? <button type="button" style={nameStyle} onClick={open} title={`Open ${row.firm}`}>{row.firm}</button>
            : <span style={{ ...flatStyle, color: '#1E293B', fontWeight: 700 }}>{row.firm}</span>}
        </div>
        {/* What there is to talk about. A firm with no mapped portfolio
            companies is its own kind of gap — the call is the same one,
            but there is nothing yet to ask for an intro INTO. */}
        <span
          title={row.pcCount
            ? `${row.pcCount} portfolio ${row.pcCount === 1 ? 'company names' : 'companies name'} this firm as their PE Owner`
            : 'No portfolio companies mapped to this firm yet'}
          style={{
            flexShrink: 0, padding: '0 6px', borderRadius: 999,
            border: '1px solid #E2E8F0', background: '#fff',
            fontSize: '0.62rem', fontWeight: 700,
            color: row.pcCount ? '#334155' : '#94A3B8',
            fontStyle: row.pcCount ? 'normal' : 'italic',
          }}
        >{row.pcCount ? `${row.pcCount} PC${row.pcCount === 1 ? '' : 's'}` : 'No PCs mapped'}</span>
        {/* Why a firm with a history is nonetheless sitting here: every one
            of its deals is done with. Without this the row reads as a firm
            nobody has ever opened, and the user goes looking for the opps
            the PE Portfolio table is showing them. */}
        {row.closedCount > 0 && (
          <span
            title={`${row.closedCount} closed opportunit${row.closedCount === 1 ? 'y' : 'ies'} on this firm or its portfolio companies and nothing open — the PE Opps column reads 0/${row.closedCount}. Closed deals aren't something in flight, so the firm still belongs on this list.`}
            style={{
              flexShrink: 0, padding: '0 6px', borderRadius: 999,
              border: '1px solid #E2E8F0', background: '#F8FAFC',
              fontSize: '0.62rem', fontWeight: 700, color: '#64748B',
            }}
          >{row.closedCount} closed</span>
        )}
      </div>
    </div>
  );
}

function PeFirmList({ rows, expanded, onExpand, onSelectProspect, byId }) {
  if (!rows || rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, PE_FIRM_PREVIEW);
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
          <PeFirmRow
            key={row.firmId || row.firm}
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

// The Key contacts nobody has met yet, listed under the visits step.
//
// "Plan in person visits" asks who you would see while you are in their
// city, and until now it asked it with nothing to answer from: the one
// field that knows anything about it — Met In Person — was two tabs away on
// the Key Contacts table. These are the Key roster's unmet contacts,
// grouped by the account a trip would be to, so the step names the visits
// worth planning rather than only reminding you to plan some.
//
// It stays a list and never a count: nothing here says a trip HAS been
// planned (Met In Person records one that already happened, weeks later),
// so the step is still marked caught up by hand and still stays grey rather
// than going red — see prospectingPlaybook.js. A step asking to book travel
// shouldn't dot the sidebar every morning because there is a name on it.
const VISIT_ACCOUNT_PREVIEW = 5;

function VisitContactList({ summary, onNavigate, onOpenContact }) {
  const groups = summary?.groups;
  const [expanded, setExpanded] = useState(false);
  if (!groups || groups.length === 0) return null;
  const shown = expanded ? groups : groups.slice(0, VISIT_ACCOUNT_PREVIEW);
  const hidden = groups.length - shown.length;
  const nameStyle = {
    padding: 0, border: 0, background: 'none', font: 'inherit', textAlign: 'left',
    color: '#334155', cursor: 'pointer',
    textDecoration: 'underline', textDecorationColor: '#CBD5E1', textUnderlineOffset: 2,
  };
  return (
    <div style={{ marginTop: 8, fontSize: '0.72rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
        <span
          title="Contacts on the Key roster (tagged Dan Key Target) whose Met In Person answer in the contact popup is No — the same flag the Key Contacts table's Met In Person column shows. Set it to Yes there or on a name below and they drop off this list; set it to Hold off to park them without claiming you've met them."
          style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.02em' }}
        >
          Key contacts not met in person: {summary.total}
          {summary.accounts > 0 && ` across ${summary.accounts} account${summary.accounts === 1 ? '' : 's'}`}
        </span>
        {/* Said out loud rather than just left off: a list that quietly
            shrinks when somebody is parked is a count you can't reconcile
            against the roster. */}
        {summary.onHold > 0 && (
          <span
            title="Key contacts whose Met In Person answer is “Hold off”. Still not met — they're just not on the list of people to go and see."
            style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.02em' }}
          >
            · {summary.onHold} on hold
          </span>
        )}
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            style={{
              padding: 0, border: 0, background: 'none', font: 'inherit',
              fontSize: '0.68rem', fontWeight: 700, color: '#0A66C2', cursor: 'pointer',
              textDecoration: 'underline', textDecorationColor: '#BFDBFE', textUnderlineOffset: 2,
            }}
          >Open Key Contacts</button>
        )}
      </div>
      <div
        style={{
          marginTop: 5, border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff',
          padding: '0.25rem 0.5rem',
          maxHeight: expanded ? 260 : 'none', overflowY: expanded ? 'auto' : 'visible',
        }}
      >
        {shown.map((g, i) => (
          <div
            key={g.company || '(no company)'}
            style={{
              padding: '4px 0', minWidth: 0,
              borderBottom: i === shown.length - 1 ? 'none' : '1px dashed #F1F5F9',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <span style={{
                fontWeight: 700, color: g.company ? '#1E293B' : '#94A3B8',
                fontStyle: g.company ? 'normal' : 'italic',
                minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{g.company || 'No company on the record'}</span>
              {/* Where the trip would be. A contact with no city on the
                  record says so rather than leaving the row looking like it
                  is in the same place as the one above it. */}
              <span
                title={g.location
                  ? `${g.location} — the city and state on these contacts' records`
                  : 'No city on these contacts’ records'}
                style={{
                  flexShrink: 0, padding: '0 6px', borderRadius: 999,
                  border: '1px solid #E2E8F0', background: g.location ? '#F8FAFC' : '#fff',
                  fontSize: '0.62rem', fontWeight: 700,
                  color: g.location ? '#475569' : '#CBD5E1',
                  fontStyle: g.location ? 'normal' : 'italic',
                }}
              >{g.location || 'No city'}</span>
              <span style={{ flex: 1 }} />
              <span
                title={`${g.people.length} Key contact${g.people.length === 1 ? '' : 's'} here you haven’t met`}
                style={{
                  flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                  fontWeight: 700, color: '#94A3B8',
                }}
              >{g.people.length}</span>
            </div>
            {/* The names themselves, not a "3 contacts" summary: who you
                would be going to see is the decision, and each one opens
                the contact popup — where Met In Person is ticked, so the
                list can be worked off from the row that raised it. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 0.45rem', marginTop: 1, color: '#64748B' }}>
              {g.people.map((p, j) => (
                <span key={p.id || `${p.email}-${j}`} style={{ whiteSpace: 'nowrap' }}>
                  {onOpenContact && p.contact
                    ? <button type="button" style={nameStyle} onClick={() => onOpenContact(p.contact)} title={`Open ${p.name}`}>{p.name}</button>
                    : <span>{p.name}</span>}
                  {j < g.people.length - 1 && <span style={{ color: '#94A3B8' }}>,</span>}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          style={{
            marginTop: 4, padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
            border: '1px solid #E2E8F0', background: '#fff', color: '#475569',
            fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700,
          }}
        >
          {expanded ? 'Show fewer' : `Show all ${groups.length} accounts`}
        </button>
      )}
    </div>
  );
}

// The decision makers still to be found, under the cold-outreach step.
//
// Cold outreach needs a name to ring, so the step's first job is mapping
// one: an account with nobody tagged Decision Maker is an account the rest
// of this step can't be worked on at all. The percentages say how far that
// mapping has got, tier by tier, and the table underneath is the accounts
// the current tier is waiting on.
//
// One tier at a time, in order, because that is the order the work is
// worth doing in — see utils/decisionMakerCoverage.js. Tier 2's rows only
// appear once Tier 1 is fully mapped, and Tier 3's once Tier 2 is; until
// then those tiers show their percentage and nothing else, so the table is
// always the list to work now rather than a book to choose from.

// Rows shown before the table asks to be expanded. Long enough for a
// morning's calls, short enough that a book with 300 unmapped accounts
// doesn't paint all of them into a step on a ladder.
const DM_ROWS_SHOWN = 8;

const TIER_TINTS = {
  'Tier 1': { bg: '#EFF6FF', border: '#BFDBFE', ink: '#1D4ED8' },
  'Tier 2': { bg: '#F5F3FF', border: '#DDD6FE', ink: '#6D28D9' },
  'Tier 3': { bg: '#F8FAFC', border: '#E2E8F0', ink: '#475569' },
};
const tierTint = (tier) => TIER_TINTS[tier] || { bg: '#F8FAFC', border: '#E2E8F0', ink: '#475569' };

const DM_CELL = {
  padding: '3px 8px', borderTop: '1px solid #F1F5F9', textAlign: 'left',
  fontSize: '0.72rem', color: '#334155', fontWeight: 400,
};
// Sticky so the columns are still named after the list has been expanded
// and scrolled — a table of company names with the headings scrolled off
// stops saying what its right-hand figure is.
const DM_HEAD = {
  padding: '3px 8px', textAlign: 'left', fontSize: '0.62rem', fontWeight: 700,
  letterSpacing: '0.04em', textTransform: 'uppercase', color: '#94A3B8',
  position: 'sticky', top: 0, background: '#fff', zIndex: 1,
};

function DecisionMakerTable({ coverage, onSelectProspect }) {
  const [expanded, setExpanded] = useState(false);
  if (!coverage) return null;
  const tiers = coverage.tiers.filter(t => t.total > 0);
  // No tiered accounts on this CDM at all — there is no percentage to
  // report and nothing to list, so the step keeps its one-line detail.
  if (tiers.length === 0) return null;
  const focus = coverage.tiers.find(t => t.tier === coverage.focusTier) || null;
  const rows = focus ? focus.missing : [];
  const shown = expanded ? rows : rows.slice(0, DM_ROWS_SHOWN);
  const hidden = rows.length - shown.length;
  // The tiers held back behind the one being worked — named so the table
  // reads as "this tier first", not as a list that forgot the others.
  const waiting = focus
    ? tiers.filter(t => t.missing.length > 0 && t.tier !== focus.tier).map(t => t.tier)
    : [];
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.02em' }}>
          Decision makers mapped:
        </span>
        {tiers.map((t) => {
          const tint = tierTint(t.tier);
          const done = t.missing.length === 0;
          return (
            <span
              key={t.tier}
              title={`${t.mapped} of ${t.total} ${t.tier} account${t.total === 1 ? '' : 's'} have a contact tagged Decision Maker in HubSpot — ${t.missing.length} still to map. Accounts that already have a history are left out entirely — Client, Old Client, Hold Off and Lost - Not Sold — since cold outreach is for names with no relationship yet. The rest are the accounts on your Table View.`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '1px 8px', borderRadius: 999,
                background: done ? '#F0FDF4' : tint.bg,
                border: `1px solid ${done ? '#BBF7D0' : tint.border}`,
                color: done ? '#166534' : tint.ink,
                fontSize: '0.68rem',
                // The tier being worked is the one the table below belongs
                // to, so it is the one the eye should land on first.
                boxShadow: focus && t.tier === focus.tier ? `0 0 0 2px ${tint.border}` : 'none',
              }}
            >
              <span style={{ fontWeight: 700 }}>{t.tier}</span>
              <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{t.pct}%</span>
              <span style={{ opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                {t.mapped}/{t.total}
              </span>
            </span>
          );
        })}
      </div>

      {!focus ? (
        <div style={{ fontSize: '0.72rem', color: '#166534' }}>
          Every tiered account has a decision maker tagged — nothing left to map.
        </div>
      ) : (
        <>
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, background: '#fff', overflow: 'hidden' }}>
            {/* Above the scroll area rather than in the table, so the tier
                the rows belong to is still named once the list is long
                enough to be scrolled. */}
            <div style={{
              padding: '4px 8px',
              background: tierTint(focus.tier).bg,
              borderBottom: `1px solid ${tierTint(focus.tier).border}`,
              fontSize: '0.68rem', fontWeight: 700, color: tierTint(focus.tier).ink,
            }}>
              {focus.tier} — {focus.missing.length} account{focus.missing.length === 1 ? '' : 's'} with no decision maker identified
            </div>
            <div style={{ maxHeight: expanded ? 280 : 'none', overflowY: expanded ? 'auto' : 'visible' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
                  {focus.tier} accounts with no decision maker identified
                </caption>
                <thead>
                  <tr>
                    <th scope="col" style={DM_HEAD}>Account</th>
                    <th scope="col" style={{ ...DM_HEAD, width: 130 }}>Status</th>
                    {/* Nought here means the name still has to be found;
                        anything else means somebody at the company is
                        already in HubSpot and only needs the tag. */}
                    <th scope="col" style={{ ...DM_HEAD, width: 80, textAlign: 'right' }}>Contacts</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id || p.company}>
                      <td style={{ ...DM_CELL, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {onSelectProspect ? (
                          <button
                            type="button"
                            onClick={() => onSelectProspect(p)}
                            title={`Open ${p.company || 'this account'}`}
                            style={{
                              padding: 0, border: 0, background: 'none', font: 'inherit',
                              fontWeight: 700, color: '#1E293B', cursor: 'pointer', textAlign: 'left',
                              maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              textDecoration: 'underline', textDecorationColor: '#CBD5E1', textUnderlineOffset: 2,
                            }}
                          >{p.company || '(unnamed account)'}</button>
                        ) : (
                          <span style={{ fontWeight: 700, color: '#1E293B' }}>{p.company || '(unnamed account)'}</span>
                        )}
                      </td>
                      <td style={{ ...DM_CELL, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.status || '—'}
                      </td>
                      <td
                        style={{
                          ...DM_CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                          color: p.contactCount ? '#B45309' : '#94A3B8',
                        }}
                        title={p.contactCount
                          ? `${p.contactCount} contact${p.contactCount === 1 ? '' : 's'} at this company in HubSpot, none tagged Decision Maker — tag one and this row clears`
                          : 'No contacts at this company in HubSpot yet — the decision maker still has to be found'}
                      >{p.contactCount || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {(hidden > 0 || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              style={{
                alignSelf: 'flex-start', padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                border: '1px solid #E2E8F0', background: '#fff', color: '#0A66C2',
                fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700,
              }}
            >
              {expanded ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
          {waiting.length > 0 && (
            <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>
              {waiting.join(' and ')} {waiting.length === 1 ? 'is' : 'are'} listed once {focus.tier} is fully mapped.
            </div>
          )}
        </>
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

export function ProspectingView({ onNavigate, ladder = null, serviceGaps = null, prospects = null, onSelectProspect, settings = null, settingsLoaded = false, updateSettings = null, tagCoverage = null, tagDebt = null, dmCoverage = null }) {
  // The ladder's status — the steps, what each one counts, and which of
  // them is caught up, outstanding or still loading. Computed once in App
  // (useProspectingLadder) and handed down, so this page's Status column
  // and the sidebar's Prospecting dot are the same answer rather than two
  // runs of the same rule over inputs that can land at different moments —
  // the same reason the tag coverage arrives as a prop rather than being
  // recomputed here.
  const stateByKey = ladder?.stateByKey || {};
  const today = ladder?.today || todayISO();
  // The PE firms with a live relationship and no opportunity on them,
  // listed under their step. Comes from the ladder so the rows here and the
  // count beside them are one list.
  const peFirmsToWork = ladder?.peFirmsToWork || null;
  const [showAllPeFirms, setShowAllPeFirms] = useState(false);
  // The email campaigns that haven't finished sending, printed under the
  // market-updates step. Comes from the ladder for the same reason the
  // counts do: those rows and that step's Status pill are the same read of
  // the same campaigns, so the list can't show two still going out beside
  // a row that says the step is clear. `null` until it has loaded.
  const campaignsToFinish = ladder?.campaignsToFinish || null;
  // The Key contacts nobody has met yet, under the visits step. Built from
  // the same tag coverage the row above it prints percentages from — that
  // is already the Key roster, gated once for the whole app — plus the
  // local Met In Person checkboxes. Null until the coverage lands, which is
  // what keeps an empty list from reading as "you have met everybody".
  const visitContacts = useMemo(
    () => keyContactsNotMet(tagCoverage, settings?.contactMetInPerson || null),
    [tagCoverage, settings?.contactMetInPerson],
  );
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
  // "Company ↗" in the contact popup: close the contact and open the company
  // it names, through the app-level company popup this page already routes
  // its other company links to.
  // Hand a Tagged-row list to the tag history audit and go there.
  //
  // The audit lives on Contacts → HubSpot, which is where the HubSpot token
  // and the contact cache already are. `contacts-view:active-subtab` is that
  // page's memory of which subtab was last open, so setting it is exactly
  // what walking to the HubSpot subtab by hand would have done — and it is
  // what makes this one click instead of three.
  const queueTagAudit = useCallback((contacts) => {
    const n = setQueuedAuditContacts(contacts);
    if (!n) return;
    try { localStorage.setItem('contacts-view:active-subtab', 'hubspot'); } catch (e) { void e; }
    onNavigate?.('contacts');
  }, [onNavigate]);

  // Straight to the Key Contacts table from the visit list, which is where
  // the same contacts can be sorted by city and their Met In Person column
  // worked down in bulk. Same one-click trick as the audit above:
  // `contacts-view:active-subtab` is that page's memory of which subtab was
  // last open, so setting it saves the user the second click.
  const openKeyContacts = useCallback(() => {
    try { localStorage.setItem('contacts-view:active-subtab', 'key'); } catch (e) { void e; }
    onNavigate?.('contacts');
  }, [onNavigate]);

  const openCompanyFromContact = useCallback((name) => {
    const target = companyPopupTarget(prospects, name);
    if (!target || !onSelectProspect) return;
    setEditingContact(null);
    onSelectProspect(target);
  }, [prospects, onSelectProspect]);
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

  // The ladder itself: the defaults until the user edits it, their stored
  // order and text after that — off the shared hook, falling back to the
  // same read if this page is ever rendered without one. Editing is only
  // offered when the page was handed an updateSettings — without one
  // there's nowhere to save to.
  const steps = useMemo(() => ladder?.steps || readSteps(settings), [ladder, settings]);

  // Editing waits for the stored ladder to actually arrive. `settings` is
  // {} until the Firestore snapshot lands, and an empty settings object is
  // indistinguishable from "never customized" — so the page shows the
  // shipped defaults for that moment. Committing any edit made in it
  // serializes THOSE steps as the whole ladder, and every step the user
  // added is gone: the write carries no _lastWriteAt to be stale against
  // (see useUserSettings), so nothing downstream can catch it either.
  // Hence the gate here rather than a guard further down.
  const canEdit = typeof updateSettings === 'function' && settingsLoaded;
  const [editing, setEditing] = useState(false);
  // Text as it's being typed, keyed by step. Held here rather than written
  // through on every keystroke: a settings write per character round-trips
  // to Firestore and fights the cursor. Committed on blur.
  const [drafts, setDrafts] = useState({});

  const commitSteps = (next) => {
    // Belt and braces on the gate above: a write can only ever be made
    // against a ladder the user's own settings produced.
    if (!canEdit) return;
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
    if (!canEdit) return;
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
               each step is warmer than the one below it. A step turns green once it is clear:
               counted steps answer for themselves, the rest you mark caught up for the day —
               and the first one you haven't shows as outstanding once everything above it
               is clear.`}
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
          const isLast = rank === steps.length;
          const row = stateByKey[step.key];
          const tracked = typeof step.workLabel === 'function';
          const count = row?.count;
          const state = row?.state || (tracked ? 'unknown' : 'open');
          // Cleared by what the app already knows rather than by a tick —
          // the market-updates step, once the campaigns have all gone out.
          // It reads like a counted step from here: no undo, because there
          // is no mark to undo.
          const autoCleared = row?.auto === true;
          // Green once the step is clear — but never while the ladder is
          // being edited: the Status column is hidden there, so a green row
          // would be a colour with nothing on screen to explain it, on the
          // one screen where the rows are being dragged around by rank.
          const colors = !editing && state === 'caught-up'
            ? CAUGHT_UP_COLORS
            : RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)];
          // A hand-marked step is caught up only because it was marked,
          // so the toggle reads its state rather than the map again.
          const marked = !tracked && !autoCleared && state === 'caught-up';
          const label = state === 'work' ? step.workLabel(count)
            : state === 'caught-up' ? 'All caught up'
              : state === 'due' ? 'Outstanding'
                : 'Mark caught up';
          const title = state === 'work' ? step.workTitle(count)
            : state === 'caught-up'
              ? (tracked || autoCleared ? step.clearTitle : 'Marked caught up today — clears tomorrow. Click to undo.')
              : state === 'due'
                ? 'Every step above this one is clear, so this is the work owed right now. Click once you\'ve done it today — the mark clears tomorrow.'
                : 'Nothing counts this step automatically — click once you\'ve worked it today';
          // Several steps print their work under the detail line rather
          // than only counting it — those rows are tall, so their
          // right-hand cells sit at the top rather than floating in the
          // middle.
          const hasList = (step.key === 'targeted-services' && serviceGaps?.length)
            || (step.key === 'pe-intros' && peFirmsToWork?.length)
            || (step.key === 'contact-mapping' && tagCoverage?.all?.contacts)
            || (step.key === 'market-updates' && campaignsToFinish?.length)
            || (step.key === 'visits' && visitContacts?.groups?.length)
            || (step.key === 'cold' && dmCoverage?.tiers?.some(t => t.total > 0));
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
                {/* How ready the book is to be written to. It used to sit
                    above the campaigns under one step; they are two
                    different jobs, so they are two steps now. */}
                {!editing && step.key === 'contact-mapping' && (
                  <TagCoverageBar
                    coverage={tagCoverage}
                    onAudit={queueTagAudit}
                    onNavigate={onNavigate ? () => onNavigate('contacts') : null}
                    missing={tagDebt || []}
                    onOpenContact={openContact}
                  />
                )}
                {/* And which writing has been started and not finished. */}
                {!editing && step.key === 'market-updates' && (
                  <CampaignOutreachList
                    rows={campaignsToFinish}
                    onNavigate={onNavigate ? () => onNavigate('campaigns') : null}
                  />
                )}
                {!editing && step.key === 'targeted-services' && <ServiceGapList gaps={serviceGaps} />}
                {/* Who a trip would be for: the Key contacts still unmet,
                    by the account you would be visiting. */}
                {!editing && step.key === 'visits' && (
                  <VisitContactList
                    summary={visitContacts}
                    onNavigate={onNavigate ? openKeyContacts : null}
                    onOpenContact={openContact}
                  />
                )}
                {/* And who there is to ring at the accounts nobody has
                    started on: the decision makers still to be mapped,
                    Tier 1 before Tier 2 before Tier 3. */}
                {!editing && step.key === 'cold' && (
                  <DecisionMakerTable coverage={dmCoverage} onSelectProspect={onSelectProspect} />
                )}
                {!editing && step.key === 'pe-intros' && (
                  <PeFirmList
                    rows={peFirmsToWork}
                    expanded={showAllPeFirms}
                    onExpand={() => setShowAllPeFirms(v => !v)}
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
                    onToggle={tracked || autoCleared ? null : () => setStepCaughtUp(step.key, !marked, today)}
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
            onOpenCompany={onSelectProspect ? openCompanyFromContact : null}
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
