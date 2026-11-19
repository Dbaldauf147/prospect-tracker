import { useMemo, useState } from 'react';
import { notTermRanges } from '../../utils/notTitleTerms';

// Bulk Add's Job title cell: the same editable input, with the Not terms
// from the Titles page marked where they sit in the title.
//
// An <input> cannot style part of its own text, so the marks are drawn by
// a layer laid over it: the same text in the same box, invisible except
// for the tinted stretches, and deaf to the mouse so the input underneath
// is still what gets clicked. The layer steps aside while the input has
// focus, because a long title scrolls sideways as it is edited and the
// layer would not follow.
export function NotTitleInput({ className, value, onChange, terms }) {
  const [focused, setFocused] = useState(false);
  const text = value || '';
  const ranges = useMemo(() => notTermRanges(text, terms), [text, terms]);

  const parts = [];
  if (!focused && ranges.length) {
    let at = 0;
    ranges.forEach(([start, end], i) => {
      if (start > at) parts.push(text.slice(at, start));
      parts.push(
        <mark
          key={i}
          data-not-term
          style={{ color: 'transparent', background: 'rgba(239, 68, 68, 0.28)', boxShadow: 'inset 0 -2px 0 #DC2626', borderRadius: 2 }}
        >{text.slice(start, end)}</mark>,
      );
      at = end;
    });
    if (at < text.length) parts.push(text.slice(at));
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        className={className}
        value={text}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        title={ranges.length ? `Contains a Not term from the Titles page: ${ranges.map(([s, e]) => text.slice(s, e)).join(', ')}` : undefined}
      />
      {parts.length > 0 && (
        <div
          aria-hidden="true"
          className={className}
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', background: 'transparent',
            color: 'transparent', whiteSpace: 'pre', overflow: 'hidden', boxSizing: 'border-box',
            display: 'flex', alignItems: 'center',
          }}
        ><span style={{ whiteSpace: 'pre' }}>{parts}</span></div>
      )}
    </div>
  );
}
