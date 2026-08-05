import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  buildNewOppsDigestEmailHtml, downloadNewOppsOutlookDraft,
  NEW_OPPS_DRAFT_DEFAULTS, resolveNewOppsDraftTemplate,
} from '../../utils/newOppsDigestEmail';

// Editor for the wording the New Opps "Download Outlook draft" starts with.
// The recipient, subject, greeting and the optional paragraph above the table
// were fixed in code ("Hey Keith," to keith.mchugh@se.com); this saves an
// override in userSettings so every draft comes out in the user's own words.
//
// The preview is the actual email body — the same buildNewOppsDigestEmailHtml
// output the .eml carries — so what's on screen is what opens in Outlook. The
// signature is the saved settings HTML, appended verbatim exactly as the
// draft does.
const FIELDS = [
  { key: 'to', label: 'To', placeholder: 'name@company.com', hint: 'Separate multiple addresses with commas.' },
  { key: 'subject', label: 'Subject', placeholder: 'New Opportunities' },
  { key: 'greeting', label: 'Greeting', placeholder: 'Hey Keith,', hint: 'The first line, above the table. Leave blank to drop it.' },
];

const inputStyle = {
  width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.8rem', fontFamily: 'inherit',
  color: 'var(--color-text)', background: 'var(--color-surface)',
  border: '1px solid var(--color-border)', borderRadius: 4,
};

// The editor mounts only while the modal is open, so its draft state seeds
// from the saved template on every open — closing without saving discards the
// edit rather than resurrecting it next time.
export function NewOppsDraftEmailModal({ open, ...props }) {
  if (!open) return null;
  return <DraftEmailEditor {...props} />;
}

function DraftEmailEditor({ onClose, records = [], signature = '', template, onSave }) {
  const [form, setForm] = useState(() => resolveNewOppsDraftTemplate(template));
  const [saved, setSaved] = useState(false);

  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setSaved(false); };

  const previewHtml = useMemo(
    () => buildNewOppsDigestEmailHtml(records, {
      message: form.message, greeting: form.greeting, signature,
    }),
    [records, form.message, form.greeting, signature],
  );

  const isDefault = Object.keys(NEW_OPPS_DRAFT_DEFAULTS)
    .every((k) => form[k] === NEW_OPPS_DRAFT_DEFAULTS[k]);

  const save = () => { onSave?.({ ...form }); setSaved(true); };
  const saveAndDownload = () => {
    onSave?.({ ...form });
    downloadNewOppsOutlookDraft(records, { ...form, signature });
    onClose?.();
  };

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
        style={{
          width: 'min(900px, 95vw)', maxHeight: '90vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem',
        }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
              Outlook draft text
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
              The wording every “Download Outlook draft” starts with. Saved to your settings.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button
              type="button"
              onClick={saveAndDownload}
              disabled={records.length === 0}
              title={records.length ? 'Save this wording and download the draft now' : 'No new opps to draft'}
              style={{
                padding: '0.4rem 0.9rem', background: records.length ? '#0F6CBD' : '#94A3B8',
                border: `1px solid ${records.length ? '#0F6CBD' : '#94A3B8'}`, borderRadius: 4,
                fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit', color: '#fff',
                cursor: records.length ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap',
              }}
            >Save &amp; download draft</button>
            <button
              type="button"
              onClick={save}
              style={{
                padding: '0.4rem 0.9rem', background: 'transparent',
                border: '1px solid #009530', borderRadius: 4,
                fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
                color: saved ? '#059669' : '#009530', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >{saved ? 'Saved!' : 'Save'}</button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.4rem 0.8rem', background: 'transparent',
                border: '1px solid var(--color-border)', borderRadius: 4,
                fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
                color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >Close</button>
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 0.85rem' }}>
            {FIELDS.map((f) => (
              <label key={f.key} style={{ display: 'block', gridColumn: f.key === 'to' ? '1 / -1' : undefined }}>
                <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 2 }}>
                  {f.label}
                </span>
                <input
                  type="text"
                  value={form[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                  style={inputStyle}
                />
                {f.hint && (
                  <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{f.hint}</span>
                )}
              </label>
            ))}
          </div>

          <label style={{ display: 'block', marginTop: '0.7rem' }}>
            <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 2 }}>
              Intro paragraph
            </span>
            <textarea
              rows={3}
              value={form.message}
              placeholder="Optional: sits between the greeting and the table."
              onChange={(e) => set('message', e.target.value)}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginTop: '0.55rem' }}>
            <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
              The table and your signature are added automatically. Scheduled emails keep their own subject and message: edit those under “Schedule email”.
            </span>
            <button
              type="button"
              onClick={() => { setForm({ ...NEW_OPPS_DRAFT_DEFAULTS }); setSaved(false); }}
              disabled={isDefault}
              style={{
                fontSize: '0.72rem', fontFamily: 'inherit', background: 'none', border: 'none', padding: 0,
                color: isDefault ? 'var(--color-text-muted)' : '#1E40AF',
                cursor: isDefault ? 'default' : 'pointer', whiteSpace: 'nowrap',
              }}
            >Reset to default</button>
          </div>

          <div style={{ marginTop: '0.85rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: 4 }}>
              Preview {records.length ? `(${records.length} opp${records.length === 1 ? '' : 's'})` : '(no opps right now)'}
            </div>
            <div
              style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '0.75rem', background: '#fff', overflowX: 'auto' }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
