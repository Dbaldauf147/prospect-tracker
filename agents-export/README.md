# Agents — Prospect Tracker export

A **self-contained** copy of the Prospect Tracker **Agents** page, ready to
drop into an editor like [Cursor](https://cursor.com) (or run on its own) and
rebuild the UI from. Everything renders from **bundled sample data** the moment
it loads — no backend, login, or upload required.

The Agents page is the AI-assistant control panel. It turns the day's opps +
activity into copy-paste prompts you hand to a browser-automation assistant
(the kind that drives Salesforce / BFO for you). It has two sub-tabs:

- **Automations** — the default view. It surfaces:
  - **Activity** — today's outbound emails + logged calls + meetings (pulled
    from HubSpot in the real app), each auto-matched to the opportunity it
    belongs to, with an inline picker to fix a wrong/missing match.
  - **AI BFO Prep** — tagged opps still missing their BFO (Salesforce) record
    link, with an inline cell to paste it.
  - **Marketing Leads** / **Marketing Lead Status Update** — leads that need a
    Salesforce link, or whose status has drifted from Salesforce.
  - A stack of **AI Prompt** generators — Activity, New BFO Opp, Close Dates,
    Amount Updates, Stage Change, Close Not Solds, Update BFO Activity — each
    rendering an editable prompt + a live data table, with one-click "Copy full
    prompt".
- **Prompt Library** — a searchable, reorderable store of reusable prompts you
  can title, edit, and copy.

## Run it locally

```bash
npm install
npm run dev
```

Then open the printed URL. For a production build: `npm run build && npm run preview`.

## How this differs from the production app

The real page reads from Firebase (Auth + Firestore), several IndexedDB caches,
the HubSpot sync, and a set of serverless `/api/*` routes. None of that exists
outside the main app, so a handful of files were replaced with offline
stand-ins. **Every stub is marked `SHIM` or `STUB` at the top of the file**;
everything else — including `AgentsView.jsx` itself — is a **verbatim copy** of
the app's source, so the UI and behavior match production.

| Original source | In this export |
| --- | --- |
| **Agents page** (`components/AgentsView/AgentsView.jsx` + `.module.css`) | Verbatim copy — the real component, unchanged |
| **Firebase Auth** (`contexts/AuthContext.jsx`) | STUB — hands every consumer a fixed "demo" admin user |
| **Firebase app init** (`firebase.js`) | STUB — exports empty `db`/`auth` placeholders |
| **`firebase/firestore`** SDK (imported by `OppsView2`, which supplies the read-only opp-detail modal) | Aliased in `vite.config.js` to `src/stubs/firestore.js` — no-op `doc`/`collection`/`getDocs`/`onSnapshot` |
| **IndexedDB** wrapper (`utils/db.js`) | SHIM — backed by `localStorage`, so your edits persist across reloads |
| **Opps Firestore store** (`utils/opps2Store.js`) | SHIM — keeps the pure merge logic verbatim; Firestore calls are no-ops; **seeds the opps roster** on first load |
| **Serverless API** (`utils/apiFetch.js`) | STUB — returns "not available", so the HubSpot "Refresh Activity" button degrades with a clean error instead of crashing |
| **Contact editor** (`components/ProspectModal/ProspectModal.jsx`) | STUB — a lightweight placeholder modal |

The **HubSpot "Refresh Activity & Opps"** button hits a backend that isn't part
of the export, so it will report the feature as unavailable — the activity it
would fetch is already seeded (see below).

## Sample data

`src/data/sampleData.js` holds the whole demo dataset and seeds every browser
cache the page reads. On first load you get a fully-populated page:

- **7 opportunities** across stages (Lead → Contracting, plus a Not-Sold) — some
  tagged to a BFO opportunity, some still needing one.
- **HubSpot contacts** mapping each recipient to a company.
- **Today's activity** — 4 outbound emails + 1 meeting, all from the demo work
  email (`dan.baldauf@se.com`), so the Activity table + prompts light up.
- **Pasted BFO Activity rows** (the Salesforce printable-view paste) with Sales
  Stage / Close Date / Amount, so the Close Dates / Amount / Stage / Close
  Not Solds prompts have rows to act on.
- **Marketing leads** (in `settings`) + a **Leads subtab** paste, so both
  marketing-lead agents surface work.

The opps roster is seeded lazily by the `opps2Store` SHIM; everything else is
seeded once, on first load, by `seedAgentsDemo()` in `sampleData.js`. After
that your in-app edits persist locally and take precedence.

- To wipe everything and re-seed fresh, run in the browser console:
  `import('./data/sampleData.js').then(m => m.resetSampleData())` then reload.

## Stack / dependencies

Plain **React 19 + Vite**. Runtime third-party deps:

- [`exceljs`](https://www.npmjs.com/package/exceljs) / [`xlsx`](https://www.npmjs.com/package/xlsx)
  — pulled in transitively by the bundled `OppsView2` (loaded on demand); the
  Agents page itself doesn't call them.

Styling is a global `src/index.css` (theme tokens) + CSS modules + inline styles
— **no Tailwind**, so if you want a Tailwind/shadcn look you'll be restyling
from this baseline.

## File map

```
agents-export/
  index.html
  vite.config.js                  ← aliases firebase/firestore → the stub
  package.json
  src/
    main.jsx                      ← ReactDOM bootstrap (+ imports index.css)
    index.css                     ← global theme tokens (--color-*, --radius-*, …)
    AgentsApp.jsx                 ← standalone entry: seeds data, supplies props
    firebase.js                   ← STUB
    stubs/firestore.js            ← STUB (aliased no-op firebase/firestore)
    contexts/AuthContext.jsx      ← STUB (demo user)
    components/
      AgentsView/                 ← THE page (verbatim)
        AgentsView.jsx
        AgentsView.module.css
      OppsView2/                  ← supplies the read-only opp-detail modal (verbatim)
        OppsView2.jsx + .module.css
        NewOppsScheduleModal.jsx
      ProspectModal/ProspectModal.jsx  ← STUB
      common/                     ← shared table + column linking (verbatim)
        DataTable.jsx + .module.css
        columnLinks.jsx
    data/                         ← vocabularies (verbatim) + sample data
      dropdownLists.js, enums.js, serviceCatalog.js, serviceQuestions.js,
      emailSignature.js
      sampleData.js               ← NEW: opps + contacts + activity + BFO seeds
    utils/                        ← formatters + stores
      db.js                       ← SHIM (was IndexedDB)
      opps2Store.js               ← SHIM (was Firestore)
      apiFetch.js                 ← STUB (was serverless API)
      oppsCache.js, salesforceLeads.js, hubspotContactsCache.js, …  ← verbatim
```
