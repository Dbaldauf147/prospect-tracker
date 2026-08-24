import { useEffect, useMemo, useState } from 'react';
import {
  listSchedules, createSchedule, updateSchedule, removeSchedule, setEnabled,
  sendNow, describeSchedule, normalizeRecipients, isValidEmail, FREQUENCIES, WEEKDAYS,
} from '../../utils/companyNewsSchedulesStore';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DOM = Array.from({ length: 28 }, (_, i) => i + 1);
const LOOKBACKS = [7, 14, 30, 60];

function emptyForm() {
  return {
    id: null,
    name: '',
    recipients: '',
    // Blank means "let the send derive it" — the generated subject carries
    // the deal count and window, which beats a fixed string.
    subject: '',
    message: '',
    frequency: 'weekly',
    hourLocal: 8,
    dayOfWeekLocal: 1,
    dayOfMonthLocal: 1,
    skipWhenEmpty: false,
    enabled: true,
  };
}

const tzLabel = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'; }
  catch { return 'local time'; }
})();

// Modal that manages the recurring "Company Acquisition News" email: for
// every company ticked as "Track acquisition news" on its company popup,
// the server runs a web-search pass for acquisitions that company made in
// the window since the last send, and emails the results as an HTML digest.
//
// `prospects` is only used to preview which companies are in scope — the
// server re-derives the list from Firestore at send time, so the email is
// never limited to whatever this browser happens to have loaded.
export function CompanyNewsScheduleModal({ open, onClose, uid, prospects = [] }) {
  const [schedules, setSchedules] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Kept apart from `error` (save / send failures) so the list can say it
  // failed to load rather than showing the empty state: "No news
  // schedules yet" over a failed request reads as "you have none", which
  // is how a broken load gets mistaken for an empty one.
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const [testLookback, setTestLookback] = useState(7);

  // Mirrors the server's loadTrackedCompanies: flagged prospects, PE firms
  // first. Purely informational here.
  const tracked = useMemo(() => (prospects || [])
    .filter((p) => p?.trackAcquisitionNews === true && String(p.company || '').trim())
    .map((p) => ({ company: String(p.company).trim(), isPe: p.type === 'Private Equity' }))
    .sort((a, b) => (Number(b.isPe) - Number(a.isPe)) || a.company.localeCompare(b.company)),
  [prospects]);

  const reload = async () => {
    if (!uid) { setSchedules([]); return; }
    setLoading(true);
    setLoadError('');
    try { setSchedules(await listSchedules()); }
    catch (err) { setLoadError(String(err.message || err)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!open) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, uid]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 5000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [toast]);

  if (!open) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const startNew = () => { setForm(emptyForm()); setEditing(true); setError(''); };

  const startEdit = (s) => {
    setForm({
      id: s.id,
      name: s.name || '',
      recipients: (s.recipients || []).join('\n'),
      subject: s.subject || '',
      message: s.message || '',
      frequency: s.frequency || 'weekly',
      hourLocal: s.hourLocal ?? 8,
      dayOfWeekLocal: s.dayOfWeekLocal ?? 1,
      dayOfMonthLocal: s.dayOfMonthLocal ?? 1,
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
      else await createSchedule(form);
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
  // A test send never advances the schedule's lastSentAt, so the next real
  // digest still covers the window this preview just showed.
  const handleSendNow = async (s) => {
    if (!s) {
      const v = validate();
      if (v) { setError(v); return; }
    }
    setBusyId(s ? s.id : 'form');
    setError('');
    try {
      const data = s
        ? await sendNow({ scheduleId: s.id, lookbackDays: testLookback })
        : await sendNow({
            recipients: normalizeRecipients(form.recipients),
            subject: form.subject,
            message: form.message,
            lookbackDays: testLookback,
          });
      setToast(`Sent ${data.deals ?? 0} deal(s) across ${data.companies ?? 0} tracked companies to ${data.recipients ?? 0} recipient(s).`);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '3vh 1rem', overflowY: 'auto' }}
    >
      <div style={{ background: '#fff', borderRadius: 10, width: 'min(680px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ padding: '0.9rem 1.25rem', background: '#7C3AED', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700 }}>Acquisition news email</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '1rem 1.25rem' }}>
          {toast && (
            <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6, fontSize: '0.78rem', color: '#065F46' }}>{toast}</div>
          )}

          <TrackedSummary tracked={tracked} />

          {!editing && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <div style={{ fontSize: '0.78rem', color: loadError ? '#B91C1C' : '#64748B' }}>
                  {loading ? 'Loading…'
                    : loadError ? 'Couldn’t load your schedules.'
                      : schedules.length === 0 ? 'No news schedules yet.'
                        : `${schedules.length} schedule${schedules.length === 1 ? '' : 's'}`}
                </div>
                <button type="button" onClick={startNew} style={btnPrimary}>+ New schedule</button>
              </div>

              {schedules.map((s) => (
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
                          Last: {s.lastStatus}
                          {s.lastSentAt ? ` · ${new Date(s.lastSentAt).toLocaleString()}` : ''}
                          {s.lastStatus === 'sent' && s.lastDealCount != null ? ` · ${s.lastDealCount} deal(s)` : ''}
                          {s.lastStatus === 'error' && s.lastError ? `: ${s.lastError}` : ''}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                      <button type="button" onClick={() => handleSendNow(s)} disabled={busyId === s.id} style={btnGhost}>{busyId === s.id ? 'Researching…' : 'Send now'}</button>
                      <button type="button" onClick={() => startEdit(s)} style={btnGhost}>Edit</button>
                      <button type="button" onClick={() => handleToggle(s)} style={btnGhost}>{s.enabled === false ? 'Resume' : 'Pause'}</button>
                      <button type="button" onClick={() => handleDelete(s)} style={{ ...btnGhost, color: '#B91C1C', borderColor: '#FCA5A5' }}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}

              {loadError && (
                <div style={errBox}>
                  <div>{loadError}</div>
                  <button type="button" onClick={reload} disabled={loading} style={{ ...btnGhost, marginTop: '0.45rem' }}>
                    {loading ? 'Retrying…' : 'Try again'}
                  </button>
                </div>
              )}

              {error && <div style={errBox}>{error}</div>}
            </>
          )}

          {editing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <Field label="Name (optional)">
                <input style={inp} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Monday acquisition digest" />
              </Field>

              <Field label="Recipients (one per line or comma-separated)">
                <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' }} value={form.recipients} onChange={(e) => set('recipients', e.target.value)} placeholder="alice@example.com, bob@example.com" />
              </Field>
              <div style={{ fontSize: '0.68rem', color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, padding: '0.45rem 0.6rem', marginTop: '-0.3rem' }}>
                Emails are sent from the connected Gmail account and can go to anyone. Use <strong>Send test now</strong> to confirm a recipient receives it.
              </div>

              <Field label="Subject (optional)">
                <input style={inp} value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder="Leave blank to auto-generate with the deal count and date range" />
              </Field>

              <Field label="Message (optional intro)">
                <textarea style={{ ...inp, minHeight: 48, resize: 'vertical' }} value={form.message} onChange={(e) => set('message', e.target.value)} placeholder="Optional note shown above the deals." />
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

              <div style={{ fontSize: '0.68rem', color: '#475569', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.45rem 0.6rem' }}>
                Each digest covers everything announced since the last successful send (7 days on the
                first run), so a skipped week is picked up by the next one instead of being lost.
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: '#334155' }}>
                <input type="checkbox" checked={form.skipWhenEmpty} onChange={(e) => set('skipWhenEmpty', e.target.checked)} />
                Don&apos;t send if no acquisitions were found
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: '#334155' }}>
                <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
                Enabled
              </label>

              {error && <div style={errBox}>{error}</div>}

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', marginTop: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <button type="button" onClick={() => handleSendNow(null)} disabled={busyId === 'form'} style={btnGhost}>{busyId === 'form' ? 'Researching…' : 'Send test now'}</button>
                  <select
                    style={{ ...inp, width: 'auto', padding: '0.28rem 0.4rem', fontSize: '0.72rem' }}
                    value={testLookback}
                    onChange={(e) => setTestLookback(Number(e.target.value))}
                    title="How far back the test send should look"
                  >
                    {LOOKBACKS.map((d) => <option key={d} value={d}>last {d} days</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={() => { setEditing(false); setError(''); }} style={btnGhost}>Cancel</button>
                  <button type="button" onClick={handleSave} disabled={saving} style={btnPrimary}>{saving ? 'Saving…' : 'Save schedule'}</button>
                </div>
              </div>
              <div style={{ fontSize: '0.66rem', color: '#94A3B8' }}>
                A test send researches every tracked company live, so it can take a minute — and it
                doesn&apos;t move the schedule&apos;s window, so the next real digest still covers these dates.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Which companies the digest will cover, so the user isn't guessing what a
// send will contain. An empty list is the one thing that makes the whole
// feature a no-op, so it's called out rather than shown as "0".
function TrackedSummary({ tracked }) {
  const [expanded, setExpanded] = useState(false);
  const peCount = tracked.filter((t) => t.isPe).length;

  if (tracked.length === 0) {
    return (
      <div style={{ marginBottom: '0.85rem', padding: '0.55rem 0.7rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, fontSize: '0.74rem', color: '#B91C1C', lineHeight: 1.45 }}>
        <strong>No companies are tracked yet.</strong> Open a company popup and tick{' '}
        <strong>Track acquisition news</strong> to include it. Until then this email has nothing to report.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '0.85rem', padding: '0.55rem 0.7rem', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 6, fontSize: '0.74rem', color: '#5B21B6' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span>
          Tracking <strong>{tracked.length}</strong> {tracked.length === 1 ? 'company' : 'companies'}
          {peCount > 0 && <> · <strong>{peCount}</strong> PE {peCount === 1 ? 'firm' : 'firms'}</>}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ background: 'none', border: 'none', color: '#7C3AED', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
        >{expanded ? 'Hide' : 'Show'}</button>
      </div>
      {expanded && (
        <div style={{ marginTop: 6, lineHeight: 1.6, color: '#6D28D9' }}>
          {tracked.map((t) => (
            <span key={t.company} style={{ marginRight: 8, whiteSpace: 'nowrap' }}>
              {t.company}{t.isPe && <span style={{ fontSize: '0.6rem', fontWeight: 700, marginLeft: 3 }}>PE</span>}
            </span>
          ))}
        </div>
      )}
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
const btnPrimary = { padding: '0.45rem 0.9rem', border: '1px solid #7C3AED', borderRadius: 6, background: '#7C3AED', color: '#fff', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const btnGhost = { padding: '0.3rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', color: '#334155', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const errBox = { marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, fontSize: '0.76rem', color: '#B91C1C' };
