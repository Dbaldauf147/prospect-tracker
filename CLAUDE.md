# Prospect Tracker — working notes

## Git workflow

**Every requested change ships as its own PR.** For each user request that produces code changes:

1. Create a fresh feature branch off the latest `master`. Use `claude/<short-kebab-slug>` for the name — pick a slug that describes the change (e.g. `claude/csrd-column-width`, `claude/gas-uom-mwh`).
2. Commit on that branch and push it with `git push -u origin <branch>`.
3. Open the PR. Prefer the GitHub API (`mcp__github__create_pull_request`) when it's available; if it fails (e.g. "not authorized to use this Copilot feature"), fall back to printing the compare URL: `https://github.com/Dbaldauf147/prospect-tracker/pull/new/<branch>`.
4. **Merge it yourself** (`mcp__github__merge_pull_request`) once the work is verified — the user asked for this rather than being handed a link each time. Report the merge commit instead. Verification doesn't get lighter for being faster: build, lint, and check the actual behaviour before pushing. If CI is red, the branch conflicts, or the change turns out riskier than it looked, fix that first rather than merging and explaining afterwards. Still stop and ask on anything destructive or genuinely ambiguous.
5. Don't push directly to `master` — the remote rejects it (HTTP 403). Everything lands through a PR.

Branches stay one-PR-per-change so each fix can be reviewed and merged independently — don't pile unrelated changes onto a previous branch.
