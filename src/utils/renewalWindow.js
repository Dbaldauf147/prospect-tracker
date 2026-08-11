// A client whose soonest renewal falls inside this many days without a
// Status set is surfaced as an issue — mirrors the "needs a status" red
// row tint on the Clients tab (ClientsView's RENEWAL_WARNING_DAYS).
//
// It lives alone in this module rather than in clientIssues.js so the
// Prospecting ladder — which names the same window in the renewals step's
// tooltips — can read it without pulling in the whole issue-detection
// graph. That graph doesn't load under plain Node, and the ladder has
// tests that do (scripts/prospectingPlaybook.test.mjs). clientIssues.js
// re-exports it, so every existing importer is unaffected.
export const RENEWAL_WARNING_DAYS = 270;
