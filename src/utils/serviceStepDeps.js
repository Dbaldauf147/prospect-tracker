// Dependent Rollout Services, refined down to a step.
//
// A service's `dependsOn` is a comma-separated list of the services that have
// to be rolled out before it can start. That was always whole-service: Budgets
// waited for the entire Bill payment programme, including the report carding
// that happens weeks after the bills are actually redirected. In practice a
// service is usually unblocked partway through the one it waits on — Budgets
// can start once Bill Redirection & Go Live is done — and planning it any
// other way pushes every downstream date out by the tail of the service above.
//
// So an entry may name a step inside the service:
//
//   Bill payment                      → after the whole service
//   Bill payment > st-12              → after that step of its timeline
//
// The step is stored by ID, not by name, and that is not incidental: the list
// is comma-separated and real step names contain commas ("Provision of
// Capstone, Invoices, and Contracts"), so a name in there would split into
// three dependencies. IDs are generated and comma-free. Step-level `dependsOn`
// inside a template already stores IDs, so this matches.
//
// Pure and free of Vite-only imports, with explicit extensions, so
// scripts/serviceStepDeps.test.mjs can load it under plain Node.

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Every timeline attached to a service, in the order they're stored. The
 * composer uses the first and names the rest; the step pickers offer the
 * first's steps, so both agree on which timeline a step reference is against.
 */
export function templatesForService(templates, service) {
  const key = norm(service);
  if (!key) return [];
  return (Array.isArray(templates) ? templates : [])
    .filter(t => (t?.services || []).some(s => norm(s) === key));
}

/**
 * Split one dependency entry into the service and the step it names.
 * `step` is '' when the entry waits for the whole service.
 *
 * Only the FIRST ">" separates: a service name can't contain one, and a step
 * ID can't either, so anything further right belongs to the step.
 */
export function parseServiceRef(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { service: '', step: '' };
  const i = s.indexOf('>');
  if (i < 0) return { service: s, step: '' };
  return { service: s.slice(0, i).trim(), step: s.slice(i + 1).trim() };
}

/** The stored form of a reference. A blank step gives the plain service name. */
export function formatServiceRef(service, step) {
  const svc = String(service ?? '').trim();
  const st = String(step ?? '').trim();
  if (!svc) return '';
  return st ? `${svc} > ${st}` : svc;
}

/** Every entry of a `dependsOn` list, parsed. Blank entries are dropped. */
export function parseServiceRefs(value) {
  const list = Array.isArray(value)
    ? value.map(v => String(v ?? ''))
    : String(value || '').split(',');
  return list.map(parseServiceRef).filter(r => r.service);
}

/**
 * Where a step reference points inside a template: its index, or -1.
 *
 * Matched on ID first — that's what the pickers store — then on exact name,
 * so a value typed by hand still resolves as long as the name has no comma in
 * it. A reference that matches neither is stale (the step was renamed or
 * deleted), and the caller falls back to waiting for the whole service.
 */
export function findTemplateStepIndex(template, step) {
  const key = norm(step);
  if (!key) return -1;
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  const byId = stages.findIndex(st => norm(st?.id) === key);
  if (byId >= 0) return byId;
  return stages.findIndex(st => norm(st?.name) === key);
}

/**
 * The step's own name, for showing a reference to a human. '' when the
 * reference doesn't resolve — callers say "the whole service" or flag it stale
 * rather than printing a raw ID at somebody.
 */
export function stepLabel(template, step) {
  const i = findTemplateStepIndex(template, step);
  if (i < 0) return '';
  return String(template.stages[i]?.name || '').trim();
}

/** "Bill payment › Bill Redirection & Go Live", for display only. */
export function describeServiceRef(service, stepName) {
  const svc = String(service ?? '').trim();
  const st = String(stepName ?? '').trim();
  return st ? `${svc} › ${st}` : svc;
}

/**
 * Rewrite one service's step within a `dependsOn` list, leaving every other
 * entry — and the list's order — alone.
 *
 * This is what lets a service picker that only knows about services coexist
 * with a step refinement: it edits the list by service name, so toggling an
 * unrelated dependency can't silently drop the step somebody chose here.
 */
export function setRefStep(value, service, step) {
  const key = norm(service);
  if (!key) return String(value || '');
  return parseServiceRefs(value)
    .map(r => (norm(r.service) === key ? formatServiceRef(r.service, step) : formatServiceRef(r.service, r.step)))
    .join(', ');
}

/**
 * The step chosen for one service in a `dependsOn` list, or '' for none.
 * Case-insensitive on the service name, like every other lookup here.
 */
export function refStepFor(value, service) {
  const key = norm(service);
  if (!key) return '';
  const hit = parseServiceRefs(value).find(r => norm(r.service) === key);
  return hit ? hit.step : '';
}
