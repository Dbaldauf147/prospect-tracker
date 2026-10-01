// Services marked Completed on the Pricing page's Services subtab: a list of
// lower-cased service names kept on its own pricing-cache key, so the marks
// hold on every option, every SIA and every deal. Pure, so it can be tested
// without a browser.

const norm = (s) => String(s ?? '').trim().toLowerCase();

// The completed list with the marks an older save kept on a cached
// workbook's options (`option.servicesCompleted`) added in, or null when
// the workbook carries none the list doesn't already have.
export function mergeCompletedServices(list, workbook) {
  const done = (Array.isArray(list) ? list : []).map(norm).filter(Boolean);
  const have = new Set(done);
  let added = false;
  for (const o of workbook?.options || []) {
    for (const name of Array.isArray(o?.servicesCompleted) ? o.servicesCompleted : []) {
      const k = norm(name);
      if (!k || have.has(k)) continue;
      have.add(k);
      done.push(k);
      added = true;
    }
  }
  return added ? done : null;
}
