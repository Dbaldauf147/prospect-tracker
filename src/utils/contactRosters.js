// The contact rosters — Key / Active / Client / Key Prospect — as plain
// functions, so more than one page can ask "which rosters is this contact
// on?" and get the same answer.
//
// Each roster has a dedicated Contacts subtab that owns its own selector,
// and the All Contacts page mirrors all four to build its combined list and
// its Totals pills. Those mirrors used to be written out three times inside
// AllContactsView — once for the live gates, once for the "show hidden"
// probe, once for the pill counts — differing only in whether the Hide tag
// includes or excludes a contact. They live here now, parameterized by that
// one flag, so a change to what "Client" means lands everywhere at once.
//
// Deliberately a util and not a module next to the pages: the Prospecting
// tab reads these gates too, and it's a lazily-loaded chunk that shouldn't
// have to pull the whole contacts page in behind an import.

import { matchesCdm } from './cdmMatch';
import { tagReviewScore } from './contactTagReview';
import { isCancellingForSure } from './serviceCoverage';

// Personal-mail domains are nobody's account domain, so they never stand in
// for a company — a gmail address is matched by company name or not at all.
export const FREE_MAIL = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
]);

// Opp stages that mean the opportunity is finished, and the spreadsheet
// error strings that mean the Stage cell never held one.
const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

// Schneider Electric is the user's own employer — internal coworkers don't
// belong on any roster, so the company name and its email domains are
// excluded however the contact would otherwise have qualified.
const SCHNEIDER_COMPANY_RE = /\bschneider\s*electric\b/i;
const SCHNEIDER_DOMAIN_RE = /(^|\.)(se\.com|schneider-electric\.com|schneider\.com)$/i;
export function isSchneiderContact(c) {
  if (SCHNEIDER_COMPANY_RE.test(String(c?.company || ''))) return true;
  const email = String(c?.email || '').toLowerCase().trim();
  const at = email.lastIndexOf('@');
  if (at >= 0) {
    const domain = email.slice(at + 1).trim();
    if (SCHNEIDER_DOMAIN_RE.test(domain)) return true;
  }
  return false;
}

// HubSpot hands activity timestamps back as either an ISO string or epoch
// millis depending on the property, so try both.
export function parseHubspotDate(v) {
  if (!v) return NaN;
  const ts = Date.parse(v);
  if (!Number.isNaN(ts)) return ts;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// The contact's email domain, or '' when there isn't a usable one. Free-mail
// addresses return '' because they can't identify an account.
function accountDomain(c) {
  const email = String(c?.email || '').toLowerCase().trim();
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  const domain = email.slice(at + 1).trim();
  return domain && !FREE_MAIL.has(domain) ? domain : '';
}

// How a contact reads in a list: their name, falling back to the email
// when HubSpot has no name on the record (imported rows often don't), and
// finally to a placeholder so a row is never blank and unclickable.
export function contactDisplayName(c) {
  const name = `${String(c?.firstname || '').trim()} ${String(c?.lastname || '').trim()}`.trim();
  if (name) return name;
  const email = String(c?.email || '').trim();
  return email || '(no name)';
}

function tagsOf(c) {
  return String(c?.dans_tags || c?.dan_s_tags || c?.dans_tag || '').toLowerCase();
}

// Cheap fuzzy company-name compare, used where an opp's Account or a
// prospect's company is spelled differently from the contact's HubSpot
// Company text (suffixes, abbreviations). Note the Active Contacts page
// keeps a stricter variant of its own — the two are not interchangeable.
export function rosterCompaniesMatch(a, b) {
  const na = String(a || '').toLowerCase().trim();
  const nb = String(b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa && sb && (sa === sb || sa.includes(sb) || sb.includes(sa))) return true;
  return false;
}

// Every email domain an account record claims — its Email Domain field
// (which may list several) and its Website.
export function collectClientDomains(p, into) {
  if (!p) return;
  if (p.emailDomain) {
    for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
      const at = entry.lastIndexOf('@');
      const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
      if (d) into.add(d);
    }
  }
  if (p.website) {
    const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
    if (d) into.add(d);
  }
}

