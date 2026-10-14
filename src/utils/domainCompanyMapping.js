// Which Table View company an email domain belongs to, and how to move it.
//
// Bulk Add Contacts matches a contact to a company mostly by the domain of
// their address, and that domain -> company map lives on the prospects
// themselves: every entry in a prospect's Email Domain list ("acme.com" or
// "{first}.{last}@acme.com") claims its domain, and so does its Website.
// Reassigning a domain is therefore a write to two prospect records: the
// entries come off the company that had it and go onto the one that should.
//
// Pure, so the rules can be pinned without a browser
// (scripts/domainCompanyMapping.test.mjs).

const splitEntries = (v) => String(v || '').split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);

/** The domain an Email Domain entry claims: the part after "@", or the whole entry. */
export function entryDomain(entry) {
  const e = String(entry || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  return at >= 0 ? e.slice(at + 1) : e;
}

/** The domain a Website claims, without scheme, "www." or path. */
export function websiteDomain(website) {
  return String(website || '').trim().toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

/**
 * The prospect writes that move `domain` to `target` (or off every company,
 * when `target` is null).
 *
 *   prospects   the Table View records
 *   domain      the domain being mapped, e.g. "acme.com"
 *   target      the prospect it should belong to, or null to unmap
 *   fallback    the entry to add when no existing entry is carried over,
 *               normally the address format learned from the rows
 *               ("{first}.{last}@acme.com"), else the bare domain
 *
 * Entries taken off another company move with the domain, so an address
 * format already on file is kept rather than relearned. Returns
 * [{ prospect, emailDomain }], one per record that changes; an empty list
 * means the domain already sits where it was asked to.
 *
 * A Website is never rewritten: it is the company's site, not a mapping.
 * An Email Domain entry outranks a Website when the map is built, which is
 * what lets a domain move away from a company whose site it is.
 */
export function remapDomainWrites(prospects = [], domain, target, fallback = '') {
  const d = String(domain || '').trim().toLowerCase();
  if (!d) return [];
  const writes = [];
  const carried = [];
  for (const p of prospects) {
    if (!p || (target && p.id === target.id)) continue;
    const entries = splitEntries(p.emailDomain);
    const kept = entries.filter(e => entryDomain(e) !== d);
    if (kept.length === entries.length) continue;
    carried.push(...entries.filter(e => entryDomain(e) === d));
    writes.push({ prospect: p, emailDomain: kept.join('\n') });
  }
  if (target) {
    const entries = splitEntries(target.emailDomain);
    if (!entries.some(e => entryDomain(e) === d)) {
      const seen = new Set();
      // Carried entries first; a bare domain is only worth adding when
      // nothing more specific came over with it.
      let add = carried.filter(e => {
        const k = e.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (add.some(e => e.includes('@'))) add = add.filter(e => e.includes('@'));
      if (add.length === 0) add = [String(fallback || '').trim() || d];
      writes.push({ prospect: target, emailDomain: [...entries, ...add].join('\n') });
    }
  }
  return writes;
}
