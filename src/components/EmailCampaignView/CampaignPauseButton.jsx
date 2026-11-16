// The Status column's Pause control: a button showing the pause length,
// which opens a small picker to pause for X days or X weeks. The last length
// used is remembered per user (a convenience, so a failed read just falls
// back to the two-day default).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { CAMPAIGN_PAUSE_DAYS, CAMPAIGN_PAUSE_MAX_DAYS, campaignPauseDays } from '../../utils/campaignOutreach';

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

/** `onPause(days)` pauses the campaign; `returnsTo` is 'Active' or 'Inactive'. */
export function CampaignPauseButton({ onPause, returnsTo }) {
  const [open, setOpen] = useState(false);
  const [length, setLength] = useState(loadLength);
  const [amount, setAmount] = useState(String(length.amount));
  const [unit, setUnit] = useState(length.unit);
  const [pos, setPos] = useState(null);
  // When the picker opened, for the resume date it previews.
  const [openedAt, setOpenedAt] = useState(0);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = 236;
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), width });
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

  function pause(next) {
    const d = campaignPauseDays(next.amount, next.unit);
    if (!d) return;
    const saved = { amount: Number(next.amount), unit: next.unit };
    setLength(saved);
    try { userLsSet(LS_KEY, JSON.stringify(saved)); } catch { /* per-browser convenience only */ }
    setOpen(false);
    onPause(d);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!open) { setAmount(String(length.amount)); setUnit(length.unit); setOpenedAt(Date.now()); }
          setOpen(o => !o);
        }}
        title={`Pause this campaign for a number of days or weeks - it goes back to ${returnsTo} on its own`}
        aria-label="Pause this campaign"
        aria-expanded={open}
        style={pill}
      >Pause {shortLabel(length)}</button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label="Pause length"
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
            onSubmit={(e) => { e.preventDefault(); pause({ amount, unit }); }}
            style={{ display: 'flex', gap: 6, alignItems: 'center' }}
          >
            <input
              type="number"
              min={1}
              max={unit === 'weeks' ? Math.floor(CAMPAIGN_PAUSE_MAX_DAYS / 7) : CAMPAIGN_PAUSE_MAX_DAYS}
              step={1}
              value={amount}
              autoFocus
              onChange={(e) => setAmount(e.target.value)}
              aria-label="How many"
              style={{ width: 56, padding: '3px 6px', fontSize: '0.75rem', border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 4, fontFamily: 'inherit' }}
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              aria-label="Days or weeks"
              style={{ padding: '3px 4px', fontSize: '0.75rem', border: '1px solid var(--color-border, #CBD5E1)', borderRadius: 4, fontFamily: 'inherit' }}
            >
              <option value="days">days</option>
              <option value="weeks">weeks</option>
            </select>
            <button
              type="submit"
              disabled={!days}
              style={{
                marginLeft: 'auto', padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700, borderRadius: 4,
                border: 'none', fontFamily: 'inherit', cursor: days ? 'pointer' : 'not-allowed',
                background: days ? '#D97706' : '#CBD5E1', color: '#fff',
              }}
            >Pause</button>
          </form>
          <div style={{ marginTop: 6, color: days ? 'var(--color-text-secondary, #64748B)' : '#DC2626', fontSize: '0.68rem' }}>
            {days
              ? `Resumes ${new Date(openedAt + days * 86400000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, back to ${returnsTo}.`
              : `Pick 1 to ${CAMPAIGN_PAUSE_MAX_DAYS} days (up to ${Math.floor(CAMPAIGN_PAUSE_MAX_DAYS / 7)} weeks).`}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
            {QUICK.map(q => (
              <button key={shortLabel(q)} type="button" onClick={() => pause(q)} style={pill} title={`Pause for ${lengthLabel(q)}`}>
                {lengthLabel(q)}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
