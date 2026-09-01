import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SERVICE_QUESTIONS, SERVICE_THEIR_QUESTIONS } from '../../data/serviceQuestions';
import styles from './DropdownsView.module.css';

// Title-case a lowercase service key for display ("bill payment" → "Bill
// Payment"). The stored key stays lowercase to match the seeding lookup.
function titleCase(s) {
  return String(s || '').replace(/\b\w/g, c => c.toUpperCase());
}

// A textarea that is always exactly as tall as its text.
//
// These boxes started at rows={1}, which is right for a four-word question
// and wrong for every real one: anything that wrapped was cut off mid
// sentence behind a scrollbar two lines tall, so the page showed the start
// of a question and hid the rest. A question you can't read is a question
// you can't check, which is the whole job of this tab.
//
// So the height follows the content: measured after every edit, and again
// whenever the column it sits in changes width — the same text wraps to
// three lines in a narrow column and two in a wide one. The observer
// watches the PARENT rather than the textarea itself, since resizing the
// textarea is what the callback does.
//
// Manual resizing goes with it: dragging a corner would be undone by the
// next keystroke, and there's nothing to drag for — the box is already the
// size of its text.
function AutoTextarea({ value, style, ...rest }) {
  const ref = useRef(null);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Collapse first, or the box can only ever grow: scrollHeight of an
    // over-tall textarea is its own height, not the text's.
    el.style.height = 'auto';
    // scrollHeight counts the padding but not the border, and `height` on a
    // border-box element is asked to cover both — so the border has to be
    // added back or every box lands two pixels short of its own last line.
    const cs = getComputedStyle(el);
    const extra = cs.boxSizing === 'border-box'
      ? parseFloat(cs.borderTopWidth || 0) + parseFloat(cs.borderBottomWidth || 0)
      : -(parseFloat(cs.paddingTop || 0) + parseFloat(cs.paddingBottom || 0));
    el.style.height = `${el.scrollHeight + extra}px`;
  }, []);

  useLayoutEffect(() => { fit(); }, [fit, value]);

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [fit]);

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      value={value}
      style={{ ...style, resize: 'none', overflow: 'hidden' }}
    />
  );
}

// One editable question (for "Questions to Ask Them"), as tall as it needs
// to be. Commits on blur/Enter; clearing the text removes the row.
function QuestionRow({ value, onCommit, onRemove }) {
  const [draft, setDraft] = useState(value);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, padding: '2px 0' }}>
      <AutoTextarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const t = draft.trim(); if (t === value) return; if (t === '') onRemove(); else onCommit(t); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); } }}
        style={{
          flex: 1, minWidth: 0, padding: '4px 6px',
          border: '1px solid var(--color-border)', borderRadius: 4,
          fontSize: '0.78rem', lineHeight: 1.35, fontFamily: 'inherit',
          color: 'var(--color-text)', background: '#fff',
        }}
      />
      <button
        type="button" onClick={onRemove} title="Remove this question"
        style={{ flex: '0 0 auto', width: 20, height: 20, lineHeight: 1, background: 'transparent', border: '1px solid transparent', borderRadius: 4, color: '#94A3B8', fontSize: '0.9rem', cursor: 'pointer' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#B91C1C'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.borderColor = 'transparent'; }}
      >×</button>
    </div>
  );
}

// Question + Our Response pair (for "Questions They Might Ask"). Either
// field commits independently; clearing the question removes the row.
function QAPairRow({ pair, onCommit, onRemove }) {
  const [q, setQ] = useState(pair.question || '');
  const [r, setR] = useState(pair.response || '');
  // Side by side while there's room, stacked once there isn't: two boxes
  // sharing a narrow column give each of them a word a line, which is the
  // same unreadable question in a different shape.
  const field = {
    flex: '1 1 11rem', minWidth: 0, padding: '4px 6px',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.78rem', lineHeight: 1.35, fontFamily: 'inherit',
    color: 'var(--color-text)', background: '#fff',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 4, padding: '2px 0' }}>
      <AutoTextarea
        value={q} placeholder="Their question"
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => { const qt = q.trim(); if (qt === '' && !(pair.response || '').trim()) { onRemove(); return; } if (qt === (pair.question || '') ) return; onCommit({ question: qt, response: r }); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { setQ(pair.question || ''); e.currentTarget.blur(); } }}
        style={field}
      />
      <AutoTextarea
        value={r} placeholder="Our response (optional)"
        onChange={(e) => setR(e.target.value)}
        onBlur={() => { if (r === (pair.response || '')) return; onCommit({ question: q.trim(), response: r }); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { setR(pair.response || ''); e.currentTarget.blur(); } }}
        style={field}
      />
      <button
        type="button" onClick={onRemove} title="Remove this question"
        style={{ flex: '0 0 auto', width: 20, height: 20, lineHeight: 1, background: 'transparent', border: '1px solid transparent', borderRadius: 4, color: '#94A3B8', fontSize: '0.9rem', cursor: 'pointer' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#B91C1C'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.borderColor = 'transparent'; }}
      >×</button>
    </div>
  );
}

