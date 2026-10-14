// Every ✓ the Bulk Add Contacts table is offering, as one list of actions.
//
// The table draws a suggestion per cell with a ✓ beside it, which is the
// right unit when a drop holds three of them and the wrong one when a drop
// of 175 contacts lights up two hundred: the answer is the same for every
// row, and it takes two hundred clicks to say it. This turns the same
// decisions into a list one button can run.
//
// It has to be the SAME decisions. A count that doesn't match what the eye
// can see on the rows is worse than no count, so the rules below mirror the
// cells exactly - a cell showing a value the prospect already has offers no
// ✓, and neither does a dismissed one - and every read they need is passed
// in rather than re-derived here, so there is one source for what a
// suggestion IS.
//
// Pure, so the rules can be pinned without a browser
// (scripts/bulkSuggestionActions.test.mjs).

// The Table View columns that carry a suggestion, in the order the table
// shows them.
export const TV_SUGGESTION_FIELDS = ['website', 'zoomCompanyId', 'zoomCompanyName', 'emailDomain'];

const trimmed = (v) => String(v ?? '').trim();

// How a raw Company is keyed in the saved mapping rules: case and runs of
// whitespace don't make a different company.
export const companyRuleKey = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Whether a row's Company is already the company being suggested.
 *
 * Compared as text, not as characters. Table View names carry stray
 * whitespace - "CBRE Investment Management " is one of them - and an exact
 * `===` made those rows unfixable: applying the suggestion wrote the name,
 * the cell compared the written name against the untrimmed original, found
 * them different, and left the yellow pill sitting there. The suggestion
 * had taken; the page said it had not.
 *
 * Case still counts. "cbre" and "CBRE" are the same company but not the
 * same name, and fixing the casing is exactly what the ✓ is for.
 */
export function companyTextEquals(a, b) {
  return trimmed(a) === trimmed(b);
}

/**
 * The pending suggestions across `rows`, in row order.
 *
 * Two kinds come back, because the two halves of the table write to two
 * different places and a caller has to tell them apart:
 *
 *   { kind: 'company',  email, from, to }
 *       the Suggested Company pill - a change to the row in the grid, which
 *       reaches HubSpot only when the user sends it.
 *   { kind: 'prospect', prospect, prospectId, field, value, source }
 *       a Table View column - a write to the matched prospect record, which
 *       lands immediately. `source` is 'suggestion' for an uploaded or
 *       inferred value and 'useCompany' for the Zoom Name shortcut that
 *       copies the prospect's own company name.
 *
 * Deduped per prospect and field: a drop with eight contacts at one company
 * offers the same Website ✓ eight times, and writing it eight times is
 * eight writes to say one thing.
 */
export function pendingSuggestionActions(rows, read = {}) {
  const {
    suggestedCompanyFor = () => '',
    companyDismissed = () => false,
    prospectFor = () => null,
    tvStateFor = () => null,
    suggestionFor = () => null,
    tvDismissed = () => false,
  } = read;

  const actions = [];
  const seen = new Set();

  for (const row of rows || []) {
    const to = trimmed(suggestedCompanyFor(row));
    // "Already the company on the row" is what the cell reads as `applied`,
    // and there is nothing left to apply about it.
    if (to && !companyTextEquals(row?.company, to) && !companyDismissed(row)) {
      actions.push({ kind: 'company', email: row.email, from: row.company, to });
    }

    const prospect = prospectFor(row);
    const tv = tvStateFor(row);
    // No matched prospect is no record to write to - the cell's ✓ is
    // disabled there, so this has nothing to offer either.
    if (!prospect || !tv) continue;

    for (const field of TV_SUGGESTION_FIELDS) {
      const key = `${prospect.id}::${field}`;
      if (seen.has(key) || tvDismissed(prospect.id, field)) continue;
      const existing = trimmed(tv.has?.[field]);
      const sugg = suggestionFor(prospect.id, field);
      const value = trimmed(sugg?.value);
      if (value) {
        // A field the prospect already answers shows that answer rather
        // than a suggestion. Email Domain is the exception: it holds a list,
        // so a new address pattern is added to what is there.
        if (existing && field !== 'emailDomain') continue;
        seen.add(key);
        actions.push({
          kind: 'prospect', prospect, prospectId: prospect.id, field, value, source: 'suggestion',
          origin: sugg?.origin || '',
        });
        continue;
      }
      // Nothing suggested, but the prospect's own company name is a Table
      // View name and the Zoom Name is empty: the cell offers it as "Use
      // Company", so this does too.
      if (field === 'zoomCompanyName' && !existing) {
        const own = trimmed(prospect.company);
        if (!own) continue;
        seen.add(key);
        actions.push({
          kind: 'prospect', prospect, prospectId: prospect.id, field, value: own, source: 'useCompany',
        });
      }
    }
  }
  return actions;
}

/** The actions split the way the confirm prompt and the status line count them. */
export function summarizeSuggestionActions(actions = []) {
  const companies = actions.filter(a => a.kind === 'company');
  const prospectWrites = actions.filter(a => a.kind === 'prospect');
  return {
    total: actions.length,
    companies: companies.length,
    prospectFields: prospectWrites.length,
    prospects: new Set(prospectWrites.map(a => a.prospectId)).size,
  };
}

/**
 * The company actions grouped the way they become mapping rules: one
 * entry per raw Company, with every target it is being sent to.
 *
 * A rule is keyed by the raw Company alone, but a suggestion is worked out
 * per row (mostly off the email domain), so two rows that both say
 * "Principal" can be pointed at two different Table View companies. Saving
 * a rule for each, one after the other, is the bug this exists to stop:
 * the first rule rewrote every "Principal" row in the grid to its target,
 * the second overwrote the first, and rows nobody had touched (dismissed,
 * filtered out, or bound for the other company) ended up wherever the last
 * write left them. So a rule is saved only when the raw Company has one
 * target (`ruleSafe`); otherwise each row still takes its own suggestion
 * and no rule is written.
 *
 *   [{ key, from, ruleSafe, targets: [{ to, emails: [...] }] }]
 *
 * In first-seen order, so the list reads in the same order as the table.
 */
export function groupCompanyMappings(actions = []) {
  const byKey = new Map();
  for (const a of actions) {
    if (a.kind !== 'company') continue;
    const key = companyRuleKey(a.from);
    let g = byKey.get(key);
    if (!g) {
      g = { key, from: trimmed(a.from), targets: [] };
      byKey.set(key, g);
    }
    let t = g.targets.find(x => x.to === a.to);
    if (!t) {
      t = { to: a.to, emails: [] };
      g.targets.push(t);
    }
    t.emails.push(a.email);
  }
  return Array.from(byKey.values()).map(g => ({
    ...g,
    // A blank Company has nothing to key a rule on, and a raw name already
    // equal to its target (bar case) is not a mapping either.
    ruleSafe: !!g.key && g.targets.length === 1 && g.key !== g.targets[0].to.toLowerCase(),
  }));
}
