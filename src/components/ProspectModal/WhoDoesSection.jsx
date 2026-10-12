// "Who does ___ at this company?" on the company popup's Contacts tab.
// The questions are one standard list (settings.whoDoesQuestions); each
// company keeps its own answers. The rules live in utils/whoDoes.js.
// "Research with Claude" asks the questions of the public web
// (/api/who-does-research); its findings are kept on the company
// (prospect.whoDoesResearch) and show under each question until the user
// saves the names they trust.
import { useMemo, useState } from 'react';
import { apiFetch } from '../../utils/apiFetch';
import { titleSuggestions, namedOnTab, namedToDraft, newQuestionId, nameOf } from '../../utils/whoDoes';

const box = { border: '1px solid var(--color-border)', borderRadius: 8, background: '#fff', padding: '0.6rem 0.75rem' };
const small = { fontSize: '0.68rem', color: '#64748B' };
const input = { padding: '0.25rem 0.45rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.74rem', fontFamily: 'inherit' };
const addBtn = { padding: '0.1rem 0.5rem', border: '1px solid #0891B2', borderRadius: 4, background: '#ECFEFF', color: '#0E7490', fontSize: '0.66rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const researchBtn = { padding: '0.2rem 0.6rem', border: '1px solid #7C3AED', borderRadius: 4, background: '#F5F3FF', color: '#6D28D9', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const CONFIDENCE_COLORS = {
  high: { background: '#DCFCE7', color: '#166534' },
  medium: { background: '#FEF3C7', color: '#92400E' },
  low: { background: '#F1F5F9', color: '#475569' },
};
const linkBtn = { border: 'none', background: 'none', padding: 0, font: 'inherit', color: '#1D4ED8', textDecoration: 'underline', cursor: 'pointer' };

function QuestionEditor({ questions, onSave }) {
  const update = (id, patch) => onSave(questions.map(q => (q.id === id ? { ...q, ...patch } : q)));
  const remove = (q) => {
    if (!window.confirm(`Remove "${q.question || 'this question'}" from every company? The names typed under it stay on the companies but stop showing.`)) return;
    onSave(questions.filter(x => x.id !== q.id));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
      <div style={small}>These questions show on every company. Title keywords (comma separated) suggest contacts whose job title contains them.</div>
      {questions.map(q => (
        <div key={q.id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            defaultValue={q.question}
            placeholder="Who does ... at this company?"
            onBlur={e => { if (e.target.value !== q.question) update(q.id, { question: e.target.value.trim() }); }}
            style={{ ...input, flex: '2 1 260px' }}
          />
          <input
            defaultValue={q.keywords || ''}
            placeholder="Title keywords, e.g. energy, procurement"
            onBlur={e => { if (e.target.value !== (q.keywords || '')) update(q.id, { keywords: e.target.value.trim() }); }}
            style={{ ...input, flex: '1 1 200px' }}
          />
          <button type="button" onClick={() => remove(q)} title="Remove this question" style={{ border: 'none', background: 'none', color: '#B91C1C', cursor: 'pointer', fontSize: '0.9rem' }}>×</button>
        </div>
      ))}
      <div>
        <button
          type="button"
          onClick={() => onSave([...questions, { id: newQuestionId(), question: '', keywords: '' }])}
          style={{ ...addBtn, borderStyle: 'dashed' }}
        >+ Add question</button>
      </div>
    </div>
  );
}

function NamedForm({ onAdd }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const submit = () => {
    if (!name.trim() && !email.trim()) return;
    onAdd({ name: name.trim(), email: email.trim(), title: title.trim() });
    setName(''); setEmail(''); setTitle('');
  };
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
  return (
    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
      <input value={name} onChange={e => setName(e.target.value)} onKeyDown={onKey} placeholder="Name they gave" style={{ ...input, flex: '1 1 140px' }} />
      <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={onKey} placeholder="Email (optional)" style={{ ...input, flex: '1 1 160px' }} />
      <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={onKey} placeholder="Title (optional)" style={{ ...input, flex: '1 1 120px' }} />
      <button type="button" onClick={submit} style={{ ...addBtn, background: '#fff' }}>Save name</button>
    </div>
  );
}

// What Claude found for one question: each person with the page that names
// them. Already on the Contacts tab reads as such; already saved under
// "Named by the company" reads Saved; otherwise "Save name" adds them there.
function ResearchFindings({ found, named, onSaveNamed, companyContacts, onOpenContact }) {
  if (found == null) return null;
  const isSaved = (p) => named.some(n => String(n.name || '').trim().toLowerCase() === p.name.toLowerCase());
  return (
    <>
      <div style={{ ...small, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: '0.5rem', color: '#6D28D9' }}>Found by Claude</div>
      {found.length === 0 ? (
        <div style={{ ...small, fontStyle: 'italic' }}>Nobody found on the public web.</div>
      ) : found.map(p => {
        const onTab = namedOnTab({ name: p.name }, companyContacts);
        const saved = isSaved(p);
        return (
          <div key={p.name} style={{ fontSize: '0.74rem', marginTop: '0.25rem' }}>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {onTab ? (
                <>
                  <span style={{ color: '#16A34A', fontWeight: 700 }} title="On this company's contacts">✓</span>
                  <button type="button" onClick={() => onOpenContact(onTab)} style={linkBtn}>{p.name}</button>
                </>
              ) : <span style={{ fontWeight: 600 }}>{p.name}</span>}
              {p.title && <span style={{ color: '#64748B' }}>{p.title}</span>}
              <span
                style={{ ...CONFIDENCE_COLORS[p.confidence], fontSize: '0.6rem', fontWeight: 700, padding: '0 6px', borderRadius: 999, textTransform: 'uppercase' }}
                title="How sure Claude is that this person answers the question"
              >{p.confidence}</span>
              {saved ? (
                <span style={{ ...small, marginLeft: 'auto' }}>Saved</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSaveNamed([...named, { name: p.name, email: '', title: p.title }])}
                  style={{ ...addBtn, marginLeft: 'auto', background: '#fff' }}
                  title="Save under Named by the company"
                >Save name</button>
              )}
            </div>
            <div style={{ ...small, marginTop: 1 }}>
              {p.note}{p.note ? ' ' : ''}
              <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB' }} title={p.sourceUrl}>{p.sourceTitle}</a>
            </div>
          </div>
        );
      })}
    </>
  );
}

