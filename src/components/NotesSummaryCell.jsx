// The Notes cell on the New Opps and PE Opps subtabs: the opp's running
// notes summarised into a few bullets (see hooks/useNotesSummaries). The
// full notes are always one hover away in the tooltip, so the summary
// never hides what was actually written.

const listStyle = { margin: 0, paddingLeft: '1.05em', whiteSpace: 'normal', lineHeight: 1.35 };
const mutedStyle = { color: '#94A3B8', fontStyle: 'italic' };

export default function NotesSummaryCell({ summary, onClick, style }) {
  const { text, bullets, status, error } = summary;
  const tooltip = !text
    ? undefined
    : status === 'error'
      ? `Could not summarize (${error}). Full notes:\n${text}`
      : `Full notes:\n${text}`;
  const wrap = {
    display: 'block', minHeight: '1em', cursor: onClick ? 'pointer' : undefined, ...style,
  };

  if (status === 'empty') {
    return <span style={{ ...wrap, color: 'var(--color-text-muted, #94A3B8)' }} onClick={onClick}>-</span>;
  }
  if (status === 'ready') {
    return (
      <span style={wrap} title={tooltip} onClick={onClick}>
        {bullets.length === 1
          ? <span style={{ whiteSpace: 'normal' }}>{bullets[0]}</span>
          : <ul style={listStyle}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      </span>
    );
  }
  // Short notes are shown as written. Loading and failed ones show the
  // first line of the raw notes, so the cell is never blank while waiting.
  const firstLine = text.split('\n')[0].replace(/^- /, '');
  return (
    <span style={wrap} title={tooltip} onClick={onClick}>
      <span style={{ whiteSpace: 'normal' }}>{status === 'short' ? text.replace(/^- /, '') : firstLine}</span>
      {status === 'loading' && <span style={{ ...mutedStyle, marginLeft: 6 }}>summarizing...</span>}
      {status === 'error' && <span style={{ ...mutedStyle, marginLeft: 6 }}>(full notes on hover)</span>}
    </span>
  );
}
