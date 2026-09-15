import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// The saved Indicative Savings workbook, as one button in the popup's top
// row.
//
// It used to be a green strip across the top of the card: a heading, the
// file name, when it was saved, how big it is, and three buttons - five
// lines of chrome above the account, on every tab, saying the same thing
// every time the card was opened. What it is worth is a yes: there IS an
// analysis saved here. That fits in a button, and the button sits with the
// other things you do TO this account rather than above the account itself.
//
// Everything the strip said is still here, a click away, because the file
// name and the date are what somebody checks before they trust a figure the
// analysis produced. The button's own tooltip carries both, so the common
// case does not need the click.
//
// Nothing renders at all without a saved analysis, which is how the card
// says there is none: an empty strip saying "no analysis" is chrome about
// an absence.
export function AnalysisMenu({
  analysis,
  error = '',
  note = '',
  refreshing = false,
  downloading = false,
  removing = false,
  onRefresh,
  onDownload,
  onRemove,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  // Measured off the button on the click that opens it, not in an effect
  // after the fact, and pinned to the button's right edge: the panel is
  // wider than the button and hangs back into the header rather than off
  // the side of the window.
  function toggle() {
    if (open) { setOpen(false); return; }
    const width = 320;
    const r = btnRef.current?.getBoundingClientRect?.();
    setPos(r
      ? {
        top: r.bottom + 6,
        left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
        width,
      }
      : { top: 80, left: 80, width });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (panelRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!analysis) return null;

  const fileName = analysis.fileName || 'Indicative Savings by State.xlsx';
  const capturedAt = analysis.capturedAt?.toDate?.();
  const savedLine = `Saved ${capturedAt ? capturedAt.toLocaleString() : 'recently'}`
    + (analysis.sizeBytes ? ` · ${Math.round(analysis.sizeBytes / 1024).toLocaleString()} KB` : '');

  // Work in flight is said on the button itself. The panel closes behind a
  // click on Download or Remove, and a button that went back to reading
  // "Analysis" while the workbook was still being fetched would look like
  // the click had missed.
  const busyLabel = refreshing ? 'Refreshing…'
    : downloading ? 'Preparing…'
      : removing ? 'Removing…'
        : '';
  const busy = !!busyLabel;

  const action = (label, title, onClick, disabled, tone) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: '0.3rem 0.65rem',
        background: tone === 'solid' ? (disabled ? '#94A3B8' : '#009530') : '#fff',
        color: tone === 'solid' ? '#fff'
          : disabled ? '#94A3B8'
            : tone === 'danger' ? '#B91C1C' : '#166534',
        border: `1px solid ${disabled ? '#CBD5E1' : tone === 'solid' ? '#009530' : tone === 'danger' ? '#FECACA' : '#BBF7D0'}`,
        borderRadius: 6,
        fontSize: '0.74rem',
        fontWeight: 600,
        cursor: disabled ? 'wait' : 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >{label}</button>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={`Indicative Savings Analysis saved on this company: ${fileName}. ${savedLine}. Click to refresh the Scale figures from it, download it, or remove it.`}
        style={{
          padding: '0.25rem 0.6rem',
          border: `1px solid ${busy ? '#CBD5E1' : '#BBF7D0'}`,
          borderRadius: 6,
          background: open ? '#F0FDF4' : '#fff',
          fontSize: '0.72rem',
          fontWeight: 600,
          color: busy ? '#94A3B8' : '#166534',
          cursor: busy ? 'wait' : 'pointer',
          fontFamily: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3rem',
        }}
      >
        {/* The dot is the whole message at a glance: something is saved
            here. */}
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: busy ? '#94A3B8' : '#16A34A' }} />
        {busyLabel || 'Analysis'}
        <span aria-hidden="true" style={{ fontSize: '0.6rem', color: '#64748B' }}>{'▾'}</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width,
            background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8,
            boxShadow: '0 12px 32px rgba(15,23,42,0.18)', zIndex: 10000,
            padding: '0.65rem 0.8rem', fontFamily: 'inherit',
          }}
        >
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Indicative Savings Analysis
          </div>
          <div
            title={fileName}
            style={{ fontSize: '0.78rem', color: '#1E293B', fontWeight: 600, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >{fileName}</div>
          <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: '0.1rem' }}>{savedLine}</div>
          {error && <div style={{ fontSize: '0.68rem', color: '#B91C1C', marginTop: '0.3rem' }}>{error}</div>}
          {note && <div style={{ fontSize: '0.68rem', color: '#166534', marginTop: '0.3rem' }}>{note}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.6rem' }}>
            {/* Re-reads Sites, Accounts, Equipment, Sites w/ Mandate,
                Deregulated Sites and the exposure those mandates carry off
                the company's saved site list, and Indicative Annual Savings
                out of the saved analysis itself - so the Scale figures can
                be brought up to date without loading the portfolio back onto
                the Utility Lookup page and re-saving the whole workbook. The
                note above names anything it could not answer, so this one
                leaves the panel open. */}
            {action(
              refreshing ? 'Refreshing…' : '↻ Refresh figures',
              'Re-read Sites, Accounts, Equipment, Sites w/ Mandate, Deregulated Sites and Est. Max Yearly Exposure from this company’s saved site list - the latest property-type mapping, the current compliance screening and the market classification the list carries - and Indicative Annual Savings from the saved analysis, which is where that figure is produced. Updates the Scale boxes on the Company tab; it does not rebuild the saved workbook.',
              () => onRefresh?.(),
              refreshing,
            )}
            {action(
              downloading ? 'Preparing…' : '⬇ Download',
              downloading ? 'Fetching the workbook…' : 'Download the saved analysis',
              () => { onDownload?.(); setOpen(false); },
              downloading,
              'solid',
            )}
            {/* Last, and the only one in here that isn't green: this is the
                destructive one, and it should not sit where a thumb reaching
                for Download lands. */}
            {action(
              removing ? 'Removing…' : 'Remove',
              removing ? 'Removing…' : 'Delete the saved workbook from this company. The site list and the Scale figures are kept.',
              () => { onRemove?.(); setOpen(false); },
              removing,
              'danger',
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default AnalysisMenu;