function QuestionCard({ question, named, onSaveNamed, found, company, companyContacts, allContacts, domains, excludedIds, onLinkContact, onAddNamed, onOpenContact }) {
  const { onTab, toAdd } = useMemo(
    () => titleSuggestions({ question, company, companyContacts, allContacts, domains, excludedIds }),
    [question, company, companyContacts, allContacts, domains, excludedIds],
  );
  const hasKeywords = !!String(question.keywords || '').trim();
  return (
    <div style={box}>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1E293B', marginBottom: '0.35rem' }}>{question.question || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Untitled question</span>}</div>

      <div style={{ ...small, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: '0.2rem' }}>Suggested by title</div>
      {!hasKeywords ? (
        <div style={{ ...small, fontStyle: 'italic' }}>Add title keywords to this question (Edit questions) to get suggestions.</div>
      ) : (onTab.length === 0 && toAdd.length === 0) ? (
        <div style={{ ...small, fontStyle: 'italic' }}>Nobody in HubSpot here has a matching title.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.15rem' }}>
          {onTab.map(c => (
            <div key={c.id || c.vid} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.74rem' }}>
              <span style={{ color: '#16A34A', fontWeight: 700 }} title="Already on this company's contacts">✓</span>
              <button type="button" onClick={() => onOpenContact(c)} style={linkBtn}>{nameOf(c)}</button>
              <span style={{ color: '#64748B' }}>{c.jobtitle}</span>
            </div>
          ))}
          {toAdd.map(c => (
            <div key={c.id || c.vid} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.74rem' }}>
              <button type="button" onClick={() => onLinkContact(c.id || c.vid)} style={addBtn} title={`Add ${nameOf(c)} to this company's contacts`}>+ Add</button>
              <span style={{ fontWeight: 600 }}>{nameOf(c)}</span>
              <span style={{ color: '#64748B' }}>{[c.jobtitle, c.company].filter(Boolean).join(' · ')}</span>
            </div>
          ))}
        </div>
      )}

      <ResearchFindings found={found} named={named} onSaveNamed={onSaveNamed} companyContacts={companyContacts} onOpenContact={onOpenContact} />

      <div style={{ ...small, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: '0.5rem' }}>Named by the company</div>
      {named.length === 0 && <div style={{ ...small, fontStyle: 'italic' }}>Nobody yet. Type who they told you below.</div>}
      {named.map((p, i) => {
        const found = namedOnTab(p, companyContacts);
        return (
          <div key={`${p.email || p.name}-${i}`} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.74rem', marginTop: '0.15rem' }}>
            {found ? (
              <>
                <span style={{ color: '#16A34A', fontWeight: 700 }} title="On this company's contacts">✓</span>
                <button type="button" onClick={() => onOpenContact(found)} style={linkBtn}>{p.name || nameOf(found)}</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => onAddNamed(namedToDraft(p, company))} style={addBtn} title="Open Add Contact with these details filled in">+ Add</button>
                <span style={{ fontWeight: 600 }}>{p.name || p.email}</span>
              </>
            )}
            <span style={{ color: '#64748B' }}>{[p.title, p.email].filter(Boolean).join(' · ')}</span>
            <button
              type="button"
              onClick={() => onSaveNamed(named.filter((_, j) => j !== i))}
              title="Remove this name"
              style={{ marginLeft: 'auto', border: 'none', background: 'none', color: '#94A3B8', cursor: 'pointer' }}
            >×</button>
          </div>
        );
      })}
      <NamedForm onAdd={(p) => onSaveNamed([...named, p])} />
    </div>
  );
}

