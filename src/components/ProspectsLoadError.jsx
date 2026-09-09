// Shown in place of the views when the prospects subscription fails.
//
// Firestore reports a broken listener once and then drops it — nothing
// arrives afterwards, and there is no retry. The load used to just log
// that and leave `loading` true, so the app sat on "Loading prospects..."
// for as long as the tab stayed open, with the reason only in a console
// nobody had open. This is the same net RootErrorBoundary is for a crash:
// end the wait, and say what happened.
//
// It deliberately replaces the view rather than sitting above an empty
// one. Every page here reads off the roster, so rendering them with the
// zero rows we have would show an app with no companies, no opps and no
// contacts — indistinguishable from data loss, and far more alarming than
// the truth.
import { explainProspectsLoadError } from '../utils/prospectsLoadError';


export function ProspectsLoadError({ message }) {
  const btn = { padding: '0.45rem 0.9rem', border: '1px solid var(--color-border)', borderRadius: 6, background: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
  const text = String(message || 'Unknown error');

  return (
    <div style={{ maxWidth: 720, margin: '3rem auto', padding: '1.5rem' }}>
      <h1 style={{ fontSize: '1.15rem', margin: '0 0 0.5rem', color: 'var(--color-text)' }}>
        Your companies could not be loaded
      </h1>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.5 }}>
        {explainProspectsLoadError(text)} Nothing has been changed or deleted — this is a failed
        read, so your data is exactly as you left it.
      </p>
      <pre style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.75rem', fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
        {text}
      </pre>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <button type="button" style={btn} onClick={() => window.location.reload()}>Reload</button>
        <button
          type="button"
          style={btn}
          onClick={(e) => {
            const b = e.currentTarget;
            const details = `Prospects failed to load: ${text}\nPage: ${window.location.href}\nUser agent: ${navigator.userAgent}`;
            try {
              navigator.clipboard.writeText(details);
              b.textContent = 'Copied';
            } catch {
              b.textContent = 'Copy failed — see console';
              console.log(details);
            }
          }}
        >
          Copy details
        </button>
      </div>
    </div>
  );
}
