// "Dan's Drafts" tab on the Draft Emails page.
//
// Renders Dan's standing Outlook templates (transcribed from his .oft files in
// src/data/dansDrafts.js). Each one gets a Download button — .eml for the
// mails, .ics for the meeting, both of which Outlook opens as an editable
// draft — and an Edit button. Edits are saved per user in Firestore settings
// under `dansDrafts`, so they survive a reload and can be reset back to the
// shipped template at any time.

import { useMemo, useRef, useState } from 'react';
import { DANS_DRAFTS, formatRecipient, parseRecipients } from '../../data/dansDrafts';
import { buildStyledBodyHtml, resolveSignature, safeFileName } from '../../utils/draftEmail';
import { buildAllDayMeetingIcs, downloadFile } from '../../utils/icsDraft';
import { useAuth } from '../../contexts/AuthContext';
import styles from './DansDraftsView.module.css';

// Today as 'YYYY-MM-DD' in the browser's own timezone — toISOString() would
// roll the date backwards for anyone west of UTC.
function todayLocal() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Build the .eml Outlook opens as an unsent draft. Same X-Unsent format the
// rest of the page uses, extended with Cc/Bcc lines and multiple To
// recipients, which these templates need.
function buildEml({ subject, to, cc, bcc, bodyHtml, signature }) {
  const htmlContent = buildStyledBodyHtml(bodyHtml, { signature });
  const header = (name, list) => (list.length ? `${name}: ${list.map(formatRecipient).join(', ')}` : null);
  return [
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    header('To', to),
    header('Cc', cc),
    header('Bcc', bcc),
    'X-Unsent: 1',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlContent,
  ].filter(line => line !== null).join('\r\n');
}

function Badge({ kind, children }) {
  return <span className={`${styles.badge} ${styles[kind]}`}>{children}</span>;
}

