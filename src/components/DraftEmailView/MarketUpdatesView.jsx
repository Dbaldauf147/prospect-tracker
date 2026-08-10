// Market Updates — drop an email onto the page, keep its attachments, and
// work the message up into a draft you can download and send on.
//
// The flow the tab is built around: a market update lands in Outlook, you
// drag it here, and what you want out of it is (a) the attachment kept
// somewhere you can find it and (b) a version of the message you can edit
// into your own words before it goes back out. So a drop parses into an
// editable subject + body sitting next to the attachment list, Claude
// critiques the draft the same way it does on the Drafts tab, and Download
// emits an Outlook-openable .eml carrying the attachments through.
//
// Entries persist in IndexedDB (see marketUpdatesStore.js) so the tab still
// has them after a reload.

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { apiFetch } from '../../utils/apiFetch';
import { parseEmailFile } from '../../utils/emailDrop';
import { buildEmlDraft, draftFileName } from '../../utils/buildEmlDraft';
import {
  loadMarketUpdates, saveMarketUpdate, deleteMarketUpdate, newMarketUpdateId,
  MARKET_UPDATES_EVENT,
} from '../../utils/marketUpdatesStore';
import { CritiquePanel } from './DraftEmailView';

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link', 'clean'],
  ],
};

const fmtBytes = (n) => {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtWhen = (ts) => {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString(); } catch { return ''; }
};

