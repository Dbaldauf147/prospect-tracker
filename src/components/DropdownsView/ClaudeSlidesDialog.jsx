// "PPT with Claude" on a timeline: Claude builds the deck, steered by the
// user's "Slides and One Pagers" Claude Project. The API can't open a
// claude.ai Project, so this dialog holds a copy of the project's
// instructions and knowledge (settings.claudeSlidesProject, synced like the
// rest of settings) and sends it with each build.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadTimelinePptxWithClaude } from '../../utils/timelineExport';
import styles from './DropdownsView.module.css';

export const DEFAULT_SLIDES_PROJECT = 'Slides and One Pagers';
const MAX_INSTRUCTIONS = 20000;
const MAX_KNOWLEDGE = 60000;

const field = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: '0.78rem',
  padding: '0.45rem 0.55rem', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md, 6px)', background: 'var(--color-surface, #fff)', color: 'var(--color-text)',
};
const label = { display: 'block', fontSize: '0.74rem', fontWeight: 700, color: 'var(--color-text)', margin: '0.7rem 0 0.25rem' };
const hint = { fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' };

export function ClaudeSlidesDialog({ template, project, onSaveProject, onClose }) {
  const [name, setName] = useState(project?.name || DEFAULT_SLIDES_PROJECT);
  const [instructions, setInstructions] = useState(project?.instructions || '');
  const [knowledge, setKnowledge] = useState(project?.knowledge || '');
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const hasProject = !!(instructions.trim() || knowledge.trim());

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const draft = () => ({ name: name.trim() || DEFAULT_SLIDES_PROJECT, instructions: instructions.trim(), knowledge: knowledge.trim() });
  const changed = () => {
    const d = draft();
    return d.name !== (project?.name || DEFAULT_SLIDES_PROJECT)
      || d.instructions !== (project?.instructions || '')
      || d.knowledge !== (project?.knowledge || '');
  };
  function save() {
    if (changed()) onSaveProject(draft());
  }

  async function build() {
    save();
    setBusy(true);
    setError('');
    setStatus('Claude is building the deck. This usually takes one to three minutes.');
    try {
      const note = await downloadTimelinePptxWithClaude(template, draft(), { request: request.trim() });
      setStatus(note ? `Downloaded. ${note}` : 'Downloaded.');
    } catch (err) {
      setStatus('');
      setError(err?.message || 'Could not build the deck.');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className={styles.detailOverlay} onClick={() => { if (!busy) onClose(); }} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="PowerPoint with Claude"
        data-claude-slides-dialog
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(760px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column',
          background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)',
          borderRadius: 10, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)', overflow: 'hidden',
        }}
      >
        <div className={styles.detailHeader}>
          <div className={styles.detailTitleWrap}>
            <h3 className={styles.detailTitle}>PowerPoint with Claude: {template?.name || 'Timeline'}</h3>
            <div style={hint}>
              Claude builds this timeline as editable slides in your reference layout (title, legend, month bars, Today and contract signature markers), then a process-steps slide, following your Claude Project.
            </div>
          </div>
          <button type="button" className={styles.detailClose} onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.4rem 0.9rem 0.9rem' }}>
          <label style={label} htmlFor="claude-slides-name">Claude Project</label>
          <input id="claude-slides-name" type="text" style={field} value={name} maxLength={120}
            onChange={e => setName(e.target.value)} disabled={busy} />
          <div style={hint}>
            The app can't open a claude.ai Project directly, so paste its contents below. On claude.ai, open the
            project and copy its custom instructions, and the text of any knowledge files that matter for slides.
            It's saved here and used for every timeline; update it when the project changes.
          </div>

          <label style={label} htmlFor="claude-slides-instructions">Project instructions</label>
          <textarea id="claude-slides-instructions" style={{ ...field, minHeight: 140, resize: 'vertical' }}
            value={instructions} maxLength={MAX_INSTRUCTIONS} disabled={busy}
            placeholder="Paste the project's custom instructions"
            onChange={e => setInstructions(e.target.value)} />
          <div style={hint}>{instructions.length.toLocaleString()} / {MAX_INSTRUCTIONS.toLocaleString()} characters</div>

          <label style={label} htmlFor="claude-slides-knowledge">Project knowledge (optional)</label>
          <textarea id="claude-slides-knowledge" style={{ ...field, minHeight: 110, resize: 'vertical' }}
            value={knowledge} maxLength={MAX_KNOWLEDGE} disabled={busy}
            placeholder="Paste reference text from the project's knowledge files: style guide, example slide copy, brand rules"
            onChange={e => setKnowledge(e.target.value)} />
          <div style={hint}>{knowledge.length.toLocaleString()} / {MAX_KNOWLEDGE.toLocaleString()} characters</div>

          <label style={label} htmlFor="claude-slides-request">Anything specific for this deck? (optional)</label>
          <textarea id="claude-slides-request" style={{ ...field, minHeight: 60, resize: 'vertical' }}
            value={request} maxLength={4000} disabled={busy}
            placeholder="e.g. One slide only, for the steering committee; add a slide on client responsibilities"
            onChange={e => setRequest(e.target.value)} />

          {status && <div role="status" style={{ ...hint, fontSize: '0.74rem', color: 'var(--color-text)', marginTop: '0.8rem' }}>{status}</div>}
          {error && <div role="alert" style={{ fontSize: '0.74rem', color: '#B91C1C', marginTop: '0.8rem' }}>{error}</div>}
        </div>

        <div className={styles.detailFooter}>
          <span className={styles.detailFooterNote}>
            {hasProject ? 'Uses the Claude API, so each deck is billed to the app\'s Anthropic account.' : 'Paste the project instructions to build a deck.'}
          </span>
          <button type="button" className={styles.detailFooterBtn} disabled={busy}
            onClick={() => { save(); onClose(); }}>Save and close</button>
          <button type="button" className={styles.detailFooterBtn} data-claude-slides-build
            disabled={busy || !hasProject || !template?.stages?.length}
            onClick={build}
            style={{ background: 'var(--color-accent)', color: '#fff', borderColor: 'var(--color-accent)' }}
          >{busy ? 'Building…' : 'Build deck'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
