// A saved email campaign's Category (the Saved Campaigns table's column):
// free text the user types, with the categories already in use offered as
// suggestions so "Events" doesn't drift into "Event" and "events".
//
// Pure: scripts/campaignCategory.test.mjs runs it under plain Node.

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** A campaign's category as stored, tidied; '' when it has none. */
export function campaignCategory(c) {
  return clean(c?.category);
}

/**
 * The categories in use across `campaigns`, once each, A to Z. Two that
 * differ only in case are one category, spelled the way it was first used.
 */
export function campaignCategoryOptions(campaigns) {
  const seen = new Map();
  for (const c of Array.isArray(campaigns) ? campaigns : []) {
    const cat = campaignCategory(c);
    if (cat && !seen.has(cat.toLowerCase())) seen.set(cat.toLowerCase(), cat);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * What to store for a typed category: tidied, and spelled like an existing
 * one when it matches it but for case, so the suggestions stay one list.
 */
export function normalizeCampaignCategory(typed, options = []) {
  const cat = clean(typed);
  if (!cat) return '';
  return options.find(o => o.toLowerCase() === cat.toLowerCase()) || cat;
}
