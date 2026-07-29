# Opps + Dropdowns — Lovable export

A **self-contained** copy of the Prospect Tracker **Opps** and **Dropdowns**
pages, ready to drop into [Lovable](https://lovable.dev) (or run on its own)
and rebuild the UI from.

- **Opps** — the full opportunities table: inline-editable cells, dropdown-linked
  columns (Stage, Source, Scope, Status, Chance?), stage-age tracking, pricing
  options, BFO links, bulk paste-import with duplicate detection, New-Opps
  digest email + schedule modal, and Excel export. Click a contact to open a
  (placeholder) contact card.
- **Dropdowns** — the editor for every dropdown vocabulary the app uses
  (built-in lists, custom lists, per-service questions, stage-age guidance).
  Edits here flow into the Opps table's linked columns.

Everything renders from **bundled sample data** the moment it loads — no
backend, login, or upload required. A top bar switches between the two tabs.

## Run it locally

```bash
npm install
npm run dev
```

Then open the printed URL. For a production build: `npm run build`.

## How this differs from the production app

The real pages talk to Firebase (Auth + Firestore), an IndexedDB cache, and a
set of serverless `/api/*` routes. None of that exists outside the main app, so
a handful of files were replaced with offline stand-ins. **Every stub is marked
`SHIM` or `STUB` at the top of the file**; everything else is a verbatim copy of
the app's source, so the UI and behavior match production.

| Original source | In this export |
| --- | --- |
| **Firebase Auth** (`contexts/AuthContext.jsx`) | STUB — hands every consumer a fixed "demo" admin user |
| **Firebase app init** (`firebase.js`) | STUB — exports empty `db`/`auth` placeholders |
| **`firebase/firestore`** SDK (imported directly by `OppsView2`) | Aliased in `vite.config.js` to `src/stubs/firestore.js` — no-op `doc`/`collection`/`getDocs`/`onSnapshot`, so the real-time sync simply never fires |
| **IndexedDB** wrapper (`utils/db.js`) | SHIM — backed by `localStorage`, so your edits persist across reloads |
| **Opps Firestore store** (`utils/opps2Store.js`) | SHIM — keeps the pure merge logic verbatim; cache reads/writes go to the `db` shim; Firestore calls are no-ops; **seeds the demo dataset** on first load |
| **Serverless API** (`utils/apiFetch.js`) | STUB — returns "not available", so email-send / schedule actions degrade with a clean error instead of crashing |
| **Contact editor** (`components/ProspectModal/ProspectModal.jsx`) | STUB — a lightweight placeholder modal (the real one pulls in a large unrelated subtree) |

### Sample data

`src/data/sampleData.js` holds six demo opportunities spread across stages
(Lead → Sold), with values that match the built-in dropdown lists so the linked
columns show valid selections. The Opps SHIM seeds them into the
`localStorage`-backed cache on first load; your in-demo edits then take
precedence and survive a reload.

- To wipe your edits and re-seed, run in the browser console:
  `import('./data/sampleData.js').then(m => m.resetSampleData())` then reload.

## Stack / dependencies

Plain **React 19 + Vite**. Runtime third-party deps:

- [`exceljs`](https://www.npmjs.com/package/exceljs) — Opps "export skipped
  duplicates" / Excel export (loaded on demand)
- [`xlsx`](https://www.npmjs.com/package/xlsx) (SheetJS) — the shared table's
  spreadsheet parse/export (loaded on demand)

Styling is inline + CSS modules — **no Tailwind**, so if you want Lovable's usual
Tailwind/shadcn look you'll be restyling from this baseline.

## File map

```
opps-dropdowns-export/
  index.html
  vite.config.js                  ← aliases firebase/firestore → the stub
  package.json
  src/
    main.jsx                      ← ReactDOM bootstrap
    OppsDropdownsApp.jsx          ← standalone entry: Opps/Dropdowns tab switcher + props
    firebase.js                   ← STUB
    stubs/firestore.js            ← STUB (aliased no-op firebase/firestore)
    contexts/AuthContext.jsx      ← STUB (demo user)
    components/
      OppsView2/                  ← the Opps page (verbatim)
        OppsView2.jsx
        OppsView2.module.css
        NewOppsScheduleModal.jsx
      DropdownsView/              ← the Dropdowns page (verbatim)
        DropdownsView.jsx
        DropdownsView.module.css
        QuestionsTab.jsx
      ProspectModal/ProspectModal.jsx  ← STUB (lightweight ContactEditModal)
      common/                     ← shared table + column linking (verbatim)
        DataTable.jsx + .module.css
        columnLinks.jsx
    data/                         ← vocabularies (verbatim) + sample data
      dropdownLists.js, enums.js, serviceCatalog.js, serviceQuestions.js,
      emailSignature.js
      sampleData.js               ← NEW: six demo opportunities
    utils/                        ← formatters + stores
      db.js                       ← SHIM (was IndexedDB)
      opps2Store.js               ← SHIM (was Firestore)
      apiFetch.js                 ← STUB (was serverless API)
      (everything else verbatim: pricing, list flags, hubspot cache,
       email table, schedules, backups, …)
```
