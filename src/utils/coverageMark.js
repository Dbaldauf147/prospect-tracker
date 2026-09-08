// The look of a service the Pipeline page's "Service Exploration Coverage"
// table is tracking — the parts that aren't a React component.
//
// Split from CoverageMark.jsx only because a component file that also exports
// constants breaks fast refresh. The reasoning for the mark itself is there.

import { SE_GREEN_DARK } from './schneiderBrand.js';

export const COVERAGE_MARK_TITLE =
  'Tracked in Service Exploration Coverage on the Pipeline page — you are watching what share of your clients have explored this.';

// The rail down the left of a tracked service's row. Spread onto the row's
// own style so it survives whatever background the service's status put
// there — status owns the fill, coverage owns the edge.
export const coverageRowStyle = {
  borderLeft: `3px solid ${SE_GREEN_DARK}`,
  // Drawn inside the row's existing padding rather than added to it, so a
  // tracked row and an untracked one still line their names up.
  paddingLeft: 'calc(0.35rem - 3px)',
};
