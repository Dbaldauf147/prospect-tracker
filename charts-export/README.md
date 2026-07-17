# Charts — standalone export

A **self-contained** copy of the Prospect Tracker **Charts** page and its three
subtabs, ready to drop into Cursor (or any React project). Runs entirely in the
browser — no backend, login, or Firebase project required.

## Subtabs included

- **YOY** (`src/components/YOYView`) — year-over-year charts, workbook-driven
  (upload a spreadsheet to populate; renders its empty state until then).
- **Progress** (`src/components/ProgressView`) — progress/decision-maker
  coverage charts, driven by the prospect roster.
- **Pipeline** (`src/components/PipelineView`) — pipeline metrics tables and
  the New-Opps-by-Month view, workbook-driven.

## Run it

```bash
npm install
npm run dev      # open the printed URL
npm run build    # production build
```

The three subtabs sit behind the tab bar at the top of the page.

## How this differs from the production app

The real page authenticates with Firebase and reads/writes Firestore. Those are
removed so the export is browser-only. What was changed:

| Original | In this export |
| --- | --- |
| **Firebase Auth / role** (`contexts/AuthContext.jsx`) | Static "signed-in" stub |
| **`firebase.js`** (SDK init) | Stub exporting empty `db` / `auth` |
| **`firebase/firestore`** (imported directly by Progress + list-backup) | Aliased in `vite.config.js` to a local no-op shim (`src/stubs/firestore.js`) |
| **Opps Google Sheet auto-fetch** (`utils/oppsSheetUrl.js`) | Stubbed to return null — the page skips the fetch and does **not** embed anyone's private sheet. Set `settings.oppsSheetUrl` to re-enable it against your own sheet |

Files that only served auth (`utils/auditLog.js`, `utils/secureStorage.js`,
`config/accessControl.js`) are **omitted** — nothing else imports them.

Everything else — all three subtab components and every calc/parse/format/store
util — is a **verbatim copy** of the app's source, so behavior matches production.

### Data & persistence

- The prospect roster comes from bundled sample data (`src/data/sampleData.js` →
  `SAMPLE_PROSPECTS`; every sample matches `SAMPLE_CDM_NAME`, `"Dan Baldauf"`).
- **YOY** and **Pipeline** are workbook-driven — upload a spreadsheet on the tab
  to populate their charts/tables (same as production). Until then they show
  their normal empty state.
- Uploaded lists and per-user settings persist to **IndexedDB / localStorage**
  (real, in-browser). The Firestore cloud-mirror is a no-op.

## Stack

Plain **React 19 + Vite**. Runtime deps: `react`, `react-dom`,
[`recharts`](https://recharts.org) (the charts) and
[`xlsx`](https://www.npmjs.com/package/xlsx) (SheetJS — spreadsheet upload/parse).
Styling is inline + CSS Modules — no Tailwind.

## File map

```
src/
  main.jsx                       ReactDOM bootstrap
  App.jsx                        supplies the props ChartsView needs
  contexts/AuthContext.jsx       STUB (was Firebase auth)
  firebase.js                    STUB (was Firebase SDK init)
  stubs/firestore.js             no-op firebase/firestore (aliased in vite.config.js)
  components/
    ChartsView/                  the tab host (YOY / Progress / Pipeline)
    YOYView/                     YOY subtab (+ .module.css)
    ProgressView/                Progress subtab
    PipelineView/                Pipeline subtab (+ .module.css)
  data/
    enums.js                     vocabularies (verbatim)
    sampleData.js                demo roster
  utils/                         chart calc + parsers + localStorage/IDB stores (verbatim)
    oppsSheetUrl.js              STUB (was the Opps Google Sheet URL)
    listBackupSync.js            verbatim (its Firestore calls hit the no-op shim)
```

## Single-file bundle

`CHARTS-BUNDLE.md` contains **every file above** concatenated under `### path`
headings (four-backtick fences), so you can hand the whole export to Cursor in
one paste and ask it to scaffold the tree.
