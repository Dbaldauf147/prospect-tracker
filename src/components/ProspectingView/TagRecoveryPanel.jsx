// "Recover lost tags": search the settings backups for tag answers the
// roster contacts have lost, preview what would come back, and put it back.
// The plan is utils/tagRecovery.js; this is the button, the preview and the
// two writes (the answers to settings, the tags to the app's tag store
// through restore-tags, which only ever adds).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../utils/apiFetch';
import { settingsBackupSources } from '../../utils/settingsBackupSources';
import { updateHubspotCache } from '../../utils/hubspotContactsCache';
import { planTagRecovery, withRecoveredAnswers } from '../../utils/tagRecovery';

const SHOWN = 200;
const LABEL = { yes: 'Yes', no: 'No', unsure: 'Not sure', sold: 'Sold', notsold: 'Not sold' };

export function TagRecoveryPanel({ coverage, tagReviewMap, updateSettings }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const contacts = (coverage?.all?.people || []).map(p => ({
    id: p.id,
    name: p.name,
    company: p.company,
    tags: String(p.contact?.dans_tags || p.contact?.dan_s_tags || p.contact?.dans_tag || ''),
  })).filter(c => c.id);

  async function search() {
    setOpen(true);
    setPlan(null);
    setDone('');
    setBusy(true);
    setStatus('Reading backups...');
    try {
      const { sources, read } = await settingsBackupSources(
        d => !!(d && d.contactTagReview && typeof d.contactTagReview === 'object'),
        { onProgress: setStatus },
      );
      const backups = sources.map(s => ({ label: s.label, review: s.data.contactTagReview }));
      const next = planTagRecovery({ contacts, current: tagReviewMap || {}, backups });
      setPlan({ ...next, read, backupCount: backups.length });
      setStatus('');
    } catch (err) {
      setStatus(`Couldn't read the backups: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!plan || !plan.rows.length) return;
    setBusy(true);
    const errors = [];
    try {
      if (plan.answerCount > 0 && updateSettings) {
        setStatus('Putting the answers back...');
        updateSettings(s => ({ contactTagReview: withRecoveredAnswers(s?.contactTagReview, plan.rows) }));
      }
      const withTags = plan.rows.filter(r => r.addTags.length);
      let tagsWritten = 0;
      const newTags = new Map();
      for (let i = 0; i < withTags.length; i += 100) {
        setStatus(`Putting tags back (${Math.min(i + 100, withTags.length)} of ${withTags.length} contacts)...`);
        const chunk = withTags.slice(i, i + 100);
        const res = await apiFetch('/api/hubspot?action=restore-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dryRun: false, restores: chunk.map(r => ({ id: r.id, tags: r.addTags })) }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { errors.push(json?.error || `HTTP ${res.status}`); continue; }
        tagsWritten += json.written || 0;
        for (const e of json.errors || []) errors.push(e);
        for (const p of json.plans || []) if (p.action === 'write') newTags.set(String(p.id), p.to);
      }
      if (newTags.size) {
        await updateHubspotCache(draft => {
          draft.contacts = draft.contacts.map(c => (newTags.has(String(c.id))
            ? { ...c, dans_tags: newTags.get(String(c.id)), dan_s_tags: newTags.get(String(c.id)), dans_tag: newTags.get(String(c.id)) }
            : c));
        });
      }
      setDone(`Put back ${plan.answerCount} answer${plan.answerCount === 1 ? '' : 's'} and tags on ${tagsWritten} contact${tagsWritten === 1 ? '' : 's'}.${errors.length ? ` Problems: ${errors.join('; ')}` : ''}`);
      setPlan(null);
      setStatus('');
    } catch (err) {
      setStatus(`Stopped: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  const btn = {
    padding: '1px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700, fontFamily: 'inherit',
    cursor: 'pointer', border: '1px solid #A7F3D0', background: '#ECFDF5', color: '#047857',
  };

  return (
    <>
      <button
        type="button"
        data-tag-recover
        onClick={search}
        disabled={busy || !contacts.length}
        title="Search your browser and nightly backups for tag answers these contacts have lost, and the tags a Yes or Sold says they had. Shows what it found before changing anything; it only fills gaps, never replaces an answer."
        style={btn}
      >Recover lost tags</button>
      {open && createPortal(
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
        >
          <div role="dialog" aria-label="Recover lost tags" data-tag-recover-dialog
            style={{ width: 'min(720px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.9rem', borderBottom: '1px solid #E2E8F0' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A' }}>Recover lost tags</span>
              <button type="button" aria-label="Close" disabled={busy} onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.1rem', lineHeight: 1, color: '#64748B', cursor: 'pointer' }}
              >&times;</button>
            </div>
            <div style={{ padding: '0.7rem 0.9rem', overflowY: 'auto', fontSize: '0.74rem', color: '#334155' }}>
              {status && <div style={{ marginBottom: 8, color: '#475569' }}>{status}</div>}
              {done && <div data-tag-recover-done style={{ marginBottom: 8, color: '#047857', fontWeight: 600 }}>{done}</div>}
              {plan && (
                <>
                  <div data-tag-recover-summary style={{ marginBottom: 8 }}>
                    Searched {plan.backupCount} backup{plan.backupCount === 1 ? '' : 's'}
                    {plan.read?.oldest ? ` back to ${plan.read.oldest}` : ''}
                    {plan.read?.cloudError ? ` (cloud backups: ${plan.read.cloudError})` : ''}.{' '}
                    {plan.rows.length === 0
                      ? 'Nothing is missing that a backup has: every answer the backups hold is still here.'
                      : <><strong>{plan.answerCount}</strong> answer{plan.answerCount === 1 ? '' : 's'} and <strong>{plan.tagCount}</strong> tag{plan.tagCount === 1 ? '' : 's'} to put back on <strong>{plan.rows.length}</strong> contact{plan.rows.length === 1 ? '' : 's'}. Only gaps are filled: nothing answered today is changed.</>}
                  </div>
                  {plan.rows.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                      <thead>
                        <tr style={{ color: '#94A3B8', textAlign: 'left' }}>
                          <th style={{ padding: '3px 4px' }}>Contact</th>
                          <th style={{ padding: '3px 4px' }}>Tags back on</th>
                          <th style={{ padding: '3px 4px' }}>Answers back</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.rows.slice(0, SHOWN).map(r => (
                          <tr key={r.id} style={{ borderTop: '1px solid #F1F5F9', verticalAlign: 'top' }}>
                            <td style={{ padding: '3px 4px' }}><strong>{r.name || r.id}</strong>{r.company ? <span style={{ color: '#94A3B8' }}> · {r.company}</span> : null}</td>
                            <td style={{ padding: '3px 4px', color: '#047857' }}>{r.addTags.join(', ') || '-'}</td>
                            <td style={{ padding: '3px 4px' }}>
                              {Object.entries(r.answers).map(([t, a]) => `${t}: ${[LABEL[a.answer], LABEL[a.status]].filter(Boolean).join(' + ')}`).join(', ') || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {plan.rows.length > SHOWN && <div style={{ color: '#94A3B8', marginTop: 4 }}>and {plan.rows.length - SHOWN} more</div>}
                </>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0.55rem 0.9rem', borderTop: '1px solid #E2E8F0' }}>
              <button type="button" disabled={busy} onClick={() => setOpen(false)}
                style={{ padding: '0.25rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
              >Close</button>
              {plan && plan.rows.length > 0 && (
                <button type="button" data-tag-recover-apply disabled={busy} onClick={apply}
                  style={{ padding: '0.25rem 0.8rem', border: '1px solid #047857', borderRadius: 4, background: '#047857', color: '#fff', fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                >Put them back</button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
