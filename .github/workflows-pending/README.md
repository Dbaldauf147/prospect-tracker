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

Once a file is moved, delete its entry below. When this directory is empty,
delete the directory.

## Staged

### `firestore-rules.yml`

Deploys `firestore.rules` on push to `master`, validates it on pull
requests, and can be run manually to redeploy.

**Requires the `FIREBASE_SERVICE_ACCOUNT` secret to exist before it is
activated** — the workflow fails deliberately when the secret is missing,
so activating it first would leave `master` red. Create a Google Cloud
service account on project `tracker-3161a` with the **Firebase Rules
Admin** role (`roles/firebaserules.admin`), download a JSON key, and add
the whole file as a repository secret named `FIREBASE_SERVICE_ACCOUNT`
under Settings → Secrets and variables → Actions.
