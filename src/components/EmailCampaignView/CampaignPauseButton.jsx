// The Status column's Pause control: a button showing the pause length,
// which opens a small picker to pause for X days or X weeks, or until a date
// picked on its calendar. The calendar highlights each audience's next open
// day from the Email Schedule tab, the days a paused campaign could go out
// again. The last length used is remembered per user (a convenience, so a
// failed read just falls back to the two-day default).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { CAMPAIGN_PAUSE_DAYS, CAMPAIGN_PAUSE_MAX_DAYS, campaignPauseDays, campaignPauseUntil, campaignPauseUntilDay } from '../../utils/campaignOutreach';
import { localDay, addDays, addMonths, calendarWeeks } from '../../utils/emailSchedule';
import { useEmailSchedule, savedMostShare } from './useEmailSchedule';

const LS_KEY = 'emailCampaignPauseLength';
const QUICK = [
  { amount: 2, unit: 'days' },
  { amount: 1, unit: 'weeks' },
  { amount: 2, unit: 'weeks' },
  { amount: 4, unit: 'weeks' },
];

function loadLength() {
  try {
    const v = JSON.parse(userLsGet(LS_KEY) || 'null');
    if (v && campaignPauseDays(v.amount, v.unit)) return { amount: Number(v.amount), unit: v.unit === 'weeks' ? 'weeks' : 'days' };
  } catch { /* fall back to the default */ }
  return { amount: CAMPAIGN_PAUSE_DAYS, unit: 'days' };
}

const lengthLabel = ({ amount, unit }) => `${amount} ${unit === 'weeks' ? (amount === 1 ? 'week' : 'weeks') : (amount === 1 ? 'day' : 'days')}`;
const shortLabel = ({ amount, unit }) => `${amount}${unit === 'weeks' ? 'w' : 'd'}`;

const pill = {
  padding: '2px 6px', borderRadius: '999px', fontSize: '0.62rem', fontWeight: 700,
  fontFamily: 'inherit', cursor: 'pointer', lineHeight: 1.5,
  border: '1px solid var(--color-border)', background: 'var(--color-surface)',
  color: 'var(--color-text-secondary)',
};

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const fmtDay = (day) => new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const OPEN = { background: '#DCFCE7', border: '1px solid #86EFAC', color: '#166534' };
const navBtn = { ...pill, borderRadius: 4, padding: '0 7px', fontSize: '0.8rem' };