export function WhoDoesSection({
  questions = [], onSaveQuestions, namedByQuestion = {}, onSaveNamedByQuestion,
  research = null, onSaveResearch, website = '',
  company, companyContacts = [], allContacts = [], domains = [], excludedIds = [],
  onLinkContact, onAddNamed, onOpenContact,
}) {
  const [editing, setEditing] = useState(false);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState('');
  // Findings only count for the company they were researched for, so a
  // renamed card doesn't show another company's people.
  const companyName = String(company || '').trim();
  const findings = research && research.company === companyName && research.answers && typeof research.answers === 'object' ? research : null;
  const runResearch = async () => {
    if (!companyName || researching) return;
    setResearching(true);
    setResearchError('');
    try {
      const r = await apiFetch('/api/who-does-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: { company: companyName, website: website || '', domains },
          questions: questions.map(q => ({ id: q.id, question: q.question })),
        }),
      });
      const txt = await r.text();
      let data = null;
      try { data = JSON.parse(txt); } catch { data = null; }
      if (!r.ok || !data?.answers) {
        setResearchError(data?.error || txt.slice(0, 200) || `HTTP ${r.status}`);
        return;
      }
      onSaveResearch({ company: companyName, at: new Date().toISOString(), answers: data.answers });
    } catch (err) {
      setResearchError(err?.message || 'Research failed');
    } finally {
      setResearching(false);
    }
  };
  const canResearch = !!companyName && questions.some(q => String(q.question || '').trim()) && typeof onSaveResearch === 'function';
  return (
    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text)' }}>Who does it here?</span>
        <span style={small}>Standard questions, the people HubSpot suggests by title, and the people the company named.</span>
        {canResearch && !editing && (
          <button
            type="button"
            onClick={runResearch}
            disabled={researching}
            style={{ ...researchBtn, marginLeft: 'auto', opacity: researching ? 0.6 : 1, cursor: researching ? 'wait' : 'pointer' }}
            title={findings
              ? `Last researched ${new Date(findings.at).toLocaleString()}. Click to search the public web again.`
              : 'Search the public web for who answers each question here. Takes up to a minute or two.'}
          >{researching ? 'Researching...' : findings ? 'Research again' : 'Research with Claude'}</button>
        )}
        <button
          type="button"
          onClick={() => setEditing(e => !e)}
          style={{ marginLeft: canResearch && !editing ? 0 : 'auto', padding: '0.2rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 4, background: editing ? '#1E293B' : '#fff', color: editing ? '#fff' : '#334155', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
        >{editing ? 'Done editing' : 'Edit questions'}</button>
      </div>
      {researchError && (
        <div style={{ ...small, color: '#B91C1C', marginBottom: '0.4rem' }}>Research failed: {researchError}</div>
      )}
      {researching && (
        <div style={{ ...small, marginBottom: '0.4rem' }}>Claude is searching the web for each question. This can take a minute or two.</div>
      )}
      {editing ? (
        <QuestionEditor questions={questions} onSave={onSaveQuestions} />
      ) : questions.length === 0 ? (
        <div style={{ ...small, fontStyle: 'italic' }}>No questions yet. Click Edit questions to write the first one, for example "Who handles energy procurement?"</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '0.6rem' }}>
          {questions.map(q => (
            <QuestionCard
              key={q.id}
              question={q}
              named={Array.isArray(namedByQuestion[q.id]) ? namedByQuestion[q.id] : []}
              onSaveNamed={(list) => onSaveNamedByQuestion({ ...namedByQuestion, [q.id]: list })}
              found={findings && Array.isArray(findings.answers[q.id]) ? findings.answers[q.id] : null}
              company={company}
              companyContacts={companyContacts}
              allContacts={allContacts}
              domains={domains}
              excludedIds={excludedIds}
              onLinkContact={onLinkContact}
              onAddNamed={onAddNamed}
              onOpenContact={onOpenContact}
            />
          ))}
        </div>
      )}
    </div>
  );
}
