import { useState, useEffect } from 'react';

export function CdmNameModal({ open, onClose, currentName, onSave }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(currentName || '');
  }, [open, currentName]);

  if (!open) return null;

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSave(trimmed);
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
            disabled={saving || !value.trim() || value.trim() === (currentName || '')}
            style={{
              padding: '0.4rem 0.95rem', border: 'none',
              background: '#1A2332', color: '#fff', borderRadius: 6,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              cursor: saving ? 'wait' : 'pointer',
              opacity: (!value.trim() || value.trim() === (currentName || '')) ? 0.5 : 1,
            }}
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
