// The monthly Changed Jobs email (api/changed-jobs-monthly.js): when it goes
// and where, how the last one went, and a button to send it now. Admin
// only, like the endpoint.

import { useEffect, useState } from 'react';
import { apiFetch } from '../../utils/apiFetch';

export function MonthlyEmailButton() {
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    try {
      const res = await apiFetch('/api/changed-jobs-monthly?action=status');
      if (res.ok) setStatus(await res.json());
    } catch { /* the button still works without the status */ }
  };
  useEffect(() => { load(); }, []);
  const send = async () => {
    setSending(true); setMessage('');
    try {
      const res = await apiFetch('/api/changed-jobs-monthly?action=send', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || `Request failed (${res.status})`);
      setMessage(`Sent: ${json.total} contact${json.total === 1 ? '' : 's'}`);
    } catch (err) {
      setMessage(`Not sent: ${err.message}`);
    } finally {
      setSending(false);
      load();
    }
  };
  const last = status?.last;
  const tip = [
    status ? `Monthly email: ${status.schedule}, to ${status.to.join(', ')}.` : 'Monthly email.',
    'It lists everyone on the Other contacts subtab (not former Schneider Electric coworkers), leaving out anyone hidden from this page or snoozed.',
    last ? (last.ok ? `Last sent ${new Date(last.finishedAt).toLocaleString()}.` : `Last run ${new Date(last.finishedAt).toLocaleString()} failed: ${last.error}`) : '',
  ].filter(Boolean).join(' ');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        onClick={send}
        disabled={sending}
        title={tip}
        style={{ padding: '0.25rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', color: '#475569', fontSize: '0.7rem', fontWeight: 600, cursor: sending ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
      >{sending ? 'Sending...' : 'Email me this now'}</button>
      {message && <span style={{ fontSize: '0.7rem', color: message.startsWith('Sent') ? '#047857' : '#B45309' }}>{message}</span>}
    </span>
  );
}
