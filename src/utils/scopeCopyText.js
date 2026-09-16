// Turning a Scope selection into text somebody can paste somewhere else.
//
// The Scope picker shows what is in Scope as a strip of chips, and a chip
// is a <button>: you cannot drag-select it, so a 20-service scope that is
// right there on the screen could only be got out of the app by retyping
// it. This builds the text the picker's Copy button puts on the clipboard.
//
// Grouped the way the board is grouped, because the categories are half
// the meaning - "Comp GHG, Strategic sourcing" under Energy Management
// reads as a scope, the same names in one run read as a list of words.
// Commodities lead when there are any, since what the work is about comes
// before what gets done to it.
//
// Import-free, so the format can be pinned under plain Node
// (scripts/scopeCopyText.test.mjs).

/**
 * @param {Array<{category: string, items: Array<{label: string}>}>} groups
 *   The selection, already grouped and ordered - the picker's
 *   `selectedGroups`, so the text lists services in the order the screen
 *   does, under the same headings, with renamed services under the name
 *   the board shows.
 * @param {string[]} [commodities] What this scope is about, if anything.
 * @returns {string} The clipboard text, or '' when nothing is in Scope.
 */
export function scopeCopyText(groups, commodities) {
  const blocks = [];

  const picks = (commodities || []).map(c => String(c || '').trim()).filter(Boolean);
  if (picks.length > 0) blocks.push(`Commodities: ${picks.join(', ')}`);

  for (const group of groups || []) {
    const names = (group?.items || [])
      .map(it => String(it?.label ?? '').trim())
      .filter(Boolean);
    if (names.length === 0) continue;
    const heading = String(group?.category || '').trim();
    // A service with no category heading is still a service: list it
    // rather than dropping it on the floor.
    blocks.push([heading, ...names.map(n => `- ${n}`)].filter(Boolean).join('\n'));
  }

  // Nothing but a commodity line is not a scope worth pasting: the button
  // is disabled in that state, and this keeps the two agreeing.
  if (blocks.length === 0 || (blocks.length === 1 && picks.length > 0)) return '';

  return blocks.join('\n\n');
}
