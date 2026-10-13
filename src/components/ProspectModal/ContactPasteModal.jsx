// "Paste Contacts" on the company popup: dump in whatever text describes a
// handful of people (a LinkedIn search copied off the page, spreadsheet
// columns, lines typed by hand) and add them all to this company at once.
//
// The reading is parseContactPaste's; this is the review step on top of it.
// Every parsed row is shown editable with a checkbox, because the parse is a
// guess and the save goes to HubSpot. Rows that look like somebody already
// on the company start unticked.
//
// HubSpot will not create a contact without an email. A row with one typed
// or pasted goes there as-is; otherwise the company's recorded email format
// (Email Domains) fills in a guessed address, shown in grey so it reads as
// a guess. A row neither can give an address to is still kept, as a
// contact held in the app only - the same way the HubSpot page saves an
// emailless bulk upload - and goes to HubSpot the first time somebody saves
// it from the contact popup with an email.

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../utils/apiFetch';
import { updateHubspotCache, notifyCacheUpdated } from '../../utils/hubspotContactsCache';
import { buildEmailFromPattern } from '../../utils/emailDomainPattern';
import { parseContactPaste } from '../../utils/contactPaste';

const PLACEHOLDER = `Paste anything with names in it, one person after another. For example:

Jane Doe - Director of Sustainability - linkedin.com/in/janedoe
John Smith, VP Energy & Utilities
https://www.linkedin.com/in/maria-garcia-9a8b7c

A LinkedIn people search copied straight off the page works too, and so do columns pasted from a spreadsheet.`;

