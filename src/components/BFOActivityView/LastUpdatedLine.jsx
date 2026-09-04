import { useEffect, useState } from 'react';
import styles from './BFOActivityView.module.css';
import { formatLastUpdated } from '../../utils/lastUpdatedLabel';

// "Last updated 3 days ago" under a paste table's title.
//
// Both subtabs hold whatever was last copied out of Salesforce, and neither
// refreshes on its own. A table pasted this morning and one pasted five weeks
// ago look identical — same rows, same counts, same confident Close Dates — so
// this is the only thing on the page that says whether what you are reading is
// the current pipeline.
//
// Two cases it has to get right beyond the ordinary one:
//
//   No timestamp. Every table pasted before this existed has none. Showing
//   nothing there would read as "no data"; inventing a time would be worse. It
//   says so plainly, and the next paste starts recording.
//
//   A page left open. Someone parks this tab and comes back after lunch to a
//   label still reading "2 minutes ago". It re-renders on a minute's tick so
//   the number stays true to the clock, and stops ticking with nothing to show.
export function LastUpdatedLine({ updatedAt, hasRows }) {
  // Something to change once a minute so the relative form re-derives. The
  // value is never read — the render reads the clock itself.
  const [, setTick] = useState(0);
  const live = hasRows && typeof updatedAt === 'number' && updatedAt > 0;

  useEffect(() => {
    if (!live) return undefined;
    const id = window.setInterval(() => setTick(t => t + 1), 60 * 1000);
    return () => window.clearInterval(id);
  }, [live]);

  // An empty table says "no data yet" for itself, right below this.
  if (!hasRows) return null;

  const stamp = formatLastUpdated(updatedAt);
  if (!stamp) {
    return (
      <span className={styles.lastUpdatedUnknown} title="These rows were pasted before the tab started recording paste times. The next paste sets it.">
        Last updated: not recorded
      </span>
    );
  }
  return (
    <span className={styles.lastUpdated} title={`Last pasted ${stamp.exact}`}>
      Last updated {stamp.relative}
    </span>
  );
}
