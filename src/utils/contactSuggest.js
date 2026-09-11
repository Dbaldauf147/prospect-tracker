// Finding a contact to add, by typing any part of who they are.
//
// A campaign's roster is built one address at a time, and the address is the
// one thing nobody remembers: you know you want Drew at Jamestown, not that
// he is dgadigian@ or d.gadigian@ or drew.g@. So the box that adds contacts
// searches the HubSpot contacts this browser has already cached — the same
// cache the Company column reads — and offers the people it finds.
//
// Matched on name, email AND company, because all three are ways somebody
// arrives at the same person: "drew", "jamestown", "@nb.com". Prefix matches
// rank ahead of substring ones, which is what somebody typing the start of a
// name they half remember is producing.
//
// Free text is still the point and is never taken away: a contact HubSpot
// has never heard of is added by typing their address, which is how every
// address got into a campaign before this. Everything here is pure —
// contacts in, ranked matches out (scripts/contactSuggest.test.mjs).

/** An address, normalized the way the campaign roster normalizes one. */
export function normContactEmail(email) {
  return String(email || '').toLowerCase().trim();
}

/**
 * A contact's name as a person would write it, falling back to the readable
 * half of their address ("dgadigian@jamestownlp.com" → "Dgadigian") so a row
 * never renders nameless.
 */
export function contactName(c) {
  const name = [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim();
  if (name) return name;
  const explicit = String(c?.name || '').trim();
  if (explicit) return explicit;
  const local = String(c?.email || '').split('@')[0];
  if (!local) return '';
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}

// How well one contact answers to what was typed: 0 no match, 1 substring,
// 2 prefix. Name, email and company are all checked, and the best of them
// wins — someone found by the start of their company is as findable as
// someone found by the start of their name.
function scoreContact(c, q) {
  const fields = [contactName(c), String(c?.email || ''), String(c?.company || '')];
  let best = 0;
  for (const f of fields) {
    const lower = f.toLowerCase();
    if (!lower) continue;
    if (lower.startsWith(q)) return 2;
    if (lower.includes(q)) best = 1;
  }
  return best;
}

/**
 * The contacts worth offering for what has been typed, best first.
 *
 * `exclude` is the addresses already in the campaign: someone already on the
 * roster is not somebody to add, and offering them is offering an action
 * that answers "that email is already in the campaign".
 *
 * A contact with no email is dropped — this list exists to put an address in
 * a box, and a row that can't is a row that wastes a line of it.
 *
 * Deduped by address: the cache can hold the same person twice (a manual
 * contact and the synced one), and the campaign only cares about the
 * address. The first spelling seen wins, so the row reads the way the
 * contact record does.
 *
 * Capped, because the cache holds thousands and a list longer than the
 * screen is not a list anybody reads. An empty (or one-character) query
 * offers nothing at all: "everything we have ever heard of" is not a
 * suggestion, and this box has to stay usable as a plain text field.
 */
export function matchContacts(contacts, query, { exclude = [], limit = 8, minChars = 2 } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  if (q.length < minChars) return [];
  const skip = new Set((exclude || []).map(normContactEmail).filter(Boolean));
  const seen = new Set();
  const hits = [];
  for (const c of (contacts || [])) {
    const email = String(c?.email || '').trim();
    const key = normContactEmail(email);
    if (!key || skip.has(key) || seen.has(key)) continue;
    const score = scoreContact(c, q);
    if (!score) continue;
    seen.add(key);
    hits.push({
      id: c?.id ?? key,
      email,
      name: contactName(c),
      company: String(c?.company || '').trim(),
      score,
    });
  }
  // Prefix matches first, then alphabetically by name so the order is stable
  // between renders rather than however the cache happened to be written.
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  return hits.slice(0, limit);
}

/**
 * Is what has been typed a list rather than a name?
 *
 * The box takes several addresses at once, separated by ; or , — pasting a
 * list is a real way to fill a campaign. There is nothing to suggest for a
 * list, and half-matching the last fragment of one would offer to replace
 * what was pasted, so suggestions simply stand down.
 */
export function isAddressList(query) {
  return /[;,]/.test(String(query ?? ''));
}