// A contact is "active" when at least one HubSpot email-activity timestamp
// (sent / replied / opened / clicked / last contacted) sits inside the
// chosen window. Window of 0 → any timestamp present. Schneider coworkers,
// "Dan Key Target"-tagged contacts, and contacts whose company is already a
// current Client are all filtered so the Active page shows only people who
// don't already live on Key Contacts or Client Contacts. The selector can be
// inverted (`mode = 'hidden'`) to surface ONLY hide-tagged active contacts
// so the user can review what's been suppressed.
export function makeActiveSelector(windowDays, mode = 'visible', { clientCompanies = [], clientDomains = new Set() } = {}) {
  const cutoff = windowDays > 0 ? Date.now() - windowDays * 86400000 : null;
  return (c) => {
    const tags = tagsOf(c);
    const hidden = tags.includes('hide');
    if (mode === 'hidden') {
      if (!hidden) return false;
    } else {
      if (hidden) return false;
      // Contacts tagged "Left" belong on the Changed Jobs tab, not here —
      // even if HubSpot still shows recent activity from before they
      // departed.
      if (tags.includes('left')) return false;
      if (tags.includes('dan key target')) return false;
    }
    if (isSchneiderContact(c)) return false;
    // Drop client-company contacts so they don't double up with the Client
    // Contacts tab. Match strictly 1:1 on company name (so a "Marriott
    // International" contact doesn't get suppressed because a "Marriott"
    // Client prospect exists), with email-domain match as a fallback when
    // the contact has no company text.
    if (clientCompanies.length || clientDomains.size) {
      const company = String(c.company || '').trim();
      const companyLower = company.toLowerCase();
      if (company && clientCompanies.some(name => String(name || '').toLowerCase().trim() === companyLower)) return false;
      if (!company) {
        const domain = accountDomain(c);
        if (domain && clientDomains.has(domain)) return false;
      }
    }
    const fields = [
      c.hs_email_last_send_date,
      c.hs_sales_email_last_replied,
      c.hs_email_last_open_date,
      c.hs_email_last_click_date,
      c.notes_last_contacted,
    ];
    for (const v of fields) {
      const ts = parseHubspotDate(v);
      if (Number.isNaN(ts)) continue;
      if (cutoff === null) return true;
      if (ts >= cutoff) return true;
    }
    return false;
  };
}

// The window the All Contacts rollup runs the Active gate over. The Active
// tab itself lets the user pick; the rollup is fixed so the pill counts
// don't move under a setting that lives on another page.
const ROLLUP_ACTIVE_WINDOW_DAYS = 90;

// The rosters, in the order the Totals pills read, with the colours the
// pills and the Category column already use.
export const ROSTER_CATEGORIES = [
  { key: 'key', label: 'Key', bg: '#FEF3C7', border: '#FCD34D', color: '#92400E' },
  { key: 'active', label: 'Active', bg: '#DCFCE7', border: '#86EFAC', color: '#166534' },
  { key: 'client', label: 'Client', bg: '#DBEAFE', border: '#93C5FD', color: '#1E3A8A' },
  { key: 'keyProspect', label: 'Key Prospect', bg: '#EDE9FE', border: '#C4B5FD', color: '#5B21B6' },
];

// The rosters a "tags still to map" count is taken over.
//
// Active is deliberately out: it's a rolling window of whoever has been in
// touch lately rather than a book you work through, so its contacts arrive
// and leave on their own and it would never read as done. `all` is out too —
// it's the union of the others, so counting it would count the same debt
// twice.
export const TAG_DEBT_ROSTERS = ROSTER_CATEGORIES.filter(r => r.key !== 'active');

// Which of those rosters still has tagging to finish, given a
// rosterTagCoverage result. One entry per roster, however many contacts are
// behind it — the count answers "how many groups am I not done with", not
// "how many people".
//
// A roster with no contacts has no tagging to be missing: rosterTagCoverage
// reports `pct: null` there rather than 0, and null is not a debt.
//
// Shared between the Prospecting page, which prints it next to the Tagged
// row, and the sidebar badge — one definition, or the two numbers drift.
export function missingTagRosters(coverage) {
  if (!coverage) return [];
  return TAG_DEBT_ROSTERS.filter(r => {
    const pct = coverage[r.key]?.pct;
    return pct != null && pct < 100;
  });
}

// A contact with the user's manual Company override applied, when there is
// one. The override is what the contacts table shows and what its own
// filtering runs on, so a roster gate that skipped it would disagree with
// the page the user is looking at.
export function applyCompanyOverride(c, localFields) {
  const lf = localFields?.[String(c?.id || c?.vid || '')];
  const override = lf && typeof lf._companyOverride === 'string' ? lf._companyOverride : '';
  return override ? { ...c, company: override } : c;
}

