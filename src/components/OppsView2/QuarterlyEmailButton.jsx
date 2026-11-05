// The quarterly Close Rates email (api/close-rates-quarterly.js): when it
// goes and where, how the last one went, and a button to send it now.
// Admin only, like the endpoint.

import { useEffect, useState } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import styles from './CloseRateDeepDive.module.css';

export function QuarterlyEmailButton() {
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    try {
      const res = await apiFetch('/api/close-rates-quarterly?action=status');
      if (res.ok) setStatus(await res.json());
    } catch { /* the button still works without the status */ }
  };
  useEffect(() => { load(); }, []);
  const send = async () => {
    setSending(true); setMessage('');
    try {
      const res = await apiFetch('/api/close-rates-quarterly?action=send', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || `Request failed (${res.status})`);
      setMessage(`Sent: ${json.quarter}, ${json.oppCount} opps`);
    } catch (err) {
      setMessage(`Not sent: ${err.message}`);
    } finally {
      setSending(false);
      load();
    }
  };
  const last = status?.last;
  const tip = [
    status ? `Quarterly email: ${status.schedule}, to ${status.to.join(', ')}.` : 'Quarterly email.',
    'It covers the quarter that has ended, with the tables on this tab (your starred saved filter, or the default view) and every closed opp behind them.',
    last ? (last.ok ? `Last sent ${new Date(last.finishedAt).toLocaleString()} (${last.quarter}).` : `Last run ${new Date(last.finishedAt).toLocaleString()} failed: ${last.error}`) : '',
  ].filter(Boolean).join(' ');
  return (
    <>
      <button type="button" className={styles.exportBtn} onClick={send} disabled={sending} title={tip}>
        {sending ? 'Sending...' : 'Email quarterly report now'}
      </button>
      {message && <span style={{ fontSize: '0.72rem', color: message.startsWith('Sent') ? '#047857' : '#B45309' }}>{message}</span>}
    </>
  );
}
