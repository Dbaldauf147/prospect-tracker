// Hand-corrected company facts on the Corporate Compliance card.
//
// Revenue, employee count and HQ location arrive from research runs, and
// the research is sometimes wrong or simply blank - a private company
// whose revenue nobody publishes, a headcount that counts the wrong
// entity. Those three figures are not decoration: employees gates CSRD's
// 1,000-employee test and revenue drives the SB 253 / SB 261 verdicts, so
// a wrong one is a wrong compliance answer.
//
// An edit is therefore kept SEPARATELY from the research rather than
// written over it. Two reasons, and the second is the one that bites:
//
//   - "Re-run research" would otherwise silently discard the correction,
//     and the whole point of typing it was that the research was wrong;
//   - keeping both means the card can show what was researched alongside
//     what the figure was changed to, so a correction is auditable rather
//     than anonymous.
//
// Pure: no React, no Firestore. The card writes the edits, this decides
// which value wins (scripts/companyFacts.test.mjs).

// Long enough for "$12.5B (FY2024, incl. joint ventures)", short enough
// that a pasted paragraph cannot become a stored figure.
const MAX_TEXT = 120;

/**
 * A typed employee count as a number, or an error saying why not.
 *
 * Empty clears the override and hands the row back to the research, which
 * is the only way to undo an edit - so it is a success, not a rejection.
 *
 * Thousands separators are accepted because the figure is displayed with
 * them: someone correcting "2,000" will type it back the way they see it.
 */
export function parseEmployeesInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: true, value: null };
  const cleaned = s.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) {
    return { ok: false, error: 'Employees must be a whole number, e.g. 2,000.' };
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 1) {
    return { ok: false, error: 'Employees must be at least 1. Clear the box to go back to the researched figure.' };
  }
  // Beyond any real payroll, and past this the figure is a typo that would
  // sail through every headcount threshold on the page.
  if (n > 50_000_000) {
    return { ok: false, error: "That's larger than any workforce on earth: check the digits." };
  }
  return { ok: true, value: n };
}

/**
 * A typed revenue or HQ location as text, or an error.
 *
 * Free text on purpose. Revenue is shown as whatever the research wrote
 * ("$2.1B", "EUR 840m", "not disclosed"), and forcing a number here would
 * make the common corrections unsayable.
 */
export function parseTextInput(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return { ok: true, value: null };
  if (s.length > MAX_TEXT) {
    return { ok: false, error: `Keep it under ${MAX_TEXT} characters.` };
  }
  return { ok: true, value: s };
}

/**
 * Which value the card shows for one fact: the edit when there is one,
 * the researched value otherwise.
 *
 * `edited` is what drives the marker on the card, so it must mean "a
 * person typed this" and not "this has a value". null and '' are both
 * absence - clearing the box is how an edit is undone, and a cleared
 * override must not read as a deliberate blank.
 */
export function resolveFact(edit, researched) {
  const hasEdit = edit !== undefined && edit !== null && edit !== '';
  return {
    value: hasEdit ? edit : (researched ?? null),
    edited: hasEdit,
    // Kept even when the edit wins, so the card can say what was
    // replaced and offer to go back to it.
    researched: researched ?? null,
  };
}

/**
 * Every fact on one company's card, research merged under any edits.
 *
 * `hqLocation` is resolved here alongside the other two even though its
 * research arrives from a different run, so that one call answers "what
 * does this card show" and every caller - the rows, the CSRD prefill, the
 * SB 253 verdict - reads the same resolution.
 */
export function resolveCompanyFacts({ edits = null, revenueResearch = null, hqLocation = '' } = {}) {
  return {
    revenue: resolveFact(edits?.revenue, revenueResearch?.revenue || null),
    employees: resolveFact(
      edits?.employees,
      Number.isFinite(Number(revenueResearch?.employees)) && Number(revenueResearch?.employees) > 0
        ? Number(revenueResearch.employees)
        : null,
    ),
    hqLocation: resolveFact(edits?.hqLocation, String(hqLocation || '').trim() || null),
  };
}
