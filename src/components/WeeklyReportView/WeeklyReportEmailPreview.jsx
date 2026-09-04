// "Preview email" — what the Weekly Report actually looks like in an inbox.
//
// The scheduled email is built on the server from the snapshot this tab
// publishes, which used to mean the only way to see it was to send one to
// yourself. This renders the very same bytes: the live snapshot goes
// through the server's own builder (buildSnapshotDoc — the bounding and
// the `capturedAt` stamp included, so the freshness line reads exactly as
// the email's will) and then through the mailer's own renderer.
//
// It is shown in an iframe rather than inline because the email carries
// its own <style> block and page background; dropping that markup into
// the app would let the two stylesheets fight. `sandbox="allow-same-origin"`
// (and nothing else) leaves scripts off — the rendered email has none —
// while still letting the frame be measured so it can size to its content.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSnapshotDoc } from '../../../api/_lib/weeklyReportSnapshot.js';
import { renderWeeklyReportHtml } from '../../../api/_lib/weeklyReportEmailHtml.js';

// The two widths worth checking: a desktop client, and a phone narrow
// enough to trip the email's stacking breakpoint.
const WIDTHS = [
  { key: 'desktop', label: 'Desktop', px: 840 },
  { key: 'phone', label: 'Phone', px: 400 },
];

export function WeeklyReportEmailPreview({
  open, onClose, snapshot = null, subject = '', message = '', recipients = '', uid = null,
}) {
  const [widthKey, setWidthKey] = useState('desktop');
  const [height, setHeight] = useState(700);
  const frameRef = useRef(null);

  const html = useMemo(() => {
    if (!open || !snapshot) return '';
    // Through the server's builder first, so the preview inherits the same
    // caps (25 changes listed, 12 active goals, …) the email is subject to.
    const doc = buildSnapshotDoc(snapshot, { uid, email: '' });
    return renderWeeklyReportHtml(doc, { message });
  }, [open, snapshot, message, uid]);

  // Grow the frame to its content, so the preview scrolls with the modal
  // instead of trapping the report in a small box with its own scrollbar.
  useEffect(() => {
    if (!open) return undefined;
    const fit = () => {
      const doc = frameRef.current?.contentDocument;
      const h = doc?.documentElement?.scrollHeight;
      if (h) setHeight(h + 8);
    };
    const t = setTimeout(fit, 60);
    return () => clearTimeout(t);
  }, [open, html, widthKey]);

  if (!open) return null;

  const width = WIDTHS.find(w => w.key === widthKey) || WIDTHS[0];
  const shownSubject = String(subject || '').trim()
    || `Weekly Report${snapshot?.periodLabel ? ` — ${snapshot.periodLabel}` : ''}`;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1100, padding: '3vh 1rem', overflowY: 'auto' }}
    >
      <div style={{ background: '#fff', borderRadius: 10, width: 'min(940px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ padding: '0.9rem 1.25rem', background: '#009530', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700 }}>Email preview</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {WIDTHS.map(w => (
              <button
                key={w.key}
                type="button"
                onClick={() => setWidthKey(w.key)}
                style={{
                  padding: '0.25rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: '0.72rem', fontWeight: 700,
                  border: '1px solid rgba(255,255,255,0.6)',
                  background: widthKey === w.key ? '#fff' : 'transparent',
                  color: widthKey === w.key ? '#009530' : '#fff',
                }}
              >{w.label}</button>
            ))}
            <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1, marginLeft: '0.25rem' }}>×</button>
          </div>
        </div>

        {/* The envelope, so the preview answers "what will land" and not
            just "what will it look like". */}
        <div style={{ padding: '0.6rem 1.25rem', borderBottom: '1px solid #E2E8F0', fontSize: '0.75rem', color: '#475569', background: '#F8FAFC' }}>
          <div><strong style={{ color: '#64748B', fontWeight: 700 }}>Subject </strong>{shownSubject}</div>
          <div style={{ marginTop: 2 }}>
            <strong style={{ color: '#64748B', fontWeight: 700 }}>To </strong>
            {String(recipients || '').trim() ? String(recipients).replace(/\s*[\n,;]\s*/g, ', ') : <span style={{ color: '#94A3B8' }}>whoever the schedule sends to</span>}
          </div>
        </div>

        <div style={{ padding: '1rem', background: '#E2E8F0', maxHeight: '72vh', overflowY: 'auto' }}>
          {html ? (
            <iframe
              ref={frameRef}
              title="Weekly Report email preview"
              sandbox="allow-same-origin"
              srcDoc={html}
              onLoad={() => {
                const doc = frameRef.current?.contentDocument;
                const h = doc?.documentElement?.scrollHeight;
                if (h) setHeight(h + 8);
              }}
              style={{
                display: 'block', margin: '0 auto', border: '1px solid #CBD5E1', borderRadius: 6,
                background: '#fff', width: width.px, maxWidth: '100%', height,
              }}
            />
          ) : (
            <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.8rem', color: '#475569', background: '#fff', borderRadius: 6 }}>
              Nothing to preview yet — this tab has no report data cached for the selected period.
            </div>
          )}
        </div>

        <div style={{ padding: '0.6rem 1.25rem', borderTop: '1px solid #E2E8F0', fontSize: '0.7rem', color: '#64748B' }}>
          This is the same HTML the scheduled email sends, rendered here in your browser. Outlook lays out some of it slightly differently — the widths, cards and bars are built for that.
        </div>
      </div>
    </div>
  );
}
