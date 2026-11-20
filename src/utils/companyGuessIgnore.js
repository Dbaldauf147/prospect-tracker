// The HubSpot page guesses a Table View company name for a contact, either
// from the name already typed on it ("Acme Corp" -> "Acme Corporation") or,
// when it has none, from its email domain ("@acme.com" -> "Acme
// Corporation"). A guess is a property of that pairing rather than of the
// one contact it showed up on, so ignoring it is stored against the pair:
// every contact with the same pairing stops being offered it, including
// ones synced in later.
//
// Stored as settings.ignoredCompanyGuesses, a list of pair keys. A list and
// not a map because the keys carry email domains, and a dot in a map key
// reads as a field path on the way to Firestore.

function lower(v) { return String(v || '').trim().toLowerCase(); }

function emailDomain(email) {
  const e = String(email || '');
  const at = e.lastIndexOf('@');
  return at >= 0 ? e.slice(at + 1).trim().toLowerCase() : '';
}

// What the guess was made from: the typed company name, else the email
// domain (kept apart from names by its leading @).
export function guessSource(contact) {
  const name = lower(contact?.company);
  if (name) return name;
  const domain = emailDomain(contact?.email);
  return domain ? `@${domain}` : '';
}

export function guessPairKey(contact) {
  const guess = lower(contact?.guessedCompany);
  if (!guess) return '';
  return `${guessSource(contact)}=>${guess}`;
}

export function ignoredGuessSet(settings) {
  const list = settings?.ignoredCompanyGuesses;
  return new Set(Array.isArray(list) ? list : []);
}

export function isGuessIgnored(ignored, contact) {
  const key = guessPairKey(contact);
  return !!key && ignored.has(key);
}

// Settings updaters, in the shape updateSettings takes.
export function ignoreGuessesUpdate(keys) {
  return (settings) => {
    const set = ignoredGuessSet(settings);
    const before = set.size;
    for (const k of keys || []) if (k) set.add(k);
    return set.size === before ? null : { ignoredCompanyGuesses: [...set] };
  };
}

export function unignoreGuessUpdate(key) {
  return (settings) => {
    const set = ignoredGuessSet(settings);
    if (!set.delete(key)) return null;
    return { ignoredCompanyGuesses: [...set] };
  };
}

/**
 * The contacts awaiting a guess, rolled up into one row per pairing for
 * the review popup. Biggest groups first, so the mappings that move the
 * most contacts are the ones read first.
 */
export function groupGuessedCompanies(contacts) {
  const groups = new Map();
  for (const c of contacts || []) {
    const key = guessPairKey(c);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      const typed = String(c.company || '').trim();
      const source = guessSource(c);
      g = {
        id: key,
        current: typed || (source ? `(blank) ${source}` : '(blank)'),
        basis: typed ? 'Company name' : 'Email domain',
        guess: String(c.guessedCompany).trim(),
        count: 0,
        contacts: [],
      };
      groups.set(key, g);
    }
    g.count += 1;
    g.contacts.push(c);
  }
  const rows = [...groups.values()];
  for (const g of rows) {
    const names = g.contacts.slice(0, 3).map((c) =>
      [c.firstname, c.lastname].filter(Boolean).join(' ').trim() || c.email || 'Unnamed');
    g.examples = names.join(', ') + (g.count > 3 ? `, +${g.count - 3} more` : '');
  }
  rows.sort((a, b) => b.count - a.count || a.current.localeCompare(b.current));
  return rows;
}
