// One company's sustainability picture, gathered from the two places it
// is kept.
//
// The company page owns the fields a person curates — the targets they
// typed into Sustainability Targets, the Frameworks they ticked. The
// "Research with Claude" run is saved separately, under
// settings.companyResearch keyed by a slug of the company name, and it
// carries what nobody types by hand: the programme summary, the
// initiatives, and links to the actual published reports.
//
// Three surfaces need that picture and each was reaching for a different
// part of it: the company modal (both), the Corporate Compliance card
// (curated fields only, so a company with research but no company record
// showed "No matching company record" and nothing else), and the Master
// Analysis export (neither). This resolves them once so all three agree.
//
// Curated beats researched wherever both exist — somebody looked at the
// research and decided, and that decision is the answer. What the
// research adds is everything the curated fields have no room for.
//
// Import-free, so the rules can be pinned under plain Node
// (scripts/sustainabilityProfile.test.mjs).

/** The key settings.companyResearch files a research run under. */
export function companyResearchSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
}

function lines(value) {
  return String(value || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

function strings(value) {
  return (Array.isArray(value) ? value : [])
    .map(v => String(v || '').trim())
    .filter(Boolean);
}

// A report link is only useful if it has somewhere to point.
function links(value) {
  const out = [];
  const seen = new Set();
  for (const entry of (Array.isArray(value) ? value : [])) {
    const url = String(entry?.url || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const year = Number(entry?.year);
    out.push({
      title: String(entry?.title || '').trim() || url,
      url,
      year: Number.isFinite(year) && year > 1900 ? year : null,
    });
  }
  return out;
}

/**
 * Everything known about one company's sustainability position.
 *
 * `prospect` is the matched company record (may be null — a company can
 * be researched without ever being added to the table, which is exactly
 * the case the Corporate Compliance card used to give up on).
 * `companyResearch` is the whole settings.companyResearch map.
 *
 * Returns { targets, targetsSource, frameworks, frameworksSource,
 * summary, programs, reports, researchedAt, hasAny }.
 */
export function sustainabilityProfile({ company = '', prospect = null, companyResearch = null } = {}) {
  const name = String(company || prospect?.company || '').trim();
  const research = (companyResearch || {})[companyResearchSlug(name)] || null;

  const curatedTargets = lines(prospect?.sustainabilityTargets);
  const researchedTargets = strings(research?.targets);
  const targets = curatedTargets.length ? curatedTargets : researchedTargets;

  const curatedFrameworks = strings(prospect?.frameworks);
  const researchedFrameworks = strings(research?.frameworks);
  const frameworks = curatedFrameworks.length ? curatedFrameworks : researchedFrameworks;

  const programs = strings(research?.programs);
  const reports = links(research?.reports);
  const summary = String(research?.summary || '').trim();

  return {
    company: name,
    targets,
    // Which of the two the targets came from, so a surface can say
    // "researched, not yet confirmed" rather than presenting a machine's
    // reading as somebody's decision.
    targetsSource: curatedTargets.length ? 'curated' : (researchedTargets.length ? 'research' : ''),
    frameworks,
    frameworksSource: curatedFrameworks.length ? 'curated' : (researchedFrameworks.length ? 'research' : ''),
    summary,
    programs,
    reports,
    researchedAt: research?.savedAt || null,
    hasAny: targets.length > 0 || frameworks.length > 0 || programs.length > 0
      || reports.length > 0 || !!summary,
  };
}

/**
 * What the surface says when there is nothing to show — or '' when there
 * is. The three empty states point at different actions, and a single
 * "no targets" line for all of them sends people to the wrong place.
 */
export function describeSustainability(profile, { hasProspect = true } = {}) {
  if (!profile || !profile.company) return 'Add a company name to pull its sustainability targets across.';
  if (profile.hasAny) return '';
  return hasProspect
    ? 'No sustainability targets recorded, and no research saved. Use “Research with Claude” on the company page.'
    : 'Nothing recorded yet. Add the company on the Table view to curate targets, or run “Research with Claude” on its company page.';
}
