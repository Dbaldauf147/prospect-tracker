// The star a service carries on every board when the Pipeline page's "Service
// Exploration Coverage" table is tracking it.
//
// One component rather than a span copied into each board, because the whole
// point is that the mark reads as the same thing in the company card, the
// Opps Scope picker and the Deal Sizing picker — three boards a user moves
// between in a single train of thought.
//
// A glyph and an edge (see coverageRowStyle), not a fill: every one of those
// boards already colours a service by its STATUS — sold, quoted, trying again
// — and a second meaning on that channel would read as a third status. The
// Life Is On green ties the mark to the Pipeline page it comes from without
// competing with those fills.

import { SE_GREEN_DARK } from '../../utils/schneiderBrand';
import { COVERAGE_MARK_TITLE } from '../../utils/coverageMark';

/**
 * @param title extra context appended under the standard sentence, for a row
 *              whose own tooltip this one would otherwise replace.
 */
export function CoverageMark({ title }) {
  return (
    <span
      aria-label="Tracked for service coverage"
      title={title ? `${COVERAGE_MARK_TITLE}\n\n${title}` : COVERAGE_MARK_TITLE}
      style={{
        flex: '0 0 auto', color: SE_GREEN_DARK, fontSize: '0.66rem',
        lineHeight: 1, cursor: 'help',
      }}
    >&#9733;</span>
  );
}
