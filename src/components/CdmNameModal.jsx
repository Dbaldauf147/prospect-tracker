import { useState, useEffect } from 'react';

export function CdmNameModal({ open, onClose, currentName, currentWorkEmail = '', onSave }) {
  const [value, setValue] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(currentName || '');
      setWorkEmail(currentWorkEmail || '');
    }
  }, [open, currentName, currentWorkEmail]);

  if (!open) return null;

  const trimmedName = value.trim();
  const trimmedEmail = workEmail.trim();
  const nameChanged = trimmedName !== (currentName || '');
  const emailChanged = trimmedEmail !== (currentWorkEmail || '');
  const disabled = saving || !trimmedName || (!nameChanged && !emailChanged);

  async function handleSave() {
    if (!trimmedName) return;
    setSaving(true);
    try {
      await onSave({ cdmName: trimmedName, workEmail: trimmedEmail });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, width: 'min(440px, 92vw)',
          padding: '1.25rem', boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        }}
      >
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 700 }}>Your CDM name</h3>
        <p style={{ margin: '0 0 0.85rem', fontSize: '0.78rem', color: '#475569' }}>
          The name your prospects&apos; CDM field is matched against. Used by My Accounts, Clients,
          Lists, Progress, and most filtered views. Last name is what actually matches (so &quot;Dan
          Baldauf&quot; matches any CDM containing &quot;Baldauf&quot;).
        </p>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          placeholder="e.g. Jane Smith"
          autoFocus
          style={{
            width: '100%', padding: '0.5rem 0.75rem',
            border: '1px solid #D1D5DB', borderRadius: 6,
            fontSize: '0.85rem', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        <h3 style={{ margin: '1rem 0 0.5rem', fontSize: '1rem', fontWeight: 700 }}>Your work email</h3>
        <p style={{ margin: '0 0 0.85rem', fontSize: '0.78rem', color: '#475569' }}>
          The address HubSpot threads send <em>from</em> when it&apos;s you (e.g.
          jane.smith@se.com). Used by the Agents page&rsquo;s Sent emails section and the email
          direction heuristic. Leave blank if you don&apos;t need outbound matching yet.
        </p>
        <input
          type="email"
          value={workEmail}
          onChange={e => setWorkEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
          placeholder="e.g. jane.smith@se.com"
          style={{
            width: '100%', padding: '0.5rem 0.75rem',
            border: '1px solid #D1D5DB', borderRadius: 6,
            fontSize: '0.85rem', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '0.4rem 0.85rem', border: '1px solid #CBD5E1',
              background: '#fff', borderRadius: 6, fontSize: '0.78rem',
              cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={disabled}
            style={{
              padding: '0.4rem 0.95rem', border: 'none',
              background: '#1A2332', color: '#fff', borderRadius: 6,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              cursor: saving ? 'wait' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
