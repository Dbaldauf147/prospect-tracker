// Where to forward bounce notices so they get logged, and how the last check
// went (utils/bounceScan.js). A bounce is logged only once its notice is
// forwarded to this address; the app then flags the failed address as a bad
// email on the contact popup and the campaigns.
import { useEffect, useState } from 'react';
import { lastBounceScan, BOUNCE_SCAN_EVENT } from '../../utils/bounceScan';

function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function BounceForwardNote() {
  const [scan, setScan] = useState(lastBounceScan);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const on = () => setScan(lastBounceScan());
    window.addEventListener(BOUNCE_SCAN_EVENT, on);
    return () => window.removeEventListener(BOUNCE_SCAN_EVENT, on);
  }, []);
  const to = scan?.forwardTo || '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(to); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select it by hand */ }
  };
  return (
    <div data-bounce-forward style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--color-text-secondary)', margin: '0.25rem 0 0.6rem' }}>
      <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>Bounce notices:</span>
      {to ? (
        <>
          <span>forward each one to</span>
          <code style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--color-surface-alt, #F1F5F9)', color: 'var(--color-text)', fontSize: '0.72rem' }}>{to}</code>
          <button
            type="button"
            onClick={copy}
            style={{ padding: '1px 8px', borderRadius: 4, border: '1px solid #BFDBFE', background: copied ? '#DCFCE7' : '#EFF6FF', color: copied ? '#166534' : '#1E40AF', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >{copied ? 'Copied!' : 'Copy'}</button>
          <span title="Only forwarded notices are logged. The failed address in each one is flagged as a bad email on its contact and on every campaign.">
            to flag the address as a bad email.
          </span>
        </>
      ) : (
        <span>{scan ? 'the forwarding address will show once the app mailbox answers.' : 'checking...'}</span>
      )}
      {scan?.at && (
        <span style={{ color: scan.ok ? 'var(--color-text-muted)' : '#B91C1C' }} title={scan.error || ''}>
          {scan.ok
            ? `Checked ${ago(scan.at)}: ${scan.found} bounced address${scan.found === 1 ? '' : 'es'} in the last forwards.`
            : `Last check failed: ${scan.error}`}
        </span>
      )}
    </div>
  );
}
