// Who belongs on the Changed Jobs page, and which of them are former
// Schneider Electric coworkers. Pure and dependency-free so the page and
// the server (the monthly Changed Jobs email) answer the same way.

const SCHNEIDER_COMPANY_RE = /\bschneider\s*electric\b/i;
const SCHNEIDER_DOMAIN_RE = /(^|\.)(se\.com|schneider-electric\.com|schneider\.com)$/i;
export function isSchneiderContact(c) {
  if (SCHNEIDER_COMPANY_RE.test(String(c.company || ''))) return true;
  const email = String(c.email || '').toLowerCase().trim();
  const at = email.lastIndexOf('@');
  if (at >= 0) {
    const domain = email.slice(at + 1).trim();
    if (SCHNEIDER_DOMAIN_RE.test(domain)) return true;
  }
  return false;
}

export function isChangedJobs(c) {
  const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
  if (tags.includes('hide')) return false;
  // The Left tag comes before the coworker check, not after it: someone
  // tagged Left has left wherever they were, Schneider Electric included,
  // and a former coworker landing at a new employer is exactly the kind of
  // person this page exists to chase. Everyone still at Schneider stays out
  // — an @se.com address or a Schneider Company only means "coworker" while
  // the contact hasn't been marked as having left.
  if (tags.includes('left')) return true;
  if (isSchneiderContact(c)) return false;
  const company = String(c.company || '').trim().toLowerCase();
  if (company === 'changed jobs') return true;
  return false;
}
