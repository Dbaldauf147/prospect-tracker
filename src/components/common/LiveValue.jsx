// Hover / pin "what goes into this number" breakdowns.
//
// Any computed figure can be wrapped in <LiveValue>. Hovering it pops out a
// panel showing the formula, the inputs and the exact rows that fed the
// number; clicking pins that panel open so it survives mouse-out (click it
// again, click the ✕, or click elsewhere on the page to dismiss), and the
// pinned panel can be exported to Excel with every contributing row.
//
// It started on the Pipeline metrics table — "46%" is an assertion, and the
// deals behind it are the evidence — and lives here because the Weekly
// Report's close-rate trend asks the same question of the same numbers. Two
// copies of this would be two panels formatting the same opps two ways.
//
// A page opts in by wrapping the region that holds the figures:
//   <LiveValueProvider className={styles.wrapper}>…</LiveValueProvider>
// which is also the box a click in unpins from, so a pinned panel is
// dismissed by clicking the page behind it.
//
// Outside a provider <LiveValue> degrades to a plain span with its `title`,
// so a component carrying breakdowns can still be rendered anywhere.

import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { exportBreakdown } from './liveValueBreakdown';
import styles from './LiveValue.module.css';

const CalcContext = createContext(null);

// Wraps a live value: handles hover-to-preview and click-to-pin. Falls back
// to a plain span (with the native `title`) when rendered outside a
// CalcContext — inside one the panel says strictly more, so the tooltip is
// deliberately not also shown.
export function LiveValue({ id, breakdown, className, style, title, children }) {
  const ctx = useContext(CalcContext);
  if (!ctx) {
    return <span className={className} style={style} title={title}>{children}</span>;
  }
  const data = { id, ...breakdown };
  const isPinned = ctx.pinnedId === id;
  return (
    <span
      className={`${className || ''} ${styles.liveValue} ${isPinned ? styles.liveValuePinned : ''}`.trim()}
      style={style}
      onMouseEnter={(e) => ctx.enter(data, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => ctx.leave(id)}
      onClick={(e) => { e.stopPropagation(); ctx.toggle(data, e.currentTarget.getBoundingClientRect()); }}
    >
      {children}
    </span>
  );
}

// The floating panel itself. Portaled to <body> and positioned next to the
// anchored cell (below it, or above when there's no room below), clamped to
// the viewport. Stays put once pinned.
function CalcPopover({ data, anchor, pinned, onClose, onKeepOpen, onLeave }) {
  const W = 360;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let left = anchor.left;
  if (left + W > vw - 8) left = vw - 8 - W;
  if (left < 8) left = 8;
  const spaceBelow = vh - anchor.bottom - 12;
  const spaceAbove = anchor.top - 12;
  const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
  const style = placeAbove
    ? { left, bottom: vh - anchor.top + 6, maxHeight: Math.max(160, spaceAbove) }
    : { left, top: anchor.bottom + 6, maxHeight: Math.max(160, spaceBelow) };
  return createPortal(
    <div
      className={styles.calcPanel}
      style={{ width: W, ...style }}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={onKeepOpen}
      onMouseLeave={onLeave}
    >
      <CalcContent data={data} pinned={pinned} onClose={onClose} />
    </div>,
    document.body,
  );
}

function CalcContent({ data, pinned, onClose }) {
  const rows = data.rows;
  const aligns = rows?.aligns || [];
  return (
    <>
      <div className={styles.calcHead}>
        <span className={styles.calcTitle}>{data.title}</span>
        <div className={styles.calcHeadActions}>
          {data.rows && Array.isArray(data.rows.columns) && (
            <button
              type="button"
              className={styles.calcExportBtn}
              onClick={() => exportBreakdown(data)}
              title="Export the full breakdown to Excel for further analysis"
            >⬇ Excel</button>
          )}
          {pinned ? (
            <button type="button" className={styles.calcPinBtn} onClick={onClose} title="Unpin this panel">📌 Pinned ✕</button>
          ) : (
            <span className={styles.calcBadge} title="Recomputed live: not a stored value. Click to pin.">∑ live</span>
          )}
        </div>
      </div>
      {data.value != null && data.value !== '' ? <div className={styles.calcValue}>{data.value}</div> : null}
      {data.formula ? <div className={styles.calcFormula}>{data.formula}</div> : null}
      {Array.isArray(data.inputs) && data.inputs.length > 0 ? (
        <div className={styles.calcInputs}>
          {data.inputs.map((it, i) => (
            <div key={i} className={styles.calcInputRow}>
              <span className={styles.calcInputLabel}>{it.label}</span>
              <span className={styles.calcInputVal}>{it.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {rows && rows.data && rows.data.length > 0 ? (
        <div className={styles.calcRows}>
          {rows.head ? <div className={styles.calcRowsHead}>{rows.head}</div> : null}
          <table className={styles.calcTable}>
            <thead>
              <tr>{rows.columns.map((c, i) => <th key={i} className={aligns[i] === 'num' ? styles.calcNum : undefined}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.data.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => <td key={ci} className={aligns[ci] === 'num' ? styles.calcNum : undefined}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.more > 0 ? <div className={styles.calcMore}>…and {rows.more} more</div> : null}
        </div>
      ) : null}
      {data.note ? <div className={styles.calcSource}>{data.note}</div> : null}
    </>
  );
}

// Owns the hover/pin state and renders the single active popover. Hover has a
// short close delay so the cursor can travel into the panel (to scroll a long
// row list) without it vanishing.
function useCalc() {
  const [hover, setHover] = useState(null);   // { data, anchor }
  const [pinned, setPinned] = useState(null); // { data, anchor }
  const hideTimer = useRef(null);
  const clearTimer = () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  const ctx = useMemo(() => ({
    pinnedId: pinned?.data.id ?? null,
    enter: (data, anchor) => { clearTimer(); setHover({ data, anchor }); },
    leave: (id) => {
      clearTimer();
      hideTimer.current = setTimeout(() => setHover(h => (h && h.data.id === id ? null : h)), 160);
    },
    keepOpen: () => clearTimer(),
    closeHover: () => { clearTimer(); setHover(null); },
    toggle: (data, anchor) => {
      clearTimer();
      setHover(null);
      setPinned(p => (p && p.data.id === data.id ? null : { data, anchor }));
    },
    unpin: () => setPinned(null),
  }), [pinned]);
  const active = pinned || hover;
  const popover = active ? (
    <CalcPopover
      key={(active.data.id || '') + (pinned ? '-pin' : '-hover')}
      data={active.data}
      anchor={active.anchor}
      pinned={!!pinned}
      onClose={() => { setPinned(null); setHover(null); }}
      onKeepOpen={ctx.keepOpen}
      onLeave={() => { if (!pinned) ctx.closeHover(); }}
    />
  ) : null;
  return { ctx, popover, pinned, unpin: () => setPinned(null) };
}

/**
 * The region whose live values can be hovered.
 *
 * Wraps its children in the context <LiveValue> reads, renders the one
 * active panel, and unpins on a click anywhere inside it — so the box a
 * page passes here is both "where the figures are" and "click off to
 * dismiss". Everything it needs is internal: a page adds breakdowns by
 * wrapping figures in <LiveValue>, and nothing else.
 */
export function LiveValueProvider({ className, style, children }) {
  const { ctx, popover, pinned, unpin } = useCalc();
  return (
    <CalcContext.Provider value={ctx}>
      <div
        className={className}
        style={style}
        onClick={() => { if (pinned) unpin(); }}
      >
        {popover}
        {children}
      </div>
    </CalcContext.Provider>
  );
}