function downloadBlob(content, fileName, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// An attachment is stored as a data URL, which is what the .eml builder
// wants — but a direct download needs the bytes back.
function downloadAttachment(att) {
  const base64 = String(att?.dataUrl || '').split(',')[1] || '';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  downloadBlob(bytes, att.name || 'attachment', att.type || 'application/octet-stream');
}

export function MarketUpdatesView() {
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [critique, setCritique] = useState(null);
  const [critiqueBusy, setCritiqueBusy] = useState(false);
  const fileInputRef = useRef(null);
  // Depth counter, because dragenter/dragleave fire for every child element
  // the pointer crosses — a plain boolean flickers the whole time you move
  // across the drop zone's contents.
  const dragDepth = useRef(0);

  const refresh = useCallback(async () => {
    const list = await loadMarketUpdates();
    setEntries(list);
    setSelectedId(prev => (prev && list.some(e => e.id === prev) ? prev : (list[0]?.id ?? null)));
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(MARKET_UPDATES_EVENT, onChange);
    return () => window.removeEventListener(MARKET_UPDATES_EVENT, onChange);
  }, [refresh]);

  const selected = entries.find(e => e.id === selectedId) || null;

  // Edits are written straight through to the store: this tab has no Save
  // button, and a draft you spent ten minutes on shouldn't depend on
  // remembering to press one.
  const patchSelected = useCallback(async (patch) => {
    if (!selected) return;
    const next = { ...selected, ...patch };
    setEntries(prev => prev.map(e => (e.id === next.id ? next : e)));
    await saveMarketUpdate(next);
  }, [selected]);

  async function ingestFiles(fileList) {
    const files = [...(fileList || [])];
    if (files.length === 0) return;
    setBusy(true);
    setStatus({ type: '', message: '' });
    const added = [];
    const failed = [];
    for (const file of files) {
      try {
        const parsed = await parseEmailFile(file);
        const entry = {
          id: newMarketUpdateId(),
          savedAt: Date.now(),
          sourceFileName: file.name || '',
          subject: parsed.subject || (file.name || '').replace(/\.(msg|eml)$/i, ''),
          bodyHtml: parsed.bodyHtml || '',
          from: parsed.from || '',
          sentAt: parsed.sentAt || '',
          attachments: parsed.attachments || [],
        };
        await saveMarketUpdate(entry);
        added.push(entry);
      } catch (err) {
        failed.push(err?.message || String(err));
      }
    }
    await refresh();
    if (added.length) setSelectedId(added[0].id);
    setBusy(false);
    const attachTotal = added.reduce((n, e) => n + e.attachments.length, 0);
    if (added.length && !failed.length) {
      setStatus({
        type: 'success',
        message: `Saved ${added.length} email${added.length === 1 ? '' : 's'}`
          + (attachTotal ? ` with ${attachTotal} attachment${attachTotal === 1 ? '' : 's'}.` : ' (no attachments found).'),
      });
    } else if (added.length && failed.length) {
      setStatus({ type: 'error', message: `Saved ${added.length}, but ${failed.length} failed: ${failed[0]}` });
    } else {
      setStatus({ type: 'error', message: failed[0] || 'Nothing could be read from those files.' });
    }
  }

  async function runCritique() {
    if (critiqueBusy || !selected) return;
    setCritique(null);
    setCritiqueBusy(true);
    try {
      const res = await apiFetch('/api/critique-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: selected.subject || '', body: selected.bodyHtml || '' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: 'error', message: `Claude couldn't review the draft: ${data?.error || res.statusText}` });
        return;
      }
      setCritique(data);
    } catch (err) {
      setStatus({ type: 'error', message: `Network error talking to Claude: ${err?.message || 'unknown'}` });
    } finally {
      setCritiqueBusy(false);
    }
  }

  function useRewrite() {
    if (!critique || !selected) return;
    const patch = {};
    if (critique.rewriteSubject) patch.subject = critique.rewriteSubject;
    if (critique.rewriteBody) {
      patch.bodyHtml = String(critique.rewriteBody)
        .split(/\n{2,}/)
        .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('');
    }
    if (Object.keys(patch).length) patchSelected(patch);
    setCritique(null);
  }

  function downloadDraft() {
    if (!selected) return;
    const eml = buildEmlDraft({
      subject: selected.subject,
      bodyHtml: selected.bodyHtml,
      attachments: selected.attachments,
    });
    downloadBlob(eml, draftFileName(selected.subject), 'message/rfc822');
    const n = (selected.attachments || []).length;
    setStatus({
      type: 'success',
      message: `Draft downloading${n ? ` with ${n} attachment${n === 1 ? '' : 's'}` : ''}: double-click it to open in Outlook.`,
    });
  }

  async function removeEntry(id) {
    const entry = entries.find(e => e.id === id);
    if (entry && !window.confirm(`Delete "${entry.subject || 'this update'}" and its attachments?`)) return;
    await deleteMarketUpdate(id);
    await refresh();
    setStatus({ type: '', message: '' });
  }

  const onDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    ingestFiles(e.dataTransfer?.files);
  };

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; setDragOver(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => { e.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) setDragOver(false); }}
      onDrop={onDrop}
      style={{ minHeight: 400 }}
    >
      <div style={{
        border: `2px dashed ${dragOver ? '#1D4ED8' : '#CBD5E1'}`,
        background: dragOver ? '#EFF6FF' : '#F8FAFC',
        borderRadius: 8, padding: '1rem', textAlign: 'center', marginBottom: '0.9rem',
      }}>
        <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#1E293B' }}>
          {busy ? 'Reading…' : 'Drop a market update email here'}
        </div>
        <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: 3 }}>
          Drag a message straight out of Outlook (.msg), or drop an exported .eml.
          Its attachments are saved and carried onto the draft you build from it.
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            marginTop: 8, padding: '0.3rem 0.75rem', border: '1px solid #CBD5E1',
            background: '#fff', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600,
            fontFamily: 'inherit', cursor: 'pointer', color: '#334155',
          }}
        >Choose file…</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".msg,.eml,.mht,.mhtml"
          multiple
          onChange={(e) => { ingestFiles(e.target.files); e.target.value = ''; }}
          style={{ display: 'none' }}
        />
      </div>

      {status.message && (
        <div style={{
          marginBottom: '0.7rem', padding: '0.4rem 0.6rem', borderRadius: 6, fontSize: '0.76rem',
          background: status.type === 'error' ? '#FEE2E2' : '#DCFCE7',
          color: status.type === 'error' ? '#991B1B' : '#166534',
        }}>{status.message}</div>
      )}

      {entries.length === 0 ? (
        <div style={{ color: '#94A3B8', fontSize: '0.8rem', padding: '1.5rem', textAlign: 'center' }}>
          Nothing saved yet. Drop an email above to start.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
          {/* Saved updates */}
          <div style={{ flex: '0 0 240px', maxHeight: 560, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
            {entries.map(e => {
              const active = e.id === selectedId;
              return (
                <div
                  key={e.id}
                  onClick={() => { setSelectedId(e.id); setCritique(null); }}
                  style={{
                    padding: '0.5rem 0.6rem', cursor: 'pointer',
                    borderBottom: '1px solid #F1F5F9',
                    background: active ? '#EFF6FF' : '#fff',
                    borderLeft: `3px solid ${active ? '#1D4ED8' : 'transparent'}`,
                  }}
                >
                  <div style={{ fontSize: '0.76rem', fontWeight: active ? 700 : 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.subject || '(no subject)'}
                  </div>
                  <div style={{ fontSize: '0.66rem', color: '#64748B', marginTop: 2 }}>
                    {fmtWhen(e.savedAt)}
                    {e.attachments?.length ? ` · ${e.attachments.length} attachment${e.attachments.length === 1 ? '' : 's'}` : ''}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Editor */}
          {selected && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={downloadDraft}
                  style={{
                    padding: '0.35rem 0.8rem', border: 'none', background: '#1D4ED8', color: '#fff',
                    borderRadius: 6, fontSize: '0.76rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                  }}
                  title="Download this as an Outlook-openable .eml draft, with the saved attachments included."
                >⬇ Download draft</button>
                <button
                  type="button"
                  onClick={runCritique}
                  disabled={critiqueBusy}
                  title="Send this subject + body to Claude for a sales-coach critique."
                  style={{
                    padding: '0.35rem 0.8rem', border: 'none', borderRadius: 6,
                    background: critiqueBusy ? '#EDE9FE' : '#7C3AED',
                    color: critiqueBusy ? '#5B21B6' : '#fff',
                    fontSize: '0.76rem', fontWeight: 700, fontFamily: 'inherit',
                    cursor: critiqueBusy ? 'wait' : 'pointer',
                  }}
                >{critiqueBusy ? 'Reviewing…' : '✨ Critique with Claude'}</button>
                <button
                  type="button"
                  onClick={() => removeEntry(selected.id)}
                  style={{
                    padding: '0.35rem 0.7rem', border: '1px solid #FCA5A5', background: '#fff',
                    color: '#991B1B', borderRadius: 6, fontSize: '0.74rem', fontWeight: 600,
                    fontFamily: 'inherit', cursor: 'pointer', marginLeft: 'auto',
                  }}
                >Delete</button>
              </div>

              {critique && (
                <CritiquePanel critique={critique} onClose={() => setCritique(null)} onUseRewrite={useRewrite} />
              )}

              {(selected.from || selected.sentAt || selected.sourceFileName) && (
                <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginBottom: '0.4rem' }}>
                  {[selected.from && `From ${selected.from}`, selected.sentAt, selected.sourceFileName]
                    .filter(Boolean).join(' · ')}
                </div>
              )}

              <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#64748B', marginBottom: 3 }}>
                Subject
              </label>
              <input
                type="text"
                value={selected.subject || ''}
                onChange={(e) => patchSelected({ subject: e.target.value })}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '0.4rem 0.55rem',
                  border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.85rem',
                  fontFamily: 'inherit', marginBottom: '0.6rem',
                }}
              />

              <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#64748B', marginBottom: 3 }}>
                Body
              </label>
              <ReactQuill
                theme="snow"
                value={selected.bodyHtml || ''}
                onChange={(html) => patchSelected({ bodyHtml: html })}
                modules={QUILL_MODULES}
              />

              <div style={{ marginTop: '0.8rem' }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#64748B', marginBottom: 4 }}>
                  Attachments ({selected.attachments?.length || 0})
                </div>
                {(selected.attachments || []).length === 0 ? (
                  <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
                    That email had no attachments. The draft still downloads, just without one.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {selected.attachments.map((att, i) => (
                      <button
                        key={`${att.name}-${i}`}
                        type="button"
                        onClick={() => downloadAttachment(att)}
                        title={`Download ${att.name}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '0.25rem 0.6rem', border: '1px solid #BFDBFE', background: '#EFF6FF',
                          color: '#1E40AF', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600,
                          fontFamily: 'inherit', cursor: 'pointer',
                        }}
                      >
                        <span>📎 {att.name}</span>
                        <span style={{ color: '#60A5FA', fontWeight: 400 }}>{fmtBytes(att.size)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
