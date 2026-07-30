// How long a web-search research call may run before we abort it ourselves.
//
// When an invocation outlives its platform limit, Vercel kills it and
// serves an opaque FUNCTION_INVOCATION_TIMEOUT page. That HTML reaches
// the UI as raw text ("An error occurred with your deployment …"), which
// tells the user nothing and isn't retryable. Aborting a little early
// lets the route answer with a clean, actionable 504 instead.
//
// The ceiling that matters is the deployment's actual function limit, NOT
// the maxDuration in vercel.json: Hobby caps Node functions at 60s and
// clamps anything higher, so a 290s abort never got the chance to fire
// there — the platform always won first. Default to a budget that fits
// inside that 60s floor; deployments with a higher limit (Pro allows the
// 300s vercel.json asks for) can raise it with RESEARCH_TIMEOUT_MS.
const DEFAULT_BUDGET_MS = 50_000;

export function researchBudgetMs() {
  const raw = Number(process.env.RESEARCH_TIMEOUT_MS);
  // Ignore junk and anything too short to ever complete a search loop.
  if (Number.isFinite(raw) && raw >= 5_000) return raw;
  return DEFAULT_BUDGET_MS;
}