/**
 * The roster gates for one dataset.
 *
 * `showHidden` flips every Hide check: false (the default) gives the gates
 * as the dedicated tabs run them, true gives the inverted "review what's
 * been suppressed" set. Everything else is derived from the Table View
 * prospects, the opps records, and the Clients tab's status map.
 *
 * Returns the four gates plus `clientExclusionOf` (the Clients-tab flag that
 * takes a contact off all of them, or '' for none), a `rosterSelector` that
 * ORs the four, and `categorize`, which names the rosters a contact lands
 * on.
 */
export function makeRosterGates({
  prospects = [],
  cdmName = '',
  oppsRecords = null,
  clientStatusMap = {},
  clientUntrackedMap = {},
  showHidden = false,
} = {}) {
  const rows = prospects || [];

  // ---- Accounts left off every roster --------------------------------
  // Two Clients-tab flags take an account's people off all four rosters:
  //
  //   Cancelling for Sure (Status)  the account is on its way out
  //   Don't Track                   the account isn't being worked at all
  //
  // Either way it isn't an account to work today, so its contacts don't
  // belong on a roster of who to work. Matched by name and by the account's
  // email domains, since a contact's HubSpot Company text is usually spelled
  // differently from the account. Kept apart by reason so a page can say
  // which flag took a contact out — and which one to change to get them
  // back.
  const excluded = {
    cancelling: { companies: new Set(), domains: new Set() },
    untracked: { companies: new Set(), domains: new Set() },
  };
  for (const p of rows) {
    const key = String(p?.company || '').trim().toLowerCase();
    if (!key) continue;
    const bucket = isCancellingForSure(clientStatusMap?.[key]) ? excluded.cancelling
      : clientUntrackedMap?.[key] ? excluded.untracked
      : null;
    if (!bucket) continue;
    bucket.companies.add(key);
    collectClientDomains(p, bucket.domains);
  }
  const matchesSet = (c, set) => {
    if (set.companies.size === 0 && set.domains.size === 0) return false;
    const company = String(c?.company || '').trim().toLowerCase();
    if (company && set.companies.has(company)) return true;
    const domain = accountDomain(c);
    return !!domain && set.domains.has(domain);
  };
  // Which flag takes this contact out, or '' when nothing does. One string
  // rather than a predicate per flag, so a caller can gate and attribute in
  // a single pass.
  const clientExclusionOf = (c) => {
    if (matchesSet(c, excluded.cancelling)) return 'cancelling';
    if (matchesSet(c, excluded.untracked)) return 'untracked';
    return '';
  };

  // Shared opening gate: hidden-or-not per `showHidden`, never someone who
  // has left, never a coworker.
  const passesBaseGate = (c) => {
    const tags = tagsOf(c);
    const hidden = tags.includes('hide');
    if (showHidden ? !hidden : hidden) return false;
    if (tags.includes('left')) return false;
    return !isSchneiderContact(c);
  };

  // ---- Active gate (mirror of ActiveContactsView) -------------------
  // Build the same client-company exclusion set the Active page uses, so a
  // contact whose company is a current Client doesn't get pushed out of the
  // Active bucket here when the same user would still see them on the
  // Client tab. The contact stays in if it matches Key OR Client OR Active
  // anyway.
  const activeClientCompanies = [];
  const activeClientDomains = new Set();
  for (const p of rows) {
    if (p.status !== 'Client') continue;
    if (p.company) activeClientCompanies.push(p.company);
    collectClientDomains(p, activeClientDomains);
  }
  const baseActive = makeActiveSelector(
    ROLLUP_ACTIVE_WINDOW_DAYS,
    showHidden ? 'hidden' : 'visible',
    { clientCompanies: activeClientCompanies, clientDomains: activeClientDomains },
  );

  // Companies (raw-cased) with at least one open opp. Matches
  // KeyContactsView's requireActiveOpp derivation so the Active gate here
  // lines up with the dedicated page's count.
  const activeOppCompanies = [];
  {
    const seen = new Set();
    for (const r of (oppsRecords || [])) {
      const stage = String(r['Stage'] || '').trim();
      if (!stage || INVALID_STAGES.has(stage) || CLOSED_STAGES.has(stage)) continue;
      const acct = String(r['Account'] || '').trim();
      const k = acct.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      activeOppCompanies.push(acct);
    }
  }
  const isActive = (c) => {
    if (!baseActive(c)) return false;
    const cName = String(c.company || '').trim();
    if (!cName) return false;
    const lc = cName.toLowerCase();
    if (activeOppCompanies.some(a => a.toLowerCase() === lc)) return true;
    return activeOppCompanies.some(a => rosterCompaniesMatch(a, cName));
  };

  // ---- Client gate (mirror of ClientContactsView) -------------------
  // Old Client wins over Client, so a contact at a former client doesn't
  // come back in through a near-name match to a current one.
  const clientProspects = rows.filter(p => p.status === 'Client' && matchesCdm(p.cdm, cdmName));
  const oldClientProspects = rows.filter(p => p.status === 'Old Client');
  const clientDomains = new Set();
  for (const p of clientProspects) collectClientDomains(p, clientDomains);
  const oldClientDomains = new Set();
  for (const p of oldClientProspects) collectClientDomains(p, oldClientDomains);
  const isClient = (c) => {
    if (!passesBaseGate(c)) return false;
    const company = String(c.company || '').trim();
    const companyLower = company.toLowerCase();
    const domain = accountDomain(c);
    if (company && oldClientProspects.some(p => String(p.company || '').toLowerCase().trim() === companyLower)) return false;
    if (domain && oldClientDomains.has(domain)) return false;
    if (company && clientProspects.some(p => String(p.company || '').toLowerCase().trim() === companyLower)) return true;
    return !company && !!domain && clientDomains.has(domain);
  };

  // ---- Key gate (the Key Contacts page's own default) ---------------
  const isKey = (c) => passesBaseGate(c) && tagsOf(c).includes('dan key target');

  // ---- Key Prospect gate (mirror of KeyProspectsView) ---------------
  // A contact is a "Key Prospect" when it's tagged Decision Maker at a
  // Tier 1 / Tier 2 account on this CDM whose company has no opps yet.
  const myTierAccounts = rows.filter(p => {
    if (!matchesCdm(p.cdm, cdmName)) return false;
    // Clients aren't prospects — keep them out of the Key Prospect bucket.
    if (p.status === 'Client') return false;
    const t = String(p.tier || '').toLowerCase();
    return t === 'tier 1' || t === 'tier 2';
  });
  const allOppAccounts = new Set();
  for (const r of (oppsRecords || [])) {
    const acct = String(r['Account'] || '').trim().toLowerCase();
    if (acct) allOppAccounts.add(acct);
  }
  const allOppAccountsArr = [...allOppAccounts];
  // Map<lowercase company, { tier, hasOpp }> for the Tier 1/2 accounts.
  const tierAccountStatus = new Map();
  for (const p of myTierAccounts) {
    const lc = String(p.company || '').toLowerCase().trim();
    if (!lc) continue;
    let hasOpp = allOppAccounts.has(lc);
    if (!hasOpp) {
      for (const acct of allOppAccountsArr) {
        if (rosterCompaniesMatch(p.company, acct)) { hasOpp = true; break; }
      }
    }
    tierAccountStatus.set(lc, { tier: p.tier, hasOpp });
  }
  const isAtUntouchedTierAccount = (c) => {
    const company = String(c.company || '').trim();
    if (!company) return false;
    const direct = tierAccountStatus.get(company.toLowerCase());
    if (direct) return !direct.hasOpp;
    for (const p of myTierAccounts) {
      if (rosterCompaniesMatch(p.company, company)) {
        const status = tierAccountStatus.get(String(p.company || '').toLowerCase().trim());
        if (status) return !status.hasOpp;
      }
    }
    return false;
  };
  const isKeyProspect = (c) => {
    if (!passesBaseGate(c)) return false;
    if (!tagsOf(c).includes('decision maker')) return false;
    return isAtUntouchedTierAccount(c);
  };

  // Roster gate — a contact passes when it would land on at least one of
  // the dedicated rosters and isn't at an account the Clients tab flags as
  // cancelling or Don't Track. The exclusion sits above the individual
  // gates, so it holds however the contact would otherwise have qualified.
  const rosterSelector = (c) => !clientExclusionOf(c)
    && (isKey(c) || isActive(c) || isClient(c) || isKeyProspect(c));

  const gateFor = { key: isKey, active: isActive, client: isClient, keyProspect: isKeyProspect };
  const categorize = (c) => ROSTER_CATEGORIES
    .filter(({ key }) => gateFor[key](c))
    .map(({ label }) => label);

  return {
    isKey, isActive, isClient, isKeyProspect,
    clientExclusionOf, rosterSelector, categorize, gateFor,
  };
}

