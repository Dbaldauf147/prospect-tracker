import { useEffect, useState } from 'react';
import {
  listSchedules, createSchedule, updateSchedule, removeSchedule, setEnabled,
  describeSchedule, normalizeRecipients, isValidEmail, FREQUENCIES, WEEKDAYS,
} from '../../utils/peOppsSchedulesStore';
import { apiFetch } from '../../utils/apiFetch';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DOM = Array.from({ length: 28 }, (_, i) => i + 1);

function emptyForm(defaultColumns, firm = '') {
  return {
    id: null,
    name: '',
    recipients: '',
    subject: firm ? `${firm}: PE Opportunities` : 'PE Opportunities',
    message: '',
    frequency: 'weekly',
    hourLocal: 9,
    dayOfWeekLocal: 1,
    dayOfMonthLocal: 1,
    columns: Array.isArray(defaultColumns) ? [...defaultColumns] : [],
    // Firm scope for this schedule — '' = full PE Opps list, a firm name =
    // every opp on that firm or its portfolio companies. Set from the PE
    // Opps tab's firm picker; the server re-derives the rows from it.
    firm: firm || '',
    skipWhenEmpty: false,
    enabled: true,
  };
}

const tzLabel = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'; }
  catch { return 'local time'; }
})();

// Modal that lets the user create / edit / delete recurring emails which
// send the PE Opps Excel file to a list of recipients. `allColumns` is the
// PE Opps column set ([{key,label}]); `defaultColumns` seeds new schedules
// with the columns currently shown in the tab.
export function PEOppsScheduleModal({ open, onClose, uid, email, firm = '', oppsRows, allColumns, defaultColumns }) {
  const [schedules, setSchedules] = useState([]);
  const [form, setForm] = useState(() => emptyForm(defaultColumns, firm));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    if (!uid) { setSchedules([]); return; }
    setLoading(true);
    try { setSchedules(await listSchedules()); }
    catch (err) { setError(String(err.message || err)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!open) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, uid]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [toast]);

  if (!open) return null;

  // Each firm scope manages its own schedules: when the tab is scoped to a
  // firm, only that firm's schedules show here; the unscoped (All PE Opps)
  // view shows the firm-less ones.
  const visibleSchedules = schedules.filter((s) => (s.firm || '') === (firm || ''));
  const scopeLabel = firm ? `${firm} PE Opps` : 'PE Opps';

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const startNew = () => { setForm(emptyForm(defaultColumns, firm)); setEditing(true); setError(''); };
  const startEdit = (s) => {
    setForm({
      id: s.id,
      name: s.name || '',
      recipients: (s.recipients || []).join('\n'),
      subject: s.subject || 'PE Opportunities',
      message: s.message || '',
      frequency: s.frequency || 'weekly',
      hourLocal: s.hourLocal ?? 9,
      dayOfWeekLocal: s.dayOfWeekLocal ?? 1,
      dayOfMonthLocal: s.dayOfMonthLocal ?? 1,
      columns: Array.isArray(s.columns) && s.columns.length ? [...s.columns] : (defaultColumns || []),
      firm: s.firm || '',
      skipWhenEmpty: !!s.skipWhenEmpty,
      enabled: s.enabled !== false,
    });
    setEditing(true);
    setError('');
  };

  const validate = () => {
    const list = normalizeRecipients(form.recipients);
    if (list.length === 0) return 'Add at least one recipient email.';
    const bad = list.find((e) => !isValidEmail(e));
    if (bad) return `"${bad}" is not a valid email address.`;
    return '';
  };

  const handleSave = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true);
    setError('');
    try {
      if (form.id) await updateSchedule(form.id, form);
      else await createSchedule(uid, email, form);
      setEditing(false);
      setToast('Schedule saved.');
      await reload();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s) => {
    if (!window.confirm(`Delete this schedule? "${describeSchedule(s)}" to ${(s.recipients || []).length} recipient(s).`)) return;
    try { await removeSchedule(s.id); setToast('Schedule deleted.'); await reload(); }
    catch (err) { setToast(`Delete failed: ${err.message || err}`); }
  };

  const handleToggle = async (s) => {
    try { await setEnabled(s.id, !(s.enabled !== false)); await reload(); }
    catch (err) { setToast(`Update failed: ${err.message || err}`); }
  };

  // Send immediately (a saved schedule by id, or the in-progress form).
  const handleSendNow = async (s) => {
    setBusyId(s ? s.id : 'form');
    setError('');
    try {
      // Send exactly the PE opps shown on the page (the page reads the
      // newest local/cloud data, which can be ahead of the cloud copy the
      // server would otherwise re-read) so the email matches the table.
      const records = Array.isArray(oppsRows) ? oppsRows : undefined;
      const body = s
        ? { scheduleId: s.id, records }
        : {
            recipients: normalizeRecipients(form.recipients),
            subject: form.subject,
            message: form.message,
            columns: form.columns,
            firm: form.firm || '',
            records,
          };
      if (!s) {
        const v = validate();
        if (v) { setError(v); setBusyId(null); return; }
      }
      const res = await apiFetch('/api/pe-opps-send-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.code ? ` [${data.code}]` : '';
        throw new Error(`${data.error || `Send failed (${res.status})`}${detail}`);
      }
      setToast(`Sent ${data.opps ?? ''} opps to ${data.recipients ?? ''} recipient(s).`);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusyId(null);
    }
  };

  const toggleColumn = (key) => {
    if (key === 'Account') return; // anchor column always included
    set('columns', form.columns.includes(key) ? form.columns.filter((k) => k !== key) : [...form.columns, key]);
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '3vh 1rem', overflowY: 'auto' }}
    >
      <div style={{ background: '#fff', borderRadius: 10, width: 'min(680px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ padding: '0.9rem 1.25rem', background: '#009530', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700 }}>Schedule {scopeLabel} email</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '1rem 1.25rem' }}>
          {toast && (
            <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6, fontSize: '0.78rem', color: '#065F46' }}>{toast}</div>
          )}

          {!editing && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <div style={{ fontSize: '0.78rem', color: '#64748B' }}>
                  {loading ? 'Loading…' : visibleSchedules.length === 0 ? `No ${scopeLabel} schedules yet.` : `${visibleSchedules.length} ${scopeLabel} schedule${visibleSchedules.length === 1 ? '' : 's'}`}
                </div>
                <button type="button" onClick={startNew} style={btnPrimary}>+ New schedule</button>
              </div>

              {visibleSchedules.map((s) => (
                <div key={s.id} style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.7rem 0.85rem', marginBottom: '0.6rem', background: s.enabled === false ? '#F8FAFC' : '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1E293B' }}>
                        {s.name || describeSchedule(s)}
                        {s.enabled === false && <span style={{ marginLeft: 8, fontSize: '0.65rem', fontWeight: 700, color: '#94A3B8' }}>PAUSED</span>}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>{describeSchedule(s)} · {tzLabel}</div>
                      <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        To: {(s.recipients || []).join(', ') || '-'}
                      </div>
                      {s.lastStatus && (
                        <div style={{ fontSize: '0.68rem', marginTop: 3, color: s.lastStatus === 'error' ? '#B91C1C' : '#64748B' }}>
                          Last: {s.lastStatus}{s.lastSentAt ? ` · ${new Date(s.lastSentAt).toLocaleString()}` : ''}{s.lastStatus === 'error' && s.lastError ? `: ${s.lastError}` : ''}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                      <button type="button" onClick={() => handleSendNow(s)} disabled={busyId === s.id} style={btnGhost}>{busyId === s.id ? 'Sending…' : 'Send now'}</button>
                      <button type="button" onClick={() => startEdit(s)} style={btnGhost}>Edit</button>
                      <button type="button" onClick={() => handleToggle(s)} style={btnGhost}>{s.enabled === false ? 'Resume' : 'Pause'}</button>
                      <button type="button" onClick={() => handleDelete(s)} style={{ ...btnGhost, color: '#B91C1C', borderColor: '#FCA5A5' }}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}

              {error && <div style={errBox}>{error}</div>}
            </>
          )}

          {editing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <div style={{ fontSize: '0.72rem', color: '#475569', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.45rem 0.6rem' }}>
                Scope: <strong>{(form.firm || '').trim() || 'All PE Opps'}</strong>
                {(form.firm || '').trim()
                  ? ': every opp on this firm or its portfolio companies.'
                  : ': the full PE Opps list (Type = Private Equity or Source = PE partner).'}
              </div>
              <Field label="Name (optional)">
                <input style={inp} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Weekly PE digest" />
              </Field>

              <Field label="Recipients (one per line or comma-separated)">
                <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' }} value={form.recipients} onChange={(e) => set('recipients', e.target.value)} placeholder="alice@example.com, bob@example.com" />
              </Field>
              <div style={{ fontSize: '0.68rem', color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, padding: '0.45rem 0.6rem', marginTop: '-0.3rem' }}>
                Emails are sent from the connected Gmail account and can go to anyone. Use <strong>Send test now</strong> to confirm a recipient receives it.
              </div>

              <Field label="Subject">
                <input style={inp} value={form.subject} onChange={(e) => set('subject', e.target.value)} />
              </Field>

              <Field label="Message (optional intro)">
                <textarea style={{ ...inp, minHeight: 48, resize: 'vertical' }} value={form.message} onChange={(e) => set('message', e.target.value)} placeholder="Optional note shown above the attachment." />
              </Field>

              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Field label="Frequency">
                  <select style={inp} value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>
                    {FREQUENCIES.map((f) => <option key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</option>)}
                  </select>
                </Field>
                {form.frequency === 'weekly' && (
                  <Field label="Day of week">
                    <select style={inp} value={form.dayOfWeekLocal} onChange={(e) => set('dayOfWeekLocal', Number(e.target.value))}>
                      {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </Field>
                )}
                {form.frequency === 'monthly' && (
                  <Field label="Day of month">
                    <select style={inp} value={form.dayOfMonthLocal} onChange={(e) => set('dayOfMonthLocal', Number(e.target.value))}>
                      {DOM.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </Field>
                )}
                <Field label={`Time (${tzLabel})`}>
                  <select style={inp} value={form.hourLocal} onChange={(e) => set('hourLocal', Number(e.target.value))}>
                    {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Columns in the Excel file">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem 0.8rem', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.5rem 0.6rem', maxHeight: 140, overflowY: 'auto' }}>
                  {(allColumns || []).map((c) => (
                    <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.74rem', color: c.key === 'Account' ? '#94A3B8' : '#334155', cursor: c.key === 'Account' ? 'not-allowed' : 'pointer' }}>
                      <input type="checkbox" disabled={c.key === 'Account'} checked={c.key === 'Account' || form.columns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </Field>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: '#334155' }}>
                <input type="checkbox" checked={form.skipWhenEmpty} onChange={(e) => set('skipWhenEmpty', e.target.checked)} />
                Don&apos;t send if there are no PE opps
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: '#334155' }}>
                <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
                Enabled
              </label>

              {error && <div style={errBox}>{error}</div>}

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', marginTop: '0.3rem' }}>
                <button type="button" onClick={() => handleSendNow(null)} disabled={busyId === 'form'} style={btnGhost}>{busyId === 'form' ? 'Sending…' : 'Send test now'}</button>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={() => { setEditing(false); setError(''); }} style={btnGhost}>Cancel</button>
                  <button type="button" onClick={handleSave} disabled={saving} style={btnPrimary}>{saving ? 'Saving…' : 'Save schedule'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.72rem', fontWeight: 600, color: '#475569' }}>
      {label}
      {children}
    </label>
  );
}

const inp = { padding: '0.4rem 0.55rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit', fontWeight: 400, color: '#1E293B', width: '100%', boxSizing: 'border-box' };
const btnPrimary = { padding: '0.45rem 0.9rem', border: '1px solid #009530', borderRadius: 6, background: '#009530', color: '#fff', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const btnGhost = { padding: '0.3rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', color: '#334155', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const errBox = { marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, fontSize: '0.76rem', color: '#B91C1C' };