const lower = (s) => String(s || '').trim().toLowerCase();
const nameKey = (f, l) => `${lower(f)} ${lower(l)}`.trim();
const linkKey = (u) => lower(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');

const th = { padding: '0.35rem 0.4rem', textAlign: 'left', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', borderBottom: '1px solid #E2E8F0', fontWeight: 700, whiteSpace: 'nowrap' };
const td = { padding: '0.25rem 0.3rem', verticalAlign: 'middle' };
const input = { width: '100%', boxSizing: 'border-box', padding: '0.25rem 0.35rem', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', color: '#1E293B', background: '#fff' };

export function ContactPasteModal({ company, emailDomain = '', existingContacts = [], onClose, onAdded }) {
  const [text, setText] = useState('');
  // Edits made to parsed rows, keyed by the row's position in the parse.
  // Typing more into the box re-parses and drops them, which is what the
  // user expects of a box they are still filling in.
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  const existing = useMemo(() => {
    const names = new Set();
    const links = new Set();
    const emails = new Set();
    for (const c of existingContacts) {
      const n = nameKey(c.firstname, c.lastname);
      if (n) names.add(n);
      const l = linkKey(c.hs_linkedin_url || c.linkedin_url || c.linkedinUrl);
      if (l) links.add(l);
      if (c.email) emails.add(lower(c.email));
    }
    return { names, links, emails };
  }, [existingContacts]);

  const parsed = useMemo(() => parseContactPaste(text, { company }), [text, company]);

  const rows = useMemo(() => parsed.map((p, i) => {
    const r = { ...p, ...(edits[i] || {}) };
    const guessed = !r.email ? buildEmailFromPattern(emailDomain, r.firstname, r.lastname) : '';
    const duplicate = (r.linkedin && existing.links.has(linkKey(r.linkedin)))
      || (r.email && existing.emails.has(lower(r.email)))
      || existing.names.has(nameKey(r.firstname, r.lastname));
    const include = edits[i] && 'include' in edits[i] ? edits[i].include : !duplicate;
    return { ...r, guessed, duplicate, include, idx: i };
  }), [parsed, edits, emailDomain, existing]);

  const chosen = rows.filter(r => r.include && (r.firstname || r.lastname));
  const toHubspot = chosen.filter(r => r.email || r.guessed).length;
  const appOnly = chosen.length - toHubspot;

  function edit(i, patch) {
    setEdits(prev => ({ ...prev, [i]: { ...(prev[i] || {}), ...patch } }));
  }

  function onTextChange(v) {
    setText(v);
    setEdits({});
    setResult(null);
  }

  function close() { if (!saving) onClose(); }

  async function addAll() {
    if (chosen.length === 0 || saving) return;
    setSaving(true);
    setResult(null);
    setProgress({ done: 0, total: chosen.length });
    const added = [];
    const errors = [];
    let existed = 0;
    for (const r of chosen) {
      const firstname = r.firstname.trim();
      const lastname = r.lastname.trim();
      const email = (r.email || r.guessed || '').trim();
      const props = { company, firstname, lastname };
      if (r.jobtitle.trim()) props.jobtitle = r.jobtitle.trim();
      if (r.linkedin.trim()) props.hs_linkedin_url = r.linkedin.trim();
      const label = `${firstname} ${lastname}`.trim();
      try {
        if (email) {
          const res = await apiFetch('/api/hubspot?action=create-contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ properties: { ...props, email } }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.success || !json.contact?.id) {
            throw new Error(json?.message || json?.error || `HubSpot ${res.status}`);
          }
          const record = json.alreadyExisted
            ? json.contact
            : { ...props, email, ...json.contact, _source: 'manual' };
          if (json.alreadyExisted) existed += 1;
          await updateHubspotCache(draft => {
            // An address HubSpot already had hands back that record: make
            // sure it's present, but leave its fields alone.
            if (!draft.contacts.some(c => String(c.id || c.vid) === String(record.id))) draft.contacts.push(record);
          });
          added.push(record);
        } else {
          const record = { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, _localOnly: true, _source: 'paste', ...props, email: '' };
          await updateHubspotCache(draft => {
            if (!Array.isArray(draft.contacts)) draft.contacts = [];
            draft.contacts.push(record);
          });
          added.push(record);
        }
      } catch (err) {
        errors.push({ idx: r.idx, text: `${label}: ${err?.message || err}` });
      }
      setProgress(p => ({ ...p, done: p.done + 1 }));
    }
    notifyCacheUpdated();
    if (added.length) onAdded(added);
    setSaving(false);
    setProgress(null);
    if (errors.length === 0) { onClose(); return; }
    // Keep the failures on screen, and only the failures in the grid, so
    // they can be fixed and retried without re-adding the ones that went in.
    setResult({ added: added.length, existed, errors });
    const failed = new Set(errors.map(e => e.idx));
    setEdits(prev => {
      const next = { ...prev };
      for (const r of rows) {
        if (!failed.has(r.idx)) next[r.idx] = { ...(next[r.idx] || {}), include: false };
      }
      return next;
    });
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }} onClick={close}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, width: 1000, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}
      >
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>Paste Contacts</div>
            <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
              Add several people to <strong>{company}</strong> at once. Names, titles and LinkedIn URLs are read out of whatever you paste.
            </div>
          </div>
          <button onClick={close} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: '1.2rem', color: '#94A3B8', cursor: saving ? 'not-allowed' : 'pointer' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <textarea
            autoFocus
            value={text}
            onChange={e => onTextChange(e.target.value)}
            placeholder={PLACEHOLDER}
            disabled={saving}
            rows={rows.length ? 6 : 12}
            style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit', resize: 'vertical', color: '#1E293B' }}
          />

          {text.trim() && rows.length === 0 && (
            <div style={{ padding: '0.5rem 0.75rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: '0.75rem', color: '#92400E' }}>
              No names found yet. Put each person's first and last name at the start of their own line, or include their LinkedIn URL.
            </div>
          )}

          {result && (
            <div style={{ padding: '0.5rem 0.75rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: '0.75rem', color: '#991B1B' }}>
              <div style={{ fontWeight: 700 }}>
                Added {result.added} contact{result.added === 1 ? '' : 's'}{result.existed ? ` (${result.existed} already in HubSpot)` : ''}. {result.errors.length} failed and {result.errors.length === 1 ? 'is' : 'are'} still ticked below:
              </div>
              {result.errors.map(e => <div key={e.idx}>{e.text}</div>)}
            </div>
          )}

          {rows.length > 0 && (
            <>
              {!emailDomain.trim() && (
                <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
                  This company has no email format on record, so no addresses can be guessed. People without an email are kept in the app only until one is added.
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    <th style={{ ...th, width: 28 }}>
                      <input
                        type="checkbox"
                        checked={rows.every(r => r.include)}
                        onChange={e => setEdits(prev => {
                          const next = { ...prev };
                          for (const r of rows) next[r.idx] = { ...(next[r.idx] || {}), include: e.target.checked };
                          return next;
                        })}
                        disabled={saving}
                        title="Select all"
                      />
                    </th>
                    <th style={{ ...th, width: '14%' }}>First Name</th>
                    <th style={{ ...th, width: '14%' }}>Last Name</th>
                    <th style={th}>Title</th>
                    <th style={{ ...th, width: '22%' }}>LinkedIn URL</th>
                    <th style={{ ...th, width: '20%' }}>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.idx} style={{ borderBottom: '1px solid #F1F5F9', opacity: r.include ? 1 : 0.5 }}>
                      <td style={td}>
                        <input type="checkbox" checked={r.include} disabled={saving} onChange={e => edit(r.idx, { include: e.target.checked })} />
                      </td>
                      <td style={td}><input style={input} value={r.firstname} disabled={saving} onChange={e => edit(r.idx, { firstname: e.target.value })} /></td>
                      <td style={td}>
                        <input style={input} value={r.lastname} disabled={saving} onChange={e => edit(r.idx, { lastname: e.target.value })} />
                      </td>
                      <td style={td}>
                        <input style={input} value={r.jobtitle} disabled={saving} onChange={e => edit(r.idx, { jobtitle: e.target.value })} placeholder="No title found" />
                        {r.duplicate && (
                          <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#B45309', marginTop: 2 }}>Looks like someone already on this company</div>
                        )}
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <input style={input} value={r.linkedin} disabled={saving} onChange={e => edit(r.idx, { linkedin: e.target.value })} placeholder="linkedin.com/in/..." />
                          {r.linkedin && (
                            <a href={/^https?:\/\//i.test(r.linkedin) ? r.linkedin : `https://${r.linkedin}`} target="_blank" rel="noopener noreferrer" title="Open profile" style={{ color: '#0A66C2', textDecoration: 'none', fontSize: '0.75rem' }}>↗</a>
                          )}
                        </div>
                      </td>
                      <td style={td}>
                        <input
                          style={input}
                          value={r.email}
                          disabled={saving}
                          onChange={e => edit(r.idx, { email: e.target.value })}
                          placeholder={r.guessed || 'None: app only'}
                          title={r.guessed && !r.email ? 'Guessed from the company email format. Type over it if you know the real address.' : undefined}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ flex: 1, fontSize: '0.7rem', color: '#64748B' }}>
            {progress
              ? `Adding ${progress.done} of ${progress.total}…`
              : rows.length > 0 && (
                <>
                  {rows.length} found, {chosen.length} selected
                  {chosen.length > 0 && `: ${toHubspot} to HubSpot${appOnly ? `, ${appOnly} app only (no email)` : ''}`}
                </>
              )}
          </div>
          <button
            onClick={close}
            disabled={saving}
            style={{ padding: '0.45rem 0.9rem', border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
          >Cancel</button>
          <button
            onClick={addAll}
            disabled={saving || chosen.length === 0}
            style={{ padding: '0.45rem 0.9rem', border: 'none', background: chosen.length === 0 ? '#94A3B8' : 'var(--color-accent)', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, cursor: (saving || chosen.length === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
          >
            {saving ? 'Adding…' : `Add ${chosen.length} contact${chosen.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
