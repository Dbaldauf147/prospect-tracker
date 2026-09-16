import { Component } from 'react';
import { isChunkLoadError, reloadPastCache, chunkUrlFrom, diagnoseChunk } from '../utils/lazyView';

// The last boundary before the page. Individual pages have their own (see
// KeyContactsView, PipelineView) so a bad row there doesn't take the app
// down; this one catches everything those don't -- a crash in App itself,
// in a provider, in the sidebar, or in a view with no boundary of its own.
//
// Without it, React unmounts the whole tree when a render throws and leaves
// #root empty: a white page carrying no clue about what happened, which is
// the state this app has landed in more than once.
export class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, diagnosis: null };
  }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    console.error('App render crashed', error, info);
    this.setState({ info });
    // A file that wouldn't load is the one crash where the screen can find
    // out more than it was told. Ask the network what happened to it, and
    // say so here rather than leaving it to be guessed at from the message.
    if (isChunkLoadError(error)) {
      diagnoseChunk(chunkUrlFrom(error))
        .then(diagnosis => this.setState({ diagnosis }))
        .catch(() => {});
    }
  }

  details() {
    const { error, info, diagnosis } = this.state;
    return [
      `Error: ${String(error?.message || error || 'Unknown error')}`,
      diagnosis ? `\n${diagnosis.detail}` : '',
      error?.stack ? `\nStack:\n${error.stack}` : '',
      info?.componentStack ? `\nComponent stack:${info.componentStack}` : '',
      `\nPage: ${window.location.href}`,
      `User agent: ${navigator.userAgent}`,
    ].join('\n');
  }

  render() {
    const { error, diagnosis } = this.state;
    if (!error) return this.props.children;

    const box = { maxWidth: 720, margin: '3rem auto', padding: '1.5rem', fontFamily: 'Inter, system-ui, sans-serif', color: '#0F172A' };
    const btn = { padding: '0.45rem 0.9rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };

    // A page whose chunk wouldn't load didn't crash so much as go stale:
    // either it is running an index.html from before the last deploy,
    // naming files that aren't on the server any more, or the browser is
    // holding a bad copy of a file it was told to cache for a year.
    // lazyView already tried the fix for both, so reaching here means it
    // didn't take — worth saying, because "a component threw" would send
    // the reader looking for a bug in the page they were opening.
    const stale = isChunkLoadError(error);

    // Once the diagnosis is in, the heading can say which of the two this
    // is, instead of leading with staleness for a file the server never
    // had or one an extension is eating.
    const heading = !stale ? 'Something in the page crashed'
      : ({
        missing: 'A file this page needs is not on the server',
        'missing-dep': 'A file this page needs is not on the server',
        'wrong-type': 'A file this page needs is not on the server',
        blocked: 'Something is blocking part of this page',
        'blocked-dep': 'Something is blocking part of this page',
        'script-blocked': 'Something is blocking part of this page',
        reachable: 'Something is blocking part of this page',
        transient: 'Part of the app did not load',
      })[diagnosis?.verdict] || 'This page is out of date';

    return (
      <div style={box}>
        <h1 style={{ fontSize: '1.15rem', margin: '0 0 0.5rem' }}>
          {heading}
        </h1>
        <p style={{ color: '#475569', fontSize: 13, lineHeight: 1.5 }}>
          {stale ? (
            <>
              Part of the app would not load. Your data is untouched.{' '}
              {diagnosis
                ? diagnosis.summary
                : 'Checking whether the file is on the server, or whether something here stopped it '
                  + 'from loading. Reload fetches it again from scratch, ignoring anything saved.'}
              {' '}Copy the details below to pass this on.
            </>
          ) : (
            <>
              The app loaded but a component threw while rendering, so React took the
              tree down. Your data is untouched. Reloading often clears it; if it comes
              back every time, copy the details below so the cause can be traced.
            </>
          )}
        </p>
        <pre style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.75rem', fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
          {String(error?.message || error)}
        </pre>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <button
            type="button"
            style={btn}
            onClick={() => { if (stale) reloadPastCache(error); else window.location.reload(); }}
          >
            Reload
          </button>
          <button
            type="button"
            style={btn}
            onClick={(e) => {
              const b = e.currentTarget;
              try {
                navigator.clipboard.writeText(this.details());
                b.textContent = 'Copied';
              } catch {
                b.textContent = 'Copy failed -- see console';
                console.log(this.details());
              }
            }}
          >
            Copy details
          </button>
        </div>
      </div>
    );
  }
}
