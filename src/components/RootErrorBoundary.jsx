import { Component } from 'react';
import { isChunkLoadError, reloadPastCache } from '../utils/lazyView';

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
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    console.error('App render crashed', error, info);
    this.setState({ info });
  }

  details() {
    const { error, info } = this.state;
    return [
      `Error: ${String(error?.message || error || 'Unknown error')}`,
      error?.stack ? `\nStack:\n${error.stack}` : '',
      info?.componentStack ? `\nComponent stack:${info.componentStack}` : '',
      `\nPage: ${window.location.href}`,
      `User agent: ${navigator.userAgent}`,
    ].join('\n');
  }

  render() {
    const { error } = this.state;
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

    return (
      <div style={box}>
        <h1 style={{ fontSize: '1.15rem', margin: '0 0 0.5rem' }}>
          {stale ? 'This page is out of date' : 'Something in the page crashed'}
        </h1>
        <p style={{ color: '#475569', fontSize: 13, lineHeight: 1.5 }}>
          {stale ? (
            <>
              Part of the app would not load. Either this tab has been open
              across a deploy and is asking for a file that has since been
              replaced, or the browser has a bad copy of that file saved. Your
              data is untouched. Reload fetches it again from scratch, ignoring
              anything saved - if that was just tried and you are still here,
              the file may be missing from the server, so copy the details
              below.
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
