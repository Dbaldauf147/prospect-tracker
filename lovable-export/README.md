# Clients Page — Lovable export

A **self-contained** copy of the Prospect Tracker "Clients" page, with its
four subtabs:

- **Clients** — your active clients, with an expandable per-client contract
  drill-down, editable Client Manager / Status / Notes / flags, and
  soonest-expiration tracking.
- **Old Clients** — same table, filtered to `Status = Old Client`.
- **Deals** — the full deals/contracts table (upload, column linking, etc.).
- **Commissions** — the commissions roster with paste-import.

Everything renders from **bundled sample data** the moment it loads — no
backend, login, or spreadsheet upload required. This is meant as a starting
point you can drop into [Lovable](https://lovable.dev) and iterate on the UI.

## Run it locally

```bash
npm install
npm run dev
```

Then open the printed URL. To get a clean build:

```bash
npm run build
```

## How this differs from the production app

The real page is wired to three data sources that don't exist outside the
main app. They've been replaced so the page is browser-only:

| Original source | In this export |
| --- | --- |
| **Firestore** prospect roster | Hard-coded `src/data/sampleData.js` → `SAMPLE_PROSPECTS`, passed into `<ClientsView prospects=…>` |
| **Firestore** opportunities (`opps2Store.js`) | Shimmed to return `null` (Deals tab's "linked opp is Sold" warning is the only thing this powers; the table itself is unaffected) |
| **IndexedDB** cache (`db.js` / `oppsCache.js`) | In-memory `Map` shim; reads return empty and the page falls back gracefully |
| **Per-user localStorage** (deals, commissions, client notes/status, column prefs) | **Kept as-is** — these are plain `localStorage` and work in any browser. Sample deals/commissions are seeded on first load. |

Only **two files were rewritten** (`src/utils/db.js` and
`src/utils/opps2Store.js`) — both are clearly marked `SHIM` at the top.
Everything else is a verbatim copy of the app's source, so the UI and
behavior match production.

### Sample data

`src/data/sampleData.js` holds the demo roster, contracts, and commissions.
- Deals & commissions seed into `localStorage` on first load (only if empty,
  so your in-demo edits survive a reload).
- Call `resetSampleData()` from that module to force a re-seed.
- Every sample prospect's CDM matches `SAMPLE_CDM_NAME` (`"Dan Baldauf"`),
  which is what the page filters on.

## Stack / dependencies

Plain **React 19 + Vite**. The only third-party runtime dependency is
[`xlsx`](https://www.npmjs.com/package/xlsx) (SheetJS), used by the Deals tab
for spreadsheet upload/parse. Styling is inline + one CSS module
(`DataTable.module.css`) — no Tailwind, so if you want Lovable's usual
Tailwind/shadcn look you'll be restyling from this baseline.

## File map

```
src/
  ClientsApp.jsx                  ← standalone entry (supplies props ClientsView needs)
  main.jsx                        ← ReactDOM bootstrap
  components/
    ClientsView/
      ClientsView.jsx             ← the page + Clients/Old Clients tables (verbatim)
      CommissionsView.jsx         ← Commissions subtab (verbatim)
      CommissionsPasteImportModal.jsx
    DealsView/
      DealsView.jsx               ← Deals subtab (verbatim)
      PasteImportModal.jsx
    common/
      DataTable.jsx + .module.css ← shared sortable/filterable table (verbatim)
      columnLinks.jsx             ← Dropdowns-list column binding (verbatim)
  utils/                          ← formatters + localStorage stores (verbatim)
    db.js                         ← SHIM (was IndexedDB)
    opps2Store.js                 ← SHIM (was Firestore)
  data/
    dropdownLists.js, enums.js    ← dropdown vocabularies (verbatim)
    sampleData.js                 ← NEW: demo roster / deals / commissions
```