/**
 * Per-roster contact counts and tag-review coverage, in one pass.
 *
 * For each roster (plus `all`, the de-duped union) this reports how many
 * contacts are on it, how many tag questions they carry between them
 * (`slots` — one contact × one scored tag), how many of those have an
 * answer, how many contacts are fully worked through (`done`), and the
 * resulting percentage.
 *
 * Each roster also carries `people`: one row per contact on it, least-tagged
 * first, holding the display fields, that contact's own answered/total, and
 * the HubSpot record itself under `contact` — so a caller can both list the
 * people behind a percentage and open one of them.
 *
 * The per-contact score is the same one the All Contacts "Tagged %" column
 * and the contact popup's header show (see contactTagReview.js). Summing the
 * raw answered/slots counts rather than averaging per-contact percentages
 * keeps a group of 400 from being swung by one contact.
 *
 * Contacts at cancelling and Don't Track clients are counted separately
 * under `cancelling` and `untracked`, and left out of every roster, for the
 * same reason they're off the rosters themselves. A roster with no contacts
 * reports `pct: null` — "nothing to answer for" is not 0%.
 */
export function rosterTagCoverage({ contacts = [], gates, tagReviewMap = {}, localFields = null }) {
  const empty = () => ({ contacts: 0, answered: 0, slots: 0, done: 0, people: [] });
  const buckets = { all: empty() };
  for (const { key } of ROSTER_CATEGORIES) buckets[key] = empty();
  const left = { cancelling: 0, untracked: 0 };
  if (!gates) return finalizeCoverage(buckets, left);

  for (const baseC of contacts) {
    const c = localFields ? applyCompanyOverride(baseC, localFields) : baseC;
    const hits = ROSTER_CATEGORIES.filter(({ key }) => gates.gateFor[key](c));
    if (!hits.length) continue;
    // Counted, not tallied into the rosters: how many each account exclusion
    // took out. A page that quietly shrinks is worse than one that says what
    // it left behind.
    const why = gates.clientExclusionOf(c);
    if (why) { left[why] += 1; continue; }
    // Scored once, then credited to every roster the contact is on — someone
    // who is both Key and Client counts toward both figures, exactly as the
    // contact counts do.
    const cid = c?.id ?? c?.vid;
    const score = tagReviewScore(c, cid == null ? null : tagReviewMap[String(cid)]);
    // The same row object goes into every bucket the contact is on: the
    // people behind a percentage are the point of the percentage, and
    // collecting them here rather than in a second pass is what keeps the
    // list and the number describing the same set of contacts.
    const person = {
      id: cid == null ? null : String(cid),
      name: contactDisplayName(c),
      company: String(c?.company || '').trim(),
      email: String(c?.email || '').trim(),
      answered: score.answered,
      total: score.total,
      done: score.done,
      // The record itself, so a list built from this coverage can open the
      // contact popup on a name rather than send the user to another tab to
      // find the same person again. A reference, not a copy: these contacts
      // are already in memory behind the cache this ran over. Company
      // overrides are already applied — this is the contact as the contacts
      // pages show it, which is the one the popup should edit.
      contact: c,
    };
    for (const { key } of [...hits, { key: 'all' }]) {
      const b = buckets[key];
      b.contacts += 1;
      b.answered += score.answered;
      b.slots += score.total;
      if (score.done) b.done += 1;
      b.people.push(person);
    }
  }
  return finalizeCoverage(buckets, left);
}

function finalizeCoverage(buckets, left) {
  const out = { ...left };
  for (const [key, b] of Object.entries(buckets)) {
    // Least-tagged first, then alphabetical. The list hangs off a coverage
    // percentage, so the contacts that percentage is waiting on are the ones
    // worth putting at the top; a finished roster falls back to plain
    // alphabetical order, which is how you look someone up.
    const people = b.people.slice().sort((x, y) => (
      (x.answered - x.total) - (y.answered - y.total)
      || x.name.localeCompare(y.name)
    ));
    out[key] = { ...b, people, pct: b.slots > 0 ? Math.round((b.answered / b.slots) * 100) : null };
  }
  return out;
}
