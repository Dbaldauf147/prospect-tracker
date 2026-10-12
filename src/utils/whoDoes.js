// "Who does ___ at this company?" on the company popup's Contacts tab.
//
// The questions are one standard list (settings.whoDoesQuestions), written
// once and asked of every company. Under each, per company:
//
//   - Suggestions by title: HubSpot contacts whose job title carries one
//     of the question's keywords. Those already on the company's Contacts
//     tab are the likely answer and read as such; close matches that are
//     not on it yet (same email domain, or a Company starting with the
//     same name) come with "+ Add", which links them to the company.
//   - People the company named (prospect.whoDoesNamed[questionId]), typed
//     in as they were given, each with "+ Add" until they are on the tab.
//
// Pure: no React, no settings writes, so it can be tested on its own.

const text = (v) => String(v ?? '').trim();
const idOf = (c) => text(c?.id ?? c?.vid);
const lc = (v) => text(v).toLowerCase();

export const nameOf = (c) => [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim() || text(c?.email);

/** A question's keywords, from the comma / semicolon list it was saved as. */
export function keywordsOf(question) {
  const raw = Array.isArray(question?.keywords) ? question.keywords.join(',') : text(question?.keywords);
  return raw.split(/[,;\n]+/).map(k => k.trim().toLowerCase()).filter(Boolean);
}

/** Whether a contact's job title carries any of the keywords (whole words or phrases). */
export function titleMatches(contact, keywords) {
  const title = ` ${lc(contact?.jobtitle).replace(/[^a-z0-9]+/g, ' ')} `;
  if (!title.trim()) return false;
  return (keywords || []).some((k) => {
    const kk = k.replace(/[^a-z0-9]+/g, ' ').trim();
    return kk && title.includes(` ${kk} `);
  });
}

// The first word of a company name long enough to mean something on its
// own ("Brookfield" in "Brookfield Asset Management"), for the loose match.
function leadWord(company) {
  const w = lc(company).replace(/^the\s+/, '').split(/[^a-z0-9]+/).find(Boolean) || '';
  return w.length >= 4 ? w : '';
}

function domainOf(email) {
  const e = lc(email);
  const at = e.lastIndexOf('@');
  return at >= 0 ? e.slice(at + 1) : '';
}

/**
 * The title suggestions for one question at one company:
 *   { onTab: contacts[], toAdd: contacts[] }
 * `onTab` are the company's own contacts (its Contacts tab) whose title
 * matches; `toAdd` are other HubSpot contacts that look like they belong
 * here (email on one of `domains`, or a Company starting with the same
 * lead word) and whose title matches, minus anyone removed from this
 * company by hand (`excludedIds`). Hidden-tagged contacts are left out.
 */
export function titleSuggestions({ question, company, companyContacts = [], allContacts = [], domains = [], excludedIds = [], limit = 8 } = {}) {
  const keywords = keywordsOf(question);
  if (!keywords.length) return { onTab: [], toAdd: [] };
  const hidden = (c) => /\bhide\b/i.test(text(c?.dans_tags || c?.dan_s_tags || c?.dans_tag));
  const onTabIds = new Set(companyContacts.map(idOf).filter(Boolean));
  const excluded = new Set((excludedIds || []).map(String));
  const domainSet = new Set((domains || []).map(lc).filter(Boolean));
  const lead = leadWord(company);

  const onTab = companyContacts.filter(c => !hidden(c) && titleMatches(c, keywords));
  const toAdd = [];
  for (const c of allContacts) {
    const id = idOf(c);
    if (!id || onTabIds.has(id) || excluded.has(id) || hidden(c)) continue;
    if (!titleMatches(c, keywords)) continue;
    const near = (domainSet.size && domainSet.has(domainOf(c.email)))
      || (lead && leadWord(c.company) === lead);
    if (near) toAdd.push(c);
    if (toAdd.length >= limit) break;
  }
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
  return { onTab: onTab.sort(byName), toAdd: toAdd.sort(byName) };
}

/**
 * The company contact a named person already is, or null: matched on
 * email when one was given, else on the full name.
 */
export function namedOnTab(person, companyContacts = []) {
  const email = lc(person?.email);
  const name = lc(person?.name);
  return companyContacts.find(c => (email && lc(c.email) === email) || (!email && name && lc(nameOf(c)) === name)) || null;
}

/** A named person as a new-contact draft for the Add Contact popup. */
export function namedToDraft(person, company) {
  const parts = text(person?.name).split(/\s+/).filter(Boolean);
  return {
    company: text(company),
    firstname: parts[0] || '',
    lastname: parts.slice(1).join(' '),
    email: text(person?.email),
    jobtitle: text(person?.title),
    phone: '', mobilephone: '', hs_linkedin_url: '', dans_tags: '',
  };
}

/** A fresh id for a new question. */
export function newQuestionId() {
  return `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
