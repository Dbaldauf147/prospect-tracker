import { useLayoutEffect, useState } from 'react';

// Where the list goes.
//
// It can't go where it belongs — inside the header cell. The table scrolls
// inside its own box and the page scrolls behind it, so a list positioned in
// the cell is clipped by both. So it is fixed to the viewport and put back
// under its own box whenever anything scrolls or resizes.
export function useListAnchor(open, inputRef, wanted) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const base = { left: r.left, width: Math.max(r.width, 180) };
      // Below unless it genuinely doesn't fit there and fits better above.
      setPos(below < wanted && r.top > below
        ? { ...base, bottom: window.innerHeight - r.top + 2 }
        : { ...base, top: r.bottom + 2 });
    };
    place();
    // Capture, so scrolling the table's own box counts and not just the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, inputRef, wanted]);
  return pos;
}
