# Charts Page — single-file bundle for Cursor

This document contains **every source file** of the self-contained Charts export,
each under a `### path` heading in a four-backtick fenced block (so files that
themselves contain triple-backticks still render correctly). Recreate the same folder
structure — or paste into Cursor and ask it to scaffold these files — then run
`npm install && npm run dev`. Read the embedded README first for what was stubbed vs.
copied verbatim.

**File index:**

- `README.md`
- `package.json`
- `index.html`
- `vite.config.js`
- `src/main.jsx`
- `src/App.jsx`
- `src/components/ChartsView/ChartsView.jsx`
- `src/components/PipelineView/PipelineView.jsx`
- `src/components/PipelineView/PipelineView.module.css`
- `src/components/ProgressView/ProgressView.jsx`
- `src/components/YOYView/YOYView.jsx`
- `src/components/YOYView/YOYView.module.css`
- `src/contexts/AuthContext.jsx`
- `src/data/enums.js`
- `src/data/sampleData.js`
- `src/firebase.js`
- `src/stubs/firestore.js`
- `src/utils/cdmMatch.js`
- `src/utils/clientIssues.js`
- `src/utils/clientManagerStore.js`
- `src/utils/commissionsStore.js`
- `src/utils/companyIndex.js`
- `src/utils/companyNorm.js`
- `src/utils/db.js`
- `src/utils/dealClientMap.js`
- `src/utils/dealCommissions.js`
- `src/utils/dealsFormat.js`
- `src/utils/dealsStore.js`
- `src/utils/hubspotContactsCache.js`
- `src/utils/listBackupSync.js`
- `src/utils/oppsCache.js`
- `src/utils/oppsSheetUrl.js`
- `src/utils/pipelineWorkbook.js`
- `src/utils/quotedProjectionsStore.js`
- `src/utils/uploadedListStore.js`
- `src/utils/userLs.js`
- `src/utils/yoyHiddenChartsStore.js`
- `src/utils/yoyOverridesStore.js`

### README.md

````markdown
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
````

### package.json

````json
{
  "name": "charts-export",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "recharts": "^2.15.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^6.0.1",
    "vite": "^8.0.1"
  }
}
````

### index.html

````html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Charts — standalone export</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
````

### vite.config.js

````javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The Progress subtab (and the list-backup util) import a few functions
// straight from `firebase/firestore` to persist per-user settings. This
// export is fully offline, so we alias that import to a local no-op stub
// (src/stubs/firestore.js). Nothing else from the firebase SDK is used —
// `firebase.js` is a stub — so `firebase` isn't a dependency at all.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'firebase/firestore': fileURLToPath(new URL('./src/stubs/firestore.js', import.meta.url)),
    },
  },
});
````

### src/main.jsx

````jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
````

### src/App.jsx

````jsx
import { useState, useEffect } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { ChartsView } from './components/ChartsView/ChartsView';
import { seedSampleData, SAMPLE_PROSPECTS, SAMPLE_CDM_NAME } from './data/sampleData';

// Standalone shell for the Charts page and its three subtabs
// (YOY / Progress / Pipeline).
//
// In the full app these get their props from a top-level layout (Firestore
// prospects, the signed-in user's CDM name, a shared settings object).
// Here we supply all of that locally:
//   - prospects       → the hard-coded SAMPLE_PROSPECTS roster
//   - cdmName         → SAMPLE_CDM_NAME (matches every sample prospect)
//   - settings        → an in-component object + merge setter
//   - onSelectProspect→ logs the pick (there's no prospect modal in this export)
//
// The YOY / Pipeline tabs are workbook-driven: they render their normal
// empty state until you upload a spreadsheet, exactly like production.
// Progress renders from the sample roster.
export default function App() {
  const [settings, setSettings] = useState({});
  const updateSettings = (patch) => setSettings((prev) => ({ ...prev, ...patch }));

  useEffect(() => { seedSampleData(); }, []);

  return (
    <AuthProvider>
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#F8FAFC',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <ChartsView
          prospects={SAMPLE_PROSPECTS}
          cdmName={SAMPLE_CDM_NAME}
          settings={settings}
          updateSettings={updateSettings}
          onSelectProspect={(p) => console.log('select prospect', p?.company)}
        />
      </div>
    </AuthProvider>
  );
}
````

### src/components/ChartsView/ChartsView.jsx

````jsx
import { lazy, Suspense, useState } from 'react';
import { PipelineView } from '../PipelineView/PipelineView';

// YOY and Progress are heavy and were already code-split at the App
// level; keep them lazy here so opening Charts only pulls in the tab
// the user actually views.
const YOYView = lazy(() => import('../YOYView/YOYView').then(m => ({ default: m.YOYView })));
const ProgressView = lazy(() => import('../ProgressView/ProgressView').then(m => ({ default: m.ProgressView })));

const TABS = [
  { key: 'yoy', label: 'YOY' },
  { key: 'progress', label: 'Progress' },
  { key: 'pipeline', label: 'Pipeline' },
];

// Host for the "Charts" top-level tab: YOY / Progress / Pipeline as
// sub-tabs. Each sub-view still renders its own full-height layout, so
// this just stacks a thin sub-tab bar above the active one.
export function ChartsView({ prospects, settings, cdmName, onSelectProspect }) {
  const [tab, setTab] = useState('yoy');
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', borderBottom: '1px solid #E2E8F0', padding: '0.5rem 1rem 0', flexShrink: 0 }}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: active ? '2px solid #2563EB' : '2px solid transparent',
                color: active ? '#2563EB' : '#64748B',
                fontSize: '0.85rem',
                fontWeight: 700,
                padding: '0.5rem 0.9rem',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'yoy' && (
          <Suspense fallback={<div className="loading">Loading view…</div>}>
            <YOYView />
          </Suspense>
        )}
        {tab === 'progress' && (
          <Suspense fallback={<div className="loading">Loading view…</div>}>
            <ProgressView prospects={prospects} settings={settings} cdmName={cdmName} />
          </Suspense>
        )}
        {tab === 'pipeline' && <PipelineView prospects={prospects} cdmName={cdmName} settings={settings} onSelectProspect={onSelectProspect} />}
      </div>
    </div>
  );
}
````

### src/components/PipelineView/PipelineView.jsx

````jsx
// Pipeline dashboard — recreation of the Excel pipeline-metrics
// summary. Every numeric cell is editable; goals and actuals are
// stored together in a single IndexedDB record keyed `current` so
// the layout persists across reloads.

import { Component, createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './PipelineView.module.css';
import { dbGet, dbPut, dbDelete } from '../../utils/db';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { loadDealsList } from '../../utils/dealsStore';
import { loadDealClientMap } from '../../utils/dealClientMap';
import { loadClientManagerMap, loadClientUntrackedMap, loadClientStatusMap } from '../../utils/clientManagerStore';
import { computeExpiringClients, normClientName } from '../../utils/clientIssues';
import { matchesCdm } from '../../utils/cdmMatch';
import { SERVICE_CATEGORIES } from '../../data/enums';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';
import { downloadPipelineWorkbook } from '../../utils/pipelineWorkbook';
import { loadList as loadUploadedList } from '../../utils/uploadedListStore';
import { normalizeCompany, pickNameKey } from '../../utils/companyNorm';
import { userLsGet } from '../../utils/userLs';

// Uploaded Strategic Accounts list — same storageKey the Lists tab uses.
const STRATEGIC_STORAGE_KEY = 'strategic-accounts-override';

// Contracts expiring within this many days feed the Pipeline "Client
// Renewals" table — mirrors the Clients tab's renewal-warning threshold.
const RENEWAL_WINDOW_DAYS = 270;

const STORE = 'pipeline-dashboard';
const KEY = 'current';
const BFO_STORE = 'bfo-activity';
const BFO_KEY = 'current';

// The Opps tab's BFO Opportunity Name lives in the column whose data key is
// still "BFO Link" (the visible label was renamed). New opps are seeded with a
// dash placeholder and sheet imports leave #N/A — neither is a real name, so
// treat them as empty. Mirrors bfoOppName in BFOActivityView.
const BFO_BLANK_SENTINELS = new Set(['', '-', '#n/a', 'n/a']);
function bfoOppNameOf(r) {
  const v = String(r?.['BFO Link'] || '').trim();
  return BFO_BLANK_SENTINELS.has(v.toLowerCase()) ? '' : v;
}

// Best-effort "opened" timestamp for an Opps row (ms, or NaN when it can't be
// placed on the calendar). Age fields go stale between paste-imports, so we
// prefer, in order:
//   1. The opp's Start Date column when it parses as a real date.
//   2. Otherwise Age interpreted at import time (ageRef − Age days); closed
//      opps (Sold / Not Sold) count back from their Close Date instead.
// Shared by the past-30-days and by-month new-opp tallies.
function oppOpenTs(r, ageRef) {
  const startRaw = String(r['Start Date'] || '').trim();
  if (startRaw) {
    const ts = Date.parse(startRaw);
    if (!Number.isNaN(ts)) return ts;
  }
  const age = Number(String(r.Age ?? '').replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(age) || age < 0) return NaN;
  const stage = (r.Stage || '').trim();
  if (stage === 'Sold' || stage === 'Not Sold') {
    const closeTs = Date.parse(r['Close Date'] || '');
    if (Number.isNaN(closeTs)) return NaN;
    return closeTs - age * 86400000;
  }
  return ageRef - age * 86400000;
}

// Parse "USD 15,000.00" / "$15,000" / "15000" -> 15000.
function parseMoney(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Pull the leading stage digit from values like "6 - Negotiate to..."
// Match BFO rows to the same Sales Stage labels the Excel formulas
// hard-code, so the website's totals line up with the spreadsheet.
//
//   Stage 6 active count   = COUNTIFS(K, "6 - Negotiate to Win")
//   Stage 5 active count   = COUNTIFS(K, "5 - Prepare & Bid")
//   Stage 4 active count   = COUNTIFS(K, "4 - Influence and Develop")
//   Stage 3 active count   = COUNTIFS(K, "3 - Qualify Opportunity")
//   Stage 6 deal size      = AVERAGEIFS(U, U "<>80000", K "6 - Negotiate to Win")
//   Other stages deal size = AVERAGEIFS(U, K "<stage label>")
//   Total deal size        = AVERAGE(U)         (every numeric amount)
//   Stage pipeline (sum)   = SUMIFS(U, K "<stage label>")
const STAGE_LABEL = {
  6: /^\s*6\s*-\s*negotiate\s*to\s*win\b/i,
  5: /^\s*5\s*-\s*prepare\s*&?\s*bid\b/i,
  4: /^\s*4\s*-\s*influence\s*and\s*develop\b/i,
  3: /^\s*3\s*-\s*qualify\s*opportunity\b/i,
};
// Amount values that should be ignored when averaging Stage 6 deal
// size (template default placeholder).
const STAGE_6_DEAL_SIZE_EXCLUDE = 80000;

// The "next move" an opp trips when it sits in a stage past its max target
// age (the Avg Opp Life "Goal (less than)" for that stage). Mirrors the
// STAGE_AGE_GUIDANCE next-move copy so a stalled Stage 4 reads "Quote or kill"
// and a stalled Stage 5 reads "Contract or kill". Stage 6 has no kill move.
const STAGE_KILL_FLAG = {
  3: 'Qualify or kill',
  4: 'Quote or kill',
  5: 'Contract or kill',
  6: null,
};

function matchStage(stageVal) {
  const s = String(stageVal ?? '');
  for (const n of [3, 4, 5, 6]) {
    if (STAGE_LABEL[n].test(s)) return n;
  }
  // Fallback: leading digit match if the label drifts (e.g. truncated).
  const m = s.match(/^\s*([3-6])\b/);
  return m ? Number(m[1]) : null;
}

// Aggregate BFO rows -> { 3: …, 4: …, 5: …, 6: …, all: { allAmtAvg } }.
function bfoStageMetrics(bfo) {
  const out = { 3: null, 4: null, 5: null, 6: null, all: { allAmtAvg: null } };
  if (!bfo || !bfo.headers || !bfo.rows || bfo.rows.length === 0) return out;
  const findCol = (re) => bfo.headers.find(h => re.test(h));
  const stageCol = findCol(/sales\s*stage|^stage$/i);
  const amountCol = findCol(/^amount$/i);
  const ageCol = findCol(/^age$/i);
  const accountCol = findCol(/^account\s*name$/i) || findCol(/^account$/i);
  const oppCol = findCol(/opportunity\s*name|^opportunity$/i);
  const scopeCol = findCol(/^scope$/i);
  if (!stageCol) return out;
  const buckets = {};
  let allAmtSum = 0;
  let allAmtCount = 0;
  for (const r of bfo.rows) {
    const n = matchStage(r[stageCol]);
    if (!n || n < 3 || n > 6) continue;
    const amt = amountCol ? parseMoney(r[amountCol]) : null;
    const age = ageCol ? Number(String(r[ageCol]).replace(/[^0-9.\-]/g, '')) : null;
    if (!buckets[n]) buckets[n] = { count: 0, total: 0, ageSum: 0, ageCount: 0, amtSum: 0, amtCount: 0, rows: [] };
    buckets[n].count += 1;
    // Keep the contributing row so hover breakdowns can list exactly
    // which BFO opps fed each live cell.
    buckets[n].rows.push({
      account: accountCol ? String(r[accountCol] ?? '').trim() : '',
      oppName: oppCol ? String(r[oppCol] ?? '').trim() : '',
      scope: scopeCol ? String(r[scopeCol] ?? '').trim() : '',
      amount: amt,
      age: Number.isFinite(age) ? age : null,
      excludedFromAvg: n === 6 && amt === STAGE_6_DEAL_SIZE_EXCLUDE,
    });
    if (amt !== null) {
      buckets[n].total += amt;
      // Stage 6 averaging excludes the $80k template placeholder.
      if (!(n === 6 && amt === STAGE_6_DEAL_SIZE_EXCLUDE)) {
        buckets[n].amtSum += amt;
        buckets[n].amtCount += 1;
      }
      // Total deal size (Excel row-8 formula) averages every amount,
      // including stage 6's placeholder.
      allAmtSum += amt;
      allAmtCount += 1;
    }
    if (Number.isFinite(age)) { buckets[n].ageSum += age; buckets[n].ageCount += 1; }
  }
  for (const n of [3, 4, 5, 6]) {
    const b = buckets[n];
    if (!b) { out[n] = null; continue; }
    out[n] = {
      count: b.count,
      total: b.total,
      avg: b.amtCount ? b.amtSum / b.amtCount : null,
      avgAge: b.ageCount ? Math.round(b.ageSum / b.ageCount) : null,
      amtCount: b.amtCount,
      ageCount: b.ageCount,
      rows: b.rows,
    };
  }
  out.all = { allAmtAvg: allAmtCount ? allAmtSum / allAmtCount : null };
  return out;
}

const DEFAULT_STATE = {
  // User overrides for the fixed table titles / headers / row labels, keyed by
  // the <EL id="…">. Empty means every label shows its code default.
  labels: {},

  // Pipeline metrics by stage. Each stage row is a dict of values.
  stages: [
    { key: 's6', label: 'Stage 6',                       activeGoal: 3,  activeActual: 4,  dealSizeGoal: 125000, dealSizeActual: 58952,  pipelineGoal: 375000,  pipelineActual: 235806,  closeGoal: 0.75, closeActual: 0.50, targetProj: 281250, lifeGoal: 200, lifeActual: 212 },
    { key: 's5', label: 'Stage 5',                       activeGoal: 12, activeActual: 6,  dealSizeGoal: 125000, dealSizeActual: 52146,  pipelineGoal: 1500000, pipelineActual: 578831,  closeGoal: 0.40, closeActual: 0.11, targetProj: 600000, lifeGoal: 150, lifeActual: 68 },
    { key: 's4', label: 'Stage 4',                       activeGoal: 15, activeActual: 13, dealSizeGoal: 150000, dealSizeActual: 154923, pipelineGoal: 2250000, pipelineActual: 1135000, closeGoal: 0.25, closeActual: 0.04, targetProj: 562500, lifeGoal: 90,  lifeActual: 174 },
    { key: 's3', label: 'Stage 3',                       activeGoal: 3,  activeActual: 7,  dealSizeGoal: 150000, dealSizeActual: 153457, pipelineGoal: 450000,  pipelineActual: 1687244, closeGoal: 0.10, closeActual: 0.04, targetProj: 45000,  lifeGoal: 60,  lifeActual: 273 },
  ],

  // Services tracked in the "Service Exploration Coverage" table (canonical
  // service keys). Empty by default — the user adds the services they want to
  // watch, and each row's client breakdown stays collapsed until expanded.
  coverageServices: [],

  currentClientCount: 5,
  currentClientAmt: 320500,
  greenfieldCount: 24,
  greenfieldAmt: 3316381,
  clientGoalPct: 0.45,
  clientActualPct: 0.17,

  coverageGoal: 3.21,
  coverageActual: 2.74,

  notQuotedGoal: 0.40,
  notQuotedYear: 0.43,
  notQuotedMonth: 0.40,

  target: 1325000,
  closedYTD: 17000,

  newOppsGoal: 5,
  newOppsThisMonth: 0,
  newOppsLastMonth: 7,
  activitiesGoal: 45,
  activitiesProjected: 37,
  activitiesThisWeek: 33,
  activitiesLastWeek: 35,

  smallestDeals: [
    { id: '1', account: 'Piedmont Office Realty Trust', oppName: 'SB - SUSUP', amount: 10500 },
    { id: '2', account: 'Divco Capital', oppName: 'SB - SUECO', amount: 15000 },
    { id: '3', account: 'Edward Jones', oppName: 'SB - SUSUP', amount: 17375 },
    { id: '4', account: 'Deloitte', oppName: 'SB - SUSUP', amount: 22000 },
    { id: '5', account: 'Brookfield Asset Management', oppName: 'SB - SUSUP', amount: 25000 },
  ],
  notSoldQuoted: [
    { id: '1', account: 'Lineage Logistics (a B...)', scope: 'Audits', age: 51, finalMargin: 0.46, quoted: 105400 },
    { id: '2', account: 'Brookfield (Self Storage)', scope: 'Audits', age: 32, finalMargin: 0.47, quoted: 16000 },
    { id: '3', account: 'CBRE Inc (CBRE) - H', scope: 'Invoice collection', age: 54, finalMargin: 0.47, quoted: 59100 },
    { id: '4', account: 'Park Hotels & Resorts', scope: 'ECH, BPS Reporting', age: 48, finalMargin: 0.46, quoted: 15000 },
    { id: '5', account: 'Westinghouse (a Brod...)', scope: 'Cat 1 & 2', age: 505, finalMargin: 0.45, quoted: 18500 },
  ],
  notQuoted: [
    { id: '1', account: 'Edens (a Blacks...)', scope: 'Strategic sourcing', closeDate: '2026-04-29', age: 28 },
    { id: '2', account: 'Tishman Speyer', scope: 'RA dashboards', closeDate: '2026-04-22', age: 85 },
    { id: '3', account: 'Liberty Mutual', scope: 'Capital asset planning', closeDate: '2026-04-13', age: 53 },
    { id: '4', account: 'Realterm', scope: 'E.E.D.', closeDate: '2026-04-13', age: 96 },
  ],

  // Free-text strategy notes shown at the bottom of the page. Each is an
  // editable textarea that saves to the browser alongside the metrics.
  notesDistractions: `1.  Deprioritize these services (Arc, GRESB, ECH, etc.)
2.  Refocus energy away from Brookfield (or other accounts that need saving)
3.  Partner on smaller opportunities
4.  Focus on quality vs. quantity outeach (targeting 50 quality relationships - 10 being strategic)
5.  Minimize broader SE opp bandwidth
6.  Avoiding offer building where possible`,
  notesProspectingLeft: ` - Leverage SE to get in where possible (SAEs and broader BFO opps)
 - PE dinner partnership w/Cristy
 - Event prospecting (even if not attending)
 - Direct email/calls
 - Leverage Zoom intents and contacts`,
  notesProspectingRight: ` - Sourcing outreach with market intel
 - Going back to Not Solds with RA+?
 - Blocking out first hour of each day`,
  notesEfficientTime: ` - ChatGPT for writing exec summary, propsecting drafts, LinkedIn posts, and for company research
 - Leverage AI tools like Notebook LM or Gamma for slides/podcast generation
 - Calendly for meeting scheduling
 - Leverage fee floating tools
 - SCLP partnership where possible on company/prospect research
 - Afternoons for calls/mornings for focused work and outreach`,
  notesUpdates: `1.  Screen opps with Keith each week for Stage 3 - avoiding smaller opps coming into the pipeline before Dan works on them
2.  Take PE prospects out for lunch in NYC 1 on 1
3.  Leverage Keith and Gabe on sourcing calls vs. Beth
4.  Figure out how to accelerate sourcing pilots w/PCs faster and at a larger deal size
5.
6.`,
};

// Per-stage numeric fields. Anything not in this list is left to the
// default — keeps render-time `<NumCell value={…} />` from receiving
// objects/arrays that would crash the metrics table.
const STAGE_NUMERIC_FIELDS = [
  'activeGoal', 'activeActual',
  'dealSizeGoal', 'dealSizeActual',
  'pipelineGoal', 'pipelineActual',
  'closeGoal', 'closeActual',
  'targetProj',
  'lifeGoal', 'lifeActual',
];

// Merge each saved stage row with the matching DEFAULT_STATE row so
// every field has the expected shape. If a saved row is missing or
// malformed (wrong length, non-object, non-string key/label, non-numeric
// numeric field), the default for that slot is used. Returns an array
// the same length as DEFAULT_STATE.stages.
function sanitizeStages(savedStages) {
  if (!Array.isArray(savedStages) || savedStages.length !== DEFAULT_STATE.stages.length) {
    return DEFAULT_STATE.stages;
  }
  return savedStages.map((saved, i) => {
    const def = DEFAULT_STATE.stages[i];
    if (!saved || typeof saved !== 'object') return def;
    const row = { ...def };
    if (typeof saved.key === 'string' && saved.key) row.key = saved.key;
    // Labels are defined in code (not user-editable), so always take the
    // default label — this lets label changes propagate even when a saved
    // state already carries the old text.
    for (const f of STAGE_NUMERIC_FIELDS) {
      const v = saved[f];
      if (v === null) row[f] = null; // user blanked the cell
      else if (typeof v === 'number' && Number.isFinite(v)) row[f] = v;
      // anything else (undefined, object, array, NaN, string) → keep default
    }
    return row;
  });
}

// Outermost safety net for the entire Pipeline page. If anything below
// the title bar throws — sanitizer, BFO aggregation, JSX render — we
// show a "wipe Pipeline state and reload" button so the user can
// recover without DevTools, hard-refresh, or clear-site-data.
class PipelineRootBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('PipelineView render crashed', error, info);
  }
  async resetAndReload() {
    try { await dbDelete(STORE, KEY); } catch {}
    window.location.reload();
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '1.25rem 1.5rem', fontFamily: 'inherit' }}>
          <h2 style={{ marginTop: 0 }}>Pipeline failed to render</h2>
          <p style={{ color: '#475569', fontSize: 14 }}>
            Something in your saved Pipeline state crashed the page. The fix wipes
            the saved <code>pipeline-dashboard</code> record from this browser and
            reloads — your BFO Activity, Opps, and column prefs are not affected.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', margin: '0.75rem 0' }}>
            <button
              type="button"
              onClick={() => this.resetAndReload()}
              style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '0.45rem 0.9rem', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600 }}
            >Wipe Pipeline state and reload</button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              style={{ background: 'transparent', color: '#334155', border: '1px solid #94a3b8', borderRadius: 6, padding: '0.45rem 0.9rem', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
            >Try again</button>
          </div>
          <details style={{ fontSize: 12, color: '#64748b', marginTop: '0.75rem' }}>
            <summary style={{ cursor: 'pointer' }}>Error details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '0.5rem', background: '#f1f5f9', padding: '0.5rem', borderRadius: 4 }}>
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

// Render-time safety net for the PIPELINE METRICS table. If a single
// row throws (e.g., saved data shaped unexpectedly after a schema
// change) we show a recoverable fallback instead of blanking the whole
// section. Click "Try again" after fixing state, or use the Reset
// table button above to restore defaults.
class MetricsTableBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.warn('Pipeline metrics table render error', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '0.85rem 1rem', fontSize: 13, color: '#475569', background: '#fef9c3', borderTop: '1px solid #fde68a' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
            Couldn't render the metrics table.
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            Click <strong>Reset table</strong> above to restore defaults, or{' '}
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              style={{ background: 'transparent', border: '1px solid #94a3b8', borderRadius: 4, padding: '0.1rem 0.45rem', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#334155' }}
            >Try again</button>
          </div>
          <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const fmtMoney = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};
const fmtNum = (n) => (n === null || n === undefined || Number.isNaN(n)) ? '' : n.toLocaleString('en-US');

// Cell that commits its value on blur — text input that round-trips
// to numbers, percentages, money, etc. depending on `kind`.
function formatNumDisplay(v, kind) {
  if (v === null || v === undefined || v === '') return '';
  if (kind === 'pct') return `${(Number(v) * 100).toFixed(0)}%`;
  if (kind === 'money') return fmtMoney(Number(v));
  if (kind === 'ratio') return Number(v).toFixed(2);
  return fmtNum(Number(v));
}

// Cells use `key` to force remount when the upstream value changes
// (driven by parents passing the value into key) so internal draft
// state never has to sync to props.
function NumCell({ value, kind = 'num', onCommit }) {
  const initial = formatNumDisplay(value, kind);
  const [draft, setDraft] = useState(initial);
  function commit() {
    const raw = String(draft).replace(/[$,\s%]/g, '').trim();
    if (raw === '') { onCommit(null); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { setDraft(initial); return; }
    if (kind === 'pct') onCommit(n > 1 ? n / 100 : n);
    else onCommit(n);
  }
  return (
    <input
      className={styles.cell}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

function TextCell({ value, onCommit }) {
  const [draft, setDraft] = useState(value ?? '');
  return (
    <input
      className={styles.cellLeft}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(value ?? ''); e.currentTarget.blur(); }
      }}
    />
  );
}

// Carries the fixed-label overrides (state.labels) + setter down to every
// <EL> without threading props through the whole render tree.
const LabelCtx = createContext(null);

// Inline-editable fixed label — the table titles, column headers and static
// row labels the user asked to be able to rename. Renders plain text until
// double-clicked, then swaps in a content-sized input. Committing stores an
// override in state.labels[id] (persisted to the browser like every other
// cell); clearing it, or typing the original text back, drops the override so
// later code-side default changes still show through. `children` is the
// default text and MUST be a plain string.
function EL({ id, children }) {
  const ctx = useContext(LabelCtx);
  const fallback = String(children ?? '');
  const value = (ctx && ctx.labels && ctx.labels[id] != null) ? ctx.labels[id] : fallback;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <input
        className={styles.editInput}
        size={Math.max(6, draft.length + 1)}
        style={{ maxWidth: '100%' }}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => {
          setEditing(false);
          const text = draft.trim();
          if (ctx) ctx.setLabel(id, (text === '' || text === fallback) ? null : text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
      />
    );
  }
  return (
    <span
      className={styles.editLabel}
      title="Double-click to edit"
      onDoubleClick={(e) => { e.stopPropagation(); setDraft(value); setEditing(true); }}
    >{value}</span>
  );
}

// Color a cell green/red depending on whether the actual hits the goal.
// dir = 'higher-better' or 'lower-better'.
function compareClass(actual, goal, dir = 'higher-better') {
  if (actual === null || actual === undefined || goal === null || goal === undefined || goal === 0) return '';
  if (dir === 'higher-better') return actual >= goal ? styles.cellGreen : styles.cellRed;
  return actual <= goal ? styles.cellGreen : styles.cellRed;
}

// ---------------------------------------------------------------------------
// Hover / pin "what goes into this number" breakdowns.
//
// Mirrors the YOY page's hover-with-pin behaviour, adapted for the table:
// every live (auto-computed) cell is wrapped in <LiveValue>. Hovering a cell
// pops out a panel showing the formula, inputs and the exact rows that fed
// the number; clicking the cell pins that panel open so it survives mouse-out
// (click it again, click the ✕, or click elsewhere on the page to dismiss).
// ---------------------------------------------------------------------------
const CalcContext = createContext(null);

// Short date like 6/22/26 for the breakdown row lists.
function fmtShortDate(s) {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s || '';
  return new Date(t).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

// Map a full source array into breakdown rows: the capped display slice
// (`data` + a `more` overflow count so a busy stage can't render thousands
// of <tr>) plus the full uncapped set (`allData`) so the "Export to Excel"
// button can write every contributing row, not just the ~50 shown.
function mapRows(source, mapFn, opts = {}) {
  const { max = 50, exportMapFn = null, exportColumns = null } = opts;
  const arr = source || [];
  const all = arr.map(mapFn);
  const out = { data: all.slice(0, max), more: Math.max(0, all.length - max), allData: all };
  // The Excel export can carry extra columns (e.g. Scope) the compact
  // on-screen panel omits — supplied here so the two stay decoupled.
  if (exportMapFn) out.exportData = arr.map(exportMapFn);
  if (exportColumns) out.exportColumns = exportColumns;
  return out;
}

// Build a breakdown row list from a close-rate `included` opp array.
function closeRateRows(included, head) {
  return {
    head,
    columns: ['Result', 'Account', 'Close', 'Amount'],
    aligns: ['', '', '', 'num'],
    ...mapRows(included, o => [
      o.stage,
      o.account || '(no account)',
      fmtShortDate(o.closeDate),
      o.amount > 0 ? fmtMoney(Math.round(o.amount)) : '—',
    ], {
      exportColumns: ['Result', 'Account', 'BFO Opportunity Name', 'Scope', 'Close', 'Amount'],
      exportMapFn: o => [
        o.stage,
        o.account || '(no account)',
        o.bfoName || '',
        o.scope || '',
        fmtShortDate(o.closeDate),
        o.amount > 0 ? fmtMoney(Math.round(o.amount)) : '—',
      ],
    }),
  };
}

// Export a live-value breakdown to a one-sheet .xlsx: the metric's value,
// formula and inputs up top, then the FULL (uncapped) contributing rows —
// so a pinned panel can be dropped into Excel for deeper analysis.
async function exportBreakdown(data) {
  try {
  const mod = await import('xlsx');
  const XLSX = mod.utils ? mod : (mod.default || mod);
  const aoa = [];
  if (data.title) aoa.push([data.title]);
  if (data.value != null && data.value !== '') aoa.push(['Value', data.value]);
  if (data.formula) aoa.push(['Formula', data.formula]);
  if (Array.isArray(data.inputs)) for (const it of data.inputs) aoa.push([it.label, it.value]);
  const rows = data.rows;
  if (rows && Array.isArray(rows.exportColumns || rows.columns)) {
    aoa.push([]);
    if (rows.head) aoa.push([rows.head]);
    aoa.push(rows.exportColumns || rows.columns);
    for (const r of (rows.exportData || rows.allData || rows.data || [])) aoa.push(r);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Breakdown');
  const slug = String(data.title || 'live-value')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'live-value';
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `pipeline-${slug}-${stamp}.xlsx`);
  } catch (err) {
    console.error('Pipeline breakdown export failed', err);
    if (typeof window !== 'undefined') window.alert('Sorry — the Excel export failed to generate.');
  }
}

// Wraps a live value: handles hover-to-preview and click-to-pin. Falls back
// to a plain span (with native title) when rendered outside a CalcContext.
function LiveValue({ id, breakdown, className, style, title, children }) {
  const ctx = useContext(CalcContext);
  if (!ctx) {
    return <span className={className} style={style} title={title}>{children}</span>;
  }
  const data = { id, ...breakdown };
  const isPinned = ctx.pinnedId === id;
  return (
    <span
      className={`${className || ''} ${styles.liveValue} ${isPinned ? styles.liveValuePinned : ''}`.trim()}
      style={style}
      onMouseEnter={(e) => ctx.enter(data, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => ctx.leave(id)}
      onClick={(e) => { e.stopPropagation(); ctx.toggle(data, e.currentTarget.getBoundingClientRect()); }}
    >
      {children}
    </span>
  );
}

// The floating panel itself. Portaled to <body> and positioned next to the
// anchored cell (below it, or above when there's no room below), clamped to
// the viewport. Stays put once pinned.
function CalcPopover({ data, anchor, pinned, onClose, onKeepOpen, onLeave }) {
  const W = 360;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let left = anchor.left;
  if (left + W > vw - 8) left = vw - 8 - W;
  if (left < 8) left = 8;
  const spaceBelow = vh - anchor.bottom - 12;
  const spaceAbove = anchor.top - 12;
  const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
  const style = placeAbove
    ? { left, bottom: vh - anchor.top + 6, maxHeight: Math.max(160, spaceAbove) }
    : { left, top: anchor.bottom + 6, maxHeight: Math.max(160, spaceBelow) };
  return createPortal(
    <div
      className={styles.calcPanel}
      style={{ width: W, ...style }}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={onKeepOpen}
      onMouseLeave={onLeave}
    >
      <CalcContent data={data} pinned={pinned} onClose={onClose} />
    </div>,
    document.body,
  );
}

function CalcContent({ data, pinned, onClose }) {
  const rows = data.rows;
  const aligns = rows?.aligns || [];
  return (
    <>
      <div className={styles.calcHead}>
        <span className={styles.calcTitle}>{data.title}</span>
        <div className={styles.calcHeadActions}>
          {data.rows && Array.isArray(data.rows.columns) && (
            <button
              type="button"
              className={styles.calcExportBtn}
              onClick={() => exportBreakdown(data)}
              title="Export the full breakdown to Excel for further analysis"
            >⬇ Excel</button>
          )}
          {pinned ? (
            <button type="button" className={styles.calcPinBtn} onClick={onClose} title="Unpin this panel">📌 Pinned ✕</button>
          ) : (
            <span className={styles.calcBadge} title="Recomputed live — not a stored value. Click to pin.">∑ live</span>
          )}
        </div>
      </div>
      {data.value != null && data.value !== '' ? <div className={styles.calcValue}>{data.value}</div> : null}
      {data.formula ? <div className={styles.calcFormula}>{data.formula}</div> : null}
      {Array.isArray(data.inputs) && data.inputs.length > 0 ? (
        <div className={styles.calcInputs}>
          {data.inputs.map((it, i) => (
            <div key={i} className={styles.calcInputRow}>
              <span className={styles.calcInputLabel}>{it.label}</span>
              <span className={styles.calcInputVal}>{it.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {rows && rows.data && rows.data.length > 0 ? (
        <div className={styles.calcRows}>
          {rows.head ? <div className={styles.calcRowsHead}>{rows.head}</div> : null}
          <table className={styles.calcTable}>
            <thead>
              <tr>{rows.columns.map((c, i) => <th key={i} className={aligns[i] === 'num' ? styles.calcNum : undefined}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.data.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => <td key={ci} className={aligns[ci] === 'num' ? styles.calcNum : undefined}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.more > 0 ? <div className={styles.calcMore}>…and {rows.more} more</div> : null}
        </div>
      ) : null}
      {data.note ? <div className={styles.calcSource}>{data.note}</div> : null}
    </>
  );
}

// Owns the hover/pin state and renders the single active popover. Hover has a
// short close delay so the cursor can travel into the panel (to scroll a long
// row list) without it vanishing.
function useCalc() {
  const [hover, setHover] = useState(null);   // { data, anchor }
  const [pinned, setPinned] = useState(null); // { data, anchor }
  const hideTimer = useRef(null);
  const clearTimer = () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  const ctx = useMemo(() => ({
    pinnedId: pinned?.data.id ?? null,
    enter: (data, anchor) => { clearTimer(); setHover({ data, anchor }); },
    leave: (id) => {
      clearTimer();
      hideTimer.current = setTimeout(() => setHover(h => (h && h.data.id === id ? null : h)), 160);
    },
    keepOpen: () => clearTimer(),
    closeHover: () => { clearTimer(); setHover(null); },
    toggle: (data, anchor) => {
      clearTimer();
      setHover(null);
      setPinned(p => (p && p.data.id === data.id ? null : { data, anchor }));
    },
    unpin: () => setPinned(null),
  }), [pinned]);
  const active = pinned || hover;
  const popover = active ? (
    <CalcPopover
      key={(active.data.id || '') + (pinned ? '-pin' : '-hover')}
      data={active.data}
      anchor={active.anchor}
      pinned={!!pinned}
      onClose={() => { setPinned(null); setHover(null); }}
      onKeepOpen={ctx.keepOpen}
      onLeave={() => { if (!pinned) ctx.closeHover(); }}
    />
  ) : null;
  return { ctx, popover, pinned, unpin: () => setPinned(null) };
}

// Loose company-name match for joining opp Account values to a prospect's
// company. This is a verbatim copy of ProspectModal's companiesMatch so the
// coverage table joins opps to clients EXACTLY as each company page does —
// any looser or stricter and the two views could disagree on which opps
// belong to a client (e.g. "Blackstone" vs "The Blackstone Group L.P.").
function coverageCompaniesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const flatten = (s) => String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const fa = flatten(na);
  const fb = flatten(nb);
  if (fa && fb && fa === fb) return true;
  const squish = (s) => s.replace(/\s+/g, ' ').trim();
  if (squish(na) === squish(nb)) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  const strip = s => s.replace(/\b(inc|llc|ltd|corp|co|lp)\b\.?/gi, '').replace(/[^a-z0-9 ]/g, '').trim();
  const sa = strip(na);
  const sb = strip(nb);
  if (sa === sb) return true;
  const sLonger = sa.length >= sb.length ? sa : sb;
  const sShorter = sa.length >= sb.length ? sb : sa;
  if (sShorter.length >= 4 && sShorter.length >= sLonger.length * 0.6 && sLonger.includes(sShorter)) return true;
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

// Priority order when an account has several opps naming the same service —
// keep the strongest signal. Mirrors ProspectModal's scopeMatchedServices so
// the coverage table and the company page settle on the same status.
const OPP_STAGE_PRIORITY = { 'Sold': 4, 'Verbal': 3, 'Quoted': 3, 'Quoting': 2, 'Qualifying': 2, 'Lead': 1, 'Not Started': 1, 'Not Sold': 0 };

// For each client, the service statuses implied by that client's opportunities
// (open OR closed) — an opp whose Scope names a service makes that service
// "explored", exactly as the company page's Services Explored section treats
// it. Returns Map<prospect, Map<serviceKey, stage>>. Scope text is split on
// ; , / and each part is fuzzily matched against the canonical service list,
// mirroring ProspectModal so the two views can't disagree.
function buildOppStagesByClient(clients, oppsRecords) {
  const result = new Map();
  if (!Array.isArray(oppsRecords) || oppsRecords.length === 0) return result;
  const opps = [];
  for (const r of oppsRecords) {
    const scope = String(r?.Scope || '').trim();
    if (!scope) continue;
    opps.push({ account: String(r?.Account || ''), scope, stage: String(r?.Stage || '').trim() });
  }
  if (opps.length === 0) return result;
  for (const p of clients) {
    const matched = new Map();
    for (const o of opps) {
      if (!coverageCompaniesMatch(o.account, p.company)) continue;
      const parts = o.scope.split(/[;,/]+/).map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        const lower = part.toLowerCase();
        for (const cat of SERVICE_CATEGORIES) {
          for (const item of cat.items) {
            const il = item.toLowerCase();
            if (il === lower || il.includes(lower) || lower.includes(il)) {
              const existing = matched.get(item);
              const existingPri = existing ? (OPP_STAGE_PRIORITY[existing] ?? 1) : -1;
              const newPri = OPP_STAGE_PRIORITY[o.stage] ?? 1;
              if (newPri > existingPri) matched.set(item, o.stage);
            }
          }
        }
      }
    }
    if (matched.size) result.set(p, matched);
  }
  return result;
}

// The status a client's company page would show for one service: a real
// manual value in servicesExplored wins (it's an explicit override), otherwise
// fall back to the status implied by the client's opportunities. Returns '' when
// neither applies — i.e. the service is genuinely unexplored. Mirrors the
// company page's effective-status logic (manual override > opp-derived).
function effectiveServiceStatus(prospect, serviceKey, oppStagesByClient) {
  const manual = (prospect?.servicesExplored || {})[serviceKey];
  if (manual && manual !== '-') return manual;
  const oppStage = oppStagesByClient?.get(prospect)?.get(serviceKey);
  return oppStage || '';
}

// Service catalogue for the coverage picker/table — the user's custom
// categories when set, otherwise the code defaults; hidden services dropped,
// renames applied for display. Options stay keyed by the canonical service
// name so lookups into each prospect's servicesExplored map line up. Shared by
// the on-screen section and the Excel export so both agree on names + which
// services are eligible.
function buildServiceCatalog(settings = {}) {
  const hidden = new Set(settings.hiddenServices || []);
  const renames = settings.serviceRenames || {};
  const cats = Array.isArray(settings.customServiceCategories) && settings.customServiceCategories.length
    ? settings.customServiceCategories
    : SERVICE_CATEGORIES;
  return cats
    .map(cat => ({
      name: cat.name,
      items: (cat.items || [])
        .filter(it => !hidden.has(it))
        .map(it => ({ key: it, label: renames[it] || it })),
    }))
    .filter(cat => cat.items.length > 0);
}

// Canonical service key -> display label (honoring renames), from a catalogue.
function serviceLabelMap(catalog) {
  const m = new Map();
  for (const cat of catalog) for (const it of cat.items) m.set(it.key, it.label);
  return m;
}

// Active clients for coverage: Status = Client and matching the configured CDM
// (or every client when no CDM is set). Mirrors the renewals table's client set.
function coverageClientsOf(prospects, cdmName) {
  return prospects.filter(p => {
    if (String(p?.status || '').trim().toLowerCase() !== 'client') return false;
    return cdmName ? matchesCdm(p.cdm, cdmName) : true;
  });
}

// Coverage of one service across a client list: who's explored it (with each
// client's status) and who hasn't, plus the rolled-up count / percentage. A
// client counts as "explored" when its company page would show a status for
// the service — a manual servicesExplored value OR an opportunity naming the
// service in its Scope (In Progress / Sold / etc.). `oppStagesByClient` carries
// the opp-derived statuses; pass it so this matches each company page.
function computeServiceCoverage(clients, serviceKey, oppStagesByClient) {
  const explored = [];
  const notExplored = [];
  for (const p of clients) {
    const status = serviceKey ? effectiveServiceStatus(p, serviceKey, oppStagesByClient) : '';
    if (status) {
      explored.push({ p, status });
    } else {
      notExplored.push({ p });
    }
  }
  const byName = (a, b) => String(a.p.company || '').localeCompare(String(b.p.company || ''));
  explored.sort(byName);
  notExplored.sort(byName);
  const total = clients.length;
  const pct = total ? Math.round((explored.length / total) * 100) : 0;
  return { explored, notExplored, total, pct };
}

// "Service Exploration Coverage" — a table of services (one row each) showing
// what share of your active clients have explored each, per their company
// page's Services Explored section. Add services with the picker below the
// table; each row's client breakdown stays hidden until the row is expanded.
// The client set mirrors the renewals table: Status = Client and matching the
// configured CDM (or all clients when no CDM is set). The tracked-service list
// is passed in from persisted Pipeline state via `services` / `onChangeServices`.
function ServiceCoverageSection({ prospects = [], cdmName = '', settings = {}, onSelectProspect, services = [], onChangeServices, oppsRecords = [] }) {
  const catalog = useMemo(
    () => buildServiceCatalog(settings),
    [settings.hiddenServices, settings.serviceRenames, settings.customServiceCategories],
  );

  // Canonical key -> display label, honoring renames. Falls back to the raw
  // key so a tracked service that's since been hidden still shows a name.
  const labelOf = useMemo(() => {
    const m = serviceLabelMap(catalog);
    return (key) => m.get(key) || key;
  }, [catalog]);

  // Active clients: Status = Client, and matching the configured CDM. When no
  // CDM is configured, include every client so the table still works.
  const clients = useMemo(() => coverageClientsOf(prospects, cdmName), [prospects, cdmName]);

  // Opp-derived service statuses per client, so a client with an active (or
  // closed) opportunity naming a service counts as having explored it — the
  // same rule the company page uses. Recomputed only when the client set or
  // the opps cache changes.
  const oppStagesByClient = useMemo(
    () => buildOppStagesByClient(clients, oppsRecords),
    [clients, oppsRecords],
  );

  // Coverage for every tracked service, computed once per client/service change.
  const coverageByService = useMemo(() => {
    const m = new Map();
    for (const key of services) m.set(key, computeServiceCoverage(clients, key, oppStagesByClient));
    return m;
  }, [clients, services, oppStagesByClient]);

  // Which rows are expanded to show their client breakdown. Local-only (not
  // persisted) — every row starts collapsed so the breakdown is hidden by
  // default.
  const [expanded, setExpanded] = useState(() => new Set());
  function toggleRow(key) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function addService(key) {
    if (!key || services.includes(key) || !onChangeServices) return;
    onChangeServices([...services, key]);
  }
  function removeService(key) {
    if (!onChangeServices) return;
    onChangeServices(services.filter(s => s !== key));
    setExpanded(prev => { const n = new Set(prev); n.delete(key); return n; });
  }

  function openProspect(p) {
    if (onSelectProspect && p) onSelectProspect(p);
  }

  const tracked = new Set(services);
  // Add-picker options: every catalogue service not already in the table.
  const addCatalog = catalog
    .map(cat => ({ name: cat.name, items: cat.items.filter(it => !tracked.has(it.key)) }))
    .filter(cat => cat.items.length > 0);
  const noClients = clients.length === 0;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}><EL id="svc-cov-title">Service Exploration Coverage</EL></div>
      <div className={styles.svcCovBody}>
        {noClients && (
          <div className={styles.svcCovEmpty}>
            No active clients found{cdmName ? ` for ${cdmName}` : ''}.
          </div>
        )}

        <div className={styles.scrollX}>
          <table className={styles.svcCovTable}>
            <thead>
              <tr>
                <th className={styles.svcCovThService}><EL id="svc-cov-col-service">Service</EL></th>
                <th className={styles.svcCovThNum}><EL id="svc-cov-col-explored">Explored</EL></th>
                <th><EL id="svc-cov-col-coverage">Coverage</EL></th>
                <th aria-label="Remove" className={styles.svcCovThRemove}></th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.svcCovTableEmpty}>
                    No services tracked yet — add one below to see how many of your clients have explored it.
                  </td>
                </tr>
              ) : services.map(key => {
                const cov = coverageByService.get(key) || { explored: [], notExplored: [], total: clients.length, pct: 0 };
                const isOpen = expanded.has(key);
                return (
                  <Fragment key={key}>
                    <tr
                      className={styles.svcCovRow}
                      onClick={() => toggleRow(key)}
                      title={isOpen ? 'Collapse client breakdown' : 'Expand to see which clients have explored this'}
                    >
                      <td className={styles.svcCovServiceCell}>
                        <span className={`${styles.svcCovChevron} ${isOpen ? styles.svcCovChevronOpen : ''}`}>&#9656;</span>
                        {labelOf(key)}
                      </td>
                      <td className={styles.svcCovNumCell}>{cov.explored.length} / {cov.total}</td>
                      <td>
                        <div className={styles.svcCovRowCoverage}>
                          <div className={styles.svcCovBarTrack}>
                            <div className={styles.svcCovBarFill} style={{ width: `${cov.pct}%` }} />
                          </div>
                          <span className={styles.svcCovRowPct}>{cov.pct}%</span>
                        </div>
                      </td>
                      <td className={styles.svcCovRemoveCell}>
                        <button
                          type="button"
                          className={styles.svcCovRemoveBtn}
                          title="Remove this service from the table"
                          onClick={(e) => { e.stopPropagation(); removeService(key); }}
                        >&times;</button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className={styles.svcCovDetailRow}>
                        <td colSpan={4}>
                          <div className={styles.svcCovLists}>
                            <div className={styles.svcCovCol}>
                              <div className={styles.svcCovListHead}>Explored ({cov.explored.length})</div>
                              <div className={styles.svcCovChips}>
                                {cov.explored.length ? cov.explored.map(({ p, status }) => (
                                  <span
                                    key={p.id}
                                    className={`${styles.svcCovChip} ${styles.svcCovChipYes}`}
                                    onClick={(e) => { e.stopPropagation(); openProspect(p); }}
                                    title={`${p.company} — ${status}`}
                                  >
                                    {p.company}
                                    <span className={styles.svcCovChipStatus}>{status}</span>
                                  </span>
                                )) : <span className={styles.svcCovNone}>No clients have explored this service yet.</span>}
                              </div>
                            </div>
                            <div className={styles.svcCovCol}>
                              <div className={styles.svcCovListHead}>Not yet explored ({cov.notExplored.length})</div>
                              <div className={styles.svcCovChips}>
                                {cov.notExplored.length ? cov.notExplored.map(({ p }) => (
                                  <span
                                    key={p.id}
                                    className={`${styles.svcCovChip} ${styles.svcCovChipNo}`}
                                    onClick={(e) => { e.stopPropagation(); openProspect(p); }}
                                    title={`${p.company} — not explored`}
                                  >
                                    {p.company}
                                  </span>
                                )) : <span className={styles.svcCovNone}>Every client has explored this service.</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.svcCovAddRow}>
          <label className={styles.svcCovLabel} htmlFor="svc-cov-add">Add service</label>
          <select
            id="svc-cov-add"
            className={styles.svcCovSelect}
            value=""
            disabled={addCatalog.length === 0}
            onChange={(e) => { addService(e.target.value); e.target.value = ''; }}
          >
            <option value="" disabled>
              {addCatalog.length === 0 ? 'All services added' : 'Choose a service…'}
            </option>
            {addCatalog.map(cat => (
              <optgroup key={cat.name} label={cat.name}>
                {cat.items.map(it => <option key={it.key} value={it.key}>{it.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export function PipelineView({ prospects = [], cdmName = '', settings = {}, onSelectProspect }) {
  return (
    <PipelineRootBoundary>
      <PipelineViewInner prospects={prospects} cdmName={cdmName} settings={settings} onSelectProspect={onSelectProspect} />
    </PipelineRootBoundary>
  );
}

// Snapshot the Clients-tab localStorage stores that feed the renewals
// table (deals, name remapping, managers, untracked flags). Re-read on
// focus so an upload/edit on the Clients tab shows up here.
function readClientStores() {
  return {
    deals: loadDealsList().data,
    clientMap: loadDealClientMap(),
    managerMap: loadClientManagerMap(),
    untrackedMap: loadClientUntrackedMap(),
    statusMap: loadClientStatusMap(),
  };
}

function PipelineViewInner({ prospects = [], cdmName = '', settings = {}, onSelectProspect }) {
  const [state, setState] = useState(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [bfo, setBfo] = useState(null);
  const [opps, setOpps] = useState(null);
  const [clientStores, setClientStores] = useState(readClientStores);
  const [hubspotContacts, setHubspotContacts] = useState([]);
  const [exporting, setExporting] = useState(''); // '' | 'multi' | 'single' — which Excel export is building
  const [strategicRows, setStrategicRows] = useState([]);
  // Hover/pin "what goes into this number" breakdown panels.
  const { ctx: calcCtx, popover: calcPopover, pinned: calcPinned, unpin: calcUnpin } = useCalc();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await dbGet(STORE, KEY);
        if (cancelled) return;
        if (saved) setState(() => ({
          ...DEFAULT_STATE,
          ...saved,
          stages: sanitizeStages(saved.stages),
          // Label overrides must be a plain object; anything else falls back to
          // "no overrides" so a corrupt value can't crash the header render.
          labels: (saved.labels && typeof saved.labels === 'object' && !Array.isArray(saved.labels)) ? saved.labels : {},
          // Coverage services must be an array of non-empty strings; a corrupt
          // value falls back to "none tracked" so the table can't crash.
          coverageServices: Array.isArray(saved.coverageServices)
            ? saved.coverageServices.filter(s => typeof s === 'string' && s)
            : [],
        }));
        const bfoSaved = await dbGet(BFO_STORE, BFO_KEY);
        if (!cancelled && bfoSaved) setBfo(bfoSaved);
        const oppsSaved = await loadOppsFromCache();
        if (!cancelled && oppsSaved) setOpps(oppsSaved);
        const contacts = await getHubspotContacts();
        if (!cancelled && contacts) setHubspotContacts(contacts);
        const stratRows = await loadUploadedList(STRATEGIC_STORAGE_KEY);
        if (!cancelled && Array.isArray(stratRows)) setStrategicRows(stratRows);
      } catch (e) {
        console.warn('Pipeline hydrate failed', e);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    // Refresh BFO data whenever the user navigates back to this tab.
    function onFocus() {
      // Always reflect the current BFO + Opps records — including their
      // absence (e.g. user clicked Clear). Without explicit null
      // fallback, deletions wouldn't propagate to this view.
      dbGet(BFO_STORE, BFO_KEY).then(b => setBfo(b || null)).catch(() => setBfo(null));
      loadOppsFromCache().then(o => setOpps(o || null)).catch(() => setOpps(null));
      getHubspotContacts().then(c => setHubspotContacts(c || [])).catch(() => {});
      loadUploadedList(STRATEGIC_STORAGE_KEY).then(r => setStrategicRows(Array.isArray(r) ? r : [])).catch(() => {});
      setClientStores(readClientStores());
    }
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, []);

  const bfoMetrics = useMemo(() => bfoStageMetrics(bfo), [bfo]);
  const hasBfo = bfo && bfo.rows && bfo.rows.length > 0;

  // Active clients (from the Clients tab) whose soonest contract expires
  // within the renewal window. Pulled from the same prospects + Clients-tab
  // stores the Clients page uses, so this table agrees with that one.
  const expiringClients = useMemo(
    () => computeExpiringClients({
      prospects,
      cdmName,
      dealsList: clientStores.deals,
      clientMap: clientStores.clientMap,
      managerMap: clientStores.managerMap,
      untrackedMap: clientStores.untrackedMap,
      statusMap: clientStores.statusMap,
      withinDays: RENEWAL_WINDOW_DAYS,
    }),
    [prospects, cdmName, clientStores],
  );

  // Decision-maker contacts grouped by normalized company name, so each
  // renewals row can show the DM(s) at that account and whether they've been
  // invited to Louisville. Mirrors the HubSpot-contact source + "Decision
  // Maker" tag test the Progress and contact views use. The Louisville flag
  // is a local-only setting keyed by the contact's HubSpot id.
  const dmsByCompany = useMemo(() => {
    const invitedMap = settings.contactInvitedToLouisville || {};
    // Per-contact local overrides (Firestore settings). A _companyOverride is
    // the user's typed company name for a contact whose HubSpot company
    // association refused to update; the contact views (HubSpot / All Contacts
    // / Key Contacts) all key off it, so this renewals join must too. Without
    // it, an overridden DM matches on their raw HubSpot company here and goes
    // missing from the table even though they show up correctly everywhere else.
    const localFieldsMap = settings.contactLocalFields || {};
    const map = new Map();
    for (const c of hubspotContacts) {
      const tags = String(c.dans_tags || c.dan_s_tags || c.dans_tag || '')
        .split(';').map(t => t.trim().toLowerCase());
      if (!tags.includes('decision maker')) continue;
      const cid = c.id || c.vid;
      const override = cid != null ? localFieldsMap[cid]?._companyOverride : null;
      const company = (typeof override === 'string' && override) ? override : c.company;
      const key = normClientName(company);
      if (!key) continue;
      const name = [c.firstname, c.lastname].filter(Boolean).join(' ').trim()
        || c.name || c.email || '—';
      const isPrimary = tags.includes('primary point of contact');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ contact: c, name, invited: cid != null ? !!invitedMap[cid] : false, isPrimary });
    }
    // Show exactly one decision maker per account: prefer the one tagged
    // "Primary Point of Contact", otherwise fall back to the first DM found.
    for (const [key, list] of map) {
      if (list.length > 1) {
        map.set(key, [list.find(d => d.isPrimary) || list[0]]);
      }
    }
    return map;
  }, [hubspotContacts, settings.contactInvitedToLouisville, settings.contactLocalFields]);

  // My Accounts that are mapped to a row on the uploaded Strategic Accounts
  // list, each with that row's Account Owner + Type. Reads the same per-user
  // My-Accounts mapping the Lists tab writes (Firestore-synced copy first,
  // then the local cache), keyed the exact way UploadedListView builds it —
  // pickNameKey over the union of headers + normalizeCompany of the raw name —
  // so our lookups line up with the stored mapping.
  const strategicMyAccounts = useMemo(() => {
    if (!strategicRows.length) return [];
    const remote = settings?.listMappings?.[STRATEGIC_STORAGE_KEY];
    let mapping = remote && remote.myAccountMapping && typeof remote.myAccountMapping === 'object'
      ? remote.myAccountMapping
      : null;
    if (!mapping) {
      try {
        const raw = userLsGet(`${STRATEGIC_STORAGE_KEY}:my-accounts-mapping`);
        mapping = raw ? (JSON.parse(raw) || {}) : {};
      } catch { mapping = {}; }
    }
    const headers = [];
    const seen = new Set();
    for (const row of strategicRows) for (const k of Object.keys(row)) {
      if (!seen.has(k)) { seen.add(k); headers.push(k); }
    }
    const nameKey = pickNameKey(headers);
    const ownerKey = headers.find(h => /owner/i.test(h));
    const typeKey = headers.find(h => /^type$/i.test(h)) || headers.find(h => /type/i.test(h));
    const out = [];
    const dedupe = new Set();
    for (const row of strategicRows) {
      const rawName = nameKey ? String(row[nameKey] || '').trim() : '';
      if (!rawName) continue;
      const norm = normalizeCompany(rawName);
      if (!norm) continue;
      const confirmed = mapping[`name::${norm}`];
      if (typeof confirmed !== 'string' || !confirmed) continue;
      const owner = ownerKey ? String(row[ownerKey] || '').trim() : '';
      const type = typeKey ? String(row[typeKey] || '').trim() : '';
      const key = `${confirmed.toLowerCase()}|${owner.toLowerCase()}|${type.toLowerCase()}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      out.push({ account: confirmed, owner, type });
    }
    out.sort((a, b) => a.account.localeCompare(b.account) || a.owner.localeCompare(b.owner));
    return out;
  }, [strategicRows, settings.listMappings]);

  // Deep-link a Strategic Accounts row to its account modal by company name.
  function openStrategicAccount(company) {
    if (!onSelectProspect) return;
    const p = prospects.find(pp => normClientName(pp.company) === normClientName(company));
    if (p) onSelectProspect(p);
  }

  // Open the account modal for a renewals row (by matching prospect id, then
  // company name as a fallback). Optionally deep-links straight into a
  // contact's editor.
  function openClientModal(row, editContact) {
    if (!onSelectProspect) return;
    const p = prospects.find(pp => pp.id === row.id)
      || prospects.find(pp => normClientName(pp.company) === normClientName(row.company));
    if (p) onSelectProspect(p, editContact);
  }

  // Lists derived from the Opps tab.
  const oppsRecords = opps && Array.isArray(opps.records) ? opps.records : [];

  // Sum of Quoted Amount for Opps tab records with Stage === 'Sold' and
  // a Close Date in the current calendar year. Drives the Closed YTD
  // cell on the Pipeline header. Returns null when the Opps cache has
  // no records — Closed YTD then falls back to the editable input.
  const oppsClosedYTD = useMemo(() => {
    if (oppsRecords.length === 0) return null;
    const thisYear = new Date().getFullYear();
    let total = 0;
    const deals = [];
    for (const r of oppsRecords) {
      if ((r.Stage || '').trim() !== 'Sold') continue;
      const cd = r['Close Date'];
      if (!cd) continue;
      const ts = Date.parse(cd);
      if (Number.isNaN(ts)) continue;
      if (new Date(ts).getFullYear() !== thisYear) continue;
      const amt = parseMoney(r['Quoted Amount']);
      if (typeof amt === 'number' && Number.isFinite(amt)) {
        total += amt;
        deals.push({
          account: String(r.Account || '').trim() || '(no account)',
          bfoName: bfoOppNameOf(r),
          scope: String(r.Scope || '').trim(),
          closeDate: cd,
          ts,
          amount: amt,
        });
      }
    }
    deals.sort((a, b) => b.ts - a.ts);
    return { total: Math.round(total), year: thisYear, deals };
  }, [oppsRecords]);

  // Overall Close Rate (Actual) for the Pipeline Metrics Total row.
  // Rolling 365-day window per the user's spec:
  //   Total Sold     — Sold within the last 365 days, Scope without "pull through".
  //   Total Not Sold — Not Sold within the last 365 days, Scope without "pull through".
  // Close Rate = Sold / (Sold + Not Sold). Returns null when the Opps
  // cache has no usable records so the Total cell stays blank rather
  // than reading "0%".
  const oppsCloseRateActual = useMemo(() => {
    if (oppsRecords.length === 0) return null;
    const cutoff = Date.now() - 365 * 86400000;
    const PULL_THROUGH = /pull[\s-]?through/i;
    let sold = 0;
    let notSold = 0;
    const included = [];
    for (const r of oppsRecords) {
      const stage = (r.Stage || '').trim();
      if (stage !== 'Sold' && stage !== 'Not Sold') continue;
      const cd = r['Close Date'];
      if (!cd) continue;
      const ts = Date.parse(cd);
      if (Number.isNaN(ts) || ts < cutoff) continue;
      if (PULL_THROUGH.test(String(r.Scope || ''))) continue;
      if (stage === 'Sold') sold += 1;
      else notSold += 1;
      included.push({
        account: String(r.Account || '').trim(),
        bfoName: bfoOppNameOf(r),
        scope: String(r.Scope || '').trim(),
        stage,
        closeDate: cd,
        ts,
        amount: parseMoney(r['Quoted Amount']) || 0,
      });
    }
    const total = sold + notSold;
    if (total === 0) return null;
    included.sort((a, b) => b.ts - a.ts);
    return { sold, notSold, rate: sold / total, included };
  }, [oppsRecords]);

  // Per-stage Close Rate Actual on a rolling 365-day window. Each
  // stage uses a different "did it actually reach this stage?" signal
  // on the Opps tab:
  //   Stage 3 (Qualify Opportunity)    — has a BFO opportunity value, i.e.
  //                                      a non-empty BFO Link (every opp
  //                                      that made it into BFO).
  //   Stage 5 (Prepare & Bid / Quoted) — non-empty Quoted On date.
  //   Stage 6 (Negotiate to Win)       — non-empty Entity Outside the US
  //                                      Approval value (blank or "-"
  //                                      means it never made it to 6).
  // Stage 4 returns null until we get a comparable signal column.
  const oppsCloseRateByStage = useMemo(() => {
    const out = { 3: null, 4: null, 5: null, 6: null };
    if (oppsRecords.length === 0) return out;
    const cutoff = Date.now() - 365 * 86400000;
    const PULL_THROUGH = /pull[\s-]?through/i;
    const hasBfoOpportunity = (r) => {
      const v = String(r['BFO Link'] ?? '').trim();
      if (!v) return false;
      if (v === '-' || v === '—' || v === 'N/A' || v === '#N/A') return false;
      return true;
    };
    const hasQuotedOn = (r) => {
      const v = r['Quoted On'] || r['Quoted Date'] || '';
      if (!v) return false;
      const ts = Date.parse(v);
      return !Number.isNaN(ts);
    };
    const hasEntityApproval = (r) => {
      const v = String(r['Entity Outside the US Approval'] || '').trim();
      if (!v) return false;
      if (v === '-' || v === '—' || v === 'N/A' || v === '#N/A') return false;
      return true;
    };
    const stagePredicates = {
      3: hasBfoOpportunity,
      5: hasQuotedOn,
      6: hasEntityApproval,
    };
    const tallies = {
      3: { sold: 0, notSold: 0, included: [] },
      5: { sold: 0, notSold: 0, included: [] },
      6: { sold: 0, notSold: 0, included: [] },
    };
    for (const r of oppsRecords) {
      const stage = (r.Stage || '').trim();
      if (stage !== 'Sold' && stage !== 'Not Sold') continue;
      const cd = r['Close Date'];
      if (!cd) continue;
      const ts = Date.parse(cd);
      if (Number.isNaN(ts) || ts < cutoff) continue;
      if (PULL_THROUGH.test(String(r.Scope || ''))) continue;
      const entry = {
        account: String(r.Account || '').trim(),
        bfoName: bfoOppNameOf(r),
        scope: String(r.Scope || '').trim(),
        stage,
        closeDate: cd,
        ts,
        amount: parseMoney(r['Quoted Amount']) || 0,
      };
      for (const stageNum of Object.keys(stagePredicates)) {
        if (!stagePredicates[stageNum](r)) continue;
        if (stage === 'Sold') tallies[stageNum].sold += 1;
        else tallies[stageNum].notSold += 1;
        tallies[stageNum].included.push(entry);
      }
    }
    for (const stageNum of [3, 5, 6]) {
      const { sold, notSold, included } = tallies[stageNum];
      const total = sold + notSold;
      if (total > 0) {
        included.sort((a, b) => b.ts - a.ts);
        out[stageNum] = { sold, notSold, rate: sold / total, included };
      }
    }
    return out;
  }, [oppsRecords]);

  // Live Current Client vs Greenfield stats. Joins BFO Activity rows
  // to the Opps tab's Lead Source / Source via the BFO Opportunity
  // Name → Opps "BFO Link" map, then classifies each BFO opp using
  // a keyword heuristic (anything mentioning client / existing /
  // renewal / cross-sell / expansion / upsell counts as "current
  // client", everything else — including unmatched rows — counts as
  // "greenfield"). Returns null when BFO data isn't loaded so the
  // editable manual cells stay in place.
  const clientGreenfieldFromBfo = useMemo(() => {
    if (!hasBfo) return null;
    const findCol = (re) => bfo.headers.find(h => re.test(h));
    const oppCol = findCol(/opportunity\s*name/i);
    const amountCol = findCol(/^amount$/i);
    const stageCol = findCol(/sales\s*stage|^stage$/i);
    if (!oppCol) return null;
    const sourceByName = new Map();
    const scopeByName = new Map();
    for (const r of oppsRecords) {
      const k = String(r['BFO Link'] || '').trim().toLowerCase();
      if (!k) continue;
      const src = (r['Lead Source'] || r['Source'] || '').toString().trim();
      sourceByName.set(k, src);
      scopeByName.set(k, String(r.Scope || '').trim());
    }
    const isClient = (src) => /client|existing|renewal|cross[\s-]?sell|expansion|upsell/i.test(src || '');
    let clientCount = 0;
    let greenfieldCount = 0;
    let clientAmt = 0;
    let greenfieldAmt = 0;
    const clientRows = [];
    const greenfieldRows = [];
    for (const r of bfo.rows) {
      // Active opps only — skip any closed-stage rows so the figures
      // mirror the rest of the Pipeline table (Stages 3-6 plus
      // anything BFO marks as in-stream).
      const stageVal = stageCol ? r[stageCol] : '';
      const stageMatch = matchStage(stageVal);
      if (stageMatch !== null && (stageMatch < 3 || stageMatch > 6)) continue;
      const oppNameRaw = String(r[oppCol] || '').trim();
      const oppName = oppNameRaw.toLowerCase();
      const src = sourceByName.get(oppName) || '';
      const amt = amountCol ? parseMoney(r[amountCol]) : null;
      const entry = { oppName: oppNameRaw || '(unnamed opp)', source: src || '(no lead source)', scope: scopeByName.get(oppName) || '', amount: amt };
      if (isClient(src)) {
        clientCount += 1;
        clientRows.push(entry);
        if (typeof amt === 'number' && Number.isFinite(amt)) clientAmt += amt;
      } else {
        greenfieldCount += 1;
        greenfieldRows.push(entry);
        if (typeof amt === 'number' && Number.isFinite(amt)) greenfieldAmt += amt;
      }
    }
    const total = clientCount + greenfieldCount;
    const clientActualPct = total > 0 ? clientCount / total : null;
    return {
      clientCount,
      greenfieldCount,
      clientAmt: Math.round(clientAmt),
      greenfieldAmt: Math.round(greenfieldAmt),
      clientActualPct,
      total,
      clientRows,
      greenfieldRows,
    };
  }, [hasBfo, bfo, oppsRecords]);

  // New opps created in each of the past 6 calendar months, derived from the
  // Opps tab. Only counts opps that carry a BFO Opportunity Name (drafts /
  // unlinked records are skipped). "Created" = the opp's open date, resolved by
  // oppOpenTs (Start Date preferred, else Age at import time). Buckets run
  // oldest → newest and always include the current month.
  const newOppsByMonth = useMemo(() => {
    const fetchedAt = opps && opps.fetchedAt ? Date.parse(opps.fetchedAt) : NaN;
    const ageRef = Number.isFinite(fetchedAt) ? fetchedAt : Date.now();
    const now = new Date();
    const buckets = [];
    const indexByKey = new Map();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      indexByKey.set(key, buckets.length);
      buckets.push({
        key,
        label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        count: 0,
        items: [],
      });
    }
    for (const r of oppsRecords) {
      if (!bfoOppNameOf(r)) continue;
      const openTs = oppOpenTs(r, ageRef);
      if (Number.isNaN(openTs)) continue;
      const d = new Date(openTs);
      const bi = indexByKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (bi == null) continue; // outside the 6-month window
      buckets[bi].count += 1;
      buckets[bi].items.push({
        account: String(r.Account || '').trim() || '(no company)',
        opp: String(r['Opportunity Name'] || r.Opportunity || r.Name || '').trim() || '(unnamed opp)',
        bfoName: bfoOppNameOf(r),
        scope: String(r.Scope || '').trim(),
        openDate: new Date(openTs).toISOString().slice(0, 10),
      });
    }
    for (const b of buckets) {
      b.items.sort((a, c) => a.account.localeCompare(c.account) || a.opp.localeCompare(c.opp));
    }
    return buckets;
  }, [oppsRecords, opps]);

  useEffect(() => {
    if (!hydrated) return;
    dbPut(STORE, state, KEY).catch(err => console.warn('Pipeline save failed', err));
  }, [state, hydrated]);

  function setStage(idx, patch) {
    setState(s => ({ ...s, stages: s.stages.map((row, i) => i === idx ? { ...row, ...patch } : row) }));
  }
  function setField(key, value) {
    setState(s => ({ ...s, [key]: value }));
  }
  // Set (or, with a null value, clear) a fixed-label override.
  function setLabel(id, value) {
    setState(s => {
      const labels = { ...(s.labels || {}) };
      if (value == null) delete labels[id];
      else labels[id] = value;
      return { ...s, labels };
    });
  }
  // setLabel only calls setState (stable), so a fresh closure each render is
  // fine — memoize on the labels map so <EL> consumers re-render only when a
  // label actually changes, not on every unrelated Pipeline re-render.
  const labelCtx = useMemo(() => ({ labels: state.labels || {}, setLabel }), [state.labels]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always have a usable stages array to render — sanitizeStages merges
  // each row with its DEFAULT_STATE counterpart and replaces any wrong-
  // typed field, so render-time `<NumCell value={…} />` and `{st.label}`
  // can never receive an object/array that would crash the table.
  const renderStages = useMemo(() => sanitizeStages(state.stages), [state.stages]);
  // Self-heal: if the sanitized rows differ from what's in state, write
  // them back so the persisted record is no longer malformed.
  useEffect(() => {
    if (!hydrated) return;
    if (state.stages !== renderStages
        && JSON.stringify(state.stages) !== JSON.stringify(renderStages)) {
      setState(s => ({ ...s, stages: renderStages }));
    }
  }, [hydrated, state.stages, renderStages]);

  const stageTotals = renderStages.reduce((acc, st) => {
    const stageNum = Number(String(st.key).replace(/[^0-9]/g, ''));
    const m = bfoMetrics[stageNum];
    const liveCount = hasBfo && m?.count !== null && m?.count !== undefined ? m.count : null;
    const liveTotal = hasBfo && m?.total !== null && m?.total !== undefined ? m.total : null;
    const liveAvg = hasBfo && m?.avg !== null && m?.avg !== undefined ? m.avg : null;
    const liveLife = hasBfo && m?.avgAge !== null && m?.avgAge !== undefined ? m.avgAge : null;
    const lifeGoal = Number(st.lifeGoal);
    const lifeActual = liveLife ?? Number(st.lifeActual);
    // Target Projection — Goal: Active Opp Goal × Deal Size Goal × Close Rate Goal.
    // Actual: live BFO actuals (when present) × Close Rate Actual.
    const projGoal = (Number(st.activeGoal) || 0) * (Number(st.dealSizeGoal) || 0) * (Number(st.closeGoal) || 0);
    const projActual = ((liveCount ?? Number(st.activeActual)) || 0)
      * ((liveAvg ?? Number(st.dealSizeActual)) || 0)
      * (Number(st.closeActual) || 0);
    // Weighted-average inputs for Avg Opp Life — Goal weighted by
    // Active Opp Goal, Actual weighted by Active Opp Actual (live BFO
    // count when loaded). Mirrors =SUMPRODUCT(life, count)/SUM(count).
    const goalCount = Number(st.activeGoal) || 0;
    const actualCount = Number(liveCount ?? st.activeActual) || 0;
    return {
      activeActual: acc.activeActual + (liveCount ?? (Number(st.activeActual) || 0)),
      activeGoal: acc.activeGoal + (Number(st.activeGoal) || 0),
      pipelineActual: acc.pipelineActual + (liveTotal ?? (Number(st.pipelineActual) || 0)),
      pipelineGoal: acc.pipelineGoal + (Number(st.pipelineGoal) || 0),
      targetProjGoal: acc.targetProjGoal + projGoal,
      targetProjActual: acc.targetProjActual + projActual,
      lifeGoalProduct: acc.lifeGoalProduct + (Number.isFinite(lifeGoal) ? lifeGoal * goalCount : 0),
      lifeGoalWeight: acc.lifeGoalWeight + (Number.isFinite(lifeGoal) ? goalCount : 0),
      lifeActualProduct: acc.lifeActualProduct + (Number.isFinite(lifeActual) ? lifeActual * actualCount : 0),
      lifeActualWeight: acc.lifeActualWeight + (Number.isFinite(lifeActual) ? actualCount : 0),
    };
  }, { activeActual: 0, activeGoal: 0, pipelineActual: 0, pipelineGoal: 0, targetProjGoal: 0, targetProjActual: 0, lifeGoalProduct: 0, lifeGoalWeight: 0, lifeActualProduct: 0, lifeActualWeight: 0 });

  const dealSizeAvgGoal = stageTotals.pipelineGoal && stageTotals.activeGoal
    ? Math.round(stageTotals.pipelineGoal / stageTotals.activeGoal) : 0;
  // Total Deal Size Actual matches the Excel `=AVERAGE(Activity!U2:U70)`
  // — straight average of every Amount across all stages — when BFO
  // data is loaded. Falls back to the weighted average otherwise.
  const dealSizeAvgActual = hasBfo && bfoMetrics.all && typeof bfoMetrics.all.allAmtAvg === 'number'
    ? Math.round(bfoMetrics.all.allAmtAvg)
    : (stageTotals.pipelineActual && stageTotals.activeActual
        ? Math.round(stageTotals.pipelineActual / stageTotals.activeActual)
        : 0);

  // Prefer the live Opps-derived Closed YTD when the Opps cache is
  // populated; falls back to the manually entered state.closedYTD.
  const effectiveClosedYTD = oppsClosedYTD !== null ? oppsClosedYTD.total : (Number(state.closedYTD) || 0);
  const closedPctOfQuota = state.target ? effectiveClosedYTD / state.target : 0;
  // Weighted-by-count averages — SUMPRODUCT(life, count) / SUM(count).
  // Goal weights are activeGoal; Actual weights are the live count
  // (BFO when loaded, manual activeActual otherwise).
  const lifeGoalAvg = stageTotals.lifeGoalWeight > 0
    ? Math.round(stageTotals.lifeGoalProduct / stageTotals.lifeGoalWeight) : null;
  const lifeActualAvg = stageTotals.lifeActualWeight > 0
    ? Math.round(stageTotals.lifeActualProduct / stageTotals.lifeActualWeight) : null;

  // Resolve a fixed label to its user override (state.labels) or code default —
  // the same lookup <EL> does — so the export mirrors any renamed headers.
  const lbl = (id, def) => (state.labels && state.labels[id] != null ? state.labels[id] : def);

  // Gather every table's currently-displayed values into a plain payload for
  // the Schneider-formatted Excel builder. Mirrors the render logic: live BFO /
  // Opps actuals when loaded, manual state fallbacks otherwise.
  function buildExportPayload() {
    const stages = renderStages.map((st) => {
      const n = Number(String(st.key).replace(/[^0-9]/g, ''));
      const m = bfoMetrics[n];
      const live = (v) => hasBfo && v !== null && v !== undefined;
      const activeActual = live(m?.count) ? m.count : st.activeActual;
      const dealSizeActual = live(m?.avg) ? m.avg : st.dealSizeActual;
      const pipelineActual = live(m?.total) ? m.total : st.pipelineActual;
      const lifeActual = live(m?.avgAge) ? m.avgAge : st.lifeActual;
      const liveRate = oppsCloseRateByStage[n]?.rate;
      const closeActual = liveRate != null ? liveRate : st.closeActual;
      const killFlag = STAGE_KILL_FLAG[n];
      const flaggedRows = killFlag
        ? (m?.rows || []).filter(r => r.age != null && st.lifeGoal != null && r.age > st.lifeGoal)
        : [];
      // Same naming the on-screen flagged cell uses (account, else opp name).
      const flaggedNames = flaggedRows.map(r => r.account || r.oppName || '(no account)');
      return {
        label: st.label,
        activeGoal: st.activeGoal, activeActual,
        dealSizeGoal: st.dealSizeGoal, dealSizeActual,
        pipelineGoal: st.pipelineGoal, pipelineActual,
        closeGoal: st.closeGoal, closeActual,
        targetProjGoal: (Number(st.activeGoal) || 0) * (Number(st.dealSizeGoal) || 0) * (Number(st.closeGoal) || 0),
        lifeGoal: st.lifeGoal, lifeActual,
        flaggedLabel: killFlag || '', flaggedCount: flaggedRows.length, flaggedNames,
      };
    });
    const cg = clientGreenfieldFromBfo;
    const coverageActual = hasBfo && state.target > 0 ? stageTotals.pipelineActual / state.target : null;
    return {
      lbl,
      generatedAt: new Date(),
      cdmName,
      hasBfo,
      quota: { target: state.target, closedYTD: effectiveClosedYTD, pctOfQuota: closedPctOfQuota },
      stages,
      totals: {
        activeGoal: stageTotals.activeGoal, activeActual: stageTotals.activeActual,
        dealSizeGoal: dealSizeAvgGoal, dealSizeActual: dealSizeAvgActual,
        pipelineGoal: stageTotals.pipelineGoal, pipelineActual: stageTotals.pipelineActual,
        closeRate: oppsCloseRateActual ? oppsCloseRateActual.rate : null,
        targetProjGoal: stageTotals.targetProjGoal,
        lifeGoal: lifeGoalAvg, lifeActual: lifeActualAvg,
      },
      clientGreenfield: {
        clientCount: cg ? cg.clientCount : state.currentClientCount,
        greenfieldCount: cg ? cg.greenfieldCount : state.greenfieldCount,
        clientAmt: cg ? cg.clientAmt : state.currentClientAmt,
        greenfieldAmt: cg ? cg.greenfieldAmt : state.greenfieldAmt,
        clientGoalPct: state.clientGoalPct,
        clientActualPct: cg && cg.clientActualPct != null ? cg.clientActualPct : state.clientActualPct,
      },
      coverage: { goal: state.coverageGoal, actual: coverageActual },
      notQuoted: { goal: state.notQuotedGoal, year: state.notQuotedYear, month: state.notQuotedMonth },
      newOppsByMonth: newOppsByMonth.map(m => ({ label: m.label, count: m.count })),
      renewals: {
        windowDays: RENEWAL_WINDOW_DAYS,
        rows: expiringClients.map((c) => {
          const dms = dmsByCompany.get(normClientName(c.company)) || [];
          return {
            company: c.company,
            renewalStatus: c.renewalStatus,
            clientManager: c.clientManager,
            decisionMaker: dms.map(d => d.name).join(', '),
            invited: dms.length ? dms.map(d => (d.invited ? 'Yes' : 'No')).join(', ') : '',
            daysUntil: c.daysUntil,
          };
        }),
      },
      // Service Exploration Coverage: one summary row per tracked service —
      // explored count, client total and coverage %. Mirrors the on-screen
      // table (client set and "explored" rule identical). Omitted downstream
      // when the user tracks no services.
      serviceCoverage: (() => {
        const services = state.coverageServices || [];
        const clients = coverageClientsOf(prospects, cdmName);
        const oppStagesByClient = buildOppStagesByClient(clients, oppsRecords);
        const labels = serviceLabelMap(buildServiceCatalog(settings));
        return {
          title: lbl('svc-cov-title', 'Service Exploration Coverage'),
          headers: [
            lbl('svc-cov-col-service', 'Service'),
            lbl('svc-cov-col-explored', 'Explored'),
            'Clients',
            lbl('svc-cov-col-coverage', 'Coverage'),
          ],
          rows: services.map((key) => {
            const cov = computeServiceCoverage(clients, key, oppStagesByClient);
            return {
              service: labels.get(key) || key,
              explored: cov.explored.length,
              total: cov.total,
              pct: cov.total ? cov.explored.length / cov.total : 0,
            };
          }),
        };
      })(),
      // Strategic Accounts — My Accounts: the same on-screen table
      // (My Accounts mapped to the uploaded Strategic Accounts list), verbatim.
      strategicAccounts: {
        title: lbl('strat-title', 'Strategic Accounts — My Accounts'),
        headers: [lbl('strat-account', 'Account'), lbl('strat-owner', 'Account Owner'), lbl('strat-type', 'Type')],
        rows: strategicMyAccounts.map(s => ({ account: s.account, owner: s.owner, type: s.type })),
      },
      notes: [
        { title: lbl('notes-distractions-title', 'Eliminating Distractions'), text: state.notesDistractions },
        { title: lbl('notes-prospecting-title', 'Prospecting Approach'), text: [state.notesProspectingLeft, state.notesProspectingRight].filter(Boolean).join('\n') },
        { title: lbl('notes-efficient-title', 'Efficient Time Utilization'), text: state.notesEfficientTime },
        { title: lbl('notes-updates-title', 'Updates'), text: state.notesUpdates },
      ],
    };
  }

  async function handleExportExcel(layout = 'multi') {
    if (exporting) return;
    setExporting(layout);
    try {
      await downloadPipelineWorkbook({ ...buildExportPayload(), layout });
    } catch (err) {
      alert('Failed to build the Excel report: ' + (err?.message || err));
    } finally {
      setExporting('');
    }
  }

  return (
    <CalcContext.Provider value={calcCtx}>
    <LabelCtx.Provider value={labelCtx}>
    <div
      className={styles.wrapper}
      onClick={() => { if (calcPinned) calcUnpin(); }}
    >
      {calcPopover}
      <div className={styles.header} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <h1 className={styles.title}>Pipeline</h1>
          <div className={styles.subtitle}>Pipeline metrics dashboard. Every cell is editable; values save to your browser. Hover a <span className={styles.liveCell} style={{ cursor: 'default' }}>live value</span> to see what feeds it; click to pin the panel, then <strong>⬇ Excel</strong> to export the full breakdown.</div>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            type="button"
            onClick={() => handleExportExcel('multi')}
            disabled={!!exporting}
            title="Download the Pipeline tab as a Schneider-formatted Excel report — one sheet per section"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.4rem 0.8rem', border: 'none', borderRadius: 6,
              background: exporting ? '#94A3B8' : '#3DCD58', color: '#fff',
              fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit',
              cursor: exporting ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            <span>⬇</span>{exporting === 'multi' ? 'Exporting…' : 'Export Excel (tabs)'}
          </button>
          <button
            type="button"
            onClick={() => handleExportExcel('single')}
            disabled={!!exporting}
            title="Download the whole Pipeline tab on a single, polished Excel sheet"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.4rem 0.8rem', borderRadius: 6, border: '1px solid #009530',
              background: exporting ? '#F1F5F9' : '#fff', color: '#009530',
              fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit',
              cursor: exporting ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            <span>⬇</span>{exporting === 'single' ? 'Exporting…' : 'Export Excel (one page)'}
          </button>
        </div>
      </div>
      <div className={styles.body}>
        {/* Quota header — sits directly above the Pipeline Metrics
            table so the YTD / % of Quota framing is visible before
            you read any of the per-stage rows. */}
        <div className={styles.section} style={{ maxWidth: 480 }}>
          <table className={styles.grid}>
            <thead><tr><th><EL id="q-target">Target</EL></th><th><EL id="q-closed-ytd">Closed YTD</EL></th><th><EL id="q-pct-quota">% of Quota</EL></th></tr></thead>
            <tbody>
              <tr>
                <td><NumCell value={state.target} kind="money" onCommit={(v) => setField('target', v)} /></td>
                <td>
                  {oppsClosedYTD !== null
                    ? (
                          <LiveValue
                            id="closedYTD"
                            className={styles.liveCell}
                            breakdown={{
                              title: `Closed YTD (${oppsClosedYTD.year})`,
                              value: fmtMoney(oppsClosedYTD.total),
                              formula: "Σ Quoted Amount where Stage = 'Sold' and Close Date is in the current calendar year.",
                              inputs: [
                                { label: 'Sold deals', value: oppsClosedYTD.deals.length },
                                { label: 'Total', value: fmtMoney(oppsClosedYTD.total) },
                              ],
                              rows: {
                                head: 'Contributing deals (newest close first)',
                                columns: ['Account', 'Close', 'Amount'],
                                aligns: ['', '', 'num'],
                                ...mapRows(oppsClosedYTD.deals, d => [d.account, fmtShortDate(d.closeDate), fmtMoney(d.amount)], {
                                  exportColumns: ['Account', 'BFO Opportunity Name', 'Scope', 'Close', 'Amount'],
                                  exportMapFn: d => [d.account, d.bfoName || '', d.scope || '', fmtShortDate(d.closeDate), fmtMoney(d.amount)],
                                }),
                              },
                              note: 'Auto-fed from the Opps tab. Re-paste the Opps tab to refresh.',
                            }}
                          >{fmtMoney(oppsClosedYTD.total)}</LiveValue>
                        )
                    : <NumCell value={state.closedYTD} kind="money" onCommit={(v) => setField('closedYTD', v)} />}
                </td>
                <td className={styles.numCell}>{(closedPctOfQuota * 100).toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Pipeline metrics */}
        <div className={styles.section}>
          <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span><EL id="t-pipeline-metrics">PIPELINE METRICS</EL></span>
            <button
              type="button"
              onClick={() => {
                if (!confirm('Reset all Pipeline Metrics rows to default values?')) return;
                setState(s => ({ ...s, stages: DEFAULT_STATE.stages }));
              }}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 4, fontSize: 11, padding: '0.15rem 0.5rem', cursor: 'pointer', fontFamily: 'inherit' }}
              title="Restore the stage rows + goal seeds to defaults if the table looks blank or corrupted."
            >Reset table</button>
          </div>
          <MetricsTableBoundary>
          <div style={{ overflowX: 'auto' }}>
          <table className={styles.grid} style={{ width: 1515, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 140 }} /> {/* Stage label */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Active Opps */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Deal Size */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Pipeline */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Close Rate */}
              <col style={{ width: 105 }} /> {/* Target Projection */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Avg Opp Life */}
              <col style={{ width: 220 }} /> {/* Flagged Opps */}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className={styles.headerLeft}><EL id="m-stage">Stage</EL></th>
                <th colSpan={2}><EL id="m-active-opps">Active Opportunities</EL></th>
                <th colSpan={2}><EL id="m-deal-size">Deal Size</EL></th>
                <th colSpan={2}><EL id="m-pipeline">Pipeline</EL></th>
                <th colSpan={2}><EL id="m-close-rate">Close Rate (Rolling 365 days)</EL></th>
                <th><EL id="m-target-proj">Target Projection</EL></th>
                <th colSpan={2}><EL id="m-opp-life">Avg Opp Life</EL></th>
                <th><EL id="m-flagged-opps">Flagged Opps</EL></th>
              </tr>
              <tr>
                <th><EL id="m-active-goal">Goal (above)</EL></th><th><EL id="m-active-actual">Actual</EL></th>
                <th><EL id="m-dealsize-goal">Goal (above)</EL></th><th><EL id="m-dealsize-actual">Actual</EL></th>
                <th><EL id="m-pipeline-goal">Goal (above)</EL></th><th><EL id="m-pipeline-actual">Actual</EL></th>
                <th><EL id="m-closerate-goal">Goal (above)</EL></th><th><EL id="m-closerate-actual">Actual</EL></th>
                <th><EL id="m-targetproj-goal">Goal</EL></th>
                <th><EL id="m-opplife-goal">Goal (less than)</EL></th><th><EL id="m-opplife-actual">Actual</EL></th>
                <th><EL id="m-flagged-kill">Quote / Contract or Kill</EL></th>
              </tr>
            </thead>
            <tbody>
              {renderStages.map((st, i) => {
                const stageNum = Number(String(st.key).replace(/[^0-9]/g, ''));
                const m = bfoMetrics[stageNum];
                const live = (val) => hasBfo && val !== null && val !== undefined ? val : null;
                const activeActual = live(m?.count) ?? st.activeActual;
                const dealSizeActual = live(m?.avg) ?? st.dealSizeActual;
                const pipelineActual = live(m?.total) ?? st.pipelineActual;
                const lifeActual = live(m?.avgAge) ?? st.lifeActual;
                const fromBfo = (v) => hasBfo && v !== null && v !== undefined;
                const liveTip = 'Auto-fed from BFO Activity. Re-paste BFO data to refresh.';
                // Build the row list (account / opportunity / amount-or-age)
                // that feeds the hover breakdown for the BFO-driven cells.
                const mkBfoRows = (head, includeAge) => ({
                  head,
                  columns: ['Account', 'Opportunity', includeAge ? 'Age' : 'Amount'],
                  aligns: ['', '', 'num'],
                  ...mapRows(m?.rows || [], r => [
                    r.account || '—',
                    r.oppName || '—',
                    includeAge
                      ? (r.age ?? '—')
                      : (r.amount == null ? '—' : `${fmtMoney(Math.round(r.amount))}${r.excludedFromAvg ? ' *' : ''}`),
                  ], {
                    exportColumns: ['Account', 'Opportunity', 'Scope', includeAge ? 'Age' : 'Amount'],
                    exportMapFn: r => [
                      r.account || '—',
                      r.oppName || '—',
                      r.scope || '',
                      includeAge
                        ? (r.age ?? '—')
                        : (r.amount == null ? '—' : `${fmtMoney(Math.round(r.amount))}${r.excludedFromAvg ? ' *' : ''}`),
                    ],
                  }),
                });
                return (
                  <tr key={st.key}>
                    <td className={styles.label}>{st.label}</td>
                    <td><NumCell value={st.activeGoal} onCommit={(v) => setStage(i, { activeGoal: v })} /></td>
                    <td className={compareClass(activeActual, st.activeGoal, 'higher-better')}>
                      {fromBfo(m?.count)
                        ? <LiveValue
                            id={`active-${stageNum}`}
                            className={styles.liveCell}
                            breakdown={{
                              title: `${st.label} — Active Opportunities`,
                              value: String(activeActual),
                              formula: `COUNT of BFO Activity rows whose Sales Stage matches "${st.label}".`,
                              inputs: [{ label: 'Matching rows', value: m.count }],
                              rows: mkBfoRows('Matching BFO opps', false),
                              note: liveTip,
                            }}
                          >{activeActual}</LiveValue>
                        : <NumCell value={st.activeActual} onCommit={(v) => setStage(i, { activeActual: v })} />}
                    </td>
                    <td><NumCell value={st.dealSizeGoal} kind="money" onCommit={(v) => setStage(i, { dealSizeGoal: v })} /></td>
                    <td className={compareClass(dealSizeActual, st.dealSizeGoal, 'higher-better')}>
                      {fromBfo(m?.avg)
                        ? <LiveValue
                            id={`dealsize-${stageNum}`}
                            className={styles.liveCell}
                            breakdown={{
                              title: `${st.label} — Deal Size (Actual)`,
                              value: fmtMoney(Math.round(dealSizeActual)),
                              formula: stageNum === 6
                                ? 'AVERAGE(Amount) across matching BFO rows, excluding the $80k template placeholder (marked *).'
                                : 'AVERAGE(Amount) across matching BFO rows.',
                              inputs: [
                                { label: 'Rows averaged', value: m.amtCount },
                                { label: 'Average', value: fmtMoney(Math.round(dealSizeActual)) },
                              ],
                              rows: mkBfoRows('Amounts averaged', false),
                              note: liveTip,
                            }}
                          >{fmtMoney(Math.round(dealSizeActual))}</LiveValue>
                        : <NumCell value={st.dealSizeActual} kind="money" onCommit={(v) => setStage(i, { dealSizeActual: v })} />}
                    </td>
                    <td><NumCell value={st.pipelineGoal} kind="money" onCommit={(v) => setStage(i, { pipelineGoal: v })} /></td>
                    <td className={compareClass(pipelineActual, st.pipelineGoal, 'higher-better')}>
                      {fromBfo(m?.total)
                        ? <LiveValue
                            id={`pipeline-${stageNum}`}
                            className={styles.liveCell}
                            breakdown={{
                              title: `${st.label} — Pipeline (Actual)`,
                              value: fmtMoney(Math.round(pipelineActual)),
                              formula: 'SUM(Amount) across matching BFO rows.',
                              inputs: [
                                { label: 'Rows summed', value: m.count },
                                { label: 'Total', value: fmtMoney(Math.round(pipelineActual)) },
                              ],
                              rows: mkBfoRows('Amounts summed', false),
                              note: liveTip,
                            }}
                          >{fmtMoney(Math.round(pipelineActual))}</LiveValue>
                        : <NumCell value={st.pipelineActual} kind="money" onCommit={(v) => setStage(i, { pipelineActual: v })} />}
                    </td>
                    <td><NumCell value={st.closeGoal} kind="pct" onCommit={(v) => setStage(i, { closeGoal: v })} /></td>
                    {(() => {
                      const live = oppsCloseRateByStage[stageNum];
                      const liveRate = live ? live.rate : null;
                      const actualForCmp = liveRate !== null ? liveRate : st.closeActual;
                      const cls = compareClass(actualForCmp, st.closeGoal, 'higher-better');
                      if (liveRate !== null) {
                        const signal = stageNum === 3
                          ? 'a BFO opportunity value (non-empty BFO Link)'
                          : stageNum === 5
                          ? 'a Quoted On date'
                          : stageNum === 6
                          ? 'a non-empty Entity Outside the US Approval value'
                          : 'the stage signal';
                        return (
                          <td className={`${cls} ${styles.numCell}`.trim()}>
                            <LiveValue
                              id={`closerate-${stageNum}`}
                              className={styles.liveCell}
                              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}
                              breakdown={{
                                title: `${st.label} — Close Rate (rolling 365 days)`,
                                value: `${(liveRate * 100).toFixed(0)}%  (${live.sold}/${live.sold + live.notSold})`,
                                formula: `Sold ÷ (Sold + Not Sold), over Opps closed in the last 365 days that reached this stage (signal: ${signal}) with a Scope without "pull through".`,
                                inputs: [
                                  { label: 'Sold', value: live.sold },
                                  { label: 'Not Sold', value: live.notSold },
                                  { label: 'Close rate', value: `${(liveRate * 100).toFixed(0)}%` },
                                ],
                                rows: closeRateRows(live.included, 'Opps included (newest close first)'),
                                note: 'Auto-fed from the Opps tab. Re-paste the Opps tab to refresh.',
                              }}
                            >
                              <span>{`${(liveRate * 100).toFixed(0)}%`}</span>
                              <span style={{ fontSize: '0.65rem', opacity: 0.75, fontWeight: 500 }}>{live.sold}/{live.sold + live.notSold}</span>
                            </LiveValue>
                          </td>
                        );
                      }
                      return (
                        <td className={cls}>
                          <NumCell value={st.closeActual} kind="pct" onCommit={(v) => setStage(i, { closeActual: v })} />
                        </td>
                      );
                    })()}
                    {(() => {
                      const ag = Number(st.activeGoal) || 0;
                      const dg = Number(st.dealSizeGoal) || 0;
                      const cg = Number(st.closeGoal) || 0;
                      const projGoal = Math.round(ag * dg * cg);
                      // Tooltip shows the exact numbers feeding the
                      // formula so a wrong-looking total can be traced
                      // back to which input is off.
                      const tip = `${ag} × ${fmtMoney(dg)} × ${(cg * 100).toFixed(2)}% = ${fmtMoney(projGoal)}`;
                      return (
                        <td className={styles.numCell} title={tip}>
                          {projGoal ? fmtMoney(projGoal) : ''}
                        </td>
                      );
                    })()}
                    <td><NumCell value={st.lifeGoal} onCommit={(v) => setStage(i, { lifeGoal: v })} /></td>
                    <td className={compareClass(lifeActual, st.lifeGoal, 'lower-better')}>
                      {fromBfo(m?.avgAge)
                        ? <LiveValue
                            id={`life-${stageNum}`}
                            className={styles.liveCell}
                            breakdown={{
                              title: `${st.label} — Avg Opp Life`,
                              value: `${lifeActual}`,
                              formula: 'AVERAGE(Age, in days) across matching BFO rows that carry an Age.',
                              inputs: [
                                { label: 'Rows with Age', value: m.ageCount },
                                { label: 'Average (days)', value: lifeActual },
                              ],
                              rows: mkBfoRows('Ages averaged', true),
                              note: liveTip,
                            }}
                          >{lifeActual}</LiveValue>
                        : <NumCell value={st.lifeActual} onCommit={(v) => setStage(i, { lifeActual: v })} />}
                    </td>
                    {/* Flagged opps — active opps past this stage's max target
                        age (the "Goal (less than)" days), tagged with the
                        stage's kill move. Names truncate rather than wrap;
                        hover for the full list with ages. */}
                    {(() => {
                      const killFlag = STAGE_KILL_FLAG[stageNum];
                      const flaggedOpps = killFlag
                        ? (m?.rows || []).filter(r => r.age != null && st.lifeGoal != null && r.age > st.lifeGoal)
                        : [];
                      const label = (r) => r.account || r.oppName || '(no account)';
                      return (
                        <td
                          style={{ textAlign: 'left', padding: '0.3rem 0.5rem', fontSize: '0.72rem' }}
                          title={killFlag && flaggedOpps.length
                            ? `${killFlag} — age > ${st.lifeGoal}d:\n` + flaggedOpps.map(r => `• ${label(r)} — ${r.age}d`).join('\n')
                            : killFlag
                              ? `No ${st.label} opps past their ${st.lifeGoal ?? '—'}-day target.`
                              : 'No kill move for this stage.'}
                        >
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {killFlag && flaggedOpps.length
                              ? <span style={{ color: '#B45309', fontWeight: 600 }}>{killFlag}: {flaggedOpps.map(label).join(', ')}</span>
                              : <span style={{ color: '#94A3B8' }}>—</span>}
                          </div>
                        </td>
                      );
                    })()}
                  </tr>
                );
              })}
              <tr>
                <td className={styles.label}><EL id="m-total">Total</EL></td>
                <td className={styles.numCell}>{stageTotals.activeGoal}</td>
                <td className={styles.numCell}>{stageTotals.activeActual}</td>
                <td className={styles.numCell}>{fmtMoney(dealSizeAvgGoal)}</td>
                <td className={styles.numCell}>{fmtMoney(dealSizeAvgActual)}</td>
                <td className={styles.numCell}>{fmtMoney(stageTotals.pipelineGoal)}</td>
                <td className={styles.numCell}>{fmtMoney(stageTotals.pipelineActual)}</td>
                <td />
                <td className={styles.numCell} title={oppsCloseRateActual ? undefined
                  : 'Add Sold / Not Sold opps with a Close Date in the past 365 days (and a Scope without "pull through") on the Opps tab to populate.'}>
                  {oppsCloseRateActual ? (
                    <LiveValue
                      id="closerate-total"
                      className={styles.liveCell}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}
                      breakdown={{
                        title: 'Overall Close Rate (rolling 365 days)',
                        value: `${(oppsCloseRateActual.rate * 100).toFixed(0)}%  (${oppsCloseRateActual.sold}/${oppsCloseRateActual.sold + oppsCloseRateActual.notSold})`,
                        formula: 'Sold ÷ (Sold + Not Sold) for Opps closed in the past 365 days, with "pull through" Scopes excluded.',
                        inputs: [
                          { label: 'Sold', value: oppsCloseRateActual.sold },
                          { label: 'Not Sold', value: oppsCloseRateActual.notSold },
                          { label: 'Close rate', value: `${(oppsCloseRateActual.rate * 100).toFixed(0)}%` },
                        ],
                        rows: closeRateRows(oppsCloseRateActual.included, 'Opps included (newest close first)'),
                        note: 'Auto-fed from the Opps tab. Re-paste the Opps tab to refresh.',
                      }}
                    >
                      <span>{`${(oppsCloseRateActual.rate * 100).toFixed(0)}%`}</span>
                      <span style={{ fontSize: '0.65rem', opacity: 0.75, fontWeight: 500 }}>{oppsCloseRateActual.sold}/{oppsCloseRateActual.sold + oppsCloseRateActual.notSold}</span>
                    </LiveValue>
                  ) : ''}
                </td>
                <td className={styles.numCell} title="Sum of stage Target Projection Goals (Active Goal × Deal Size Goal × Close Rate Goal).">{fmtMoney(Math.round(stageTotals.targetProjGoal))}</td>
                <td className={styles.numCell} title="Stage goals weighted by Active Opp Goal — SUMPRODUCT(lifeGoal, activeGoal) ÷ SUM(activeGoal). Less is better.">{lifeGoalAvg ?? ''}</td>
                <td className={`${styles.numCell} ${compareClass(lifeActualAvg, lifeGoalAvg, 'lower-better')}`.trim()} title="Stage actuals weighted by Active Opp Actual (live BFO count when loaded). SUMPRODUCT(lifeActual, activeActual) ÷ SUM(activeActual).">{lifeActualAvg ?? ''}</td>
                <td />
              </tr>
            </tbody>
          </table>
          </div>
          </MetricsTableBoundary>
        </div>

        {/* Mid row — Client/Greenfield + Coverage Ratio + % deals
            not Quoted. Widths are pinned to the metrics colgroup
            above (Stage 140 + 4×105 = 560 px to the left edge of
            Pipeline, then 2×105 = 210 px for Pipeline itself) so
            Coverage Ratio sits directly under the Pipeline column
            and the two blue borders read as a single vertical block. */}
        <div className={styles.midRow} style={{ flexWrap: 'nowrap' }}>
          <div className={styles.section} style={{ flex: '0 0 544px' }}>
            <table className={styles.grid} style={{ width: '100%' }}>
              <thead>
                <tr><th /><th><EL id="cg-count">Count / $</EL></th><th><EL id="cg-goal-client">Goal - Client</EL></th><th><EL id="cg-actual-client">Actual - Client</EL></th></tr>
              </thead>
              <tbody>
                {(() => {
                  const cg = clientGreenfieldFromBfo;
                  const live = !!cg;
                  const liveTip = 'Auto-fed from BFO Activity rows (Stages 3–6) joined to the Opps tab Lead Source. Re-paste BFO or Opps to refresh.';
                  const liveCell = (val, id, breakdown) => (
                    <LiveValue id={id} className={styles.liveCell} breakdown={breakdown}>{val}</LiveValue>
                  );
                  const cgRows = (arr, head) => ({
                    head,
                    columns: ['Opportunity', 'Lead Source', 'Amount'],
                    aligns: ['', '', 'num'],
                    ...mapRows(arr || [], r => [r.oppName, r.source, r.amount == null ? '—' : fmtMoney(Math.round(r.amount))], {
                      exportColumns: ['Opportunity', 'Lead Source', 'Scope', 'Amount'],
                      exportMapFn: r => [r.oppName, r.source, r.scope || '', r.amount == null ? '—' : fmtMoney(Math.round(r.amount))],
                    }),
                  });
                  const liveActualPct = cg && cg.clientActualPct !== null
                    ? `${(cg.clientActualPct * 100).toFixed(0)}%`
                    : null;
                  const goalForCompare = Number(state.clientGoalPct);
                  const actualForCompare = cg?.clientActualPct ?? state.clientActualPct;
                  return (
                    <>
                      <tr>
                        <td className={styles.label}><EL id="cg-row-client-opps">Current client opps</EL></td>
                        <td>{live
                          ? liveCell(cg.clientCount, 'cg-client-count', {
                              title: 'Current client opps',
                              value: String(cg.clientCount),
                              formula: 'COUNT of active BFO opps (Stages 3–6) whose joined Opps Lead Source mentions client / existing / renewal / cross-sell / expansion / upsell.',
                              inputs: [
                                { label: 'Client opps', value: cg.clientCount },
                                { label: 'Greenfield opps', value: cg.greenfieldCount },
                              ],
                              rows: cgRows(cg.clientRows, 'Client-classified opps'),
                              note: liveTip,
                            })
                          : <NumCell value={state.currentClientCount} onCommit={(v) => setField('currentClientCount', v)} />}
                        </td>
                        <td rowSpan={2}><NumCell value={state.clientGoalPct} kind="pct" onCommit={(v) => setField('clientGoalPct', v)} /></td>
                        <td rowSpan={2} className={compareClass(actualForCompare, goalForCompare, 'lower-better')}>
                          {live && liveActualPct !== null
                            ? liveCell(liveActualPct, 'cg-client-pct', {
                                title: '% Current client',
                                value: liveActualPct,
                                formula: 'Client opps ÷ (Client + Greenfield opps).',
                                inputs: [
                                  { label: 'Client opps', value: cg.clientCount },
                                  { label: 'Greenfield opps', value: cg.greenfieldCount },
                                  { label: 'Total', value: cg.total },
                                ],
                                rows: cgRows(cg.clientRows, 'Client-classified opps'),
                                note: liveTip,
                              })
                            : <NumCell value={state.clientActualPct} kind="pct" onCommit={(v) => setField('clientActualPct', v)} />}
                        </td>
                      </tr>
                      <tr>
                        <td className={styles.label}><EL id="cg-row-green-opps">Greenfield opps</EL></td>
                        <td>{live
                          ? liveCell(cg.greenfieldCount, 'cg-green-count', {
                              title: 'Greenfield opps',
                              value: String(cg.greenfieldCount),
                              formula: 'COUNT of active BFO opps (Stages 3–6) that are not client-classified (including rows with no matched Lead Source).',
                              inputs: [
                                { label: 'Greenfield opps', value: cg.greenfieldCount },
                                { label: 'Client opps', value: cg.clientCount },
                              ],
                              rows: cgRows(cg.greenfieldRows, 'Greenfield-classified opps'),
                              note: liveTip,
                            })
                          : <NumCell value={state.greenfieldCount} onCommit={(v) => setField('greenfieldCount', v)} />}
                        </td>
                      </tr>
                      <tr>
                        <td className={styles.label}><EL id="cg-row-client-amt">Current client $</EL></td>
                        <td>{live
                          ? liveCell(fmtMoney(cg.clientAmt), 'cg-client-amt', {
                              title: 'Current client $',
                              value: fmtMoney(cg.clientAmt),
                              formula: 'Σ Amount of client-classified BFO opps.',
                              inputs: [
                                { label: 'Client opps', value: cg.clientCount },
                                { label: 'Total', value: fmtMoney(cg.clientAmt) },
                              ],
                              rows: cgRows(cg.clientRows, 'Client-classified opps'),
                              note: liveTip,
                            })
                          : <NumCell value={state.currentClientAmt} kind="money" onCommit={(v) => setField('currentClientAmt', v)} />}
                        </td>
                        <td colSpan={2} />
                      </tr>
                      <tr>
                        <td className={styles.label}><EL id="cg-row-green-amt">Greenfield $</EL></td>
                        <td>{live
                          ? liveCell(fmtMoney(cg.greenfieldAmt), 'cg-green-amt', {
                              title: 'Greenfield $',
                              value: fmtMoney(cg.greenfieldAmt),
                              formula: 'Σ Amount of greenfield-classified BFO opps.',
                              inputs: [
                                { label: 'Greenfield opps', value: cg.greenfieldCount },
                                { label: 'Total', value: fmtMoney(cg.greenfieldAmt) },
                              ],
                              rows: cgRows(cg.greenfieldRows, 'Greenfield-classified opps'),
                              note: liveTip,
                            })
                          : <NumCell value={state.greenfieldAmt} kind="money" onCommit={(v) => setField('greenfieldAmt', v)} />}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>

          <div className={styles.section} style={{ flex: '0 0 210px' }}>
            <table className={styles.grid} style={{ width: '100%' }}>
              <thead>
                <tr><th colSpan={2}><EL id="cov-title">Coverage Ratio</EL></th></tr>
                <tr><th><EL id="cov-goal">Goal</EL></th><th><EL id="cov-actual">Actual</EL></th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><NumCell value={state.coverageGoal} kind="ratio" onCommit={(v) => setField('coverageGoal', v)} /></td>
                  {(() => {
                    // Coverage Ratio Actual = total Actual Pipeline ÷ Target.
                    // Auto-fed; only meaningful when BFO data is loaded
                    // (otherwise we'd be dividing by seeded numbers).
                    const computedCoverage = hasBfo && state.target > 0
                      ? stageTotals.pipelineActual / state.target
                      : null;
                    return (
                      <td className={compareClass(computedCoverage, state.coverageGoal, 'higher-better')}>
                        {computedCoverage !== null ? (
                          <LiveValue
                            id="coverage-actual"
                            className={styles.liveCell}
                            breakdown={{
                              title: 'Coverage Ratio (Actual)',
                              value: computedCoverage.toFixed(2),
                              formula: 'Total Actual Pipeline ÷ Target.',
                              inputs: [
                                { label: 'Actual Pipeline', value: fmtMoney(stageTotals.pipelineActual) },
                                { label: 'Target', value: fmtMoney(state.target) },
                                { label: 'Ratio', value: computedCoverage.toFixed(2) },
                              ],
                              note: 'Actual Pipeline is the live BFO sum across Stages 3–6. Re-paste BFO to refresh.',
                            }}
                          >{computedCoverage.toFixed(2)}</LiveValue>
                        ) : (
                          <span className={styles.noBfoCell}>—</span>
                        )}
                      </td>
                    );
                  })()}
                </tr>
              </tbody>
            </table>
          </div>

          <div className={styles.section} style={{ flex: '0 0 315px' }}>
            <table className={styles.grid} style={{ width: '100%' }}>
              <thead>
                <tr><th colSpan={3}><EL id="nq-title">% of deals not Quoted</EL></th></tr>
                <tr><th><EL id="nq-goal">Goal</EL></th><th><EL id="nq-actual-year">Actual Year</EL></th><th><EL id="nq-actual-month">Actual Month</EL></th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><NumCell value={state.notQuotedGoal} kind="pct" onCommit={(v) => setField('notQuotedGoal', v)} /></td>
                  <td className={compareClass(state.notQuotedYear, state.notQuotedGoal, 'lower-better')}>
                    <NumCell value={state.notQuotedYear} kind="pct" onCommit={(v) => setField('notQuotedYear', v)} />
                  </td>
                  <td className={compareClass(state.notQuotedMonth, state.notQuotedGoal, 'lower-better')}>
                    <NumCell value={state.notQuotedMonth} kind="pct" onCommit={(v) => setField('notQuotedMonth', v)} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>

        {/* New Opps by Month — BFO-linked opps created in each of the past 6
            months, laid out horizontally (months across). Each count is green
            when it's 5 or more, red when it's below 5. */}
        <div className={styles.section} style={{ maxWidth: 760 }}>
          <div className={styles.sectionTitle}><EL id="nom-title">New Opps by Month</EL></div>
          <div className={styles.scrollX}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th className={styles.headerLeft}><EL id="nom-month">Month</EL></th>
                {newOppsByMonth.map(m => <th key={m.key}>{m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={styles.label}><EL id="nom-new-opps">New Opps</EL></td>
                {newOppsByMonth.map(m => {
                  const color = m.count >= 5 ? '#16a34a' : '#dc2626';
                  return (
                    <td key={m.key} className={styles.numCell} style={{ textAlign: 'center' }}>
                      <LiveValue
                        id={`new-opps-${m.key}`}
                        className={styles.liveCell}
                        style={{ color, borderBottomColor: color, fontWeight: 700 }}
                        breakdown={{
                          title: `New Opps — ${m.label}`,
                          value: String(m.count),
                          formula: 'COUNT of Opps with a BFO Opportunity Name created in this month. Open date prefers Start Date, else fetchedAt − Age.',
                          inputs: [{ label: 'New opps', value: m.count }],
                          rows: {
                            head: 'New opps (by account)',
                            columns: ['Account', 'Opportunity', 'Opened'],
                            aligns: ['', '', ''],
                            ...mapRows(m.items, it => [it.account, it.opp, it.openDate], {
                              exportColumns: ['Account', 'Opportunity', 'BFO Opportunity Name', 'Scope', 'Opened'],
                              exportMapFn: it => [it.account, it.opp, it.bfoName || '', it.scope || '', it.openDate],
                            }),
                          },
                          note: 'Auto-fed from the Opps tab. Re-paste the Opps tab to refresh.',
                        }}
                      >{m.count}</LiveValue>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        {/* Service exploration coverage — pick a service, see what share of
            active clients have explored it (from each company page's Services
            Explored section). Sits above the renewals table. */}
        <ServiceCoverageSection
          prospects={prospects}
          cdmName={cdmName}
          settings={settings}
          onSelectProspect={onSelectProspect}
          services={state.coverageServices || []}
          onChangeServices={(next) => setField('coverageServices', next)}
          oppsRecords={oppsRecords}
        />

        {/* Client renewals — active clients whose soonest contract End Date
            is within the renewal window. Pulled from the Clients tab. */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}><EL id="ren-title">{`Client Renewals — Contracts Expiring Within ${RENEWAL_WINDOW_DAYS} Days`}</EL></div>
          <table className={styles.tinyTable} title={`Auto-fed from the Clients tab — active clients (CDM = ${cdmName || 'your CDM'} and Status = Client) whose soonest contract End Date is within ${RENEWAL_WINDOW_DAYS} days. Sorted soonest first; negative = already overdue.`}>
            <thead>
              <tr>
                <th><EL id="ren-client">Client</EL></th>
                <th><EL id="ren-status">Renewal Status</EL></th>
                <th><EL id="ren-client-manager">Client Manager</EL></th>
                <th><EL id="ren-decision-maker">Decision Maker</EL></th>
                <th><EL id="ren-invited">Invited to Louisville</EL></th>
                <th><EL id="ren-days-until">Days Until Expiration</EL></th>
              </tr>
            </thead>
            <tbody>
              {expiringClients.length > 0 ? (
                expiringClients.map((c) => {
                  const dms = dmsByCompany.get(normClientName(c.company)) || [];
                  // Grey out clients who've told us they're cancelling for
                  // sure — they're effectively lost, so they recede from the
                  // renewals still worth chasing.
                  const isCancelling = String(c.renewalStatus || '').trim().toLowerCase() === 'cancelling for sure';
                  return (
                  <tr key={c.id} className={isCancelling ? styles.cancelledRow : undefined}>
                    <td>
                      {onSelectProspect ? (
                        <span className={styles.linkCell} onClick={() => openClientModal(c)}>{c.company}</span>
                      ) : c.company}
                    </td>
                    <td>{c.renewalStatus || '—'}</td>
                    <td>{c.clientManager || '—'}</td>
                    <td>
                      {dms.length > 0 ? dms.map((dm, i) => (
                        <div key={i}>
                          {onSelectProspect ? (
                            <span className={styles.linkCell} onClick={() => openClientModal(c, dm.contact)}>{dm.name}</span>
                          ) : dm.name}
                        </div>
                      )) : '—'}
                    </td>
                    <td>
                      {dms.length > 0 ? dms.map((dm, i) => (
                        <div key={i} style={{ color: dm.invited ? '#16a34a' : '#94a3b8' }}>
                          {dm.invited ? 'Yes' : 'No'}
                        </div>
                      )) : '—'}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', color: c.daysUntil < 0 ? '#dc2626' : undefined }}>
                      {c.daysUntil < 0 ? `${c.daysUntil} (overdue)` : c.daysUntil}
                    </td>
                  </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} style={{ color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', padding: '0.6rem' }}>
                    No clients with contracts expiring in the next {RENEWAL_WINDOW_DAYS} days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* My Accounts mapped to the uploaded Strategic Accounts list, with
            each mapped row's Account Owner + Type. Hidden when nothing is
            mapped so the section doesn't show an empty shell. */}
        {strategicMyAccounts.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}><EL id="strat-title">Strategic Accounts — My Accounts</EL></div>
            <table className={styles.tinyTable} title="Your accounts mapped to the uploaded Strategic Accounts list (from the Lists tab), with each mapped row's Account Owner and Type.">
              <thead>
                <tr>
                  <th><EL id="strat-account">Account</EL></th>
                  <th><EL id="strat-owner">Account Owner</EL></th>
                  <th><EL id="strat-type">Type</EL></th>
                </tr>
              </thead>
              <tbody>
                {strategicMyAccounts.map((s, i) => (
                  <tr key={i}>
                    <td>
                      {onSelectProspect ? (
                        <span className={styles.linkCell} onClick={() => openStrategicAccount(s.account)}>{s.account}</span>
                      ) : s.account}
                    </td>
                    <td>{s.owner || '—'}</td>
                    <td>{s.type || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Strategy notes — free-text, editable, saved to the browser. */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}><EL id="notes-distractions-title">Eliminating Distractions</EL></div>
          <div className={styles.notesBody}>
            <NotesBox value={state.notesDistractions} onCommit={(v) => setField('notesDistractions', v)} minRows={6} />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}><EL id="notes-prospecting-title">Prospecting Approach</EL></div>
          <div className={`${styles.notesBody} ${styles.notesTwoCol}`}>
            <NotesBox value={state.notesProspectingLeft} onCommit={(v) => setField('notesProspectingLeft', v)} minRows={5} />
            <NotesBox value={state.notesProspectingRight} onCommit={(v) => setField('notesProspectingRight', v)} minRows={5} />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}><EL id="notes-efficient-title">Efficient Time Utilization</EL></div>
          <div className={styles.notesBody}>
            <NotesBox value={state.notesEfficientTime} onCommit={(v) => setField('notesEfficientTime', v)} minRows={6} />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}><EL id="notes-updates-title">Updates</EL></div>
          <div className={styles.notesBody}>
            <NotesBox value={state.notesUpdates} onCommit={(v) => setField('notesUpdates', v)} minRows={6} />
          </div>
        </div>
      </div>
    </div>
    </LabelCtx.Provider>
    </CalcContext.Provider>
  );
}

// Auto-growing editable text area for the strategy-notes sections at the
// bottom of the page. Keeps a local draft while typing and commits to the
// persisted state on blur (matching the numeric cells) so IndexedDB isn't
// written on every keystroke.
function NotesBox({ value, onCommit, minRows = 5 }) {
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef(null);
  // Reflect external changes (hydration / reset) into the draft.
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  return (
    <textarea
      ref={ref}
      className={styles.notesArea}
      rows={minRows}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      spellCheck={false}
    />
  );
}

function EditableList({ rows, setRows, cols, newRow }) {
  function update(id, patch) {
    setRows(rows.map(r => r.id === id ? { ...r, ...patch } : r));
  }
  function remove(id) {
    setRows(rows.filter(r => r.id !== id));
  }
  function add() {
    setRows([...rows, newRow()]);
  }
  return (
    <div>
      <table className={styles.tinyTable}>
        <thead>
          <tr>
            {cols.map(c => <th key={c.key}>{c.label}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              {cols.map(c => (
                <td key={c.key}>
                  {c.kind === 'text'
                    ? <TextCell value={r[c.key]} onCommit={(v) => update(r.id, { [c.key]: v })} />
                    : <NumCell value={r[c.key]} kind={c.kind} onCommit={(v) => update(r.id, { [c.key]: v })} />}
                </td>
              ))}
              <td>
                <button type="button" className={styles.delBtn} onClick={() => remove(r.id)} title="Remove row">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '0.4rem 0.5rem' }}>
        <button type="button" className={styles.actionBtn} onClick={add}>+ Add row</button>
      </div>
    </div>
  );
}
````

### src/components/PipelineView/PipelineView.module.css

````css
.wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  padding: 1rem 1.25rem 0.5rem;
}

.title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  margin: 0;
  color: var(--color-text);
}

.subtitle {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-top: 0.15rem;
}

.body {
  flex: 1;
  overflow: auto;
  padding: 0.5rem 1.25rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
}

.scrollX {
  overflow-x: auto;
}

.sectionTitle {
  background: #475569;
  color: #fff;
  padding: 0.45rem 0.75rem;
  font-size: 0.85rem;
  font-weight: 700;
  text-align: center;
  letter-spacing: 0.04em;
}

/* Fixed labels (titles / headers / row labels) turned editable via <EL>.
   Plain text until hovered; a dashed underline + tint hints it's editable. */
.editLabel {
  cursor: text;
  border-radius: 3px;
  padding: 0 2px;
  border-bottom: 1px dashed transparent;
}

.editLabel:hover {
  background: rgba(148, 163, 184, 0.22);
  border-bottom-color: currentColor;
}

/* The input shown while editing a label. Inherits font weight / size / align
   from the surrounding cell but pins readable dark-on-white colors so it stays
   legible even inside the dark section-title bars. */
.editInput {
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  text-align: inherit;
  color: #0f172a;
  background: #fff;
  border: 1px solid #2563eb;
  border-radius: 3px;
  padding: 0 2px;
}

.editInput:focus {
  outline: none;
}

.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.72rem;
}

.grid th,
.grid td {
  border: 1px solid var(--color-border);
  padding: 0.25rem 0.3rem;
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
}

.grid th {
  background: #f8fafc;
  font-weight: 700;
  text-align: center;
  font-size: 0.7rem;
  white-space: normal;
  word-break: normal;
  overflow-wrap: normal;
}

.grid td {
  white-space: nowrap;
}

.grid th.headerLeft {
  text-align: left;
  background: #fff;
}

.grid td.label {
  font-weight: 600;
  background: #fff;
}

.cell {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  font-family: inherit;
  font-size: 0.72rem;
  padding: 0.15rem 0.3rem;
  border-radius: 4px;
  color: var(--color-text);
  text-align: left;
}

.cell:hover {
  border-color: var(--color-border);
}

.cell:focus {
  outline: none;
  border-color: #2563eb;
  background: #fff;
}

.cellLeft {
  composes: cell;
  text-align: left;
}

.cellGreen {
  background: #d1fae5;
}

.cellRed {
  background: #fecaca;
}

.liveCell {
  display: inline-block;
  padding: 0.15rem 0.3rem;
  font-size: 0.72rem;
  border-bottom: 1px dotted #2563eb;
  cursor: help;
}

/* Interactive live value — hover pops a breakdown, click pins it. */
.liveValue {
  cursor: pointer;
}

.liveValue:hover {
  background: rgba(37, 99, 235, 0.08);
  border-radius: 3px;
}

.liveValuePinned {
  background: rgba(37, 99, 235, 0.14);
  border-bottom-color: #1d4ed8;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.35);
}

/* Floating "what goes into this number" panel (portaled to <body>). */
.calcPanel {
  position: fixed;
  z-index: 1000;
  max-width: calc(100vw - 16px);
  overflow-y: auto;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.22);
  padding: 0.6rem 0.7rem;
  font-size: 0.74rem;
  color: var(--color-text);
  line-height: 1.4;
}

.calcHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.3rem;
}

.calcTitle {
  font-weight: 700;
  font-size: 0.8rem;
}

.calcBadge {
  font-size: 0.56rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: #15803d;
  background: rgba(34, 197, 94, 0.14);
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: 999px;
  padding: 0.05rem 0.4rem;
  white-space: nowrap;
}

.calcPinBtn {
  font-size: 0.56rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: #1d4ed8;
  background: rgba(37, 99, 235, 0.12);
  border: 1px solid #1d4ed8;
  border-radius: 999px;
  padding: 0.05rem 0.45rem;
  white-space: nowrap;
  cursor: pointer;
  font-family: inherit;
}

.calcPinBtn:hover { filter: brightness(0.97); }

.calcHeadActions {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
}

.calcExportBtn {
  font-size: 0.56rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: #047857;
  background: rgba(5, 150, 105, 0.1);
  border: 1px solid #047857;
  border-radius: 999px;
  padding: 0.05rem 0.45rem;
  white-space: nowrap;
  cursor: pointer;
  font-family: inherit;
}

.calcExportBtn:hover { filter: brightness(0.97); }

.calcValue {
  font-size: 1.05rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-bottom: 0.25rem;
}

.calcFormula {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  background: #f8fafc;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0.25rem 0.4rem;
  margin-bottom: 0.35rem;
  white-space: normal;
}

.calcInputs {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  margin-bottom: 0.35rem;
}

.calcInputRow {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.calcInputLabel { color: var(--color-text-muted); }

.calcInputVal {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.calcRows {
  margin-top: 0.3rem;
  border-top: 1px dashed var(--color-border);
  padding-top: 0.3rem;
}

.calcRowsHead {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--color-text-muted);
  margin-bottom: 0.2rem;
}

.calcTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.68rem;
}

.calcTable th,
.calcTable td {
  border-bottom: 1px solid var(--color-border);
  padding: 0.15rem 0.3rem;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}

.calcTable th {
  color: var(--color-text-muted);
  font-weight: 700;
  position: sticky;
  top: 0;
  background: var(--color-bg);
}

.calcNum {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.calcMore {
  font-size: 0.64rem;
  color: var(--color-text-muted);
  padding: 0.2rem 0.3rem;
  font-style: italic;
}

.calcSource {
  font-size: 0.64rem;
  font-style: italic;
  color: var(--color-text-muted);
  margin-top: 0.25rem;
}

.noBfoCell {
  color: #cbd5e1;
  font-size: 0.85rem;
}

.cellAmber {
  background: #fef3c7;
}

.numCell {
  text-align: left;
  font-variant-numeric: tabular-nums;
}

.midRow {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-start;
}

.midRow > .section {
  flex: 1 1 0;
  min-width: 0;
}

.bottomRow {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1fr;
  gap: 1rem;
  align-items: start;
}

.tinyTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.tinyTable th,
.tinyTable td {
  border: 1px solid var(--color-border);
  padding: 0.3rem 0.45rem;
  vertical-align: top;
}

.tinyTable th {
  background: #f8fafc;
  font-weight: 700;
  font-size: 0.74rem;
  white-space: nowrap;
}

.tinyTable td {
  white-space: normal;
  word-break: break-word;
}

/* Service Exploration Coverage — service picker + coverage bar + client
   chips. Sits above the Client Renewals table. */
.svcCovBody {
  padding: 0.7rem 0.85rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.svcCovLabel {
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.svcCovSelect {
  font-family: inherit;
  font-size: 0.82rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  min-width: 220px;
  max-width: 100%;
}

.svcCovSelect:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.svcCovSelect:disabled {
  cursor: default;
  opacity: 0.6;
}

/* Services table — one row per tracked service. */
.svcCovTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.svcCovTable th,
.svcCovTable td {
  border: 1px solid var(--color-border);
  padding: 0.35rem 0.5rem;
  vertical-align: middle;
}

.svcCovTable th {
  background: #f8fafc;
  font-weight: 700;
  font-size: 0.72rem;
  text-align: left;
  white-space: nowrap;
}

.svcCovThNum { width: 90px; text-align: right; }
.svcCovThRemove { width: 34px; }

.svcCovRow {
  cursor: pointer;
}

.svcCovRow:hover {
  background: rgba(37, 99, 235, 0.05);
}

.svcCovServiceCell {
  font-weight: 600;
  white-space: nowrap;
}

.svcCovChevron {
  display: inline-block;
  margin-right: 0.4rem;
  color: #94a3b8;
  font-size: 0.7rem;
  transition: transform 0.15s ease;
}

.svcCovChevronOpen {
  transform: rotate(90deg);
}

.svcCovNumCell {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.svcCovRowCoverage {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.svcCovRowCoverage .svcCovBarTrack {
  flex: 1;
  min-width: 80px;
}

.svcCovRowPct {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #2563eb;
  min-width: 34px;
  text-align: right;
}

.svcCovRemoveCell {
  text-align: center;
}

.svcCovRemoveBtn {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 0.25rem;
  font-family: inherit;
}

.svcCovRemoveBtn:hover {
  color: #ef4444;
}

.svcCovTableEmpty {
  color: var(--color-text-muted);
  font-style: italic;
  text-align: center;
  padding: 0.7rem !important;
}

.svcCovDetailRow > td {
  background: #f8fafc;
  padding: 0.6rem 0.75rem;
}

.svcCovAddRow {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.svcCovBarTrack {
  height: 10px;
  border-radius: 999px;
  background: #e2e8f0;
  overflow: hidden;
}

.svcCovBarFill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #22c55e, #16a34a);
  transition: width 0.25s ease;
}

.svcCovLists {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}

@media (max-width: 720px) {
  .svcCovLists { grid-template-columns: 1fr; }
}

.svcCovCol {
  min-width: 0;
}

.svcCovListHead {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
  margin-bottom: 0.35rem;
}

.svcCovChips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.svcCovChip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.svcCovChip:hover {
  filter: brightness(0.97);
  text-decoration: underline;
}

.svcCovChipYes {
  background: #dcfce7;
  border-color: #86efac;
  color: #166534;
}

.svcCovChipNo {
  background: #f1f5f9;
  border-color: #e2e8f0;
  color: #64748b;
}

.svcCovChipStatus {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  opacity: 0.8;
}

.svcCovNone {
  font-size: 0.74rem;
  font-style: italic;
  color: var(--color-text-muted);
}

.svcCovEmpty {
  font-size: 0.78rem;
  font-style: italic;
  color: var(--color-text-muted);
  padding: 0.3rem 0;
}

/* Strategy-notes text areas at the bottom of the page. */
.notesBody {
  padding: 0.6rem 0.75rem;
}

.notesTwoCol {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}

.notesArea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.82rem;
  line-height: 1.5;
  padding: 0.5rem 0.65rem;
}

.notesArea:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.delBtn {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 0 0.3rem;
}

.delBtn:hover {
  color: #ef4444;
}

.actionBtn {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.78rem;
  padding: 0.3rem 0.65rem;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
}

.actionBtn:hover {
  border-color: #2563eb;
}

/* Clickable client / contact names in the renewals table. */
.linkCell {
  color: #2563eb;
  cursor: pointer;
}

.linkCell:hover {
  text-decoration: underline;
}

/* Renewals rows for clients cancelling for sure — muted grey so lost
   accounts visually recede from the ones still in play. */
.cancelledRow td {
  color: #94a3b8;
  background: #f8fafc;
}

.cancelledRow .linkCell {
  color: #94a3b8;
}
````

### src/components/ProgressView/ProgressView.jsx

````jsx
import { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { buildCompanyIndex, hasMatchInIndex } from '../../utils/companyIndex';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';
import { dbGet } from '../../utils/db';
import { userLsGet } from '../../utils/userLs';
import { getOppsSheetCsvUrl } from '../../utils/oppsSheetUrl';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { matchesCdm } from '../../utils/cdmMatch';

function EditableCell({ value, onCommit, color, suffix = '', bold = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const display = value == null || value === '' ? '—' : `${value}${suffix}`;
  const tdStyle = { padding: '0.4rem 0.6rem', textAlign: 'center', fontWeight: bold ? 600 : 400, color: color || 'inherit', cursor: 'pointer' };
  if (editing) {
    return (
      <td style={{ ...tdStyle, padding: '0.25rem 0.4rem' }}>
        <input
          type="number"
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); onCommit(draft); }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.target.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          style={{ width: '100%', padding: '2px 4px', fontSize: '0.75rem', fontWeight: bold ? 600 : 400, color: color || 'inherit', border: '1px solid var(--color-border)', borderRadius: '4px', background: 'var(--color-surface)', textAlign: 'center', fontFamily: 'inherit' }}
        />
      </td>
    );
  }
  return (
    <td style={tdStyle} title="Click to edit" onClick={() => { setDraft(value == null ? '' : String(value)); setEditing(true); }}>
      {display}
    </td>
  );
}

const CHART_VIEW_OPTIONS = [
  { key: 'line', label: 'Line' },
  { key: 'stackedLine', label: 'Stacked Line' },
  { key: 'bar', label: 'Bar' },
  { key: 'stackedBar', label: 'Stacked Bar' },
  { key: 'area', label: 'Area' },
  { key: 'stackedArea', label: 'Stacked Area' },
];

// When a line-chart data point hits 100%, paint its dot dark green so a
// maxed-out metric jumps out at a glance.
const DARK_GREEN = '#15803D';
function makeDot(color, baseR) {
  function Dot(props) {
    const { cx, cy, value, index } = props;
    if (cx == null || cy == null) return null;
    const hit = value === 100;
    return (
      <circle
        key={`dot-${index}`}
        cx={cx}
        cy={cy}
        r={hit ? baseR + 1 : baseR}
        fill={hit ? DARK_GREEN : color}
        stroke={hit ? DARK_GREEN : color}
        strokeWidth={1}
      />
    );
  }
  return Dot;
}

// Build a derived dataset that adds, for each percent series, a parallel
// `${key}__green` key holding the value only where the point belongs to a
// dark-green segment (it, or a neighbor, hits 100%) and null elsewhere.
// A second Line drawn from this key with connectNulls=false overlays solid
// dark green exactly on the maxed-out stretches — far more reliable than an
// SVG stroke gradient, which renders inconsistently on near-flat lines.
function withGreenKeys(data, series) {
  return data.map((d, i) => {
    const row = { ...d };
    for (const s of series) {
      const v = d[s.key];
      const prev = i > 0 ? data[i - 1][s.key] : undefined;
      const next = i < data.length - 1 ? data[i + 1][s.key] : undefined;
      row[`${s.key}__green`] = (v === 100 || prev === 100 || next === 100) ? v : null;
    }
    return row;
  });
}

function ProgressChart({ title, data, series, isPct, defaultView = 'line', secondarySeries, onHide, onRename, onViewChange }) {
  const [viewType, setViewType] = useState(defaultView);
  // Persist the picked view so it becomes this chart's default next visit.
  const changeView = (v) => { setViewType(v); if (onViewChange) onViewChange(v); };
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  // For percent line charts, augment the data with the green-overlay keys.
  const lineData = useMemo(() => (isPct ? withGreenKeys(data, series) : data), [data, series, isPct]);
  // Legend payload with explicit flat colors (the green overlay lines opt
  // out of the legend, and secondary series keep their own color).
  const lineLegendPayload = [
    ...series.map(s => ({ value: s.name, type: 'line', id: s.key, color: s.color })),
    ...(Array.isArray(secondarySeries) ? secondarySeries : []).map(s => ({ value: s.name, type: 'line', id: s.key, color: s.color })),
  ];
  const yProps = isPct
    ? { domain: [0, 100], tickFormatter: v => `${v}%` }
    : { allowDecimals: false };
  const tooltipFmt = isPct ? (v => `${v}%`) : undefined;
  const stacked = viewType === 'stackedBar' || viewType === 'stackedArea' || viewType === 'stackedLine';
  const hasSecondary = Array.isArray(secondarySeries) && secondarySeries.length > 0;
  function commitTitle() {
    setEditingTitle(false);
    if (onRename) onRename(titleDraft);
  }
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {editingTitle ? (
          <input
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
            autoFocus
            style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', padding: '2px 6px', border: '1px solid var(--color-accent)', borderRadius: 4, background: 'var(--color-surface)', fontFamily: 'inherit', width: '100%', maxWidth: 400 }}
          />
        ) : (
          <h3
            onClick={onRename ? () => { setTitleDraft(title); setEditingTitle(true); } : undefined}
            title={onRename ? 'Click to rename' : undefined}
            style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', margin: 0, cursor: onRename ? 'text' : 'default' }}
          >{title}</h3>
        )}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <select
            value={viewType}
            onChange={e => changeView(e.target.value)}
            title="Chart view — your selection is saved as this chart's default"
            style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: '5px', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'inherit', cursor: 'pointer' }}
          >
            {CHART_VIEW_OPTIONS.map(opt => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
          {onHide && (
            <button
              type="button"
              onClick={onHide}
              title="Hide this chart"
              style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 5, color: 'var(--color-text-secondary)', cursor: 'pointer', padding: '0.1rem 0.45rem', fontSize: '0.8rem', lineHeight: 1, fontFamily: 'inherit' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
            >×</button>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={250}>
        {viewType === 'bar' || viewType === 'stackedBar' ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
            <YAxis yAxisId="left" fontSize={11} tick={{ fill: '#64748B' }} {...yProps} />
            {hasSecondary && <YAxis yAxisId="right" orientation="right" fontSize={11} tick={{ fill: '#64748B' }} allowDecimals={false} />}
            <Tooltip formatter={tooltipFmt} />
            <Legend />
            {series.map(s => (
              <Bar key={s.key} yAxisId="left" dataKey={s.key} name={s.name} fill={s.color} stackId={stacked ? 'a' : undefined} />
            ))}
            {hasSecondary && secondarySeries.map(s => (
              <Line key={s.key} yAxisId="right" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3, fill: s.color }} />
            ))}
          </BarChart>
        ) : viewType === 'area' || viewType === 'stackedArea' ? (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
            <YAxis yAxisId="left" fontSize={11} tick={{ fill: '#64748B' }} {...yProps} />
            {hasSecondary && <YAxis yAxisId="right" orientation="right" fontSize={11} tick={{ fill: '#64748B' }} allowDecimals={false} />}
            <Tooltip formatter={tooltipFmt} />
            <Legend />
            {series.map(s => (
              <Area key={s.key} yAxisId="left" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.3} stackId={stacked ? 'a' : undefined} />
            ))}
            {hasSecondary && secondarySeries.map(s => (
              <Line key={s.key} yAxisId="right" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3, fill: s.color }} />
            ))}
          </AreaChart>
        ) : viewType === 'stackedLine' ? (
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
            <YAxis yAxisId="left" fontSize={11} tick={{ fill: '#64748B' }} {...yProps} />
            {hasSecondary && <YAxis yAxisId="right" orientation="right" fontSize={11} tick={{ fill: '#64748B' }} allowDecimals={false} />}
            <Tooltip formatter={tooltipFmt} />
            <Legend />
            {series.map(s => (
              <Area key={s.key} yAxisId="left" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} fill="none" stackId="a" dot={isPct ? makeDot(s.color, 3) : { r: 3, fill: s.color }} activeDot={{ r: 5 }} />
            ))}
            {hasSecondary && secondarySeries.map(s => (
              <Line key={s.key} yAxisId="right" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3, fill: s.color }} />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={lineData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="weekLabel" fontSize={11} tick={{ fill: '#64748B' }} />
            <YAxis yAxisId="left" fontSize={11} tick={{ fill: '#64748B' }} {...yProps} />
            {hasSecondary && <YAxis yAxisId="right" orientation="right" fontSize={11} tick={{ fill: '#64748B' }} allowDecimals={false} />}
            <Tooltip formatter={tooltipFmt} payloadUniqBy={isPct ? (o => o.name) : undefined} />
            <Legend payload={isPct ? lineLegendPayload : undefined} />
            {series.map(s => (
              <Line key={s.key} yAxisId="left" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={isPct ? makeDot(s.color, 4) : { r: 4 }} />
            ))}
            {isPct && series.map(s => (
              // Solid dark-green overlay on the maxed-out (100%) stretches.
              <Line key={`${s.key}__green`} yAxisId="left" type="monotone" dataKey={`${s.key}__green`} name={s.name} stroke={DARK_GREEN} strokeWidth={2.5} dot={false} activeDot={false} connectNulls={false} legendType="none" isAnimationActive={false} />
            ))}
            {hasSecondary && secondarySeries.map(s => (
              <Line key={s.key} yAxisId="right" type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3, fill: s.color }} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

async function loadOppsFromIndexedDB() {
  try {
    const data = await loadOppsFromCache();
    return data?.records || [];
  } catch { return []; }
}

function getWeekKey(date) {
  let d;
  if (typeof date === 'string') {
    const [y, m, day] = date.split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date(date);
  }
  const dow = d.getDay();
  const diff = d.getDate() - dow + (dow === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  // Acronym / single-token match — "TIAA" vs "(TIAA) Teachers
  // Insurance and Annuity Association of America". Parens act as
  // word separators.
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

const HIDDEN_CHARTS_KEY = 'progress:hidden-charts';
const CHART_TITLES_KEY = 'progress:chart-titles';
const CHART_VIEWS_KEY = 'progress:chart-views';
const PROGRESS_CHART_DEFS = [
  { id: 'contactPct',     label: '% of Accounts with HubSpot Contacts' },
  { id: 'dmPct',          label: '% of Accounts with Decision Maker Identified' },
  { id: 'connectedPct',   label: '% of Accounts Connected (Had Opportunity)' },
  { id: 'inactivePct',    label: '% of Accounts Inactive (Lost / Hold Off / Old Client)' },
  { id: 'tierTotals',     label: 'My Accounts by Tier' },
  { id: 'noOppsActivity', label: 'Activity on Accounts with No Opportunities (30d)' },
  { id: 'peStages',       label: 'PE Firms by PE Stage' },
];

// PE Stage → snapshot field + chart color. Mirrors the four PE_STAGES on
// the PE Portfolio page so this chart tracks the same buckets. The snapshot
// stores one count per stage plus a rollup total.
const PE_STAGE_SERIES = [
  { stage: 'Discovery',            key: 'peDiscovery',           color: '#3B82F6' },
  { stage: 'Piloting',             key: 'pePiloting',            color: '#F59E0B' },
  { stage: 'Existing Partnership', key: 'peExistingPartnership', color: '#10B981' },
  { stage: 'Not Sold',             key: 'peNotSold',             color: '#DC2626' },
];
function loadHiddenCharts() {
  try {
    const raw = localStorage.getItem(HIDDEN_CHARTS_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch { return new Set(); }
}
function persistHiddenCharts(set) {
  try { localStorage.setItem(HIDDEN_CHARTS_KEY, JSON.stringify([...set])); } catch {}
}

function loadChartTitles() {
  try {
    const raw = localStorage.getItem(CHART_TITLES_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}
function persistChartTitles(map) {
  try { localStorage.setItem(CHART_TITLES_KEY, JSON.stringify(map)); } catch {}
}

// Per-chart default view (line / bar / area / …). Whatever view the user
// picks from a chart's dropdown is saved here keyed by chart id, so it
// becomes that chart's default on the next visit.
function loadChartViews() {
  try {
    const raw = localStorage.getItem(CHART_VIEWS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}
function persistChartViews(map) {
  try { localStorage.setItem(CHART_VIEWS_KEY, JSON.stringify(map)); } catch {}
}

export function ProgressView({ prospects, settings, cdmName }) {
  const { user, isAdmin } = useAuth();
  const [history, setHistory] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [oppsRecordsState, setOppsRecordsState] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCard, setExpandedCard] = useState(null);
  const [editingWeek, setEditingWeek] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [hubspotContactsState, setHubspotContactsState] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotContacts().then(c => { if (!cancelled) setHubspotContactsState(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);
  const [hiddenCharts, setHiddenCharts] = useState(() => loadHiddenCharts());
  const [showChartsMenu, setShowChartsMenu] = useState(false);
  const [chartTitles, setChartTitles] = useState(() => loadChartTitles());
  const [chartViews, setChartViews] = useState(() => loadChartViews());
  const setChartView = (id, view) => {
    setChartViews(prev => {
      const next = { ...prev, [id]: view };
      persistChartViews(next);
      return next;
    });
  };
  const toggleChartHidden = (id) => {
    setHiddenCharts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      persistHiddenCharts(next);
      return next;
    });
  };
  const renameChart = (id, nextTitle) => {
    setChartTitles(prev => {
      const next = { ...prev };
      const trimmed = (nextTitle || '').trim();
      if (trimmed) next[id] = trimmed;
      else delete next[id];
      persistChartTitles(next);
      return next;
    });
  };
  const titleFor = (id, fallback) => chartTitles[id] || fallback;
  const viewFor = (id, fallback = 'line') => chartViews[id] || fallback;

  // Load history from Firestore + opps data
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        const ref = doc(db, 'progressHistory', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const weeks = snap.data().weeks || [];
          console.log('[ProgressView] Firestore progressHistory loaded:', weeks.length, 'weeks:', weeks.map(w => w.week));
          setHistory(weeks);
          setHistoryLoaded(true);
        } else {
          console.log('[ProgressView] Firestore progressHistory doc does NOT exist for user', user.uid);
          setHistoryLoaded(true);
        }
      } catch (err) {
        console.error('[ProgressView] Failed to load progress — auto-save disabled to avoid overwrite:', err);
      }

      // Load opps: try the user's configured Opps sheet first, then
      // Firestore, then IndexedDB, then localStorage. When the user
      // hasn't configured a sheet (and isn't admin), skip the network
      // fetch entirely so we don't pull another user's data.
      let records = [];
      try {
        const oppsSheetUrl = getOppsSheetCsvUrl({ isAdmin, settings });
        const sheetRes = oppsSheetUrl ? await fetch(oppsSheetUrl) : null;
        if (sheetRes && sheetRes.ok) {
          const csvText = await sheetRes.text();
          const lines = csvText.split('\n');
          if (lines.length > 1) {
            // Parse CSV
            function parseLine(line) {
              const fields = []; let current = ''; let inQ = false;
              for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') { inQ = !inQ; continue; }
                if (ch === ',' && !inQ) { fields.push(current.trim()); current = ''; continue; }
                current += ch;
              }
              fields.push(current.trim());
              return fields;
            }
            const headers = parseLine(lines[0]);
            for (let i = 1; i < lines.length; i++) {
              if (!lines[i].trim()) continue;
              const vals = parseLine(lines[i]);
              const obj = {};
              let hasData = false;
              headers.forEach((h, j) => {
                const val = (vals[j] || '').trim();
                // For duplicate headers, keep the first non-empty value
                if (obj[h] !== undefined && obj[h] !== '' && obj[h] !== '-' && obj[h] !== '#N/A') return;
                obj[h] = val;
                if (val && val !== '-' && val !== '#N/A') hasData = true;
              });
              // Use first Stage column (skip duplicate)
              if (hasData && obj['Account']) records.push(obj);
            }
          }
        }
      } catch {}
      if (records.length === 0) {
        // Opps 2 is the canonical store. Fall back to the Opps 2
        // Firestore doc when the local IDB cache is empty (e.g. fresh
        // browser, never opened Opps 2 here yet).
        try {
          const oppsRef = doc(db, 'opps2Data', user.uid);
          const oppsSnap = await getDoc(oppsRef);
          if (oppsSnap.exists()) {
            const raw = oppsSnap.data();
            const parsed = raw.json ? JSON.parse(raw.json) : raw;
            records = parsed?.records || [];
          }
        } catch { /* ignore */ }
      }
      if (records.length === 0) {
        records = await loadOppsFromIndexedDB();
      }
      console.log(`Progress: loaded ${records.length} opps records`);
      setOppsRecordsState(records);
      setLoading(false);
    })();
  }, [user]);

  // Compute current week's snapshot
  const currentSnapshot = useMemo(() => {
    const targetMap = settings?.targetMap || {};
    // Only count the configured user's accounts (same filter as My Accounts)
    const myProspects = prospects.filter(p => matchesCdm(p.cdm, cdmName));
    const t1 = myProspects.filter(p => p.tier === 'Tier 1');
    const t2 = myProspects.filter(p => p.tier === 'Tier 2');
    const t3 = myProspects.filter(p => p.tier === 'Tier 3');

    // Load HubSpot cache for contact data (loaded async into hubspotContactsState)
    const hubspotContacts = hubspotContactsState;

    const contactCompanies = new Set();
    const contactDomains = new Set();
    const FREE_MAIL = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com']);
    for (const c of hubspotContacts) {
      const co = (c.company || '').toLowerCase();
      if (co) contactCompanies.add(co);
      if (c.email) {
        const at = c.email.lastIndexOf('@');
        if (at >= 0) {
          const d = c.email.slice(at + 1).toLowerCase().trim();
          if (d && !FREE_MAIL.has(d)) contactDomains.add(d);
        }
      }
    }

    // Use opps data loaded from Firestore/IndexedDB/localStorage
    // Build totalOppsByAccount the same way as My Accounts
    const oppsRecords = oppsRecordsState;
    const invalidStages = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);
    const closedStages = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
    const totalOppsByAccount = {};
    for (const r of oppsRecords) {
      const account = (r['Account'] || '').toLowerCase();
      const stage = (r['Stage'] || '').trim();
      if (!account || invalidStages.has(stage)) continue;
      totalOppsByAccount[account] = (totalOppsByAccount[account] || 0) + 1;
    }

    // Match the My Accounts contact-count rule: a prospect has contacts
    // if any HubSpot contact's Company text matches OR if its email
    // domain matches one of the prospect's registered email-domain or
    // website domains. Without the domain fallback, accounts like TIAA —
    // where contacts share "@tiaa.org" but their Company text varies —
    // get undercounted vs the My Accounts table.
    function prospectDomains(p) {
      const out = new Set();
      if (p?.emailDomain) {
        for (const entry of String(p.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
          const at = entry.lastIndexOf('@');
          const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
          if (d) out.add(d);
        }
      }
      if (p?.website) {
        const d = String(p.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
        if (d) out.add(d);
      }
      return out;
    }
    const contactCompaniesIndex = buildCompanyIndex([...contactCompanies]);
    function hasContact(p) {
      const lower = (p?.company || '').toLowerCase();
      if (hasMatchInIndex(contactCompaniesIndex, lower)) return true;
      for (const d of prospectDomains(p)) {
        if (contactDomains.has(d)) return true;
      }
      return false;
    }

    // Match the Opps column logic: account has opps if totalOppsByAccount > 0 (fuzzy match)
    const oppsKeysWithCount = Object.keys(totalOppsByAccount).filter(k => totalOppsByAccount[k] > 0);
    const oppsIndex = buildCompanyIndex(oppsKeysWithCount);
    function hasOpp(company) {
      const lower = (company || '').toLowerCase().trim();
      if (totalOppsByAccount[lower] > 0) return true;
      if (hasMatchInIndex(oppsIndex, lower)) return true;
      // First-word parent fallback (e.g. "Brookfield Asset Management" matches "Brookfield (X)")
      const firstWord = lower.split(/\s/)[0];
      if (firstWord.length >= 4) {
        for (const oppsCompany of oppsKeysWithCount) {
          if (oppsCompany.startsWith(firstWord)) return true;
        }
      }
      return false;
    }

    // Build DM companies set — companies with at least one contact tagged as Decision Maker
    const dmCompanies = new Set();
    for (const c of hubspotContacts) {
      const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
      if (tags.includes('decision maker')) {
        const co = (c.company || '').toLowerCase();
        if (co) dmCompanies.add(co);
      }
    }

    // Build per-company activity counts from the local activity cache —
    // 30-day window, same rule MyAccountsView uses. Powers the "No-Opps
    // Activity" chart (sum of activity events on accounts with zero
    // opps, so we can watch outreach stay alive on cold accounts).
    const activityByCompany = (() => {
      const counts = {};
      let cache = null;
      try { cache = JSON.parse(userLsGet('hubspot-activity-cache')); } catch {}
      if (!cache) return counts;
      const domainMap = new Map();
      const contactMap = new Map();
      for (const c of hubspotContacts) {
        if (c.email && c.company) contactMap.set(c.email.toLowerCase(), c.company.toLowerCase());
      }
      for (const p of myProspects) {
        if (p.emailDomain) {
          const entries = p.emailDomain.split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
          for (const entry of entries) {
            const atIdx = entry.lastIndexOf('@');
            const domain = atIdx >= 0 ? entry.slice(atIdx + 1).toLowerCase() : entry.toLowerCase();
            if (domain && p.company) domainMap.set(domain, p.company.toLowerCase());
          }
        }
        if (p.website) {
          const d = p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
          if (d && p.company) domainMap.set(d, p.company.toLowerCase());
        }
      }
      const matchCompany = (email) => {
        if (!email) return null;
        const parts = email.split(/[;,]/).map(s => s.trim().toLowerCase()).filter(Boolean);
        for (const e of parts) {
          if (e.endsWith('@se.com')) continue;
          if (contactMap.has(e)) return contactMap.get(e);
          const atIdx = e.lastIndexOf('@');
          if (atIdx >= 0) {
            const domain = e.slice(atIdx + 1);
            if (domainMap.has(domain)) return domainMap.get(domain);
          }
        }
        return null;
      };
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const e of (cache.emails || [])) {
        if (e.hs_timestamp && new Date(e.hs_timestamp).getTime() < thirtyDaysAgo) continue;
        const co = matchCompany(e.hs_email_to_email) || matchCompany(e.hs_email_from_email);
        if (co) counts[co] = (counts[co] || 0) + 1;
      }
      for (const c of (cache.calls || [])) {
        if (c.hs_timestamp && new Date(c.hs_timestamp).getTime() < thirtyDaysAgo) continue;
        const co = matchCompany(c.hs_call_to_number) || matchCompany(c.hs_call_from_number);
        if (co) counts[co] = (counts[co] || 0) + 1;
      }
      return counts;
    })();

    const dmCompaniesIndex = buildCompanyIndex([...dmCompanies]);
    function hasDM(company) {
      const lower = (company || '').toLowerCase();
      if (hasMatchInIndex(dmCompaniesIndex, lower)) return true;
      // Also check first-word match for parent companies
      const firstWord = lower.split(/\s/)[0];
      if (firstWord.length >= 4) {
        for (const co of dmCompanies) {
          if (co.startsWith(firstWord)) return true;
        }
      }
      return false;
    }

    const inactiveStatuses = new Set(['Lost - Not Sold', 'Hold Off', 'Old Client']);

    const t1Total = t1.length;
    const t2Total = t2.length;
    const t1WithContactsList = t1.filter(p => hasContact(p));
    const t2WithContactsList = t2.filter(p => hasContact(p));
    const t1WithDMList = t1.filter(p => hasDM(p.company));
    const t2WithDMList = t2.filter(p => hasDM(p.company));
    const t1ConnectedList = t1.filter(p => hasOpp(p.company));
    const t2ConnectedList = t2.filter(p => hasOpp(p.company));
    const t1InactiveList = t1.filter(p => inactiveStatuses.has(p.status));
    const t2InactiveList = t2.filter(p => inactiveStatuses.has(p.status));
    const t1WithContacts = t1WithContactsList.length;
    const t2WithContacts = t2WithContactsList.length;
    const t1WithDM = t1WithDMList.length;
    const t2WithDM = t2WithDMList.length;
    const t1Connected = t1ConnectedList.length;
    const t2Connected = t2ConnectedList.length;
    const t1Inactive = t1InactiveList.length;
    const t2Inactive = t2InactiveList.length;

    // Also build "not" lists
    const t1NoContacts = t1.filter(p => !hasContact(p));
    const t2NoContacts = t2.filter(p => !hasContact(p));
    const t1NoDM = t1.filter(p => !hasDM(p.company));
    const t2NoDM = t2.filter(p => !hasDM(p.company));
    const t1NotConnected = t1.filter(p => !hasOpp(p.company));
    const t2NotConnected = t2.filter(p => !hasOpp(p.company));

    // No-opps activity: sum 30-day activity event count across My
    // Accounts that DON'T have any opps — track outreach to cold
    // accounts. Also break out by tier so the chart can layer them.
    const sumActivity = (list) => list.reduce((s, p) => {
      const c = activityByCompany[(p.company || '').toLowerCase()] || 0;
      return s + c;
    }, 0);
    const noOppsActivityT1 = sumActivity(t1NotConnected);
    const noOppsActivityT2 = sumActivity(t2NotConnected);
    const noOppsActivityT3 = sumActivity(t3.filter(p => !hasOpp(p.company)));
    const noOppsActivityTotal = noOppsActivityT1 + noOppsActivityT2 + noOppsActivityT3;
    const noOppsAccountCount = t1NotConnected.length + t2NotConnected.length + t3.filter(p => !hasOpp(p.company)).length;

    // PE firms by PE Stage — mirrors the PE Portfolio page, which lists
    // every prospect typed "Private Equity" and buckets it by the peStage
    // set in its company popup (Discovery / Piloting / Existing Partnership
    // / Not Sold). No CDM filter here, to match that page's total.
    const peFirms = prospects.filter(p => p.type === 'Private Equity');
    const peStageCounts = {};
    const peStageDetails = {};
    for (const s of PE_STAGE_SERIES) { peStageCounts[s.key] = 0; peStageDetails[s.key] = []; }
    for (const p of peFirms) {
      const s = PE_STAGE_SERIES.find(x => x.stage === String(p.peStage || '').trim());
      if (!s) continue;
      peStageCounts[s.key]++;
      peStageDetails[s.key].push(p.company);
    }
    const peTotal = peFirms.length;

    return {
      week: getWeekKey(new Date()),
      t1Total, t2Total, t3Total: t3.length,
      tierCounts: { t1: t1.length, t2: t2.length, t3: t3.length },
      t1WithContacts, t2WithContacts,
      t1WithDM, t2WithDM,
      t1Connected, t2Connected,
      t1Inactive, t2Inactive,
      noOppsActivityT1,
      noOppsActivityT2,
      noOppsActivityT3,
      noOppsActivityTotal,
      noOppsAccountCount,
      ...peStageCounts,
      peTotal,
      t1ContactPct: t1Total > 0 ? Math.round((t1WithContacts / t1Total) * 100) : 0,
      t2ContactPct: t2Total > 0 ? Math.round((t2WithContacts / t2Total) * 100) : 0,
      t1DMPct: t1Total > 0 ? Math.round((t1WithDM / t1Total) * 100) : 0,
      t2DMPct: t2Total > 0 ? Math.round((t2WithDM / t2Total) * 100) : 0,
      t1ConnectedPct: t1Total > 0 ? Math.round((t1Connected / t1Total) * 100) : 0,
      t2ConnectedPct: t2Total > 0 ? Math.round((t2Connected / t2Total) * 100) : 0,
      t1InactivePct: t1Total > 0 ? Math.round((t1Inactive / t1Total) * 100) : 0,
      t2InactivePct: t2Total > 0 ? Math.round((t2Inactive / t2Total) * 100) : 0,
      // Detail lists for drill-down
      details: {
        t1WithContacts: t1WithContactsList.map(p => p.company),
        t1NoContacts: t1NoContacts.map(p => p.company),
        t2WithContacts: t2WithContactsList.map(p => p.company),
        t2NoContacts: t2NoContacts.map(p => p.company),
        t1WithDM: t1WithDMList.map(p => p.company),
        t1NoDM: t1NoDM.map(p => p.company),
        t2WithDM: t2WithDMList.map(p => p.company),
        t2NoDM: t2NoDM.map(p => p.company),
        t1Connected: t1ConnectedList.map(p => p.company),
        t1NotConnected: t1NotConnected.map(p => p.company),
        t2Connected: t2ConnectedList.map(p => p.company),
        t2NotConnected: t2NotConnected.map(p => p.company),
        t1Inactive: t1InactiveList.map(p => ({ company: p.company, status: p.status })),
        t2Inactive: t2InactiveList.map(p => ({ company: p.company, status: p.status })),
        ...peStageDetails,
      },
    };
  }, [prospects, settings, oppsRecordsState, hubspotContactsState, cdmName]);

  // Auto-save the current week whenever the snapshot numbers settle.
  // Re-fires on any snapshot-number change (not just mount) so the last
  // visit of the week "locks in" the final state even if the user never
  // clicks Save. Debounced so a single mount with streaming data doesn't
  // hammer Firestore.
  useEffect(() => {
    if (!user?.uid || loading || !historyLoaded) return;
    if (!currentSnapshot.t1Total) return; // prospects still loading
    const t = setTimeout(() => { saveSnapshot(); }, 800);
    return () => clearTimeout(t);
  }, [
    user?.uid, loading, historyLoaded,
    currentSnapshot.week,
    currentSnapshot.t1Total, currentSnapshot.t2Total, currentSnapshot.t3Total,
    currentSnapshot.t1WithContacts, currentSnapshot.t2WithContacts,
    currentSnapshot.t1WithDM, currentSnapshot.t2WithDM,
    currentSnapshot.t1Connected, currentSnapshot.t2Connected,
    currentSnapshot.t1Inactive, currentSnapshot.t2Inactive,
    currentSnapshot.noOppsActivityTotal, currentSnapshot.noOppsAccountCount,
    currentSnapshot.peTotal,
    currentSnapshot.peDiscovery, currentSnapshot.pePiloting,
    currentSnapshot.peExistingPartnership, currentSnapshot.peNotSold,
  ]);

  // Save current week snapshot — re-reads Firestore first to avoid overwriting
  // entries saved from another device or missed by a failed load.
  async function saveSnapshot() {
    if (!user?.uid) {
      console.warn('[ProgressView] saveSnapshot: no user uid, bailing');
      setSaveStatus('Not signed in');
      setTimeout(() => setSaveStatus(''), 3000);
      return;
    }
    console.log('[ProgressView] saveSnapshot: starting for week', currentSnapshot.week);
    setSaveStatus('Saving…');
    try {
      const ref = doc(db, 'progressHistory', user.uid);
      const snap = await getDoc(ref);
      const remoteWeeks = snap.exists() ? (snap.data().weeks || []) : [];
      const merged = [...remoteWeeks];
      for (const h of history) {
        if (!merged.find(m => m.week === h.week)) merged.push(h);
      }
      const idx = merged.findIndex(h => h.week === currentSnapshot.week);
      // Strip undefined values (Firestore rejects them)
      const clean = JSON.parse(JSON.stringify(currentSnapshot));
      if (idx >= 0) merged[idx] = clean;
      else merged.push(clean);
      merged.sort((a, b) => a.week.localeCompare(b.week));
      setHistory(merged);
      await setDoc(ref, { weeks: merged, updatedAt: new Date().toISOString() });
      console.log('[ProgressView] saveSnapshot: saved', merged.length, 'weeks');
      setSaveStatus(`Saved ✓ (${merged.length} week${merged.length === 1 ? '' : 's'})`);
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      console.error('[ProgressView] Failed to save progress:', err);
      setSaveStatus('Save failed: ' + (err?.message || err));
      setTimeout(() => setSaveStatus(''), 5000);
    }
  }

  // Edit a single numeric field on a historical week (or promote the current-week row into history)
  async function updateWeekField(weekKey, field, rawValue) {
    if (!user?.uid) return;
    const parsed = rawValue === '' || rawValue == null ? null : Number(rawValue);
    if (rawValue !== '' && Number.isNaN(parsed)) return;
    const inHistory = history.find(h => h.week === weekKey);
    const existingValue = inHistory ? inHistory[field] : currentSnapshot[field];
    if (parsed === existingValue) return;
    let updated;
    if (inHistory) {
      updated = history.map(h => h.week === weekKey ? { ...h, [field]: parsed } : h);
    } else {
      const clean = JSON.parse(JSON.stringify(currentSnapshot));
      updated = [...history, { ...clean, week: weekKey, [field]: parsed }];
    }
    updated.sort((a, b) => a.week.localeCompare(b.week));
    setHistory(updated);
    setSaveStatus('Saving…');
    try {
      const ref = doc(db, 'progressHistory', user.uid);
      await setDoc(ref, { weeks: updated, updatedAt: new Date().toISOString() });
      setSaveStatus('Saved ✓');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (err) {
      console.error('[ProgressView] Failed to save cell edit:', err);
      setSaveStatus('Save failed: ' + (err?.message || err));
      setTimeout(() => setSaveStatus(''), 5000);
    }
  }

  const chartData = useMemo(() => {
    const data = [...history];
    // Add current week if not already saved
    if (!data.find(h => h.week === currentSnapshot.week)) {
      data.push(currentSnapshot);
    } else {
      // Update current week with live data
      const idx = data.findIndex(h => h.week === currentSnapshot.week);
      data[idx] = currentSnapshot;
    }
    return data.map(d => ({
      ...d,
      weekLabel: new Date(d.week + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      totalAccounts: (d.t1Total || 0) + (d.t2Total || 0) + (d.t3Total || 0),
    }));
  }, [history, currentSnapshot]);

  function fmtWeek(w) {
    return new Date(w + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (loading) return <div style={{ padding: '2rem', color: 'var(--color-text-muted)' }}>Loading...</div>;

  return (
    <div style={{ padding: '1.5rem', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Weekly Progress</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {saveStatus && (
            <span style={{ fontSize: '0.75rem', color: saveStatus.startsWith('Saved') ? '#10B981' : saveStatus.startsWith('Sav') ? 'var(--color-text-secondary)' : '#DC2626', fontWeight: 600 }}>
              {saveStatus}
            </span>
          )}
          <button
            onClick={saveSnapshot}
            style={{
              padding: '0.4rem 0.8rem', border: 'none', borderRadius: '6px',
              background: 'var(--color-accent)', color: '#fff', fontSize: '0.8rem',
              fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            Save This Week's Snapshot
          </button>
        </div>
      </div>

      {/* Current stats */}
      {(() => {
        const cards = [
          { key: 'contacts', label: 'Accounts with Contacts', color: '#3B82F6', t1: currentSnapshot.t1WithContacts, t2: currentSnapshot.t2WithContacts, t1Pct: currentSnapshot.t1ContactPct, t2Pct: currentSnapshot.t2ContactPct,
            t1Yes: currentSnapshot.details?.t1WithContacts || [], t1No: currentSnapshot.details?.t1NoContacts || [],
            t2Yes: currentSnapshot.details?.t2WithContacts || [], t2No: currentSnapshot.details?.t2NoContacts || [] },
          { key: 'dm', label: 'Decision Maker Identified', color: '#7C3AED', t1: currentSnapshot.t1WithDM || 0, t2: currentSnapshot.t2WithDM || 0, t1Pct: currentSnapshot.t1DMPct || 0, t2Pct: currentSnapshot.t2DMPct || 0,
            t1Yes: currentSnapshot.details?.t1WithDM || [], t1No: currentSnapshot.details?.t1NoDM || [],
            t2Yes: currentSnapshot.details?.t2WithDM || [], t2No: currentSnapshot.details?.t2NoDM || [] },
          { key: 'connected', label: 'Connected (Had Opp)', color: '#10B981', t1: currentSnapshot.t1Connected, t2: currentSnapshot.t2Connected, t1Pct: currentSnapshot.t1ConnectedPct, t2Pct: currentSnapshot.t2ConnectedPct,
            t1Yes: currentSnapshot.details?.t1Connected || [], t1No: currentSnapshot.details?.t1NotConnected || [],
            t2Yes: currentSnapshot.details?.t2Connected || [], t2No: currentSnapshot.details?.t2NotConnected || [] },
          { key: 'inactive', label: 'Inactive (Lost/Hold/Old)', color: '#F59E0B', t1: currentSnapshot.t1Inactive, t2: currentSnapshot.t2Inactive, t1Pct: currentSnapshot.t1InactivePct, t2Pct: currentSnapshot.t2InactivePct,
            t1Yes: (currentSnapshot.details?.t1Inactive || []).map(x => typeof x === 'string' ? x : `${x.company} (${x.status})`),
            t1No: [], t2Yes: (currentSnapshot.details?.t2Inactive || []).map(x => typeof x === 'string' ? x : `${x.company} (${x.status})`), t2No: [] },
        ];
        return (
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', flex: expandedCard ? '0 0 55%' : '1' }}>
              {cards.map(card => (
                <div key={card.key} onClick={() => setExpandedCard(expandedCard === card.key ? null : card.key)}
                  style={{ padding: '0.75rem', background: expandedCard === card.key ? '#F0F9FF' : 'var(--color-surface)', border: expandedCard === card.key ? '2px solid ' + card.color : '1px solid var(--color-border)', borderRadius: '8px', borderLeft: `3px solid ${card.color}`, cursor: 'pointer' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{card.label}</div>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.3rem' }}>
                    <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#DC2626' }}>{card.t1Pct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T1 ({card.t1}/{currentSnapshot.t1Total})</span></div>
                    <div><span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#3B82F6' }}>{card.t2Pct}%</span> <span style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)' }}>T2 ({card.t2}/{currentSnapshot.t2Total})</span></div>
                  </div>
                </div>
              ))}
            </div>
            {expandedCard && (() => {
              const card = cards.find(c => c.key === expandedCard);
              if (!card) return null;
              return (
                <div style={{ flex: '0 0 50%', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '0.75rem', maxHeight: '300px', overflowY: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h4 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text)' }}>{card.label}</h4>
                    <button onClick={e => { e.stopPropagation(); setExpandedCard(null); }} style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1rem', cursor: 'pointer' }}>&times;</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#DC2626', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Tier 1 — Yes ({card.t1Yes.length})</div>
                      {card.t1Yes.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: 'var(--color-text)', padding: '1px 0' }}>{c}</div>)}
                      {card.key !== 'inactive' && card.t1No.length > 0 && (
                        <>
                          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginTop: '0.5rem', marginBottom: '0.3rem' }}>Tier 1 — No ({card.t1No.length})</div>
                          {card.t1No.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: '#9CA3AF', padding: '1px 0' }}>{c}</div>)}
                        </>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#3B82F6', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Tier 2 — Yes ({card.t2Yes.length})</div>
                      {card.t2Yes.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: 'var(--color-text)', padding: '1px 0' }}>{c}</div>)}
                      {card.key !== 'inactive' && card.t2No.length > 0 && (
                        <>
                          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', marginTop: '0.5rem', marginBottom: '0.3rem' }}>Tier 2 — No ({card.t2No.length})</div>
                          {card.t2No.map((c, i) => <div key={i} style={{ fontSize: '0.72rem', color: '#9CA3AF', padding: '1px 0' }}>{c}</div>)}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Charts */}
      {chartData.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowChartsMenu(v => !v)}
              title="Show / hide individual charts"
              style={{ padding: '0.3rem 0.7rem', border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
            >
              Charts <span style={{ opacity: 0.7 }}>({PROGRESS_CHART_DEFS.length - hiddenCharts.size}/{PROGRESS_CHART_DEFS.length})</span>
            </button>
            {showChartsMenu && (
              <div
                style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 50, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', minWidth: 280, padding: '0.4rem 0.5rem' }}
                onClick={e => e.stopPropagation()}
              >
                {PROGRESS_CHART_DEFS.map(c => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 2px', cursor: 'pointer', fontSize: '0.72rem' }}>
                    <input type="checkbox" checked={!hiddenCharts.has(c.id)} onChange={() => toggleChartHidden(c.id)} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
            {!hiddenCharts.has('contactPct') && (
              <ProgressChart
                title={titleFor('contactPct', '% of Accounts with HubSpot Contacts')}
                data={chartData}
                series={[{ key: 't1ContactPct', name: 'Tier 1', color: '#DC2626' }, { key: 't2ContactPct', name: 'Tier 2', color: '#3B82F6' }]}
                isPct
                defaultView={viewFor('contactPct')}
                onViewChange={(v) => setChartView('contactPct', v)}
                onHide={() => toggleChartHidden('contactPct')}
                onRename={(t) => renameChart('contactPct', t)}
              />
            )}
            {!hiddenCharts.has('dmPct') && (
              <ProgressChart
                title={titleFor('dmPct', '% of Accounts with Decision Maker Identified')}
                data={chartData}
                series={[{ key: 't1DMPct', name: 'Tier 1', color: '#DC2626' }, { key: 't2DMPct', name: 'Tier 2', color: '#3B82F6' }]}
                isPct
                defaultView={viewFor('dmPct')}
                onViewChange={(v) => setChartView('dmPct', v)}
                onHide={() => toggleChartHidden('dmPct')}
                onRename={(t) => renameChart('dmPct', t)}
              />
            )}
            {!hiddenCharts.has('connectedPct') && (
              <ProgressChart
                title={titleFor('connectedPct', '% of Accounts Connected (Had Opportunity)')}
                data={chartData}
                series={[{ key: 't1ConnectedPct', name: 'Tier 1', color: '#DC2626' }, { key: 't2ConnectedPct', name: 'Tier 2', color: '#3B82F6' }]}
                isPct
                defaultView={viewFor('connectedPct')}
                onViewChange={(v) => setChartView('connectedPct', v)}
                onHide={() => toggleChartHidden('connectedPct')}
                onRename={(t) => renameChart('connectedPct', t)}
              />
            )}
            {!hiddenCharts.has('inactivePct') && (
              <ProgressChart
                title={titleFor('inactivePct', '% of Accounts Inactive (Lost / Hold Off / Old Client)')}
                data={chartData}
                series={[{ key: 't1InactivePct', name: 'Tier 1', color: '#DC2626' }, { key: 't2InactivePct', name: 'Tier 2', color: '#3B82F6' }]}
                isPct
                defaultView={viewFor('inactivePct')}
                onViewChange={(v) => setChartView('inactivePct', v)}
                onHide={() => toggleChartHidden('inactivePct')}
                onRename={(t) => renameChart('inactivePct', t)}
              />
            )}
            {!hiddenCharts.has('tierTotals') && (
              <ProgressChart
                title={titleFor('tierTotals', 'My Accounts by Tier')}
                data={chartData}
                series={[
                  { key: 't1Total', name: 'Tier 1', color: '#DC2626' },
                  { key: 't2Total', name: 'Tier 2', color: '#3B82F6' },
                  { key: 't3Total', name: 'Tier 3', color: '#F59E0B' },
                ]}
                secondarySeries={[
                  { key: 'totalAccounts', name: 'Total Accounts', color: '#111827' },
                ]}
                defaultView={viewFor('tierTotals')}
                onViewChange={(v) => setChartView('tierTotals', v)}
                onHide={() => toggleChartHidden('tierTotals')}
                onRename={(t) => renameChart('tierTotals', t)}
              />
            )}
            {!hiddenCharts.has('noOppsActivity') && (
              <ProgressChart
                title={titleFor('noOppsActivity', 'Activity on Accounts with No Opportunities (30d)')}
                data={chartData}
                series={[
                  { key: 'noOppsActivityT1', name: 'Tier 1', color: '#DC2626' },
                  { key: 'noOppsActivityT2', name: 'Tier 2', color: '#3B82F6' },
                  { key: 'noOppsActivityT3', name: 'Tier 3', color: '#F59E0B' },
                ]}
                secondarySeries={[
                  { key: 'noOppsAccountCount', name: 'No-Opps Accounts', color: '#111827' },
                ]}
                defaultView={viewFor('noOppsActivity')}
                onViewChange={(v) => setChartView('noOppsActivity', v)}
                onHide={() => toggleChartHidden('noOppsActivity')}
                onRename={(t) => renameChart('noOppsActivity', t)}
              />
            )}
            {!hiddenCharts.has('peStages') && (
              <ProgressChart
                title={titleFor('peStages', 'PE Firms by PE Stage')}
                data={chartData}
                series={PE_STAGE_SERIES.map(s => ({ key: s.key, name: s.stage, color: s.color }))}
                secondarySeries={[
                  { key: 'peTotal', name: 'Total PE Firms', color: '#111827' },
                ]}
                defaultView={viewFor('peStages', 'stackedBar')}
                onViewChange={(v) => setChartView('peStages', v)}
                onHide={() => toggleChartHidden('peStages')}
                onRename={(t) => renameChart('peStages', t)}
              />
            )}
          </div>

          {/* History table */}
          {chartData.length > 0 && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
              <h3 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)', margin: 0, padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)' }}>Weekly History</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-alt)' }}>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', borderBottom: '1px solid var(--color-border)' }}>Week</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#F59E0B', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T3</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1 Contacts</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2 Contacts</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1 Connected</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2 Connected</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#DC2626', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T1 Inactive</th>
                    <th style={{ padding: '0.45rem 0.6rem', textAlign: 'center', fontWeight: 600, color: '#3B82F6', fontSize: '0.68rem', borderBottom: '1px solid var(--color-border)' }}>T2 Inactive</th>
                    <th style={{ padding: '0.45rem 0.6rem', width: '36px', borderBottom: '1px solid var(--color-border)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {[...chartData].reverse().map((h, i) => (
                    <tr key={h.week} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                      <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600, color: 'var(--color-text)' }}>
                        {editingWeek === h.week ? (
                          <input
                            type="date"
                            defaultValue={h.week}
                            autoFocus
                            style={{ fontSize: '0.75rem', fontWeight: 600, border: '1px solid var(--color-border)', borderRadius: '4px', padding: '2px 4px', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                            onBlur={async (e) => {
                              const newDate = e.target.value;
                              setEditingWeek(null);
                              if (!newDate || newDate === h.week) return;
                              const newWeek = getWeekKey(newDate);
                              if (newWeek === h.week) return;
                              if (history.find(x => x.week === newWeek)) {
                                alert('A snapshot for that week already exists.');
                                return;
                              }
                              const inHistory = history.find(x => x.week === h.week);
                              let updated;
                              if (inHistory) {
                                updated = history.map(x => x.week === h.week ? { ...x, week: newWeek } : x);
                              } else {
                                // Editing the not-yet-saved current-week row: create a new history entry
                                const clean = JSON.parse(JSON.stringify(currentSnapshot));
                                updated = [...history, { ...clean, week: newWeek }];
                              }
                              updated.sort((a, b) => a.week.localeCompare(b.week));
                              setHistory(updated);
                              setSaveStatus('Saving…');
                              try {
                                const ref = doc(db, 'progressHistory', user.uid);
                                await setDoc(ref, { weeks: updated, updatedAt: new Date().toISOString() });
                                setSaveStatus('Saved ✓');
                                setTimeout(() => setSaveStatus(''), 3000);
                              } catch (err) {
                                console.error('[ProgressView] Failed to save week edit:', err);
                                setSaveStatus('Save failed: ' + (err?.message || err));
                                setTimeout(() => setSaveStatus(''), 5000);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.target.blur();
                              if (e.key === 'Escape') setEditingWeek(null);
                            }}
                          />
                        ) : (
                          <span
                            style={{ cursor: 'pointer', borderBottom: '1px dashed var(--color-border)' }}
                            onClick={() => setEditingWeek(h.week)}
                            title="Click to change week"
                          >
                            {fmtWeek(h.week)}
                          </span>
                        )}
                      </td>
                      <EditableCell value={h.t1Total} onCommit={v => updateWeekField(h.week, 't1Total', v)} color="#DC2626" bold />
                      <EditableCell value={h.t2Total} onCommit={v => updateWeekField(h.week, 't2Total', v)} color="#3B82F6" bold />
                      <EditableCell value={h.t3Total} onCommit={v => updateWeekField(h.week, 't3Total', v)} color="#F59E0B" bold />
                      <EditableCell value={h.t1ContactPct} onCommit={v => updateWeekField(h.week, 't1ContactPct', v)} suffix="%" />
                      <EditableCell value={h.t2ContactPct} onCommit={v => updateWeekField(h.week, 't2ContactPct', v)} suffix="%" />
                      <EditableCell value={h.t1ConnectedPct} onCommit={v => updateWeekField(h.week, 't1ConnectedPct', v)} suffix="%" />
                      <EditableCell value={h.t2ConnectedPct} onCommit={v => updateWeekField(h.week, 't2ConnectedPct', v)} suffix="%" />
                      <EditableCell value={h.t1InactivePct} onCommit={v => updateWeekField(h.week, 't1InactivePct', v)} suffix="%" />
                      <EditableCell value={h.t2InactivePct} onCommit={v => updateWeekField(h.week, 't2InactivePct', v)} suffix="%" />
                      <td style={{ padding: '0.4rem 0.3rem', textAlign: 'center' }}>
                        <button
                          onClick={() => {
                            const updated = history.filter((_, j) => j !== history.length - 1 - i);
                            setHistory(updated);
                            const ref = doc(db, 'progressHistory', user.uid);
                            setDoc(ref, { weeks: updated, updatedAt: new Date().toISOString() });
                          }}
                          style={{ background: 'none', border: 'none', color: '#CBD5E1', fontSize: '0.85rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                          onMouseEnter={e => e.target.style.color = '#EF4444'}
                          onMouseLeave={e => e.target.style.color = '#CBD5E1'}
                        >&times;</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
````

### src/components/YOYView/YOYView.jsx

````jsx
// YOY tab — recreates the Leads / Quoted Projections / Close Rate
// summary charts off the Opps tab data cached in IndexedDB.

import { useEffect, useMemo, useState, useRef, useCallback, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LabelList, Cell,
} from 'recharts';
import { dbGet } from '../../utils/db';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { loadCommissions } from '../../utils/commissionsStore';
import { loadDealsList } from '../../utils/dealsStore';
import { DEAL_BFO_KEY } from '../../utils/dealCommissions';
import { asNumber, dealYear } from '../../utils/dealsFormat';
import { loadQuotedProjections, saveQuotedProjections, QUOTED_FIELDS } from '../../utils/quotedProjectionsStore';
import { loadYoyOverrides, saveYoyOverrides } from '../../utils/yoyOverridesStore';
import { loadHiddenCharts, saveHiddenCharts } from '../../utils/yoyHiddenChartsStore';
import styles from './YOYView.module.css';

const PIPELINE_STORE = 'pipeline-dashboard';
const PIPELINE_KEY = 'current';
const DEFAULT_ANNUAL_TARGET = 1325000;

// Lets any ChartHeader open the shared data editor for its chart without
// threading a callback through every card. Provided by YOYView around the
// chart grid; value is `openEditor(chartId)`.
const EditChartContext = createContext(null);

// Lets any ChartHeader hide its own chart without threading a callback
// through every card. Provided by YOYView around the chart grid; value is
// `hideChart(chartId)`.
const HideChartContext = createContext(null);

// Display names for the hidden-chart restore chips, keyed by the same id
// each ChartHeader hides under.
const YOY_CHART_TITLES = {
  leads: 'Leads',
  quotedProjections: 'Quoted Projections',
  closeRate: 'Close Rate',
  leadSources: 'Lead Sources 2020+',
  quotedByYear: 'Quoted (Thousands)',
  notSolds: 'Not Solds',
  topAccounts: 'Top Accounts',
  annualSales: 'Annual Sales',
  dealSize: 'Deal Size',
  commissions: 'Commissions',
};

// Describes which plotted fields of each chart the "Edit data" popup can
// overwrite. keyField identifies a row (its x-axis category); fields are
// the plotted numbers, each with a display label and a kind that drives
// formatting of the computed-value placeholder. `recompute(row, fields,
// ctx)` optionally re-derives dependent fields (totals / %s) after an
// override is applied so on-chart labels stay consistent. Quoted
// Projections is intentionally absent — it already has its own editor.
const YOY_CHART_EDITS = {
  leads: {
    title: 'Leads', keyField: 'year', keyLabel: 'Year',
    fields: [{ key: 'count', label: 'Leads', kind: 'int' }],
  },
  closeRate: {
    title: 'Close Rate', keyField: 'year', keyLabel: 'Open Year',
    fields: [
      { key: 'totalNotSold', label: 'Total Not Sold %', kind: 'pct' },
      { key: 'totalSold', label: 'Total Sold %', kind: 'pct' },
      { key: 'inProgress', label: 'In Progress %', kind: 'pct' },
      { key: 'quotedCR', label: 'Quoted C/R %', kind: 'pct' },
      { key: 'totalCR', label: 'Total C/R %', kind: 'pct' },
    ],
  },
  leadSources: {
    title: 'Lead Sources 2020+', keyField: 'source', keyLabel: 'Lead Source',
    fields: [
      { key: 'inProgress', label: 'In Progress', kind: 'int' },
      { key: 'notSold', label: 'Not Sold', kind: 'int' },
      { key: 'sold', label: 'Sold', kind: 'int' },
      { key: 'closeRate', label: 'Close Rate %', kind: 'ratioPct' },
    ],
    // Total (used for sorting) and the row-end close-rate label are derived
    // from the counts — unless the close-rate data label was overridden.
    recompute: (r, _fields, _ctx, ov) => {
      const sold = Number(r.sold) || 0;
      const notSold = Number(r.notSold) || 0;
      const inProgress = Number(r.inProgress) || 0;
      const decided = sold + notSold;
      return {
        ...r,
        total: inProgress + notSold + sold,
        closeRate: ov && ov.has('closeRate') ? r.closeRate : (decided ? sold / decided : null),
      };
    },
  },
  quotedByYear: {
    title: 'Quoted (Thousands)', keyField: 'year', keyLabel: 'Quoted Year',
    fields: [{ key: 'thousands', label: 'Quoted ($k)', kind: 'int' }],
  },
  notSolds: {
    title: 'Not Solds', keyField: 'year', keyLabel: 'Open Year',
    fields: [
      { key: 'notSold', label: 'Not Solds', kind: 'int' },
      { key: 'avgOppLife', label: 'Avg Opp Life (days)', kind: 'int' },
      { key: 'ageNotQuoted', label: 'Age of not Quoted (days)', kind: 'int' },
      { key: 'quoteToClose', label: 'Quote to Close (days)', kind: 'int' },
    ],
  },
  topAccounts: {
    title: 'Top Accounts', keyField: 'year', keyLabel: 'Year',
    // Columns are the top-account names + Remaining, so they're supplied
    // per-render from the data rather than fixed here.
    dynamic: true,
    // _total is the bar-top data label = sum of the account stacks +
    // Remaining, unless the user overrode the Total directly.
    recompute: (r, fields, _ctx, ov) => {
      if (ov && ov.has('_total')) return { ...r, _total: Math.round(Number(r._total) || 0) };
      let total = 0;
      for (const f of fields) { if (f.key === '_total') continue; total += Number(r[f.key]) || 0; }
      return { ...r, _total: Math.round(total) };
    },
  },
  annualSales: {
    title: 'Annual Sales', keyField: 'year', keyLabel: 'Year',
    fields: [
      { key: 'currentClient', label: 'Current Client ($)', kind: 'money' },
      { key: 'newClient', label: 'New Client ($)', kind: 'money' },
      { key: '_total', label: 'Total ($)', kind: 'money' },
      { key: 'pctQuota', label: '% Quota', kind: 'pct' },
    ],
    // Total and % Quota are the bar-top data labels. Each derives from the
    // two client segments (and the annual target) unless overridden.
    recompute: (r, _fields, ctx, ov) => {
      const total = (ov && ov.has('_total'))
        ? (Number(r._total) || 0)
        : (Number(r.currentClient) || 0) + (Number(r.newClient) || 0);
      const tgt = ctx?.annualTarget || 0;
      const pctQuota = (ov && ov.has('pctQuota'))
        ? r.pctQuota
        : (tgt > 0 ? Math.round((total / tgt) * 100) : r.pctQuota);
      return { ...r, _total: Math.round(total), pctQuota };
    },
  },
  dealSize: {
    title: 'Deal Size', keyField: 'year', keyLabel: 'Year',
    fields: [
      { key: 'deals', label: 'Deals (Sold)', kind: 'int' },
      { key: 'quoted', label: 'Quoted mean ($)', kind: 'money' },
      { key: 'dealSize', label: 'Deal Size avg ($)', kind: 'money' },
    ],
  },
  commissions: {
    title: 'Commissions', keyField: 'year', keyLabel: 'Year',
    fields: [{ key: 'total', label: 'Commissions ($)', kind: 'money' }],
  },
};

// Apply a chart's saved overrides onto its computed rows. Only the fields
// present in a row's override patch are replaced (with finite numbers);
// everything else stays as computed. When a row is touched, the chart's
// optional recompute() re-derives dependent fields. Returns the original
// array reference untouched when the chart has no overrides.
function applyYoyOverrides(rows, cfg, table, ctx, fieldsOverride) {
  if (!table || !rows || rows.length === 0) return rows;
  const fields = fieldsOverride || cfg.fields || [];
  let changed = false;
  const out = rows.map((r) => {
    const patch = table[String(r[cfg.keyField])];
    if (!patch) return r;
    let next = { ...r };
    const overridden = new Set();
    for (const f of fields) {
      const v = patch[f.key];
      if (v != null && Number.isFinite(Number(v))) { next[f.key] = Number(v); overridden.add(f.key); }
    }
    if (overridden.size === 0) return r;
    // recompute re-derives dependent fields, but must leave any field the
    // user overrode directly (e.g. an edited Total / % Quota data label)
    // untouched — so it's told which keys were explicitly set.
    if (cfg.recompute) next = cfg.recompute(next, fields, ctx, overridden);
    changed = true;
    return next;
  });
  return changed ? out : rows;
}

// Drop empty ($0 / blank) years from the leading and trailing edges of a
// year-series so the chart doesn't open or close on bare axis ticks (e.g.
// 2015–2017 before the first commission). Interior empty years are kept —
// blanking a gap year would misleadingly slide two real years together.
// `field` is the plotted value that defines "empty"; returns the same
// array reference when nothing needs trimming.
function trimEmptyEdgeYears(rows, field = 'total') {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  let start = 0;
  let end = rows.length - 1;
  const hasValue = (r) => Number(r?.[field]) > 0;
  while (start <= end && !hasValue(rows[start])) start++;
  while (end >= start && !hasValue(rows[end])) end--;
  return (start === 0 && end === rows.length - 1) ? rows : rows.slice(start, end + 1);
}

// Format a computed value for the editor's placeholder, so the user sees
// what the live number is before typing a replacement.
function fmtOverrideValue(v, kind) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return '';
  const n = Number(v);
  if (kind === 'money') return `$${Math.round(n).toLocaleString('en-US')}`;
  if (kind === 'pct') return `${n}%`;
  // A 0–1 ratio the chart draws as a whole-number percent (e.g. close rate).
  if (kind === 'ratioPct') return `${Math.round(n * 100)}%`;
  return n.toLocaleString('en-US');
}
// BFO Activity cache — pasted BFO pipeline rows, used to total the live
// "BFO Pipe Total" for the current Quoted Projections month.
const BFO_ACTIVITY_STORE = 'bfo-activity';
const BFO_ACTIVITY_KEY = 'current';
// Closed stages don't belong in the live quoted pipeline buckets.
const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);

function parseMoney(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^0-9.-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Total pipeline $ from the BFO Activity table — sum of its "Amount"
// column across every pasted row. Returns null when no BFO data is
// cached so the chart leaves that point blank instead of plotting $0.
function sumBfoPipe(bfo) {
  if (!bfo || !Array.isArray(bfo.rows) || bfo.rows.length === 0 || !Array.isArray(bfo.headers)) return null;
  const amountCol = bfo.headers.find(h => /^amount$/i.test(h));
  if (!amountCol) return null;
  let sum = 0;
  let any = false;
  for (const r of bfo.rows) {
    const amt = parseMoney(r[amountCol]);
    if (typeof amt === 'number' && Number.isFinite(amt)) { sum += amt; any = true; }
  }
  return any ? sum : null;
}

// Calendar-month key ("YYYY-MM") matching the Quoted Projections table
// keys, for the month `nowMs` falls in.
function currentMonthKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseYear(v) {
  // Pull the first standalone 4-digit year out of the value. This keeps
  // plain "2026" working while still recognising date-formatted Open Year
  // cells like "2026-06-01" or "6/1/2026" — stripping every non-digit
  // first would turn those into 20260601 / 612026 and lose the year.
  const m = String(v ?? '').match(/(?:19|20)\d{2}/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1900 && n <= 2100 ? n : null;
}

// Calendar year of a Close Date string (e.g. "6/1/2026" or "2026-06-01").
// Returns null when the value is empty or unparseable. A bare ISO date
// (YYYY-MM-DD) is read by Date.parse as UTC midnight, which lands on the
// previous day — and so can roll back to the previous year — in a
// negative-offset timezone. Pull the UTC parts back for ISO strings so a
// 2026-01-01 close stays in 2026; slash/locale strings parse as local
// and are already correct. Mirrors OppsView2's parseCloseDate.
function parseDateYear(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const ts = Date.parse(s);
  if (Number.isNaN(ts)) return null;
  const d = new Date(ts);
  const y = /^\d{4}-\d{2}/.test(s) ? d.getUTCFullYear() : d.getFullYear();
  return Number.isFinite(y) && y >= 1900 && y <= 2100 ? y : null;
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// June 2026 was never captured before the month-end auto-persist existed,
// leaving a gap on the chart. It's backfilled once with today's live values.
const JUNE_2026_KEY = '2026-06';

// Quoted Projections runs on a Dec-to-Nov fiscal year, starting in
// December of the previous calendar year and ending in November of the
// current calendar year. Returns 12 buckets each { label, year,
// monthIdx, key } so a Close Date can be looked up in O(1).
function fiscalMonths(currentYear) {
  const months = [];
  for (let i = 0; i < 12; i++) {
    const monthIdx = (11 + i) % 12; // 11 = Dec, 0 = Jan, …, 10 = Nov
    const year = i === 0 ? currentYear - 1 : currentYear;
    months.push({
      label: MONTH_LABELS[monthIdx],
      year,
      monthIdx,
      key: `${year}-${monthIdx}`,
    });
  }
  return months;
}

// Status values that mean the opp got priced. Used as the Quoted+
// filter for Quoted C/R denominator.
const QUOTED_PLUS_STATUSES = new Set([
  'Quoted', 'Contracting', 'Agreement Sent', 'Sold', 'Not Sold',
]);

function isQuotedPlus(record) {
  const status = String(record.Status || '').trim();
  if (QUOTED_PLUS_STATUSES.has(status)) return true;
  const amt = parseMoney(record['Quoted Amount']);
  return typeof amt === 'number' && amt > 0;
}

// Annualization factor for "Projected" lead bar — scale YTD count up
// to a full year based on fraction of the year elapsed.
function yearElapsedFraction(year) {
  const now = new Date();
  if (year !== now.getFullYear()) return 1;
  const start = new Date(year, 0, 1).getTime();
  const elapsedMs = now.getTime() - start;
  const yearMs = (new Date(year + 1, 0, 1).getTime() - start);
  const frac = elapsedMs / yearMs;
  return Math.max(1 / 366, Math.min(1, frac));
}

function fmtMoneyShort(n) {
  if (n == null || !Number.isFinite(n)) return '';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}`;
  return `$${Math.round(n)}`;
}

function fmtMoneyFull(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// Quoted Projections values are stored in thousands of dollars ($K), so
// e.g. 757 → "$757K" and 4061 → "$4.06M".
function fmtKLabel(v) {
  if (v == null || !Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(2)}M`;
  return `$${Math.round(v).toLocaleString('en-US')}K`;
}

// To keep the explanation from ever covering the bars/points being
// reviewed, the hover content is rendered into a single docked panel
// (sticky strip at the top of the YOY body) instead of floating over
// the plot. This context carries a ref to that panel down to the
// per-chart tooltips; CalcTooltip portals its content into it. Only one
// chart is hovered at a time, so a shared panel is enough.
const CalcPanelContext = createContext(null);

// Recharts still owns the cursor highlight, but we suppress its floating
// box by portaling the content away — keep its wrapper from reserving
// space or eating pointer events just in case the portal target is
// missing (then it falls back to a small floating box).
const TOOLTIP_WRAPPER_STYLE = { pointerEvents: 'none', zIndex: 30 };

export function YOYView() {
  const [opps, setOpps] = useState(null);
  const [bfo, setBfo] = useState(null);
  const [target, setTarget] = useState(DEFAULT_ANNUAL_TARGET);
  const [commissions, setCommissions] = useState(() => loadCommissions().data);
  const [deals, setDeals] = useState(() => loadDealsList().data);
  // Quoted Projections is now a user-maintained table of month-end values
  // (seeded with the supplied Dec–May history) rather than a live compute.
  const [quotedTable, setQuotedTable] = useState(loadQuotedProjections);
  const updateQuotedTable = (next) => { setQuotedTable(next); saveQuotedProjections(next); };
  // User overrides for every chart's data points (per-user localStorage).
  // Applied on top of the live-computed rows so a corrected value wins.
  const [overrides, setOverrides] = useState(loadYoyOverrides);
  // Which chart's data editor is open (chartId | null).
  const [editingChart, setEditingChart] = useState(null);
  // Charts the user has hidden (per-user localStorage). A Set backs the
  // per-render lookups; the stored form is a plain array.
  const [hiddenCharts, setHiddenCharts] = useState(loadHiddenCharts);
  const hiddenSet = useMemo(() => new Set(hiddenCharts), [hiddenCharts]);
  const hideChart = useCallback((chartId) => {
    setHiddenCharts((prev) => {
      if (prev.includes(chartId)) return prev;
      const next = [...prev, chartId];
      saveHiddenCharts(next);
      return next;
    });
  }, []);
  const showChart = useCallback((chartId) => {
    setHiddenCharts((prev) => {
      if (!prev.includes(chartId)) return prev;
      const next = prev.filter((id) => id !== chartId);
      saveHiddenCharts(next);
      return next;
    });
  }, []);
  const showAllCharts = useCallback(() => {
    setHiddenCharts([]);
    saveHiddenCharts([]);
  }, []);
  // Persist a chart's override table; an empty table clears it entirely.
  const saveChartOverrides = useCallback((chartId, table) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (table && Object.keys(table).length) next[chartId] = table;
      else delete next[chartId];
      saveYoyOverrides(next);
      return next;
    });
    setEditingChart(null);
  }, []);
  // Fiscal target that the Annual Sales % Quota override recompute needs.
  const editCtx = useMemo(
    () => ({ annualTarget: target > 0 ? target : DEFAULT_ANNUAL_TARGET }),
    [target],
  );
  useEffect(() => {
    function onStorage(e) {
      if (!e || e.key === 'commissions-list-override') {
        setCommissions(loadCommissions().data);
      }
      if (!e || e.key === 'deals-list-override') {
        setDeals(loadDealsList().data);
      }
    }
    function onFocus() {
      setCommissions(loadCommissions().data);
      setDeals(loadDealsList().data);
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const oppsSaved = await loadOppsFromCache();
        if (!cancelled && oppsSaved) setOpps(oppsSaved);
      } catch (e) {
        console.warn('YOY opps hydrate failed', e);
      }
      try {
        const bfoSaved = await dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY);
        if (!cancelled && bfoSaved) setBfo(bfoSaved);
      } catch {
        // BFO Pipe Total just stays blank for the live month — no-op.
      }
      try {
        const pipe = await dbGet(PIPELINE_STORE, PIPELINE_KEY);
        if (!cancelled && pipe && Number.isFinite(Number(pipe.target))) {
          setTarget(Number(pipe.target));
        }
      } catch {
        // Pipeline target falls back to DEFAULT_ANNUAL_TARGET — no-op.
      }
    })();
    function onFocus() {
      loadOppsFromCache().then(o => setOpps(o || null)).catch(() => {});
      dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY).then(b => setBfo(b || null)).catch(() => {});
      dbGet(PIPELINE_STORE, PIPELINE_KEY).then(p => {
        if (p && Number.isFinite(Number(p.target))) setTarget(Number(p.target));
      }).catch(() => {});
    }
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, []);

  const records = useMemo(() => (opps && Array.isArray(opps.records)) ? opps.records : [], [opps]);

  const currentYear = new Date().getFullYear();

  // Leads — count of opps by Open Year. Bars go from earliest non-empty
  // year through the current year, then a separate "Projected" bar that
  // annualizes the current year's YTD count.
  const leadsBase = useMemo(() => {
    if (records.length === 0) return [];
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      byYear.set(y, (byYear.get(y) || 0) + 1);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      rows.push({ year: String(y), count: byYear.get(y) || 0, isProjected: false });
    }
    const ytdCount = byYear.get(currentYear) || 0;
    const frac = yearElapsedFraction(currentYear);
    const projected = frac > 0 ? Math.round(ytdCount / frac) : ytdCount;
    // _ytd / _frac feed the hover tooltip so the Projected bar can show
    // its annualization (YTD count ÷ fraction of year elapsed).
    rows.push({ year: 'Projected', count: projected, isProjected: true, _ytd: ytdCount, _frac: frac });
    return rows;
  }, [records, currentYear]);
  const leadsData = useMemo(
    () => applyYoyOverrides(leadsBase, YOY_CHART_EDITS.leads, overrides.leads, editCtx),
    [leadsBase, overrides, editCtx],
  );

  // Quoted Projections — month-end snapshots the user records (editable
  // via "Edit values"), plotted across the Dec→Nov fiscal year. Values
  // are in $K: weak/ok/expected are the quoted-$ Chance buckets,
  // agreements is Agreements Sent, and bfoPipe is the total BFO pipeline
  // $ (its own right-hand axis since it runs larger). Months with no
  // recorded value are left null so the lines break rather than zeroing.
  // Live snapshot for the in-progress (current calendar) month, computed
  // off the Opps 2 cache + BFO Activity so the user doesn't have to hand-
  // enter it. weak/ok/expected = open quoted-$ by Chance bucket;
  // agreements = open Quoted-$ with Status "Agreement Sent"; bfoPipe =
  // total BFO Activity Amount. All in $K. A 0 bucket → null so the line
  // doesn't dip to $0 for an empty category.
  const liveCurrentMonth = useMemo(() => {
    if (records.length === 0) return null;
    let weak = 0, ok = 0, expected = 0, agreements = 0;
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      if (CLOSED_STAGES.has(stage)) continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      if (!amt) continue;
      const chance = String(r['Chance?'] ?? r['Chance'] ?? '').trim().toLowerCase();
      if (chance === 'weak') weak += amt;
      else if (chance === 'ok') ok += amt;
      else if (chance === 'expected') expected += amt;
      // "Agreement Sent" is a Stage value (the Stage column uses the
      // `status` dropdown list — see OppsView2 DROPDOWN config), not the
      // free-text Status column. Match on Stage so the live month's
      // Agreements Sent total isn't always $0.
      if (stage === 'Agreement Sent') agreements += amt;
    }
    const toK = (n) => (n > 0 ? n / 1000 : null);
    const pipe = sumBfoPipe(bfo);
    return {
      weak: toK(weak), ok: toK(ok), expected: toK(expected),
      agreements: toK(agreements), bfoPipe: pipe != null ? pipe / 1000 : null,
    };
  }, [records, bfo]);

  const quotedData = useMemo(() => {
    const num = (x) => {
      if (x === '' || x == null) return null;
      const n = Number(x);
      return Number.isFinite(n) ? n : null;
    };
    const liveKey = currentMonthKey();
    return fiscalMonths(currentYear).map((m) => {
      const key = `${m.year}-${String(m.monthIdx + 1).padStart(2, '0')}`;
      // Manually-recorded values win; otherwise the current month falls
      // back to the live Opps 2 / BFO computation. An `_auto` entry is the
      // persisted copy of a live snapshot (written by the auto-capture
      // effect below) — while it's still the current month we keep showing
      // the freshly-computed live values, and once the month rolls over the
      // persisted copy becomes the fixed month-end figure so it doesn't
      // vanish. A manual save clears `_auto` and always wins.
      const rawSaved = quotedTable[key] || null;
      const manualSaved = rawSaved && !rawSaved._auto ? rawSaved : null;
      const isLive = !manualSaved && key === liveKey && liveCurrentMonth != null;
      const v = manualSaved || (isLive ? liveCurrentMonth : rawSaved);
      const weak = v ? num(v.weak) : null;
      const ok = v ? num(v.ok) : null;
      const expected = v ? num(v.expected) : null;
      const agreements = v ? num(v.agreements) : null;
      const bfoPipe = v ? num(v.bfoPipe) : null;
      const _hasData = [weak, ok, expected, agreements, bfoPipe].some(x => x != null);
      return { month: m.label, year: m.year, monthKey: key, weak, ok, expected, agreements, bfoPipe, _hasData, _live: isLive && _hasData };
    });
  }, [quotedTable, currentYear, liveCurrentMonth]);

  // Persist the live current-month snapshot so it survives the calendar
  // roll-over, and one-time backfill the June 2026 gap. Previously the
  // in-progress month was only ever computed live and never written, so on
  // the 1st of the next month it reverted to a gap — that's how June's
  // figures vanished once July began. Both writes are batched into a single
  // update to avoid one clobbering the other.
  useEffect(() => {
    if (!liveCurrentMonth) return;
    // Round the live snapshot to whole $K, matching what "Edit values"
    // stores. Returns null when nothing computed.
    const liveSnap = () => {
      const snap = {};
      let any = false;
      for (const f of QUOTED_FIELDS) {
        const val = liveCurrentMonth[f];
        if (val != null && Number.isFinite(val)) { snap[f] = Math.round(val); any = true; }
      }
      return any ? snap : null;
    };
    const patch = {};
    // 1) Mirror the live current month under an `_auto` flag. The flag keeps
    //    the month "live" — still recomputed for display and overwritable —
    //    until it rolls over into a fixed month-end figure. A manual save
    //    clears it and always wins.
    const curKey = currentMonthKey();
    const curExisting = quotedTable[curKey];
    if (!curExisting || curExisting._auto) {
      const snap = liveSnap();
      const unchanged = snap && curExisting && curExisting._auto &&
        QUOTED_FIELDS.every(f => (curExisting[f] ?? null) === (snap[f] ?? null));
      if (snap && !unchanged) patch[curKey] = { ...snap, _auto: true };
    }
    // 2) One-time backfill: June 2026 predates the auto-persist above, so
    //    its point is a gap and its real month-end values are unrecoverable.
    //    Fill it with today's live values (a deliberate stand-in) as a fixed
    //    recorded entry the user can correct via "Edit values". Scoped to the
    //    2026 fiscal year — the only time June 2026 is on the chart — and
    //    self-limiting: once written it persists and won't be re-filled.
    if (currentYear === 2026 && !quotedTable[JUNE_2026_KEY]) {
      const snap = liveSnap();
      if (snap) patch[JUNE_2026_KEY] = snap; // no `_auto` → fixed, editable
    }
    if (Object.keys(patch).length === 0) return;
    updateQuotedTable({ ...quotedTable, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCurrentMonth]);

  // Close Rate — stacked bar of In Progress / Sold / Not Sold per Open
  // Year (percentages summing to 100), plus two C/R lines.
  const closeRateBase = useMemo(() => {
    if (records.length === 0) return [];
    // Group records by year.
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(r);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      const list = byYear.get(y) || [];
      let sold = 0, notSold = 0, inProgress = 0, quotedNotSold = 0;
      for (const r of list) {
        const stage = String(r.Stage || '').trim();
        if (stage === 'Sold') sold += 1;
        else if (stage === 'Not Sold') {
          notSold += 1;
          if (isQuotedPlus(r)) quotedNotSold += 1;
        } else {
          inProgress += 1;
        }
      }
      const total = sold + notSold + inProgress;
      // Total C/R — every Sold/Not Sold opp counts.
      const totalCR = (sold + notSold) > 0 ? (sold / (sold + notSold)) * 100 : null;
      // Quoted C/R — Not Sold restricted to opps that actually reached
      // Quoted+ (priced). Sold opps are Quoted+ by definition.
      const quotedDenom = sold + quotedNotSold;
      const quotedCR = quotedDenom > 0 ? (sold / quotedDenom) * 100 : null;
      rows.push({
        year: String(y),
        totalNotSold: total > 0 ? +((notSold / total) * 100).toFixed(2) : 0,
        totalSold: total > 0 ? +((sold / total) * 100).toFixed(2) : 0,
        inProgress: total > 0 ? +((inProgress / total) * 100).toFixed(2) : 0,
        totalCR: totalCR == null ? null : +totalCR.toFixed(2),
        quotedCR: quotedCR == null ? null : +quotedCR.toFixed(2),
        // Raw counts behind the percentages / C/R lines, surfaced in the
        // hover tooltip so each year's math can be audited.
        _sold: sold,
        _notSold: notSold,
        _inProgress: inProgress,
        _quotedNotSold: quotedNotSold,
        _total: total,
      });
    }
    return rows;
  }, [records, currentYear]);
  const closeRateData = useMemo(
    () => applyYoyOverrides(closeRateBase, YOY_CHART_EDITS.closeRate, overrides.closeRate, editCtx),
    [closeRateBase, overrides, editCtx],
  );

  // Lead Sources 2020+ — horizontal stacked bars per source value with
  // counts of In Progress / Not Sold / Sold plus the Sold-count and
  // close-rate (Sold / (Sold + Not Sold)) label at the end of each row.
  // `Lead Source` is preferred; we fall back to `Source` per the column
  // names already used elsewhere (PipelineView).
  const leadSourcesBase = useMemo(() => {
    if (records.length === 0) return [];
    const byKey = new Map();
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null || y < 2020) continue;
      const src = String(r['Lead Source'] || r['Source'] || '').trim();
      if (!src || src === '-' || src === '#N/A') continue;
      const stage = String(r.Stage || '').trim();
      let bucket;
      if (stage === 'Sold') bucket = 'sold';
      else if (stage === 'Not Sold') bucket = 'notSold';
      else bucket = 'inProgress';
      if (!byKey.has(src)) byKey.set(src, { source: src, inProgress: 0, notSold: 0, sold: 0 });
      byKey.get(src)[bucket] += 1;
    }
    if (byKey.size === 0) return [];
    const rows = Array.from(byKey.values()).map(r => {
      const closeDenom = r.sold + r.notSold;
      const closeRate = closeDenom > 0 ? r.sold / closeDenom : null;
      const total = r.inProgress + r.notSold + r.sold;
      return { ...r, total, closeRate };
    });
    // Sort descending by total so the biggest source sits on top, matching
    // the screenshot layout.
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [records]);
  const leadSourcesData = useMemo(
    () => applyYoyOverrides(leadSourcesBase, YOY_CHART_EDITS.leadSources, overrides.leadSources, editCtx),
    [leadSourcesBase, overrides, editCtx],
  );

  // Quoted (Thousands) — sum of Quoted Amount bucketed by the calendar
  // year of each opp's Quoted On date (any stage), displayed in $k. Opps
  // without a parseable Quoted On date are excluded since they have no
  // quote year to attribute. Includes a Projected bar for the current year.
  const quotedByYearBase = useMemo(() => {
    if (records.length === 0) return [];
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const ts = Date.parse(r['Quoted On'] || r['Quoted Date'] || '');
      if (Number.isNaN(ts)) continue;
      const y = new Date(ts).getFullYear();
      if (!Number.isFinite(y) || y < 1900 || y > 2100) continue;
      const amt = parseMoney(r['Quoted Amount']);
      const v = (typeof amt === 'number' && Number.isFinite(amt)) ? amt : 0;
      byYear.set(y, (byYear.get(y) || 0) + v);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      const total = byYear.get(y) || 0;
      rows.push({
        year: String(y),
        thousands: Math.round(total / 1000),
        isProjected: false,
      });
    }
    const ytd = byYear.get(currentYear) || 0;
    const frac = yearElapsedFraction(currentYear);
    const projected = frac > 0 ? Math.round((ytd / frac) / 1000) : Math.round(ytd / 1000);
    // _ytdThousands / _frac let the tooltip explain the Projected bar.
    rows.push({
      year: 'Projected', thousands: projected, isProjected: true,
      _ytdThousands: Math.round(ytd / 1000), _frac: frac,
    });
    return rows;
  }, [records, currentYear]);
  const quotedByYearData = useMemo(
    () => applyYoyOverrides(quotedByYearBase, YOY_CHART_EDITS.quotedByYear, overrides.quotedByYear, editCtx),
    [quotedByYearBase, overrides, editCtx],
  );

  // Not Solds — count of Stage=Not Sold per Open Year + Projected, with
  // three day-count lines on the same axis:
  //   Avg Opp Life      — mean Age across Sold + Not Sold opps that year.
  //   Age of not Quoted — mean Age across opps still in pre-quote stages
  //                       (Lead / Not Started / Qualifying / Quoting).
  //   Quote to Close    — mean (Close Date − Quoted On) for closed opps
  //                       that have a parseable Quoted On / Quoted Date.
  const notSoldsBase = useMemo(() => {
    if (records.length === 0) return [];
    const NOT_QUOTED_STAGES = new Set(['Lead', 'Not Started', 'Qualifying', 'Quoting']);
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(r);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      const list = byYear.get(y) || [];
      let notSold = 0;
      let lifeSum = 0, lifeCount = 0;
      let notQuotedSum = 0, notQuotedCount = 0;
      let qtcSum = 0, qtcCount = 0;
      for (const r of list) {
        const stage = String(r.Stage || '').trim();
        if (stage === 'Not Sold') notSold += 1;
        const age = Number(String(r.Age ?? '').replace(/[^0-9.-]/g, ''));
        const closedStage = (stage === 'Sold' || stage === 'Not Sold');
        if (closedStage && Number.isFinite(age)) { lifeSum += age; lifeCount += 1; }
        if (NOT_QUOTED_STAGES.has(stage) && Number.isFinite(age)) {
          notQuotedSum += age; notQuotedCount += 1;
        }
        if (closedStage) {
          const quotedOn = r['Quoted On'] || r['Quoted Date'] || '';
          const closeDate = r['Close Date'] || '';
          const qt = Date.parse(quotedOn);
          const ct = Date.parse(closeDate);
          if (!Number.isNaN(qt) && !Number.isNaN(ct) && ct >= qt) {
            qtcSum += (ct - qt) / 86400000;
            qtcCount += 1;
          }
        }
      }
      rows.push({
        year: String(y),
        notSold,
        isProjected: false,
        avgOppLife: lifeCount > 0 ? Math.round(lifeSum / lifeCount) : null,
        ageNotQuoted: notQuotedCount > 0 ? Math.round(notQuotedSum / notQuotedCount) : null,
        quoteToClose: qtcCount > 0 ? Math.round(qtcSum / qtcCount) : null,
        // Sample sizes behind each averaged line, surfaced in the tooltip.
        _lifeCount: lifeCount,
        _notQuotedCount: notQuotedCount,
        _qtcCount: qtcCount,
      });
    }
    // Projected Not Sold bar — annualize the current year's count.
    const ytdNotSold = (byYear.get(currentYear) || []).filter(r => String(r.Stage || '').trim() === 'Not Sold').length;
    const frac = yearElapsedFraction(currentYear);
    const projected = frac > 0 ? Math.round(ytdNotSold / frac) : ytdNotSold;
    rows.push({
      year: 'Projected', notSold: projected, isProjected: true,
      avgOppLife: null, ageNotQuoted: null, quoteToClose: null,
      _ytdNotSold: ytdNotSold, _frac: frac,
    });
    return rows;
  }, [records, currentYear]);
  const notSoldsData = useMemo(
    () => applyYoyOverrides(notSoldsBase, YOY_CHART_EDITS.notSolds, overrides.notSolds, editCtx),
    [notSoldsBase, overrides, editCtx],
  );

  // Year range for the Top Accounts chart — min-year-with-data →
  // max(currentYear, maxYearInData) span by Open Year so future-dated
  // Open Years (e.g. 2026 entered while the browser clock still reads
  // 2025) still get a bar. (Annual Sales and Deal Size derive their own
  // spans from Close Date years.)
  const yearRange = useMemo(() => {
    if (records.length === 0) return [];
    let minYear = currentYear;
    let maxYear = currentYear;
    let any = false;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      any = true;
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (!any) return [];
    const out = [];
    for (let y = minYear; y <= maxYear; y++) out.push(y);
    return out;
  }, [records, currentYear]);

  // Top Accounts — pick the top 4 accounts by lifetime Sold $, then
  // stack per Open Year. Everything outside the top-4 lumps into the
  // "Remaining" bucket. The Projected bar for the current year adds
  // YTD Sold $ + the in-progress pipeline (opps opened this year that
  // haven't closed yet) using the same per-account breakdown.
  const topAccountsBase = useMemo(() => {
    if (records.length === 0 || yearRange.length === 0) return { years: [], topAccounts: [], colors: {} };
    const lifetimeSold = new Map();
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      if (stage !== 'Sold') continue;
      const account = String(r.Account || '').trim();
      if (!account) continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      lifetimeSold.set(account, (lifetimeSold.get(account) || 0) + amt);
    }
    const topAccounts = Array.from(lifetimeSold.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name]) => name);
    const topSet = new Set(topAccounts);
    // Positional colors so the 1st top account is always blue, then red,
    // yellow, purple. Remaining is always green.
    const colors = {
      [topAccounts[0]]: '#3b82f6',
      [topAccounts[1]]: '#ef4444',
      [topAccounts[2]]: '#facc15',
      [topAccounts[3]]: '#a855f7',
      Remaining: '#22c55e',
    };
    // Year buckets — Sold $ split per top account + Remaining.
    const buckets = new Map();
    for (const y of yearRange) {
      const row = { year: String(y), _total: 0, Remaining: 0 };
      for (const a of topAccounts) row[a] = 0;
      buckets.set(y, row);
    }
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      if (stage !== 'Sold') continue;
      const y = parseYear(r['Open Year']);
      if (y === null || !buckets.has(y)) continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      const account = String(r.Account || '').trim();
      const row = buckets.get(y);
      if (topSet.has(account)) row[account] += amt;
      else row.Remaining += amt;
      row._total += amt;
    }
    const rows = Array.from(buckets.values()).map(r => ({
      ...r,
      year: r.year,
      _total: Math.round(r._total),
      Remaining: Math.round(r.Remaining),
      ...Object.fromEntries(topAccounts.map(a => [a, Math.round(r[a])])),
    }));
    // Projected bar — sum of pipeline (any opp with Open Year = current,
    // Stage NOT in Sold/Not Sold) added to YTD Sold $.
    const projected = { year: 'Projected', _total: 0, Remaining: 0, _isProjected: true };
    for (const a of topAccounts) projected[a] = 0;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y !== currentYear) continue;
      const stage = String(r.Stage || '').trim();
      if (stage === 'Not Sold') continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      if (!amt) continue;
      const account = String(r.Account || '').trim();
      if (topSet.has(account)) projected[account] += amt;
      else projected.Remaining += amt;
      projected._total += amt;
    }
    projected._total = Math.round(projected._total);
    projected.Remaining = Math.round(projected.Remaining);
    for (const a of topAccounts) projected[a] = Math.round(projected[a]);
    rows.push(projected);
    return { years: rows, topAccounts, colors };
  }, [records, yearRange, currentYear]);
  // The overridable columns for Top Accounts are the per-account stacks +
  // Remaining, discovered from the computed data.
  const topAccountsFields = useMemo(() => ([
    ...(topAccountsBase.topAccounts || []).map(a => ({ key: a, label: a, kind: 'money' })),
    { key: 'Remaining', label: 'Remaining', kind: 'money' },
    { key: '_total', label: 'Total ($)', kind: 'money' },
  ]), [topAccountsBase]);
  const topAccountsData = useMemo(() => {
    const years = applyYoyOverrides(topAccountsBase.years, YOY_CHART_EDITS.topAccounts, overrides.topAccounts, editCtx, topAccountsFields);
    return years === topAccountsBase.years ? topAccountsBase : { ...topAccountsBase, years };
  }, [topAccountsBase, topAccountsFields, overrides, editCtx]);

  // Annual Sales — Sold Quoted Amount per *Close Date* year split into
  // Current Client vs New Client buckets. Current Client classification
  // mirrors the regex PipelineView uses (client|existing|renewal|
  // cross-sell|expansion|upsell on the Lead Source value). Each bar also
  // carries the list of deals that make up its total (`_deals`) so the
  // hover panel can show — and the user can export — the contributors.
  const annualSalesBase = useMemo(() => {
    if (records.length === 0) return [];
    const CLIENT_RE = /client|existing|renewal|cross[\s-]?sell|expansion|upsell/i;
    const annualTarget = target > 0 ? target : DEFAULT_ANNUAL_TARGET;
    const dealFor = (r, y, src, amt) => ({
      Account: String(r.Account || '').trim(),
      'Close Date': r['Close Date'] || '',
      Year: y,
      'Lead Source': src,
      'Client Bucket': CLIENT_RE.test(src) ? 'Current Client' : 'New Client',
      'Quoted Amount': Math.round(amt),
    });
    // Collect Sold deals keyed by the year of their Close Date (falling
    // back to Open Year if the Close Date is missing/unparseable), and
    // track the min→max span so every year in between gets a bar.
    const sold = [];
    let minYear = currentYear, maxYear = currentYear, any = false;
    for (const r of records) {
      if (String(r.Stage || '').trim() !== 'Sold') continue;
      const y = parseDateYear(r['Close Date']) ?? parseYear(r['Open Year']);
      if (y === null) continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      const src = String(r['Lead Source'] || r['Source'] || '');
      sold.push({ y, amt, isClient: CLIENT_RE.test(src), deal: dealFor(r, y, src, amt) });
      any = true;
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (!any) return [];
    const buckets = new Map();
    for (let y = minYear; y <= maxYear; y++) {
      buckets.set(y, { year: String(y), currentClient: 0, newClient: 0, _total: 0, _isProjected: false, _deals: [] });
    }
    for (const s of sold) {
      const row = buckets.get(s.y);
      if (!row) continue;
      if (s.isClient) row.currentClient += s.amt;
      else row.newClient += s.amt;
      row._total += s.amt;
      row._deals.push(s.deal);
    }
    const sortDeals = (a, b) => b['Quoted Amount'] - a['Quoted Amount'] || a.Account.localeCompare(b.Account);
    const rows = Array.from(buckets.values()).map(r => ({
      ...r,
      currentClient: Math.round(r.currentClient),
      newClient: Math.round(r.newClient),
      _total: Math.round(r._total),
      pctQuota: annualTarget > 0 ? Math.round((r._total / annualTarget) * 100) : null,
      _deals: r._deals.sort(sortDeals),
    }));
    // Projected — this year's Sold deals plus every still-open opp in the
    // late-stage pipeline: Stage "Agreement Sent" or "Contracting".
    // Closed/Not-Sold opps and prior-year Sold are excluded; Sold is counted
    // once here, so the pipeline branch skips closed stages to avoid
    // double-counting.
    let projCurrent = 0, projNew = 0;
    const projDeals = [];
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      const amt = parseMoney(r['Quoted Amount']) || 0;
      if (!amt) continue;
      let include = false;
      if (stage === 'Sold') {
        const y = parseDateYear(r['Close Date']) ?? parseYear(r['Open Year']);
        include = y === currentYear;
      } else {
        include = stage === 'Agreement Sent' || stage === 'Contracting';
      }
      if (!include) continue;
      const src = String(r['Lead Source'] || r['Source'] || '');
      if (CLIENT_RE.test(src)) projCurrent += amt;
      else projNew += amt;
      projDeals.push({ ...dealFor(r, currentYear, src, amt), Stage: stage });
    }
    const projTotal = projCurrent + projNew;
    rows.push({
      year: 'Projected',
      currentClient: Math.round(projCurrent),
      newClient: Math.round(projNew),
      _total: Math.round(projTotal),
      pctQuota: annualTarget > 0 ? Math.round((projTotal / annualTarget) * 100) : null,
      _isProjected: true,
      _deals: projDeals.sort(sortDeals),
    });
    return rows;
  }, [records, currentYear, target]);
  const annualSalesData = useMemo(
    () => applyYoyOverrides(annualSalesBase, YOY_CHART_EDITS.annualSales, overrides.annualSales, editCtx),
    [annualSalesBase, overrides, editCtx],
  );

  // Deal Size — composed chart. The bars and blue line are bucketed by
  // Closed Year (calendar year of Close Date, falling back to Open Year
  // when Close Date is missing/unparseable); the red line is bucketed
  // independently by the year each opp was quoted (its Quoted On date):
  //   Deals (gray bars)     = count of Sold opps (won deals), by Closed Year
  //   Deal Size (blue line) = avg Quoted Amount of Sold opps, by Closed Year
  //   Quoted (red line)     = avg Quoted Amount of opps quoted that year,
  //                           by Quoted Year (Quoted On date)
  // The year span covers both the closed years (bars/blue) and the quoted
  // years (red) so neither series is clipped. The Projected bar counts
  // this year's Sold deals plus opps in the Agreement Sent stage, treated
  // as expected future wins.
  const dealSizeBase = useMemo(() => {
    if (records.length === 0) return [];
    // Closed opps feed the bars + blue line (by Closed Year); quoted opps
    // feed the red line (by Quoted Year). Track the combined min→max span.
    let minYear = currentYear, maxYear = currentYear, any = false;
    const bump = (y) => {
      if (y == null) return;
      any = true;
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    };
    const closed = []; // { cy, stage, amt|null }
    const quoted = []; // { qy, amt }
    for (const r of records) {
      const amt = parseMoney(r['Quoted Amount']);
      const hasAmt = typeof amt === 'number' && amt > 0;
      // Red line: any opp quoted (has a Quoted On date + positive amount),
      // regardless of stage — an average of every quote written that year.
      const qy = hasAmt ? parseDateYear(r['Quoted On'] || r['Quoted Date'] || '') : null;
      if (qy != null) { quoted.push({ qy, amt }); bump(qy); }
      // Bars + blue line: closed opps only, by Closed Year.
      const stage = String(r.Stage || '').trim();
      if (stage !== 'Sold' && stage !== 'Not Sold') continue;
      const cy = parseDateYear(r['Close Date']) ?? parseYear(r['Open Year']);
      if (cy === null) continue;
      closed.push({ cy, stage, amt: hasAmt ? amt : null });
      bump(cy);
    }
    if (!any) return [];
    const stats = new Map();
    for (let y = minYear; y <= maxYear; y++) {
      stats.set(y, { soldOppCount: 0, quotedSum: 0, quotedCount: 0, soldSum: 0, soldCount: 0 });
    }
    for (const { cy, stage, amt } of closed) {
      const s = stats.get(cy);
      if (!s) continue;
      // Grey bars count won deals — every Sold opp, regardless of amount.
      if (stage === 'Sold') {
        s.soldOppCount += 1;
        if (amt != null) { s.soldSum += amt; s.soldCount += 1; }
      }
    }
    for (const { qy, amt } of quoted) {
      const s = stats.get(qy);
      if (!s) continue;
      s.quotedSum += amt;
      s.quotedCount += 1;
    }
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      const s = stats.get(y);
      rows.push({
        year: String(y),
        deals: s.soldOppCount,
        quoted: s.quotedCount > 0 ? Math.round(s.quotedSum / s.quotedCount) : null,
        dealSize: s.soldCount > 0 ? Math.round(s.soldSum / s.soldCount) : null,
        _isProjected: false,
        // Sample sizes behind the Quoted / Deal Size mean lines.
        _quotedCount: s.quotedCount,
        _soldCount: s.soldCount,
      });
    }
    // Projected — deals Sold this year (by Closed Year) plus every opp
    // still in the Agreement Sent stage, counted as expected future wins.
    // Not Sold opps and earlier-stage pipeline are excluded from the bar
    // count. The red Quoted point is the average of every opp quoted this
    // calendar year; the blue Deal Size point is the average Sold $ closed
    // this year.
    // Projected point: the Deals bar counts this year's Sold deals plus
    // every Agreement Sent opp (expected future wins). The Quoted point is
    // the mean Quoted Amount across *only* those same opps — this year's
    // Sold deals and the active Agreement Sent pipeline — deliberately
    // excluding opps in any other stage. Deal Size is intentionally not
    // projected, so its point is left blank (null) for this bar.
    let projWon = 0, projPipeline = 0, projQuotedSum = 0, projQuotedCount = 0;
    for (const r of records) {
      const amt = parseMoney(r['Quoted Amount']);
      const hasAmt = typeof amt === 'number' && amt > 0;
      const stage = String(r.Stage || '').trim();
      const isClosed = (stage === 'Sold' || stage === 'Not Sold');
      if (isClosed) {
        const y = parseDateYear(r['Close Date']) ?? parseYear(r['Open Year']);
        if (y !== currentYear) continue;
        if (stage === 'Sold') {
          projWon += 1;
          if (hasAmt) { projQuotedSum += amt; projQuotedCount += 1; }
        }
      } else if (stage === 'Agreement Sent') {
        projPipeline += 1;
        if (hasAmt) { projQuotedSum += amt; projQuotedCount += 1; }
      }
    }
    rows.push({
      year: 'Projected',
      deals: projWon + projPipeline,
      quoted: projQuotedCount > 0 ? Math.round(projQuotedSum / projQuotedCount) : null,
      dealSize: null,
      _isProjected: true,
      _quotedCount: projQuotedCount,
      _soldCount: 0,
    });
    return rows;
  }, [records, currentYear]);
  const dealSizeData = useMemo(
    () => applyYoyOverrides(dealSizeBase, YOY_CHART_EDITS.dealSize, overrides.dealSize, editCtx),
    [dealSizeBase, overrides, editCtx],
  );

  const hasOpps = records.length > 0;

  // Commissions — the Deals tab's Commission column summed by year. Each
  // deal row is bucketed by its Year — the same value the Deals tab shows,
  // derived from Original Contract Start (dealYear), NOT the raw stored
  // 'Year' cell, which is often blank even when the deal clearly falls in a
  // year. Its "Commission" dollar amount is added to that year's total.
  // Rows without a usable year are skipped; a blank/zero Commission still
  // counts its row (so the year is represented) but adds nothing. Years
  // between the earliest and latest are kept even when empty so a missing
  // year shows as a $0 bar instead of a gap in the axis.
  const commissionsBase = useMemo(() => {
    const byYear = new Map();
    const countByYear = new Map();
    for (const row of (deals || [])) {
      const year = Number(dealYear(row));
      if (!Number.isFinite(year) || year < 1900 || year > 2100) continue;
      const commission = asNumber(row?.['Commission']) || 0;
      byYear.set(year, (byYear.get(year) || 0) + commission);
      countByYear.set(year, (countByYear.get(year) || 0) + 1);
    }
    if (byYear.size === 0) return [];
    const minY = Math.min(...byYear.keys());
    const maxY = Math.max(...byYear.keys());
    const rows = [];
    for (let y = minY; y <= maxY; y++) {
      // _rowCount = deal rows that fed this year's total (tooltip input).
      rows.push({ year: String(y), total: byYear.get(y) || 0, _rowCount: countByYear.get(y) || 0 });
    }
    return rows;
  }, [deals]);
  const commissionsData = useMemo(
    () => trimEmptyEdgeYears(applyYoyOverrides(commissionsBase, YOY_CHART_EDITS.commissions, overrides.commissions, editCtx)),
    [commissionsBase, overrides, editCtx],
  );
  const hasCommissions = commissionsData.length > 0;

  // Per-chart underlying records. Each entry mirrors the filter used by
  // the matching useMemo above so the downloaded Excel rows tie back to
  // the chart values.
  const contributingRecords = useMemo(() => {
    const quotedMonths = fiscalMonths(currentYear);
    const quotedKeyToLabel = new Map(quotedMonths.map(m => [m.key, m.label]));
    const leads = [];
    const quoted = [];
    const closeRate = [];
    const leadSources = [];
    const quotedByYear = [];
    const notSolds = [];
    const NOT_QUOTED_STAGES = new Set(['Lead', 'Not Started', 'Qualifying', 'Quoting']);
    for (const r of records) {
      const oy = parseYear(r['Open Year']);
      const account = String(r.Account || '').trim();
      const stage = String(r.Stage || '').trim();
      const status = String(r.Status || '').trim();
      const chance = String(r['Chance?'] || r['Chance'] || '').trim();
      const closeDate = r['Close Date'] || '';
      const quotedOn = r['Quoted On'] || r['Quoted Date'] || '';
      const leadSource = String(r['Lead Source'] || r['Source'] || '').trim();
      const quotedAmtRaw = r['Quoted Amount'] || '';
      const quotedAmt = parseMoney(quotedAmtRaw);
      const scope = String(r.Scope || '').trim();
      const ageNum = Number(String(r.Age ?? '').replace(/[^0-9.-]/g, ''));
      const age = Number.isFinite(ageNum) ? ageNum : '';

      // Quoted (Thousands) contributors — grouped by the calendar year of
      // the Quoted On date, so include any row with a parseable Quoted On
      // regardless of Open Year.
      const quotedOnTs = Date.parse(quotedOn);
      if (!Number.isNaN(quotedOnTs)) {
        const qy = new Date(quotedOnTs).getFullYear();
        if (Number.isFinite(qy) && qy >= 1900 && qy <= 2100) {
          quotedByYear.push({
            Account: account,
            'Quoted On': quotedOn,
            'Quoted Year': qy,
            Stage: stage,
            'Open Year': oy ?? '',
            'Quoted Amount': quotedAmt ?? 0,
          });
        }
      }

      if (oy !== null) {
        leads.push({
          Account: account,
          Stage: stage,
          Status: status,
          'Open Year': oy,
          'Close Date': closeDate,
          'Quoted Amount': quotedAmt ?? '',
          Scope: scope,
        });
        closeRate.push({
          Account: account,
          'Open Year': oy,
          Stage: stage,
          Status: status,
          'Quoted Amount': quotedAmt ?? '',
          Bucket: (stage === 'Sold') ? 'Sold'
            : (stage === 'Not Sold')
              ? (isQuotedPlus(r) ? 'Not Sold (Quoted+)' : 'Not Sold (pre-quote)')
              : 'In Progress',
          'Close Date': closeDate,
        });
        // Not Solds chart contributors — keep every row that fed any of
        // the bars or lines so the user can audit each year's stats.
        const closedStage = (stage === 'Sold' || stage === 'Not Sold');
        const isAgeForNotQuoted = NOT_QUOTED_STAGES.has(stage);
        const qt = Date.parse(quotedOn);
        const ct = Date.parse(closeDate);
        const quoteToClose = (!Number.isNaN(qt) && !Number.isNaN(ct) && ct >= qt && closedStage)
          ? Math.round((ct - qt) / 86400000) : '';
        notSolds.push({
          Account: account,
          'Open Year': oy,
          Stage: stage,
          Status: status,
          Age: age,
          'Counts in Not Sold bar': stage === 'Not Sold' ? 'Yes' : 'No',
          'Counts in Avg Opp Life': closedStage && Number.isFinite(ageNum) ? 'Yes' : 'No',
          'Counts in Age of not Quoted': isAgeForNotQuoted && Number.isFinite(ageNum) ? 'Yes' : 'No',
          'Quoted On': quotedOn,
          'Close Date': closeDate,
          'Quote to Close (days)': quoteToClose,
        });
      }
      // Lead Sources 2020+ contributors — Open Year ≥ 2020 with a
      // non-empty source value.
      if (oy !== null && oy >= 2020 && leadSource && leadSource !== '-' && leadSource !== '#N/A') {
        leadSources.push({
          'Lead Source': leadSource,
          Account: account,
          'Open Year': oy,
          Stage: stage,
          Status: status,
          Bucket: stage === 'Sold' ? 'Sold' : stage === 'Not Sold' ? 'Not Sold' : 'In Progress',
          'Quoted Amount': quotedAmt ?? '',
        });
      }
      if (closeDate && quotedAmt && quotedAmt > 0) {
        const ts = Date.parse(closeDate);
        if (!Number.isNaN(ts)) {
          const d = new Date(ts);
          const monthLabel = quotedKeyToLabel.get(`${d.getFullYear()}-${d.getMonth()}`);
          if (monthLabel) {
            const lowerChance = chance.toLowerCase();
            const series =
              lowerChance === 'weak' ? 'Quoted Weak'
              : lowerChance === 'ok' ? 'Quoted OK'
              : lowerChance === 'expected' ? 'Quoted Expected'
              : '';
            quoted.push({
              Account: account,
              'Close Date': closeDate,
              Month: monthLabel,
              'Chance?': chance,
              Status: status,
              Stage: stage,
              'Quoted Amount': quotedAmt,
              'Chart Series': series,
              'Counts Toward BFO Pipe Total': series ? 'Yes' : 'No',
              'Agreements Sent Line': status === 'Agreement Sent' ? 'Yes' : 'No',
            });
          }
        }
      }
    }
    leads.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    closeRate.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    quotedByYear.sort((a, b) => a['Quoted Year'] - b['Quoted Year'] || a.Account.localeCompare(b.Account));
    notSolds.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    leadSources.sort((a, b) =>
      a['Lead Source'].localeCompare(b['Lead Source'])
      || a['Open Year'] - b['Open Year']
      || a.Account.localeCompare(b.Account));
    quoted.sort((a, b) => {
      const ta = Date.parse(a['Close Date']);
      const tb = Date.parse(b['Close Date']);
      if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return ta - tb;
    });
    // Row-3 chart contributors. Built from the same `records` loop in
    // a second pass so we don't disrupt the existing classifications.
    const topAccountsRecs = [];
    const dealSizeRecs = [];
    const topSet = new Set(topAccountsData.topAccounts || []);
    // Annual Sales contributors are carried per-bar on annualSalesData
    // (`_deals`, bucketed by Close Date), so they aren't rebuilt here.
    for (const r of records) {
      const oy = parseYear(r['Open Year']);
      const account = String(r.Account || '').trim();
      const stage = String(r.Stage || '').trim();
      const closedStage = (stage === 'Sold' || stage === 'Not Sold');
      const amt = parseMoney(r['Quoted Amount']);
      const hasAmt = typeof amt === 'number' && amt > 0;
      const quotedOn = r['Quoted On'] || r['Quoted Date'] || '';
      const closeDate = r['Close Date'] || '';
      // Bucketing keys: bars/blue use Closed Year, the red line uses Quoted
      // Year — mirror the same fallbacks dealSizeBase applies.
      const closedYear = closedStage ? (parseDateYear(closeDate) ?? oy) : null;
      const quotedYear = hasAmt ? parseDateYear(quotedOn) : null;
      // Agreement Sent opps (with a real amount) feed the Projected point:
      // they count toward its Deals bar as expected wins and toward its
      // Quoted average alongside this year's Sold deals. Tie them to the
      // current year so a pinned Projected export pulls them in — mirrors
      // the Projected branch in dealSizeBase, which filters Agreement Sent
      // by stage only (no date filter).
      const feedsProjected = stage === 'Agreement Sent' && hasAmt;
      const projectedYear = feedsProjected ? currentYear : null;
      // The Projected Quoted average is the mean Quoted Amount across this
      // year's Sold deals plus every Agreement Sent opp — the same
      // population the Projected bar counts. Flag both so the export ties
      // back to that number.
      const inProjectedQuoted = hasAmt && (
        (stage === 'Sold' && closedYear === currentYear) || stage === 'Agreement Sent'
      );
      if (oy !== null && stage === 'Sold') {
        topAccountsRecs.push({
          Account: account,
          'Open Year': oy,
          'Quoted Amount': amt ?? '',
          'Top-4 Bucket': topSet.has(account) ? account : 'Remaining',
        });
      }
      // Deal Size contributors — every closed opp (bars + blue Deal Size
      // line, by Closed Year), every quoted opp (red Quoted line, by Quoted
      // Year), and every Agreement Sent opp that feeds the Projected point.
      // An opp filling more than one role appears once with each year set.
      if (closedStage || quotedYear != null || feedsProjected) {
        dealSizeRecs.push({
          Account: account,
          Stage: stage,
          'Closed Year': closedYear ?? '',
          'Close Date': closeDate,
          'Open Year': oy ?? '',
          'Quoted Year': quotedYear ?? '',
          'Quoted Date': quotedOn,
          'Projected Year': projectedYear ?? '',
          'Quoted Amount': amt ?? '',
          'Counts in Deals (Sold)': stage === 'Sold' ? 'Yes' : 'No',
          'Counts in Quoted avg': quotedYear != null ? 'Yes' : 'No',
          'Counts in Deal Size avg': (stage === 'Sold' && hasAmt) ? 'Yes' : 'No',
          'Counts in Projected Quoted avg': inProjectedQuoted ? 'Yes' : 'No',
        });
      }
    }
    topAccountsRecs.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    const dsSortYear = (r) => Number(r['Closed Year'] || r['Quoted Year'] || r['Projected Year'] || 0);
    dealSizeRecs.sort((a, b) => dsSortYear(a) - dsSortYear(b) || a.Account.localeCompare(b.Account));
    // Commissions contributors — one row per deal that fed a year's total.
    // Mirrors commissionsBase exactly: bucketed by the deal's derived year
    // (dealYear, from Original Contract Start) and carrying its Commission
    // column value, so the rows tie back to each bar.
    const commissionsRecs = [];
    for (const row of (deals || [])) {
      const year = Number(dealYear(row));
      if (!Number.isFinite(year) || year < 1900 || year > 2100) continue;
      const commission = asNumber(row?.['Commission']) || 0;
      commissionsRecs.push({
        'Client Name': String(row?.['Client Name'] || '').trim(),
        'BFO Name': String(row?.[DEAL_BFO_KEY] || '').trim(),
        Year: year,
        'Commission ($)': Math.round(commission),
      });
    }
    commissionsRecs.sort((a, b) => a.Year - b.Year || a['Client Name'].localeCompare(b['Client Name']));
    return {
      leads, quoted, closeRate, leadSources, quotedByYear, notSolds,
      topAccounts: topAccountsRecs, dealSize: dealSizeRecs,
      commissions: commissionsRecs,
    };
  }, [records, currentYear, topAccountsData, deals, commissions]);

  // Download just the opportunity rows behind one pinned chart point, so a
  // pinned bar/line can be deep-dived in Excel. Each chart's contributing
  // set already carries the point's key (Open Year / Closed Year / Quoted
  // Year / Lead Source), so we filter that set to the pinned row. A
  // "Projected" bar
  // annualizes the current year, so its raw opps are the current year's.
  function exportPinnedOpps(chartId, row) {
    if (!row) return;
    const CONF = {
      leads: { list: contributingRecords.leads, keyCol: 'Open Year', sheet: 'Leads' },
      closeRate: { list: contributingRecords.closeRate, keyCol: 'Open Year', sheet: 'Close Rate' },
      leadSources: { list: contributingRecords.leadSources, keyCol: 'Lead Source', sheet: 'Lead Sources' },
      quotedByYear: { list: contributingRecords.quotedByYear, keyCol: 'Quoted Year', sheet: 'Quoted' },
      notSolds: { list: contributingRecords.notSolds, keyCol: 'Open Year', sheet: 'Not Solds' },
      topAccounts: { list: contributingRecords.topAccounts, keyCol: 'Open Year', sheet: 'Top Accounts' },
      // Deal Size conflates two year dimensions per point (bars/blue by
      // Closed Year, red by Quoted Year), so a pinned year pulls opps that
      // match on either.
      dealSize: {
        list: contributingRecords.dealSize,
        match: (rec, key) => String(rec['Closed Year']) === key
          || String(rec['Quoted Year']) === key
          || String(rec['Projected Year']) === key,
        sheet: 'Deal Size',
      },
      commissions: { list: contributingRecords.commissions, keyCol: 'Year', sheet: 'Commissions' },
    };
    const conf = CONF[chartId];
    if (!conf) return;
    const rawKey = chartId === 'leadSources'
      ? String(row.source ?? '')
      : (row.isProjected || row.year === 'Projected') ? String(currentYear) : String(row.year);
    const rows = (conf.list || []).filter(
      conf.match ? (rec) => conf.match(rec, rawKey) : (rec) => String(rec[conf.keyCol]) === rawKey
    );
    if (rows.length === 0) {
      window.alert('No opportunity rows are tied to this point.');
      return;
    }
    const wb = XLSX.utils.book_new();
    appendSheet(wb, `${conf.sheet} ${rawKey}`, rows);
    const tag = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'point';
    XLSX.writeFile(wb, `yoy-${chartId}-${tag}-${todayStamp()}.xlsx`);
  }

  function downloadLeads() {
    const summary = leadsData.map(r => ({
      Year: r.year,
      'Lead Count': r.count,
      Type: r.isProjected ? 'Projected (annualized YTD)' : 'Actual',
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Leads by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.leads);
    XLSX.writeFile(wb, `yoy-leads-${todayStamp()}.xlsx`);
  }
  function downloadQuoted() {
    const summary = quotedData.map(r => ({
      Month: r.month,
      Year: r.year,
      'Quoted Weak ($K)': r.weak ?? '',
      'Quoted OK ($K)': r.ok ?? '',
      'Quoted Expected ($K)': r.expected ?? '',
      'Agreements Sent ($K)': r.agreements ?? '',
      'BFO Pipe Total ($K)': r.bfoPipe ?? '',
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, `Quoted Projections ${currentYear}`, summary);
    XLSX.writeFile(wb, `yoy-quoted-projections-${currentYear}-${todayStamp()}.xlsx`);
  }
  function downloadCloseRate() {
    const summary = closeRateData.map(r => ({
      'Open Year': r.year,
      'Total Not Sold (%)': r.totalNotSold,
      'Total Sold (OY) (%)': r.totalSold,
      'In Progress (OY) (%)': r.inProgress,
      'Quoted C/R (%)': r.quotedCR == null ? '' : r.quotedCR,
      'Total C/R (%)': r.totalCR == null ? '' : r.totalCR,
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Close Rate by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.closeRate);
    XLSX.writeFile(wb, `yoy-close-rate-${todayStamp()}.xlsx`);
  }
  function downloadLeadSources() {
    const summary = leadSourcesData.map(r => ({
      'Lead Source': r.source,
      'In Progress': r.inProgress,
      'Not Sold': r.notSold,
      Sold: r.sold,
      Total: r.total,
      'Close Rate (%)': r.closeRate == null ? '' : Math.round(r.closeRate * 100),
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Lead Sources 2020+', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.leadSources);
    XLSX.writeFile(wb, `yoy-lead-sources-${todayStamp()}.xlsx`);
  }
  function downloadQuotedByYear() {
    const summary = quotedByYearData.map(r => ({
      'Quoted Year': r.year,
      'Quoted ($k)': r.thousands,
      Type: r.isProjected ? 'Projected (annualized YTD)' : 'Actual',
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Quoted by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.quotedByYear);
    XLSX.writeFile(wb, `yoy-quoted-by-year-${todayStamp()}.xlsx`);
  }
  function downloadNotSolds() {
    const summary = notSoldsData.map(r => ({
      'Open Year': r.year,
      'Not Solds': r.notSold,
      Type: r.isProjected ? 'Projected (annualized YTD)' : 'Actual',
      'Avg Opp Life (days)': r.avgOppLife == null ? '' : r.avgOppLife,
      'Age of not Quoted (days)': r.ageNotQuoted == null ? '' : r.ageNotQuoted,
      'Quote to Close (days)': r.quoteToClose == null ? '' : r.quoteToClose,
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Not Solds by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.notSolds);
    XLSX.writeFile(wb, `yoy-not-solds-${todayStamp()}.xlsx`);
  }
  function downloadTopAccounts() {
    const tops = topAccountsData.topAccounts || [];
    const summary = (topAccountsData.years || []).map(r => {
      const out = {
        Year: r.year,
        Type: r._isProjected ? 'Projected (YTD + active pipeline)' : 'Actual',
        Total: r._total,
      };
      for (const a of tops) out[a] = r[a] ?? 0;
      out.Remaining = r.Remaining ?? 0;
      return out;
    });
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Top Accounts', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.topAccounts);
    XLSX.writeFile(wb, `yoy-top-accounts-${todayStamp()}.xlsx`);
  }
  function downloadAnnualSales() {
    const annualTarget = target > 0 ? target : DEFAULT_ANNUAL_TARGET;
    const summary = annualSalesData.map(r => ({
      Year: r.year,
      Type: r._isProjected ? 'Projected (Sold + Agreement Sent + Contracting)' : 'Actual',
      'Current Client ($)': r.currentClient,
      'New Client ($)': r.newClient,
      'Total Sold ($)': r._total,
      'Annual Target ($)': annualTarget,
      '% Quota': r.pctQuota == null ? '' : r.pctQuota,
    }));
    // Contributing deals come straight from each actual bar's `_deals`
    // so the export matches the Close-Date bucketing shown in the chart.
    const contributing = annualSalesData
      .filter(r => !r._isProjected)
      .flatMap(r => r._deals);
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Annual Sales', summary);
    appendSheet(wb, 'Contributing Deals', contributing);
    XLSX.writeFile(wb, `yoy-annual-sales-${todayStamp()}.xlsx`);
  }
  // Export just the deals behind a single year's bar (triggered by
  // clicking that bar in the chart).
  function downloadAnnualSalesYear(row) {
    if (!row || !Array.isArray(row._deals) || row._deals.length === 0) return;
    const wb = XLSX.utils.book_new();
    appendSheet(wb, `Sold ${row.year}`, row._deals);
    const tag = String(row.year).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    XLSX.writeFile(wb, `yoy-annual-sales-${tag}-${todayStamp()}.xlsx`);
  }
  function downloadCommissions() {
    const summary = commissionsData.map(r => ({
      Year: r.year,
      'Total Commissions ($)': round0(r.total),
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Commissions by Year', summary);
    appendSheet(wb, 'Contributing Deals', contributingRecords.commissions);
    XLSX.writeFile(wb, `yoy-commissions-${todayStamp()}.xlsx`);
  }

  function downloadDealSize() {
    const summary = dealSizeData.map(r => ({
      Year: r.year,
      Type: r._isProjected ? 'Projected (YTD Sold + Agreement Sent)' : 'Actual',
      'Deals (Sold count)': r.deals,
      'Quoted (avg by Quoted Year, $)': r.quoted == null ? '' : r.quoted,
      'Deal Size (avg, $)': r.dealSize == null ? '' : r.dealSize,
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Deal Size', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.dealSize);
    XLSX.writeFile(wb, `yoy-deal-size-${todayStamp()}.xlsx`);
  }

  // The single panel every chart's hover content portals into. It's
  // docked (sticky) at the top of the body so the explanation is always
  // visible while hovering any chart and never floats over the plot.
  // Held in state (via a callback ref) rather than a ref so the element
  // is provided through context and is safe to read during render.
  const [calcPanelEl, setCalcPanelEl] = useState(null);

  // Click-to-pin: hovering a point reports its content into hoverRef (set
  // by CalcTooltip); a click anywhere in the body then "sticks" that exact
  // content into a pinned panel that survives mouse-out until the user
  // clicks an empty area, clicks another point (re-pins), or hits the ✕.
  const hoverRef = useRef({ active: false, content: null });
  const [pinned, setPinned] = useState(null); // snapshot { payload, label, labelText, valueFormat, explain }
  // Charts report their hovered point here (the ref is owned by this
  // component, so the mutation stays local) for the click-to-pin handler.
  const reportHover = useCallback((content) => {
    hoverRef.current = content
      ? { active: true, content }
      : { active: false, content: hoverRef.current?.content || null };
  }, []);
  const calcCtx = useMemo(
    () => ({ el: calcPanelEl, pinned: !!pinned, reportHover }),
    [calcPanelEl, pinned, reportHover],
  );
  const handleBodyClick = useCallback(() => {
    const h = hoverRef.current;
    if (h?.active && h.content) setPinned(h.content); // stick / re-pin to hovered point
    else if (pinned) setPinned(null);                 // clicked empty area → unstick
  }, [pinned]);
  const stop = useCallback((e) => e.stopPropagation(), []);

  // Data the editor reads for the open chart: the computed (pre-override)
  // rows shown as placeholders, and the overridable field list. Top
  // Accounts' columns are dynamic, so it supplies its own field list.
  const editRegistry = {
    leads: { rows: leadsBase, fields: YOY_CHART_EDITS.leads.fields },
    closeRate: { rows: closeRateBase, fields: YOY_CHART_EDITS.closeRate.fields },
    leadSources: { rows: leadSourcesBase, fields: YOY_CHART_EDITS.leadSources.fields },
    quotedByYear: { rows: quotedByYearBase, fields: YOY_CHART_EDITS.quotedByYear.fields },
    notSolds: { rows: notSoldsBase, fields: YOY_CHART_EDITS.notSolds.fields },
    topAccounts: { rows: topAccountsBase.years, fields: topAccountsFields },
    annualSales: { rows: annualSalesBase, fields: YOY_CHART_EDITS.annualSales.fields },
    dealSize: { rows: dealSizeBase, fields: YOY_CHART_EDITS.dealSize.fields },
    commissions: { rows: commissionsBase, fields: YOY_CHART_EDITS.commissions.fields },
  };
  const editReg = editingChart ? editRegistry[editingChart] : null;
  const editCfg = editingChart ? YOY_CHART_EDITS[editingChart] : null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>YOY</h1>
          <div className={styles.subtitle}>
            Year-over-year summary, computed off the Opps tab cache. Hover a chart’s bars or points to see how that number is calculated — details appear in a panel on the right. Click a point to pin that panel; click an empty spot or the ✕ to unpin.
            {opps?.fetchedAt ? ` Opps fetched ${new Date(opps.fetchedAt).toLocaleString()}.` : ' Open the Opps tab to load data.'}
          </div>
        </div>
        <div className={styles.headerRight}>
          <address className={styles.nomadworks}>
            <span className={styles.nomadworksName}>Nomadworks</span>
            1216 Broadway (Entrance on W 30th St)<br />
            New York, NY 10001 — 3rd floor
          </address>
          {hiddenCharts.length > 0 && (
            <div className={styles.hiddenBar}>
              <span className={styles.hiddenBarLabel}>Hidden charts:</span>
              {hiddenCharts.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={styles.hiddenChip}
                  onClick={() => showChart(id)}
                  title={`Show the ${YOY_CHART_TITLES[id] || id} chart`}
                >{YOY_CHART_TITLES[id] || id} <span aria-hidden="true">＋</span></button>
              ))}
              <button type="button" className={styles.showAllBtn} onClick={showAllCharts}>Show all</button>
            </div>
          )}
        </div>
      </div>
      <div className={styles.body} onClick={handleBodyClick}>
        <CalcPanelContext.Provider value={calcCtx}>
        <EditChartContext.Provider value={setEditingChart}>
        <HideChartContext.Provider value={hideChart}>
        <div
          ref={setCalcPanelEl}
          className={styles.calcPanel}
          onClick={stop}
        />
        {pinned ? (
          <div className={styles.calcPanel} onClick={stop}>
            <CalcContent {...pinned} pinned onUnpin={() => setPinned(null)} />
          </div>
        ) : null}
        {/* Charts flow three per row in a single ordered list. Hidden
            charts drop out and the visible ones repack left-to-right so no
            gaps are left behind; only the final row is padded with spacers
            to keep every card at its one-third column width. */}
        {(() => {
          const charts = [
            { id: 'leads', node: <LeadsCard key="leads" data={leadsData} hasOpps={hasOpps} onDownload={downloadLeads} onExportPoint={(row) => exportPinnedOpps('leads', row)} /> },
            { id: 'quotedProjections', node: <QuotedProjectionsCard key="quotedProjections" data={quotedData} quotedTable={quotedTable} onSaveTable={updateQuotedTable} onDownload={downloadQuoted} /> },
            { id: 'closeRate', node: <CloseRateCard key="closeRate" data={closeRateData} hasOpps={hasOpps} onDownload={downloadCloseRate} onExportPoint={(row) => exportPinnedOpps('closeRate', row)} /> },
            { id: 'leadSources', node: <LeadSourcesCard key="leadSources" data={leadSourcesData} hasOpps={hasOpps} onDownload={downloadLeadSources} onExportPoint={(row) => exportPinnedOpps('leadSources', row)} /> },
            { id: 'quotedByYear', node: <QuotedByYearCard key="quotedByYear" data={quotedByYearData} hasOpps={hasOpps} onDownload={downloadQuotedByYear} onExportPoint={(row) => exportPinnedOpps('quotedByYear', row)} /> },
            { id: 'notSolds', node: <NotSoldsCard key="notSolds" data={notSoldsData} hasOpps={hasOpps} onDownload={downloadNotSolds} onExportPoint={(row) => exportPinnedOpps('notSolds', row)} /> },
            { id: 'topAccounts', node: <TopAccountsCard key="topAccounts" data={topAccountsData} hasOpps={hasOpps} onDownload={downloadTopAccounts} onExportPoint={(row) => exportPinnedOpps('topAccounts', row)} /> },
            { id: 'annualSales', node: <AnnualSalesCard key="annualSales" data={annualSalesData} hasOpps={hasOpps} target={target} onDownload={downloadAnnualSales} onExportYear={downloadAnnualSalesYear} /> },
            { id: 'dealSize', node: <DealSizeCard key="dealSize" data={dealSizeData} hasOpps={hasOpps} onDownload={downloadDealSize} onExportPoint={(row) => exportPinnedOpps('dealSize', row)} /> },
            { id: 'commissions', node: <CommissionsCard key="commissions" data={commissionsData} hasCommissions={hasCommissions} onDownload={downloadCommissions} onExportPoint={(row) => exportPinnedOpps('commissions', row)} /> },
          ];
          const visible = charts.filter((c) => !hiddenSet.has(c.id));
          const rows = [];
          for (let i = 0; i < visible.length; i += 3) rows.push(visible.slice(i, i + 3));
          return rows.map((row, ri) => {
            const slots = [...row];
            while (slots.length < 3) slots.push(null);
            return (
              <div className={styles.row} key={ri}>
                {slots.map((c, ci) => c
                  ? c.node
                  : <div key={`spacer-${ri}-${ci}`} style={{ flex: '1 1 0' }} aria-hidden="true" />)}
              </div>
            );
          });
        })()}
        </HideChartContext.Provider>
        </EditChartContext.Provider>
        </CalcPanelContext.Provider>
      </div>
      {editReg && editCfg && (
        <ChartDataEditor
          chartId={editingChart}
          cfg={editCfg}
          rows={editReg.rows}
          fields={editReg.fields}
          table={overrides[editingChart]}
          onClose={() => setEditingChart(null)}
          onSave={saveChartOverrides}
        />
      )}
    </div>
  );
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function round0(n) {
  return n == null || !Number.isFinite(n) ? 0 : Math.round(n);
}

// Build a worksheet from an array of plain-object rows and append it to
// the workbook. Auto-sizes columns based on header + the first 50 rows.
function appendSheet(wb, name, rows) {
  const ws = rows.length > 0
    ? XLSX.utils.json_to_sheet(rows)
    : XLSX.utils.aoa_to_sheet([['No rows']]);
  if (rows.length > 0) {
    const keys = Object.keys(rows[0]);
    ws['!cols'] = keys.map(key => ({
      wch: Math.min(60, Math.max(
        key.length,
        ...rows.slice(0, 50).map(r => String(r[key] ?? '').length),
      ) + 2),
    }));
  }
  // Excel sheet names cap at 31 chars and can't contain []:?*/\
  const safe = String(name).replace(/[[\]:?*/\\]/g, ' ').slice(0, 31) || 'Sheet';
  XLSX.utils.book_append_sheet(wb, ws, safe);
}

// Makes a chart's <Legend> interactive: clicking a series label toggles
// it on/off. Spread `legendProps` onto <Legend> and set `hide={hidden[key]}`
// on each series (key = its dataKey). Hidden labels render struck-through
// and greyed so it's clear what's currently filtered out. Pass
// `initialHidden` (keyed by dataKey) to start a series toggled off.
function useInteractiveLegend(initialHidden) {
  const [hidden, setHidden] = useState(initialHidden ?? {});
  const legendProps = {
    wrapperStyle: { fontSize: 12, cursor: 'pointer' },
    onClick: (o) => {
      const key = o?.dataKey ?? o?.value;
      if (key == null) return;
      setHidden(h => ({ ...h, [key]: !h[key] }));
    },
    formatter: (value, entry) => {
      const key = entry?.dataKey ?? value;
      const off = hidden[key];
      return (
        <span style={{ color: off ? '#9ca3af' : '#374151', textDecoration: off ? 'line-through' : 'none' }}>
          {value}
        </span>
      );
    },
  };
  return { hidden, legendProps };
}

function ChartHeader({ title, onDownload, canDownload, chartId, hideId }) {
  const openEditor = useContext(EditChartContext);
  const hideChart = useContext(HideChartContext);
  const hideKey = hideId || chartId;
  return (
    <div className={styles.chartHeader}>
      <h2 className={styles.chartTitle}>{title}</h2>
      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
        {chartId && openEditor && (
          <button
            type="button"
            className={styles.downloadBtn}
            onClick={() => openEditor(chartId)}
            title={`View and overwrite the ${title} data points`}
          >✎ Edit data</button>
        )}
        <button
          type="button"
          className={styles.downloadBtn}
          onClick={onDownload}
          disabled={!canDownload}
          title={canDownload
            ? `Download ${title} data as Excel (.xlsx)`
            : 'No data to download'}
        >Download .xlsx</button>
        {hideKey && hideChart && (
          <button
            type="button"
            className={styles.hideBtn}
            onClick={() => hideChart(hideKey)}
            title={`Hide the ${title} chart`}
            aria-label={`Hide the ${title} chart`}
          >✕</button>
        )}
      </div>
    </div>
  );
}

// Generic "Edit data" popup for a YOY chart. Each row's computed value is
// shown as the input placeholder; typing a replacement stores it as an
// override that wins over the live number until cleared. A blank cell
// keeps the computed value, and a value equal to the computed one is not
// stored (so an override always represents a real change). "Clear
// overrides" drops every saved value for the chart at once.
function ChartDataEditor({ chartId, cfg, rows, fields, table, onClose, onSave }) {
  const keyField = cfg.keyField;
  const [draft, setDraft] = useState(() => {
    const d = {};
    for (const r of rows) {
      const key = String(r[keyField]);
      const saved = table?.[key] || {};
      const cells = {};
      for (const f of fields) {
        const sv = saved[f.key];
        // ratioPct is stored as a 0–1 ratio but edited as a whole percent.
        cells[f.key] = sv != null
          ? (f.kind === 'ratioPct' ? String(+(sv * 100).toFixed(2)) : String(sv))
          : '';
      }
      d[key] = cells;
    }
    return d;
  });
  const setCell = (key, field, value) =>
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));

  const handleSave = () => {
    const next = {};
    for (const r of rows) {
      const key = String(r[keyField]);
      const cells = draft[key] || {};
      const out = {};
      for (const f of fields) {
        const raw = String(cells[f.key] ?? '').trim().replace(/[$,%\s]/g, '');
        if (raw === '') continue;
        const typed = Number(raw);
        if (!Number.isFinite(typed)) continue;
        // ratioPct cells are typed as a whole percent but stored as a ratio.
        const value = f.kind === 'ratioPct' ? typed / 100 : typed;
        const base = r[f.key];
        if (base != null && Number(base) === value) continue; // no real change
        out[f.key] = value;
      }
      if (Object.keys(out).length) next[key] = out;
    }
    onSave(chartId, next);
  };

  return createPortal(
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalTitle}>{cfg.title} — edit data</div>
            <div className={styles.modalSub}>
              Type a value to overwrite that data point; it wins over the live-computed
              number until you clear it. Leave a cell blank to keep the computed value
              (shown greyed as the placeholder).
            </div>
          </div>
          <button type="button" className={styles.downloadBtn} onClick={onClose}>Close</button>
        </div>
        <div className={styles.modalBody}>
          <table className={styles.editTable}>
            <thead>
              <tr>
                <th>{cfg.keyLabel}</th>
                {fields.map(f => <th key={f.key}>{f.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const key = String(r[keyField]);
                return (
                  <tr key={key}>
                    <td className={styles.editMonthCell}>{key}</td>
                    {fields.map(f => (
                      <td key={f.key}>
                        <input
                          type="text"
                          inputMode="decimal"
                          className={styles.editInput}
                          value={draft[key]?.[f.key] ?? ''}
                          onChange={(e) => setCell(key, f.key, e.target.value)}
                          placeholder={fmtOverrideValue(r[f.key], f.kind) || '—'}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.modalFoot}>
          <button type="button" className={styles.downloadBtn} onClick={() => onSave(chartId, {})}>Clear overrides</button>
          <button type="button" className={styles.downloadBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.saveBtn} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Shared hover tooltip for every YOY chart. Recharts clones this element
// with `active` / `payload` / `label` injected at hover time. Beyond the
// usual per-series values it makes two things explicit:
//   1. None of the YOY numbers are static — they're recomputed live from
//      the Opps cache — so a "∑ calculated" badge sits in the header.
//   2. The formula and the specific inputs that produced *this* point, so
//      a number can be sanity-checked without opening the .xlsx export.
// `valueFormat(value, name, row)` formats each series line; `explain(row)`
// returns { formula, inputs: [{label, value}], note } for the lower block.
// Inner content shared by the docked panel (normal case) and the
// floating fallback. Laid out as a horizontal strip — heading + badge,
// then the per-series values, then the formula and its inputs — so it
// reads left-to-right in the wide docked panel without growing tall.
function CalcContent({ payload, label, labelText, valueFormat, explain, pinned, onUnpin }) {
  const row = payload[0]?.payload || {};
  const info = explain ? explain(row, payload, label) : null;
  const heading = labelText ? labelText(label, row) : label;
  return (
    <div className={styles.calcDock}>
      <div className={styles.calcDockLabel}>
        <span className={styles.calcDockHeading}>{heading}</span>
        {pinned && typeof info?.exportOpps === 'function' ? (
          <button
            type="button"
            className={styles.calcExportBtn}
            onClick={info.exportOpps}
            title="Download the opportunity rows behind this point to Excel"
          >⬇ Excel</button>
        ) : null}
        {pinned ? (
          <button type="button" className={styles.calcPinBtn} onClick={onUnpin} title="Unstick this panel">📌 Pinned ✕</button>
        ) : (
          <span className={styles.calcTipBadge} title="Recomputed live from the Opps cache — not a stored value">∑ calculated</span>
        )}
      </div>
      <div className={styles.calcDockSeries}>
        {payload.map((p, i) => (
          <span key={i} className={styles.calcDockSeriesItem}>
            <span className={styles.calcTipSwatch} style={{ background: p.color || p.stroke || p.fill || '#94a3b8' }} />
            <span className={styles.calcDockName}>{p.name}</span>
            <span className={styles.calcDockVal}>
              {valueFormat ? valueFormat(p.value, p.name, row) : (p.value == null ? '—' : p.value)}
            </span>
          </span>
        ))}
      </div>
      {info && (info.formula || (info.inputs && info.inputs.length) || info.note) ? (
        <div className={styles.calcDockExplain}>
          {info.formula ? <div className={styles.calcDockFormula}>{info.formula}</div> : null}
          {Array.isArray(info.inputs) && info.inputs.length > 0 ? (
            <div className={styles.calcDockInputs}>
              {info.inputs.map((it, i) => (
                <span key={i} className={styles.calcDockInput}>
                  <span className={styles.calcDockInputLabel}>{it.label}</span>
                  <span className={styles.calcDockInputVal}>{it.value}</span>
                </span>
              ))}
            </div>
          ) : null}
          {info.note ? <span className={styles.calcDockNote}>{info.note}</span> : null}
        </div>
      ) : null}
      {Array.isArray(info?.deals) && info.deals.length > 0 ? (
        <div className={styles.calcDockDeals}>
          <div className={styles.calcDockDealsHead}>
            {info.deals.length} deal{info.deals.length === 1 ? '' : 's'}
            {typeof info.exportDeals === 'function' ? (
              <button type="button" className={styles.calcExportBtn} onClick={info.exportDeals} title="Download these deals to Excel">⬇ Excel</button>
            ) : null}
          </div>
          <div className={styles.calcDockDealsList}>
            {info.deals.map((d, i) => (
              <span key={i} className={styles.calcDockDeal}>
                <span className={styles.calcDockDealAcct}>{d.Account || '—'}</span>
                <span className={styles.calcDockDealVal}>{fmtMoneyLabel(d['Quoted Amount']) || '$0'}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Shared hover tooltip for every YOY chart. Recharts clones this element
// with `active` / `payload` / `label` injected at hover time and would
// normally float it over the plot — which covers the very point being
// reviewed. Instead we portal the content into the docked panel at the
// top of the YOY body so the chart and its data stay fully visible. If
// no panel is mounted (defensive), it falls back to a small floating box.
function CalcTooltip({
  active, payload, label,
  labelText, valueFormat, explain, onExportPoint,
}) {
  const ctx = useContext(CalcPanelContext);
  const isActive = !!(active && payload && payload.length > 0);
  // When the chart can export the opps behind a point, fold an `exportOpps`
  // callback into whatever the chart's explain() returns, so the pinned
  // panel can offer a per-point Excel download. Wrapped here (rather than in
  // every card's explain) and captured in the pinned snapshot below.
  const wrappedExplain = (onExportPoint && explain)
    ? (row, ...rest) => ({ ...(explain(row, ...rest) || {}), exportOpps: () => onExportPoint(row) })
    : (onExportPoint
        ? (row) => ({ exportOpps: () => onExportPoint(row) })
        : explain);
  // Report the currently-hovered point up to the page so a click anywhere
  // in the YOY body can pin (stick) this exact content. Runs in an effect
  // so we never setState/refs mid-render. Snapshot the payload (Recharts
  // mutates its array between events) so the pinned copy stays stable.
  const reportHover = ctx?.reportHover;
  useEffect(() => {
    if (!reportHover) return;
    reportHover(isActive ? { payload: payload.slice(), label, labelText, valueFormat, explain: wrappedExplain } : null);
  });
  if (!isActive) return null;
  // While a panel is pinned, the hover panel steps aside so it doesn't
  // fight the pinned one for the docked slot.
  if (ctx?.pinned) return null;
  const body = (
    <CalcContent
      payload={payload}
      label={label}
      labelText={labelText}
      valueFormat={valueFormat}
      explain={wrappedExplain}
    />
  );
  if (ctx?.el) return createPortal(body, ctx.el);
  return <div className={styles.calcTip}>{body}</div>;
}

function LeadsCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Leads" chartId="leads" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row.isProjected ? 'Projected (annualized YTD)' : `Open Year ${label}`}
                valueFormat={(v) => (v == null ? '—' : v.toLocaleString('en-US'))}
                explain={(row) => row.isProjected
                  ? {
                      formula: 'Annualized: YTD lead count ÷ fraction of the year elapsed.',
                      inputs: [
                        { label: 'YTD leads', value: (row._ytd ?? 0).toLocaleString('en-US') },
                        { label: 'Year elapsed', value: `${Math.round((row._frac ?? 0) * 100)}%` },
                        { label: 'Projected', value: (row.count ?? 0).toLocaleString('en-US') },
                      ],
                    }
                  : {
                      formula: 'Count of Opps rows whose Open Year equals this year.',
                      inputs: [{ label: 'Leads counted', value: (row.count ?? 0).toLocaleString('en-US') }],
                    }}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="count" name="Leads" fill="#3b82f6" isAnimationActive={false} hide={hidden.count}>
              {data.map((row, i) => (
                <Cell key={i} fill={row.isProjected ? '#facc15' : '#3b82f6'} />
              ))}
              <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function QuotedProjectionsCard({ data, quotedTable, onSaveTable, onDownload, onExportPoint }) {
  const [editing, setEditing] = useState(false);
  const hasAnyValues = data.some(r => r._hasData);
  // BFO Pipe Total starts hidden — it rides its own right-hand axis and
  // overwhelms the quoted buckets, so surface it only on demand via the legend.
  const { hidden, legendProps } = useInteractiveLegend({ bfoPipe: true });
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Quoted Projections" hideId="quotedProjections" onDownload={onDownload} canDownload={hasAnyValues} />
      <div className={styles.quotedEditRow}>
        <span className={styles.quotedUnitNote}>values in $K</span>
        <button type="button" className={styles.editValuesBtn} onClick={() => setEditing(true)}>Edit values</button>
      </div>
      {!hasAnyValues ? (
        <div className={styles.empty}>No values yet — click “Edit values” to record each month’s figures.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="dollars"
              tick={{ fontSize: 12 }}
              tickFormatter={fmtKLabel}
            />
            <YAxis
              yAxisId="pipe"
              orientation="right"
              tick={{ fontSize: 12 }}
              tickFormatter={fmtKLabel}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => `${label} ${row.year}`}
                valueFormat={(v) => (v == null ? '—' : fmtKLabel(v))}
                explain={(row) => ({
                  formula: 'Recorded month-end values (in $K). Quoted Weak/OK/Expected are the quoted-$ Chance buckets, Agreements Sent is contracts out, and BFO Pipe Total is the total pipeline $ (its own right-hand axis). Edit via “Edit values”.',
                  inputs: [
                    { label: 'Quoted Weak', value: row.weak == null ? '—' : fmtKLabel(row.weak) },
                    { label: 'Quoted OK', value: row.ok == null ? '—' : fmtKLabel(row.ok) },
                    { label: 'Quoted Expected', value: row.expected == null ? '—' : fmtKLabel(row.expected) },
                    { label: 'Agreements Sent', value: row.agreements == null ? '—' : fmtKLabel(row.agreements) },
                    { label: 'BFO Pipe Total', value: row.bfoPipe == null ? '—' : fmtKLabel(row.bfoPipe) },
                  ],
                  note: row._live
                    ? 'Live — computed now from Opps (quoted $ by Chance / Agreements Sent) + BFO Activity (Pipe Total). Use “Edit values” to record a fixed month-end snapshot.'
                    : (row._hasData ? null : 'No values recorded for this month yet.'),
                })}
              />
            } />
            <Legend {...legendProps} />
            <Line yAxisId="dollars" dataKey="weak" name="Quoted Weak" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.weak}>
              <LabelList dataKey="weak" position="top" style={{ fontSize: 10, fill: '#15803d' }} formatter={fmtKLabel} />
            </Line>
            <Line yAxisId="dollars" dataKey="ok" name="Quoted OK" stroke="#eab308" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.ok}>
              <LabelList dataKey="ok" position="top" style={{ fontSize: 10, fill: '#a16207' }} formatter={fmtKLabel} />
            </Line>
            <Line yAxisId="dollars" dataKey="expected" name="Quoted Expected" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.expected}>
              <LabelList dataKey="expected" position="top" style={{ fontSize: 10, fill: '#1d4ed8' }} formatter={fmtKLabel} />
            </Line>
            <Line yAxisId="dollars" dataKey="agreements" name="Agreements Sent" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.agreements} />
            <Line
              yAxisId="pipe"
              dataKey="bfoPipe"
              name="BFO Pipe Total"
              stroke="#111827"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.bfoPipe}
            >
              <LabelList dataKey="bfoPipe" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#111827' }} formatter={fmtKLabel} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
      {editing && (
        <QuotedProjectionsEditor
          rows={data}
          table={quotedTable}
          onClose={() => setEditing(false)}
          onSave={(next) => { onSaveTable(next); setEditing(false); }}
        />
      )}
    </div>
  );
}

// Editable month-by-month table behind the Quoted Projections "Edit
// values" button. Lets the user record each month's figures (in $K);
// blank cells are omitted. Seeded values come from the store.
function QuotedProjectionsEditor({ rows, table, onClose, onSave }) {
  const [draft, setDraft] = useState(() => {
    const d = {};
    for (const r of rows) {
      const saved = table[r.monthKey];
      // Pre-fill the live current month from its computed values (rounded
      // to whole $K) so saving locks in what the chart already shows.
      const live = r._live ? { weak: r.weak, ok: r.ok, expected: r.expected, agreements: r.agreements, bfoPipe: r.bfoPipe } : null;
      const v = saved || live || {};
      const cells = {};
      for (const f of QUOTED_FIELDS) {
        const raw = v[f];
        cells[f] = (raw == null || raw === '') ? '' : String(saved ? raw : Math.round(raw));
      }
      d[r.monthKey] = cells;
    }
    return d;
  });
  const setCell = (key, field, value) =>
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  const handleSave = () => {
    const next = { ...table };
    for (const r of rows) {
      const cells = draft[r.monthKey] || {};
      const out = {};
      let any = false;
      for (const f of QUOTED_FIELDS) {
        const raw = String(cells[f] ?? '').trim().replace(/[$,]/g, '');
        if (raw === '') continue;
        const n = Number(raw);
        if (Number.isFinite(n)) { out[f] = n; any = true; }
      }
      if (any) next[r.monthKey] = out;
      else delete next[r.monthKey];
    }
    onSave(next);
  };
  const labels = [
    ['weak', 'Quoted Weak'], ['ok', 'Quoted OK'], ['expected', 'Quoted Expected'],
    ['agreements', 'Agreements Sent'], ['bfoPipe', 'BFO Pipe Total'],
  ];
  return createPortal(
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalTitle}>Quoted Projections — monthly values</div>
            <div className={styles.modalSub}>All figures in thousands of dollars ($K). Leave a cell blank to omit it. Saved per month for the Dec→Nov fiscal year.</div>
          </div>
          <button type="button" className={styles.downloadBtn} onClick={onClose}>Close</button>
        </div>
        <div className={styles.modalBody}>
          <table className={styles.editTable}>
            <thead>
              <tr>
                <th>Month</th>
                {labels.map(([f, lbl]) => <th key={f}>{lbl}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.monthKey}>
                  <td className={styles.editMonthCell}>{r.month} {r.year}</td>
                  {labels.map(([f]) => (
                    <td key={f}>
                      <input
                        type="number"
                        className={styles.editInput}
                        value={draft[r.monthKey]?.[f] ?? ''}
                        onChange={(e) => setCell(r.monthKey, f, e.target.value)}
                        placeholder="—"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.modalFoot}>
          <button type="button" className={styles.downloadBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.saveBtn} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CloseRateCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Close Rate" chartId="closeRate" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="pct"
              tick={{ fontSize: 12 }}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <YAxis
              yAxisId="cr"
              orientation="right"
              tick={{ fontSize: 12 }}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label) => `Open Year ${label}`}
                valueFormat={(v) => (v == null ? '—' : `${v.toFixed(0)}%`)}
                explain={(row) => ({
                  formula: 'Bars = each stage as a % of all opps that year. Total C/R = Sold ÷ (Sold + Not Sold). Quoted C/R = Sold ÷ (Sold + Not Sold that reached Quoted+).',
                  inputs: [
                    { label: 'Sold', value: (row._sold ?? 0).toLocaleString('en-US') },
                    { label: 'Not Sold', value: (row._notSold ?? 0).toLocaleString('en-US') },
                    { label: 'In Progress', value: (row._inProgress ?? 0).toLocaleString('en-US') },
                    { label: 'Not Sold (Quoted+)', value: (row._quotedNotSold ?? 0).toLocaleString('en-US') },
                    { label: 'Total opps', value: (row._total ?? 0).toLocaleString('en-US') },
                  ],
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar yAxisId="pct" dataKey="totalNotSold" stackId="cr" name="Total Not Sold" fill="#ef4444" isAnimationActive={false} hide={hidden.totalNotSold} />
            <Bar yAxisId="pct" dataKey="totalSold" stackId="cr" name="Total Sold (OY)" fill="#facc15" isAnimationActive={false} hide={hidden.totalSold} />
            <Bar yAxisId="pct" dataKey="inProgress" stackId="cr" name="In Progress (OY)" fill="#3b82f6" isAnimationActive={false} hide={hidden.inProgress} />
            <Line yAxisId="cr" dataKey="quotedCR" name="Quoted C/R" stroke="#374151" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.quotedCR}>
              <LabelList dataKey="quotedCR" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#1f2937' }} formatter={(v) => v == null ? '' : `${Math.round(v)}%`} />
            </Line>
            <Line yAxisId="cr" dataKey="totalCR" name="Total C/R" stroke="#16a34a" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.totalCR}>
              <LabelList dataKey="totalCR" position="bottom" style={{ fontSize: 10, fontWeight: 600, fill: '#15803d' }} formatter={(v) => v == null ? '' : `${Math.round(v)}%`} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function LeadSourcesCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  // Per-row height keeps the chart legible even when source values
  // accumulate (e.g. opps tagged with novel sources over time). Pad
  // the wrapper height so the LabelList sold count + close-rate label
  // never collides with the rightmost gridline.
  const rowHeight = 28;
  const minHeight = 320;
  const height = Math.max(minHeight, data.length * rowHeight + 80);
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Lead Sources 2020+" chartId="leadSources" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with a Lead Source and Open Year ≥ 2020.</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 70, left: 4, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="source"
              tick={{ fontSize: 11 }}
              width={155}
              interval={0}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label) => `Lead Source: ${label}`}
                valueFormat={(v) => (v == null ? '—' : v.toLocaleString('en-US'))}
                explain={(row) => ({
                  formula: 'Opps with this Lead Source (Open Year ≥ 2020), counted by stage. Row-end green % = Close Rate = Sold ÷ (Sold + Not Sold).',
                  inputs: [
                    { label: 'In Progress', value: (row.inProgress ?? 0).toLocaleString('en-US') },
                    { label: 'Not Sold', value: (row.notSold ?? 0).toLocaleString('en-US') },
                    { label: 'Sold', value: (row.sold ?? 0).toLocaleString('en-US') },
                    { label: 'Total', value: (row.total ?? 0).toLocaleString('en-US') },
                    { label: 'Close Rate', value: row.closeRate == null ? '—' : `${Math.round(row.closeRate * 100)}%` },
                  ],
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="inProgress" stackId="ls" name="In Progress" fill="#3b82f6" isAnimationActive={false} hide={hidden.inProgress} />
            <Bar dataKey="notSold" stackId="ls" name="Not Sold" fill="#ef4444" isAnimationActive={false} hide={hidden.notSold} />
            <Bar dataKey="sold" stackId="ls" name="Sold" fill="#facc15" isAnimationActive={false} hide={hidden.sold}>
              <LabelList
                dataKey="sold"
                position="right"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(value) => value || ''}
              />
              <LabelList
                dataKey="closeRate"
                position="right"
                offset={28}
                style={{ fontSize: 11, fontWeight: 600, fill: '#16a34a' }}
                formatter={(v) => v == null ? '' : `${Math.round(v * 100)}%`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function QuotedByYearCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Quoted (Thousands)" chartId="quotedByYear" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => `$${v.toLocaleString('en-US')}`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row.isProjected ? 'Projected (annualized YTD)' : `Quoted ${label}`}
                valueFormat={(v) => (v == null ? '—' : `$${v.toLocaleString('en-US')}k`)}
                explain={(row) => row.isProjected
                  ? {
                      formula: 'Annualized: YTD quoted $ (by Quoted On date) ÷ fraction of the year elapsed, shown in $k.',
                      inputs: [
                        { label: 'YTD quoted', value: `$${(row._ytdThousands ?? 0).toLocaleString('en-US')}k` },
                        { label: 'Year elapsed', value: `${Math.round((row._frac ?? 0) * 100)}%` },
                        { label: 'Projected', value: `$${(row.thousands ?? 0).toLocaleString('en-US')}k` },
                      ],
                    }
                  : {
                      formula: 'Sum of Quoted Amount for every opp whose Quoted On date falls in this year (any stage), shown in $k.',
                      inputs: [{ label: 'Quoted total', value: `$${(row.thousands ?? 0).toLocaleString('en-US')}k` }],
                    }}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="thousands" name="Quoted ($k)" fill="#3b82f6" isAnimationActive={false} hide={hidden.thousands}>
              {data.map((row, i) => (
                <Cell key={i} fill={row.isProjected ? '#facc15' : '#3b82f6'} />
              ))}
              <LabelList
                dataKey="thousands"
                position="top"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => `$${v.toLocaleString('en-US')}`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function NotSoldsCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Not Solds" chartId="notSolds" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row.isProjected ? 'Projected (annualized YTD)' : `Open Year ${label}`}
                valueFormat={(v, name) => {
                  if (v == null) return '—';
                  if (name === 'Not Solds') return v.toLocaleString('en-US');
                  return `${v.toLocaleString('en-US')} days`;
                }}
                explain={(row) => row.isProjected
                  ? {
                      formula: 'Not Sold bar annualized: YTD Not Sold ÷ fraction of year elapsed. The day-count lines are actuals only — not projected.',
                      inputs: [
                        { label: 'YTD Not Sold', value: (row._ytdNotSold ?? 0).toLocaleString('en-US') },
                        { label: 'Year elapsed', value: `${Math.round((row._frac ?? 0) * 100)}%` },
                        { label: 'Projected', value: (row.notSold ?? 0).toLocaleString('en-US') },
                      ],
                    }
                  : {
                      formula: 'Bar = count of Not Sold opps. Lines = mean days — Avg Opp Life (closed opps), Age of not Quoted (pre-quote opps), Quote to Close (Close Date − Quoted On).',
                      inputs: [
                        { label: 'Not Solds', value: (row.notSold ?? 0).toLocaleString('en-US') },
                        { label: 'Avg Opp Life', value: row.avgOppLife == null ? '—' : `${row.avgOppLife} d (n=${row._lifeCount ?? 0})` },
                        { label: 'Age of not Quoted', value: row.ageNotQuoted == null ? '—' : `${row.ageNotQuoted} d (n=${row._notQuotedCount ?? 0})` },
                        { label: 'Quote to Close', value: row.quoteToClose == null ? '—' : `${row.quoteToClose} d (n=${row._qtcCount ?? 0})` },
                      ],
                    }}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="notSold" name="Not Solds" isAnimationActive={false} hide={hidden.notSold}>
              {data.map((row, i) => (
                <Cell key={i} fill={row.isProjected ? '#facc15' : '#3b82f6'} />
              ))}
              <LabelList dataKey="notSold" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }} />
            </Bar>
            <Line
              dataKey="avgOppLife"
              name="Avg Opp Life"
              stroke="#dc2626"
              strokeWidth={2.5}
              dot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.avgOppLife}
            >
              <LabelList dataKey="avgOppLife" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#991b1b' }} formatter={(v) => v == null ? '' : v} />
            </Line>
            <Line
              dataKey="ageNotQuoted"
              name="Age of not Quoted"
              stroke="#22c55e"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.ageNotQuoted}
            />
            <Line
              dataKey="quoteToClose"
              name="Quote to Close"
              stroke="#eab308"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.quoteToClose}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// Compact `$1,234,567` formatter for label lists on $-axis charts.
function fmtMoneyLabel(v) {
  if (v == null || !Number.isFinite(v) || v === 0) return '';
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

// Compact "thousands" form for the Annual Sales bar totals: 1,823,986
// shows as "$1,823k" (the sub-thousand remainder is dropped).
function fmtThousandsLabel(v) {
  if (v == null || !Number.isFinite(v) || v === 0) return '';
  return `$${Math.trunc(v / 1000).toLocaleString('en-US')}k`;
}

function TopAccountsCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { years = [], topAccounts = [], colors = {} } = data || {};
  const hasAny = years.some(r => r._total > 0);
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Top Accounts" chartId="topAccounts" onDownload={onDownload} canDownload={hasOpps && hasAny} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : !hasAny ? (
        <div className={styles.empty}>No Sold opps with a Quoted Amount yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={years} margin={{ top: 20, right: 8, left: 16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => `$${(v / 1_000_000).toFixed(0)}M`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row._isProjected ? 'Projected (YTD + active pipeline)' : `Year ${label}`}
                valueFormat={(v) => (v ? fmtMoneyLabel(v) : '$0')}
                explain={(row) => ({
                  formula: 'Sold Quoted Amount summed per Account for this year. The top 4 accounts by lifetime Sold $ get their own slice; everyone else is grouped as Remaining.',
                  inputs: [{ label: 'Year total', value: row._total ? fmtMoneyLabel(row._total) : '$0' }],
                  note: row._isProjected ? 'Projected adds active pipeline (non-closed current-year opps) to YTD Sold $.' : null,
                })}
              />
            } />
            <Legend {...legendProps} />
            {/* Stack order: largest (Brookfield) at bottom; Remaining at top. */}
            {topAccounts.map((a, i) => (
              <Bar
                key={a}
                dataKey={a}
                stackId="ta"
                name={a}
                fill={colors[a] || '#94a3b8'}
                isAnimationActive={false}
                hide={hidden[a]}
              >
                {i === 0 ? (
                  <LabelList
                    dataKey={a}
                    position="center"
                    style={{ fontSize: 10, fontWeight: 600, fill: '#fff' }}
                    formatter={(v) => v && v >= 50_000 ? fmtMoneyLabel(v) : ''}
                  />
                ) : null}
              </Bar>
            ))}
            <Bar dataKey="Remaining" stackId="ta" name="Remaining" fill={colors.Remaining || '#22c55e'} isAnimationActive={false} hide={hidden.Remaining}>
              <LabelList
                dataKey="_total"
                position="top"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => fmtMoneyLabel(v)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function AnnualSalesCard({ data, hasOpps, target, onDownload, onExportYear, onExportPoint }) {
  const hasAny = data.some(r => r._total > 0);
  const annualTarget = target > 0 ? target : DEFAULT_ANNUAL_TARGET;
  const { hidden, legendProps } = useInteractiveLegend();
  // Drive the Y axis off the stacked total (currentClient + newClient).
  // A function domain like `dataMax => dataMax * 1.18` can clip stacked
  // bars: Recharts may hand the function the per-series max rather than
  // the stack total, so a bar whose two segments sum higher than either
  // segment alone renders shorter than its real value (while the tooltip,
  // which reads the row, still shows the right number). Computing the max
  // from `_total` here guarantees every bar scales to its true height.
  const yMax = useMemo(() => {
    const max = data.reduce((m, r) => Math.max(m, r._total || 0), 0);
    return max > 0 ? Math.ceil(max * 1.18) : 1;
  }, [data]);
  // Bar clicks now pin the panel (handled at the page level); the per-bar
  // Excel export lives as a button inside that panel (see explain → exportDeals).
  // Draw the total (+ % Quota) above each bar. Pinning the label to one
  // segment breaks when that segment is $0 — a year whose Sold deals are
  // all Current Client has newClient = 0, so a label on the New Client
  // (top) segment silently disappeared. Instead draw it on whichever
  // segment actually sits on top: New Client when it has value, else
  // Current Client.
  //
  // The row comes from the bar entry's own payload (fed in via the
  // LabelList `valueAccessor` below) — NOT `data[props.index]`. Recharts
  // drops zero-dimension bars from its rendered set, so `props.index` is
  // an index into that filtered set; using it against the full `data`
  // array drew a year's total over the wrong bar once any segment was $0.
  // Reading the payload keeps the amount, the %, and the x/y position all
  // tied to the same bar.
  const renderTotalLabel = (segment) => (props) => {
    const row = props.value;
    if (!row || typeof row !== 'object' || !row._total) return null;
    const newClientOnTop = (row.newClient || 0) > 0;
    if (segment === 'new' ? !newClientOnTop : newClientOnTop) return null;
    const vb = (props.viewBox && props.viewBox.x != null) ? props.viewBox : props;
    const cx = (vb.x || 0) + (vb.width || 0) / 2;
    const top = vb.y || 0;
    return (
      <g>
        <text x={cx} y={top - 7} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}>{fmtThousandsLabel(row._total)}</text>
        {!hidden.pctQuota && row.pctQuota != null ? (
          <text x={cx} y={top - 22} textAnchor="middle" style={{ fontSize: 10, fontWeight: 600, fill: '#a16207' }}>{`${row.pctQuota}%`}</text>
        ) : null}
      </g>
    );
  };
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Annual Sales" chartId="annualSales" onDownload={onDownload} canDownload={hasOpps && hasAny} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : !hasAny ? (
        <div className={styles.empty}>No Sold opps with a Quoted Amount yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 48, right: 8, left: 16, bottom: 4 }} style={{ cursor: 'pointer' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              domain={[0, yMax]}
              allowDataOverflow={false}
              tickFormatter={(v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : v.toLocaleString('en-US')}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row._isProjected ? 'Projected (Sold + Agreement Sent + Contracting)' : `Sold in ${label}`}
                valueFormat={(v, name) => (name === '% Quota' ? `${v}%` : (v ? fmtMoneyLabel(v) : '$0'))}
                explain={(row) => ({
                  formula: 'Sold Quoted Amount bucketed by the year of the Close Date, split Current vs New Client by the Lead Source text. % Quota = Total Sold ÷ annual target.',
                  inputs: [
                    { label: 'Current Client', value: row.currentClient ? fmtMoneyLabel(row.currentClient) : '$0' },
                    { label: 'New Client', value: row.newClient ? fmtMoneyLabel(row.newClient) : '$0' },
                    { label: 'Total Sold', value: row._total ? fmtMoneyLabel(row._total) : '$0' },
                    { label: 'Annual target', value: fmtMoneyLabel(annualTarget) },
                    { label: '% Quota', value: row.pctQuota == null ? '—' : `${row.pctQuota}%` },
                  ],
                  deals: row._deals || [],
                  exportDeals: (Array.isArray(row._deals) && row._deals.length > 0)
                    ? () => onExportYear?.(row)
                    : undefined,
                  note: row._isProjected
                    ? 'Projected = this year’s Sold (by Close Date) + every open Agreement Sent or Contracting opp. Click the bar to pin this panel, then ⬇ Excel to export.'
                    : 'Click the bar to pin this panel, then ⬇ Excel to export these deals.',
                })}
              />
            } />
            <Legend
              {...legendProps}
              payload={[
                { value: '% Quota', type: 'circle', color: '#eab308', id: 'pct', dataKey: 'pctQuota' },
                { value: 'New Client', type: 'rect', color: '#ef4444', id: 'new', dataKey: 'newClient' },
                { value: 'Current Client', type: 'rect', color: '#3b82f6', id: 'cur', dataKey: 'currentClient' },
              ]}
            />
            <Bar dataKey="currentClient" stackId="as" name="Current Client" fill="#3b82f6" isAnimationActive={false} hide={hidden.currentClient}>
              {data.map((row, i) => (
                <Cell key={i} fill={row._isProjected ? '#facc15' : '#3b82f6'} />
              ))}
              {/* Total sits here only for years whose top segment (New
                  Client) is $0 — otherwise it's drawn on the New Client bar.
                  valueAccessor hands the label its bar's own payload row so
                  the amount stays tied to the bar it's drawn over. */}
              <LabelList valueAccessor={(entry) => entry?.payload} content={renderTotalLabel('cur')} />
            </Bar>
            <Bar dataKey="newClient" stackId="as" name="New Client" fill="#ef4444" isAnimationActive={false} hide={hidden.newClient}>
              {data.map((row, i) => (
                <Cell key={i} fill={row._isProjected ? '#facc15' : '#ef4444'} />
              ))}
              <LabelList valueAccessor={(entry) => entry?.payload} content={renderTotalLabel('new')} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function DealSizeCard({ data, hasOpps, onDownload, onExportPoint }) {
  const hasAny = data.some(r => r.deals > 0);
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Deal Size" chartId="dealSize" onDownload={onDownload} canDownload={hasOpps && hasAny} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data — open the Opps tab to load.</div>
      ) : !hasAny ? (
        <div className={styles.empty}>No sold opps yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 20, right: 2, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="deals"
              tick={{ fontSize: 12 }}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="dollars"
              orientation="right"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row._isProjected ? 'Projected (YTD Sold + Agreement Sent)' : `Year ${label}`}
                valueFormat={(v, name) => {
                  if (v == null) return '—';
                  if (name === 'Deals') return v.toLocaleString('en-US');
                  return v ? fmtMoneyLabel(v) : '$0';
                }}
                explain={(row) => ({
                  formula: 'Deals = count of Sold opps (won deals), by Closed Year. Quoted = mean Quoted Amount of opps quoted that year, by Quoted On date. Deal Size = average deal size (mean Quoted Amount of Sold opps), by Closed Year.',
                  inputs: [
                    { label: 'Deals (Sold)', value: (row.deals ?? 0).toLocaleString('en-US') },
                    { label: row._isProjected ? 'Quoted mean (Sold + Agreement Sent)' : 'Quoted mean (by Quoted Year)', value: row.quoted == null ? '—' : `${fmtMoneyLabel(row.quoted)} (n=${row._quotedCount ?? 0})` },
                    { label: 'Deal Size mean', value: row.dealSize == null ? '—' : `${fmtMoneyLabel(row.dealSize)} (n=${row._soldCount ?? 0})` },
                  ],
                  note: row._isProjected ? 'Projected = this year’s Sold deals + every opp in the Agreement Sent stage, counted as expected future closes. Quoted is the mean Quoted Amount across only those Sold and Agreement Sent opps; Deal Size isn’t projected.' : null,
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar yAxisId="deals" dataKey="deals" name="Deals" isAnimationActive={false} hide={hidden.deals}>
              {data.map((row, i) => (
                <Cell key={i} fill={row._isProjected ? '#facc15' : '#94a3b8'} />
              ))}
              <LabelList dataKey="deals" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#475569' }} />
            </Bar>
            <Line
              yAxisId="dollars"
              dataKey="quoted"
              name="Quoted"
              stroke="#dc2626"
              strokeWidth={2}
              dot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.quoted}
            >
              <LabelList dataKey="quoted" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#991b1b' }} formatter={(v) => fmtThousandsLabel(v)} />
            </Line>
            <Line
              yAxisId="dollars"
              dataKey="dealSize"
              name="Deal Size"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.dealSize}
            >
              <LabelList dataKey="dealSize" position="bottom" style={{ fontSize: 10, fontWeight: 600, fill: '#1d4ed8' }} formatter={(v) => fmtThousandsLabel(v)} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function CommissionsCard({ data, hasCommissions, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Commissions" chartId="commissions" onDownload={onDownload} canDownload={hasCommissions && data.length > 0} />
      {!hasCommissions ? (
        <div className={styles.empty}>No deals with a Year value — add a Year and Commission on the Clients › Deals tab.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No deals with a Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 22, right: 8, left: 16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => fmtMoneyShort(v)}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label) => `Year ${label}`}
                valueFormat={(v) => (v == null ? '—' : fmtMoneyFull(v))}
                explain={(row) => ({
                  formula: 'Sum of the Deals tab’s Commission column for every deal whose Year column equals this year.',
                  inputs: [
                    { label: 'Deals counted', value: (row._rowCount ?? 0).toLocaleString('en-US') },
                    { label: 'Total', value: fmtMoneyFull(row.total) },
                  ],
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="total" name="Commissions" fill="#3b82f6" isAnimationActive={false} hide={hidden.total}>
              <LabelList
                dataKey="total"
                position="top"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => fmtMoneyFull(v)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
````

### src/components/YOYView/YOYView.module.css

````css
.wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  padding: 1rem 1.25rem 0.5rem;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.headerRight {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
}

.nomadworks {
  font-style: normal;
  text-align: right;
  font-size: var(--font-size-xs);
  line-height: 1.35;
  color: var(--color-text-muted);
}

.nomadworksName {
  display: block;
  font-weight: 700;
  color: var(--color-text);
}

.title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  margin: 0;
  color: var(--color-text);
}

.subtitle {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-top: 0.15rem;
}

.body {
  flex: 1;
  overflow: auto;
  padding: 0.5rem 1.25rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.row {
  display: flex;
  flex-direction: row;
  gap: 0.75rem;
  align-items: stretch;
}

.chartCard {
  flex: 1 1 0;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  padding: 0.75rem 0.85rem 0.85rem;
  display: flex;
  flex-direction: column;
}

.chartHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}

.chartTitle {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  color: var(--color-text);
}

.downloadBtn {
  padding: 0.25rem 0.6rem;
  font-size: 0.72rem;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.downloadBtn:hover:not(:disabled) {
  background: var(--color-bg);
}

.downloadBtn:disabled {
  color: var(--color-text-muted);
  cursor: not-allowed;
  opacity: 0.6;
}

/* Per-chart hide button in each ChartHeader. */
.hideBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  font-size: 0.8rem;
  line-height: 1;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
}

.hideBtn:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

/* Restore bar in the page header listing hidden charts as chips. */
.hiddenBar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  justify-content: flex-end;
}

.hiddenBarLabel {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-weight: 600;
}

.hiddenChip,
.showAllBtn {
  padding: 0.2rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.hiddenChip:hover,
.showAllBtn:hover {
  background: var(--color-bg);
}

.showAllBtn {
  color: var(--color-text-muted);
}

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-style: italic;
  padding: 2rem 1rem;
  text-align: center;
}

/* Custom hover tooltip (CalcTooltip) shared by every YOY chart. Shows the
   hovered point's series values, a "calculated" badge, and the formula +
   inputs that produced it. */
.calcTip {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  padding: 0.5rem 0.6rem;
  font-size: 0.72rem;
  color: var(--color-text);
  max-width: 280px;
  line-height: 1.35;
}

.calcTipHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-weight: 700;
  margin-bottom: 0.35rem;
}

.calcTipBadge {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: #15803d;
  background: rgba(34, 197, 94, 0.14);
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: 999px;
  padding: 0.05rem 0.4rem;
  white-space: nowrap;
}

/* "Pinned ✕" toggle shown in the docked panel header once a point is
   clicked/stuck. */
.calcPinBtn {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--color-accent);
  background: var(--color-accent-light, rgba(59, 125, 221, 0.12));
  border: 1px solid var(--color-accent);
  border-radius: 999px;
  padding: 0.05rem 0.45rem;
  white-space: nowrap;
  cursor: pointer;
  font-family: inherit;
}
.calcPinBtn:hover { filter: brightness(0.96); }

/* Small Excel-export button inside the pinned panel's deals header. */
.calcExportBtn {
  margin-left: auto;
  font-size: 0.62rem;
  font-weight: 700;
  color: #15803d;
  background: rgba(34, 197, 94, 0.14);
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: 6px;
  padding: 0.05rem 0.4rem;
  cursor: pointer;
  font-family: inherit;
}
.calcExportBtn:hover { filter: brightness(0.96); }

.calcTipSeries {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.calcTipRow {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.calcTipSwatch {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  flex: 0 0 auto;
}

.calcTipName {
  flex: 1 1 auto;
  color: var(--color-text-muted);
}

.calcTipVal {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.calcTipExplain {
  margin-top: 0.45rem;
  padding-top: 0.4rem;
  border-top: 1px dashed var(--color-border);
}

.calcTipFormula {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  margin-bottom: 0.35rem;
}

.calcTipInputs {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.calcTipInputRow {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.calcTipInputLabel {
  color: var(--color-text-muted);
}

.calcTipInputVal {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.calcTipNote {
  margin-top: 0.35rem;
  font-size: 0.66rem;
  font-style: italic;
  color: var(--color-text-muted);
}

/* Explanation panel. Floats against the right edge of the screen,
   vertically centred, so every chart's hover content portals into a
   spot that's easy to read — rather than a thin strip up top. It only
   covers (part of) the right-most charts while they're hovered, and
   collapses out of the way whenever nothing is hovered. */
.calcPanel {
  position: fixed;
  top: 50%;
  right: 14px;
  transform: translateY(-50%);
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 300px;
  max-width: 32vw;
  max-height: 80vh;
  overflow-y: auto;
  padding: 0.6rem 0.75rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 6px 22px rgba(15, 23, 42, 0.18);
}

/* No chart hovered → nothing portaled in → get fully out of the way so
   the panel never sits over the charts. The element still exists as the
   portal target. */
.calcPanel:empty {
  display: none;
}

/* Vertical layout for the side panel — heading, series values, then the
   formula/inputs/deals stack top-to-bottom so it reads in a narrow,
   tall panel. */
.calcDock {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.4rem;
  width: 100%;
  font-size: 0.74rem;
  color: var(--color-text);
  line-height: 1.35;
}

.calcDockLabel {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
}

.calcDockHeading { white-space: nowrap; }

.calcDockSeries {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.75rem;
}

.calcDockSeriesItem {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.calcDockName { color: var(--color-text-muted); }

.calcDockVal {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.calcDockExplain {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.2rem 0.7rem;
  width: 100%;
  padding-top: 0.4rem;
  margin-top: 0.1rem;
  border-top: 1px solid var(--color-border);
}

.calcDockFormula {
  flex-basis: 100%;
  font-size: 0.7rem;
  color: var(--color-text-muted);
}

.calcDockInputs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.7rem;
}

.calcDockInput {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
}

.calcDockInputLabel { color: var(--color-text-muted); }

.calcDockInputVal {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.calcDockNote {
  flex-basis: 100%;
  font-size: 0.68rem;
  font-style: italic;
  color: var(--color-text-muted);
}

/* Annual Sales — list of the deals that make up the hovered bar's total,
   shown in the docked panel. Wraps and scrolls so a busy year never
   pushes the strip too tall. */
.calcDockDeals {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1 1 100%;
  padding-top: 0.3rem;
  margin-top: 0.1rem;
  border-top: 1px dashed var(--color-border);
}

.calcDockDealsHead {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--color-text-muted);
}

.calcDockDealsList {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.9rem;
  max-height: 84px;
  overflow-y: auto;
}

.calcDockDeal {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
}

.calcDockDealAcct { color: var(--color-text); }

.calcDockDealVal {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

/* Quoted Projections — "Edit values" control row + editor modal. */
.quotedEditRow {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  margin: -0.2rem 0 0.3rem;
}

.quotedUnitNote {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  font-style: italic;
}

.editValuesBtn {
  padding: 0.2rem 0.55rem;
  font-size: 0.7rem;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}

.editValuesBtn:hover {
  background: var(--color-bg);
}

.modalOverlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.modalCard {
  width: 760px;
  max-width: 96vw;
  max-height: 90vh;
  background: var(--color-bg);
  border-radius: 8px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modalHead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--color-border);
}

.modalTitle {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text);
}

.modalSub {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  margin-top: 0.15rem;
  max-width: 560px;
}

.modalBody {
  overflow: auto;
  padding: 0.5rem 1rem;
}

.editTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.editTable th {
  text-align: left;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
  font-weight: 600;
  padding: 0.3rem 0.4rem;
  position: sticky;
  top: 0;
  background: var(--color-bg);
}

.editTable td {
  padding: 0.2rem 0.4rem;
  border-top: 1px solid var(--color-border-light, #eef2f7);
}

.editMonthCell {
  font-weight: 600;
  white-space: nowrap;
  color: var(--color-text);
}

.editInput {
  width: 100%;
  min-width: 72px;
  padding: 0.25rem 0.4rem;
  font-size: 0.78rem;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-surface);
  color: var(--color-text);
  text-align: right;
}

.modalFoot {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

.saveBtn {
  padding: 0.3rem 0.85rem;
  font-size: 0.78rem;
  font-weight: 700;
  font-family: inherit;
  border: none;
  border-radius: var(--radius-md);
  background: #2563eb;
  color: #fff;
  cursor: pointer;
}
````

### src/contexts/AuthContext.jsx

````jsx
// STUB for the standalone export.
//
// The real app authenticates with Firebase and resolves a per-user role
// from Firestore. This export has no backend, so we hand every consumer a
// static "signed-in admin" so the pages render with full access. The only
// thing the exported pages read from here is `user` (PricingView) — the
// rest of the surface is provided so nothing throws if it's referenced.

import { createContext, useContext } from 'react';

const DEMO_USER = {
  uid: 'demo-user',
  email: 'demo@example.com',
  displayName: 'Demo User',
};

const VALUE = {
  user: DEMO_USER,
  role: 'admin',
  isAdmin: true,
  loading: false,
  authError: null,
  // No-op auth actions — wired so buttons that call them don't crash.
  loginWithGoogle: async () => {},
  loginWithEmail: async () => {},
  signup: async () => {},
  logout: async () => {},
  resetPassword: async () => {},
};

const AuthContext = createContext(VALUE);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  return <AuthContext.Provider value={VALUE}>{children}</AuthContext.Provider>;
}
````

### src/data/enums.js

````javascript
export const STATUSES = [
  'Client',
  'Inside Sales',
  'Qualifying',
  'Hold Off',
  'Lost - Not Sold',
  'Old Client',
  'Partnering w/Another CDM',
];

export const STATUS_COLORS = {
  'Client': '#10B981',
  'Inside Sales': '#3B82F6',
  'Qualifying': '#F59E0B',
  'Hold Off': '#8B5CF6',
  'Lost - Not Sold': '#EF4444',
  'Old Client': '#6B7280',
  'Partnering w/Another CDM': '#06B6D4',
};

export const TYPES = [
  'Asset Management Firm',
  'Owner Operator',
  'Private Equity',
  'Portfolio Company',
  'Developer',
  'Facility Manager',
  'Other',
];

// PE engagement stages — only relevant when a prospect's Type is
// "Private Equity". Surfaced as a dropdown in the company popup and as
// four columns on the PE Portfolio → Portfolio sub-tab.
export const PE_STAGES = [
  'Discovery',
  'Piloting',
  'Existing Partnership',
  'Not Sold',
];

// PE investment strategies — the built-in starter vocabulary for the
// "PE Strategies" list on the Dropdowns tab (see DROPDOWN_LISTS). That
// list is the single source of truth the PE Firm sub-tab and company
// pop-up Strategies dropdowns read from; users edit it on the Dropdowns
// tab or add tags inline. Order here is the first-provided order.
export const PE_STRATEGIES = [
  'Venture Capital',
  'Real Estate + Credit',
  'Real Estate (Industrial)',
  'Buyout + Credit',
  'Real Estate (Office)',
  'Real Estate (Logistics)',
  'Real Estate (Residential)',
  'Buyout (Diversified)',
  'Real Estate (Diversified)',
  'Buyout (Industrial)',
  'Buyout (Lower-mid)',
  'Real Estate',
  'Distressed/Credit + Buyout',
  'Buyout (Tech) + Credit',
  'Buyout (Software)',
  'Growth/Buyout (Consumer)',
  'Real Estate (Data Center)',
  'Buyout (Asia)',
  'Infrastructure',
  'Buyout (Tech)',
  'Growth + Venture (Tech)',
  'Buyout (Tech/Services)',
  'Buyout (Tech/Gov)',
  'Growth Equity (Tech)',
  'Buyout (Media/Tech)',
  'Growth Equity',
  'Energy (Producer)',
  'Energy/Infra (Producer)',
];

export const GEOGRAPHIES = [
  'Global',
  'NAM',
  'State/Regional',
];

export const PUBLIC_PRIVATE = ['Public', 'Private'];

export const ASSET_TYPES = [
  'Commercial Office',
  'Multifamily',
  'Light Industrial/Logistics',
  'Retail/Mixed Use',
  'Hotels',
  'Medical Office/Senior Living',
  'Malls',
  'Single family',
  'Student Housing',
  'Life Sciences',
  'Storage',
  'Heavy Industrial',
  'Diversified',
  'Private Equity',
];

// Frameworks the Frameworks dropdown in the prospect modal offers.
// Kept in sync with LIST_FLAG_SOURCES so the modal and the My Accounts
// Frameworks column read from the same vocabulary.
export const FRAMEWORKS = [
  'Largest',
  'RECA',
  'CSRD',
  'CDP',
  'GRESB',
  'SBT',
  'Ecovadis',
  'UN PRI',
  'CA SB',
  'NZAM',
];

export const TIERS = ['Tier 1', 'Tier 2', 'Tier 3'];

export const COUNTRIES = [
  'United States', 'Canada', 'Mexico',
  'United Kingdom', 'Ireland', 'France', 'Germany', 'Spain', 'Italy', 'Portugal', 'Netherlands', 'Belgium', 'Luxembourg',
  'Switzerland', 'Austria', 'Denmark', 'Sweden', 'Norway', 'Finland', 'Iceland',
  'Poland', 'Czech Republic', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Greece', 'Croatia', 'Slovenia',
  'Estonia', 'Latvia', 'Lithuania',
  'Russia', 'Ukraine', 'Turkey', 'Israel',
  'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Bahrain', 'Oman',
  'South Africa', 'Egypt', 'Nigeria', 'Kenya', 'Morocco',
  'China', 'Hong Kong', 'Taiwan', 'Japan', 'South Korea', 'India', 'Singapore', 'Malaysia', 'Thailand', 'Vietnam', 'Indonesia', 'Philippines',
  'Australia', 'New Zealand',
  'Brazil', 'Argentina', 'Chile', 'Colombia', 'Peru',
];

export const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
  'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee',
  'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming',
  'Puerto Rico', 'Guam', 'U.S. Virgin Islands', 'American Samoa', 'Northern Mariana Islands',
];

export const SERVICE_CATEGORIES = [
  {
    name: 'DATA',
    items: [
      'Bill payment', 'AP upload (indirect payment)', 'Invoice collection',
      'Invoice collection - light', 'Client sends invoices', 'IDM', 'API/ETL',
      'Manual data upload', 'ESPM to RA', 'Utility feeds',
      'RA internal data feed', 'Waste data capture', 'Invoice variance testing',
      'Invoice recalculation', 'Invoice recalculation - light',
    ],
  },
  {
    name: 'RA Modules',
    items: [
      'RA dashboards & reporting', 'RA AV report', 'ESPM link',
      'Goals & Projects', 'SSO', 'ECH', 'ESG module', 'RA survey',
      'Capital asset planning', 'UCA', 'Power Availability Tool', 'RA + - pull through',
    ],
  },
  {
    name: 'Traditional Energy Management',
    items: [
      'Strategic sourcing', 'Professional sourcing', 'Insight sourcing',
      'Budgets', 'Deposit recovery', 'Open/Close', 'Rate optimization',
      'Risk managment', 'Risk - progressional', 'Risk - commodity insight',
      'Demand response', 'Procurement contract review', 'Water Cost Recovery',
      'Peak Alerts', 'Renewable natural gas', 'Tax Matrix - pull through',
      'Education calls',
    ],
  },
  {
    name: 'Consulting Services',
    items: [
      'Bespoke consulting SUCON', 'Materiality assessment SUCON',
      'Peer benchmarking SUCON', 'Sustainability exchange SUCON',
      'ESG marketing', 'ESG report', 'Communication Services', 'Due Diligence',
    ],
  },
  {
    name: 'GHG Reporting',
    items: [
      'GHG', 'Comp GHG', 'IMP', 'Rebasline project',
      'Assurance gap assessment',
    ],
  },
  {
    name: 'Renewables',
    items: [
      'EAC procurement - pull through', 'REOA', 'PPA/VPPA',
      'EAC/Offset Advisory', 'Tax Equity - pull through',
    ],
  },
  {
    name: 'Targets',
    items: [
      'Target setting/roadmaps SUCON', 'Scope 3 target/roadmap SUCON', 'SBT AV',
    ],
  },
  {
    name: 'Efficiency',
    items: [
      'Remote assessments', 'Audits', 'Partner scope',
      'Enterprise workshop', 'Facility Condition Assessment', 'UPRs',
      'Energy modeling', 'EPS',
    ],
  },
  {
    name: 'Scope 3',
    items: [
      'Scope 3 estimates', 'Cat 1 & 2', 'Cat 4', 'Cat 8', 'Cat 9',
      'Cat 10', 'Cat 11', 'Cat 12', 'Cat 13', 'Cat 14', 'Cat 15',
      'Cat 3, 5, 6, and 7 (part of GHG)', 'ClimFit',
    ],
  },
  {
    name: 'Climate Risk',
    items: [
      'Climate risk gap analysis', 'Climate risk & opportunity assessment',
      'Climate risk Scenario Analysis', 'Climate risk disclosure SUCON',
      'ECLR - SUCON', 'ECLR scorecards - SUCON', 'ECLR Consulting - SUCON',
    ],
  },
  {
    name: 'Value Chain Decarbonization',
    items: [
      'Value chain SUCON', 'Ziego Activate', 'Ziego Power',
      'Ziego Hub', 'Ziego Network',
    ],
  },
  {
    name: 'Investor Reporting',
    items: [
      'Reporting gap assessment', 'GRESB fully managed', 'GRESB quant',
      'GRESB scorecards', 'UN PRI - SUCON', 'CDP biodiversity risk assessment',
      'CDP biodiversity', 'CDP climate', 'CDP plastics', 'CDP water',
      'CDP water risk assessment', 'Ecovadis', 'GRI', 'SASB',
    ],
  },
  {
    name: 'Building Certifications',
    items: [
      'ENERGY STAR cert', 'Arc performance certs', 'LEED',
    ],
  },
  {
    name: 'Broader SE',
    items: [
      'EV', 'SE metering', 'Greenstruxure', 'Sensor Audit', 'EaaS',
      'Building Activate',
    ],
  },
  {
    name: 'Compliance Reporting',
    items: [
      'Corporate Compliance Screening', 'BBS reporting', 'BECS/BPS screening',
      'BPS reporting', 'Global compliance screening', 'CA SB Bills - SUCON',
      'Local Law 88',
    ],
  },
  {
    name: 'EU Compliance Reporting',
    items: [
      'CSRD readiness', 'CSRD - DMA - SUCON', 'ESOS', 'TCFD - UK',
      'E.E.D.', 'SECR', 'SFDR', 'RADAR',
    ],
  },
  {
    name: 'Partner Scopes',
    items: [
      'Metering partner', 'Audit partner', 'Virtual audit partner',
      'Pulsora', 'Electrification', 'Carbon and Energy Pricing Tool',
      'Carbon pricing scenario analysis',
    ],
  },
];

export const SERVICE_STATUSES = ['-', 'Exploring', 'Proposed', 'Qualifying', 'Quoting', 'Quoted', 'Verbal', 'Sold', 'Not Sold', 'Renewal', 'In Progress', 'N/A'];
````

### src/data/sampleData.js

````javascript
// Sample data for the standalone Lovable export.
//
// The real app feeds the Clients page from Firestore (the prospect
// roster) plus user-uploaded Deals / Commissions spreadsheets stored in
// localStorage. Here we hard-code a small but realistic dataset so all
// four subtabs (Clients, Old Clients, Deals, Commissions) render with
// content the moment the page loads.
//
//  - SAMPLE_PROSPECTS  → passed straight into <ClientsView prospects=…>
//  - SAMPLE_DEALS      → seeded into the Deals localStorage store
//  - SAMPLE_COMMISSIONS→ seeded into the Commissions localStorage store
//
// Every prospect's `cdm` matches SAMPLE_CDM_NAME so the page's
// CDM filter keeps them all. Deal `Client Name` values line up with the
// prospect `company` names so the per-client contract drill-down and the
// "Soonest Expiration / Days Until" columns light up.

import { COMMISSION_MONTH_NAMES, saveCommissionsOverride, loadCommissions } from '../utils/commissionsStore';
import { saveDealsOverride, loadDealsList } from '../utils/dealsStore';

export const SAMPLE_CDM_NAME = 'Dan Baldauf';

// --- helpers -------------------------------------------------------------

// Build an ISO-ish date string N days from today so the "Days Until"
// column shows a live spread (some expiring soon, some far out, some
// already past) no matter when the demo is opened.
function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// --- prospects (the client roster) --------------------------------------

export const SAMPLE_PROSPECTS = [
  {
    id: 'p1', company: 'Northwind Manufacturing', status: 'Client', cdm: 'Dan Baldauf',
    type: 'Industrial', website: 'northwind.example.com', numberOfSites: 12,
    servicesExplored: { energy: 'Yes', sustainability: 'Yes', procurement: '-' },
  },
  {
    id: 'p2', company: 'Cascade Retail Group', status: 'Client', cdm: 'Dan Baldauf',
    type: 'Retail', website: 'cascaderetail.example.com', numberOfSites: 48,
    servicesExplored: { energy: 'Yes' },
  },
  {
    id: 'p3', company: 'Harbor Logistics', status: 'Client', cdm: 'Dan Baldauf',
    type: 'Logistics', website: 'harborlogistics.example.com', numberOfSites: 7,
    servicesExplored: {},
  },
  {
    id: 'p4', company: 'Summit Healthcare Partners', status: 'Client', cdm: 'Dan Baldauf',
    type: 'Healthcare', website: 'summithealth.example.com', numberOfSites: 21,
    servicesExplored: { energy: 'Yes', sustainability: 'Yes' },
  },
  {
    id: 'p5', company: 'Brightline Foods', status: 'Client', cdm: 'Dan Baldauf',
    type: 'Food & Beverage', website: 'brightlinefoods.example.com', numberOfSites: 5,
    servicesExplored: { procurement: 'Yes' },
  },
  // --- Old Clients (show up on the "Old Clients" subtab) -----------------
  {
    id: 'p6', company: 'Meridian Textiles', status: 'Old Client', cdm: 'Dan Baldauf',
    type: 'Manufacturing', website: 'meridiantextiles.example.com', numberOfSites: 3,
    servicesExplored: {},
  },
  {
    id: 'p7', company: 'Pinecrest Hospitality', status: 'Old Client', cdm: 'Dan Baldauf',
    type: 'Hospitality', website: 'pinecrest.example.com', numberOfSites: 9,
    servicesExplored: { energy: 'Yes' },
  },
  // --- A couple of non-clients so the CDM/Status filters have something
  //     to exclude (they should NOT appear on Clients or Old Clients). ---
  {
    id: 'p8', company: 'Vertex Capital', status: 'Prospect', cdm: 'Dan Baldauf',
    type: 'Finance', website: 'vertexcapital.example.com', numberOfSites: 1,
    servicesExplored: {},
  },
  {
    id: 'p9', company: 'Acme Mining', status: 'Client', cdm: 'Someone Else',
    type: 'Mining', website: 'acmemining.example.com', numberOfSites: 4,
    servicesExplored: {},
  },
];

// --- deals / contracts (the Deals subtab + per-client drill-down) -------
// Flat objects keyed by the spreadsheet column headers the app expects.

export const SAMPLE_DEALS = [
  {
    'Client Name': 'Northwind Manufacturing', 'Agreement Name': 'Northwind — Electricity Supply 2024',
    'Paperwork completed': 'Yes', 'Current Term Start Date': daysFromNow(-400),
    'Payment Terms': 'Net 30', 'End Date': daysFromNow(25), 'Auto renewal?': 'Yes', 'Esc': 0.03,
    'Setup': 5000, 'Recurring Revenue': 4200, 'Commission': 1260, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1001',
  },
  {
    'Client Name': 'Northwind Manufacturing', 'Agreement Name': 'Northwind — Natural Gas 2024',
    'Paperwork completed': 'Yes', 'Current Term Start Date': daysFromNow(-300),
    'Payment Terms': 'Net 45', 'End Date': daysFromNow(210), 'Auto renewal?': 'No', 'Esc': 0.025,
    'Setup': 3000, 'Recurring Revenue': 2600, 'Commission': 780, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1002',
  },
  {
    'Client Name': 'Cascade Retail Group', 'Agreement Name': 'Cascade — Portfolio Electricity',
    'Paperwork completed': 'Yes', 'Current Term Start Date': daysFromNow(-200),
    'Payment Terms': 'Net 30', 'End Date': daysFromNow(75), 'Auto renewal?': 'Yes', 'Esc': 0.02,
    'Setup': 12000, 'Recurring Revenue': 9800, 'Commission': 2940, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1003',
  },
  {
    'Client Name': 'Harbor Logistics', 'Agreement Name': 'Harbor — Demand Response',
    'Paperwork completed': 'Pending', 'Current Term Start Date': daysFromNow(-120),
    'Payment Terms': 'Net 60', 'End Date': daysFromNow(-10), 'Auto renewal?': 'No', 'Esc': 0,
    'Setup': 2000, 'Recurring Revenue': 1500, 'Commission': 450, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1004',
  },
  {
    'Client Name': 'Summit Healthcare Partners', 'Agreement Name': 'Summit — Sustainability Advisory',
    'Paperwork completed': 'Yes', 'Current Term Start Date': daysFromNow(-90),
    'Payment Terms': 'Net 30', 'End Date': daysFromNow(300), 'Auto renewal?': 'Yes', 'Esc': 0.03,
    'Setup': 8000, 'Recurring Revenue': 6500, 'Commission': 1950, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1005',
  },
  {
    'Client Name': 'Brightline Foods', 'Agreement Name': 'Brightline — Procurement (Expired)',
    'Paperwork completed': 'Expired', 'Current Term Start Date': daysFromNow(-800),
    'Payment Terms': 'Net 30', 'End Date': daysFromNow(-120), 'Auto renewal?': 'No', 'Esc': 0,
    'Setup': 1500, 'Recurring Revenue': 0, 'Commission': 0, 'Commission Rate': 0.3,
    'Closed Won': 'Yes', 'BFO Link': 'BFO-1006',
  },
  {
    'Client Name': 'Meridian Textiles', 'Agreement Name': 'Meridian — Electricity (Cancelled)',
    'Paperwork completed': 'Cancelled', 'Current Term Start Date': daysFromNow(-600),
    'Payment Terms': 'Net 30', 'End Date': daysFromNow(-200), 'Auto renewal?': 'No', 'Esc': 0,
    'Setup': 1000, 'Recurring Revenue': 0, 'Commission': 0, 'Commission Rate': 0.3,
    'Closed Won': 'No', 'BFO Link': 'BFO-1007',
  },
];

// --- commissions (the Commissions subtab) -------------------------------
// Identity columns + monthly revenue + FY total + monthly commission.

function makeCommissionRow({ name, account, bfo, project, pct, fyRevenue }) {
  const row = {
    Name: name, 'Account Name': account, 'BFO Name': bfo, 'Project Name': project,
    'Comm Start Date': daysFromNow(-200), 'Comm End Date': daysFromNow(165), '%': pct,
    'FY Revenue': fyRevenue,
  };
  // Spread the FY revenue across the months with a little variation, and
  // derive the monthly commission from the percentage.
  const monthly = fyRevenue / 12;
  for (const m of COMMISSION_MONTH_NAMES) {
    row[`${m} Revenue`] = Math.round(monthly);
    row[m] = Math.round(monthly * pct);
  }
  return row;
}

export const SAMPLE_COMMISSIONS = [
  makeCommissionRow({ name: 'Dan Baldauf', account: 'Northwind Manufacturing', bfo: 'BFO-1001', project: 'Electricity Supply 2024', pct: 0.3, fyRevenue: 50400 }),
  makeCommissionRow({ name: 'Dan Baldauf', account: 'Cascade Retail Group', bfo: 'BFO-1003', project: 'Portfolio Electricity', pct: 0.3, fyRevenue: 117600 }),
  makeCommissionRow({ name: 'Dan Baldauf', account: 'Summit Healthcare Partners', bfo: 'BFO-1005', project: 'Sustainability Advisory', pct: 0.3, fyRevenue: 78000 }),
];

// --- seeding -------------------------------------------------------------

// Seed the localStorage-backed Deals / Commissions stores, but only when
// they're empty — so any edits you make in the running demo survive a
// reload. Call resetSampleData() to force a re-seed.
export function seedSampleData() {
  try {
    if (loadDealsList().count === 0) saveDealsOverride(SAMPLE_DEALS);
  } catch (err) { console.warn('Failed to seed sample deals', err); }
  try {
    if (loadCommissions().count === 0) saveCommissionsOverride(SAMPLE_COMMISSIONS);
  } catch (err) { console.warn('Failed to seed sample commissions', err); }
}

export function resetSampleData() {
  try { saveDealsOverride(SAMPLE_DEALS); } catch {}
  try { saveCommissionsOverride(SAMPLE_COMMISSIONS); } catch {}
}
````

### src/firebase.js

````javascript
// STUB for the standalone export.
//
// The full app initializes Firebase (Auth + Firestore) here. This export
// is offline, so there's nothing to initialize — we export the same names
// other modules import. `db` is only ever handed to the aliased, no-op
// `firebase/firestore` functions (see vite.config.js), so its value is
// never actually read. `auth` / `googleProvider` are only touched by code
// paths the stubbed AuthContext never reaches.
export const db = {};
export const auth = {};
export const googleProvider = {};
````

### src/stubs/firestore.js

````javascript
// SHIM for the Lovable export — stands in for `firebase/firestore`.
//
// The Opps page (OppsView2.jsx) imports `doc`, `collection`, `getDocs`
// and `onSnapshot` directly from `firebase/firestore` to power its
// cross-device real-time sync. This export is fully offline — there is
// no Firestore project behind it — so `vite.config.js` aliases
// `firebase/firestore` to this file. Every function is a harmless no-op:
//
//   • doc / collection      → return an opaque placeholder ref
//   • getDoc / getDocs      → resolve to an "empty" snapshot
//   • onSnapshot            → never fires; returns an unsubscribe fn
//   • setDoc / writeBatch … → resolve without doing anything
//
// The page's hydration logic already tolerates an empty cloud (it falls
// back to the local IndexedDB cache, which we seed with sample data),
// so the table renders fully and edits persist locally — they just
// don't sync anywhere.

const ref = { id: 'demo', path: 'demo' };

export function doc() { return ref; }
export function collection() { return ref; }
export function deleteField() { return undefined; }
export function serverTimestamp() { return Date.now(); }

export async function getDoc() {
  return { exists: () => false, data: () => null, id: 'demo' };
}

export async function getDocs() {
  return { forEach: () => {}, docs: [], empty: true, size: 0 };
}

export async function setDoc() {}
export async function deleteDoc() {}
export async function addDoc() { return ref; }

export function onSnapshot() {
  // Return the unsubscribe function the caller expects. The listener
  // never fires, so the page simply runs on its hydrated data.
  return () => {};
}

export function writeBatch() {
  return {
    set() { return this; },
    update() { return this; },
    delete() { return this; },
    async commit() {},
  };
}
````

### src/utils/cdmMatch.js

````javascript
// Match a prospect's CDM string against the configured user's CDM name.
// Mirrors the historical Baldauf-specific behavior in a generic way:
//   - last-name substring match (so "Baldauf" inside "Dan Baldauf" /
//     "Daniel Baldauf" / "D. Baldauf" / "Baldauf, Dan" all match)
//   - first-name + last-initial substring match (so "dan b" inside
//     abbreviated forms like "Dan B." or "Dan B Smith" still matches)
export function matchesCdm(prospectCdm, cdmName) {
  if (!prospectCdm || !cdmName) return false;
  const lower = String(prospectCdm).toLowerCase();
  const tokens = String(cdmName).toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const firstName = tokens[0];
  const lastName = tokens[tokens.length - 1];

  if (lower.includes(lastName)) return true;
  if (lastName !== firstName && lastName[0] && lower.includes(firstName + ' ' + lastName[0])) return true;
  return false;
}

// Keyword fallback used to guess which Target Accounts column holds the
// salesperson/CDM when the user hasn't explicitly mapped one on the
// Target Accounts page. Order matters — the first matching column wins.
const CDM_COLUMN_KEYWORDS = ['CDM', 'Salesperson', 'Sales Rep', 'Account Owner', 'Owner', 'Rep', 'Assigned', 'Team Member'];

// Find which header key holds the salesperson/CDM for a Target Accounts
// sheet — the user-mapped column when present, else the first keyword
// match. Returns '' when the sheet has no CDM column at all, which callers
// use to decide whether CDM filtering is even possible on that sheet.
export function findCdmColumnKey(headers, cdmColumn) {
  const list = Array.isArray(headers) ? headers : [];
  const col = String(cdmColumn || '').trim();
  if (col && list.includes(col)) return col;
  for (const key of list) {
    const lower = String(key || '').toLowerCase();
    for (const kw of CDM_COLUMN_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) return key;
    }
  }
  return '';
}

// Resolve the salesperson/CDM value for a single Target Accounts record.
// Prefers the column the user explicitly mapped on the Target Accounts
// page (settings.targetCdmColumn, passed in as `cdmColumn`); falls back
// to a keyword scan so sheets that don't carry the mapped column — or
// users who never set one — still resolve a rep. Returns a trimmed
// string ('' when nothing matches). This is the single source of truth
// for "who owns this account" across My Accounts, the prospect modal,
// the bulk Agenda page, and anywhere else that reads the workbook.
export function resolveTargetAccountCdm(record, cdmColumn) {
  if (!record) return '';
  const col = String(cdmColumn || '').trim();
  if (col && Object.prototype.hasOwnProperty.call(record, col)) {
    return String(record[col] || '').trim();
  }
  for (const key of Object.keys(record)) {
    const lower = String(key).toLowerCase();
    for (const kw of CDM_COLUMN_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) return String(record[key] || '').trim();
    }
  }
  return '';
}
````

### src/utils/clientIssues.js

````javascript
// Issue detection for the Issues tab. The Issues tab aggregates
// "outstanding items that need to be addressed" across the app; each
// detector below turns one class of problem into a flat issue row.
//
// The Clients-tab "Days Until" computation lives here so the Issues tab
// and the Clients tab agree on what's expired — there's one definition
// of soonest expiration, not two that can drift apart.
import { asDate, fmtDate } from './dealsFormat';
import { matchesCdm } from './cdmMatch';

const MS_PER_DAY = 86400000;

// The Paperwork column doubles as a status field — "Cancelled" / "Expired"
// mark agreements that no longer count regardless of their End Date.
const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'expired']);
export function isInactiveAgreement(deal) {
  const status = String(deal?.['Paperwork completed'] || '').trim().toLowerCase();
  return INACTIVE_STATUSES.has(status);
}

export function normClientName(s) {
  return String(s || '').trim().toLowerCase();
}

// Earliest contract End Date across the client's active deals, plus
// integer days from today (negative when the date is already past).
// Cancelled / Expired agreements are skipped; everything else counts
// regardless of whether the date is in the future.
export function soonestExpiration(deals) {
  if (!deals || deals.length === 0) return { date: null, days: null, deal: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  let bestMs = null;
  let bestDeal = null;
  for (const d of deals) {
    if (isInactiveAgreement(d)) continue;
    const parsed = asDate(d['End Date']);
    if (!parsed) continue;
    const dayStart = new Date(parsed);
    dayStart.setHours(0, 0, 0, 0);
    const ms = dayStart.getTime();
    if (bestMs == null || ms < bestMs) { bestMs = ms; bestDeal = d; }
  }
  if (bestMs == null) return { date: null, days: null, deal: null };
  return { date: new Date(bestMs), days: Math.round((bestMs - todayMs) / MS_PER_DAY), deal: bestDeal };
}

// Group deals by client, applying the user's source-name → client-name
// remapping (the helper column on the Deals subtab). Mirrors the
// grouping ClientsView uses so both tabs bucket contracts identically.
export function groupDealsByClient(dealsList, clientMap) {
  const map = new Map();
  for (const d of (dealsList || [])) {
    const raw = normClientName(d['Client Name']);
    if (!raw) continue;
    const mapped = clientMap?.[raw];
    const k = mapped ? normClientName(mapped) : raw;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(d);
  }
  return map;
}

function isClientStatus(p) {
  return String(p?.status || '').trim().toLowerCase() === 'client';
}

// Issue #1: a client whose soonest active contract End Date has already
// passed (negative Days Until) on the Clients tab. Untracked clients are
// skipped — the user has explicitly opted them out of expiration tracking,
// which is exactly why the Clients tab blanks their Days Until.
function detectNegativeDaysUntil({ prospects, cdmName, dealsByClient, untrackedMap }) {
  const issues = [];
  for (const p of prospects) {
    if (!matchesCdm(p.cdm, cdmName)) continue;
    if (!isClientStatus(p)) continue;
    const ck = normClientName(p.company);
    if (untrackedMap?.[ck]) continue;
    const next = soonestExpiration(dealsByClient.get(ck) || []);
    if (next.days == null || next.days >= 0) continue;
    const ago = Math.abs(next.days);
    issues.push({
      id: `neg-days:${p.id}`,
      source: 'Clients',
      type: 'Contract expired',
      company: p.company || '—',
      prospectId: p.id,
      daysUntil: next.days,
      expirationDate: next.date,
      detail: next.date
        ? `Soonest contract End Date (${fmtDate(next.date)}) passed ${ago} day${ago === 1 ? '' : 's'} ago`
        : `Soonest contract End Date passed ${ago} day${ago === 1 ? '' : 's'} ago`,
    });
  }
  return issues;
}

// A client whose soonest renewal falls inside this many days without a
// Status set is surfaced as an issue — mirrors the "needs a status" red
// row tint on the Clients tab (ClientsView's RENEWAL_WARNING_DAYS).
const RENEWAL_WARNING_DAYS = 270;

// A Clients-tab Status cell counts as "unset" when it's blank or just a
// dash placeholder. Matches the noStatus check in ClientsView.
function hasNoClientStatus(statusMap, clientKey) {
  const s = String(statusMap?.[clientKey] || '').trim();
  return s === '' || s === '-' || s === '—' || s === '–';
}

// Issue #4: a client whose soonest active contract renews within
// RENEWAL_WARNING_DAYS but has no Status set on the Clients tab — the same
// clients the Clients tab tints red. Already-expired contracts (negative
// Days Until) are left to the "Contract expired" detector so they aren't
// listed twice; this covers the upcoming-renewal window (0..270 days).
// Untracked clients are skipped, matching the Clients tab (blank Days Until).
function detectRenewalNoStatus({ prospects, cdmName, dealsByClient, untrackedMap, clientStatusMap }) {
  const issues = [];
  for (const p of prospects) {
    if (!matchesCdm(p.cdm, cdmName)) continue;
    if (!isClientStatus(p)) continue;
    const ck = normClientName(p.company);
    if (untrackedMap?.[ck]) continue;
    const next = soonestExpiration(dealsByClient.get(ck) || []);
    if (next.days == null || next.days < 0 || next.days >= RENEWAL_WARNING_DAYS) continue;
    if (!hasNoClientStatus(clientStatusMap, ck)) continue;
    issues.push({
      id: `renewal-no-status:${p.id}`,
      source: 'Clients',
      type: 'Renewal — no status',
      company: p.company || '—',
      prospectId: p.id,
      daysUntil: next.days,
      expirationDate: next.date,
      detail: next.date
        ? `Renews in ${next.days} day${next.days === 1 ? '' : 's'} (${fmtDate(next.date)}) with no Status set`
        : `Renews in ${next.days} day${next.days === 1 ? '' : 's'} with no Status set`,
    });
  }
  return issues;
}

// Issue: an active client (tracked) with NO soonest contract expiration
// date — no active deal carries a parseable End Date, so its renewal can't
// be tracked. Untracked ("Don't Track") clients are skipped, matching the
// Clients tab. Prompts the user to add a contract / End Date (or mark the
// client Don't Track).
function detectMissingExpiration({ prospects, cdmName, dealsByClient, untrackedMap }) {
  const issues = [];
  for (const p of prospects) {
    if (!matchesCdm(p.cdm, cdmName)) continue;
    if (!isClientStatus(p)) continue;
    const ck = normClientName(p.company);
    if (untrackedMap?.[ck]) continue;
    const next = soonestExpiration(dealsByClient.get(ck) || []);
    if (next.date != null) continue; // has an expiration date → fine
    issues.push({
      id: `no-expiration:${p.id}`,
      source: 'Clients',
      type: 'No expiration date',
      company: p.company || '—',
      prospectId: p.id,
      daysUntil: null,
      expirationDate: null,
      detail: 'No contract End Date on file — add a contract (or check Don\'t Track on the Clients tab) so its renewal can be tracked',
    });
  }
  return issues;
}

// Account statuses that MyAccountsView treats as inactive — an account
// parked in one of these isn't chased for a missing HQ Region (mirrors
// the check at MyAccountsView's hqRegion flag). Kept in sync with the
// STATUSES the My Accounts page suppresses.
const ACCOUNT_INACTIVE_STATUSES = new Set(['Old Client', 'Hold Off', 'Lost - Not Sold']);

// Issue #2: tier / status / missing-HQ-Region flags raised on the My
// Accounts page. MyAccountsView computes these against Target Accounts +
// Opps data and publishes a flat snapshot (one record per account+flag)
// to the my-accounts:flags store. That snapshot is only rewritten while
// MyAccountsView is mounted and recomputing, so it can lag behind an
// account the user just edited elsewhere (e.g. accept a status suggestion
// from the account modal) — leaving a row that repeats a stale status.
//
// So before mapping a published flag to a row we re-validate it against
// the LIVE account (matched by id): drop flags whose mismatch has since
// been resolved or whose account no longer exists (merged/deleted), and
// render the live status rather than the snapshot's frozen copy. The
// Opps-derived `suggestedStatus` isn't stored on the prospect, so it's
// still taken from the flag — but the comparison uses the live status.
//
// Re-validation only kicks in once `prospects` is populated; during the
// initial pre-load pass (empty list) we fall back to the stored snapshot
// so the sidebar badge doesn't momentarily undercount.
function detectMyAccountsFlags({ myAccountsFlags = [], prospects = [] }) {
  const issues = [];
  const canValidate = prospects.length > 0;
  const prospectById = new Map();
  if (canValidate) for (const p of prospects) prospectById.set(p.id, p);

  for (const f of myAccountsFlags) {
    if (!f || !f.id || !f.kind) continue;
    // Re-validate against the live account when we have one to check.
    const live = canValidate ? prospectById.get(f.id) : undefined;
    if (canValidate && !live) continue; // account was merged or deleted

    if (live && f.kind === 'status') {
      const suggested = f.suggestedStatus || '';
      // Same predicate MyAccountsView uses to raise the flag, but against
      // the live status — so accepting/dismissing the suggestion clears it.
      const stillMismatched = !live.hideStatusSuggestion
        && suggested && live.status && suggested !== live.status
        && live.dismissedSuggestedStatus !== suggested;
      if (!stillMismatched) continue;
    } else if (live && f.kind === 'hqRegion') {
      // Cleared once an HQ Region is set or the account goes inactive.
      if (live.hqRegion || ACCOUNT_INACTIVE_STATUSES.has(live.status)) continue;
    }

    // Prefer live company/status so the row never shows a stale copy.
    const company = (live && live.company) || f.company || '—';
    const liveStatus = live ? (live.status || '—') : (f.status || '—');
    if (f.kind === 'tier') {
      issues.push({
        id: `tier-mismatch:${f.id}`,
        source: 'My Accounts',
        type: 'Tier mismatch',
        company,
        prospectId: f.id,
        daysUntil: null,
        expirationDate: null,
        detail: `Your tier "${f.myTier || '—'}" doesn't match Target Accounts tier "${f.targetTier || '—'}"`,
      });
    } else if (f.kind === 'status') {
      issues.push({
        id: `status-mismatch:${f.id}`,
        source: 'My Accounts',
        type: 'Status mismatch',
        company,
        prospectId: f.id,
        daysUntil: null,
        expirationDate: null,
        detail: `Status "${liveStatus}" doesn't match Opps-suggested status "${f.suggestedStatus || '—'}"`,
      });
    } else if (f.kind === 'hqRegion') {
      issues.push({
        id: `hq-missing:${f.id}`,
        source: 'My Accounts',
        type: 'HQ Region missing',
        company,
        prospectId: f.id,
        daysUntil: null,
        expirationDate: null,
        detail: 'No HQ Region set',
      });
    }
  }
  return issues;
}

// Marketing Lead statuses that count as "closed out" — a lead in one of
// these needs no further action, so it's NOT an issue. Everything else
// (Working, 1 - New, etc.) is an open lead that still needs to be worked.
// Compared loosely (lower-cased, non-alphanumerics stripped) so hyphen /
// en-dash / spacing differences don't matter ("Closed-Recycle" ==
// "Closed–Recycle").
const MARKETING_LEAD_CLOSED_STATUSES = new Set(['closedconverted', 'closedrecycle']);
function marketingLeadStatusKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Issue #3: a Marketing Lead (Contacts page → Marketing Leads subtab)
// whose Status is set to anything other than Closed-Converted or
// Closed-Recycle — i.e. an open lead that still needs to be pushed to a
// terminal state. Leads with no Status yet are skipped (nothing to act
// on until the lead has been triaged).
function detectMarketingLeadStatuses({ marketingLeads = [] }) {
  const issues = [];
  for (const lead of marketingLeads) {
    const name = String(lead?.name || '').trim();
    const status = String(lead?.status || '').trim();
    if (!name || !status) continue;
    if (MARKETING_LEAD_CLOSED_STATUSES.has(marketingLeadStatusKey(status))) continue;
    const idPart = lead?.id != null ? String(lead.id) : name;
    issues.push({
      id: `marketing-lead-status:${idPart}`,
      source: 'Marketing Leads',
      type: 'Lead not closed out',
      company: lead.company || '—',
      prospectId: null,
      daysUntil: null,
      expirationDate: null,
      detail: `${name} — status "${status}" (not Closed-Converted or Closed-Recycle)`,
    });
  }
  return issues;
}

// Active clients whose soonest contract End Date falls within `withinDays`
// days (default 270 — the Clients-tab renewal-warning threshold). Mirrors
// the Clients-tab row build: CDM match + Status = Client, untracked clients
// skipped, soonest active End Date via soonestExpiration. Already-past
// contracts (negative days) are included — an expired contract needs
// attention most — and the list is sorted soonest / most-overdue first.
// Powers the Pipeline dashboard's renewals table.
export function computeExpiringClients({ prospects = [], cdmName, dealsList = [], clientMap = {}, managerMap = {}, untrackedMap = {}, statusMap = {}, withinDays = 270 }) {
  const dealsByClient = groupDealsByClient(dealsList, clientMap);
  const out = [];
  for (const p of prospects) {
    if (!matchesCdm(p.cdm, cdmName)) continue;
    if (!isClientStatus(p)) continue;
    const ck = normClientName(p.company);
    if (untrackedMap?.[ck]) continue;
    const next = soonestExpiration(dealsByClient.get(ck) || []);
    if (next.days == null || next.days >= withinDays) continue;
    out.push({
      id: p.id,
      company: p.company || '—',
      clientManager: managerMap?.[ck] || '',
      daysUntil: next.days,
      expiration: next.date,
      // Paperwork status of the soonest active contract (blank when the
      // deal row has no Paperwork value). Cancelled/Expired agreements are
      // already excluded by soonestExpiration, so this reflects the live one.
      contractStatus: (next.deal && String(next.deal['Paperwork completed'] || '').trim()) || '',
      // The user's editable "Renewal Status" from the Clients tab (the
      // clients-status-map), keyed by normalized company name — same source
      // and key the Clients page shows in its Renewal Status column.
      renewalStatus: String(statusMap?.[ck] || '').trim(),
    });
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}

// Build the full list of outstanding issues. Each detector contributes
// rows; add more detectors here as new issue classes are mapped.
export function computeIssues({ prospects = [], cdmName, dealsList = [], clientMap = {}, untrackedMap = {}, clientStatusMap = {}, myAccountsFlags = [], marketingLeads = [] }) {
  const dealsByClient = groupDealsByClient(dealsList, clientMap);
  const issues = [];
  issues.push(...detectNegativeDaysUntil({ prospects, cdmName, dealsByClient, untrackedMap }));
  issues.push(...detectRenewalNoStatus({ prospects, cdmName, dealsByClient, untrackedMap, clientStatusMap }));
  issues.push(...detectMissingExpiration({ prospects, cdmName, dealsByClient, untrackedMap }));
  issues.push(...detectMyAccountsFlags({ myAccountsFlags, prospects }));
  issues.push(...detectMarketingLeadStatuses({ marketingLeads }));
  return issues;
}
````

### src/utils/clientManagerStore.js

````javascript
// Per-client fields typed directly on the Clients tab — Client Manager
// name, In Person Meeting flag, and the user's custom Status. Each
// lives in its own localStorage key so a missing field doesn't blow
// away the others, and each is keyed by the normalized company name so
// casing / whitespace drift doesn't fragment the data across imports.
// All keys are scoped per user so accounts sharing a browser don't
// share client-tab notes / statuses.

import { userLsGet, userLsSet } from './userLs';

const MANAGER_KEY = 'clients-manager-map';
const IN_PERSON_KEY = 'clients-inperson-map';
const STATUS_KEY = 'clients-status-map';
const STATUS_SET_AT_KEY = 'clients-status-set-at';
const NOTES_KEY = 'clients-notes-map';
const UNTRACKED_KEY = 'clients-untracked-map';
const LOUISVILLE_KEY = 'clients-louisville-map';
export const CLIENT_MANAGER_EVENT = 'client-manager-changed';
export const CLIENT_IN_PERSON_EVENT = 'client-inperson-changed';
export const CLIENT_STATUS_EVENT = 'client-status-changed';
export const CLIENT_STATUS_SET_AT_EVENT = 'client-status-set-at-changed';
export const CLIENT_NOTES_EVENT = 'client-notes-changed';
export const CLIENT_UNTRACKED_EVENT = 'client-untracked-changed';
export const CLIENT_LOUISVILLE_EVENT = 'client-louisville-changed';

function normKey(s) { return String(s || '').trim().toLowerCase(); }

// Local calendar date (YYYY-MM-DD) — used to stamp when a Status was set so
// time-boxed statuses (e.g. "Reached out to CM") can auto-expire.
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadMap(key) {
  try {
    const raw = userLsGet(key);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

function persistMap(key, map, eventName) {
  try {
    userLsSet(key, JSON.stringify(map || {}));
    window.dispatchEvent(new Event(eventName));
  } catch (err) {
    console.warn(`Failed to persist ${key}`, err);
  }
}

export function loadClientManagerMap() { return loadMap(MANAGER_KEY); }
export function loadClientInPersonMap() { return loadMap(IN_PERSON_KEY); }
export function loadClientStatusMap() { return loadMap(STATUS_KEY); }
export function loadClientStatusSetAtMap() { return loadMap(STATUS_SET_AT_KEY); }
export function loadClientNotesMap() { return loadMap(NOTES_KEY); }
export function loadClientUntrackedMap() { return loadMap(UNTRACKED_KEY); }
export function loadClientLouisvilleMap() { return loadMap(LOUISVILLE_KEY); }

export function setClientManager(company, name) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientManagerMap();
  const trimmed = String(name || '').trim();
  if (!trimmed) delete map[key];
  else map[key] = trimmed;
  persistMap(MANAGER_KEY, map, CLIENT_MANAGER_EVENT);
}

export function setClientInPerson(company, checked) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientInPersonMap();
  if (checked) map[key] = true;
  else delete map[key];
  persistMap(IN_PERSON_KEY, map, CLIENT_IN_PERSON_EVENT);
}

export function setClientLouisville(company, checked) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientLouisvilleMap();
  if (checked) map[key] = true;
  else delete map[key];
  persistMap(LOUISVILLE_KEY, map, CLIENT_LOUISVILLE_EVENT);
}

export function setClientStatus(company, value) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientStatusMap();
  const trimmed = String(value || '').trim();
  const prev = map[key] || '';
  if (!trimmed) delete map[key];
  else map[key] = trimmed;
  persistMap(STATUS_KEY, map, CLIENT_STATUS_EVENT);
  // Stamp the moment a status BECOMES a new value so time-boxed statuses
  // (e.g. "Reached out to CM") can auto-expire. Only re-stamp on an actual
  // change — re-saving the same value must not reset the clock — and drop
  // the stamp when the status is cleared.
  if (trimmed !== prev) {
    const stamps = loadMap(STATUS_SET_AT_KEY);
    if (!trimmed) delete stamps[key];
    else stamps[key] = todayISO();
    persistMap(STATUS_SET_AT_KEY, stamps, CLIENT_STATUS_SET_AT_EVENT);
  }
}

// Set (or clear, with a falsy iso) the "status set at" stamp directly —
// used to start the clock on a status that predates the stamp store.
export function setClientStatusSetAt(company, iso) {
  const key = normKey(company);
  if (!key) return;
  const stamps = loadMap(STATUS_SET_AT_KEY);
  if (!iso) delete stamps[key];
  else stamps[key] = iso;
  persistMap(STATUS_SET_AT_KEY, stamps, CLIENT_STATUS_SET_AT_EVENT);
}

export function setClientUntracked(company, checked) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientUntrackedMap();
  if (checked) map[key] = true;
  else delete map[key];
  persistMap(UNTRACKED_KEY, map, CLIENT_UNTRACKED_EVENT);
}

export function setClientNotes(company, value) {
  const key = normKey(company);
  if (!key) return;
  const map = loadClientNotesMap();
  // Notes preserve leading/trailing newlines the user typed; only drop
  // the entry when it's purely whitespace.
  const next = String(value ?? '');
  if (!next.trim()) delete map[key];
  else map[key] = next;
  persistMap(NOTES_KEY, map, CLIENT_NOTES_EVENT);
}

// Every per-client typed field, paired with its change event, so a rename
// can sweep all of them in one place.
const ALL_CLIENT_MAPS = [
  [MANAGER_KEY, CLIENT_MANAGER_EVENT],
  [IN_PERSON_KEY, CLIENT_IN_PERSON_EVENT],
  [STATUS_KEY, CLIENT_STATUS_EVENT],
  [STATUS_SET_AT_KEY, CLIENT_STATUS_SET_AT_EVENT],
  [NOTES_KEY, CLIENT_NOTES_EVENT],
  [UNTRACKED_KEY, CLIENT_UNTRACKED_EVENT],
  [LOUISVILLE_KEY, CLIENT_LOUISVILLE_EVENT],
];

// How many per-client field values would move if `oldName` were renamed to
// `newName` — for the rename-confirmation summary. A field only moves when
// the new name doesn't already carry its own value (we never clobber data
// the user entered under the new name).
export function countClientFieldRenames(oldName, newName) {
  const o = normKey(oldName);
  const n = normKey(newName);
  if (!o || !n || o === n) return 0;
  let count = 0;
  for (const [key] of ALL_CLIENT_MAPS) {
    const map = loadMap(key);
    if (map[o] !== undefined && map[n] === undefined) count++;
  }
  return count;
}

// Move the Client Manager / In Person / Status / Notes / Untracked /
// Louisville values from `oldName` to `newName` so the typed Clients-tab
// data follows a company rename instead of stranding under the old name.
// Returns the number of field values moved.
export function renameClientFields(oldName, newName) {
  const o = normKey(oldName);
  const n = normKey(newName);
  if (!o || !n || o === n) return 0;
  let count = 0;
  for (const [key, evt] of ALL_CLIENT_MAPS) {
    const map = loadMap(key);
    if (map[o] !== undefined && map[n] === undefined) {
      map[n] = map[o];
      delete map[o];
      persistMap(key, map, evt);
      count++;
    }
  }
  return count;
}
````

### src/utils/commissionsStore.js

````javascript
// Persists the user's pasted Commissions table in localStorage, scoped
// per user so accounts sharing a browser don't inherit each other's
// roster. Empty until the first paste-import — the Commissions subtab
// on the Clients view greets a blank slate with a Paste-from-Sheets
// prompt.

import { userLsGet, userLsSet, userLsRemove } from './userLs';

const KEY = 'commissions-list-override';

export const COMMISSION_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Older rosters were stored under year-tagged keys like "1/1/2026" and
// "FY2026 Revenue". The user now wants the columns to be year-agnostic
// month names ("January", "January Revenue", "FY Revenue") with the
// year stripped on paste. Translate legacy keys on load so existing
// data shows up under the new columns without forcing a re-paste.
function migrateRowKeys(row) {
  if (!row || typeof row !== 'object') return { row, changed: false };
  const out = {};
  let changed = false;
  for (const [k, v] of Object.entries(row)) {
    let newKey = k;
    const monthRev = /^(\d{1,2})\/1\/\d{4}\s+Revenue$/i.exec(k);
    if (monthRev) {
      const mi = Number(monthRev[1]);
      if (mi >= 1 && mi <= 12) newKey = `${COMMISSION_MONTH_NAMES[mi - 1]} Revenue`;
    } else {
      const month = /^(\d{1,2})\/1\/\d{4}$/.exec(k);
      if (month) {
        const mi = Number(month[1]);
        if (mi >= 1 && mi <= 12) newKey = COMMISSION_MONTH_NAMES[mi - 1];
      } else if (/^FY\d{4}\s+Revenue$/i.test(k)) {
        newKey = 'FY Revenue';
      }
    }
    if (newKey !== k) changed = true;
    if (newKey in out) {
      // Collision (e.g. two legacy rows accidentally pasted under
      // different year suffixes for the same month). Sum numeric
      // values; otherwise leave the first one.
      const existingN = Number(String(out[newKey]).replace(/[,$%]/g, ''));
      const incomingN = Number(String(v).replace(/[,$%]/g, ''));
      if (!Number.isNaN(existingN) && !Number.isNaN(incomingN)) {
        out[newKey] = existingN + incomingN;
      }
    } else {
      out[newKey] = v;
    }
  }
  return { row: out, changed };
}

function migrateAllRows(rows) {
  let anyChanged = false;
  const out = rows.map(r => {
    const { row, changed } = migrateRowKeys(r);
    if (changed) anyChanged = true;
    return row;
  });
  return { rows: out, changed: anyChanged };
}

export function loadCommissions() {
  try {
    const raw = userLsGet(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const { rows, changed } = migrateAllRows(parsed);
        // Persist the migrated keys so the next load doesn't have to
        // translate again — and so other tabs see the new shape too.
        if (changed) {
          try { userLsSet(KEY, JSON.stringify(rows)); } catch { /* ignore */ }
        }
        return { data: rows, source: 'override', count: rows.length };
      }
    }
  } catch (err) {
    console.error('Failed to read commissions override:', err);
  }
  return { data: [], source: 'empty', count: 0 };
}

export function saveCommissionsOverride(arr) {
  if (!Array.isArray(arr)) throw new Error('Commissions override must be an array');
  userLsSet(KEY, JSON.stringify(arr));
}

export function clearCommissionsOverride() {
  userLsRemove(KEY);
}

// Commission rows link to a client through their "Account Name" lookup
// column (the autocomplete the user fills against the prospect roster).
const ACCOUNT_NAME_KEY = 'Account Name';
const commissionMatches = (row, lowerName) =>
  String(row?.[ACCOUNT_NAME_KEY] || '').trim().toLowerCase() === lowerName;

// How many commission rows point their Account Name at `oldName` — for the
// rename confirmation summary.
export function countCommissionsClientRename(oldName, newName) {
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim();
  if (!o || !n || o === n.toLowerCase()) return 0;
  return loadCommissions().data.filter(r => commissionMatches(r, o)).length;
}

// Rewrite the Account Name on every commission row that reads `oldName` onto
// `newName` so a client rename carries through to the Commissions subtab.
// Returns the number of rows changed.
export function renameCommissionsClient(oldName, newName) {
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim();
  if (!o || !n || o === n.toLowerCase()) return 0;
  const { data } = loadCommissions();
  let count = 0;
  const next = data.map(row => {
    if (commissionMatches(row, o)) { count++; return { ...row, [ACCOUNT_NAME_KEY]: n }; }
    return row;
  });
  if (count > 0) saveCommissionsOverride(next);
  return count;
}
````

### src/utils/companyIndex.js

````javascript
// Company-name matching index. Mirrors the rules of `companiesMatch`
// (lower-case + trim equality, NFKD-normalized equality, suffix-stripped
// equality, single-token "acronym" rule) but precomputes lookup maps so a
// pairwise query against N indexed strings is O(1) instead of O(N) calls
// to companiesMatch. The substring-with-length-threshold rule is dropped
// because it's hard to index efficiently and the suffix-stripped path
// already covers the common cases. Use this when matching one query
// against a large set (per-prospect contact/opps/dm lookups).

const DIACRITICS_RE = /[̀-ͯ]/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
const NON_ALNUM_SPACE_RE = /[^a-z0-9 ]/g;
const WS_RE = /\s+/g;
const CORP_SUFFIX_RE = /\b(inc|llc|ltd|corp|co|lp)\b\.?/gi;

// Ownership phrases like ", a Simon Property Group Co." or
// "(a Brookfield Co.)" — patterns where a subsidiary is described by
// embedding its parent's full name. The substring rule below would
// otherwise see the parent inside the subsidiary's display name and
// merge them (e.g. "Kering, a Simon Property Group Co." matched
// "Simon Property Group"). Strip the phrase off the query before the
// substring check so subsidiaries don't inherit parent matches.
const OWNERSHIP_PHRASE_RE = /[,(]\s*an?\s+[^()]+?\s+co(\.|mpany)?\)?\.?\s*$/i;
function removeOwnershipPhrase(s) {
  return String(s || '').replace(OWNERSHIP_PHRASE_RE, '').trim();
}

function flatten(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(NON_ALNUM_RE, ' ')
    .trim()
    .replace(WS_RE, ' ');
}

function strip(s) {
  return String(s || '')
    .toLowerCase()
    .replace(CORP_SUFFIX_RE, '')
    .replace(NON_ALNUM_SPACE_RE, '')
    .trim();
}

function tokensOf(s) {
  return String(s || '')
    .toLowerCase()
    .replace(NON_ALNUM_SPACE_RE, ' ')
    .split(WS_RE)
    .filter(Boolean);
}

function squish(s) {
  return String(s || '').toLowerCase().trim().replace(WS_RE, ' ');
}

function addTo(map, key, value) {
  let set = map.get(key);
  if (!set) { set = new Set(); map.set(key, set); }
  set.add(value);
}

function substringMatch(a, b) {
  // Mirrors the substring + length-threshold rule from companiesMatch:
  // shorter must be ≥ 4 chars and ≥ 60% of longer.length, and longer
  // must contain shorter as a substring.
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  return shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter);
}

export function buildCompanyIndex(strings) {
  const flatTo = new Map();
  const strippedTo = new Map();
  const squishTo = new Map();
  const tokenAppearsIn = new Map(); // token → strings whose tokens contain it
  const singleTokenIs = new Map();  // token → strings that ARE single-token == token
  const meta = new Map();           // original → { lower, stripped }
  for (const s of strings || []) {
    if (!s) continue;
    const lower = String(s).toLowerCase().trim();
    if (!lower) continue;
    const stripped = strip(lower);
    meta.set(s, { lower, stripped });
    const sq = squish(lower);
    if (sq) addTo(squishTo, sq, s);
    const f = flatten(lower);
    if (f) addTo(flatTo, f, s);
    if (stripped) addTo(strippedTo, stripped, s);
    const tokens = tokensOf(lower);
    if (tokens.length === 1 && tokens[0].length >= 3) {
      addTo(singleTokenIs, tokens[0], s);
    }
    for (const t of tokens) {
      if (t.length >= 3) addTo(tokenAppearsIn, t, s);
    }
  }
  return { flatTo, strippedTo, squishTo, tokenAppearsIn, singleTokenIs, meta };
}

export function findMatchesInIndex(index, query) {
  const matches = new Set();
  if (!index || !query) return matches;
  const lower = String(query).toLowerCase().trim();
  if (!lower) return matches;
  const sq = squish(lower);
  if (sq) {
    const hit = index.squishTo.get(sq);
    if (hit) for (const s of hit) matches.add(s);
  }
  const f = flatten(lower);
  if (f) {
    const hit = index.flatTo.get(f);
    if (hit) for (const s of hit) matches.add(s);
  }
  const st = strip(lower);
  if (st) {
    const hit = index.strippedTo.get(st);
    if (hit) for (const s of hit) matches.add(s);
  }
  const tokens = tokensOf(lower);
  if (tokens.length === 1 && tokens[0].length >= 3) {
    const hit = index.tokenAppearsIn.get(tokens[0]);
    if (hit) for (const s of hit) matches.add(s);
  } else if (tokens.length > 1) {
    for (const t of tokens) {
      if (t.length < 3) continue;
      const hit = index.singleTokenIs.get(t);
      if (hit) for (const s of hit) matches.add(s);
    }
  }
  // Substring + length-threshold rule. Narrowed to candidates that
  // share at least one significant token with the query so we run the
  // (cheap) substring check against ~tens of strings instead of all N.
  // Catches cases like "Bank of America" ↔ "Bank of America Holdings"
  // where the extra word isn't a corporate suffix the strip rule knows
  // about.
  if (lower.length >= 4) {
    const queryNoOwner = removeOwnershipPhrase(lower);
    const queryStripped = strip(queryNoOwner);
    const candidates = new Set();
    for (const t of tokens) {
      if (t.length < 3) continue;
      const hit = index.tokenAppearsIn.get(t);
      if (hit) for (const s of hit) candidates.add(s);
    }
    for (const s of candidates) {
      if (matches.has(s)) continue;
      const m = index.meta && index.meta.get(s);
      if (!m) continue;
      if (substringMatch(queryNoOwner, m.lower)) { matches.add(s); continue; }
      if (queryStripped && m.stripped && substringMatch(queryStripped, m.stripped)) {
        matches.add(s);
      }
    }
  }
  return matches;
}

// Strict variant of findMatchesInIndex: matches only on exact (lower /
// flatten / suffix-stripped) equality or the substring + length-threshold
// rule. It deliberately omits the loose single-token "acronym" rule, so a
// one-word name (e.g. an opp filed under "Blackstone") will NOT match a
// multi-word lookalike account ("Blackstone GP Stakes"). Use this where a
// brand-prefix coincidence would wrongly link two different accounts.
export function findStrictMatchesInIndex(index, query) {
  const matches = new Set();
  if (!index || !query) return matches;
  const lower = String(query).toLowerCase().trim();
  if (!lower) return matches;
  const sq = squish(lower);
  if (sq) {
    const hit = index.squishTo.get(sq);
    if (hit) for (const s of hit) matches.add(s);
  }
  const f = flatten(lower);
  if (f) {
    const hit = index.flatTo.get(f);
    if (hit) for (const s of hit) matches.add(s);
  }
  const st = strip(lower);
  if (st) {
    const hit = index.strippedTo.get(st);
    if (hit) for (const s of hit) matches.add(s);
  }
  // Substring + length-threshold rule (the same tight rule the loose
  // matcher uses) — but without any of the single-token shortcuts above it.
  if (lower.length >= 4) {
    const queryNoOwner = removeOwnershipPhrase(lower);
    const queryStripped = strip(queryNoOwner);
    const candidates = new Set();
    for (const t of tokensOf(lower)) {
      if (t.length < 3) continue;
      const hit = index.tokenAppearsIn.get(t);
      if (hit) for (const s of hit) candidates.add(s);
    }
    for (const s of candidates) {
      if (matches.has(s)) continue;
      const m = index.meta && index.meta.get(s);
      if (!m) continue;
      if (substringMatch(queryNoOwner, m.lower)) { matches.add(s); continue; }
      if (queryStripped && m.stripped && substringMatch(queryStripped, m.stripped)) {
        matches.add(s);
      }
    }
  }
  return matches;
}

// Convenience: does the query match any entry in the index?
export function hasMatchInIndex(index, query) {
  if (!index || !query) return false;
  const lower = String(query).toLowerCase().trim();
  if (!lower) return false;
  const sq = squish(lower);
  if (sq && index.squishTo.has(sq)) return true;
  const f = flatten(lower);
  if (f && index.flatTo.has(f)) return true;
  const st = strip(lower);
  if (st && index.strippedTo.has(st)) return true;
  const tokens = tokensOf(lower);
  if (tokens.length === 1 && tokens[0].length >= 3) {
    if (index.tokenAppearsIn.has(tokens[0])) return true;
  } else if (tokens.length > 1) {
    for (const t of tokens) {
      if (t.length >= 3 && index.singleTokenIs.has(t)) return true;
    }
  }
  if (lower.length >= 4 && index.meta) {
    const queryStripped = strip(lower);
    const candidates = new Set();
    for (const t of tokens) {
      if (t.length < 3) continue;
      const hit = index.tokenAppearsIn.get(t);
      if (hit) for (const s of hit) candidates.add(s);
    }
    for (const s of candidates) {
      const m = index.meta.get(s);
      if (!m) continue;
      if (substringMatch(lower, m.lower)) return true;
      if (queryStripped && m.stripped && substringMatch(queryStripped, m.stripped)) return true;
    }
  }
  return false;
}
````

### src/utils/companyNorm.js

````javascript
const CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;

export function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pickNameKey(headers) {
  const key = headers.find(k => /company|name|organi[sz]ation|signatory|entity|\bfirm\b/i.test(k));
  return key || headers[0];
}
````

### src/utils/db.js

````javascript
// Single source of truth for the prospect-tracker-db IndexedDB.
//
// Stores are PARTITIONED BY USER UID: every key is automatically
// prefixed with `${uid}:` so two users on the same browser get
// isolated views of every store. Calls made before `setDbUserId` is
// invoked (i.e., before auth) are blocked / return null so we never
// accidentally mix accounts.

const DB_NAME = 'prospect-tracker-db';

// All stores now use plain (null) keyPath. Records that previously
// embedded their primary key in the value are now written with an
// explicit key argument to dbPut.
const STORES = [
  { name: 'target-accounts',     keyPath: null },
  { name: 'opps-cache',          keyPath: null },
  { name: 'opps2-cache',         keyPath: null },
  { name: 'opps2-backups',       keyPath: null },
  { name: 'clients-cache',       keyPath: null },
  { name: 'settings-backups',    keyPath: null },
  { name: 'hubspot-contacts',    keyPath: null },
  { name: 'pricing-cache',       keyPath: null },
  { name: 'daily-success-log',   keyPath: null },
  { name: 'daily-success-goals', keyPath: null },
  { name: 'pipeline-dashboard',  keyPath: null },
  { name: 'bfo-activity',        keyPath: null },
];

let dbPromise = null;
let activeUid = null;

export function setDbUserId(uid) {
  activeUid = uid || null;
}

export function getDbUserId() {
  return activeUid;
}

function scoped(key) {
  if (!activeUid) throw new Error('IndexedDB call before setDbUserId(uid). Refusing to read/write unscoped data.');
  if (key === undefined || key === null) return `${activeUid}:`;
  return `${activeUid}:${key}`;
}

function isScopedKey(key) {
  return typeof key === 'string' && activeUid && key.startsWith(`${activeUid}:`);
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const probeDb = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // Decide if we need to migrate any existing store that has a
    // non-null keyPath (the legacy daily-success-log / settings-backups
    // shapes) to a null-keyPath store. Schema changes on existing
    // stores require a versionchange transaction.
    const needsRecreate = STORES.filter(s =>
      probeDb.objectStoreNames.contains(s.name) &&
      probeDb.transaction(s.name).objectStore(s.name).keyPath !== null
    );
    const missing = STORES.filter(s => !probeDb.objectStoreNames.contains(s.name));
    if (needsRecreate.length === 0 && missing.length === 0) return probeDb;

    const nextVersion = probeDb.version + 1;
    probeDb.close();
    return await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, nextVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Drop legacy keyPath stores; recreate with null keyPath.
        // Pre-existing entries in those stores are lost — they were
        // stored unscoped (no uid) and would leak across users
        // anyway. Acceptable since these stores hold per-day notes
        // and settings snapshots, both rebuildable.
        for (const s of needsRecreate) {
          db.deleteObjectStore(s.name);
          db.createObjectStore(s.name);
        }
        for (const s of missing) {
          db.createObjectStore(s.name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // Another tab on the same origin is holding the DB open at the
      // previous version, so the upgrade can't run. Reject loudly
      // instead of hanging forever — callers can surface a "close
      // your other tabs" hint.
      req.onblocked = () => reject(new Error(
        `IndexedDB upgrade to v${nextVersion} blocked — another tab has the database open at v${probeDb.version}. Close the other tabs and reload.`
      ));
    });
  })();
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

export async function dbGet(storeName, key) {
  if (!activeUid) return undefined;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(scoped(key));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Returns only entries owned by the active user. The store may
// contain entries from other users on the same browser; those are
// filtered out by checking the key's uid prefix.
export async function dbGetAll(storeName) {
  if (!activeUid) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    let keys, vals;
    keysReq.onsuccess = () => { keys = keysReq.result; if (vals !== undefined) finish(); };
    valsReq.onsuccess = () => { vals = valsReq.result; if (keys !== undefined) finish(); };
    keysReq.onerror = () => reject(keysReq.error);
    valsReq.onerror = () => reject(valsReq.error);
    function finish() {
      const out = [];
      for (let i = 0; i < keys.length; i++) {
        if (isScopedKey(keys[i])) out.push(vals[i]);
      }
      resolve(out);
    }
  });
}

export async function dbPut(storeName, value, key) {
  if (!activeUid) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, scoped(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDelete(storeName, key) {
  if (!activeUid) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(scoped(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
````

### src/utils/dealClientMap.js

````javascript
// Persists user-confirmed mappings from a deal-row Client Name to a
// canonical client (prospect company name). Keyed by the lowercased
// trimmed source name so casing / whitespace drift in the pasted data
// doesn't fragment the map across imports of the same tracker. Scoped
// per user so accounts sharing a browser don't share mapping state.

import { userLsGet, userLsSet } from './userLs';

const KEY = 'deals-client-map';
const IGNORE_KEY = 'deals-client-ignore';
export const DEALS_CLIENT_MAP_EVENT = 'deals-client-map-changed';

export function loadDealClientMap() {
  try {
    const raw = userLsGet(KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

// Returns the lowercased+trimmed source names the user has marked as
// "ignore" — those rows aren't expected to map to any client (admin
// fees, internal placeholders, etc.) and shouldn't count against the
// unmapped tally.
export function loadDealClientIgnore() {
  try {
    const raw = userLsGet(IGNORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(s => String(s || '').toLowerCase().trim()).filter(Boolean) : []);
  } catch { return new Set(); }
}

function persistMap(map) {
  try {
    userLsSet(KEY, JSON.stringify(map || {}));
    window.dispatchEvent(new Event(DEALS_CLIENT_MAP_EVENT));
  } catch (err) {
    console.warn('Failed to persist deal client map', err);
  }
}

function persistIgnore(set) {
  try {
    userLsSet(IGNORE_KEY, JSON.stringify([...set]));
    window.dispatchEvent(new Event(DEALS_CLIENT_MAP_EVENT));
  } catch (err) {
    console.warn('Failed to persist deal client ignore set', err);
  }
}

export function setDealClientMapping(sourceName, target) {
  const key = String(sourceName || '').toLowerCase().trim();
  if (!key) return;
  const map = loadDealClientMap();
  if (target == null || target === '') delete map[key];
  else map[key] = String(target);
  persistMap(map);
}

export function setDealClientIgnore(sourceName, ignored) {
  const key = String(sourceName || '').toLowerCase().trim();
  if (!key) return;
  const set = loadDealClientIgnore();
  if (ignored) set.add(key);
  else set.delete(key);
  persistIgnore(set);
}

export function bulkSetDealClientIgnore(sourceNames, ignored) {
  const set = loadDealClientIgnore();
  for (const n of sourceNames) {
    const key = String(n || '').toLowerCase().trim();
    if (!key) continue;
    if (ignored) set.add(key);
    else set.delete(key);
  }
  persistIgnore(set);
}

export function bulkSetDealClientMapping(sourceNames, target) {
  const map = loadDealClientMap();
  const next = String(target || '').trim();
  for (const n of sourceNames) {
    const key = String(n || '').toLowerCase().trim();
    if (!key) continue;
    if (!next) delete map[key];
    else map[key] = next;
  }
  persistMap(map);
}

// Build the migration for a client rename: every mapping whose TARGET is the
// old client name is repointed onto the new one, so user-confirmed deal→client
// links survive a rename. Returns { updated, count } or null when nothing
// changes.
function planDealClientRename(oldName, newName) {
  const old = String(oldName || '').trim();
  const next = String(newName || '').trim();
  if (!old || !next || old.toLowerCase() === next.toLowerCase()) return null;
  const map = loadDealClientMap();
  const updated = { ...map };
  let count = 0;
  for (const [k, v] of Object.entries(updated)) {
    if (typeof v === 'string' && v.trim().toLowerCase() === old.toLowerCase()) {
      updated[k] = next;
      count++;
    }
  }
  return count > 0 ? { updated, count } : null;
}

export function countDealClientRename(oldName, newName) {
  const plan = planDealClientRename(oldName, newName);
  return plan ? plan.count : 0;
}

export function renameDealClient(oldName, newName) {
  const plan = planDealClientRename(oldName, newName);
  if (!plan) return 0;
  persistMap(plan.updated);
  return plan.count;
}

// Resolves a deal row's Client Name to its canonical client name. When
// the user has set an explicit mapping for this source name, returns
// the mapped target; otherwise returns the source name unchanged so
// auto-matching (case-insensitive equality against the prospect pool)
// can still kick in downstream.
export function resolveClientName(sourceName, map) {
  const key = String(sourceName || '').toLowerCase().trim();
  if (!key) return '';
  const explicit = (map || loadDealClientMap())[key];
  return explicit || sourceName || '';
}
````

### src/utils/dealCommissions.js

````javascript
// Shared Deals ↔ Commissions matching helpers. Lives in its own module
// so both the Deals grid and the YOY Commissions chart can roll the
// Commissions roster up by BFO opp name without importing one component
// into another (which would also break Fast Refresh).

import { asNumber, asDate, fmtDate } from './dealsFormat';
import { COMMISSION_MONTH_NAMES } from './commissionsStore';

// The deal column holding the BFO opp name. It's the verbose label the
// user originally pasted from their tracker; the deal is matched against
// the Commissions tab's BFO Name column so the Revenue Recorded / Paid
// to Date cells can auto-populate from the matching roster rows.
export const DEAL_BFO_KEY = 'BFO - Close after contract execution email has been sent';

// Commissions tab stores monthly cells under year-agnostic month names:
// "January" for the commission $ and "January Revenue" for the
// underlying project revenue. Lookups here run against those keys.
const COMMISSION_MONTH_NAME_SET = new Set(COMMISSION_MONTH_NAMES);
function isCommissionMonthlyRevenueKey(k) {
  const s = String(k || '').trim();
  if (!s.endsWith(' Revenue')) return false;
  return COMMISSION_MONTH_NAME_SET.has(s.slice(0, s.length - ' Revenue'.length));
}
function isCommissionMonthlyKey(k) { return COMMISSION_MONTH_NAME_SET.has(String(k || '').trim()); }

// Normalize a BFO opp name for matching across Deals ↔ Commissions —
// the user copies and pastes the same identifier on both tabs so a
// loose compare (trimmed, lowercased, internal whitespace collapsed)
// shouldn't drop matches over trivial typing differences.
export function normBfo(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Mirror of the Commissions tab's Payment Status logic, run against the
// per-BFO aggregate so a deal that maps to multiple commission rows
// gets a single Active / Stopped read-out. Prefers the latest Comm End
// Date across matching rows; falls back to the latest non-zero
// commission month versus today when no end date is on file.
function computePaymentStatus(info) {
  if (info.endDate) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const e = new Date(info.endDate); e.setHours(0, 0, 0, 0);
    if (e.getTime() < today.getTime()) {
      return { state: 'stopped', label: 'Stopped', title: `Comm End Date ${fmtDate(info.endDate)} is in the past` };
    }
    return { state: 'active', label: 'Active', title: `Comm End Date ${fmtDate(info.endDate)}` };
  }
  let lastIdx = -1;
  for (let m = 0; m < 12; m++) if (info.monthlyComm[m] !== 0) lastIdx = m;
  if (lastIdx === -1) return { state: 'unknown', label: '—', title: 'No Comm End Date and no commission entries on file' };
  const todayMonthIdx = new Date().getMonth();
  if (lastIdx >= todayMonthIdx - 1) {
    return { state: 'active', label: 'Active', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]}` };
  }
  return { state: 'stopped', label: 'Stopped', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]} — no payments since` };
}

// Roll the Commissions roster into a map keyed by normalized BFO Name,
// summing each project's monthly revenue / commission cells. Multiple
// commission rows that share a BFO Name (different project lines of
// the same opp) accumulate into a single total, and the latest Comm
// End Date across them feeds the Payment Status read-out. Returns an
// empty Map when nothing is on file so callers can treat the lookup
// uniformly.
export function indexCommissionsByBfo(rows) {
  const map = new Map();
  for (const row of (rows || [])) {
    const key = normBfo(row?.['BFO Name']);
    if (!key) continue;
    let revenue = 0;
    let commission = 0;
    const monthlyComm = new Array(12).fill(0);
    const endDate = asDate(row?.['Comm End Date']);
    for (const [k, v] of Object.entries(row)) {
      const n = asNumber(v);
      if (n == null) continue;
      if (isCommissionMonthlyRevenueKey(k)) {
        revenue += n;
        continue;
      }
      if (isCommissionMonthlyKey(k)) {
        commission += n;
        const idx = COMMISSION_MONTH_NAMES.indexOf(String(k).trim());
        if (idx >= 0) monthlyComm[idx] += n;
      }
    }
    const prev = map.get(key);
    if (prev) {
      prev.revenue += revenue;
      prev.commission += commission;
      prev.rows += 1;
      for (let i = 0; i < 12; i++) prev.monthlyComm[i] += monthlyComm[i];
      if (endDate && (!prev.endDate || endDate.getTime() > prev.endDate.getTime())) {
        prev.endDate = endDate;
      }
    } else {
      map.set(key, { revenue, commission, rows: 1, monthlyComm, endDate: endDate || null });
    }
  }
  for (const info of map.values()) info.paymentStatus = computePaymentStatus(info);
  return map;
}
````

### src/utils/dealsFormat.js

````javascript
// Cell formatters shared between the Deals subtab and the Clients-tab
// contract drill-down. Both views show the same Excel-derived data,
// so currency / percent / date / yes-no rendering lives here once.

export function asNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const cleaned = String(v).replace(/[\s,$]/g, '').replace(/%$/, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function fmtCurrency(v) {
  const n = asNumber(v);
  if (n == null) return v ?? '';
  // Round to the nearest dollar — the trailing .00 on every cell was
  // noisy in the Deals tab where amounts are reviewed at a glance.
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

export function fmtPercent(v) {
  const n = asNumber(v);
  if (n == null) return v ?? '';
  // Excel often gives 0.10 for 10%; treat anything ≤1 as already a fraction.
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  // Drop trailing zeros so 20.00% reads as 20%; keep up to 2 decimals
  // for values that actually need them.
  return `${pct.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}%`;
}

// Parse a deal cell into a JS Date, or null if it isn't one. Used by
// both the formatter below and the sort comparator so the column
// sorts the same way it displays. Handles ISO strings, locale date
// strings (M/D/YYYY), JS Date instances, and the Excel serial format
// XLSX emits when cellDates is off.
export function asDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date((v - 25569) * 86400 * 1000);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(v).trim();
  if (s.length < 6) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

// The calendar year a deal belongs to, derived from its Original Contract
// Start date. This is what the Deals tab renders in its read-only Year
// column, so anything that buckets deals by year (e.g. the YOY Commissions
// chart) must use this rather than the raw, often-blank stored 'Year' cell
// — otherwise a deal that shows 2026 from its contract date gets skipped.
// Returns '' when the date is missing or unparseable.
export function dealYear(row) {
  const d = asDate(row?.['Original Contract Start']);
  return d ? String(d.getFullYear()) : '';
}

export function fmtDate(v) {
  const d = asDate(v);
  if (!d) return v == null ? '' : String(v);
  // Short numeric format (M/D/YYYY) — easier to scan and sorts cleanly
  // when the underlying value is sent through asDate(...).getTime().
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}

export function isTruthy(v) {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === 'x' || s === '✓' || s === 'done' || s === '1';
}

export const DEAL_CURRENCY_KEYS = new Set([
  'Setup', 'Recurring Revenue', 'Commission', 'Revenue Recorded',
  'Paid to Date', 'Delta', 'Current Value',
]);
export const DEAL_DATE_KEYS = new Set([
  'Current Term Start Date', 'Original Contract Start', 'Due Date',
  'End Date', 'Follow Up On Sale',
]);
export const DEAL_PERCENT_KEYS = new Set(['Commission Rate', 'Esc', 'GM']);
export const DEAL_CHECK_KEYS = new Set([
  'Paperwork completed', 'Billing information collected', 'Closed Won',
  'On Client Tracker?', 'BFO - Close after contract execution email has been sent',
  'Currently being paid', 'Auto renewal?', 'SUCON?', 'Combined',
  'Comm Tracker?', 'Comm Tracker?2', 'Comm Tracker?3',
  'Comm Tracker?4', 'Comm Tracker?5', 'Comm Tracker?6',
  'Commission Sheet Sent to Kathy',
]);
````

### src/utils/dealsStore.js

````javascript
// Persists a user-uploaded Deals roster in localStorage, scoped per
// user so accounts sharing a browser don't inherit each other's data.
// No bundled default — the Deals sub-tab starts empty until the user
// uploads their tracker workbook.

import { userLsGet, userLsSet, userLsRemove, userLsHas } from './userLs';

const KEY = 'deals-list-override';
// Fired whenever the deals roster is saved or cleared, so same-window
// listeners (e.g. the Issues badge) refresh — the native 'storage' event
// only fires in OTHER tabs, never the one that made the change.
export const DEALS_LIST_EVENT = 'deals-list-changed';

export function loadDealsList() {
  try {
    const raw = userLsGet(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { data: parsed, source: 'override', count: parsed.length };
    }
  } catch (err) {
    console.error('Failed to read deals override:', err);
  }
  return { data: [], source: 'empty', count: 0 };
}

export function saveDealsOverride(arr) {
  if (!Array.isArray(arr)) throw new Error('Deals override must be an array');
  userLsSet(KEY, JSON.stringify(arr));
  try { window.dispatchEvent(new Event(DEALS_LIST_EVENT)); } catch { /* no window */ }
}

export function clearDealsOverride() {
  userLsRemove(KEY);
  try { window.dispatchEvent(new Event(DEALS_LIST_EVENT)); } catch { /* no window */ }
}

export function hasDealsOverride() {
  try { return userLsHas(KEY); } catch { return false; }
}

const dealMatches = (row, lowerName) =>
  String(row?.['Client Name'] || '').trim().toLowerCase() === lowerName;

// How many deal rows carry `oldName` as their Client Name — for the rename
// confirmation summary.
export function countDealsClientRename(oldName, newName) {
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim();
  if (!o || !n || o === n.toLowerCase()) return 0;
  return loadDealsList().data.filter(r => dealMatches(r, o)).length;
}

// Rewrite the Client Name on every deal row that reads `oldName` onto
// `newName` so a client rename carries through to the Deals subtab. Returns
// the number of rows changed.
export function renameDealsClient(oldName, newName) {
  const o = String(oldName || '').trim().toLowerCase();
  const n = String(newName || '').trim();
  if (!o || !n || o === n.toLowerCase()) return 0;
  const { data } = loadDealsList();
  let count = 0;
  const next = data.map(row => {
    if (dealMatches(row, o)) { count++; return { ...row, 'Client Name': n }; }
    return row;
  });
  if (count > 0) saveDealsOverride(next);
  return count;
}
````

### src/utils/hubspotContactsCache.js

````javascript
// Async cache for HubSpot contacts, backed by IndexedDB.
//
// Replaces the previous localStorage cache, which silently failed once the
// payload exceeded the ~5–10 MB localStorage quota — leaving callers reading
// a stale snapshot. IndexedDB has effectively no quota concern at this scale.
//
// On first read, any cache still in localStorage is migrated into IDB and the
// localStorage entry is removed.

import { dbGet, dbPut } from './db';

const STORE = 'hubspot-contacts';
const KEY = 'cache';
const LS_KEY = 'hubspot-sync-cache';

let migrationPromise = null;

async function migrateFromLocalStorage() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    try {
      const existing = await dbGet(STORE, KEY);
      if (existing) return;
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.contacts) {
        await dbPut(STORE, parsed, KEY);
      }
      try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
    } catch (err) {
      console.warn('hubspotContactsCache migration failed', err);
    }
  })();
  return migrationPromise;
}

export async function getHubspotCache() {
  await migrateFromLocalStorage();
  try {
    return (await dbGet(STORE, KEY)) || null;
  } catch {
    return null;
  }
}

export async function getHubspotContacts() {
  const c = await getHubspotCache();
  return c?.contacts || [];
}

export async function setHubspotCache(cache) {
  await migrateFromLocalStorage();
  await dbPut(STORE, cache, KEY);
  notifyCacheUpdated();
}

// Overwrite the cache with a fresh full server pull, but carry forward any
// locally-created ("manual") contacts the snapshot doesn't include yet.
//
// HubSpot's search index lags a few seconds behind contact creation, so a
// refresh fired soon after "+ Add Contact" returns a snapshot WITHOUT the
// brand-new contact. A plain overwrite would drop it from the cache, and
// since the company popup pins manual contacts by id (companyContactLinks),
// the pin would then point at a contact that's gone — so it vanishes from
// every popup. Preserving manual contacts not in the snapshot keeps them
// visible until HubSpot indexes them, at which point the snapshot carries
// them (matched by id or email) and they become normal contacts.
export async function setHubspotCachePreservingManual(cache) {
  await migrateFromLocalStorage();
  let preserved = [];
  try {
    const current = await getHubspotCache();
    const incoming = cache?.contacts || [];
    const ids = new Set(incoming.map(c => String(c.id || c.vid || '')).filter(Boolean));
    const emails = new Set(incoming.map(c => (c.email || '').toLowerCase()).filter(Boolean));
    preserved = (current?.contacts || []).filter(c => {
      if (c?._source !== 'manual') return false;
      const id = String(c.id || c.vid || '');
      const email = (c.email || '').toLowerCase();
      if (id && ids.has(id)) return false;
      if (email && emails.has(email)) return false;
      return true;
    });
  } catch { /* fall back to a plain overwrite */ }
  const merged = preserved.length
    ? { ...cache, contacts: [...(cache.contacts || []), ...preserved] }
    : cache;
  await dbPut(STORE, merged, KEY);
  notifyCacheUpdated();
}

// Read-modify-write helper for callers that mutate contacts then save.
// `mutate` receives a shallow clone and may return a new cache, or mutate
// and return undefined (in which case the clone is saved).
export async function updateHubspotCache(mutate) {
  const current = (await getHubspotCache()) || { contacts: [] };
  const draft = { ...current, contacts: [...(current.contacts || [])] };
  const result = mutate(draft);
  await setHubspotCache(result || draft);
}

export function notifyCacheUpdated() {
  try { window.dispatchEvent(new Event('hubspot-cache-updated')); } catch { /* noop */ }
}

// Console escape hatch for inspection (replacement for the old
// `JSON.parse(localStorage.getItem('hubspot-sync-cache'))` one-liner).
if (typeof window !== 'undefined') {
  window.__hubspotCache = { getHubspotCache, getHubspotContacts, setHubspotCache };
}
````

### src/utils/listBackupSync.js

````javascript
// Firestore-backed backup of uploaded list source data (the rows
// uploaded from CSRD / CDP / GRESB / RECA / EcoAct / etc. exports).
// Mirrors what's in IndexedDB so a browser "Clear site data" can't
// wipe a list — the next page load auto-restores from Firestore.
//
// Storage layout:
//   listBackups/<storageKey>                  ← shared across users
//     {
//       chunkCount: number,
//       count: number (row count),
//       savedAt: number (Date.now()),
//       chunk0: string (JSON of rows[0..N]),
//       chunk1: string,
//       ...
//     }
//
// The Lists tab is intentionally shared across all signed-in users
// (see CLAUDE.md). Before this commit each user had their own copy at
// users/<uid>/listBackups/<storageKey>, which meant a non-admin user
// signing in on a fresh device saw an empty Lists tab. The shared
// path makes the lists cross-device for everyone.
//
// Legacy fallback: existing admin data at users/<uid>/listBackups/...
// is read on cache miss and copied into the shared path on the fly,
// so the admin's lists move to the shared collection without manual
// migration. On clear, both paths are deleted.
//
// Each chunk targets ~600KB to stay comfortably under the 1MB
// per-doc Firestore limit. Larger lists span multiple chunks; chunk
// count is bounded only by the per-doc field count (1500), so up to
// ~900MB of raw JSON per list is supported in theory.

import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';

const CHUNK_BYTES = 600_000;

function chunkString(str, size) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}

function sharedDoc(storageKey) {
  return doc(db, 'listBackups', storageKey);
}

function legacyDoc(userId, storageKey) {
  return doc(db, 'users', userId, 'listBackups', storageKey);
}

function unpackChunks(data) {
  const n = Number(data?.chunkCount) || 0;
  if (n === 0) return null;
  let json = '';
  for (let i = 0; i < n; i++) {
    const c = data[`chunk${i}`];
    if (typeof c !== 'string') return null;
    json += c;
  }
  try {
    const rows = JSON.parse(json);
    return Array.isArray(rows) ? rows : null;
  } catch { return null; }
}

function buildPayload(rows) {
  const json = JSON.stringify(rows);
  const chunks = chunkString(json, CHUNK_BYTES);
  const payload = {
    chunkCount: chunks.length,
    count: rows.length,
    savedAt: Date.now(),
  };
  chunks.forEach((c, i) => { payload[`chunk${i}`] = c; });
  return payload;
}

export async function saveListBackup(userId, storageKey, rows) {
  if (!storageKey) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    // Empty list = clear backup so the auto-restore path doesn't
    // surface stale data after the user explicitly cleared.
    try { await deleteDoc(sharedDoc(storageKey)); } catch {}
    if (userId) { try { await deleteDoc(legacyDoc(userId, storageKey)); } catch {} }
    return;
  }
  const payload = buildPayload(rows);
  await setDoc(sharedDoc(storageKey), payload);
}

export async function loadListBackup(userId, storageKey) {
  if (!storageKey) return null;
  try {
    // Shared path is the canonical store.
    const shared = await getDoc(sharedDoc(storageKey));
    if (shared.exists()) {
      const rows = unpackChunks(shared.data());
      if (rows) return rows;
    }
    // Legacy per-user fallback. If found, opportunistically promote
    // into the shared collection so future reads (including for other
    // signed-in users) hit the fast path. Best-effort: if the write
    // fails (e.g. permission rules), still return the legacy data.
    if (userId) {
      const legacy = await getDoc(legacyDoc(userId, storageKey));
      if (legacy.exists()) {
        const rows = unpackChunks(legacy.data());
        if (rows) {
          try { await setDoc(sharedDoc(storageKey), buildPayload(rows)); } catch {}
          return rows;
        }
      }
    }
    return null;
  } catch (err) {
    console.warn('loadListBackup failed', storageKey, err);
    return null;
  }
}

export async function clearListBackup(userId, storageKey) {
  if (!storageKey) return;
  try { await deleteDoc(sharedDoc(storageKey)); } catch {}
  if (userId) { try { await deleteDoc(legacyDoc(userId, storageKey)); } catch {} }
}
````

### src/utils/oppsCache.js

````javascript
// Read helper for opportunities.
//
// Opps 2 (`opps2-cache` IndexedDB + `opps2Data` Firestore) is the
// canonical store. The legacy Opps tab (`opps-cache`, fed from a
// Google Sheet) is kept in the sidebar as a read-only backup view of
// the sheet — it no longer feeds Opps 2 in any way. Opps 2 evolves
// independently from user edits.

import { dbGet } from './db';

const OPPS2_STORE = 'opps2-cache';

// Returns the Opps 2 cache (the canonical opps store). Consumers
// across the app go through this helper so a future re-shape of the
// underlying storage only touches one file. Returns null when the
// cache hasn't been populated yet (e.g. the user hasn't opened Opps 2
// in this browser session and Firestore hasn't been synced down).
export async function loadOppsFromCache() {
  try {
    const data = await dbGet(OPPS2_STORE, 'data');
    if (!data) return null;
    return {
      headers: Array.isArray(data.headers) ? data.headers : [],
      records: Array.isArray(data.records) ? data.records : [],
      fetchedAt: data.fetchedAt || null,
    };
  } catch {
    return null;
  }
}

export function findOppByBfoLink(cache, bfoLink) {
  if (!cache?.records || !bfoLink) return null;
  const target = String(bfoLink).trim().toLowerCase();
  return cache.records.find(r => String(r['BFO Link'] || '').trim().toLowerCase() === target) || null;
}

export function searchOpps(cache, term) {
  if (!cache?.records) return [];
  const t = (term || '').trim().toLowerCase();
  if (!t) return cache.records.slice(0, 25);
  return cache.records.filter(r => {
    return ['Account', 'Contact', 'BFO Link', 'Scope', 'Stage']
      .some(k => String(r[k] || '').toLowerCase().includes(t));
  }).slice(0, 25);
}
````

### src/utils/oppsSheetUrl.js

````javascript
// STUB for the standalone export.
//
// In the full app this returned an "Opps" Google Sheet CSV-export URL that
// the Progress subtab auto-fetches. The export ships with no sheet
// configured (and deliberately does NOT embed anyone's private sheet), so
// every getter returns empty and the Progress view skips the fetch and
// renders from its local/sample data. Point it at your own sheet by
// setting `settings.oppsSheetUrl` if you want that auto-pull back.

export const DEFAULT_ADMIN_OPPS_SHEET_URL = '';
export const DEFAULT_ADMIN_OPPS_SHEET_EDIT_URL = '';

export function getOppsSheetCsvUrl({ settings } = {}) {
  const cfg = String(settings?.oppsSheetUrl || '').trim();
  return cfg || null;
}

export function getOppsSheetDisplayUrl({ settings } = {}) {
  const cfg = String(settings?.oppsSheetUrl || '').trim();
  return cfg || '';
}
````

### src/utils/pipelineWorkbook.js

````javascript
// Pipeline tab → Schneider-Electric-formatted Excel report.
//
// Mirrors the house ExcelJS style used by portfolioCompaniesWorkbook.js:
// the SE "Life is On" green palette, Nunito Sans, a three-row branded header
// band per sheet (title / subtitle / column headers), frozen panes, thin
// SE borders and the repo-standard blob-anchor download. ExcelJS is lazy
// imported so it never lands in the main bundle.
//
// The caller (PipelineView) passes an already-computed payload — this module
// only formats; it does no metric math of its own.

// Schneider Electric brand palette (ExcelJS ARGB — note the FF alpha prefix).
const SE_GREEN = 'FF3DCD58';       // Life is On green — title band
const SE_GREEN_DARK = 'FF009530';  // header / section band
const SE_TEXT_DARK = 'FF1E293B';
const SE_ZEBRA = 'FFF6F9F4';
const SE_BORDER = 'FFD4DDE1';
const SE_MUTED = 'FF64748B';
const FONT = 'Nunito Sans';

// Status tints reused from the app's green / yellow / red convention.
const OK_FILL = 'FFDCFCE7', OK_FG = 'FF166534';
const WARN_FILL = 'FFFEF9C3', WARN_FG = 'FF854D0E';
const BAD_FILL = 'FFFEE2E2', BAD_FG = 'FF991B1B';

const MONEY = '$#,##0';
const PCT = '0%';
const PCT1 = '0.0%';
const INT = '#,##0';

const thin = { style: 'thin', color: { argb: SE_BORDER } };
const allThin = { top: thin, bottom: thin, left: thin, right: thin };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Write the two-row brand band (title + subtitle) spanning `colCount` columns;
// returns the row index where the caller should place its column headers.
function brandBand(ws, colCount, subtitle) {
  ws.mergeCells(1, 1, 1, colCount);
  const t = ws.getCell(1, 1);
  t.value = 'Schneider Electric';
  t.font = { name: FONT, bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, colCount);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, italic: true, size: 10, color: { argb: SE_MUTED } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;
  return 3;
}

// A green-dark column-header row.
function headerRow(ws, rowIdx, headers, aligns = []) {
  const row = ws.getRow(rowIdx);
  headers.forEach((h, i) => {
    const c = row.getCell(i + 1);
    c.value = h;
    c.font = { name: FONT, bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    c.alignment = { vertical: 'middle', horizontal: aligns[i] || 'left', wrapText: true, indent: aligns[i] === 'left' || !aligns[i] ? 1 : 0 };
    c.border = allThin;
  });
  row.height = 28;
}

// A full-width green-dark section title (for the KV summary + notes sheets).
function sectionTitle(ws, rowIdx, colCount, text) {
  ws.mergeCells(rowIdx, 1, rowIdx, colCount);
  const c = ws.getCell(rowIdx, 1);
  c.value = text;
  c.font = { name: FONT, bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
  c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(rowIdx).height = 22;
}

function styleBody(cell, { align = 'left', numFmt, bold = false, zebra = false, fill, fg, size = 10, wrap = false, vertical = 'middle' } = {}) {
  cell.font = { name: FONT, size, bold, color: { argb: fg || SE_TEXT_DARK } };
  cell.alignment = { vertical, horizontal: align, indent: align === 'left' ? 1 : 0, wrapText: wrap };
  cell.border = allThin;
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  else if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_ZEBRA } };
  if (numFmt) cell.numFmt = numFmt;
}

// Green when the actual beats the goal, red when it misses — matching the
// on-screen compareClass. dir: 'higher' (actual ≥ goal good) or 'lower'.
function cmpTint(actual, goal, dir = 'higher') {
  const a = num(actual), g = num(goal);
  if (a == null || g == null || g === 0) return null;
  const good = dir === 'higher' ? a >= g : a <= g;
  return good ? { fill: OK_FILL, fg: OK_FG } : { fill: BAD_FILL, fg: BAD_FG };
}

// ── Single-tab layout ───────────────────────────────────────────────────
// Everything on one polished worksheet: a brand band, a KPI card strip, the
// per-stage metrics table (grouped two-row header), Current-Client-vs-
// Greenfield, New Opps by Month, Client Renewals and the strategy notes —
// stacked over a shared 13-column grid with merges so each section reads as
// its own card.
function buildSingleSheet(wb, p, { lbl, sub }) {
  const COLS = 13;
  const ws = wb.addWorksheet('Pipeline Report', {
    properties: { tabColor: { argb: SE_GREEN } },
    views: [{ state: 'frozen', ySplit: 2 }],
  });
  ws.columns = [20, 11, 12, 11, 12, 12, 12, 10, 11, 13, 11, 11, 22].map(w => ({ width: w }));

  // Merge a block and style every covered cell (so the full outline renders),
  // writing `value` into the anchor.
  const put = (r1, c1, r2, c2, value, opts = {}) => {
    if (r2 > r1 || c2 > c1) ws.mergeCells(r1, c1, r2, c2);
    for (let rr = r1; rr <= r2; rr++) {
      for (let cc = c1; cc <= c2; cc++) {
        const cell = ws.getCell(rr, cc);
        if (rr === r1 && cc === c1) cell.value = value === '' || value == null ? null : value;
        styleBody(cell, opts);
      }
    }
  };
  const HEAD = { bold: true, fg: 'FFFFFFFF', fill: SE_GREEN_DARK, align: 'center', wrap: true };

  let r = brandBand(ws, COLS, sub);
  const gap = (h = 6) => { ws.getRow(r).height = h; r++; };
  const title = (text) => { sectionTitle(ws, r, COLS, text); r++; };

  // ── KPI card strip (6 cards × 2 cols) ──
  gap();
  const cg = p.clientGreenfield;
  const kpis = [
    { label: lbl('q-target', 'Target'), value: num(p.quota.target), fmt: MONEY },
    { label: lbl('q-closed-ytd', 'Closed YTD'), value: num(p.quota.closedYTD), fmt: MONEY },
    { label: lbl('q-pct-quota', '% of Quota'), value: num(p.quota.pctOfQuota), fmt: PCT1 },
    { label: 'Coverage Ratio', value: num(p.coverage.actual), fmt: '0.00', tint: cmpTint(p.coverage.actual, p.coverage.goal, 'higher') },
    { label: '% Not Quoted (Yr)', value: num(p.notQuoted.year), fmt: PCT, tint: cmpTint(p.notQuoted.year, p.notQuoted.goal, 'lower') },
    { label: 'Current Client %', value: num(cg.clientActualPct), fmt: PCT, tint: cmpTint(cg.clientActualPct, cg.clientGoalPct, 'lower') },
  ];
  kpis.forEach((k, i) => {
    const c0 = i * 2 + 1;
    const c1 = i === kpis.length - 1 ? COLS : c0 + 1; // last card fills to the right edge
    put(r, c0, r, c1, k.label.toUpperCase(), { align: 'center', bold: true, size: 8, fg: SE_MUTED, fill: 'FFEFF7F0' });
    put(r + 1, c0, r + 1, c1, k.value, { align: 'center', bold: true, size: 15, numFmt: k.fmt, fill: k.tint ? k.tint.fill : 'FFFFFFFF', fg: k.tint ? k.tint.fg : SE_TEXT_DARK });
  });
  ws.getRow(r).height = 15; ws.getRow(r + 1).height = 26;
  r += 2;

  // ── Pipeline Metrics (grouped two-row header) ──
  gap();
  title(lbl('t-pipeline-metrics', 'Pipeline Metrics'));
  const h1 = r, h2 = r + 1;
  put(h1, 1, h2, 1, lbl('m-stage', 'Stage'), { ...HEAD, align: 'left' });
  put(h1, 2, h1, 3, lbl('m-active-opps', 'Active Opportunities'), HEAD);
  put(h1, 4, h1, 5, lbl('m-deal-size', 'Deal Size'), HEAD);
  put(h1, 6, h1, 7, lbl('m-pipeline', 'Pipeline'), HEAD);
  put(h1, 8, h1, 9, lbl('m-close-rate', 'Close Rate'), HEAD);
  put(h1, 10, h2, 10, lbl('m-target-proj', 'Target Projection'), HEAD);
  put(h1, 11, h1, 12, lbl('m-opp-life', 'Avg Opp Life'), HEAD);
  put(h1, 13, h2, 13, lbl('m-flagged-opps', 'Flagged Opps'), HEAD);
  ['Goal', 'Actual', 'Goal', 'Actual', 'Goal', 'Actual', 'Goal', 'Actual'].forEach((t, i) => put(h2, 2 + i, h2, 2 + i, t, HEAD));
  put(h2, 11, h2, 11, 'Goal', HEAD);
  put(h2, 12, h2, 12, 'Actual', HEAD);
  ws.getRow(h1).height = 16; ws.getRow(h2).height = 16;
  r += 2;

  const metricRow = (s, opts) => {
    // Show the flagged opps by name (comma-separated, single line) rather than
    // a bare count. The Flagged Opps column is the last one, so a long list
    // overflows cleanly to the right instead of wrapping.
    const flaggedNames = (s.flaggedNames || []).join(', ');
    const flagged = s.flaggedCount
      ? (s.flaggedLabel ? `${s.flaggedLabel}: ${flaggedNames}` : flaggedNames)
      : '—';
    const cells = [
      [s.label, 'left', null, null],
      [num(s.activeGoal), 'right', INT, null],
      [num(s.activeActual), 'right', INT, cmpTint(s.activeActual, s.activeGoal, 'higher')],
      [num(s.dealSizeGoal), 'right', MONEY, null],
      [num(s.dealSizeActual), 'right', MONEY, cmpTint(s.dealSizeActual, s.dealSizeGoal, 'higher')],
      [num(s.pipelineGoal), 'right', MONEY, null],
      [num(s.pipelineActual), 'right', MONEY, cmpTint(s.pipelineActual, s.pipelineGoal, 'higher')],
      [num(s.closeGoal), 'right', PCT, null],
      [num(s.closeActual), 'right', PCT, cmpTint(s.closeActual, s.closeGoal, 'higher')],
      [num(s.targetProjGoal), 'right', MONEY, null],
      [num(s.lifeGoal), 'right', INT, null],
      [num(s.lifeActual), 'right', INT, cmpTint(s.lifeActual, s.lifeGoal, 'lower')],
      [flagged, 'left', null, s.flaggedCount ? { fill: WARN_FILL, fg: WARN_FG } : null],
    ];
    cells.forEach(([v, align, numFmt, tint], i) => {
      const cell = ws.getRow(r).getCell(i + 1);
      cell.value = v === '' || v == null ? null : v;
      styleBody(cell, { align, numFmt, ...opts, ...(tint || {}) });
    });
    ws.getRow(r).height = 17;
    r++;
  };
  p.stages.forEach((s, i) => metricRow(s, { zebra: i % 2 === 1 }));
  // Total row
  const t = p.totals;
  const totCells = [
    [lbl('m-total', 'Total'), 'left', null],
    [num(t.activeGoal), 'right', INT], [num(t.activeActual), 'right', INT],
    [num(t.dealSizeGoal), 'right', MONEY], [num(t.dealSizeActual), 'right', MONEY],
    [num(t.pipelineGoal), 'right', MONEY], [num(t.pipelineActual), 'right', MONEY],
    ['', 'right', null], [num(t.closeRate), 'right', PCT],
    [num(t.targetProjGoal), 'right', MONEY],
    [num(t.lifeGoal), 'right', INT], [num(t.lifeActual), 'right', INT],
    ['', 'left', null],
  ];
  totCells.forEach(([v, align, numFmt], i) => {
    const cell = ws.getRow(r).getCell(i + 1);
    cell.value = v === '' || v == null ? null : v;
    styleBody(cell, { align, numFmt, bold: true, fill: OK_FILL });
  });
  ws.getRow(r).height = 18; r++;

  // ── Current Client vs Greenfield ──
  gap();
  title('Current Client vs Greenfield');
  put(r, 1, r, 4, 'Segment', { ...HEAD, align: 'left' });
  put(r, 5, r, 7, 'Opps', { ...HEAD, align: 'left' });
  put(r, 8, r, 10, 'Amount', { ...HEAD, align: 'left' });
  put(r, 11, r, 13, 'Client Mix', { ...HEAD, align: 'left' });
  r++;
  put(r, 1, r, 4, 'Current client', { bold: true });
  put(r, 5, r, 7, num(cg.clientCount), { align: 'left', numFmt: INT });
  put(r, 8, r, 10, num(cg.clientAmt), { align: 'left', numFmt: MONEY });
  put(r, 11, r, 13, cg.clientGoalPct != null ? `Goal ${Math.round(cg.clientGoalPct * 100)}%` : '—', { align: 'left' });
  r++;
  put(r, 1, r, 4, 'Greenfield', { bold: true });
  put(r, 5, r, 7, num(cg.greenfieldCount), { align: 'left', numFmt: INT });
  put(r, 8, r, 10, num(cg.greenfieldAmt), { align: 'left', numFmt: MONEY });
  put(r, 11, r, 13, cg.clientActualPct != null ? `Actual ${Math.round(cg.clientActualPct * 100)}%` : '—', { align: 'left', ...(cmpTint(cg.clientActualPct, cg.clientGoalPct, 'lower') || {}) });
  r++;

  // ── New Opps by Month (horizontal) ──
  gap();
  title(`${lbl('nom-month', 'Month')} · ${lbl('nom-new-opps', 'New Opps')}`);
  const months = p.newOppsByMonth || [];
  put(r, 1, r, 1, lbl('nom-month', 'Month'), HEAD);
  put(r + 1, 1, r + 1, 1, lbl('nom-new-opps', 'New Opps'), { ...HEAD, align: 'left' });
  months.slice(0, 6).forEach((m, i) => {
    const c0 = 2 + i * 2;
    put(r, c0, r, c0 + 1, m.label, HEAD);
    put(r + 1, c0, r + 1, c0 + 1, num(m.count), { align: 'center', bold: true, numFmt: INT, ...(m.count >= 5 ? { fill: OK_FILL, fg: OK_FG } : { fill: BAD_FILL, fg: BAD_FG }) });
  });
  ws.getRow(r).height = 16; ws.getRow(r + 1).height = 18;
  r += 2;

  // ── Service Exploration Coverage ──
  // Only rendered when the user tracks at least one service on the Pipeline
  // page — otherwise the section is omitted entirely (no empty shell).
  {
    const sc = p.serviceCoverage || {};
    const scRows = sc.rows || [];
    if (scRows.length) {
      gap();
      title(sc.title || 'Service Exploration Coverage');
      const scCols = [[1, 7], [8, 9], [10, 11], [12, 13]]; // Service | Explored | Clients | Coverage
      const scHdr = sc.headers || ['Service', 'Explored', 'Clients', 'Coverage'];
      scHdr.forEach((h, i) => put(r, scCols[i][0], r, scCols[i][1], h, { ...HEAD, align: 'left' }));
      r++;
      scRows.forEach((row, idx) => {
        const zebra = idx % 2 === 1 ? { zebra: true } : {};
        put(r, scCols[0][0], r, scCols[0][1], row.service || '—', { align: 'left', wrap: true, ...zebra });
        put(r, scCols[1][0], r, scCols[1][1], num(row.explored), { align: 'left', numFmt: INT, ...zebra });
        put(r, scCols[2][0], r, scCols[2][1], num(row.total), { align: 'left', numFmt: INT, ...zebra });
        put(r, scCols[3][0], r, scCols[3][1], num(row.pct), { align: 'left', numFmt: PCT, bold: true, ...zebra });
        r++;
      });
    }
  }

  // ── Client Renewals ──
  gap();
  title(lbl('ren-title', `Client Renewals — Contracts Expiring Within ${p.renewals.windowDays} Days`));
  const renCols = [[1, 2], [3, 4], [5, 6], [7, 9], [10, 11], [12, 13]];
  const renHdr = [lbl('ren-client', 'Client'), lbl('ren-status', 'Renewal Status'), lbl('ren-client-manager', 'Client Manager'), lbl('ren-decision-maker', 'Decision Maker'), lbl('ren-invited', 'Invited to Louisville'), lbl('ren-days-until', 'Days Until Expiration')];
  renHdr.forEach((h, i) => put(r, renCols[i][0], r, renCols[i][1], h, { ...HEAD, align: 'left' }));
  r++;
  const renRows = p.renewals.rows || [];
  if (!renRows.length) {
    put(r, 1, r, COLS, `No clients with contracts expiring in the next ${p.renewals.windowDays} days.`, { fg: SE_MUTED });
    r++;
  } else {
    renRows.forEach((row, idx) => {
      const zebra = idx % 2 === 1;
      const overdue = num(row.daysUntil) != null && row.daysUntil < 0;
      const vals = [row.company || '—', row.renewalStatus || '—', row.clientManager || '—', row.decisionMaker || '—', row.invited || '—', num(row.daysUntil)];
      vals.forEach((v, i) => {
        const isDays = i === 5;
        put(r, renCols[i][0], r, renCols[i][1], v === '' || v == null ? null : v, {
          align: 'left', numFmt: isDays ? INT : undefined, wrap: i === 3,
          ...(isDays && overdue ? { fill: BAD_FILL, fg: BAD_FG } : (zebra ? { zebra: true } : {})),
        });
      });
      r++;
    });
  }

  // ── Strategic Accounts — My Accounts ──
  {
    const sa = p.strategicAccounts || {};
    gap();
    title(sa.title || 'Strategic Accounts — My Accounts');
    const saCols = [[1, 6], [7, 10], [11, 13]]; // Account | Account Owner | Type
    const saHdr = sa.headers || ['Account', 'Account Owner', 'Type'];
    saHdr.forEach((h, i) => put(r, saCols[i][0], r, saCols[i][1], h, { ...HEAD, align: 'left' }));
    r++;
    const saRows = sa.rows || [];
    if (!saRows.length) {
      put(r, 1, r, COLS, 'No strategic accounts mapped to My Accounts.', { fg: SE_MUTED });
      r++;
    } else {
      saRows.forEach((row, idx) => {
        const zebra = idx % 2 === 1;
        const vals = [row.account || '—', row.owner || '—', row.type || '—'];
        vals.forEach((v, i) => put(r, saCols[i][0], r, saCols[i][1], v, { align: 'left', wrap: i === 0, ...(zebra ? { zebra: true } : {}) }));
        r++;
      });
    }
  }

  // ── Strategy Notes ──
  gap();
  (p.notes || []).forEach(({ title: nt, text }) => {
    title(nt);
    String(text || '').split('\n').forEach((line) => {
      put(r, 1, r, COLS, line, { wrap: true, vertical: 'top' });
      ws.getRow(r).height = Math.max(15, Math.ceil((line.length || 1) / 120) * 14);
      r++;
    });
  });
}

export async function downloadPipelineWorkbook(p) {
  const exceljs = await import('exceljs');
  const Workbook = exceljs.Workbook || (exceljs.default && exceljs.default.Workbook);
  const wb = new Workbook();
  wb.creator = 'Schneider Electric · Prospect Tracker';
  wb.created = new Date();
  const lbl = p.lbl || ((_id, def) => def);
  const dateStr = (p.generatedAt || new Date()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const sub = `Pipeline Report${p.cdmName ? ` — ${p.cdmName}` : ''}  ·  ${dateStr}`;
  if (!p.hasBfo) {
    // Not fatal — the report still exports the manually-entered numbers.
    wb.description = 'BFO Activity not loaded; live actuals reflect manually entered values.';
  }

  if (p.layout === 'single') {
    buildSingleSheet(wb, p, { lbl, sub });
  } else {

  // ── Sheet 1: Summary (KV blocks) ──────────────────────────────────────
  {
    const ws = wb.addWorksheet('Summary', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 2 }],
    });
    ws.columns = [{ width: 34 }, { width: 20 }, { width: 20 }, { width: 20 }];
    let r = brandBand(ws, 4, sub);

    const kv = (label, value, numFmt, tint) => {
      const a = ws.getCell(r, 1); a.value = label;
      styleBody(a, { bold: true });
      const b = ws.getCell(r, 2); b.value = value === '' || value == null ? null : value;
      styleBody(b, { align: 'right', numFmt, ...(tint || {}) });
      // pad remaining cols so borders line up
      styleBody(ws.getCell(r, 3), {}); styleBody(ws.getCell(r, 4), {});
      ws.mergeCells(r, 2, r, 4);
      r++;
    };
    const gap = () => { r++; };

    sectionTitle(ws, r, 4, lbl('t-quota', 'Quota')); r++;
    kv(lbl('q-target', 'Target'), num(p.quota.target), MONEY);
    kv(lbl('q-closed-ytd', 'Closed YTD'), num(p.quota.closedYTD), MONEY);
    kv(lbl('q-pct-quota', '% of Quota'), num(p.quota.pctOfQuota), PCT1);
    gap();

    sectionTitle(ws, r, 4, lbl('cov-title', 'Coverage Ratio')); r++;
    kv(lbl('cov-goal', 'Goal'), num(p.coverage.goal), '0.00');
    kv(lbl('cov-actual', 'Actual'), num(p.coverage.actual), '0.00', cmpTint(p.coverage.actual, p.coverage.goal, 'higher'));
    gap();

    sectionTitle(ws, r, 4, lbl('nq-title', '% of deals not Quoted')); r++;
    kv(lbl('nq-goal', 'Goal'), num(p.notQuoted.goal), PCT);
    kv(lbl('nq-actual-year', 'Actual Year'), num(p.notQuoted.year), PCT, cmpTint(p.notQuoted.year, p.notQuoted.goal, 'lower'));
    kv(lbl('nq-actual-month', 'Actual Month'), num(p.notQuoted.month), PCT, cmpTint(p.notQuoted.month, p.notQuoted.goal, 'lower'));
    gap();

    sectionTitle(ws, r, 4, 'Current Client vs Greenfield'); r++;
    const cg = p.clientGreenfield;
    kv(lbl('cg-row-client-opps', 'Current client opps'), num(cg.clientCount), INT);
    kv(lbl('cg-row-green-opps', 'Greenfield opps'), num(cg.greenfieldCount), INT);
    kv(lbl('cg-row-client-amt', 'Current client $'), num(cg.clientAmt), MONEY);
    kv(lbl('cg-row-green-amt', 'Greenfield $'), num(cg.greenfieldAmt), MONEY);
    kv(`${lbl('cg-goal-client', 'Goal - Client')} %`, num(cg.clientGoalPct), PCT);
    kv(`${lbl('cg-actual-client', 'Actual - Client')} %`, num(cg.clientActualPct), PCT, cmpTint(cg.clientActualPct, cg.clientGoalPct, 'lower'));
  }

  // ── Sheet 2: Pipeline Metrics (per-stage) ─────────────────────────────
  {
    const headers = [
      lbl('m-stage', 'Stage'),
      'Active Opps Goal', 'Active Opps Actual',
      'Deal Size Goal', 'Deal Size Actual',
      'Pipeline Goal', 'Pipeline Actual',
      'Close Rate Goal', 'Close Rate Actual',
      lbl('m-target-proj', 'Target Projection'),
      'Avg Opp Life Goal', 'Avg Opp Life Actual',
      lbl('m-flagged-opps', 'Flagged Opps'),
    ];
    const widths = [16, 14, 15, 13, 14, 14, 14, 13, 14, 15, 14, 15, 26];
    const aligns = ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left'];
    const ws = wb.addWorksheet('Pipeline Metrics', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 3, xSplit: 1 }],
    });
    ws.columns = widths.map(w => ({ width: w }));
    const hdrRow = brandBand(ws, headers.length, sub);
    headerRow(ws, hdrRow, headers, aligns);

    let r = hdrRow + 1;
    p.stages.forEach((s, idx) => {
      const zebra = idx % 2 === 1;
      const row = ws.getRow(r);
      const cells = [
        [s.label, 'left', null],
        [num(s.activeGoal), 'right', INT],
        [num(s.activeActual), 'right', INT, cmpTint(s.activeActual, s.activeGoal, 'higher')],
        [num(s.dealSizeGoal), 'right', MONEY],
        [num(s.dealSizeActual), 'right', MONEY, cmpTint(s.dealSizeActual, s.dealSizeGoal, 'higher')],
        [num(s.pipelineGoal), 'right', MONEY],
        [num(s.pipelineActual), 'right', MONEY, cmpTint(s.pipelineActual, s.pipelineGoal, 'higher')],
        [num(s.closeGoal), 'right', PCT],
        [num(s.closeActual), 'right', PCT, cmpTint(s.closeActual, s.closeGoal, 'higher')],
        [num(s.targetProjGoal), 'right', MONEY],
        [num(s.lifeGoal), 'right', INT],
        [num(s.lifeActual), 'right', INT, cmpTint(s.lifeActual, s.lifeGoal, 'lower')],
        [s.flaggedLabel && s.flaggedCount ? `${s.flaggedLabel}: ${s.flaggedCount}` : (s.flaggedCount ? String(s.flaggedCount) : '—'), 'left', null,
          s.flaggedCount ? { fill: WARN_FILL, fg: WARN_FG } : null],
      ];
      cells.forEach(([v, align, numFmt, tint], i) => {
        const cell = row.getCell(i + 1);
        cell.value = v === '' || v == null ? null : v;
        styleBody(cell, { align, numFmt, zebra: zebra && !tint, ...(tint || {}) });
      });
      row.height = 18;
      r++;
    });

    // Total row
    const t = p.totals;
    const totRow = ws.getRow(r);
    const totCells = [
      [lbl('m-total', 'Total'), 'left', null],
      [num(t.activeGoal), 'right', INT],
      [num(t.activeActual), 'right', INT],
      [num(t.dealSizeGoal), 'right', MONEY],
      [num(t.dealSizeActual), 'right', MONEY],
      [num(t.pipelineGoal), 'right', MONEY],
      [num(t.pipelineActual), 'right', MONEY],
      ['', 'right', null],
      [num(t.closeRate), 'right', PCT],
      [num(t.targetProjGoal), 'right', MONEY],
      [num(t.lifeGoal), 'right', INT],
      [num(t.lifeActual), 'right', INT],
      ['', 'left', null],
    ];
    totCells.forEach(([v, align, numFmt], i) => {
      const cell = totRow.getCell(i + 1);
      cell.value = v === '' || v == null ? null : v;
      styleBody(cell, { align, numFmt, bold: true, fill: OK_FILL, fg: SE_TEXT_DARK });
    });
    totRow.height = 20;

    ws.autoFilter = { from: { row: hdrRow, column: 1 }, to: { row: hdrRow, column: headers.length } };
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }

  // ── Sheet 3: New Opps by Month ────────────────────────────────────────
  {
    const headers = [lbl('nom-month', 'Month'), lbl('nom-new-opps', 'New Opps')];
    const ws = wb.addWorksheet('New Opps by Month', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 3 }],
    });
    ws.columns = [{ width: 20 }, { width: 14 }];
    const hdrRow = brandBand(ws, headers.length, sub);
    headerRow(ws, hdrRow, headers, ['left', 'right']);
    let r = hdrRow + 1;
    (p.newOppsByMonth || []).forEach((m, idx) => {
      const a = ws.getCell(r, 1); a.value = m.label; styleBody(a, { zebra: idx % 2 === 1 });
      const b = ws.getCell(r, 2); b.value = num(m.count);
      styleBody(b, { align: 'right', numFmt: INT, ...(m.count >= 5 ? { fill: OK_FILL, fg: OK_FG } : { fill: BAD_FILL, fg: BAD_FG }) });
      ws.getRow(r).height = 18;
      r++;
    });
    ws.autoFilter = { from: { row: hdrRow, column: 1 }, to: { row: hdrRow, column: headers.length } };
  }

  // ── Sheet 4: Client Renewals ──────────────────────────────────────────
  {
    const headers = [
      lbl('ren-client', 'Client'),
      lbl('ren-status', 'Renewal Status'),
      lbl('ren-client-manager', 'Client Manager'),
      lbl('ren-decision-maker', 'Decision Maker'),
      lbl('ren-invited', 'Invited to Louisville'),
      lbl('ren-days-until', 'Days Until Expiration'),
    ];
    const widths = [30, 20, 20, 24, 18, 18];
    const ws = wb.addWorksheet('Client Renewals', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 3, xSplit: 1 }],
    });
    ws.columns = widths.map(w => ({ width: w }));
    const hdrRow = brandBand(ws, headers.length, lbl('ren-title', `Client Renewals — Contracts Expiring Within ${p.renewals.windowDays} Days`));
    headerRow(ws, hdrRow, headers, ['left', 'left', 'left', 'left', 'left', 'right']);
    let r = hdrRow + 1;
    (p.renewals.rows || []).forEach((row, idx) => {
      const zebra = idx % 2 === 1;
      const overdue = num(row.daysUntil) != null && row.daysUntil < 0;
      const vals = [
        [row.company || '—', 'left', null],
        [row.renewalStatus || '—', 'left', null],
        [row.clientManager || '—', 'left', null],
        [row.decisionMaker || '—', 'left', null],
        [row.invited || '—', 'left', null],
        [num(row.daysUntil), 'right', INT, overdue ? { fill: BAD_FILL, fg: BAD_FG } : null],
      ];
      vals.forEach(([v, align, numFmt, tint], i) => {
        const cell = ws.getRow(r).getCell(i + 1);
        cell.value = v === '' || v == null ? null : v;
        styleBody(cell, { align, numFmt, zebra: zebra && !tint, ...(tint || {}) });
      });
      ws.getRow(r).height = 18;
      r++;
    });
    if (!(p.renewals.rows || []).length) {
      ws.mergeCells(r, 1, r, headers.length);
      const c = ws.getCell(r, 1);
      c.value = `No clients with contracts expiring in the next ${p.renewals.windowDays} days.`;
      styleBody(c, { align: 'left', fg: SE_MUTED });
    }
    ws.autoFilter = { from: { row: hdrRow, column: 1 }, to: { row: hdrRow, column: headers.length } };
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }

  // ── Sheet 5: Strategy Notes ───────────────────────────────────────────
  {
    const ws = wb.addWorksheet('Strategy Notes', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ state: 'frozen', ySplit: 2 }],
    });
    ws.columns = [{ width: 110 }];
    let r = brandBand(ws, 1, sub);
    (p.notes || []).forEach(({ title, text }) => {
      sectionTitle(ws, r, 1, title); r++;
      const lines = String(text || '').split('\n');
      lines.forEach((line) => {
        const c = ws.getCell(r, 1);
        c.value = line;
        c.font = { name: FONT, size: 10, color: { argb: SE_TEXT_DARK } };
        c.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
        ws.getRow(r).height = Math.max(16, Math.ceil((line.length || 1) / 100) * 15);
        r++;
      });
      r++; // blank line between sections
    });
  }

  } // end multi-sheet layout

  // ── Download (repo-standard blob-anchor idiom) ────────────────────────
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = (p.generatedAt || new Date()).toISOString().slice(0, 10);
  a.href = url;
  a.download = `Pipeline Report${p.layout === 'single' ? ' (1 page)' : ''} — ${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
````

### src/utils/quotedProjectionsStore.js

````javascript
// Persists the YOY "Quoted Projections" monthly values, scoped per user.
// The chart is no longer computed live from opps — it plots month-end
// snapshots the user records. Values are in THOUSANDS of dollars ($K):
// weak / ok / expected are the quoted-$ Chance buckets, agreements is
// Agreements Sent, and bfoPipe is the total BFO pipeline $ (plotted on
// its own right-hand axis since it runs larger). Keyed by month "YYYY-MM".

import { userLsGet, userLsSet } from './userLs';

const KEY = 'yoy-quoted-projections';

export const QUOTED_FIELDS = ['weak', 'ok', 'expected', 'agreements', 'bfoPipe'];

// Historical values supplied for the fiscal year ending Nov 2026
// (Dec 2025 → May 2026). Everything in $K.
export const QUOTED_HISTORICAL_SEED = {
  '2025-12': { weak: 757, ok: 757, expected: 212, agreements: 202, bfoPipe: 4061 },
  '2026-01': { weak: 829, ok: 829, expected: 437, agreements: 257, bfoPipe: 4882 },
  '2026-02': { weak: 630, ok: 630, expected: 467, agreements: 253, bfoPipe: 3528 },
  '2026-03': { weak: 636, ok: 577, expected: 253, agreements: 253, bfoPipe: 2928 },
  '2026-04': { weak: 579, ok: 579, expected: 359, agreements: 236, bfoPipe: 3637 },
  '2026-05': { weak: 402, ok: 402, expected: 329, agreements: 311, bfoPipe: 3186 },
};

// Saved values win over the seed per month, so the user can correct a
// historical figure or add new months without losing the rest.
export function loadQuotedProjections() {
  try {
    const raw = userLsGet(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      return { ...QUOTED_HISTORICAL_SEED, ...saved };
    }
  } catch (err) {
    console.warn('Failed to read quoted projections:', err);
  }
  return { ...QUOTED_HISTORICAL_SEED };
}

export function saveQuotedProjections(map) {
  try { userLsSet(KEY, JSON.stringify(map || {})); } catch { /* ignore quota */ }
}
````

### src/utils/uploadedListStore.js

````javascript
// IndexedDB-backed storage for uploaded list overrides (RECA / CSRD /
// CDP / GRESB / SBT / Ecovadis / UN PRI). The previous localStorage
// path capped out at ~5 MB per origin which big lists like CDP
// (20k+ rows) trivially exceeded. IDB handles multi-MB JSON fine and
// is per-origin, so different users on different devices stay isolated.
//
// Every saveList ALSO mirrors to Firestore (chunked, see
// listBackupSync.js) so a browser "Clear site data" can't wipe a list
// — loadList falls back to the Firestore copy when IDB has nothing,
// auto-restoring it locally for fast subsequent reads.

import { saveListBackup, loadListBackup, clearListBackup } from './listBackupSync';
import { getDbUserId } from './db';

const DB_NAME = 'prospect-tracker-files';
const STORE = 'uploaded-lists';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Keep the portfolio-source-files store from v1 intact.
      if (!db.objectStoreNames.contains('portfolio-source-files')) {
        db.createObjectStore('portfolio-source-files', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToIDB(key, data) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ key, data, savedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function readFromIDB(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveList(key, data) {
  if (!key) return;
  await saveToIDB(key, data);
  // Mirror to Firestore so the list survives clear-site-data and
  // syncs across devices. Fire-and-forget — IDB save is the source
  // of truth for this session.
  const uid = getDbUserId();
  if (uid) {
    saveListBackup(uid, key, data).catch(err => {
      console.warn('Firestore list backup failed', key, err);
    });
  }
}

export async function loadList(key) {
  if (!key) return null;
  try {
    const rec = await readFromIDB(key);
    if (rec?.data && Array.isArray(rec.data) && rec.data.length > 0) return rec.data;
  } catch {}
  // IDB missed — try Firestore restore (e.g., after clear-site-data
  // or signing in on a new device).
  const uid = getDbUserId();
  if (uid) {
    try {
      const remote = await loadListBackup(uid, key);
      if (Array.isArray(remote) && remote.length > 0) {
        // Reseed IDB so subsequent reads are fast.
        try { await saveToIDB(key, remote); } catch {}
        return remote;
      }
    } catch (err) {
      console.warn('loadListBackup failed', key, err);
    }
  }
  // Last-resort: legacy localStorage entry from before the IDB migration.
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        await saveList(key, parsed);
        try { localStorage.removeItem(key); } catch {}
        return parsed;
      }
    }
  } catch {}
  return null;
}

export async function clearList(key) {
  if (!key) return;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
  try { localStorage.removeItem(key); } catch {}
  const uid = getDbUserId();
  if (uid) {
    clearListBackup(uid, key).catch(err => {
      console.warn('clearListBackup failed', key, err);
    });
  }
}
````

### src/utils/userLs.js

````javascript
// User-scoped localStorage wrapper. Same idea as `setDbUserId` in db.js
// but for `localStorage`. Every key the caller passes in gets prefixed
// with the current user's uid so two accounts sharing a browser don't
// inherit each other's salesperson data (deals roster, commissions
// paste, cached HubSpot emails, etc.).
//
// One-time migration: the first time a signed-in user reads a key that
// has no prefixed entry yet but DOES have legacy un-prefixed data, the
// legacy value is claimed for the current user and the un-prefixed key
// is removed. That covers the existing admin's data without manual
// intervention; subsequent signins on the same browser see a clean
// slate because the legacy keys are gone.

let currentUserId = null;

export function setUserLsUserId(uid) {
  currentUserId = uid || null;
}

function prefixed(key) {
  return currentUserId ? `u:${currentUserId}:${key}` : `u:_anon:${key}`;
}

export function userLsGet(key) {
  try {
    const pk = prefixed(key);
    const v = localStorage.getItem(pk);
    if (v !== null) return v;
    if (currentUserId) {
      const legacy = localStorage.getItem(key);
      if (legacy !== null) {
        try { localStorage.setItem(pk, legacy); } catch {}
        try { localStorage.removeItem(key); } catch {}
        return legacy;
      }
    }
    return null;
  } catch { return null; }
}

export function userLsSet(key, value) {
  try {
    localStorage.setItem(prefixed(key), value);
    // Drop the legacy un-prefixed key on write so a future signin
    // doesn't inherit stale data left over from before scoping.
    if (currentUserId) {
      try { localStorage.removeItem(key); } catch {}
    }
  } catch (err) {
    // Surfaces quota errors etc. so callers can decide whether to warn.
    throw err;
  }
}

export function userLsRemove(key) {
  try { localStorage.removeItem(prefixed(key)); } catch {}
}

export function userLsHas(key) {
  try {
    if (localStorage.getItem(prefixed(key)) !== null) return true;
    if (currentUserId && localStorage.getItem(key) !== null) return true;
    return false;
  } catch { return false; }
}
````

### src/utils/yoyHiddenChartsStore.js

````javascript
// Persists which YOY charts the user has hidden, scoped per user
// (localStorage via userLs, mirroring yoyOverridesStore). Hiding a chart
// removes it from the YOY grid until the user restores it; the choice
// sticks across reloads.
//
// Shape: string[] of chartIds
//   chartId — 'leads' | 'quotedProjections' | 'closeRate' | 'leadSources' |
//             'quotedByYear' | 'notSolds' | 'topAccounts' | 'annualSales' |
//             'dealSize' | 'commissions'

import { userLsGet, userLsSet } from './userLs';

const KEY = 'yoy-hidden-charts';

export function loadHiddenCharts() {
  try {
    const raw = userLsGet(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (Array.isArray(saved)) return saved.filter((id) => typeof id === 'string');
  } catch (err) {
    console.warn('Failed to read YOY hidden charts:', err);
  }
  return [];
}

export function saveHiddenCharts(ids) {
  try { userLsSet(KEY, JSON.stringify(Array.isArray(ids) ? ids : [])); } catch { /* ignore quota */ }
}
````

### src/utils/yoyOverridesStore.js

````javascript
// Persists user overrides for the YOY charts, scoped per user (localStorage
// via userLs, mirroring quotedProjectionsStore). The YOY numbers are all
// computed live off the Opps cache; an override lets the user pin a
// corrected value onto a specific data point so it wins over the computed
// one until they clear it.
//
// Shape: { [chartId]: { [rowKey]: { [field]: number } } }
//   chartId  — 'leads' | 'closeRate' | 'leadSources' | 'quotedByYear' |
//              'notSolds' | 'topAccounts' | 'annualSales' | 'dealSize' |
//              'commissions'
//   rowKey   — the row's x-axis category (year as a string, 'Projected',
//              or a Lead Source name)
//   field    — the plotted dataKey being overridden (e.g. 'count', 'sold')

import { userLsGet, userLsSet } from './userLs';

const KEY = 'yoy-chart-overrides';

export function loadYoyOverrides() {
  try {
    const raw = userLsGet(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
  } catch (err) {
    console.warn('Failed to read YOY overrides:', err);
  }
  return {};
}

export function saveYoyOverrides(map) {
  try { userLsSet(KEY, JSON.stringify(map || {})); } catch { /* ignore quota */ }
}
````
