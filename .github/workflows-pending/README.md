# Pending workflows

Workflow files staged here because the Claude Code integration that wrote
them cannot push to `.github/workflows/` — GitHub rejects writes to that
directory from an OAuth app without the `workflow` scope:

    ! [remote rejected] refusing to allow an OAuth App to create or update
      workflow `.github/workflows/…` without `workflow` scope

Nothing in this directory runs. GitHub only executes workflows under
`.github/workflows/`, so each file here is inert until moved.

## Activating one

    git mv .github/workflows-pending/firestore-rules.yml .github/workflows/
    git commit -m "Enable the Firestore rules workflow"

That move has to be pushed by a human account (or any credential holding
the `workflow` scope). The file needs no edits — it is complete as written.

The restriction is still in force, and it is not specific to one way of
pushing. Both routes an assistant has were tried on 5 Aug 2026 and both
failed:

* **git push** (OAuth credential) — rejected outright:

        ! [remote rejected] refusing to allow an OAuth App to create or update
          workflow `.github/workflows/firestore-rules.yml` without `workflow` scope

* **GitHub contents API** (`PUT /repos/…/contents/.github/workflows/…`,
  GitHub App installation token) — `404 Not Found`. The path exists and
  the branch exists; GitHub reports a missing `workflows` permission on
  this endpoint as a 404 rather than a 403, so the not-found is the
  permission error, not a bad path.

Two different credentials, two different transports, same wall. Assume
any future assistant hits it too and don't spend another round trip
confirming it — the move needs a human account (or any credential holding
the `workflow` scope).

Once a file is moved, delete its entry below. When this directory is empty,
delete the directory.

## Staged

### `firestore-rules.yml`

Deploys `firestore.rules` on push to `master`, validates it on pull
requests, and can be run manually to redeploy.

**The drift this prevents has already happened.** As of 5 Aug 2026 the
Call Recordings page reads back nothing and reports `Missing or
insufficient permissions.` — the rules granting access to
`callRecordings/{uid}/items` have been in `firestore.rules` since
`1778c72` (4 Aug 2026) but were never released to `tracker-3161a`, so
every read *and write* to that path is denied. Calls sync and appear to
save; nothing persists.

**This workflow is now a second line of defence, not the only one.**
Because it cannot be activated without a human, the release was hung off
the pipeline that does run on every merge: `scripts/deployFirestoreRules.mjs`,
wired in as `prebuild` in `package.json`, publishes `firestore.rules` to
`tracker-3161a` during the Vercel **production** build. It is idempotent
(an unchanged file is a no-op, so it doesn't burn through the 2500-ruleset
cap), it is skipped entirely on preview and local builds so a branch can
never overwrite the live rules, and it never fails the build — a refused
release is logged loudly and the site still deploys.

It reuses `FIREBASE_SERVICE_ACCOUNT_KEY`, the credential the API routes
already use, so there was nothing new to configure. That service account
needs `roles/firebaserules.admin`; if it doesn't have it, the Vercel build
log will say so by name and the rules will simply stay where they are.

To release by hand — right now, or after editing rules without deploying:

    npm run deploy:rules

Same code path, but it reads `.env` as well as the environment and exits
non-zero on failure. Equivalent, if you'd rather use the CLI:

    npx firebase deploy --only firestore:rules --project tracker-3161a

Check Firebase Console → Firestore → Rules first: either command replaces
the deployed ruleset with git's, so any console-only edits are lost.

Activating the workflow below is still worth doing — it adds validation on
pull requests, which the build hook cannot provide (by the time a build
runs, the change is already merged).

**Requires the `FIREBASE_SERVICE_ACCOUNT` secret to exist before it is
activated** — the workflow fails deliberately when the secret is missing,
so activating it first would leave `master` red. The credential check is
the first step that can fail, ahead of validation, so until the secret
exists an activated workflow fails on *pull requests* too, not just on
pushes to `master`. Secret first, move second.

Do it in this order:

1. Create a Google Cloud service account on project `tracker-3161a` with
   the **Firebase Rules Admin** role (`roles/firebaserules.admin`) and
   download a JSON key.
2. Add the whole key file as a repository secret named
   `FIREBASE_SERVICE_ACCOUNT` under Settings → Secrets and variables →
   Actions.
3. Run the `git mv` above and push it from an account with the `workflow`
   scope.
4. The workflow's paths filter includes the workflow file itself, so that
   push is also its own first run — watch it under Actions.

To undo, move the file back here; nothing else needs reverting.

### Validating the rules before then

Until the secret exists there is no CI path that compiles `firestore.rules`,
so a syntax error would only surface on the first real run. To check
locally, start the emulator and hand it the file — the emulator's
`securityRules` endpoint is the same compiler the deploy uses, and returns
real diagnostics:

    firebase emulators:start --only firestore --project demo-tracker

    curl -s -X PUT \
      "http://127.0.0.1:8080/emulator/v1/projects/demo-tracker:securityRules" \
      -H 'Content-Type: application/json' \
      --data "$(jq -Rs '{rules:{files:[{name:"firestore.rules",content:.}]}}' firestore.rules)"

`{}` means it compiled. A failure comes back as HTTP 400 with the line and
column, e.g. `Error compiling rules:\nL4:56 Unexpected ';'.`

Note that `firebase emulators:exec` does **not** validate rules — it starts
cleanly on a file that does not compile — so it is not a substitute for the
above.

### Checked on 5 Aug 2026

- `firestore.rules` as of this commit compiles clean (HTTP 200, no
  diagnostics), verified by the method above and control-tested against a
  deliberately broken file to confirm the check actually catches errors.
- `firebase-tools@15` resolves (15.25.1) and `firebase deploy --dry-run`
  exists in it, as the validate step assumes.
- `.firebaserc` maps `default` to `tracker-3161a`, matching the
  `--project` flag hardcoded in the workflow.
- One caveat from the CLI's own help for `--dry-run`: *"In order to provide
  better validation, this may still enable APIs on the target project."* So
  the PR-triggered job is not purely read-only against `tracker-3161a`.

### `ci.yml`

Runs `npm test` (all 92 files in `scripts/`) and `npm run build` on every
pull request and on pushes to `master`.

**The drift this prevents has already happened, twice.** The repo had 92
test files and nothing that ran them, so they only executed when somebody
remembered to type the filename of the one they had just edited:

* `scripts/dealOppYear1.test.mjs` was broken for a day by a mirrored store
  gaining an extensionless `import './localMirrorSync'` — fine under Vite,
  unresolvable under plain Node. Nothing noticed.
* `scripts/prospectWrites.test.mjs` had **never once run to completion on
  Windows**. It built its scan root with `new URL(...).pathname`, which
  yields `/C:/Users/Dan%20Baldauf/…`, and then compared POSIX paths against
  Windows backslashes — so the one module allowed to touch the prospects
  collection was reported as the offender. The guard had never guarded
  anything on the machine it was written on.

It also runs `scripts/mirroredStores.test.mjs`, which is the enforcement
half of the Firestore mirror: it fails the build when a new store keeps
user data only in the browser without either mirroring it or declaring in
`LOCAL_BY_DESIGN` why losing it is acceptable. That check is the one that
would have caught the Deals roster gap in May 2026, three months before a
"clear cookies and site data" destroyed it.

`npm run lint` is deliberately **not** in the workflow: it reports 594
problems (440 errors) on master today, so gating on it would paint every PR
red on arrival. Add it once that backlog is cleared.
