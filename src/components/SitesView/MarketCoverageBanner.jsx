// "The sheets can't place these sites" warning on the Utility Lookup page.
//
// Sits beside the tenure warning and works the same way: it states the gap
// in the numbers the exports print, says which of the two fixes applies,
// and can be dismissed until the shape of the gap changes. See
// marketCoverage.js for what counts as a gap worth showing.

const AMBER_BG = '#FFFBEB';
const AMBER_TEXT = '#92400E';

// "715 of 716 (99%)" — the shape of the gap in one phrase.
function share(n, total, pct) {
  return `${n.toLocaleString()} of ${total.toLocaleString()} (${pct}%)`;
}

// One commodity's line. The two Unknown reasons have different fixes, so
// whichever dominates is named first and the other follows as a count.
function gapLine(gap, total) {
  const bits = [];
  if (gap.noUtility > 0) {
    bits.push(`${gap.noUtility.toLocaleString()} in a competitive state with no utility or supplier on file`);
  }
  if (gap.noPlace > 0) {
    bits.push(`${gap.noPlace.toLocaleString()} with no recognized state or country`);
  }
  return (
    <li key={gap.key} style={{ marginTop: '0.15rem' }}>
      <strong>{gap.label}: {share(gap.unknown, total, gap.pct)} sites are unclassified</strong>
      {bits.length ? <> — {bits.join(', ')}</> : null}
      {gap.deregulated > 0
        ? <>. Only {gap.deregulated.toLocaleString()} {gap.deregulated === 1 ? 'site' : 'sites'} {gap.deregulated === 1 ? 'is' : 'are'} counted as deregulated.</>
        : <>. Nothing is counted as deregulated.</>}
    </li>
  );
}

export function MarketCoverageBanner({ warning, onLoadUtilityFile, onDismiss }) {
  if (!warning || !warning.gaps.length) return null;
  const { total, gaps } = warning;
  const anyNoUtility = gaps.some(g => g.noUtility > 0);
  const anyNoPlace = gaps.some(g => g.noPlace > 0);
  // "Most" has to earn itself: a third of the portfolio is worth an
  // interruption, but calling it most is the kind of overstatement that
  // teaches people to skim the banner.
  const worst = Math.max(...gaps.map(g => g.pct));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.6rem',
        margin: '0.5rem 1.25rem',
        padding: '0.55rem 0.75rem',
        background: AMBER_BG,
        border: '1px solid #F59E0B',
        borderRadius: 6,
        color: AMBER_TEXT,
        fontSize: '0.78rem',
        lineHeight: 1.45,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '0.9rem', lineHeight: 1.2 }}>⚠</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>
          {worst >= 50 ? 'Most of this portfolio' : 'Part of this portfolio'} can&rsquo;t be placed in a market.
        </strong>{' '}
        A site the classifier can&rsquo;t place counts in <strong>Total Sites</strong> but not in{' '}
        <strong>Deregulated Sites</strong>, so the Master Analysis reads like a portfolio with no
        competitive supply rather than one we can&rsquo;t see yet.
        <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
          {gaps.map(g => gapLine(g, total))}
        </ul>
        {anyNoUtility && (
          <div style={{ marginTop: '0.3rem' }}>
            A site in a competitive state only counts once its utility or supplier is known:
            load the <strong>utility rates file</strong> (zip &rarr; utility) under Data sources, or
            map the upload&rsquo;s utility / supplier column.
          </div>
        )}
        {anyNoPlace && (
          <div style={{ marginTop: '0.3rem' }}>
            Sites with no recognized state or country have no market reference to read at all —
            those are fixed in the geography columns of the upload.
          </div>
        )}
      </div>
      {onLoadUtilityFile && (
        <button
          type="button"
          onClick={onLoadUtilityFile}
          style={{
            flexShrink: 0,
            padding: '0.25rem 0.6rem',
            border: '1px solid #F59E0B',
            background: '#FFFFFF',
            color: AMBER_TEXT,
            borderRadius: 6,
            fontSize: '0.72rem',
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          title="Open the Data sources bar, where the utility rates file and the city/state → zip fallback table are loaded."
        >Data sources</button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss the market coverage warning"
          title="Hide this warning until the loaded sites or the utility data change."
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            color: '#B45309',
            fontSize: '1rem',
            lineHeight: 1,
            padding: '0.1rem 0.2rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >×</button>
      )}
    </div>
  );
}

export default MarketCoverageBanner;