const addBtnStyle = {
  marginTop: 4, padding: '3px 8px', background: 'transparent',
  border: '1px dashed var(--color-border)', borderRadius: 4,
  color: 'var(--color-accent)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

// Editable home for the canned questions that seed the Opportunity form's
// "Questions to Ask Them" / "Questions They Might Ask" tables. Edits are
// stored per service under settings.serviceQuestions /
// settings.serviceTheirQuestions and override the hardcoded defaults when
// a new opportunity seeds that service.
export function QuestionsTab({ settings, updateSettings, serviceOptions = [] }) {
  const [newService, setNewService] = useState('');

  const ourOverrides = (settings?.serviceQuestions && typeof settings.serviceQuestions === 'object') ? settings.serviceQuestions : {};
  const theirOverrides = (settings?.serviceTheirQuestions && typeof settings.serviceTheirQuestions === 'object') ? settings.serviceTheirQuestions : {};

  // Effective list = override when present, else the hardcoded default.
  const ourEff = (svc) => Array.isArray(ourOverrides[svc]) ? ourOverrides[svc] : (SERVICE_QUESTIONS[svc] || []);
  const theirEff = (svc) => Array.isArray(theirOverrides[svc]) ? theirOverrides[svc] : (SERVICE_THEIR_QUESTIONS[svc] || []);

  const services = useMemo(() => {
    const set = new Set([
      ...Object.keys(SERVICE_QUESTIONS),
      ...Object.keys(SERVICE_THEIR_QUESTIONS),
      ...Object.keys(ourOverrides),
      ...Object.keys(theirOverrides),
    ]);
    return [...set].sort();
  }, [ourOverrides, theirOverrides]);

  // Predictive options for the "Add service" box: services from the
  // Services menu (Solutions list) that aren't already on this page.
  // Compared case-insensitively against the lowercase keys we store.
  const availableServices = useMemo(() => {
    const listed = new Set(services);
    const seen = new Set();
    const out = [];
    for (const name of (serviceOptions || [])) {
      const key = String(name || '').trim().toLowerCase();
      if (!key || listed.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(String(name).trim());
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [serviceOptions, services]);

  function saveOur(svc, list) { updateSettings?.({ serviceQuestions: { ...ourOverrides, [svc]: list } }); }
  function saveTheir(svc, list) { updateSettings?.({ serviceTheirQuestions: { ...theirOverrides, [svc]: list } }); }
  function resetOur(svc) { const next = { ...ourOverrides }; delete next[svc]; updateSettings?.({ serviceQuestions: next }); }
  function resetTheir(svc) { const next = { ...theirOverrides }; delete next[svc]; updateSettings?.({ serviceTheirQuestions: next }); }

  function addService() {
    const key = newService.trim().toLowerCase();
    setNewService('');
    if (!key || services.includes(key)) return;
    // Register the new service with an empty "Ask Them" list so it appears.
    updateSettings?.({ serviceQuestions: { ...ourOverrides, [key]: [] } });
  }

  return (
    <>
      <div className={styles.searchRow}>
        <input
          type="text"
          className={styles.searchInput}
          list="questions-service-options"
          placeholder="Add a service from the Services menu…"
          value={newService}
          onChange={(e) => setNewService(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addService(); } }}
        />
        <datalist id="questions-service-options">
          {availableServices.map(s => <option key={s} value={s} />)}
        </datalist>
        <button
          type="button"
          onClick={addService}
          title="Add a service section"
          style={{ padding: '0.4rem 0.8rem', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >+ Add service</button>
        <span className={styles.resultCount}>
          These questions auto-fill an opportunity when its service is in “Scope Being Explored”.
        </span>
      </div>

      <div className={styles.scroll}>
        {services.map(svc => {
          const ours = ourEff(svc);
          const theirs = theirEff(svc);
          return (
            <div key={svc} className={styles.section}>
              <h3 className={styles.sectionTitle}>{titleCase(svc)}</h3>
              {/* min() rather than a bare 320px: on a window narrower than
                  that the track would otherwise hold its floor and push the
                  second card off the right edge. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
                <div className={styles.card}>
                  <div className={styles.cardHeader}>
                    <span className={styles.cardTitle}>Questions to Ask Them</span>
                    <span className={styles.cardCount}>{ours.length}</span>
                    {Array.isArray(ourOverrides[svc]) && SERVICE_QUESTIONS[svc] && (
                      <button type="button" onClick={() => resetOur(svc)} title="Revert to the built-in defaults" style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
                    )}
                  </div>
                  <div className={`${styles.cardBody} ${styles.questionsCardBody}`}>
                    {ours.map((q, idx) => (
                      <QuestionRow
                        key={idx}
                        value={q}
                        onCommit={(next) => { const list = [...ours]; list[idx] = next; saveOur(svc, list); }}
                        onRemove={() => saveOur(svc, ours.filter((_, i) => i !== idx))}
                      />
                    ))}
                    <button type="button" style={addBtnStyle} onClick={() => saveOur(svc, [...ours, ''])}>+ Add question</button>
                  </div>
                </div>

                <div className={styles.card}>
                  <div className={styles.cardHeader}>
                    <span className={styles.cardTitle}>Questions They Might Ask</span>
                    <span className={styles.cardCount}>{theirs.length}</span>
                    {Array.isArray(theirOverrides[svc]) && SERVICE_THEIR_QUESTIONS[svc] && (
                      <button type="button" onClick={() => resetTheir(svc)} title="Revert to the built-in defaults" style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
                    )}
                  </div>
                  <div className={`${styles.cardBody} ${styles.questionsCardBody}`}>
                    {theirs.map((pair, idx) => (
                      <QAPairRow
                        key={idx}
                        pair={pair}
                        onCommit={(next) => { const list = [...theirs]; list[idx] = next; saveTheir(svc, list); }}
                        onRemove={() => saveTheir(svc, theirs.filter((_, i) => i !== idx))}
                      />
                    ))}
                    <button type="button" style={addBtnStyle} onClick={() => saveTheir(svc, [...theirs, { question: '', response: '' }])}>+ Add question</button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
