// Free-text notes above the Keith agenda: anything to keep in front of you
// for the meeting that isn't a line to tick off. A bulleted textarea
// (CommitOnBlurInput's bulletList mode: clicking an empty box starts a
// bullet, Enter starts the next), stored as one string in user settings
// (`keithNotes`) so it syncs across devices like the agenda below it.
//
// Saved on blur, not on every keystroke: a settings write per character
// would round-trip to Firestore and fight the cursor, the same reason the
// agenda holds its drafts locally.
import { CommitOnBlurInput } from '../common/CommitOnBlurInput';
import { BULLET } from '../../utils/bulletText';
import styles from './OppsView2.module.css';

// A box left holding only empty bullets saves as empty, and trailing empty
// bullets don't pile up at the end of the note.
function tidy(text) {
  const lines = String(text ?? '').split('\n').map(l => l.replace(/\s+$/, ''));
  while (lines.length && (!lines[lines.length - 1].trim() || lines[lines.length - 1] === BULLET.trim())) lines.pop();
  return lines.join('\n');
}

export function KeithNotes({ settings, updateSettings }) {
  const stored = typeof settings?.keithNotes === 'string' ? settings.keithNotes : '';
  return (
    <div className={styles.agendaWrap}>
      <div className={styles.agendaHead}>
        <span className={styles.agendaTitle}>Notes</span>
        <span className={styles.agendaHint}>free text · Enter starts a new bullet</span>
      </div>
      <CommitOnBlurInput
        multiline
        autoGrow
        bulletList
        rows={2}
        value={stored}
        onCommit={(v) => {
          const next = tidy(v);
          if (next !== stored) updateSettings({ keithNotes: next });
        }}
        placeholder="Click to add notes"
        aria-label="Notes for the Keith meeting"
        style={{
          display: 'block', width: '100%', boxSizing: 'border-box', resize: 'none', overflow: 'hidden',
          minHeight: '2.4rem', padding: '0.35rem 0.5rem', border: '1px solid var(--color-border)',
          borderRadius: 6, background: '#fff', color: 'var(--color-text)', fontFamily: 'inherit',
          fontSize: '0.8rem', lineHeight: 1.5, outline: 'none',
        }}
      />
    </div>
  );
}

export default KeithNotes;