// The picker's calendar: a month at a time, today's later days pickable,
// each audience's next open day (Email Schedule's "Next open") in green.
// Mounted only while the picker is open, so the schedule is worked out when
// somebody looks rather than for every row of Saved Campaigns.
function PauseCalendar({ selected, onPick, campaigns, prospects, cdmName }) {
  const [most] = useState(savedMostShare);
  const { groups, today, loading } = useEmailSchedule({ campaigns, prospects, cdmName, most });
  const lastDay = addDays(today, CAMPAIGN_PAUSE_MAX_DAYS);
  // null follows the selected day; the arrows pin a month.
  const [pinned, setPinned] = useState(null);
  const month = pinned || (selected || today).slice(0, 7);
  const weeks = calendarWeeks(month);
  // Audiences by their next open day: two can share one.
  const open = new Map();
  for (const g of groups) {
    if (!g.nextTarget) continue;
    open.set(g.nextTarget, [...(open.get(g.nextTarget) || []), g.label]);
  }
  const openDays = [...open.keys()].sort();
  const pick = (day) => { setPinned(null); onPick(day); };

  return (
    <div data-pause-calendar style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <span data-pause-month style={{ fontWeight: 700, fontSize: '0.72rem', flex: 1 }}>
          {new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button type="button" style={navBtn} aria-label="Previous month" title="Previous month"
          disabled={month <= today.slice(0, 7)} onClick={() => setPinned(addMonths(month, -1))}>&lsaquo;</button>
        <button type="button" style={navBtn} aria-label="Next month" title="Next month"
          disabled={month >= lastDay.slice(0, 7)} onClick={() => setPinned(addMonths(month, 1))}>&rsaquo;</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, textAlign: 'center' }}>
        {WEEKDAYS.map((w, i) => (
          <div key={i} style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-text-muted, #94A3B8)' }}>{w}</div>
        ))}
        {weeks.flat().map((day) => {
          if (day.slice(0, 7) !== month) return <div key={day} />;
          const can = day > today && day <= lastDay;
          const labels = open.get(day);
          const isSel = day === selected;
          return (
            <button key={day} type="button" data-pause-day={day} data-pause-open={labels ? 'true' : undefined}
              disabled={!can} aria-pressed={isSel} onClick={() => pick(day)}
              title={[
                day === today ? 'Today' : '',
                labels ? `Next open: ${labels.join(', ')}` : '',
                can ? `Pause until ${fmtDay(day)}` : '',
              ].filter(Boolean).join('\n')}
              style={{
                font: 'inherit', fontSize: '0.7rem', lineHeight: '20px', height: 22, padding: 0, borderRadius: 4,
                border: '1px solid transparent', background: 'transparent',
                color: can ? 'var(--color-text, #0F172A)' : 'var(--color-text-muted, #CBD5E1)',
                cursor: can ? 'pointer' : 'default',
                ...(day === today ? { fontWeight: 700, textDecoration: 'underline' } : {}),
                ...(labels ? { ...OPEN, fontWeight: 700 } : {}),
                ...(isSel ? { background: '#D97706', border: '1px solid #B45309', color: '#fff', fontWeight: 700 } : {}),
              }}>{Number(day.slice(8))}</button>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: '0.66rem', color: 'var(--color-text-secondary, #64748B)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
          <span style={{ ...OPEN, width: 10, height: 10, borderRadius: 3, boxSizing: 'border-box', display: 'inline-block' }} />
          Next open days from the Email Schedule
        </div>
        {loading && <div>Loading open days...</div>}
        {!loading && openDays.length === 0 && <div>No open day found in the next 6 months.</div>}
        {openDays.map(day => {
          const can = day > today && day <= lastDay;
          return (
            <button key={day} type="button" data-pause-open-chip={day} disabled={!can} onClick={() => pick(day)}
              title={can ? `Pause until ${fmtDay(day)}` : 'Open today, so there is nothing to wait for'}
              style={{
                display: 'block', width: '100%', boxSizing: 'border-box', margin: '2px 0 0', padding: '1px 6px', borderRadius: 4,
                font: 'inherit', fontSize: '0.66rem', textAlign: 'left', cursor: can ? 'pointer' : 'default',
                ...(day === selected ? { background: '#D97706', border: '1px solid #B45309', color: '#fff' } : OPEN),
              }}>
              <strong>{open.get(day).join(', ')}</strong>: {day === today ? 'today' : fmtDay(day)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * `onPause(until)` pauses the campaign until that ISO moment; `returnsTo` is
 * 'Active' or 'Inactive'. `campaigns`, `prospects` and `cdmName` feed the
 * calendar's next open days.
 */
export function CampaignPauseButton({ onPause, returnsTo, campaigns, prospects, cdmName }) {
  const [open, setOpen] = useState(false);
  const [length, setLength] = useState(loadLength);
  const [amount, setAmount] = useState(String(length.amount));
  const [unit, setUnit] = useState(length.unit);
  // A date picked on the calendar ('YYYY-MM-DD'). It wins over the typed
  // length until the length is edited again.
  const [pickedDay, setPickedDay] = useState('');
  const [pos, setPos] = useState(null);
  // When the picker opened, for the resume date it previews.
  const [openedAt, setOpenedAt] = useState(0);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = 248;
    // Room for the calendar: slide up rather than run off the bottom.
    const top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 440));
    setPos({ top, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), width });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const days = campaignPauseDays(amount, unit);
  const pickedUntil = pickedDay ? campaignPauseUntilDay(pickedDay, openedAt) : null;
  const ready = pickedDay ? !!pickedUntil : !!days;
  // The day the pause lifts, for the calendar to mark.
  const resumeDay = pickedDay || (days && openedAt ? localDay(new Date(openedAt + days * 86400000)) : '');

  function pause(next) {
    const d = campaignPauseDays(next.amount, next.unit);
    if (!d) return;
    const saved = { amount: Number(next.amount), unit: next.unit };
    setLength(saved);
    try { userLsSet(LS_KEY, JSON.stringify(saved)); } catch { /* per-browser convenience only */ }
    setOpen(false);
    onPause(campaignPauseUntil(Date.now(), d));
  }

  // The Pause button: until the picked date when there is one, otherwise
  // for the typed length. A picked date is a one-off, so it leaves the
  // remembered length alone.
  function submit() {
    if (!pickedDay) { pause({ amount, unit }); return; }
    if (!pickedUntil) return;
    setOpen(false);
    onPause(pickedUntil);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!open) { setAmount(String(length.amount)); setUnit(length.unit); setPickedDay(''); setOpenedAt(Date.now()); }
          setOpen(o => !o);
        }}
        title={`Pause this campaign for a number of days or weeks, or until a date - it goes back to ${returnsTo} on its own`}
        aria-label="Pause this campaign"
        aria-expanded={open}
        style={pill}
      >Pause {shortLabel(length)}</button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label="Pause length or date"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 3000,
            background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border, #E2E8F0)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.18)', padding: 10,
            fontSize: '0.75rem', color: 'var(--color-text, #0F172A)', textAlign: 'left',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Pause for</div>
          <form
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            style={{ display: 'flex', gap: 6, alignItems: 'center' }}
          >
            <input
              type="number"
              min={1}
              max={unit === 'weeks' ? Math.floor(CAMPAIGN_PAUSE_MAX_DAYS / 7) : CAMPAIGN_PAUSE_MAX_DAYS}
              step={1}
              value={amount}
              autoFocus
              onChange={(e) => { setAmount(e.target.value); setPickedDay(''); }}
              aria-label="How many"
              title={pickedDay ? 'A date is picked below. Type here to pause for a length instead.' : undefined}
              style={{ opacity: pickedDay ? 0.5 : 1, width: 56, padding: '3px 6px', fontSize: '0.75rem', border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 4, fontFamily: 'inherit' }}
            />
            <select
              value={unit}
              onChange={(e) => { setUnit(e.target.value); setPickedDay(''); }}
              aria-label="Days or weeks"
              style={{ opacity: pickedDay ? 0.5 : 1, padding: '3px 4px', fontSize: '0.75rem', border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 4, fontFamily: 'inherit' }}
            >
              <option value="days">days</option>
              <option value="weeks">weeks</option>
            </select>
            <button
              type="submit"
              disabled={!ready}
              style={{
                marginLeft: 'auto', padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700, borderRadius: 4,
                border: 'none', fontFamily: 'inherit', cursor: ready ? 'pointer' : 'not-allowed',
                background: ready ? '#D97706' : '#CBD5E1', color: '#fff',
              }}
            >Pause</button>
          </form>
          <div data-pause-resumes style={{ marginTop: 6, color: ready ? 'var(--color-text-secondary, #64748B)' : '#DC2626', fontSize: '0.68rem' }}>
            {ready
              ? `Resumes ${fmtDay(resumeDay)}, back to ${returnsTo}.`
              : `Pick 1 to ${CAMPAIGN_PAUSE_MAX_DAYS} days (up to ${Math.floor(CAMPAIGN_PAUSE_MAX_DAYS / 7)} weeks), or a date below.`}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
            {QUICK.map(q => (
              <button key={shortLabel(q)} type="button" onClick={() => pause(q)} style={pill} title={`Pause for ${lengthLabel(q)}`}>
                {lengthLabel(q)}
              </button>
            ))}
          </div>
          <div style={{ fontWeight: 700, marginTop: 10 }}>Or pause until a date</div>
          <PauseCalendar selected={resumeDay} onPick={setPickedDay} campaigns={campaigns} prospects={prospects} cdmName={cdmName} />
        </div>,
        document.body,
      )}
    </>
  );
}
