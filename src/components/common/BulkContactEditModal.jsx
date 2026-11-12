// The Bulk Edit popup for a list of selected HubSpot contacts, for tables
// outside the company popup (Prospecting > DMs Without Activity first).
// Writes each change to HubSpot through update-contact, patches the local
// contacts cache so the table updates without a re-sync, and keeps Notes in
// the per-user settings.contactNotes as the company popup's Bulk Edit does.
// What to write per contact comes from utils/bulkContactEdit.
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../utils/apiFetch';
import { updateHubspotCache } from '../../utils/hubspotContactsCache';
import { TAG_OPTIONS } from '../../utils/contactTagReview';
import { BULK_CONTACT_FIELDS, planBulkContactEdit } from '../../utils/bulkContactEdit';

const label = { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: '#334155', fontWeight: 600 };
const input = { padding: '0.4rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.85rem', fontFamily: 'inherit' };
const btn = { padding: '0.35rem 0.85rem', borderRadius: 4, fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' };

export function BulkContactEditModal({ contacts, settings, updateSettings, onClose, onDone }) {
  const [field, setField] = useState('jobtitle');
  const def = BULK_CONTACT_FIELDS.find(f => f.key === field) || BULK_CONTACT_FIELDS[0];
  const [mode, setMode] = useState('replace');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const n = contacts.length;

  // Tags already on the selection, so one off the standard list can still be removed.
  const tagChoices = useMemo(() => {
    const out = new Set(TAG_OPTIONS);
    for (const c of contacts) String(c?.dans_tags || '').split(';').map(t => t.trim()).filter(Boolean).forEach(t => out.add(t));
    return [...out].sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  const pickField = (k) => {
    const f = BULK_CONTACT_FIELDS.find(x => x.key === k);
    setField(k);
    setMode(f?.modes ? f.modes[0][0] : 'replace');
    setValue('');
    setError('');
  };
  const blank = value.trim() === '';
  // Clearing a field on every selected contact is a Notes "Replace" only.
  const canApply = !busy && n > 0 && !(blank && !(def.kind === 'notes' && mode === 'replace'));

  const apply = async () => {
    if (!canApply) return;
    setBusy(true);
    setError('');
    const plan = planBulkContactEdit(contacts, { field, mode, value }, settings?.contactNotes || {});
    if (plan.notes) {
      updateSettings({ contactNotes: plan.notes });
      setBusy(false);
      onDone?.(`Notes updated on ${n - plan.skipped} of ${n}.`);
      return;
    }
    const errors = [];
    let done = 0;
    for (const w of plan.writes) {
      setProgress(`Saving ${done + 1} of ${plan.writes.length}...`);
      try {
        const res = await apiFetch('/api/hubspot?action=update-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: w.cid, properties: w.properties }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.error) throw new Error(json?.message || json?.error || `HubSpot ${res.status}`);
        done += 1;
        try {
          await updateHubspotCache(draft => {
            const i = draft.contacts.findIndex(x => String(x.id || x.vid) === w.cid);
            if (i !== -1) draft.contacts[i] = { ...draft.contacts[i], ...w.properties };
          });
        } catch { /* the next sync brings it in */ }
      } catch (err) {
        const c = contacts.find(x => String(x.id || x.vid) === w.cid);
        errors.push(`${[c?.firstname, c?.lastname].filter(Boolean).join(' ') || w.cid}: ${err.message || err}`);
      }
    }
    setBusy(false);
    setProgress('');
    if (errors.length) {
      setError(`${done} saved, ${errors.length} failed: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? `; and ${errors.length - 3} more` : ''}`);
      return;
    }
    onDone?.(`${def.label} updated on ${done} of ${n}${plan.skipped ? ` (${plan.skipped} already had it)` : ''}.`);
  };

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div role="dialog" aria-label="Bulk edit contacts" style={{ width: 440, maxWidth: '92vw', background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)', overflow: 'hidden' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>Bulk Edit {n} contact{n === 1 ? '' : 's'}</div>
          <div style={{ fontSize: '0.7rem', color: '#64748B' }}>Writes to HubSpot for every selected contact. Notes are yours only and skip HubSpot.</div>
        </div>
        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <label style={label}>
            Field
            <select value={field} onChange={e => pickField(e.target.value)} disabled={busy} style={input}>
              {BULK_CONTACT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          {def.modes && (
            <label style={label}>
              How
              <select value={mode} onChange={e => setMode(e.target.value)} disabled={busy} style={input}>
                {def.modes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          )}
          <label style={label}>
            {def.kind === 'tags' ? 'Tags (separate several with ;)' : 'New value'}
            {def.kind === 'notes' ? (
              <textarea rows={3} value={value} onChange={e => setValue(e.target.value)} disabled={busy} style={{ ...input, resize: 'vertical' }} />
            ) : (
              <input type="text" list={def.kind === 'tags' ? 'bulk-contact-tags' : undefined} value={value} onChange={e => setValue(e.target.value)} disabled={busy} style={input} autoFocus />
            )}
          </label>
          {def.kind === 'tags' && <datalist id="bulk-contact-tags">{tagChoices.map(t => <option key={t} value={t} />)}</datalist>}
          {progress && <div style={{ fontSize: '0.75rem', color: '#475569' }}>{progress}</div>}
          {error && <div style={{ fontSize: '0.75rem', color: '#B91C1C' }}>{error}</div>}
        </div>
        <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', background: '#F8FAFC' }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...btn, border: '1px solid #CBD5E1', background: '#fff', color: '#334155' }}>Cancel</button>
          <button type="button" onClick={apply} disabled={!canApply} style={{ ...btn, border: 'none', background: canApply ? '#2563EB' : '#94A3B8', color: '#fff', cursor: canApply ? 'pointer' : 'default' }}>
            {busy ? 'Saving...' : `Apply to ${n}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
