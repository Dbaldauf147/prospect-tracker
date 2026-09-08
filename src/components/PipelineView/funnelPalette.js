// The pipeline funnel's stage colours, in one file.
//
// Its own module rather than a constant exported from PipelineFunnel.jsx
// because two components paint stages now — the funnel itself, and the
// close-rate trend under it on the Weekly Report — and a colour map living
// inside a component file both breaks fast refresh and invites a second
// copy. Two pictures of the same stages side by side have to agree on
// which blue is Stage 5.

// Ordinal blue ramp, earliest stage darkest → latest lightest. Single
// hue (3° spread), monotone lightness with every adjacent gap clear, and
// the light end clears a white chart surface at 2.5:1 — validated as an
// ordinal ramp, which is the right check for ordered marks like funnel
// stages rather than the categorical one.
export const STAGE_FILL = {
  3: '#104281',
  4: '#1c5cab',
  5: '#2a78d6',
  6: '#6da7ec',
};

// The fallback when a stage number isn't one of the four.
export const STAGE_FILL_DEFAULT = '#2a78d6';
