# Clients + Pricing — standalone export

A **self-contained** copy of the Prospect Tracker **Clients** and **Pricing**
pages, with every subtab, ready to drop into Cursor (or any React project)
and iterate on. It runs entirely in the browser — no backend, login, or
spreadsheet upload required to see it work.

## Pages & subtabs included

**Clients** (`src/components/ClientsView`)
- **Clients** — active clients, expandable per-client contract drill-down,
  editable Client Manager / Status / Notes / flags, soonest-expiration tracking.
- **Old Clients** — same table filtered to `Status = Old Client`.
- **Deals** — the full deals/contracts table (upload, column linking, paste-import).
- **Commissions** — the commissions roster with paste-import.

**Pricing** (`src/components/PricingView`)
- **Pricing** — upload a rate workbook, set a global gross margin, override
  per-line-item GM, tech-depreciation uplift, escalators, and see the summary +
  chart. Includes the **Quick conversions** cards (cost ⇄ revenue ⇄ GM%).
- **Linked To** — per-row solution/tag wiring and defaults.
- **Options** — pricing-option builder.
- **Compare** — side-by-side option comparison.
- **Broker Fees** — broker-fee worksheet.
- **S2C** — sell-to-cost worksheet.
- **Calculator** — a basic four-function calculator plus a Multiply panel.

## Run it

```bash
npm install
npm run dev      # open the printed URL
npm run build    # production build
```

Use the top nav to switch between **Clients** and **Pricing**.

## How this differs from the production app

The real pages authenticate with Firebase and read/write Firestore. Those
dependencies are removed so the export is browser-only. **Only two files are
stubbed**, both clearly marked `STUB` at the top:

| Original source | In this export |
| --- | --- |
| **Firebase Auth / role** (`contexts/AuthContext.jsx`) | Static "signed-in admin" — the pages read `user`; everything else is a no-op |
| **Firestore opportunity sync** (`utils/opps2Store.js`) | Loaders return `null`, savers are no-ops. Both pages tolerate an empty result and render fully |

Files that only existed to serve those two (`firebase.js`, `utils/auditLog.js`,
`utils/secureStorage.js`, `config/accessControl.js`) are **omitted** — nothing
else imports them.

Everything else — all page/subtab components, the shared `DataTable`, and every
calculation/parse/formatter util — is a **verbatim copy** of the app's source,
so the UI and behavior match production.

### Data & persistence

- **Clients** roster comes from bundled sample data (`src/data/sampleData.js` →
  `SAMPLE_PROSPECTS`); every sample matches `SAMPLE_CDM_NAME` (`"Dan Baldauf"`),
  which the page filters on. Deals & commissions seed into `localStorage` on
  first load (call `resetSampleData()` to re-seed).
- **Pricing** starts empty — upload a rate workbook on the Pricing subtab, or
  just explore the Calculator / Quick conversions, which need no data. Pricing
  state persists to **IndexedDB** (`utils/db.js` is the real browser
  implementation, kept as-is).

## Stack

Plain **React 19 + Vite**. Runtime deps: `react`, `react-dom`,
[`xlsx`](https://www.npmjs.com/package/xlsx) (SheetJS — spreadsheet upload/parse)
and [`recharts`](https://recharts.org) (the Pricing summary chart). Styling is
inline + CSS Modules — no Tailwind — so if you want a Tailwind/shadcn look in
Cursor you'll be restyling from this baseline.

## File map

```
src/
  main.jsx                         ReactDOM bootstrap
  App.jsx                          top nav + supplies the props each page needs
  contexts/AuthContext.jsx         STUB (was Firebase auth)
  components/
    ClientsView/                   Clients + Old Clients + Commissions subtabs
    DealsView/                     Deals subtab (+ paste-import)
    PricingView/                   Pricing + all 7 subtabs (+ .module.css each)
    common/                        DataTable (sortable/filterable) + column links
  data/
    dropdownLists.js, enums.js     vocabularies (verbatim)
    sampleData.js                  demo roster / deals / commissions
  utils/                           calculators, parsers, localStorage stores (verbatim)
    db.js                          real IndexedDB layer (Pricing persistence)
    opps2Store.js                  STUB (was Firestore opportunity sync)
```

## Single-file bundle

`CLIENTS-PRICING-BUNDLE.md` contains **every file above** concatenated under
`### path` headings (four-backtick fences), so you can hand the whole export to
Cursor in one paste and ask it to scaffold the tree.
