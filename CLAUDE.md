# Prospect Tracker — working notes

## Git workflow

**Every requested change ships as its own PR.** For each user request that produces code changes:

1. Create a fresh feature branch off the latest `master`. Use `claude/<short-kebab-slug>` for the name — pick a slug that describes the change (e.g. `claude/csrd-column-width`, `claude/gas-uom-mwh`).
2. Commit on that branch and push it with `git push -u origin <branch>`.
3. Open the PR. Prefer the GitHub API (`mcp__github__create_pull_request`) when it's available; if it fails (e.g. "not authorized to use this Copilot feature"), fall back to printing the compare URL: `https://github.com/Dbaldauf147/prospect-tracker/pull/new/<branch>`.
4. **Merge it yourself** (`mcp__github__merge_pull_request`) once the work is verified — the user asked for this rather than being handed a link each time. Report the merge commit instead. Verification doesn't get lighter for being faster: build, lint, and check the actual behaviour before pushing. If CI is red, the branch conflicts, or the change turns out riskier than it looked, fix that first rather than merging and explaining afterwards. Still stop and ask on anything destructive or genuinely ambiguous.
5. Don't push directly to `master` — the remote rejects it (HTTP 403). Everything lands through a PR.
6. **Space out merges to `master`: at least 5 minutes between them.** Every merge triggers a Vercel production deploy, and back-to-back merges made Vercel's GitHub fetch hit GitHub's secondary rate limit (403, deploy of #2834 failed before building). If several PRs are ready at once, merge one, keep working on the next, and merge it once the gap has passed rather than landing them in a burst. If a deploy does fail on that rate limit, don't push an empty commit to retrigger it; the next spaced-out merge deploys everything, or Dan can hit Redeploy in Vercel.

Branches stay one-PR-per-change so each fix can be reviewed and merged independently — don't pile unrelated changes onto a previous branch.


## "Dan's column formatting" (the default for every table)

When Dan asks for **Dan's column formatting**, and for **any new table by
default** whether or not he asks, the table's columns are:

1. **Width editable** - drag a header's right edge; widths are saved.
2. **Starrable** - a star marks a column as one of the user's default
   columns; starring shows it, and Reset / "★ Defaults" brings back exactly
   the starred set.
3. **Toggleable** - each column can be switched on and off from the
   Columns menu.
4. **Orderable** - drag to reorder (header or the menu's ⠿ handle).
5. **Presets** - "+ Save current" stores the columns showing now, in their
   order, under a name; clicking that preset's chip shows exactly those
   columns again.
6. **Searchable, pickable filter** - a box under each header searches the
   column as you type; its drop-down lists the column's values (only those
   the other columns' filters leave on screen, with row counts) as
   checkboxes, so you can tick one or several to filter to exactly those.
   "Select all" / Enter ticks everything the search matches. Filters are
   per session, not saved.

Items 1-5 are saved per user and synced through `settings.tablePrefs[tableId]`
so the layout follows Dan to his other machine.

How to get it:

- **Use the shared `DataTable`** (`src/components/common/DataTable.jsx`)
  with a stable `tableId` and `settings`/`updateSettings` passed in. It has
  all six built in (presets come through `ColumnToggle`; the filter row is
  on by default, `enableColumnFilters={false}` turns it off).
- **A table that draws its own markup** wires the same pieces: widths, order
  and hidden through `useSyncedTablePref` (or `useTableColumnPrefs`),
  presets through `useColumnPresets` + `<ColumnPresets>` with the rules in
  `src/utils/columnPresets.js`. The company popup's Portfolio Companies
  table (`ProspectModal.jsx`, `PORTFOLIO_PREFS_TABLE_ID`) is the reference
  example. Its filter row is `ColumnFilterCell` from `DataTable.jsx`
  with the pick-list rules in `src/utils/columnFilter.js`
  (`pickFilterMatches`, `pickListOptions`); PE Portfolio is the example.

## No em dashes on the site

**Nothing the app shows may contain an em dash (`—`, U+2014).** Not in
labels, tooltips, placeholders, headings, empty-cell dashes, error
messages, or the emails the app sends. Use a hyphen, a comma, or two
sentences.

This is enforced: `scripts/noEmDash.test.mjs` scans every non-comment
character of `src/` and `api/` and fails the suite on a violation, so it
cannot drift back in.

Two exceptions, both narrow:

- **Code comments are exempt.** They are notes between the people working
  on this and are never shown to anybody using the app, so the existing
  house style stands.
- **Code that READS an em dash** out of text somebody else wrote (a news
  headline, a pasted spreadsheet cell) keeps the character, because there
  it is data rather than voice. Mark the line `// em-dash-ok: <why>`.
  There are five such lines today; adding a sixth should feel like a
  decision.

En dashes (`–`) are untouched by this: they separate the two ends of a
range (`$3,906 – $4,340`, `Mon, Sep 7 – Sun, Sep 13`) and that is a
different character doing a different job.