function DraftCard({ draft, isEdited, onSave, onReset, signature, organizer, onResult }) {
  const isMeeting = draft.type === 'meeting';
  const [editing, setEditing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [rawHtml, setRawHtml] = useState(false);

  // Meeting dates aren't part of the saved template — they're picked fresh
  // each time the draft is downloaded.
  const [startDate, setStartDate] = useState(todayLocal);
  const [endDate, setEndDate] = useState(todayLocal);
  const [showAs, setShowAs] = useState(draft.meeting?.showAs || 'FREE');

  // Edit-form state. Recipients are edited as plain "Name <addr>" lines.
  const [form, setForm] = useState(null);
  const bodyRef = useRef(null);      // contentEditable WYSIWYG body
  const htmlRef = useRef(null);      // raw-HTML textarea, when toggled on

  function startEditing() {
    setForm({
      subject: draft.subject,
      to: draft.to.map(formatRecipient).join('; '),
      cc: draft.cc.map(formatRecipient).join('; '),
      bcc: draft.bcc.map(formatRecipient).join('; '),
      bodyHtml: draft.bodyHtml,
    });
    setRawHtml(false);
    setEditing(true);
  }

  // Whichever editor is showing holds the current body; the other one is
  // stale, so read from the visible one.
  function currentBodyHtml() {
    if (rawHtml) return htmlRef.current ? htmlRef.current.value : form.bodyHtml;
    return bodyRef.current ? bodyRef.current.innerHTML : form.bodyHtml;
  }

  // Toggling between WYSIWYG and source carries the edits across.
  function toggleRawHtml() {
    const html = currentBodyHtml();
    setForm(f => ({ ...f, bodyHtml: html }));
    setRawHtml(v => !v);
  }

  function save() {
    onSave({
      subject: form.subject,
      to: parseRecipients(form.to),
      cc: parseRecipients(form.cc),
      bcc: parseRecipients(form.bcc),
      bodyHtml: currentBodyHtml(),
    });
    setEditing(false);
    onResult({ type: 'success', message: `Saved your changes to "${draft.name}".` });
  }

  function download() {
    try {
      if (isMeeting) {
        if (endDate < startDate) {
          onResult({ type: 'error', message: 'The end date is before the start date.' });
          return;
        }
        const ics = buildAllDayMeetingIcs({
          subject: draft.subject,
          descriptionHtml: draft.bodyHtml,
          // Organiser is whoever is signed in — Outlook needs it to open the
          // .ics as a meeting they can send rather than a read-only copy.
          organizer,
          attendees: draft.to,
          optionalAttendees: draft.cc,
          startDate,
          endDate,
          showAs,
          reminderMinutes: draft.meeting?.reminderMinutes || 0,
        });
        downloadFile(`${safeFileName(draft.subject)}.ics`, ics, 'text/calendar;charset=utf-8');
        onResult({ type: 'success', message: `${draft.name}.ics downloading — double-click it to open the meeting in Outlook, then Send.` });
      } else {
        const eml = buildEml({ ...draft, signature });
        downloadFile(`${safeFileName(draft.subject)}.eml`, eml, 'message/rfc822');
        onResult({ type: 'success', message: `${draft.name}.eml downloading — double-click it to open the draft in Outlook.` });
      }
    } catch (err) {
      onResult({ type: 'error', message: `Could not build that draft: ${err?.message || err}` });
    }
  }

  const metaRow = (label, value) => (
    value ? (
      <>
        <span className={styles.metaLabel}>{label}</span>
        <span className={styles.metaValue}>{value}</span>
      </>
    ) : null
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <div style={{ minWidth: 0 }}>
          <h3 className={styles.cardName}>
            {draft.name}
            <Badge kind={isMeeting ? 'badgeMeeting' : 'badgeEmail'}>{isMeeting ? 'Meeting' : 'Email'}</Badge>
            {isEdited && <Badge kind="badgeEdited">Edited</Badge>}
          </h3>
          <p className={styles.blurb}>{draft.blurb}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryBtn} onClick={download} disabled={editing}>
            {isMeeting ? 'Download .ics' : 'Download .eml'}
          </button>
          {!editing && (
            <button type="button" className={styles.secondaryBtn} onClick={startEditing}>Edit</button>
          )}
          {!editing && isEdited && (
            <button type="button" className={styles.secondaryBtn} onClick={onReset}>Reset</button>
          )}
        </div>
      </div>

      {!editing && (
        <>
          <div className={styles.meta}>
            {metaRow('Subject', draft.subject)}
            {metaRow('To', draft.to.map(formatRecipient).join('; '))}
            {metaRow('Cc', draft.cc.map(formatRecipient).join('; '))}
            {metaRow('Bcc', draft.bcc.map(formatRecipient).join('; '))}
          </div>

          {isMeeting && (
            <div className={`${styles.editRow} ${styles.inlineFields}`}>
              <div>
                <label className={styles.label} htmlFor={`${draft.id}-start`}>First day out</label>
                <input id={`${draft.id}-start`} type="date" className={styles.input}
                  value={startDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    setStartDate(v);
                    if (endDate < v) setEndDate(v);
                  }} />
              </div>
              <div>
                <label className={styles.label} htmlFor={`${draft.id}-end`}>Last day out</label>
                <input id={`${draft.id}-end`} type="date" className={styles.input}
                  value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} />
              </div>
              <div>
                <label className={styles.label} htmlFor={`${draft.id}-showas`}>Show as</label>
                <select id={`${draft.id}-showas`} className={styles.select} value={showAs} onChange={e => setShowAs(e.target.value)}>
                  <option value="FREE">Free</option>
                  <option value="BUSY">Busy</option>
                  <option value="OOF">Out of Office</option>
                  <option value="TENTATIVE">Tentative</option>
                </select>
              </div>
            </div>
          )}

          <p className={styles.hint}>
            <button type="button" className={styles.linkBtn} onClick={() => setShowPreview(v => !v)}>
              {showPreview ? 'Hide preview' : 'Show preview'}
            </button>
            {isMeeting
              ? ' · All-day hold. The .ics carries the attendees; open it in Outlook and hit Send.'
              : ' · Your saved signature is added when the draft is downloaded.'}
          </p>

          {showPreview && (
            draft.bodyHtml.trim()
              ? <div className={styles.preview} dangerouslySetInnerHTML={{ __html: draft.bodyHtml }} />
              : <div className={`${styles.preview} ${styles.emptyPreview}`}>This template has no body — the subject and attendees are the whole message.</div>
          )}
        </>
      )}

      {editing && form && (
        <div>
          <div className={styles.editRow}>
            <label className={styles.label} htmlFor={`${draft.id}-subject`}>Subject</label>
            <input id={`${draft.id}-subject`} className={styles.input} value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
          </div>
          <div className={`${styles.editRow} ${styles.inlineFields}`}>
            <div>
              <label className={styles.label} htmlFor={`${draft.id}-to`}>To</label>
              <input id={`${draft.id}-to`} className={styles.input} value={form.to}
                onChange={e => setForm(f => ({ ...f, to: e.target.value }))} />
            </div>
            <div>
              <label className={styles.label} htmlFor={`${draft.id}-cc`}>{isMeeting ? 'Optional attendees' : 'Cc'}</label>
              <input id={`${draft.id}-cc`} className={styles.input} value={form.cc}
                onChange={e => setForm(f => ({ ...f, cc: e.target.value }))} />
            </div>
            {!isMeeting && (
              <div>
                <label className={styles.label} htmlFor={`${draft.id}-bcc`}>Bcc</label>
                <input id={`${draft.id}-bcc`} className={styles.input} value={form.bcc}
                  onChange={e => setForm(f => ({ ...f, bcc: e.target.value }))} />
              </div>
            )}
          </div>
          <p className={styles.hint}>Separate recipients with a semicolon. &ldquo;Name &lt;addr@se.com&gt;&rdquo; or a bare address both work.</p>

          <div className={styles.editRow}>
            <label className={styles.label}>
              Body
              <button type="button" className={styles.linkBtn} style={{ marginLeft: '0.6rem', textTransform: 'none', letterSpacing: 0 }} onClick={toggleRawHtml}>
                {rawHtml ? 'Back to formatted editing' : 'Edit HTML source'}
              </button>
            </label>
            {rawHtml ? (
              <textarea ref={htmlRef} className={styles.htmlArea} defaultValue={form.bodyHtml} spellCheck={false} />
            ) : (
              // Uncontrolled on purpose: React must not re-render the tables
              // out from under the caret while the user types in them. The
              // key remounts it with fresh content when the source view
              // hands edits back.
              <div
                ref={bodyRef}
                key={`${draft.id}-wysiwyg-${form.bodyHtml.length}`}
                className={styles.editor}
                contentEditable
                suppressContentEditableWarning
                dangerouslySetInnerHTML={{ __html: form.bodyHtml }}
              />
            )}
            <p className={styles.hint}>
              {rawHtml
                ? 'Raw HTML — what Outlook receives, signature aside.'
                : 'Type straight into the table cells. Tab moves between them.'}
            </p>
          </div>

          <div className={styles.actions} style={{ marginTop: '0.8rem' }}>
            <button type="button" className={styles.primaryBtn} onClick={save}>Save changes</button>
            <button type="button" className={styles.secondaryBtn} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DansDraftsView({ settings, updateSettings }) {
  const { isAdmin, user } = useAuth();
  const [result, setResult] = useState(null);
  const organizer = user?.email ? { name: user.displayName || '', email: user.email } : null;

  const overrides = useMemo(() => settings?.dansDrafts || {}, [settings?.dansDrafts]);
  const signature = resolveSignature(settings, isAdmin);

  // A saved override replaces the shipped fields it names; anything it leaves
  // out (type, blurb, meeting defaults) still comes from the template, so a
  // template fix reaches users who have edited some other part of it.
  const drafts = useMemo(
    () => DANS_DRAFTS.map(d => ({ ...d, ...(overrides[d.id] || {}) })),
    [overrides],
  );

  const saveDraft = (id, patch) => {
    updateSettings({ dansDrafts: { ...overrides, [id]: patch } });
  };

  const resetDraft = (id) => {
    const next = { ...overrides };
    delete next[id];
    updateSettings({ dansDrafts: next });
    setResult({ type: 'success', message: 'Reset to the original template.' });
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>Dan&rsquo;s Drafts</h2>
        <p className={styles.desc}>
          Dan&rsquo;s standing Outlook templates. Download one to open it in Outlook as an editable
          draft, or edit the copy kept here so every future download starts from your wording.
        </p>
      </div>

      {result && (
        <div className={`${styles.result} ${styles[`result_${result.type}`]}`}>{result.message}</div>
      )}

      {drafts.map(d => (
        <DraftCard
          key={d.id}
          draft={d}
          isEdited={!!overrides[d.id]}
          signature={signature}
          organizer={organizer}
          onSave={patch => saveDraft(d.id, patch)}
          onReset={() => resetDraft(d.id)}
          onResult={setResult}
        />
      ))}
    </div>
  );
}
