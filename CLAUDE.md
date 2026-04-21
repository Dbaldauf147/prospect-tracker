# Prospect Tracker — working notes

## Git workflow

**Push directly to `master` (the default branch).** The user has explicitly opted out of the feature-branch + PR flow — no more `claude/*` branches, no more pull requests. Commit and push straight to `master` so changes land on the live app immediately.

If a PR is ever needed (unusual changes, larger refactors), confirm with the user first.
