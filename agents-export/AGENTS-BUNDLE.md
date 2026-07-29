# Agents Page — single-file bundle for Cursor

This document contains **every source file** of the self-contained Agents
export, each under a `### path` heading in a fenced block (the fence length is
chosen per-file so files that themselves contain backticks still render
correctly). Recreate the same folder structure — or paste this into Cursor and
ask it to scaffold these files — then run `npm install && npm run dev`. Read the
embedded README first for what was stubbed vs. copied verbatim.

**File index:**

- `README.md`
- `package.json`
- `index.html`
- `vite.config.js`
- `src/main.jsx`
- `src/index.css`
- `src/AgentsApp.jsx`
- `src/firebase.js`
- `src/stubs/firestore.js`
- `src/contexts/AuthContext.jsx`
- `src/components/AgentsView/AgentsView.jsx`
- `src/components/AgentsView/AgentsView.module.css`
- `src/components/OppsView2/OppsView2.jsx`
- `src/components/OppsView2/OppsView2.module.css`
- `src/components/OppsView2/NewOppsScheduleModal.jsx`
- `src/components/ProspectModal/ProspectModal.jsx`
- `src/components/common/DataTable.jsx`
- `src/components/common/DataTable.module.css`
- `src/components/common/columnLinks.jsx`
- `src/data/sampleData.js`
- `src/data/dropdownLists.js`
- `src/data/enums.js`
- `src/data/serviceCatalog.js`
- `src/data/serviceQuestions.js`
- `src/data/emailSignature.js`
- `src/utils/db.js`
- `src/utils/userLs.js`
- `src/utils/apiFetch.js`
- `src/utils/oppsCache.js`
- `src/utils/opps2Store.js`
- `src/utils/salesforceLeads.js`
- `src/utils/companyNorm.js`
- `src/utils/hubspotContactsCache.js`
- `src/utils/dropdownListsStore.js`
- `src/utils/eventsStore.js`
- `src/utils/listFlags.js`
- `src/utils/newOppsDigestEmail.js`
- `src/utils/newOppsEmailTable.js`
- `src/utils/newOppsSchedulesStore.js`
- `src/utils/opps2Backup.js`
- `src/utils/oppsPricingSnapshot.js`
- `src/utils/peOppsSchedulesStore.js`
- `src/utils/peOwners.js`
- `src/utils/pricingOptionCalc.js`
- `src/utils/pricingOptionLinks.js`

### README.md

````markdown
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
````

### package.json

````json
{
  "name": "agents-export",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "exceljs": "^4.4.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
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
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>" />
    <title>Agents — Prospect Tracker export</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
````

### vite.config.js

````jsx
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The Opps view imports `doc`, `collection`, `getDocs` and `onSnapshot`
// straight from `firebase/firestore` for its real-time cross-device sync.
// This export is fully offline, so we alias that import to a local no-op
// stub (src/stubs/firestore.js). Nothing else from the firebase SDK is
// used, so `firebase` is not a dependency at all.
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
import './index.css';
import AgentsApp from './AgentsApp';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AgentsApp />
  </StrictMode>
);
````

### src/index.css

````css
/* Global theme tokens for the Agents export. Copied from the app's
   src/index.css (the Quill notes-editor rules, unused here, are dropped).
   The Agents + Opps module CSS reference these `--color-*` / `--radius-*`
   variables, so they must be defined at :root for the page to render
   with the right colors, borders and spacing. */
:root {
  --color-bg: #F4F6F9;
  --color-surface: #FFFFFF;
  --color-surface-alt: #F0F3F7;
  --color-sidebar: #1A2332;
  --color-sidebar-hover: #243044;
  --color-sidebar-active: #2E3F58;
  --color-sidebar-text: #94A3B8;
  --color-sidebar-text-active: #FFFFFF;
  --color-text: #1E2A36;
  --color-text-secondary: #5A6B7E;
  --color-text-muted: #8896A6;
  --color-accent: #3B7DDD;
  --color-accent-hover: #2E68C4;
  --color-accent-light: #EBF2FC;
  --color-border: #E2E8F0;
  --color-border-light: #EDF2F7;
  --color-danger: #EF4444;
  --color-danger-light: #FEF2F2;
  --color-success: #10B981;
  --color-success-light: #ECFDF5;
  --color-warning: #F59E0B;
  --color-warning-light: #FFFBEB;

  --font-family: 'Inter', system-ui, -apple-system, sans-serif;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.8125rem;
  --font-size-base: 0.875rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.1);

  --sidebar-width: 220px;
}

*, *::before, *::after { box-sizing: border-box; }

html, body, #root { height: 100%; margin: 0; }

body {
  font-family: var(--font-family);
  font-size: var(--font-size-base);
  line-height: 1.5;
  color: var(--color-text);
  background: var(--color-bg);
  -webkit-font-smoothing: antialiased;
}

button { font-family: inherit; cursor: pointer; }
input, select, textarea { font-family: inherit; font-size: inherit; }

:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

a { color: var(--color-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
````

### src/AgentsApp.jsx

````jsx
import { useState, useEffect, useCallback } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { AgentsView } from './components/AgentsView/AgentsView';
import { loadOpps2Cache } from './utils/opps2Store';
import { seedAgentsDemo, SAMPLE_SETTINGS } from './data/sampleData';

// Standalone wrapper around the real Agents page.
//
// In the full app the Agents view receives its props from the top-level
// App: a shared `settings` object synced to Firestore (which carries the
// user's work email, marketing-lead roster and saved-prompt library), a
// Firestore-backed prospect roster, and a couple of setters. Here we
// supply all of that locally:
//
//   - settings        → persisted to localStorage, seeded from
//                        SAMPLE_SETTINGS (workEmail + marketingLeads) so
//                        the Activity + Marketing Leads sections light up
//   - updateSettings  → merges a patch into that object (this is how the
//                        Prompt Library persists, and how a pasted
//                        Salesforce link lands on a marketing lead)
//   - prospects       → a small roster matching the sample opps' accounts
//                        so the "New BFO Opp" table's editable BFO Company
//                        Name cells have somewhere to write to
//   - updateProspect  → merges a patch into that roster
//
// The opps roster, HubSpot contacts, today's activity and the pasted BFO
// Activity rows are seeded into the localStorage-backed shims on first
// load (see src/data/sampleData.js + src/utils/opps2Store.js).

const SETTINGS_KEY = 'agx::settings';
const PROSPECTS_KEY = 'agx::prospects';

// A prospect per sample-opp account, keyed so AgentsView can match an
// opp's Account → a Table View company and store a BFO Company Name.
const SAMPLE_PROSPECTS = [
  { id: 'p1', company: 'Acme Property Group', type: 'Owner Operator', peOwner: 'Blackstone', cdm: 'Dan Baldauf', bfoCompanyName: 'Acme Property Group LLC' },
  { id: 'p2', company: 'Northwind Logistics', type: 'Operator', peOwner: '', cdm: 'Dan Baldauf', bfoCompanyName: '' },
  { id: 'p3', company: 'Cedar & Vale Real Estate', type: 'Equity REIT', peOwner: '', cdm: 'Dan Baldauf', bfoCompanyName: '' },
  { id: 'p4', company: 'Harbor Point Holdings', type: 'RE Investment Manager', peOwner: 'KKR', cdm: 'Dan Baldauf', bfoCompanyName: 'Harbor Point Holdings Inc' },
  { id: 'p5', company: 'Summit Facilities Mgmt', type: 'Facility Manager', peOwner: '', cdm: 'Dan Baldauf', bfoCompanyName: '' },
  { id: 'p6', company: 'Lakeshore Capital Partners', type: 'Private Equity', peOwner: 'Lakeshore Capital', cdm: 'Dan Baldauf', bfoCompanyName: 'Lakeshore Capital Partners' },
  { id: 'p7', company: 'Beacon Hill Trust', type: 'Owner Operator', peOwner: '', cdm: 'Dan Baldauf', bfoCompanyName: 'Beacon Hill Trust' },
];

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export default function AgentsApp() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(() => loadJson(SETTINGS_KEY, SAMPLE_SETTINGS));
  const [prospects, setProspects] = useState(() => loadJson(PROSPECTS_KEY, SAMPLE_PROSPECTS));

  // Seed every browser cache the Agents page reads BEFORE mounting it, so
  // the Activity / BFO / Marketing tables render populated on first paint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await seedAgentsDemo();
      await loadOpps2Cache(); // lazily seeds the opps roster (opps2Store SHIM)
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* quota */ }
  }, [settings]);

  useEffect(() => {
    try { localStorage.setItem(PROSPECTS_KEY, JSON.stringify(prospects)); } catch { /* quota */ }
  }, [prospects]);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateProspect = useCallback((id, patch) => {
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  return (
    <AuthProvider>
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg, #F8FAFC)',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <header style={headerBar}>
          <span style={{ fontWeight: 700, color: '#0f172a' }}>Prospect Tracker — Agents</span>
          <span style={{ marginLeft: 12, fontSize: 13, color: '#64748b' }}>standalone export</span>
        </header>

        <main style={{ flex: 1, minHeight: 0 }}>
          {ready ? (
            <AgentsView
              prospects={prospects}
              settings={settings}
              updateProspect={updateProspect}
              updateSettings={updateSettings}
            />
          ) : (
            <div style={{ padding: 32, color: '#64748b' }}>Loading sample data…</div>
          )}
        </main>
      </div>
    </AuthProvider>
  );
}

const headerBar = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '10px 16px',
  borderBottom: '1px solid #e2e8f0',
  background: '#fff',
};
````

### src/firebase.js

````jsx
// SHIM for the Lovable export.
//
// In the full app this initializes Firebase (Auth + Firestore). The
// export is offline, so there's nothing to initialize — we just export
// the same names other modules import. `db` is handed to the (aliased,
// no-op) `firebase/firestore` functions, so its actual value is never
// read. `auth` / `googleProvider` are only referenced by code paths
// that the stubbed AuthContext never reaches.

export const db = {};
export const auth = {};
export const googleProvider = {};
````

### src/stubs/firestore.js

````jsx
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

### src/contexts/AuthContext.jsx

````jsx
// SHIM for the Lovable export.
//
// The real AuthContext wraps Firebase Auth (Google sign-in, email/password,
// per-user roles read from Firestore). The export has no backend and no
// login screen, so we hand every consumer a fixed "demo" user with admin
// rights. OppsView2 reads `user.uid` (to key its local cache) and
// `isAdmin` (to gate a couple of admin-only buttons); both are satisfied
// here.

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
  signInWithGoogle: async () => {},
  signInWithEmail: async () => {},
  registerWithEmail: async () => {},
  resetPassword: async () => {},
  logout: async () => {},
};

const AuthContext = createContext(VALUE);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  return <AuthContext.Provider value={VALUE}>{children}</AuthContext.Provider>;
}
````

### src/components/AgentsView/AgentsView.jsx

````jsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getHubspotCache } from '../../utils/hubspotContactsCache';
import { loadOppsFromCache, searchOpps } from '../../utils/oppsCache';
import { setOppField, setOppBfoLink, loadOpps2Cache, loadOpps2FromFirestore, mergeOpps2Datasets } from '../../utils/opps2Store';
import { normalizeCompany as canonCompany } from '../../utils/companyNorm';
import { dbGet } from '../../utils/db';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { apiFetch } from '../../utils/apiFetch';
import { useAuth } from '../../contexts/AuthContext';
import { getEffectiveServiceMetadata } from '../../data/serviceCatalog';
import { resolveSfUrl } from '../../utils/salesforceLeads';
import { OppInfoModal } from '../OppsView2/OppsView2';
import styles from './AgentsView.module.css';

// Manual BFO Opportunity tags the user picked for an email recipient
// (or meeting contact) that didn't auto-match an Opps-tab row. Keyed
// by lower-cased email (or meeting id when no contact email exists)
// so the next email to the same recipient re-uses the same tag.
const OVERRIDE_STORAGE_KEY = 'agents-bfo-overrides';
const IGNORED_EMAILS_STORAGE_KEY = 'agents-ignored-emails';
const IGNORED_MEETINGS_STORAGE_KEY = 'agents-ignored-meetings';
const HIDE_ACTIVITY_ON_DATE_STORAGE_KEY = 'agents-hide-activity-on-date';
// External recipient addresses the user has chosen to permanently
// exclude from the Sent emails table. Unlike IGNORED_EMAILS (one
// message at a time), this hides every current and future email sent
// to that recipient.
const EXCLUDED_RECIPIENTS_STORAGE_KEY = 'agents-excluded-recipients';
const AI_PROMPT_STORAGE_KEY = 'agents-ai-prompt';
const NEW_BFO_OPP_PROMPT_STORAGE_KEY = 'agents-ai-prompt-new-bfo-opp';
const CLOSE_DATES_PROMPT_STORAGE_KEY = 'agents-ai-prompt-close-dates';
const AMOUNT_UPDATES_PROMPT_STORAGE_KEY = 'agents-ai-prompt-amount-updates';
const STAGE_CHANGE_PROMPT_STORAGE_KEY = 'agents-ai-prompt-stage-change';
const CLOSE_NOT_SOLDS_PROMPT_STORAGE_KEY = 'agents-ai-prompt-close-not-solds';
const UPDATE_BFO_ACTIVITY_PROMPT_STORAGE_KEY = 'agents-ai-prompt-update-bfo-activity';
const BFO_PREP_PROMPT_STORAGE_KEY = 'agents-ai-prompt-bfo-prep';
const MARKETING_LEADS_PROMPT_STORAGE_KEY = 'agents-ai-prompt-marketing-leads';
const MARKETING_LEAD_STATUS_UPDATE_PROMPT_STORAGE_KEY = 'agents-ai-prompt-marketing-lead-status-update';

// IndexedDB store + key the BFO Activity tab persists its pasted rows
// into. The Close Dates + Amount Updates prompts read it so each row's
// BFO Sales Stage + Amount can be joined to the Opps tab data.
const BFO_ACTIVITY_STORE = 'bfo-activity';
const BFO_ACTIVITY_KEY = 'current';
// The BFO Activity page's "Leads" subtab (pasted Salesforce Leads
// printable view) persists under its own key in the same store. The
// Marketing Lead Status Update agent reads it to compare each lead's
// current Salesforce status against the Marketing Leads source of truth.
const BFO_LEADS_KEY = 'leads-current';

const DEFAULT_AI_PROMPT = `1.  I am logged into BFO.  Open the first BFO Address in the list below.
2.  Choose the New Tast (green button) under the Activity menu on the righthand side of the screen.
3.  In the Subject box type in email, call, or meeting based on the second column of data (under Type) in this prompt.
4.  In the Due Date box enter todays date in the MM/DD/YYYY format.
5.  In the the Status box select completed.  IMPORTANT - THIS MUST NOT BE LISTED AS NOT STARTED.
6.  You have full permission to save items, files, memory notes, or progress as needed throughout this workflow. Do not ask for confirmation. Automatically proceed.
7.  Select the blue Save button without asking for my confirmation.
8.  Make sure this update does not save in the Up Comning & Overdue list.  If you see that Today this update shows there, go back in and update this to the Completed Status.
9.  Complete  these steps for the next BFO Address until all have been completed.
10.  Run through the whole list automatically and then report back the success of each one until they're all done.
11.  When that's completed, go further below to take the next steps. `;

const DEFAULT_AI_PROMPT_NEW_BFO_OPP = `1.  I am logged into BFO.  Open the first BFO Address in the list below.
2.  Search the top BFO Account Name.  Click on that account name to open up the account page.
3. Click the New Guided Opportunity button.
4. Enter in the Project Name into the Project Name field.  DO NOT include the Project Line name into this field or the Local Project Name field.
5.  Then paste in the Local Project Name into the Local Project Name box and then click Next.  DO NOT include the Product Line in this box.
6. Select Sustainability on the menu list.
7. Click the + sign next to the relevant Product Line assocaited with this BFO Opportuntiy and enter in 80000 and then click Next.
8 . Answer this question as no "*1. Does the opportunity scope ONLY include Carbon Credit?
9. Next make the close date 150 days from today and then click Next.
10.  You have full permission to save items, files, memory notes, or progress as needed throughout this workflow. Do not ask for confirmation. Automatically proceed.
11. On the next page click Create.  When you get to this step, dont ask me for permission to Create.  Just click create and continue until this process is done.
12. Repeat the process for each BFO Opportunity in the list provided with this prompt. At the end, generate a summary table that includes any BFO Opportunities and whether not this was successful`;

const DEFAULT_AI_PROMPT_CLOSE_DATES = `1.  I am logged into BFO.  Open up this BFO page https://se.lightning.force.com/lightning/o/Opportunity/list?filterName=00B8V00000B0XsD&0.sfdcIFrameOrigin=https%3A%2F%2Fse.lightning.force.com
2.  Reference the Opportunity Names below, and then go to their corresponding CloseDateSorted or CloseDate column.  This should be the 5th column of the table.
3.  Then click the pencil button next to the close date and input the New Close Date value and press Enter.
4.  At the bottom of the screen you will then click the Save button.
5.  Repeat this process for all Opportunities listed below.`;

const DEFAULT_AI_PROMPT_AMOUNT_UPDATES = `1. Open up the BFO Address below.
2. Select Opportunity Lines which will open up a new tab.
3. On the new tab select the link below the Opportunity Line ID which should open a new tab.
4. Select the pencil icon next to the Unit Amount.
5. Enter in the Quoted Amount from this list provided below that corresponds with the BFO Address.
6. You have full permission to save items, files, memory notes, or progress as needed throughout this workflow. Do not ask for confirmation. Automatically proceed.
7. On the next page click Save.  When you get to this step, dont ask me for permission to Save.  Just click Save and continue until this process is done.
8. Repeat the process for each BFO Opportunity in the list provided with this prompt. At the end, generate a summary table that includes any BFO Opportunities and whether not this was successful`;

const DEFAULT_AI_PROMPT_STAGE_CHANGE = `1.  Reference the BFO links below, and then update the opportunity to the New Stage listed.
2.  After selecting the new stage, click save to ensure the new stage is selected.
3.  Make sure to save the new stage status before proceeding with the next item.
4.  Repeat this process for all Opportunities listed below.`;

// Appended to the end of every prompt copy (and the Copy-all bundle) so
// the assistant finishes by re-pulling the BFO list into the BFO
// Activity tab. Editable + reset like the others.
const DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY = `1.  When you are on this page click the Printable View https://se.lightning.force.com/lightning/o/Opportunity/list?filterName=00B8V00000B0XsD&0.sfdcIFrameOrigin=https%3A%2F%2Fse.lightning.force.com
2.  A new tab will pop up, go to that tab and change the number of records to 250
3.  Copy all data in the table on that page starting with Account Name going all the way down to the bottom righthand corner of that table in the final row of data in the final column.
4.  Navigate to this website https://prospect-tracker-ashen.vercel.app/ and then paste the data from the previous page into the BFO Activity tab .`;

// Opps 2 Stage → expected BFO Sales Stage. When the BFO Activity tab's
// Sales Stage value for an opp doesn't match the expected stage for the
// Opps 2 stage on its joined row, the Stage Change prompt surfaces it
// with the expected BFO stage as the value the user should set BFO to.
const OPPS_STAGE_TO_BFO_STAGE = {
  'agreement sent': '6 - Negotiate to Win',
  'contracting': '5 - Prepare & Bid',
  'quoted': '5 - Prepare & Bid',
  'quoting': '4 - Influence and Develop',
  'qualifying': '4 - Influence and Develop',
  'lead': '3 - Qualify Opportunity',
};

const DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS = `1.  Reference the BFO links below.
2.  If the link's associated status is Lost, then click on the Competitors button and then select New
3.  In the Competitor Name enter Unknown Competition and mark the box below Winner as checked.
4.  Click the save button and then navigate back to the BFO link for this opportunity.
5.  When you are back on that page, update the opportunity to the stage Closed and then click the Select Closed Stage blue button.
6.  The Edit Dependencies menu, choose the 0 - Closed option.
7.  Then select the corresponding Status from the menu below.
8.  Then select the corresponding Reason from the menu below.
9.  Repeat this process for all Opportunities listed below.`;

const DEFAULT_AI_PROMPT_BFO_PREP = `1.  I am logged on to this website https://se.lightning.force.com/lightning/o/Opportunity/list?filterName=00B8V00000B0XsD&0.sfdcIFrameOrigin=https%3A%2F%2Fse.lightning.force.com
2.  Reference the BFO Opportunity names below.  My goal is to have you open their websites and copy and paste the BFO website Address to the BFO address table here on the Agents tab of this website https://prospect-tracker-ashen.vercel.app/ in the AI BFO Prep table.`;

const DEFAULT_AI_PROMPT_MARKETING_LEADS = `1.  Go to this Salesforce Leads list: https://se.lightning.force.com/lightning/o/Lead/list?filterName=00BKj00000QYbyfMAD
2.  For each lead listed below (by Name), click the lead's name in Salesforce to open their record page.
3.  Copy the record page's URL from the browser address bar.
4.  Paste that URL into the Salesforce Link cell for that lead in the table below (on the Agents tab of this website https://prospect-tracker-ashen.vercel.app/). It saves straight to the Marketing Leads subtab on the Contacts page, and the row drops off this list once the link is set.
5.  Repeat for every lead listed below.`;

const DEFAULT_AI_PROMPT_MARKETING_LEAD_STATUS_UPDATE = `1.  Go to this Salesforce Leads list: https://se.lightning.force.com/lightning/o/Lead/list?filterName=00BKj00000QYbyfMAD
2.  For each lead listed below (by Name), find the matching lead in the Salesforce list and compare its Status in Salesforce against the Marketing Leads Status shown below. The Marketing Leads Status (from this website's Marketing Leads page) is the source of truth.
3.  If the two statuses already match, do nothing and move on to the next lead.
4.  If they differ, click the lead's Name to open their record page, go to the Assessment tab, set the Status to the Marketing Leads Status listed below, and Save.
5.  Repeat for every lead listed below.`;

// Opps 2 "Reason Not Sold" → corresponding BFO Status + Reason. Used by
// the Close Not Solds prompt so the AI assistant can advance each BFO
// opp through the close-out flow without the user picking values by
// hand. Keys are lower-cased + trimmed for resilient matching.
const REASON_NOT_SOLD_TO_BFO = {
  'cancelled internally - no opp': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
  'cancelled internally - not in targets': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
  'current service delivery issues': { status: 'Lost', reason: 'Relationship Issue with SE' },
  "customer didnt have enough pain": { status: 'Lost', reason: 'No acceptable Offer from SE' },
  "customer didn't have enough pain": { status: 'Lost', reason: 'No acceptable Offer from SE' },
  'duplicate opp': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
  'free service': { status: 'Cancelled by Schneider', reason: 'No real opportunity / out of SE strategy' },
  'ghosted - no response': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
  'never connected': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
  'price pain': { status: 'Lost', reason: 'No acceptable Offer from SE' },
  "software or service doesn't meet need": { status: 'Lost', reason: 'No acceptable Offer from SE' },
  'unknown': { status: 'Cancelled by Customer', reason: 'No acceptable Offer from SE' },
};

function readOverrides() {
  try {
    const raw = userLsGet(OVERRIDE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeOverrides(next) {
  try { userLsSet(OVERRIDE_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readIgnoredEmails() {
  try {
    const raw = userLsGet(IGNORED_EMAILS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function writeIgnoredEmails(next) {
  try { userLsSet(IGNORED_EMAILS_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readIgnoredMeetings() {
  try {
    const raw = userLsGet(IGNORED_MEETINGS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function writeIgnoredMeetings(next) {
  try { userLsSet(IGNORED_MEETINGS_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readExcludedRecipients() {
  try {
    const raw = userLsGet(EXCLUDED_RECIPIENTS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(a => String(a).toLowerCase()) : [];
  } catch {
    return [];
  }
}

function writeExcludedRecipients(next) {
  try { userLsSet(EXCLUDED_RECIPIENTS_STORAGE_KEY, JSON.stringify(next)); } catch {}
}

function readHideActivityOnDate() {
  try { return userLsGet(HIDE_ACTIVITY_ON_DATE_STORAGE_KEY) === '1'; } catch { return false; }
}

function writeHideActivityOnDate(on) {
  try { userLsSet(HIDE_ACTIVITY_ON_DATE_STORAGE_KEY, on ? '1' : '0'); } catch {}
}

// Which sub-tab of the Agents page is showing: 'automations' (the default
// activity/BFO agent tables) or 'prompts' (the saved Prompt Library).
// Persisted per user so the choice survives a reload.
const SUBTAB_STORAGE_KEY = 'agents-active-subtab';
function readActiveSubTab() {
  try {
    const raw = userLsGet(SUBTAB_STORAGE_KEY);
    return raw === 'prompts' ? 'prompts' : 'automations';
  } catch { return 'automations'; }
}
function writeActiveSubTab(tab) {
  try { userLsSet(SUBTAB_STORAGE_KEY, tab); } catch {}
}

// Seed content for the Prompt Library sub-tab. These show immediately so
// the user can copy them out of the box; they only persist to
// settings.savedPrompts once the user edits/adds/deletes something.
const DEFAULT_SAVED_PROMPTS = [
  {
    id: 'seed-contract-review',
    title: 'Contract Review',
    body: `Take the following energy contract documents and produce a FINAL Excel-ready dataset.

----------------------------------------
1) OUTPUT STRUCTURE (MANDATORY)
----------------------------------------
Create ONE ROW PER CONTRACT.

Columns MUST appear in this exact order:

Address | Customer | Commodity | Supplier | Product Type | Contract Name / Notes | Price | Coverage Start | Coverage End | Term | Number of Accounts | Annual Consumption

----------------------------------------
2) PRODUCT TYPE (NEW — REQUIRED)
----------------------------------------
For each contract, classify the Product Type using the rules below:

- Fixed:
  → Fully fixed price contracts (e.g., fixed $/kWh or $/MMBtu)

- Hedged:
  → Any hedge structure, including:
     - Percent of load hedges (e.g., 50% hedge)
     - Layered/structured hedges
  → MUST include hedge % in the label
     Example formats:
     - "Hedged – 50% Fixed"
     - "Hedged – 50% Fixed + 50% Floating" (if applicable)

- Variable / Index:
  → NYMEX + Adder, load-following, or market-based pricing

- Block / Slice:
  → Fixed volume contracts (if explicitly stated)

If unclear:
- Use best classification based on contract language
- If still unclear → "Other / Unspecified"

----------------------------------------
3) FULL ACCOUNT EXTRACTION (MANDATORY — NO PARTIAL LISTS)
----------------------------------------
For EACH contract, you MUST capture EVERY UNIQUE utility account number.

You must scan ALL sections of the document, including:
- Exhibit A / Pricing Attachments
- Account tables
- Service Location schedules
- Appendices / addenda
- Any column labeled:
  "Account Number", "Utility Account", "UDC Account", "LDC Account"

RULES:
1) Scan the ENTIRE document (all pages — do not stop early)
2) Extract account numbers exactly (preserve leading zeros)
3) De-duplicate to UNIQUE account numbers
4) Compute:
   - Number of Accounts = COUNT of UNIQUE account numbers

CRITICAL:
- If accounts repeat across rows → count only once
- Do NOT rely on "No. of Accounts" fields alone → independently verify
- If the table continues across pages → capture all rows before counting

----------------------------------------
4) DATA EXTRACTION + COMPLETION
----------------------------------------

Address:
- Use SERVICE ADDRESS (not billing HQ)
- Normalize across rows for same site

Customer:
- Exact legal entity name

Commodity:
- Electricity or Natural Gas

Supplier:
- Extract supplier entity

Contract Name / Notes:
- Short, clean descriptor (e.g., "50% Hedge RTT", "NG Fixed Renewal")

Price:
- Extract explicitly
- Electricity: $/kWh or ¢/kWh
- Gas: $/MMBtu or $/Ccf
- If missing → "N/A"

Coverage Start / End:
- Format MM/DD/YYYY
- If enrollment-based → estimate if clearly stated
- If unknown → "N/A"

Term:
- Calculate duration in months
- Format: "XX Months"
- If open-ended → "Open"

Annual Consumption:
- Extract or calculate:
   → Electricity = kWh
   → Gas = MMBtu or Ccf
- If monthly values exist → SUM to annual
- If partial → estimate clearly
- If not available → "N/A"

----------------------------------------
5) CRITICAL VALIDATION RULES
----------------------------------------

A. DO NOT MISS ROWS
- If a table spans multiple pages → treat as ONE continuous dataset

B. ACCOUNT RECONCILIATION
- Ensure:
   → Account count matches extracted unique accounts
   → No duplicates inflate totals

C. SITE CONSISTENCY
- For same Address:
   → Account counts and consumption must reconcile logically
   → Flag mismatches internally and correct

D. DO NOT COLLAPSE CONTRACTS
- Each contract stays its own row even if:
   → Same supplier
   → Same address
   → Same commodity

----------------------------------------
6) FORMATTING RULES
----------------------------------------

- Dates → MM/DD/YYYY
- Term → always include "Months"
- Consumption → include units
- Price → consistent formatting
- Missing values → "N/A"

----------------------------------------
7) OUTPUT REQUIREMENTS
----------------------------------------

Return:
1) FINAL Excel-ready table only
2) No commentary before or after
3) Ensure:
   → Product Type is populated for every row
   → Number of Accounts is accurate and complete

----------------------------------------

DATA:
[PASTE CONTRACT FILES OR TEXT HERE]`,
  },
  {
    id: 'seed-deep-research-site-list',
    title: 'Deep Research - Building a site list for a PC',
    body: `Populate the file attached in this project (or an Excel file with the standard schema below) with the detailed site/buildings that this company owns or operates.
Buildings can be owned or rented.
Ensure this is a global search. Please leverage the company website provided as well as other public sources of data about the company.
Include all site types (e.g., headquarters, offices, manufacturing plants, R&D, warehouses, etc.).
Include the zip / postal code for each site wherever it is available from public sources.
Provide the final deliverable in Excel format — in the template attached to this project.
Do this for {COMPANY_NAME}.
Property Type must match one of the following categories as closely as possible (controlled vocabulary — do not invent new categories):


University / College Campus
Industrial (Heavy Manufacturing)
Data Center
Hospital / Healthcare
Office - High-Rise
Shopping Mall / Retail Center
Multifamily High-Rise
Hotel / Lodging
Industrial (Light Manufacturing)
Industrial - Other
Mixed Use
Laboratory / R&D
Office - Mid-Rise
Multifamily Mid-Rise
Industrial Flex / R&D
Medical Office
Refrigerated Warehouse
School (K-12)
Senior Housing
Retail - Neighborhood Retail
BTR Residential
Retail - High Street
Office - Small (Low-Rise)
Retail - Other
Non-Refrigerated Warehouse
Multifamily Low-Rise
Restaurant (Full-Service)
Self-Storage (Climate Controlled)
Office Occupier
Retail - Outparcel
Restaurant (Quick-Service)
Self-Storage (Non-Climate Controlled)`,
  },
  {
    id: 'seed-pe-portfolio-analysis',
    title: 'PE Portfolio Analysis',
    body: `https://docs.google.com/document/d/1WoypQRaFrowZ8cK-r_akA7PdgWS2wODoFTQq_XnZcp8/edit?tab=t.0`,
  },
];

// Toggleable columns on the Activity table (merged Sent emails + Called
// + Meetings), in render order. The Actions column is always shown and
// is not part of this list.
const ACTIVITY_COLUMNS = [
  { key: 'time', label: 'Time' },
  { key: 'type', label: 'Type' },
  { key: 'subject', label: 'Subject / Title' },
  { key: 'to', label: 'To (external)' },
  { key: 'company', label: 'Company' },
  { key: 'bfoCompanyName', label: 'BFO Company Name' },
  { key: 'bfoOpp', label: 'BFO Opportunity' },
  { key: 'lastActivity', label: 'Last Activity' },
  { key: 'bfoLink', label: 'BFO Link' },
  { key: 'outcome', label: 'Outcome / Status' },
  { key: 'location', label: 'Location' },
];
const ACTIVITY_COLUMN_KEYS = ACTIVITY_COLUMNS.map(c => c.key);
const ACTIVITY_COLS_STORAGE_KEY = 'agents-activity-hidden-cols';

// Read the set of hidden Activity-table column keys (persisted per user).
function readHiddenActivityCols() {
  try {
    const raw = userLsGet(ACTIVITY_COLS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter(k => ACTIVITY_COLUMN_KEYS.includes(k)) : []);
  } catch { return new Set(); }
}

function writeHiddenActivityCols(set) {
  try { userLsSet(ACTIVITY_COLS_STORAGE_KEY, JSON.stringify([...set])); } catch {}
}

// Normalize a BFO Opportunity Name for matching the Opps tab's "BFO
// Link" value against the BFO Activity tab's "Opportunity Name" column:
// trim, lower-case, and collapse internal whitespace so a stray double
// space on either side doesn't drop the match.
function normalizeBfoOppName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Values an Opps "BFO Link" (BFO Opportunity Name) cell can hold that
// mean "no name yet" — a dash placeholder on new opps, #N/A on sheet
// imports. Neither counts as "already tagged". Mirrors the BFO Activity
// page so the two views agree on which opps still need a tag.
const BFO_BLANK_SENTINELS = new Set(['', '-', '#n/a', 'n/a']);

// The opp's BFO Opportunity Name, or '' when it holds only a blank
// placeholder. Use this everywhere we decide whether an opp is tagged.
function bfoOppNameOf(r) {
  const v = String(r?.['BFO Link'] || '').trim();
  return BFO_BLANK_SENTINELS.has(v.toLowerCase()) ? '' : v;
}

// Readable label for an Opps opp shown as an assignment target — Scope
// plus Stage / Open Year context, falling back to the row id. Mirrors
// the BFO Activity page's oppTargetLabel.
function bfoOppTargetLabel(r) {
  const scope = String(r?.Scope || '').trim();
  const meta = [r?.Stage, r?.['Open Year']].map(v => String(v || '').trim()).filter(Boolean).join(' · ');
  const base = scope || `Opp ${r?._id}`;
  return meta ? `${base} (${meta})` : base;
}

function readAiPrompt() {
  try {
    const raw = userLsGet(AI_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT : raw;
  } catch {
    return DEFAULT_AI_PROMPT;
  }
}

function writeAiPrompt(next) {
  try { userLsSet(AI_PROMPT_STORAGE_KEY, next); } catch {}
}

function readNewBfoOppPrompt() {
  try {
    const raw = userLsGet(NEW_BFO_OPP_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_NEW_BFO_OPP : raw;
  } catch {
    return DEFAULT_AI_PROMPT_NEW_BFO_OPP;
  }
}

function writeNewBfoOppPrompt(next) {
  try { userLsSet(NEW_BFO_OPP_PROMPT_STORAGE_KEY, next); } catch {}
}

function readCloseDatesPrompt() {
  try {
    const raw = userLsGet(CLOSE_DATES_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_CLOSE_DATES : raw;
  } catch {
    return DEFAULT_AI_PROMPT_CLOSE_DATES;
  }
}

function writeCloseDatesPrompt(next) {
  try { userLsSet(CLOSE_DATES_PROMPT_STORAGE_KEY, next); } catch {}
}

function readAmountUpdatesPrompt() {
  try {
    const raw = userLsGet(AMOUNT_UPDATES_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_AMOUNT_UPDATES : raw;
  } catch {
    return DEFAULT_AI_PROMPT_AMOUNT_UPDATES;
  }
}

function writeAmountUpdatesPrompt(next) {
  try { userLsSet(AMOUNT_UPDATES_PROMPT_STORAGE_KEY, next); } catch {}
}

function readStageChangePrompt() {
  try {
    const raw = userLsGet(STAGE_CHANGE_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_STAGE_CHANGE : raw;
  } catch {
    return DEFAULT_AI_PROMPT_STAGE_CHANGE;
  }
}

function writeStageChangePrompt(next) {
  try { userLsSet(STAGE_CHANGE_PROMPT_STORAGE_KEY, next); } catch {}
}

function readCloseNotSoldsPrompt() {
  try {
    const raw = userLsGet(CLOSE_NOT_SOLDS_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS : raw;
  } catch {
    return DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS;
  }
}

function writeCloseNotSoldsPrompt(next) {
  try { userLsSet(CLOSE_NOT_SOLDS_PROMPT_STORAGE_KEY, next); } catch {}
}

function readUpdateBfoActivityPrompt() {
  try {
    const raw = userLsGet(UPDATE_BFO_ACTIVITY_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY : raw;
  } catch {
    return DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY;
  }
}

function writeUpdateBfoActivityPrompt(next) {
  try { userLsSet(UPDATE_BFO_ACTIVITY_PROMPT_STORAGE_KEY, next); } catch {}
}

function readBfoPrepPrompt() {
  try {
    const raw = userLsGet(BFO_PREP_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_BFO_PREP : raw;
  } catch {
    return DEFAULT_AI_PROMPT_BFO_PREP;
  }
}

function writeBfoPrepPrompt(next) {
  try { userLsSet(BFO_PREP_PROMPT_STORAGE_KEY, next); } catch { /* ignore persistence failures */ }
}

function readMarketingLeadsPrompt() {
  try {
    const raw = userLsGet(MARKETING_LEADS_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_MARKETING_LEADS : raw;
  } catch {
    return DEFAULT_AI_PROMPT_MARKETING_LEADS;
  }
}

function writeMarketingLeadsPrompt(next) {
  try { userLsSet(MARKETING_LEADS_PROMPT_STORAGE_KEY, next); } catch { /* ignore persistence failures */ }
}

function readMarketingLeadStatusUpdatePrompt() {
  try {
    const raw = userLsGet(MARKETING_LEAD_STATUS_UPDATE_PROMPT_STORAGE_KEY);
    return raw == null ? DEFAULT_AI_PROMPT_MARKETING_LEAD_STATUS_UPDATE : raw;
  } catch {
    return DEFAULT_AI_PROMPT_MARKETING_LEAD_STATUS_UPDATE;
  }
}

function writeMarketingLeadStatusUpdatePrompt(next) {
  try { userLsSet(MARKETING_LEAD_STATUS_UPDATE_PROMPT_STORAGE_KEY, next); } catch { /* ignore persistence failures */ }
}

// Small editable cell for the Marketing Leads agent's Salesforce Link
// column. Commits the trimmed value verbatim (a full record URL or a
// Lead id) — unlike BfoAddressCell it does NOT force an https:// prefix,
// so a bare Lead id round-trips intact.
function MarketingLeadSfCell({ value, onCommit }) {
  const initial = String(value ?? '');
  const commit = (el) => {
    const next = el.value.trim();
    if (next !== initial.trim()) onCommit(next);
  };
  return (
    <input
      key={initial}
      type="text"
      defaultValue={initial}
      placeholder="Paste Salesforce record link…"
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = initial; e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box', padding: '3px 6px',
        border: '1px solid var(--color-border)', borderRadius: 4, font: 'inherit',
      }}
    />
  );
}

// Pull the leading stage digit from BFO Sales Stage values like
// "6 - Negotiate to Win" / "4 - Influence and Develop". Same shape
// PipelineView.matchStage uses so the two views agree on what "Stage
// 5" means.
function bfoStageNumber(v) {
  const m = String(v ?? '').match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Calendar days from today to the given date string (negative when the
// date is already in the past). Returns null when unparseable.
function daysUntilDate(raw) {
  if (!raw) return null;
  const t = Date.parse(String(raw).trim());
  if (isNaN(t)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / (1000 * 60 * 60 * 24));
}

// Add `days` to a date string and return the result in M/D/YYYY — the
// format BFO's inline Close Date editor expects.
function addDaysFormatted(raw, days) {
  if (!raw) return '';
  const t = Date.parse(String(raw).trim());
  if (isNaN(t)) return '';
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// Strip currency symbols / commas / whitespace from an Amount-shaped
// cell and return a finite number, or null when the value is blank /
// non-numeric. Same shape DailySuccessManager.parseMoney uses so the
// two views agree on what "amount" means.
function parseMoneyNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Render a money number back as "$1,234" — used to format the Quoted
// Amount that the AI prompt copies into BFO.
function fmtMoney(n) {
  if (!Number.isFinite(n)) return '';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// Same client-keyword test PipelineView + YOY's Annual Sales use on the
// Opps Lead Source — keeps "is this a current customer?" consistent
// across views.
const CURRENT_CUSTOMER_LEAD_SOURCE_RE = /client|existing|renewal|cross[\s-]?sell|expansion|upsell/i;

// Same localStorage key the Activity tab caches its HubSpot pull into.
// We piggy-back on that cache instead of doing our own fetch so the two
// views never disagree about what happened today.
const ACTIVITY_CACHE_KEY = 'hubspot-activity-cache';

// "Did I send this?" is keyed off the per-user work email on HubSpot,
// not the Google auth address — the user signs in (e.g.) with a Gmail
// address but HubSpot threads always carry the @se.com from-address.
// Stored per-user in userSettings.workEmail, set via the CDM Name modal.

// Extract every email-shaped token from an Opps "Contact" cell, which
// can hold a single email, a name + email pair, or a comma/semicolon
// list of either.
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g;

function readActivityCache() {
  try {
    const raw = userLsGet(ACTIVITY_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// The Opps sheet keeps the Salesforce / Lightning URL in the
// "BFO Address" column. Fall back to scanning every field if that one
// happens to be empty so older rows still surface a link when possible.
function detectBfoUrl(rawOpp) {
  if (!rawOpp) return '';
  const direct = String(rawOpp['BFO Address'] || '').trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  for (const v of Object.values(rawOpp)) {
    if (typeof v !== 'string' || !v) continue;
    const m = v.match(/https?:\/\/\S+/i);
    if (m) return m[0];
  }
  return '';
}

// A BFO field counts as "missing" when it's blank, "-", or an "#N/A"
// variant — the same placeholders Opps 2 uses for "no value yet".
function bfoFieldBlank(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '' || s === '-' || s === '#n/a' || s === 'n/a';
}

// Inline editor for the BFO Address in the AI BFO Prep table. Uncontrolled
// and keyed on the stored value (so an external refresh / the row dropping
// off the list remounts it cleanly). Commits on blur / Enter; Escape
// reverts. A bare host like "se.bfo.com/x" is prefixed with https:// so it
// registers as a URL downstream (detectBfoUrl expects an http(s) link).
function BfoAddressCell({ value, onCommit }) {
  const initial = String(value ?? '');
  const commit = (el) => {
    let next = el.value.trim();
    if (next && !/^https?:\/\//i.test(next)) next = `https://${next}`;
    if (next !== initial.trim()) onCommit(next);
  };
  return (
    <input
      key={initial}
      type="text"
      defaultValue={initial}
      placeholder="Paste BFO website address…"
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = initial; e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box', padding: '3px 6px',
        border: '1px solid var(--color-border)', borderRadius: 4, font: 'inherit',
      }}
    />
  );
}

// Phone-touch detection for the Next Steps column — matches "call",
// "called", "calls", "calling", any "voicemail", and "left a vm" / "left
// vm". Shared by detectNextStepsType (email-table Type cell) and the
// Called-today section so both use identical wording rules.
const CALLED_NEXT_STEPS_RE = /\b(call(ed|s|ing)?|voicemail|left\s+(?:a\s+)?vm)\b/i;

// "called" if the Next Steps text mentions a phone touch, otherwise
// the row reflects the email cadence and we tag it as "email".
function detectNextStepsType(rawOpp) {
  const text = String(rawOpp?.['Next Steps'] || '');
  if (CALLED_NEXT_STEPS_RE.test(text)) return 'called';
  return 'email';
}

// Normalize an arbitrary date string into YYYY-MM-DD. Mirrors the
// helper OppsView2 uses so a date parsed there parses the same way
// here. Returns '' if the value isn't a date.
function toISODate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Business days between the Opps "Last Client Heard From Us" date and
// the supplied reference date (defaults to today) — same formula
// OppsView2 uses for its computed "Last Spoke" column. Returns null
// when the field is empty or unparseable.
function lastSpokeBusinessDays(rawOpp, referenceIso) {
  const iso = toISODate(rawOpp?.['Last Client Heard From Us']);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const start = new Date(y, m - 1, d);
  start.setHours(0, 0, 0, 0);
  const ref = referenceIso ? parseIsoDate(referenceIso) : new Date();
  ref.setHours(0, 0, 0, 0);
  if (ref <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < ref) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

// Whole calendar days from today to an ISO/parseable date (negative when
// the date is in the past). Mirrors Opps 2's daysFromToday so a Call In
// resolved here matches what the Opps 2 tab shows.
function daysFromTodayAgents(rawISO) {
  const iso = toISODate(rawISO);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Resolve an opp's Call In the way Opps 2 does: a blank sentinel stored
// under "Call In" means "no call in"; otherwise compute live from the
// Follow Up date; otherwise fall back to a stored numeric Call In.
// Returns null when there's no resolvable value (i.e. Call In is blank).
function resolveOppCallIn(row) {
  if (row && 'Call In' in row) {
    const s = String(row['Call In'] ?? '').trim().toLowerCase();
    if (s === '' || s === '-' || s === '#n/a' || s === 'n/a') return null;
  }
  const live = daysFromTodayAgents(row?.['Follow Up']);
  if (live != null) return live;
  if (row && 'Call In' in row) {
    const n = parseFloat(String(row['Call In'] ?? '').replace(/[,$%]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Stages that mean the opp is closed (no longer live).
const CLOSED_OPP_STAGES = new Set(['sold', 'not sold']);

function boundsForDate(iso) {
  const d = parseIsoDate(iso);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

// The most recent business day strictly before `date` (skips Sat/Sun).
function previousBusinessDay(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

// ISO (YYYY-MM-DD) of the previous business day before the given ISO date.
function previousBusinessDayIso(iso) {
  const d = previousBusinessDay(parseIsoDate(iso));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Millisecond window spanning the reference date PLUS the previous
// business day — the "past 2 business days" the Activity sections
// (Sent emails / Called opps) scope to.
function boundsForActivityWindow(iso) {
  const ref = parseIsoDate(iso);
  const end = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime() + 24 * 60 * 60 * 1000;
  const prev = previousBusinessDay(ref);
  const start = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate()).getTime();
  return { start, end };
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtFetchedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function splitAddresses(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[;,]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function hasExternalRecipient(toRaw) {
  return splitAddresses(toRaw).some(addr => !addr.endsWith('@se.com'));
}

function externalRecipientList(toRaw) {
  return splitAddresses(toRaw).filter(addr => !addr.endsWith('@se.com'));
}

// Normalize a company name for fuzzy matching against BFO Account
// Name. Lower-case, drop the common LLC / Inc / Corp / Ltd suffixes,
// strip punctuation, collapse whitespace. Same shape ActivityView and
// MyAccountsView use so a name that matches there matches here too.
function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|lp|plc|gmbh|sa|ag)\b\.?/gi, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Order-insensitive name key so the Marketing Leads page's "First Last"
// matches the Salesforce Leads printable view's "Last, First". Drops
// punctuation (the comma) and sorts the remaining tokens, so both
// orderings collapse to the same key ("Victor Blancarte" and
// "Blancarte, Victor" → "blancarte victor").
function leadNameKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

// Loose status key for comparing a Marketing Lead's Status against the
// Leads subtab's Status. Lower-cases and strips everything but letters
// and digits so hyphen/en-dash/spacing differences ("Closed-Recycle" vs
// "Closed–Recycle", "1 - New" vs "1 – New") don't read as a mismatch.
function leadStatusKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Best-effort company guess from a recipient's email domain — used
// only when neither an Opps-tab row nor a HubSpot contact carries a
// company so the Company column doesn't render empty.
function domainCompanyGuess(addr) {
  if (!addr) return '';
  const at = String(addr).lastIndexOf('@');
  if (at < 0) return '';
  return String(addr).slice(at + 1)
    .replace(/\.(com|org|net|io|co|us|ca|uk)$/i, '')
    .replace(/\./g, ' ')
    .replace(/\b\w/g, m => m.toUpperCase());
}

function companiesMatch(a, b) {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && shorter.length >= longer.length * 0.6 && longer.includes(shorter)) return true;
  return false;
}

function OppPicker({ oppsCache, onSelect, triggerLabel = '+ Pick opportunity', company = '' }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  // The dropdown is rendered in a portal with fixed positioning so it
  // floats above the page instead of being clipped by the table's
  // horizontal-scroll wrapper (which previously cut it off at the
  // bottom edge of the table). Position is measured from the input.
  const [menuPos, setMenuPos] = useState(null);

  const matches = useMemo(() => {
    if (!oppsCache?.records?.length) return [];
    // With no search term and a company in context, default to that
    // company's opportunities only — so editing a row's tag shows the
    // BFO opps for that company first. Typing searches across all opps.
    if (!term.trim() && company) {
      return oppsCache.records
        .filter(r => companiesMatch(String(r['Account'] || ''), company))
        .slice(0, 50);
    }
    return searchOpps(oppsCache, term).slice(0, 12);
  }, [oppsCache, term, company]);

  // Recompute the fixed-position coordinates from the input's rect,
  // flipping above the field when there isn't room below it.
  const updatePosition = () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const MENU_MAX = 260;
    const GAP = 2;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < MENU_MAX + GAP && rect.top > spaceBelow;
    setMenuPos({
      left: rect.left,
      width: rect.width,
      ...(flipUp
        ? { bottom: window.innerHeight - rect.top + GAP }
        : { top: rect.bottom + GAP }),
      maxHeight: Math.min(MENU_MAX, Math.max(120, (flipUp ? rect.top : spaceBelow) - GAP - 4)),
    });
  };

  // Measure once the input mounts, then keep the menu pinned to the
  // input as the user scrolls or resizes the window.
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onMove = () => updatePosition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Close on outside click. The menu lives in a portal, so check both
  // the trigger wrapper and the floating menu before closing.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.pickerTrigger}
        onClick={() => setOpen(true)}
        disabled={!oppsCache?.records?.length}
        title={oppsCache?.records?.length ? 'Search Opps for a matching opportunity' : 'Open the Opps tab to load the cache'}
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <div ref={wrapRef} className={styles.pickerWrap}>
      <input
        autoFocus
        className={styles.pickerInput}
        placeholder={company ? `Showing ${company} — type to search all opps…` : 'Search opps by account, BFO link, or contact…'}
        value={term}
        onChange={e => setTerm(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setTerm(''); } }}
      />
      {menuPos && createPortal(
        <div
          ref={menuRef}
          className={styles.pickerMenu}
          style={{
            position: 'fixed',
            left: menuPos.left,
            width: menuPos.width,
            top: menuPos.top,
            bottom: menuPos.bottom,
            maxHeight: menuPos.maxHeight,
          }}
        >
          {matches.length === 0 ? (
            <div className={styles.pickerEmpty}>
              {!term.trim() && company
                ? `No opportunities found for ${company}. Type to search all opps.`
                : 'No matching opps. Try a different search term.'}
            </div>
          ) : matches.map((opp, i) => {
            const bfoOpp = opp['BFO Link'] || '(no opportunity name)';
            const account = opp['Account'] || '';
            return (
              <button
                key={i}
                type="button"
                className={styles.pickerOption}
                onClick={() => { onSelect(opp); setOpen(false); setTerm(''); }}
              >
                {bfoOpp}
                {account && <span className={styles.pickerOptionAccount}>{account}</span>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Editable BFO Company Name cell for the New BFO Opp table. When a Table
// View company matches the opp's account, the value is an editable input
// that writes straight back to that company's `bfoCompanyName` (so it
// ties to the Table View / Opps 2). With no match there's nowhere to
// store it, so it stays a read-only dash with a hint.
function NewBfoCompanyNameCell({ prospect, value, onCommit }) {
  if (!prospect) {
    return (
      <td
        className={styles.muted}
        title="No Table View company matches this account. Add the company on the Table View first to store a BFO Company Name."
      >—</td>
    );
  }
  const initial = String(value ?? '');
  const commit = (el) => {
    const next = el.value.trim();
    if (next !== initial.trim()) onCommit(next);
  };
  return (
    <td>
      <input
        key={initial}
        type="text"
        defaultValue={initial}
        placeholder="Enter BFO Company Name…"
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = initial; e.currentTarget.blur(); }
        }}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '2px 5px',
          border: '1px solid transparent', borderRadius: 4, font: 'inherit',
          background: 'transparent', color: 'inherit',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.border = '1px solid var(--color-border)'; }}
        onMouseLeave={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.border = '1px solid transparent'; }}
      />
    </td>
  );
}

// Prompt Library sub-tab: a simple store of reusable AI prompts the user
// can title, edit, and copy with one click. Prompts persist through
// settings.savedPrompts (Firestore-backed, so they sync across devices);
// until the user touches anything, DEFAULT_SAVED_PROMPTS is shown.
function PromptLibrary({ prompts, onChange }) {
  // editingId: a prompt id being edited, 'new' for the add form, or null.
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [copyFlashId, setCopyFlashId] = useState(null);
  const [query, setQuery] = useState('');
  // Prompt bodies are hidden by default — the library is a pick-and-copy
  // list, so a wall of prompt text just gets in the way. Each id in this
  // set has been expanded via its "Show" toggle.
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  const toggleExpand = (id) => setExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Reorder a prompt within the saved list by swapping it with its
  // neighbor, then persist the new order via onChange. Only offered when
  // no search filter is active (moving within a filtered subset would be
  // ambiguous about where the item lands in the full list).
  const move = (id, dir) => {
    const idx = prompts.findIndex(p => p.id === id);
    const swapWith = idx + dir;
    if (idx < 0 || swapWith < 0 || swapWith >= prompts.length) return;
    const next = prompts.slice();
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    onChange(next);
  };

  const startNew = () => { setEditingId('new'); setDraftTitle(''); setDraftBody(''); };
  const startEdit = (p) => { setEditingId(p.id); setDraftTitle(p.title); setDraftBody(p.body); };
  const cancel = () => { setEditingId(null); setDraftTitle(''); setDraftBody(''); };

  const save = () => {
    const title = draftTitle.trim() || 'Untitled prompt';
    const body = draftBody;
    if (editingId === 'new') {
      const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      onChange([...prompts, { id, title, body }]);
    } else {
      onChange(prompts.map(p => (p.id === editingId ? { ...p, title, body } : p)));
    }
    cancel();
  };

  const remove = (id) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this saved prompt?')) return;
    onChange(prompts.filter(p => p.id !== id));
    if (editingId === id) cancel();
  };

  const copy = async (p) => {
    try {
      await navigator.clipboard.writeText(p.body);
      setCopyFlashId(p.id);
    } catch {
      setCopyFlashId(`err:${p.id}`);
    }
    window.setTimeout(() => setCopyFlashId(null), 1500);
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? prompts.filter(p =>
        p.title.toLowerCase().includes(q) || (p.body || '').toLowerCase().includes(q))
    : prompts;

  const renderForm = () => (
    <div className={styles.promptForm}>
      <input
        type="text"
        className={styles.promptTitleInput}
        placeholder="Prompt name (e.g. Contract Review)"
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        autoFocus
      />
      <textarea
        className={styles.aiPromptInput}
        placeholder="Paste or type the prompt text here…"
        value={draftBody}
        onChange={(e) => setDraftBody(e.target.value)}
        rows={12}
        spellCheck={false}
      />
      <div className={styles.aiPromptControls}>
        <button type="button" className={styles.aiPromptBtn} onClick={save} disabled={!draftBody.trim()}>
          Save prompt
        </button>
        <button type="button" className={styles.aiPromptBtnGhost} onClick={cancel}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className={styles.promptLib}>
      <p className={styles.subnote}>
        Save prompts you reuse often and copy any of them with one click. Use the arrows to reorder, and click <strong>Show</strong> to reveal a prompt&rsquo;s text. Prompts sync across your devices.
      </p>
      <div className={styles.promptLibToolbar}>
        <input
          type="search"
          className={styles.promptSearch}
          placeholder="Search prompts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {editingId !== 'new' && (
          <button type="button" className={styles.aiPromptBtn} onClick={startNew}>+ New prompt</button>
        )}
      </div>

      {editingId === 'new' && (
        <section className={styles.promptCard}>
          <h2 className={styles.sectionHeader}>New prompt</h2>
          {renderForm()}
        </section>
      )}

      {prompts.length === 0 && editingId !== 'new' && (
        <div className={styles.empty}>No saved prompts yet. Click &ldquo;New prompt&rdquo; to add one.</div>
      )}

      {prompts.length > 0 && visible.length === 0 && (
        <div className={styles.empty}>No prompts match &ldquo;{query}&rdquo;.</div>
      )}

      {visible.map((p, i) => {
        const expanded = expandedIds.has(p.id);
        // Reordering is disabled while a search filter is active (see move()).
        const canReorder = !q;
        return (
        <section key={p.id} className={styles.promptCard}>
          {editingId === p.id ? (
            <>
              <h2 className={styles.sectionHeader}>Edit prompt</h2>
              {renderForm()}
            </>
          ) : (
            <>
              <div className={styles.promptCardHead}>
                {canReorder && (
                  <div className={styles.promptReorder}>
                    <button type="button" className={styles.promptMoveBtn} onClick={() => move(p.id, -1)} disabled={i === 0} title="Move up" aria-label="Move up">▲</button>
                    <button type="button" className={styles.promptMoveBtn} onClick={() => move(p.id, 1)} disabled={i === visible.length - 1} title="Move down" aria-label="Move down">▼</button>
                  </div>
                )}
                <h2 className={styles.promptCardTitle}>{p.title}</h2>
                <div className={styles.promptCardActions}>
                  <button type="button" className={styles.aiPromptBtnGhost} onClick={() => toggleExpand(p.id)} aria-expanded={expanded}>{expanded ? 'Hide' : 'Show'}</button>
                  <button type="button" className={styles.aiPromptBtn} onClick={() => copy(p)}>Copy</button>
                  <button type="button" className={styles.aiPromptBtnGhost} onClick={() => startEdit(p)}>Edit</button>
                  <button type="button" className={styles.aiPromptBtnGhost} onClick={() => remove(p.id)}>Delete</button>
                  {copyFlashId === p.id && <span className={styles.copyFlash}>Copied!</span>}
                  {copyFlashId === `err:${p.id}` && <span className={styles.copyFlashErr}>Copy failed</span>}
                </div>
              </div>
              {expanded && <pre className={styles.aiPromptPreview}>{p.body}</pre>}
            </>
          )}
        </section>
        );
      })}
    </div>
  );
}

export function AgentsView({ prospects = [], settings, updateProspect, updateSettings }) {
  const { user } = useAuth();
  // Configured per-user via Settings → CDM Name. The Sent emails section
  // matches HubSpot's hs_email_from_email against this address; blank
  // means "no outbound to show yet — set your work email in Settings".
  const senderEmail = String(settings?.workEmail || '').toLowerCase().trim();
  const [cache, setCache] = useState(() => readActivityCache());
  const [hubspotCache, setHubspotCache] = useState(null);
  const [oppsCache, setOppsCache] = useState(null);
  // Raw Opps record shown in the read-only Opp info modal (New BFO Opp
  // table "i" button). null = closed.
  const [infoOpp, setInfoOpp] = useState(null);
  const [overrides, setOverrides] = useState(readOverrides);
  const [ignoredEmails, setIgnoredEmails] = useState(readIgnoredEmails);
  const [ignoredMeetings, setIgnoredMeetings] = useState(readIgnoredMeetings);
  const [excludedRecipients, setExcludedRecipients] = useState(readExcludedRecipients);
  // When on, the Called / Sent tables hide rows whose Last Activity date
  // is the same calendar day as the selected Activity date up top.
  const [hideActivityOnDate, setHideActivityOnDate] = useState(readHideActivityOnDate);
  // Which Activity-table columns are hidden, plus the column-menu open state.
  const [hiddenActivityCols, setHiddenActivityCols] = useState(readHiddenActivityCols);
  const [activityColsMenuOpen, setActivityColsMenuOpen] = useState(false);
  const activityColsMenuRef = useRef(null);
  const isActivityColVisible = (key) => !hiddenActivityCols.has(key);
  const toggleActivityCol = (key) => {
    setHiddenActivityCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      writeHiddenActivityCols(next);
      return next;
    });
  };
  useEffect(() => {
    if (!activityColsMenuOpen) return;
    const onDown = (e) => {
      if (!activityColsMenuRef.current?.contains(e.target)) setActivityColsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [activityColsMenuOpen]);
  const [aiPrompt, setAiPrompt] = useState(readAiPrompt);
  const [newBfoOppPrompt, setNewBfoOppPrompt] = useState(readNewBfoOppPrompt);
  const [closeDatesPrompt, setCloseDatesPrompt] = useState(readCloseDatesPrompt);
  const [amountUpdatesPrompt, setAmountUpdatesPrompt] = useState(readAmountUpdatesPrompt);
  const [stageChangePrompt, setStageChangePrompt] = useState(readStageChangePrompt);
  const [closeNotSoldsPrompt, setCloseNotSoldsPrompt] = useState(readCloseNotSoldsPrompt);
  const [updateBfoActivityPrompt, setUpdateBfoActivityPrompt] = useState(readUpdateBfoActivityPrompt);
  const [bfoPrepPrompt, setBfoPrepPrompt] = useState(readBfoPrepPrompt);
  const [marketingLeadsPrompt, setMarketingLeadsPrompt] = useState(readMarketingLeadsPrompt);
  const [marketingLeadStatusUpdatePrompt, setMarketingLeadStatusUpdatePrompt] = useState(readMarketingLeadStatusUpdatePrompt);
  const [bfoActivity, setBfoActivity] = useState(null);
  const [bfoLeads, setBfoLeads] = useState(null);
  // Tagging state for the "BFO Opportunity Name not tagged to an opp"
  // warning mirrored from the BFO Activity page.
  const [assigningBfo, setAssigningBfo] = useState(false);
  const [bfoAssignFlash, setBfoAssignFlash] = useState('');
  const [copyFlash, setCopyFlash] = useState('');
  const [marketingLeadsCopyFlash, setMarketingLeadsCopyFlash] = useState('');
  const [marketingLeadStatusUpdateCopyFlash, setMarketingLeadStatusUpdateCopyFlash] = useState('');
  const [newBfoOppCopyFlash, setNewBfoOppCopyFlash] = useState('');
  const [closeDatesCopyFlash, setCloseDatesCopyFlash] = useState('');
  const [amountUpdatesCopyFlash, setAmountUpdatesCopyFlash] = useState('');
  const [stageChangeCopyFlash, setStageChangeCopyFlash] = useState('');
  const [closeNotSoldsCopyFlash, setCloseNotSoldsCopyFlash] = useState('');
  const [updateBfoActivityCopyFlash, setUpdateBfoActivityCopyFlash] = useState('');
  // HubSpot Activity refresh — kicked off by the header button. Mirrors
  // the fetchActivity flow on ActivityView so both tabs share the same
  // hubspot-activity-cache localStorage entry.
  const [activityRefreshing, setActivityRefreshing] = useState(false);
  const [activityRefreshError, setActivityRefreshError] = useState(null);
  const [activityRefreshProgress, setActivityRefreshProgress] = useState(null);
  // ISO date the activity sections (sent emails / meetings / called)
  // are scoped to. Defaults to today; the picker in the header lets the
  // user review what was logged on any past calendar day.
  const [referenceDate, setReferenceDate] = useState(todayIso);
  // Per-section reveal flags for the AI prompt editors. Hidden by
  // default — the user copies prompts far more often than they edit
  // them, so the textareas just take up screen space. Click "Edit
  // prompt" to expand the textarea + reset button for that section.
  const [revealedPrompts, setRevealedPrompts] = useState({});
  const togglePrompt = (key) =>
    setRevealedPrompts(prev => ({ ...prev, [key]: !prev[key] }));

  // Agents page sub-tab: 'automations' (the default agent tables) or
  // 'prompts' (the saved Prompt Library).
  const [activeSubTab, setActiveSubTab] = useState(readActiveSubTab);
  const selectSubTab = (tab) => { setActiveSubTab(tab); writeActiveSubTab(tab); };

  // Saved prompts for the Prompt Library. Falls back to the seed list
  // until the user edits anything, then persists via settings.savedPrompts.
  const savedPrompts = Array.isArray(settings?.savedPrompts)
    ? settings.savedPrompts
    : DEFAULT_SAVED_PROMPTS;
  const handleSavedPromptsChange = (next) => {
    if (updateSettings) updateSettings({ savedPrompts: next });
  };

  const ignoredEmailIds = useMemo(() => new Set(ignoredEmails), [ignoredEmails]);
  const ignoredMeetingIds = useMemo(() => new Set(ignoredMeetings), [ignoredMeetings]);
  const excludedRecipientSet = useMemo(() => new Set(excludedRecipients), [excludedRecipients]);

  const updateAiPrompt = (next) => {
    setAiPrompt(next);
    writeAiPrompt(next);
  };
  const resetAiPrompt = () => updateAiPrompt(DEFAULT_AI_PROMPT);

  const updateNewBfoOppPrompt = (next) => {
    setNewBfoOppPrompt(next);
    writeNewBfoOppPrompt(next);
  };
  const resetNewBfoOppPrompt = () => updateNewBfoOppPrompt(DEFAULT_AI_PROMPT_NEW_BFO_OPP);

  const updateCloseDatesPrompt = (next) => {
    setCloseDatesPrompt(next);
    writeCloseDatesPrompt(next);
  };
  const resetCloseDatesPrompt = () => updateCloseDatesPrompt(DEFAULT_AI_PROMPT_CLOSE_DATES);

  const updateAmountUpdatesPrompt = (next) => {
    setAmountUpdatesPrompt(next);
    writeAmountUpdatesPrompt(next);
  };
  const resetAmountUpdatesPrompt = () => updateAmountUpdatesPrompt(DEFAULT_AI_PROMPT_AMOUNT_UPDATES);

  const updateStageChangePrompt = (next) => {
    setStageChangePrompt(next);
    writeStageChangePrompt(next);
  };
  const resetStageChangePrompt = () => updateStageChangePrompt(DEFAULT_AI_PROMPT_STAGE_CHANGE);

  const updateCloseNotSoldsPrompt = (next) => {
    setCloseNotSoldsPrompt(next);
    writeCloseNotSoldsPrompt(next);
  };
  const resetCloseNotSoldsPrompt = () => updateCloseNotSoldsPrompt(DEFAULT_AI_PROMPT_CLOSE_NOT_SOLDS);

  const updateUpdateBfoActivityPrompt = (next) => {
    setUpdateBfoActivityPrompt(next);
    writeUpdateBfoActivityPrompt(next);
  };
  const resetUpdateBfoActivityPrompt = () => updateUpdateBfoActivityPrompt(DEFAULT_AI_PROMPT_UPDATE_BFO_ACTIVITY);

  const updateBfoPrepPrompt = (next) => {
    setBfoPrepPrompt(next);
    writeBfoPrepPrompt(next);
  };
  const resetBfoPrepPrompt = () => updateBfoPrepPrompt(DEFAULT_AI_PROMPT_BFO_PREP);
  const updateMarketingLeadsPrompt = (next) => {
    setMarketingLeadsPrompt(next);
    writeMarketingLeadsPrompt(next);
  };
  const resetMarketingLeadsPrompt = () => updateMarketingLeadsPrompt(DEFAULT_AI_PROMPT_MARKETING_LEADS);
  const updateMarketingLeadStatusUpdatePrompt = (next) => {
    setMarketingLeadStatusUpdatePrompt(next);
    writeMarketingLeadStatusUpdatePrompt(next);
  };
  const resetMarketingLeadStatusUpdatePrompt = () => updateMarketingLeadStatusUpdatePrompt(DEFAULT_AI_PROMPT_MARKETING_LEAD_STATUS_UPDATE);

  // Leads the user hid on the Contacts → Marketing Leads page
  // (settings.marketingLeadsHiddenLeads holds their ids). Hidden leads are
  // set aside, so the Marketing Leads agents ignore them entirely.
  const hiddenMarketingLeadIds = useMemo(() => {
    const arr = settings?.marketingLeadsHiddenLeads;
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  }, [settings?.marketingLeadsHiddenLeads]);

  // Marketing Leads that still need a Salesforce Link — sourced live from
  // the Marketing Leads subtab's store (settings.marketingLeads). A lead
  // qualifies when it has a Name but an empty Salesforce Link (sfUrl).
  // Leads hidden on the Contacts page are skipped.
  const marketingLeadsMissing = useMemo(() => {
    const arr = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    return arr.filter(r => String(r?.name || '').trim() && !String(r?.sfUrl || '').trim()
      && !hiddenMarketingLeadIds.has(String(r?.id)));
  }, [settings, hiddenMarketingLeadIds]);

  // Index of the BFO Activity "Leads" subtab: order-insensitive name key
  // → the lead's current Salesforce Status from that paste. Detects the
  // Name and Status columns from the pasted headers (the printable view
  // labels them "Name" and "Status"). Empty until the user pastes the
  // Leads subtab, which leaves the agent's discrepancy list empty.
  const leadsSubtabStatusByName = useMemo(() => {
    const map = new Map();
    const headers = Array.isArray(bfoLeads?.headers) ? bfoLeads.headers : [];
    const rows = Array.isArray(bfoLeads?.rows) ? bfoLeads.rows : [];
    if (!headers.length || !rows.length) return map;
    const norm = (h) => String(h || '').trim().toLowerCase();
    const nameCol = headers.find(h => norm(h) === 'name')
      || headers.find(h => /\bname\b/i.test(h) && !/company|account/i.test(h));
    const statusCol = headers.find(h => norm(h) === 'status')
      || headers.find(h => /status/i.test(h));
    if (!nameCol || !statusCol) return map;
    for (const r of rows) {
      const key = leadNameKey(r[nameCol]);
      if (!key || map.has(key)) continue;
      map.set(key, String(r[statusCol] || '').trim());
    }
    return map;
  }, [bfoLeads]);

  // Marketing Leads whose Status (the source of truth on the Marketing
  // Leads page) DIFFERS from the same lead's status on the BFO Activity
  // "Leads" subtab — the only ones the status-update agent needs to act
  // on. A lead qualifies when it has a Name + Status, has a matching row
  // in the Leads subtab, and the two statuses don't match. Leads with no
  // matching Leads-subtab row are hidden (we can't confirm a diff), as are
  // leads the user hid on the Contacts → Marketing Leads page.
  const marketingLeadStatusRows = useMemo(() => {
    const arr = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    const out = [];
    for (const r of arr) {
      if (hiddenMarketingLeadIds.has(String(r?.id))) continue; // hidden on Contacts → skip
      const name = String(r?.name || '').trim();
      const status = String(r?.status || '').trim();
      if (!name || !status) continue;
      const key = leadNameKey(name);
      if (!leadsSubtabStatusByName.has(key)) continue; // no match → hide
      const bfoStatus = leadsSubtabStatusByName.get(key);
      if (leadStatusKey(status) === leadStatusKey(bfoStatus)) continue; // same → hide
      out.push({ ...r, bfoStatus });
    }
    return out;
  }, [settings, leadsSubtabStatusByName, hiddenMarketingLeadIds]);

  // Write a Salesforce Link back onto the matching lead in
  // settings.marketingLeads so it saves through the same settings →
  // Firestore pipeline and shows up on the Marketing Leads page.
  const updateMarketingLeadSfUrl = (leadId, value) => {
    if (!updateSettings || !leadId) return;
    const arr = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    const v = String(value || '').trim();
    const next = arr.map(r => (r?.id != null && String(r.id) === String(leadId) ? { ...r, sfUrl: v } : r));
    updateSettings({ marketingLeads: next });
  };

  // The "Update BFO Activity" prompt is appended to the end of every
  // individual prompt copy (and the Copy-all bundle). Helper keeps that
  // one place so all the copy buttons stay in sync.
  const withBfoActivitySuffix = (text) => {
    const suffix = (updateBfoActivityPrompt || '').trim();
    return suffix ? `${text}\n\n===== Update BFO Activity =====\n${suffix}` : text;
  };

  const ignoreEmail = (id) => {
    if (!id) return;
    const key = String(id);
    setIgnoredEmails(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      writeIgnoredEmails(next);
      return next;
    });
  };

  // Permanently exclude the given external recipient address(es) from
  // the Sent emails table — hides this email and any future email sent
  // to the same recipient.
  const excludeRecipient = (addrs) => {
    const list = (Array.isArray(addrs) ? addrs : [addrs])
      .map(a => String(a || '').toLowerCase().trim())
      .filter(Boolean);
    if (!list.length) return;
    setExcludedRecipients(prev => {
      const next = [...prev];
      for (const a of list) if (!next.includes(a)) next.push(a);
      if (next.length === prev.length) return prev;
      writeExcludedRecipients(next);
      return next;
    });
  };

  // Re-include every previously excluded recipient.
  const clearExcludedRecipients = () => {
    setExcludedRecipients(prev => {
      if (!prev.length) return prev;
      writeExcludedRecipients([]);
      return [];
    });
  };

  const ignoreMeeting = (id) => {
    if (!id) return;
    const key = String(id);
    setIgnoredMeetings(prev => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      writeIgnoredMeetings(next);
      return next;
    });
  };

  const setOverride = (key, opp) => {
    if (!key || !opp) return;
    setOverrides(prev => {
      const next = {
        ...prev,
        [key]: {
          bfoOpp: String(opp['BFO Link'] || '').trim(),
          account: String(opp['Account'] || '').trim(),
        },
      };
      writeOverrides(next);
      return next;
    });
  };

  const clearOverride = (key) => {
    if (!key) return;
    setOverrides(prev => {
      const next = { ...prev };
      delete next[key];
      writeOverrides(next);
      return next;
    });
  };

  // Pick up new HubSpot activity pulls from the Activity tab.
  useEffect(() => {
    const refresh = () => setCache(readActivityCache());
    window.addEventListener('hubspot-activity-cache-updated', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('hubspot-activity-cache-updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Pull the latest HubSpot activity (emails, calls, meetings) AND
  // re-sync the Opps 2 store so the BFO tagging and the Called
  // section both reflect the latest data. The HubSpot pull writes to
  // the shared localStorage cache that ActivityView reads from; the
  // Opps half reconciles the local Opps 2 cache against Firestore
  // (Opps 2 is the canonical opps store — the legacy Google Sheet is
  // a read-only backup that no longer feeds anything here). Each
  // half runs independently so a failure on one doesn't block the
  // other.
  async function refreshActivityCache() {
    if (activityRefreshing) return;
    setActivityRefreshing(true);
    setActivityRefreshError(null);
    setActivityRefreshProgress({ email: 0, call: 0, meeting: 0, opps: 0 });
    async function fetchAllPages(type) {
      const all = [];
      let after = '';
      while (true) {
        const url = `/api/hubspot?action=activity&type=${type}${after ? `&after=${after}` : ''}`;
        const res = await apiFetch(url);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        all.push(...(json.results || []));
        setActivityRefreshProgress(prev => ({ ...prev, [type]: all.length }));
        if (json.nextAfter) after = json.nextAfter;
        else break;
        if (all.length > 5000) break;
      }
      return all;
    }
    async function fetchOpps() {
      // Opps 2 is the canonical opps store. Reconcile the local cache
      // against the Firestore copy with the same merge the Opps 2 tab
      // uses, so the values here always match the current Opps data —
      // including edits made on another device since the last visit.
      const [fromIdb, fromFs] = await Promise.all([
        loadOpps2Cache(),
        user?.uid ? loadOpps2FromFirestore(user.uid) : Promise.resolve(null),
      ]);
      const next = (fromIdb && fromFs)
        ? mergeOpps2Datasets(fromIdb, fromFs)
        : (fromIdb || fromFs);
      if (!next) {
        // Nothing cached locally or in the cloud yet — leave the
        // existing oppsCache (if any) untouched.
        return;
      }
      const result = {
        headers: Array.isArray(next.headers) ? next.headers : [],
        records: Array.isArray(next.records) ? next.records : [],
        fetchedAt: next.fetchedAt || null,
      };
      setActivityRefreshProgress(prev => ({ ...prev, opps: result.records.length }));
      setOppsCache(result);
      return result;
    }

    const activityPromise = (async () => {
      const emails = await fetchAllPages('email');
      const calls = await fetchAllPages('call');
      const meetings = await fetchAllPages('meeting');
      const result = { emails, calls, meetings, fetchedAt: new Date().toISOString() };
      try {
        userLsSet(ACTIVITY_CACHE_KEY, JSON.stringify(result));
        window.dispatchEvent(new CustomEvent('hubspot-activity-cache-updated'));
      } catch (err) {
        console.warn('Agents activity cache write skipped (quota):', err?.message || err);
      }
      setCache(result);
    })();
    const oppsPromise = fetchOpps();

    const [activityRes, oppsRes] = await Promise.allSettled([activityPromise, oppsPromise]);
    const errors = [];
    if (activityRes.status === 'rejected') {
      console.error('Agents activity refresh error:', activityRes.reason);
      errors.push(`Activity: ${activityRes.reason?.message || 'fetch failed'}`);
    }
    if (oppsRes.status === 'rejected') {
      console.error('Agents opps refresh error:', oppsRes.reason);
      errors.push(`Opps: ${oppsRes.reason?.message || 'fetch failed'}`);
    }
    if (errors.length > 0) setActivityRefreshError(errors.join(' · '));
    setActivityRefreshing(false);
    setActivityRefreshProgress(null);
  }

  // BFO Activity rows (pasted on the BFO Activity tab, persisted in
  // IndexedDB). Stages live there — the Opps sheet only has free-text
  // status labels ("Not Started" / "Sold" / etc.), not the 1-6 Sales
  // Stage we need for the close-date slip filter.
  useEffect(() => {
    let cancelled = false;
    dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY)
      .then(d => { if (!cancelled) setBfoActivity(d || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // HubSpot contacts cache — email → company lookup for tagging.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotCache().then(c => { if (!cancelled) setHubspotCache(c); }).catch(() => {});
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => { cancelled = true; window.removeEventListener('hubspot-cache-updated', refresh); };
  }, []);

  // Opps cache (IndexedDB) — drives the BFO Opportunity Name tagging.
  // Each opp record carries Contact (recipient email[s]), Account
  // (company), and BFO Link (= BFO Opportunity Name). Refresh on
  // window focus so a fresh paste over on the Opps tab shows up here
  // without a manual reload.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadOppsFromCache()
        .then(o => { if (!cancelled) setOppsCache(o); })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    // Re-pull when Opps 2 writes its cache (an edit on the Opps 2 tab or
    // an inline save here) so matches reflect the latest data live.
    window.addEventListener('opps2-cache-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('opps2-cache-updated', refresh);
    };
  }, []);

  // BFO Activity rows — pasted on the BFO Activity tab, persisted in
  // IndexedDB. Read here so each row's Amount can be compared against
  // the Opps tab's Quoted Amount and a discrepancy list surfaced.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY)
        .then(d => { if (!cancelled) setBfoActivity(d || null); })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  // Leads subtab rows — pasted on the BFO Activity page's "Leads" tab
  // (Salesforce Leads printable view), persisted under BFO_LEADS_KEY.
  // Read here so the Marketing Lead Status Update agent can surface only
  // the leads whose Salesforce status differs from the Marketing Leads
  // source of truth. Refresh on focus so a fresh paste shows up live.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      dbGet(BFO_ACTIVITY_STORE, BFO_LEADS_KEY)
        .then(d => { if (!cancelled) setBfoLeads(d || null); })
        .catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  // email → company map from the HubSpot contacts cache.
  const companyByEmail = useMemo(() => {
    const map = new Map();
    for (const c of (hubspotCache?.contacts || [])) {
      if (c.email && c.company) map.set(c.email.toLowerCase(), c.company);
    }
    return map;
  }, [hubspotCache]);

  // Pre-index the Opps cache for two lookup modes:
  //   1. email → opp  (Contact field carries email tokens)
  //   2. company → opp (Account field, fuzzy-matched)
  // The same opp can answer for either path. BFO Link is the BFO
  // Opportunity Name (the column was renamed visibly elsewhere but the
  // data key stayed "BFO Link").
  const oppIndex = useMemo(() => {
    const records = oppsCache?.records || [];
    const byEmail = new Map(); // lower-case email → opp
    const byBfoOpp = new Map(); // lower-case opp name → opp
    const allOpps = [];
    for (const r of records) {
      const rawBfoOpp = String(r['BFO Link'] || '').trim();
      // The Opps tab uses "-" / "#N/A" as placeholders for rows that
      // don't yet have a BFO Opportunity Name. Treat those as empty
      // here so the Sent emails table renders the inline picker
      // (instead of showing the literal "-") and the user can map
      // the row to a real opportunity.
      const bfoOpp = (rawBfoOpp && rawBfoOpp !== '-' && rawBfoOpp !== '#N/A') ? rawBfoOpp : '';
      const account = String(r['Account'] || '').trim();
      // Skip opps that don't carry the data we need to surface.
      if (!bfoOpp && !account) continue;
      const entry = { raw: r, account, bfoOpp };
      allOpps.push(entry);
      if (bfoOpp) {
        const key = bfoOpp.toLowerCase();
        if (!byBfoOpp.has(key)) byBfoOpp.set(key, entry);
      }
      const contactRaw = String(r['Contact'] || '').toLowerCase();
      if (!contactRaw) continue;
      const emails = contactRaw.match(EMAIL_RE) || [];
      for (const e of emails) {
        const existing = byEmail.get(e);
        // First match wins — except a BFO-tagged opp always beats an
        // untagged one that shares the same contact email, so a row with
        // a real BFO Opportunity Name isn't shadowed by a duplicate opp
        // that doesn't have one.
        if (!existing || (!existing.bfoOpp && entry.bfoOpp)) byEmail.set(e, entry);
      }
    }
    return { byEmail, byBfoOpp, allOpps };
  }, [oppsCache]);

  // Primary path: which Opps-tab row covers this email recipient?
  // Falls back to a fuzzy Account match on the HubSpot company so an
  // unknown-contact email still finds its opp when the company has
  // any open opportunity on the Opps tab.
  const findOppForRecipient = (recipientEmail, hubspotCompany) => {
    if (recipientEmail) {
      const direct = oppIndex.byEmail.get(recipientEmail);
      if (direct) return direct;
    }
    if (hubspotCompany) {
      for (const opp of oppIndex.allOpps) {
        if (companiesMatch(opp.account, hubspotCompany)) return opp;
      }
    }
    return null;
  };

  // Marketing Leads (Contacts tab) indexed by lower-cased email → the
  // lead's resolvable Salesforce record link. Lets the Activity table
  // recognise when an outbound email's external recipient is a known
  // lead, so the same activity can be logged on that lead's Salesforce
  // record in addition to any matched Opp. Only leads whose Salesforce
  // Link resolves to a real URL are indexed — there's nothing to open
  // (or log against) otherwise.
  const leadSfByEmail = useMemo(() => {
    const map = new Map();
    const leads = Array.isArray(settings?.marketingLeads) ? settings.marketingLeads : [];
    for (const lead of leads) {
      const email = String(lead?.email || '').toLowerCase().trim();
      if (!email || map.has(email)) continue;
      const url = resolveSfUrl(lead?.sfUrl);
      if (!url) continue;
      map.set(email, { url, name: String(lead?.name || '').trim() });
    }
    return map;
  }, [settings?.marketingLeads]);

  const { todaysOutbound, todaysMeetings } = useMemo(() => {
    const bounds = boundsForDate(referenceDate);
    const inToday = (ts) => {
      const t = new Date(ts || 0).getTime();
      return Number.isFinite(t) && t >= bounds.start && t < bounds.end;
    };
    // Sent emails span the past 2 business days (the reference day plus
    // the previous business day); meetings stay scoped to the single
    // reference day.
    const activityBounds = boundsForActivityWindow(referenceDate);
    const inActivityWindow = (ts) => {
      const t = new Date(ts || 0).getTime();
      return Number.isFinite(t) && t >= activityBounds.start && t < activityBounds.end;
    };
    const sentByMe = (e) => {
      if (!senderEmail) return false;
      const from = String(e.hs_email_from_email || '').toLowerCase().trim();
      return from === senderEmail;
    };
    const outbound = senderEmail ? (cache?.emails || [])
      .filter(e => !(e.hs_email_subject || '').toLowerCase().includes('(sample email)'))
      .filter(e => inActivityWindow(e.hs_timestamp))
      .filter(sentByMe)
      .filter(e => hasExternalRecipient(e.hs_email_to_email))
      .filter(e => !ignoredEmailIds.has(String(e.id || e.hs_object_id)))
      // Drop emails whose external recipients have all been excluded
      // by the user ("don't include moving forward").
      .filter(e => externalRecipientList(e.hs_email_to_email)
        .some(addr => !excludedRecipientSet.has(addr.toLowerCase())))
      .map(e => {
        const recipients = externalRecipientList(e.hs_email_to_email);
        // Pick the HubSpot-company off the first recipient we have a
        // contact record for. Used both as a fallback Company when no
        // Opp matches and as the secondary-match key for the Opps-tab
        // lookup.
        let hubspotCompany = '';
        for (const addr of recipients) {
          const c = companyByEmail.get(addr);
          if (c) { hubspotCompany = c; break; }
        }
        // Walk the external recipients and take the first one that
        // resolves to an Opp on the Opps tab (by Contact email, then by
        // company-name fuzzy match against the Opps Account). The company
        // comes from the HubSpot contact when we have one, otherwise from
        // a guess off the email domain — so an email to an unknown
        // contact still gets a BFO Opportunity estimate from its company.
        let matchedOpp = null;
        for (const addr of recipients) {
          const companyCandidate = companyByEmail.get(addr) || hubspotCompany || domainCompanyGuess(addr);
          matchedOpp = findOppForRecipient(addr, companyCandidate);
          if (matchedOpp) break;
        }
        // If any external recipient is a known Marketing Lead, capture
        // that lead's Salesforce record link so the activity can also be
        // logged on the lead. First matching recipient wins.
        let leadMatch = null;
        for (const addr of recipients) {
          const m = leadSfByEmail.get(String(addr).toLowerCase());
          if (m) { leadMatch = m; break; }
        }
        // Override key — keyed by the first external recipient so a
        // future email to the same person reuses the manual tag.
        const overrideKey = recipients[0] || '';
        const override = overrideKey ? overrides[overrideKey] : null;
        // Manual override wins over the auto-match. Auto-match wins
        // when there's no override.
        const account = override?.account || matchedOpp?.account || '';
        const bfoOpp = override?.bfoOpp || matchedOpp?.bfoOpp || '';
        const company = account || hubspotCompany || domainCompanyGuess(recipients[0]);
        // Resolve the full opp record for this row's BFO URL / Next
        // Steps. Prefer a manual override's named opp, else the opp we
        // actually matched. Re-looking an auto-match up by name (the old
        // behavior) could land on a *different* record that shares the
        // BFO Opportunity Name — e.g. a duplicate that has no BFO Address
        // — which dropped the BFO Link even though the real opp has one.
        let oppForRow = override?.bfoOpp
          ? oppIndex.byBfoOpp.get(override.bfoOpp.toLowerCase())
          : matchedOpp;
        // If the chosen record has no BFO Address but another opp with
        // the same BFO Opportunity Name does, use that one for the link.
        if (bfoOpp && !detectBfoUrl(oppForRow?.raw)) {
          const key = bfoOpp.toLowerCase();
          const withUrl = oppIndex.allOpps.find(
            o => o.bfoOpp && o.bfoOpp.toLowerCase() === key && detectBfoUrl(o.raw),
          );
          if (withUrl) oppForRow = withUrl;
        }
        const bfoUrl = detectBfoUrl(oppForRow?.raw);
        const nextStepsType = detectNextStepsType(oppForRow?.raw);
        return {
          id: e.id || e.hs_object_id,
          ts: e.hs_timestamp,
          subject: e.hs_email_subject || '(no subject)',
          to: recipients.join(', '),
          recipients,
          rawTo: e.hs_email_to_email || '',
          status: e.hs_email_status || '',
          company,
          bfoOpp,
          bfoUrl,
          leadSfUrl: leadMatch?.url || '',
          leadName: leadMatch?.name || '',
          nextStepsType,
          overrideKey,
          isManual: Boolean(override),
        };
      })
      .sort((a, b) => new Date(b.ts) - new Date(a.ts)) : [];

    const meetings = (cache?.meetings || [])
      .filter(m => inToday(m.hs_meeting_start_time || m.hs_timestamp))
      .filter(m => !ignoredMeetingIds.has(String(m.id || m.hs_object_id)))
      .map(m => {
        // Resolve associated HubSpot contacts up front. We walk each
        // one looking for an Opps-tab match (by email → Contact, then
        // by company → Account) instead of taking the first contact
        // and stopping — meetings frequently include internal SE
        // attendees first, which would block a match if we short-
        // circuited on the first email / company we saw.
        const ids = m._contactIds || [];
        const contacts = ids
          .map(id => (hubspotCache?.contacts || []).find(c => c.id === id))
          .filter(Boolean);

        // Strongest match keys: an external recipient email and the
        // first non-empty company. Used as the override key + as the
        // last-chance fuzzy match.
        let primaryEmail = '';
        let primaryCompany = '';
        for (const ct of contacts) {
          const e = String(ct.email || '').toLowerCase();
          if (e && !e.endsWith('@se.com') && !primaryEmail) primaryEmail = e;
          if (ct.company && !primaryCompany) primaryCompany = ct.company;
        }

        // Walk every external contact + their company against the
        // Opps tab. First opp that resolves wins.
        let matchedOpp = null;
        for (const ct of contacts) {
          const e = String(ct.email || '').toLowerCase();
          if (e && e.endsWith('@se.com')) continue;
          matchedOpp = findOppForRecipient(e, ct.company || '');
          if (matchedOpp) break;
        }
        // Final fuzzy fallback: the meeting title or location often
        // carries the customer's company name. Match that against
        // every opp's Account field.
        if (!matchedOpp) {
          const haystack = `${m.hs_meeting_title || ''} ${m.hs_meeting_location || ''}`.trim();
          if (haystack) matchedOpp = findOppForRecipient('', haystack);
        }

        // Meetings rarely have a stable contact email — fall back to
        // the meeting id so the override survives. Same shape as the
        // email rows so the picker code stays one path.
        const meetingId = m.id || m.hs_object_id || '';
        const overrideKey = primaryEmail || (meetingId ? `meeting:${meetingId}` : '');
        const override = overrideKey ? overrides[overrideKey] : null;
        const account = override?.account || matchedOpp?.account || '';
        const bfoOpp = override?.bfoOpp || matchedOpp?.bfoOpp || '';
        const company = account || primaryCompany;
        return {
          id: meetingId,
          ts: m.hs_meeting_start_time || m.hs_timestamp,
          endTs: m.hs_meeting_end_time,
          title: m.hs_meeting_title || 'Meeting',
          outcome: m.hs_meeting_outcome || '',
          location: m.hs_meeting_location || '',
          company,
          bfoOpp,
          overrideKey,
          isManual: Boolean(override),
        };
      })
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));

    return { todaysOutbound: outbound, todaysMeetings: meetings };
    // findOppForRecipient / companyByEmail are derived from the same
    // dependency set as cache + hubspotCache + oppIndex + overrides,
    // so they don't need their own entries here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, hubspotCache, oppIndex, overrides, ignoredEmailIds, ignoredMeetingIds, excludedRecipientSet, referenceDate, senderEmail, leadSfByEmail]);

  // Opps that count as "called" in the activity window. Two signals:
  //   • An explicit mark from the Opps tab's Called button (`_calledOn`
  //     stamp on the reference day or the previous business day), OR
  //   • the legacy heuristic: a phone touch logged in Next Steps and
  //     the Last Spoke column (business days since Last Client Heard
  //     From Us) computing to 0 or 1 relative to the reference date.
  const calledOpps = useMemo(() => {
    const records = oppsCache?.records || [];
    const prevBiz = previousBusinessDayIso(referenceDate);
    const rows = [];
    for (const r of records) {
      const nextSteps = String(r['Next Steps'] || '');
      const markedOn = toISODate(r._calledOn);
      const marked = !!markedOn && (markedOn === referenceDate || markedOn === prevBiz);
      if (!marked) {
        if (!CALLED_NEXT_STEPS_RE.test(nextSteps)) continue;
        // Include calls from the past 2 business days: 0 = the reference
        // day itself, 1 = the previous business day.
        const lsbd = lastSpokeBusinessDays(r, referenceDate);
        if (lsbd !== 0 && lsbd !== 1) continue;
      }
      const account = String(r.Account || '').trim();
      const bfoOpp = String(r['BFO Link'] || '').trim();
      rows.push({
        id: r._id ?? `${account}|${bfoOpp}`,
        company: account || '—',
        bfoOpp: (bfoOpp && bfoOpp !== '-' && bfoOpp !== '#N/A') ? bfoOpp : '',
        bfoUrl: detectBfoUrl(r),
        nextSteps,
        marked,
        markedOn: marked ? markedOn : '',
      });
    }
    rows.sort((a, b) => a.company.localeCompare(b.company));
    return rows;
  }, [oppsCache, referenceDate]);

  // Opps the user explicitly marked "Meeting" on the Opps tab (`_metOn`
  // stamp on the reference day or the previous business day). These join
  // the Activity table and the BFO Activity AI prompt as meeting rows —
  // unlike HubSpot meetings they already know their opp, so they carry a
  // BFO address directly.
  const markedMeetingOpps = useMemo(() => {
    const records = oppsCache?.records || [];
    const prevBiz = previousBusinessDayIso(referenceDate);
    const rows = [];
    for (const r of records) {
      const markedOn = toISODate(r._metOn);
      if (!markedOn || (markedOn !== referenceDate && markedOn !== prevBiz)) continue;
      const account = String(r.Account || '').trim();
      const bfoOpp = String(r['BFO Link'] || '').trim();
      rows.push({
        id: r._id ?? `${account}|${bfoOpp}`,
        company: account || '—',
        bfoOpp: (bfoOpp && bfoOpp !== '-' && bfoOpp !== '#N/A') ? bfoOpp : '',
        bfoUrl: detectBfoUrl(r),
        markedOn,
      });
    }
    rows.sort((a, b) => a.company.localeCompare(b.company));
    return rows;
  }, [oppsCache, referenceDate]);

  // Opps that don't yet exist in BFO and need a fresh Guided Opportunity
  // created. Filter mirrors the user's spec:
  //   • Stage NOT in {Not Started, Not Sold, Sold}
  //   • No BFO Opportunity Name — the Opps tab's "BFO Link" column is
  //     blank, "-", or "#N/A" (all treated as "no link yet").
  // Output carries Company (Account), Lead Source + a current-customer
  // boolean, and Scope so the appended block reads as the table the
  // user described.
  // BFO Company Name lookup — normalized company → bfoCompanyName from
  // the Table View prospect records. Used to enrich each New BFO Opp
  // row with the BFO-side account name (which often differs from the
  // marketing-friendly Account on the Opps sheet).
  const bfoCompanyByNorm = useMemo(() => {
    const map = new Map();
    for (const p of prospects) {
      const norm = normalizeCompany(p.company);
      const bfo = String(p.bfoCompanyName || '').trim();
      if (!norm || !bfo) continue;
      // First match wins so the lookup is deterministic when two
      // prospect rows happen to normalize to the same key.
      if (!map.has(norm)) map.set(norm, bfo);
    }
    return map;
  }, [prospects]);

  // Normalized company → Table View prospect, so the New BFO Opp table
  // can write an entered BFO Company Name straight back to that company's
  // record (the same field Opps 2 / Table View read). First match wins.
  const prospectByNorm = useMemo(() => {
    const map = new Map();
    for (const p of prospects) {
      const norm = normalizeCompany(p.company);
      if (norm && !map.has(norm)) map.set(norm, p);
    }
    return map;
  }, [prospects]);

  // Resolve a Sent-email row's BFO Company Name from the strongest
  // signal available, in order:
  //   1. the recipient contact's company (looked up by email),
  //   2. the company name shown on the row,
  //   3. the matched BFO opp — its own "BFO Company Name" field if the
  //      Opps sheet carries one, else its Account.
  // Each company identifier maps through the Table View bfoCompanyName
  // lookup so the BFO-side name stays consistent with Opps 2.
  const resolveBfoCompanyName = (e) => {
    for (const addr of (e.recipients || [])) {
      const co = companyByEmail.get(addr);
      const v = co ? (bfoCompanyByNorm.get(normalizeCompany(co)) || '') : '';
      if (v) return v;
    }
    const byCompany = bfoCompanyByNorm.get(normalizeCompany(e.company)) || '';
    if (byCompany) return byCompany;
    const opp = e.bfoOpp ? oppIndex.byBfoOpp.get(e.bfoOpp.toLowerCase()) : null;
    if (opp) {
      return String(opp.raw?.['BFO Company Name'] || '').trim()
        || bfoCompanyByNorm.get(normalizeCompany(opp.account || '')) || '';
    }
    return '';
  };

  const newBfoOpps = useMemo(() => {
    const records = oppsCache?.records || [];
    const EXCLUDED_STAGES = new Set(['Not Started', 'Not Sold', 'Sold']);
    const overrides = settings?.serviceOverrides || {};
    const rows = [];
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      if (!stage || EXCLUDED_STAGES.has(stage)) continue;
      // Only list opps whose BFO Opportunity Name is exactly "-" — the
      // deliberate placeholder for "needs a BFO opp created". Blank and
      // "#N/A" do not qualify.
      const bfoLink = String(r['BFO Link'] ?? '').trim();
      if (bfoLink !== '-') continue;
      const callInRaw = String(r['Call In'] ?? '').trim();
      const account = String(r.Account || '').trim();
      const leadSource = String(r['Lead Source'] || r['Source'] || '').trim();
      // A Scope can list several comma-joined services (e.g. "Remote
      // assessments, Audits"). The New BFO Opp flow only creates an opp
      // for the first one, so use just the first listed scope item for
      // the Scope column, the metadata lookup, and the Project Name.
      const rawScope = String(r.Scope || '').trim();
      const scope = rawScope.includes(',')
        ? rawScope.split(',')[0].trim()
        : rawScope;
      const followUp = String(r['Follow Up'] ?? '').trim();
      const bfoCompanyName = bfoCompanyByNorm.get(normalizeCompany(account)) || '';
      // Look up the per-service metadata from the Dropdowns › Services
      // subtab. Scope is the canonical service name; the catalog
      // supplies Product Line, Type, Region, Class (= BFO Tag), and
      // Local Project Name. User overrides on the Services tab win
      // over the seed values.
      const svcMeta = getEffectiveServiceMetadata(scope, overrides);
      const productLine = svcMeta?.productLine || '';
      const type = svcMeta?.serviceType || '';
      const region = svcMeta?.region || '';
      const klass = svcMeta?.bfoTag || '';
      // Local Project Name picks up the seed / override value. When
      // the opp's Lead Source is "PE Partner" (the PE-firm referral
      // bucket), append "#PE PRACTICE" so the BFO opp is tagged into
      // the PE practice book of business.
      const baseLpn = svcMeta?.localProjectName || '';
      const isPePartner = /^pe partner$/i.test(leadSource);
      const localProjectName = isPePartner
        ? (baseLpn ? `${baseLpn} #PE PRACTICE` : '#PE PRACTICE')
        : baseLpn;
      // Years is fixed: every new BFO opp starts at Year 1. The
      // catalog's "X years" value represents contract duration, which
      // BFO doesn't surface in the opp name.
      const years = 'YEAR1';
      // Combined Project Name the user pastes into BFO's Project Name
      // box. Format:
      //   SB - {ProductLine code} - New - {Type} - {Region} - YEAR1 - {Scope}
      // {ProductLine code} is the first segment of the Product Line
      // before " - " (e.g. "SUSUP" from "SUSUP - SUPPLY & SUST
      // SERVICES"). Falls back to the raw productLine when the code
      // can't be parsed.
      const plCode = productLine.includes(' - ')
        ? productLine.split(' - ')[0].trim()
        : productLine.trim();
      const projectNameParts = ['SB', plCode, 'New', type, region, years, scope].filter(Boolean);
      const projectName = projectNameParts.join(' - ');
      rows.push({
        id: r._id ?? `${account}|${scope}`,
        // Raw Opps-tab record, so the table can open the same Opp info
        // modal Opps 2 uses (read-only here).
        raw: r,
        company: account || '—',
        bfoCompanyName,
        leadSource: leadSource || '—',
        currentCustomer: CURRENT_CUSTOMER_LEAD_SOURCE_RE.test(leadSource),
        scope: scope || '—',
        stage,
        followUp,
        callIn: callInRaw,
        productLine,
        localProjectName,
        projectName,
        type,
        region,
        class: klass,
        years,
      });
    }
    rows.sort((a, b) => a.company.localeCompare(b.company));
    return rows;
  }, [oppsCache, bfoCompanyByNorm, settings?.serviceOverrides]);

  // Missing data the New BFO Opp AI prompt needs. The prompt emits
  // "BFO Company Name | Project Name | Product Line | Local Project Name"
  // per opp, with Project Name composed from the Product Line code, Type,
  // Region and Scope — so any blank among those fields leaves a hole in
  // the prompt. One entry per affected opp, listing its blank fields;
  // drives the red banner at the top of the page.
  const newBfoMissingData = useMemo(() => {
    const blank = (v) => {
      const s = String(v ?? '').trim();
      return !s || s === '—' || s === '-';
    };
    const out = [];
    for (const o of newBfoOpps) {
      const missing = [];
      if (blank(o.bfoCompanyName)) missing.push('BFO Company Name');
      if (blank(o.productLine)) missing.push('Product Line');
      if (blank(o.type)) missing.push('Type');
      if (blank(o.region)) missing.push('Region');
      if (blank(o.scope)) missing.push('Scope');
      if (blank(o.localProjectName)) missing.push('Local Project Name');
      if (missing.length) out.push({ company: o.company, missing });
    }
    return out;
  }, [newBfoOpps]);

  // BFO Opportunity Name → Last Activity date from the BFO Activity tab.
  // Lets the Called and Sent emails tables show how long it's been since
  // anything happened on the matched BFO opp. Keyed by normalized
  // opportunity name (== the Opps tab's "BFO Link").
  const bfoLastActivityByName = useMemo(() => {
    const map = new Map();
    const headers = bfoActivity?.headers || [];
    const oppCol = headers.find(h => /opportunity\s*name/i.test(h));
    const actCol = headers.find(h => /last\s*activity/i.test(h));
    if (!oppCol || !actCol) return map;
    for (const r of (bfoActivity?.rows || [])) {
      const k = normalizeBfoOppName(r[oppCol]);
      if (!k || map.has(k)) continue;
      const v = String(r[actCol] ?? '').trim();
      if (v) map.set(k, v);
    }
    return map;
  }, [bfoActivity]);

  // Look up the BFO Last Activity date for a given BFO Opportunity Name
  // (blank when there's no opp or no matching BFO Activity row).
  const lastActivityFor = (bfoOpp) => {
    const k = normalizeBfoOppName(bfoOpp);
    return k ? (bfoLastActivityByName.get(k) || '') : '';
  };

  // "Hide rows last active in the activity window" toggle. The Sent /
  // Called tables now span the past 2 business days, so this hides rows
  // whose BFO Last Activity falls on either the reference day or the
  // previous business day. Last Activity is whatever BFO pasted (usually
  // M/D/YYYY) while referenceDate is ISO, so normalize both before
  // comparing.
  const prevBusinessDate = previousBusinessDayIso(referenceDate);
  const lastActivityOnReference = (bfoOpp) => {
    const iso = toISODate(lastActivityFor(bfoOpp));
    return !!iso && (iso === referenceDate || iso === prevBusinessDate);
  };
  const visibleCalledOpps = hideActivityOnDate
    ? calledOpps.filter(o => !lastActivityOnReference(o.bfoOpp))
    : calledOpps;
  const visibleOutbound = hideActivityOnDate
    ? todaysOutbound.filter(e => !lastActivityOnReference(e.bfoOpp))
    : todaysOutbound;
  const visibleMeetings = hideActivityOnDate
    ? todaysMeetings.filter(m => !lastActivityOnReference(m.bfoOpp))
    : todaysMeetings;
  const visibleMarkedMeetings = hideActivityOnDate
    ? markedMeetingOpps.filter(o => !lastActivityOnReference(o.bfoOpp))
    : markedMeetingOpps;
  const activityHiddenCount =
    (calledOpps.length - visibleCalledOpps.length)
    + (todaysOutbound.length - visibleOutbound.length)
    + (todaysMeetings.length - visibleMeetings.length)
    + (markedMeetingOpps.length - visibleMarkedMeetings.length);

  // Unified Activity rows: Sent emails + Called + Meetings, normalized to
  // one shape and tagged with `type` (email / call / meeting). Emails and
  // meetings carry an overrideKey so their BFO Opportunity tag is
  // editable; calls come straight off the Opps sheet, so they're shown
  // read-only. Sorted newest-first by timestamp; calls (no timestamp)
  // fall to the bottom.
  const activityRows = useMemo(() => {
    const rows = [];
    for (const e of visibleOutbound) {
      rows.push({
        rowKey: `email:${e.id}`, type: 'email', ts: e.ts, endTs: null,
        title: e.subject, to: e.to, rawTo: e.rawTo, recipients: e.recipients || [],
        company: e.company, bfoOpp: e.bfoOpp, bfoUrl: e.bfoUrl,
        leadSfUrl: e.leadSfUrl || '', leadName: e.leadName || '',
        outcome: e.status || '', location: '', overrideKey: e.overrideKey,
        isManual: e.isManual, editable: true, emailId: e.id,
      });
    }
    for (const o of visibleCalledOpps) {
      rows.push({
        rowKey: `call:${o.id}`, type: 'call', ts: null, endTs: null,
        title: o.nextSteps || (o.marked ? `Marked "Called" on the Opps tab (${o.markedOn})` : ''),
        to: '', rawTo: '', recipients: [],
        company: (o.company && o.company !== '—') ? o.company : '', bfoOpp: o.bfoOpp, bfoUrl: o.bfoUrl,
        outcome: '', location: '', overrideKey: '', isManual: false, editable: false,
        marked: o.marked,
      });
    }
    for (const m of visibleMeetings) {
      rows.push({
        rowKey: `meeting:${m.id}`, type: 'meeting', ts: m.ts, endTs: m.endTs,
        title: m.title, to: '', rawTo: '', recipients: [],
        company: m.company, bfoOpp: m.bfoOpp, bfoUrl: '',
        outcome: m.outcome || '', location: m.location || '', overrideKey: m.overrideKey,
        isManual: m.isManual, editable: true, meetingId: m.id,
      });
    }
    // Meetings marked on the Opps tab — read-only like calls, since they
    // come straight off the opp row (which already carries the BFO opp).
    for (const o of visibleMarkedMeetings) {
      rows.push({
        rowKey: `meetingflag:${o.id}`, type: 'meeting', ts: null, endTs: null,
        title: `Marked "Meeting" on the Opps tab (${o.markedOn})`, to: '', rawTo: '', recipients: [],
        company: (o.company && o.company !== '—') ? o.company : '', bfoOpp: o.bfoOpp, bfoUrl: o.bfoUrl,
        outcome: '', location: '', overrideKey: '', isManual: false, editable: false,
        marked: true,
      });
    }
    rows.sort((a, b) => (new Date(b.ts || 0)) - (new Date(a.ts || 0)));
    return rows;
  }, [visibleOutbound, visibleCalledOpps, visibleMeetings, visibleMarkedMeetings]);

  // BFO opps whose Close Date should slip by 30 days. Three windows
  // collapsed into one filter, all keyed off the BFO Sales Stage number
  // (which is why we read the BFO Activity tab — the Opps sheet's
  // Stage column doesn't carry the 1-6 BFO sales-stage value):
  //   • Stage ≤ 4 and < 100 days from today
  //   • Stage = 5 and < 60 days
  //   • Stage = 6 and < 30 days
  const closeDateOpps = useMemo(() => {
    if (!bfoActivity?.headers?.length || !bfoActivity?.rows?.length) return [];
    const stageCol = bfoActivity.headers.find(h => /sales\s*stage|^stage$/i.test(h));
    const closeCol = bfoActivity.headers.find(h => /close\s*date/i.test(h));
    const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
    if (!stageCol || !closeCol || !oppCol) return [];
    const rows = [];
    for (const r of bfoActivity.rows) {
      const stage = bfoStageNumber(r[stageCol]);
      if (stage === null) continue;
      const closeRaw = String(r[closeCol] || '').trim();
      const days = daysUntilDate(closeRaw);
      if (days === null) continue;
      let include = false;
      if (stage <= 4 && days < 100) include = true;
      else if (stage === 5 && days < 60) include = true;
      else if (stage === 6 && days < 30) include = true;
      if (!include) continue;
      const name = String(r[oppCol] || '').trim();
      if (!name) continue;
      rows.push({
        id: `${name}|${closeRaw}`,
        name,
        stage,
        stageLabel: String(r[stageCol] || '').trim(),
        currentClose: closeRaw,
        newClose: addDaysFormatted(closeRaw, 30),
        daysOut: days,
      });
    }
    rows.sort((a, b) => a.daysOut - b.daysOut);
    return rows;
  }, [bfoActivity]);

  // BFO ↔ Opps amount discrepancies. Joins each BFO Activity row to
  // its Opps record by BFO Opportunity Name (BFO's "Opportunity Name"
  // column == Opps' "BFO Link" column). When the rounded amounts
  // differ, we surface the BFO Address + the Opps Quoted Amount so
  // the AI assistant can update BFO to match. Rows where either side
  // doesn't carry a numeric amount are skipped — they're indistinguishable
  // from "not yet quoted" and would generate noise.
  const amountUpdateOpps = useMemo(() => {
    if (!bfoActivity?.headers?.length || !bfoActivity?.rows?.length) return [];
    const stageCol = bfoActivity.headers.find(h => /sales\s*stage|^stage$/i.test(h));
    const amtCol = bfoActivity.headers.find(h => /^amount$/i.test(h));
    const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
    if (!amtCol || !oppCol) return [];
    const oppsByName = new Map();
    for (const r of (oppsCache?.records || [])) {
      const k = String(r['BFO Link'] || '').trim().toLowerCase();
      if (k && k !== '-' && k !== '#n/a' && !oppsByName.has(k)) oppsByName.set(k, r);
    }
    const rows = [];
    const seen = new Set();
    for (const r of bfoActivity.rows) {
      const name = String(r[oppCol] || '').trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      const oppsRow = oppsByName.get(k);
      if (!oppsRow) continue;
      const bfoAmt = parseMoneyNumber(r[amtCol]);
      const oppsAmt = parseMoneyNumber(oppsRow['Quoted Amount']);
      if (bfoAmt == null || oppsAmt == null) continue;
      if (Math.round(bfoAmt) === Math.round(oppsAmt)) continue;
      const bfoUrl = detectBfoUrl(oppsRow);
      if (!bfoUrl) continue;
      seen.add(k);
      rows.push({
        id: `${k}|${bfoUrl}`,
        name,
        account: String(oppsRow.Account || '').trim(),
        stage: stageCol ? String(r[stageCol] || '').trim() : '',
        bfoUrl,
        bfoAmount: bfoAmt,
        quotedAmount: oppsAmt,
        quotedAmountFmt: fmtMoney(oppsAmt),
      });
    }
    rows.sort((a, b) => (b.quotedAmount - b.bfoAmount) - (a.quotedAmount - a.bfoAmount));
    return rows;
  }, [bfoActivity, oppsCache]);

  // BFO ↔ Opps stage mismatches. For each BFO Activity row we look up
  // its joined Opps record by Opportunity Name, then check whether the
  // BFO Sales Stage matches the BFO stage we'd expect for that opp's
  // current Opps 2 Stage. Mismatches surface the BFO Link + the
  // expected BFO stage so the AI assistant can advance BFO to match.
  const stageChangeOpps = useMemo(() => {
    if (!bfoActivity?.headers?.length || !bfoActivity?.rows?.length) return [];
    const stageCol = bfoActivity.headers.find(h => /sales\s*stage|^stage$/i.test(h));
    const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
    if (!stageCol || !oppCol) return [];
    const oppsByName = new Map();
    for (const r of (oppsCache?.records || [])) {
      const k = String(r['BFO Link'] || '').trim().toLowerCase();
      if (k && k !== '-' && k !== '#n/a' && !oppsByName.has(k)) oppsByName.set(k, r);
    }
    const rows = [];
    const seen = new Set();
    for (const r of bfoActivity.rows) {
      const name = String(r[oppCol] || '').trim();
      if (!name) continue;
      const k = name.toLowerCase();
      if (seen.has(k)) continue;
      const oppsRow = oppsByName.get(k);
      if (!oppsRow) continue;
      const oppsStage = String(oppsRow.Stage || '').trim();
      const expectedBfoStage = OPPS_STAGE_TO_BFO_STAGE[oppsStage.toLowerCase()];
      if (!expectedBfoStage) continue;
      const bfoStage = String(r[stageCol] || '').trim();
      if (!bfoStage) continue;
      if (bfoStage.toLowerCase() === expectedBfoStage.toLowerCase()) continue;
      const bfoUrl = detectBfoUrl(oppsRow);
      if (!bfoUrl) continue;
      seen.add(k);
      rows.push({
        id: `${k}|${bfoUrl}`,
        name,
        account: String(oppsRow.Account || '').trim(),
        bfoStage,
        oppsStage,
        expectedBfoStage,
        bfoUrl,
      });
    }
    rows.sort((a, b) => a.account.localeCompare(b.account));
    return rows;
  }, [bfoActivity, oppsCache]);

  // Not-Sold opps that still have a corresponding BFO row open. Each
  // pulls its Reason Not Sold from Opps 2 and maps it to the Status +
  // Reason values BFO expects when closing the opp out. Rows whose
  // Reason Not Sold isn't in the mapping table fall through so the
  // user can see them and either update the row or extend the table.
  const closeNotSoldOpps = useMemo(() => {
    const records = oppsCache?.records || [];
    if (!records.length) return [];
    // Index BFO Activity by opportunity name so we can quickly check
    // whether an Opps 2 row has a corresponding open BFO opp. Collapse
    // runs of whitespace and lower-case so a stray double-space in
    // either the BFO Link or the Opportunity Name doesn't drop the
    // match.
    const normalizeName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const bfoByName = new Map();
    const headers = bfoActivity?.headers || [];
    const oppCol = headers.find(h => /opportunity\s*name/i.test(h));
    if (oppCol) {
      for (const r of (bfoActivity?.rows || [])) {
        const k = normalizeName(r[oppCol]);
        if (k && !bfoByName.has(k)) bfoByName.set(k, r);
      }
    }
    const rows = [];
    const seen = new Set();
    for (const r of records) {
      const stage = String(r.Stage || '').trim().toLowerCase();
      if (stage !== 'not sold') continue;
      const bfoOpp = String(r['BFO Link'] || '').trim();
      if (!bfoOpp || bfoOpp === '-' || bfoOpp === '#N/A') continue;
      const key = normalizeName(bfoOpp);
      if (seen.has(key)) continue;
      // Only surface opps that still exist on the BFO Activity tab —
      // the prompt is about closing them out in BFO, so a BFO row is
      // required.
      if (bfoByName.size > 0 && !bfoByName.has(key)) continue;
      // URL is nice-to-have, not a gate: a Not-Sold opp with a
      // matching BFO Activity row but a missing BFO Address still
      // surfaces here (with the URL cell flagged red) so the user can
      // patch the Opps 2 row.
      const bfoUrl = detectBfoUrl(r);
      const reasonNotSold = String(r['Reason Not Sold'] || '').trim();
      const map = REASON_NOT_SOLD_TO_BFO[reasonNotSold.toLowerCase()] || null;
      seen.add(key);
      rows.push({
        id: `${key}|${bfoUrl || bfoOpp}`,
        name: bfoOpp,
        account: String(r.Account || '').trim(),
        reasonNotSold,
        status: map?.status || '',
        reason: map?.reason || '',
        unmapped: !map,
        bfoUrl,
      });
    }
    rows.sort((a, b) => a.account.localeCompare(b.account));
    return rows;
  }, [oppsCache, bfoActivity]);

  // AI BFO Prep — live Opps 2 opps (Stage not Sold / Not Sold) that have
  // a non-blank Call In, carry a BFO Opportunity Name (BFO Link), but
  // have no BFO Address yet. The user fills in each BFO Address inline;
  // once set, the opp drops off this list.
  const bfoPrepOpps = useMemo(() => {
    const recs = oppsCache?.records || [];
    const rows = [];
    for (const r of recs) {
      const name = String(r['BFO Link'] ?? '').trim();
      if (bfoFieldBlank(name)) continue;
      if (!bfoFieldBlank(r['BFO Address'])) continue;
      // Live opps only — drop closed stages.
      if (CLOSED_OPP_STAGES.has(String(r.Stage || '').trim().toLowerCase())) continue;
      // Only opps with an actual Call In number (on a callback schedule).
      if (resolveOppCallIn(r) == null) continue;
      rows.push({
        id: r._id,
        name,
        account: String(r.Account || '').trim(),
        bfoAddress: String(r['BFO Address'] ?? '').trim(),
      });
    }
    rows.sort((a, b) => a.account.localeCompare(b.account) || a.name.localeCompare(b.name));
    return rows;
  }, [oppsCache]);

  const [bfoPrepCopyFlash, setBfoPrepCopyFlash] = useState('');

  // Persist a BFO Address edit straight to Opps 2 (cache + Firestore) and
  // optimistically update the local cache so the row reflects it / drops
  // off the prep list immediately.
  const updateOppBfoAddress = async (oppId, value) => {
    setOppsCache(prev => (prev && Array.isArray(prev.records))
      ? { ...prev, records: prev.records.map(r => (String(r._id) === String(oppId) ? { ...r, 'BFO Address': value } : r)) }
      : prev);
    try {
      await setOppField(user?.uid, oppId, 'BFO Address', value);
    } catch (err) {
      console.error('AI BFO Prep: failed to save BFO Address', { oppId, err });
    }
  };

  // ---- BFO Opportunity Names not tagged to an opp on Opps ----
  // Mirrors the warning on the BFO Activity page: any Opportunity Name in
  // the pasted BFO Activity data that has no matching opp on the Opps tab
  // is surfaced up top so it can be tagged onto an untagged opp.

  // Set of BFO Opportunity Names that already exist on the Opps tab
  // (keyed by "BFO Link", lower-cased + trimmed).
  const taggedBfoOppNameKeys = useMemo(() => {
    const set = new Set();
    for (const r of (oppsCache?.records || [])) {
      const k = bfoOppNameOf(r).toLowerCase();
      if (k) set.add(k);
    }
    return set;
  }, [oppsCache]);

  // BFO Activity Opportunity Names with no matching opp on the Opps tab,
  // paired with the BFO Account they came from. Suppressed until the Opps
  // cache has loaded (taggedBfoOppNameKeys empty) so we don't flag every
  // row before there's anything to match against.
  const untaggedBfoOppNames = useMemo(() => {
    if (!bfoActivity?.headers?.length || taggedBfoOppNameKeys.size === 0) return [];
    const oppCol = bfoActivity.headers.find(h => /opportunity\s*name/i.test(h));
    if (!oppCol) return [];
    const acctCol = bfoActivity.headers.find(h => /^account(\s*name)?$/i.test(h.trim()))
      || bfoActivity.headers.find(h => /account/i.test(h));
    const seen = new Set();
    const missing = [];
    for (const r of bfoActivity.rows) {
      const raw = String(r[oppCol] || '').trim();
      if (!raw) continue;
      const k = raw.toLowerCase();
      if (taggedBfoOppNameKeys.has(k) || seen.has(k)) continue;
      seen.add(k);
      missing.push({ name: raw, account: acctCol ? String(r[acctCol] || '').trim() : '' });
    }
    return missing;
  }, [bfoActivity, taggedBfoOppNameKeys]);

  // Normalized company → that company's BFO Company Name, sourced from the
  // Table View prospect records. Keyed with the canonical companyNorm so
  // it lines up with the BFO Activity page's matching.
  const bfoCompanyByAccountCanon = useMemo(() => {
    const map = new Map();
    for (const p of (prospects || [])) {
      const key = canonCompany(p?.company || '');
      const bfo = String(p?.bfoCompanyName || '').trim();
      if (key && bfo) map.set(key, bfo);
    }
    return map;
  }, [prospects]);

  // Opps that have NO BFO Opportunity Name yet, indexed by every key we
  // might match a BFO Activity row on: the normalized Account, the opp's
  // own normalized BFO Company Name, and the normalized BFO Company Name
  // carried on the matching Table View company. Closed opps excluded.
  const untaggedOppsByCanonKey = useMemo(() => {
    const map = new Map();
    const add = (key, opp) => {
      if (!key) return;
      let list = map.get(key);
      if (!list) { list = []; map.set(key, list); }
      if (!list.some(o => o._id === opp._id)) list.push(opp);
    };
    for (const r of (oppsCache?.records || [])) {
      if (bfoOppNameOf(r) !== '') continue;
      if (CLOSED_OPP_STAGES.has(String(r.Stage || '').trim().toLowerCase())) continue;
      const acctKey = canonCompany(r.Account || '');
      add(acctKey, r);
      add(canonCompany(r['BFO Company Name'] || ''), r);
      const bfo = bfoCompanyByAccountCanon.get(acctKey);
      if (bfo) add(canonCompany(bfo), r);
    }
    return map;
  }, [oppsCache, bfoCompanyByAccountCanon]);

  // Tag the chosen Opps opp with the BFO Opportunity Name, persist through
  // the shared Opps 2 store, then refresh the local cache so the warning
  // reflects the new tag. Optimistically drops the opp off the candidate
  // lists immediately.
  async function assignBfoOppName(oppId, bfoName) {
    if (assigningBfo) return;
    setAssigningBfo(true);
    setOppsCache(prev => (prev && Array.isArray(prev.records))
      ? { ...prev, records: prev.records.map(r => (String(r._id) === String(oppId) ? { ...r, 'BFO Link': bfoName } : r)) }
      : prev);
    try {
      await setOppBfoLink(user?.uid, oppId, bfoName);
      const refreshed = await loadOppsFromCache();
      if (refreshed) setOppsCache(refreshed);
      setBfoAssignFlash(`Tagged an Opps opp with "${bfoName}".`);
    } catch (err) {
      setBfoAssignFlash(`Could not tag opp: ${err?.message || err}`);
    } finally {
      setAssigningBfo(false);
      window.setTimeout(() => setBfoAssignFlash(''), 3500);
    }
  }

  const dateLabel = useMemo(() => parseIsoDate(referenceDate).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }), [referenceDate]);
  const isToday = referenceDate === todayIso();

  const fetchedLabel = fmtFetchedAt(cache?.fetchedAt);
  const oppsLoaded = (oppsCache?.records?.length || 0) > 0;

  // Single master prompt that bundles every AI Prompt section on the
  // page so the user can paste one block into their assistant instead
  // of copying each section one at a time. Each section keeps the
  // same prompt + appended data block its individual Copy button
  // would produce; sections are separated by a heading rule so the
  // assistant can still tell them apart.
  const masterPromptBundle = useMemo(() => {
    const activityLines = ['BFO Address'];
    {
      // Same precedence as the Activity section's own Copy button:
      // meetings (marked on the Opps tab) win over calls win over
      // emails, so the strongest touch is the one that gets logged.
      const seen = new Set();
      for (const o of markedMeetingOpps) {
        if (!o.bfoUrl || seen.has(o.bfoUrl)) continue;
        activityLines.push(`${o.bfoUrl}: Type meeting`);
        seen.add(o.bfoUrl);
      }
      for (const o of calledOpps) {
        if (!o.bfoUrl || seen.has(o.bfoUrl)) continue;
        activityLines.push(`${o.bfoUrl}: Type called`);
        seen.add(o.bfoUrl);
      }
      for (const e of todaysOutbound) {
        if (!e.bfoUrl || seen.has(e.bfoUrl)) continue;
        activityLines.push(`${e.bfoUrl}: Type ${e.nextStepsType}`);
        seen.add(e.bfoUrl);
      }
      // Log the same email touch on any matched Marketing Lead's
      // Salesforce record too. Lead links live on their own SF records,
      // so they never collide with the opp BFO addresses above.
      for (const e of todaysOutbound) {
        if (!e.leadSfUrl || seen.has(e.leadSfUrl)) continue;
        activityLines.push(`${e.leadSfUrl}: Type ${e.nextStepsType}`);
        seen.add(e.leadSfUrl);
      }
    }
    const activityBlock = activityLines.join('\n');

    const newBfoLines = ['BFO Opportunities to Create', 'BFO Company Name | Project Name | Product Line | Local Project Name'];
    for (const o of newBfoOpps) {
      newBfoLines.push([o.bfoCompanyName, o.projectName, o.productLine, o.localProjectName].join(' | '));
    }
    const newBfoBlock = newBfoLines.join('\n');

    const closeDatesLines = ['Opportunity Name\tNew Close Date'];
    for (const o of closeDateOpps) closeDatesLines.push(`${o.name}\t${o.newClose}`);
    const closeDatesBlock = closeDatesLines.join('\n');

    const amountLines = ['BFO Address\tQuoted Amount'];
    for (const o of amountUpdateOpps) amountLines.push(`${o.bfoUrl}\t${o.quotedAmountFmt}`);
    const amountBlock = amountLines.join('\n');

    const stageLines = ['BFO Link\tNew Stage'];
    for (const o of stageChangeOpps) stageLines.push(`${o.bfoUrl}\t${o.expectedBfoStage}`);
    const stageBlock = stageLines.join('\n');

    const closeNotSoldLines = ['BFO Link\tStatus\tReason'];
    for (const o of closeNotSoldOpps) {
      if (o.unmapped) continue;
      closeNotSoldLines.push(`${o.bfoUrl}\t${o.status}\t${o.reason}`);
    }
    const closeNotSoldBlock = closeNotSoldLines.join('\n');

    const bfoPrepBlock = ['BFO Opportunity Names', ...bfoPrepOpps.map(o => o.name)].join('\n');

    const marketingLeadsBlock = ['Name\tCompany', ...marketingLeadsMissing.map(l => `${(l.name || '').trim()}\t${(l.company || '').trim()}`)].join('\n');

    const marketingLeadStatusBlock = ['Name\tCompany\tMarketing Leads Status', ...marketingLeadStatusRows.map(l => `${(l.name || '').trim()}\t${(l.company || '').trim()}\t${(l.status || '').trim()}`)].join('\n');

    const sections = [
      { title: 'BFO Prep', prompt: bfoPrepPrompt, block: bfoPrepBlock, hasData: bfoPrepOpps.length > 0 },
      { title: 'Activity', prompt: aiPrompt, block: activityBlock, hasData: activityLines.length > 1 },
      { title: 'New BFO Opp', prompt: newBfoOppPrompt, block: newBfoBlock, hasData: newBfoOpps.length > 0 },
      { title: 'Close Dates', prompt: closeDatesPrompt, block: closeDatesBlock, hasData: closeDateOpps.length > 0 },
      { title: 'Amount Updates', prompt: amountUpdatesPrompt, block: amountBlock, hasData: amountUpdateOpps.length > 0 },
      { title: 'Stage Change', prompt: stageChangePrompt, block: stageBlock, hasData: stageChangeOpps.length > 0 },
      { title: 'Close Not Solds', prompt: closeNotSoldsPrompt, block: closeNotSoldBlock, hasData: closeNotSoldLines.length > 1 },
      // Marketing Leads always rides along in the bundle, even with no leads
      // missing a Salesforce Link — its prompt stands alone as a reusable
      // instruction, so `always` keeps it in every copy regardless of data.
      { title: 'Marketing Leads', prompt: marketingLeadsPrompt, block: marketingLeadsBlock, hasData: marketingLeadsMissing.length > 0, always: true },
      { title: 'Marketing Lead Status Update', prompt: marketingLeadStatusUpdatePrompt, block: marketingLeadStatusBlock, hasData: marketingLeadStatusRows.length > 0, always: true },
    ];
    // Skip sections that carry no data — when a section is just its prompt
    // with an empty data block (no BFO links, names, or opportunities to
    // act on), there's nothing for the assistant to do, so leave it out of
    // the bundle. hasData checks the underlying rows (the header-only line
    // count for the deduped / filtered blocks) rather than the prompt text.
    // `always` sections stay in even when empty, dropping just their data
    // block so only the prompt itself carries through.
    const base = sections
      .filter(s => s.hasData || s.always)
      .map(s => s.hasData ? `===== ${s.title} =====\n${s.prompt}\n\n${s.block}` : `===== ${s.title} =====\n${s.prompt}`)
      .join('\n\n');
    // Update BFO Activity closes out the bundle (no data block of its own).
    const bfoSuffix = (updateBfoActivityPrompt || '').trim();
    if (!bfoSuffix) return base;
    const suffixSection = `===== Update BFO Activity =====\n${bfoSuffix}`;
    return base ? `${base}\n\n${suffixSection}` : suffixSection;
  }, [
    aiPrompt, newBfoOppPrompt, closeDatesPrompt, amountUpdatesPrompt,
    stageChangePrompt, closeNotSoldsPrompt, updateBfoActivityPrompt,
    bfoPrepPrompt, todaysOutbound, calledOpps, markedMeetingOpps, newBfoOpps, closeDateOpps,
    amountUpdateOpps, stageChangeOpps, closeNotSoldOpps, bfoPrepOpps,
    marketingLeadsPrompt, marketingLeadsMissing,
    marketingLeadStatusUpdatePrompt, marketingLeadStatusRows,
  ]);

  const [copyAllFlash, setCopyAllFlash] = useState('');
  const onCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(masterPromptBundle);
      setCopyAllFlash('Copied all!');
    } catch {
      setCopyAllFlash('Copy failed');
    }
    window.setTimeout(() => setCopyAllFlash(''), 1500);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.title}>Agents</h1>
        {activeSubTab === 'automations' && (
          <>
            <span className={styles.dateline}>{dateLabel}</span>
            <label className={styles.dateField} title="Pick the date the activity sections (sent emails, meetings, called opps) should reference.">
              Activity date
              <input
                type="date"
                className={styles.dateInput}
                value={referenceDate}
                max={todayIso()}
                onChange={(e) => setReferenceDate(e.target.value || todayIso())}
              />
              {!isToday && (
                <button
                  type="button"
                  className={styles.dateResetBtn}
                  onClick={() => setReferenceDate(todayIso())}
                  title="Jump back to today"
                >Today</button>
              )}
            </label>
            <label
              className={styles.hideActivityField}
              title="Hide rows in the Called and Sent tables whose Last Activity falls within the past 2 business days (the selected Activity date or the previous business day)."
            >
              <input
                type="checkbox"
                checked={hideActivityOnDate}
                onChange={(e) => {
                  const on = e.target.checked;
                  setHideActivityOnDate(on);
                  writeHideActivityOnDate(on);
                }}
              />
              Hide rows last active in the past 2 business days
            </label>
            <button
              type="button"
              className={styles.refreshActivityBtn}
              onClick={refreshActivityCache}
              disabled={activityRefreshing}
              title="Re-pull every HubSpot email, call, and meeting AND re-sync Opps from the Opps tab's store (local cache reconciled against the cloud copy). Updates the shared activity cache (same as the Activity tab's Refresh)."
            >
              {activityRefreshing
                ? (activityRefreshProgress
                    ? `Refreshing… ${activityRefreshProgress.email || 0} email · ${activityRefreshProgress.call || 0} call · ${activityRefreshProgress.meeting || 0} meeting · ${activityRefreshProgress.opps || 0} opps`
                    : 'Refreshing…')
                : 'Refresh Activity & Opps'}
            </button>
            <button
              type="button"
              className={styles.refreshActivityBtn}
              onClick={onCopyAll}
              title="Copy every AI Prompt section on this page into one master prompt, ready to paste into an assistant."
            >Copy all prompts</button>
            {copyAllFlash && <span className={styles.copyFlash}>{copyAllFlash}</span>}
          </>
        )}
      </div>

      <div className={styles.subTabs}>
        <button
          type="button"
          className={activeSubTab === 'automations' ? styles.subTabActive : styles.subTab}
          onClick={() => selectSubTab('automations')}
        >Automations</button>
        <button
          type="button"
          className={activeSubTab === 'prompts' ? styles.subTabActive : styles.subTab}
          onClick={() => selectSubTab('prompts')}
        >Prompt Library</button>
      </div>

      {activeSubTab === 'prompts' && (
        <PromptLibrary prompts={savedPrompts} onChange={handleSavedPromptsChange} />
      )}

      {activeSubTab === 'automations' && (<>
      {bfoAssignFlash && (
        <div className={styles.bfoAssignFlash}>{bfoAssignFlash}</div>
      )}
      {untaggedBfoOppNames.length > 0 && (
        <div className={styles.warning}>
          <strong>
            ⚠ {untaggedBfoOppNames.length} BFO Opportunity Name{untaggedBfoOppNames.length === 1 ? '' : 's'} not tagged to an opp on Opps
          </strong>
          <div className={styles.warningHint}>
            Click an Opps opp below to tag it with the BFO Opportunity Name. Only opps that don&apos;t already have a BFO Opportunity Name are listed.
          </div>
          <ul className={styles.warnList}>
            {untaggedBfoOppNames.map(({ name, account }) => {
              const candidates = untaggedOppsByCanonKey.get(canonCompany(account)) || [];
              return (
                <li key={name} className={styles.warnItem}>
                  <div className={styles.warnName}>
                    <span className={styles.warnNameText}>{name}</span>
                    {account && <span className={styles.warnAcct}> · {account}</span>}
                  </div>
                  {candidates.length === 0 ? (
                    <div className={styles.warnNone}>
                      No untagged Opps opps{account ? ` for “${account}”` : ''} to assign.
                    </div>
                  ) : (
                    <div className={styles.warnChips}>
                      {candidates.map(c => (
                        <button
                          key={c._id}
                          type="button"
                          className={styles.assignChip}
                          disabled={assigningBfo}
                          title={`Tag this opp's BFO Opportunity Name as "${name}"`}
                          onClick={() => assignBfoOppName(c._id, name)}
                        >
                          + {bfoOppTargetLabel(c)}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {newBfoMissingData.length > 0 && (
        <div className={styles.errorBanner}>
          <strong>New BFO Opp prompt is missing data for {newBfoMissingData.length} opp{newBfoMissingData.length === 1 ? '' : 's'}:</strong>{' '}
          {newBfoMissingData.map((m, i) => (
            <span key={m.company + i}>
              {i > 0 && '; '}
              <strong>{m.company}</strong> — {m.missing.join(', ')}
            </span>
          ))}
          {' '}(BFO Company Name comes from the company&rsquo;s Table View record; Product Line / Type / Region / Local Project Name come from Dropdowns › Services for the opp&rsquo;s Scope.)
        </div>
      )}
      {activityRefreshError && (
        <div className={styles.staleBanner}>
          Refresh failed: {activityRefreshError}
        </div>
      )}
      {senderEmail ? (
        <p className={styles.subnote}>
          The Activity table merges outbound emails from <strong>{senderEmail}</strong> (to non-SE recipients, past 2 business days), logged calls from the Opps tab, and meetings on {isToday ? 'today' : `${dateLabel}`}&rsquo;s calendar — the Type column marks each row as Email, Call, or Meeting. BFO Opportunity tagging walks each recipient&rsquo;s email against the Opps tab&rsquo;s Contact field first, then estimates by company name — fuzzy-matching the HubSpot company (or, when there&rsquo;s no HubSpot contact, the company guessed from the email domain) against the Opps tab&rsquo;s Account field. Use the inline picker to set or change any tag (it shows that company&rsquo;s opportunities first); your selection is remembered for that recipient on future emails. The BFO Company Name column is resolved from the Company. Use the Columns menu to choose which columns are shown.
        </p>
      ) : (
        <div className={styles.staleBanner}>
          Set your work email in Settings → CDM Name so this section can match your outbound HubSpot emails. Until then, no Sent emails will appear.
        </div>
      )}

      <div className={styles.tallies}>
        <div className={styles.tally}><strong>{todaysOutbound.length}</strong>sent emails</div>
        <div className={styles.tally}><strong>{calledOpps.length}</strong>call{calledOpps.length === 1 ? '' : 's'}</div>
        <div className={styles.tally}><strong>{todaysMeetings.length + markedMeetingOpps.length}</strong>meeting{(todaysMeetings.length + markedMeetingOpps.length) === 1 ? '' : 's'}</div>
      </div>

      {!cache && (
        <div className={styles.staleBanner}>
          No HubSpot activity cached yet. Visit the Activity tab to fetch.
        </div>
      )}
      {cache && !oppsLoaded && (
        <div className={styles.staleBanner}>
          No Opps cache loaded yet. Visit the Opps tab to populate the BFO Opportunity column.
        </div>
      )}
      {cache && fetchedLabel && (
        <div className={styles.subnote}>Cache last refreshed {fetchedLabel}.</div>
      )}

      <section className={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <h2 className={styles.sectionHeader}>
            Activity <span className={styles.sectionCount}>{activityRows.length}</span>
          </h2>
          <div ref={activityColsMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => setActivityColsMenuOpen(o => !o)}
              title="Choose which columns are visible on the Activity table"
            >
              Columns ({ACTIVITY_COLUMNS.length - hiddenActivityCols.size}/{ACTIVITY_COLUMNS.length}) ▾
            </button>
            {activityColsMenuOpen && (
              <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 50, marginTop: 4, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', padding: '0.35rem', minWidth: 190 }}>
                {ACTIVITY_COLUMNS.map(col => (
                  <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.25rem 0.4rem', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={isActivityColVisible(col.key)} onChange={() => toggleActivityCol(col.key)} />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              {isActivityColVisible('time') && <th style={{ width: 110 }}>Time</th>}
              {isActivityColVisible('type') && <th style={{ width: 80 }}>Type</th>}
              {isActivityColVisible('subject') && <th>Subject / Title</th>}
              {isActivityColVisible('to') && <th>To (external)</th>}
              {isActivityColVisible('company') && <th>Company</th>}
              {isActivityColVisible('bfoCompanyName') && <th>BFO Company Name</th>}
              {isActivityColVisible('bfoOpp') && <th>BFO Opportunity</th>}
              {isActivityColVisible('lastActivity') && <th style={{ width: 110 }}>Last Activity</th>}
              {isActivityColVisible('bfoLink') && <th style={{ width: 70 }}>BFO Link</th>}
              {isActivityColVisible('outcome') && <th style={{ width: 130 }}>Outcome / Status</th>}
              {isActivityColVisible('location') && <th>Location</th>}
              <th style={{ width: 64 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {activityRows.length === 0 ? (
              <tr className={styles.emptyRow}>
                <td colSpan={ACTIVITY_COLUMNS.length - hiddenActivityCols.size + 1}>No activity (emails, calls, or meetings) for {isToday ? 'today' : dateLabel}.</td>
              </tr>
            ) : activityRows.map(r => {
                const lastActivity = lastActivityFor(r.bfoOpp);
                const bfoCompanyName = resolveBfoCompanyName(r);
                const typeLabel = r.type === 'email' ? 'Email' : r.type === 'call' ? 'Call' : 'Meeting';
                // Rows born from the Opps tab's Called/Meeting buttons get
                // a chip so it's clear where the flag came from.
                const markedChip = r.marked ? (
                  <span
                    title="Marked with the Called/Meeting buttons on the Opps tab"
                    style={{
                      marginLeft: 6, padding: '0 5px', fontSize: '0.62rem', fontWeight: 700,
                      color: '#166534', background: '#DCFCE7', border: '1px solid #86EFAC',
                      borderRadius: 999, verticalAlign: 'middle', whiteSpace: 'nowrap',
                    }}
                  >Opps ✓</span>
                ) : null;
                return (
                <tr key={r.rowKey}>
                  {isActivityColVisible('time') && <td className={r.ts ? '' : styles.muted}>{r.ts ? `${fmtTime(r.ts)}${r.endTs ? ` – ${fmtTime(r.endTs)}` : ''}` : '—'}</td>}
                  {isActivityColVisible('type') && <td>{typeLabel}{markedChip}</td>}
                  {isActivityColVisible('subject') && <td className={r.title ? '' : styles.muted} title={r.title}>{r.title || '—'}</td>}
                  {isActivityColVisible('to') && <td title={r.rawTo}>{r.to || <span className={styles.muted}>—</span>}</td>}
                  {isActivityColVisible('company') && <td className={r.company ? '' : styles.muted}>{r.company || '—'}</td>}
                  {isActivityColVisible('bfoCompanyName') && <td className={bfoCompanyName ? '' : styles.muted}>{bfoCompanyName || '—'}</td>}
                  {isActivityColVisible('bfoOpp') && (
                    <td>
                      {r.editable ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                          {r.bfoOpp && (
                            <span className={styles.overrideValue}>
                              {r.bfoOpp}
                              {r.isManual && (
                                <button
                                  type="button"
                                  className={styles.overrideClear}
                                  onClick={() => clearOverride(r.overrideKey)}
                                  title="Clear manual tag (revert to auto-match)"
                                >✕</button>
                              )}
                            </span>
                          )}
                          <OppPicker
                            oppsCache={oppsCache}
                            company={r.company}
                            triggerLabel={r.bfoOpp ? '✎ Change' : '+ Pick opportunity'}
                            onSelect={(opp) => setOverride(r.overrideKey, opp)}
                          />
                        </div>
                      ) : (
                        <span className={r.bfoOpp ? '' : styles.muted} title={r.title}>{r.bfoOpp || '—'}</span>
                      )}
                    </td>
                  )}
                  {isActivityColVisible('lastActivity') && <td className={lastActivity ? '' : styles.muted}>{lastActivity || '—'}</td>}
                  {isActivityColVisible('bfoLink') && (
                    <td>
                      {(r.bfoUrl || r.leadSfUrl) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {r.bfoUrl && (
                            <a
                              href={r.bfoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.bfoLink}
                            >Open</a>
                          )}
                          {r.leadSfUrl && (
                            <a
                              href={r.leadSfUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.bfoLink}
                              title={`Log this activity on the matched Marketing Lead${r.leadName ? ` (${r.leadName})` : ''} in Salesforce`}
                            >Lead ↗</a>
                          )}
                        </span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                  )}
                  {isActivityColVisible('outcome') && <td className={r.outcome ? '' : styles.muted}>{r.outcome || '—'}</td>}
                  {isActivityColVisible('location') && <td className={r.location ? '' : styles.muted}>{r.location || '—'}</td>}
                  <td className={styles.actionsCell}>
                    {r.type === 'email' && (
                      <>
                        <button
                          type="button"
                          className={styles.ignoreBtn}
                          onClick={() => ignoreEmail(r.emailId)}
                          title="Hide just this email from the Activity table"
                          aria-label="Ignore email"
                        >✕</button>
                        <button
                          type="button"
                          className={styles.ignoreBtn}
                          onClick={() => excludeRecipient(r.recipients)}
                          disabled={!r.recipients?.length}
                          title={r.recipients?.length
                            ? `Don't include emails to ${r.recipients.join(', ')} moving forward`
                            : 'No external recipient to exclude'}
                          aria-label="Exclude recipient from future activity"
                        >🚫</button>
                      </>
                    )}
                    {r.type === 'meeting' && r.meetingId && (
                      <button
                        type="button"
                        className={styles.ignoreBtn}
                        onClick={() => ignoreMeeting(r.meetingId)}
                        title="Hide this meeting from the Activity table"
                        aria-label="Ignore meeting"
                      >✕</button>
                    )}
                  </td>
                </tr>
                );
              })}
          </tbody>
        </table>
        {hideActivityOnDate && activityHiddenCount > 0 && (
          <p className={styles.subnote}>
            Hiding {activityHiddenCount} row{activityHiddenCount === 1 ? '' : 's'} last active in the past 2 business days.
          </p>
        )}
        {excludedRecipients.length > 0 && (
          <p className={styles.subnote}>
            Hiding emails to {excludedRecipients.length} excluded recipient{excludedRecipients.length === 1 ? '' : 's'} ({excludedRecipients.join(', ')}).{' '}
            <button type="button" className={styles.linkBtn} onClick={clearExcludedRecipients}>Restore all</button>
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          AI BFO Prep
          <span className={styles.sectionCount}>{bfoPrepOpps.length}</span>
        </h2>
        <p className={styles.subnote}>
          Live Opps opps (Stage not Sold / Not Sold) with a Call In number that have a BFO Opportunity Name but no BFO Address yet. Copy the prompt to have your AI assistant look up each opp&rsquo;s BFO website address, then paste it into the BFO Address column below — it saves straight to Opps and the row drops off once set.
        </p>
        {revealedPrompts.bfoPrep && (
          <textarea
            className={styles.aiPromptInput}
            value={bfoPrepPrompt}
            onChange={(e) => updateBfoPrepPrompt(e.target.value)}
            rows={12}
            spellCheck={false}
          />
        )}
        <div className={styles.aiPromptControls}>
          <button
            type="button"
            className={styles.aiPromptBtn}
            disabled={bfoPrepOpps.length === 0}
            onClick={async () => {
              const block = ['BFO Opportunity Names', ...bfoPrepOpps.map(o => o.name)].join('\n');
              const fullPrompt = `${bfoPrepPrompt}\n\n${block}`;
              try {
                await navigator.clipboard.writeText(fullPrompt);
                setBfoPrepCopyFlash('Copied!');
              } catch {
                setBfoPrepCopyFlash('Copy failed');
              }
              window.setTimeout(() => setBfoPrepCopyFlash(''), 1500);
            }}
          >Copy full prompt</button>
          <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('bfoPrep')}>
            {revealedPrompts.bfoPrep ? 'Hide prompt' : 'Edit prompt'}
          </button>
          {revealedPrompts.bfoPrep && (
            <button type="button" className={styles.aiPromptBtnGhost} onClick={resetBfoPrepPrompt}>Reset to default</button>
          )}
          {bfoPrepCopyFlash && <span className={styles.copyFlash}>{bfoPrepCopyFlash}</span>}
        </div>
        <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Company</th>
                <th>BFO Opportunity Name</th>
                <th style={{ minWidth: 280 }}>BFO Address</th>
              </tr>
            </thead>
            <tbody>
              {bfoPrepOpps.length === 0 ? (
                <tr className={styles.emptyRow}>
                  <td colSpan={3}>No opps are missing a BFO Address (every opp with a BFO Opportunity Name already has one).</td>
                </tr>
              ) : bfoPrepOpps.map(o => (
                <tr key={o.id}>
                  <td className={o.account ? '' : styles.muted}>{o.account || '—'}</td>
                  <td>{o.name}</td>
                  <td>
                    <BfoAddressCell
                      value={o.bfoAddress}
                      onCommit={(v) => updateOppBfoAddress(o.id, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          Marketing Leads
          <span className={styles.sectionCount}>{marketingLeadsMissing.length}</span>
        </h2>
        <p className={styles.subnote}>
          Leads from the Marketing Leads subtab on the Contacts page that don&rsquo;t have a Salesforce Link yet. Copy the prompt to have your AI assistant open each lead in Salesforce and grab its record URL, then paste it into the Salesforce Link column below &mdash; it saves straight to the Marketing Leads page and the row drops off this list once set.
        </p>
        {revealedPrompts.marketingLeads && (
          <textarea
            className={styles.aiPromptInput}
            value={marketingLeadsPrompt}
            onChange={(e) => updateMarketingLeadsPrompt(e.target.value)}
            rows={10}
            spellCheck={false}
          />
        )}
        <div className={styles.aiPromptControls}>
          <button
            type="button"
            className={styles.aiPromptBtn}
            onClick={async () => {
              // With no leads missing a link there's no data block to append,
              // so copy the prompt on its own — it's still useful standalone.
              const fullPrompt = marketingLeadsMissing.length === 0
                ? marketingLeadsPrompt
                : `${marketingLeadsPrompt}\n\n${['Name\tCompany', ...marketingLeadsMissing.map(l => `${(l.name || '').trim()}\t${(l.company || '').trim()}`)].join('\n')}`;
              try {
                await navigator.clipboard.writeText(fullPrompt);
                setMarketingLeadsCopyFlash('Copied!');
              } catch {
                setMarketingLeadsCopyFlash('Copy failed');
              }
              window.setTimeout(() => setMarketingLeadsCopyFlash(''), 1500);
            }}
          >Copy full prompt</button>
          <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('marketingLeads')}>
            {revealedPrompts.marketingLeads ? 'Hide prompt' : 'Edit prompt'}
          </button>
          {revealedPrompts.marketingLeads && (
            <button type="button" className={styles.aiPromptBtnGhost} onClick={resetMarketingLeadsPrompt}>Reset to default</button>
          )}
          {marketingLeadsCopyFlash && <span className={styles.copyFlash}>{marketingLeadsCopyFlash}</span>}
        </div>
        <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th style={{ minWidth: 280 }}>Salesforce Link</th>
              </tr>
            </thead>
            <tbody>
              {marketingLeadsMissing.length === 0 ? (
                <tr className={styles.emptyRow}>
                  <td colSpan={3}>No marketing leads are missing a Salesforce Link.</td>
                </tr>
              ) : marketingLeadsMissing.map((l, i) => (
                <tr key={l.id || `${l.name}-${i}`}>
                  <td>{l.name || '—'}</td>
                  <td className={l.company ? '' : styles.muted}>{l.company || '—'}</td>
                  <td>
                    <MarketingLeadSfCell
                      value={l.sfUrl}
                      onCommit={(v) => updateMarketingLeadSfUrl(l.id, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeader}>
          Marketing Lead Status Update
          <span className={styles.sectionCount}>{marketingLeadStatusRows.length}</span>
        </h2>
        <p className={styles.subnote}>
          Only lists leads whose Marketing Leads Status (the source of truth on the Contacts page) differs from that lead&rsquo;s status on the BFO Activity page&rsquo;s <strong>Leads</strong> subtab &mdash; the ones that actually need updating. Leads that match, or that aren&rsquo;t on the Leads subtab, are hidden. Copy the prompt to have your AI assistant open each lead by name, go to the Assessment tab, and update the status to the Marketing Leads Status. Paste the Salesforce Leads printable view into the BFO Activity page&rsquo;s Leads subtab to feed this comparison. The prompt is always part of &ldquo;Copy all prompts.&rdquo;
        </p>
        {revealedPrompts.marketingLeadStatusUpdate && (
          <textarea
            className={styles.aiPromptInput}
            value={marketingLeadStatusUpdatePrompt}
            onChange={(e) => updateMarketingLeadStatusUpdatePrompt(e.target.value)}
            rows={10}
            spellCheck={false}
          />
        )}
        <div className={styles.aiPromptControls}>
          <button
            type="button"
            className={styles.aiPromptBtn}
            onClick={async () => {
              // With no leads carrying a Status there's nothing to reconcile,
              // so copy the prompt on its own — it's still useful standalone.
              const fullPrompt = marketingLeadStatusRows.length === 0
                ? marketingLeadStatusUpdatePrompt
                : `${marketingLeadStatusUpdatePrompt}\n\n${['Name\tCompany\tMarketing Leads Status', ...marketingLeadStatusRows.map(l => `${(l.name || '').trim()}\t${(l.company || '').trim()}\t${(l.status || '').trim()}`)].join('\n')}`;
              try {
                await navigator.clipboard.writeText(fullPrompt);
                setMarketingLeadStatusUpdateCopyFlash('Copied!');
              } catch {
                setMarketingLeadStatusUpdateCopyFlash('Copy failed');
              }
              window.setTimeout(() => setMarketingLeadStatusUpdateCopyFlash(''), 1500);
            }}
          >Copy full prompt</button>
          <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('marketingLeadStatusUpdate')}>
            {revealedPrompts.marketingLeadStatusUpdate ? 'Hide prompt' : 'Edit prompt'}
          </button>
          {revealedPrompts.marketingLeadStatusUpdate && (
            <button type="button" className={styles.aiPromptBtnGhost} onClick={resetMarketingLeadStatusUpdatePrompt}>Reset to default</button>
          )}
          {marketingLeadStatusUpdateCopyFlash && <span className={styles.copyFlash}>{marketingLeadStatusUpdateCopyFlash}</span>}
        </div>
        <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Leads Subtab Status</th>
                <th>Marketing Leads Status (apply)</th>
              </tr>
            </thead>
            <tbody>
              {marketingLeadStatusRows.length === 0 ? (
                <tr className={styles.emptyRow}>
                  <td colSpan={4}>
                    {leadsSubtabStatusByName.size === 0
                      ? 'Paste the Salesforce Leads printable view into the BFO Activity page’s Leads subtab to compare statuses.'
                      : 'No status discrepancies — every matched lead already agrees with the Leads subtab.'}
                  </td>
                </tr>
              ) : marketingLeadStatusRows.map((l, i) => (
                <tr key={l.id || `${l.name}-${i}`}>
                  <td>{l.name || '—'}</td>
                  <td className={l.company ? '' : styles.muted}>{l.company || '—'}</td>
                  <td className={l.bfoStatus ? '' : styles.muted}>{l.bfoStatus || '—'}</td>
                  <td className={l.status ? '' : styles.muted}>{l.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(() => {
        // Build the BFO Address block from today's outbound emails, the
        // Called section, AND meetings marked on the Opps tab so the AI
        // prompt covers all three touch types in one pass. Dedupe by URL
        // so an opp that appears in several lists only gets one line —
        // meetings win over calls win over emails, so the strongest
        // touch is the one that gets logged.
        const lines = ['BFO Address'];
        const seen = new Set();
        for (const o of markedMeetingOpps) {
          if (!o.bfoUrl || seen.has(o.bfoUrl)) continue;
          lines.push(`${o.bfoUrl}: Type meeting`);
          seen.add(o.bfoUrl);
        }
        for (const o of calledOpps) {
          if (!o.bfoUrl || seen.has(o.bfoUrl)) continue;
          lines.push(`${o.bfoUrl}: Type called`);
          seen.add(o.bfoUrl);
        }
        for (const e of todaysOutbound) {
          if (!e.bfoUrl || seen.has(e.bfoUrl)) continue;
          lines.push(`${e.bfoUrl}: Type ${e.nextStepsType}`);
          seen.add(e.bfoUrl);
        }
        // Log the same email touch on any matched Marketing Lead's
        // Salesforce record too (see the master bundle for rationale).
        for (const e of todaysOutbound) {
          if (!e.leadSfUrl || seen.has(e.leadSfUrl)) continue;
          lines.push(`${e.leadSfUrl}: Type ${e.nextStepsType}`);
          seen.add(e.leadSfUrl);
        }
        const addressBlock = lines.join('\n');
        const fullPrompt = `${aiPrompt}\n\n${addressBlock}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setCopyFlash('Copied!');
          } catch {
            setCopyFlash('Copy failed');
          }
          window.setTimeout(() => setCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>AI Prompt (Activity)</h2>
            <p className={styles.subnote}>
              The past 2 business days&rsquo; BFO addresses (sent emails, calls, and meetings marked on the Opps tab) are appended automatically. When an email&rsquo;s external recipient matches a Marketing Lead (Contacts tab), that lead&rsquo;s Salesforce Link is appended too so the touch is logged on the lead as well. Click Copy to grab the full prompt for your AI assistant, or Edit prompt to tweak the wording.
            </p>
            {revealedPrompts.activity && (
              <textarea
                className={styles.aiPromptInput}
                value={aiPrompt}
                onChange={(e) => updateAiPrompt(e.target.value)}
                rows={12}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('activity')}>
                {revealedPrompts.activity ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.activity && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetAiPrompt}>Reset to default</button>
              )}
              {copyFlash && <span className={styles.copyFlash}>{copyFlash}</span>}
            </div>
            {revealedPrompts.activity && (
              <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
            )}
          </section>
        );
      })()}

      {(() => {
        // New BFO Opp prompt — table of qualifying opps the AI assistant
        // should create in BFO. The user only needs BFO Company Name and
        // Project Name in the pasted block; the rest of the fields stay
        // on the New BFO Opp table for review but are dropped from the
        // prompt to keep the AI focused.
        const header = 'BFO Company Name | Project Name | Product Line | Local Project Name';
        const lines = ['BFO Opportunities to Create', header];
        for (const o of newBfoOpps) {
          lines.push([
            o.bfoCompanyName,
            o.projectName,
            o.productLine,
            o.localProjectName,
          ].join(' | '));
        }
        const block = lines.join('\n');
        const fullPrompt = `${newBfoOppPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setNewBfoOppCopyFlash('Copied!');
          } catch {
            setNewBfoOppCopyFlash('Copy failed');
          }
          window.setTimeout(() => setNewBfoOppCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (New BFO Opp)
              <span className={styles.sectionCount}>{newBfoOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Lists Opps whose Stage is not Not Started / Not Sold / Sold and whose BFO Opportunity Name is &ldquo;-&rdquo; (the placeholder for opps that still need a BFO opp created). Blank or &ldquo;#N/A&rdquo; values are excluded.
            </p>
            {revealedPrompts.newBfoOpp && (
              <textarea
                className={styles.aiPromptInput}
                value={newBfoOppPrompt}
                onChange={(e) => updateNewBfoOppPrompt(e.target.value)}
                rows={12}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('newBfoOpp')}>
                {revealedPrompts.newBfoOpp ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.newBfoOpp && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetNewBfoOppPrompt}>Reset to default</button>
              )}
              {newBfoOppCopyFlash && <span className={styles.copyFlash}>{newBfoOppCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th>Company</th>
                    <th>BFO Company Name</th>
                    <th>Lead Source</th>
                    <th style={{ width: 110 }}>Current Customer</th>
                    <th>Scope</th>
                    <th style={{ width: 110 }}>Stage</th>
                    <th>Project Name</th>
                    <th>Product Line</th>
                    <th>Local Project Name</th>
                    <th>Type</th>
                    <th>Region</th>
                    <th>Class</th>
                    <th>Years</th>
                  </tr>
                </thead>
                <tbody>
                  {newBfoOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={14}>No Opps currently match (Stage ≠ Not Started / Not Sold / Sold and BFO Opportunity Name is &ldquo;-&rdquo;).</td>
                    </tr>
                  ) : newBfoOpps.map(o => {
                    const matchedProspect = prospectByNorm.get(normalizeCompany(o.company)) || null;
                    return (
                    <tr key={o.id}>
                      <td>
                        {o.raw && (
                          <button
                            type="button"
                            onClick={() => setInfoOpp(o.raw)}
                            title="Show opp info"
                            style={{
                              padding: 0, width: 22, height: 22, lineHeight: 1,
                              fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit',
                              color: 'var(--color-accent)', background: '#fff',
                              border: '1px solid var(--color-accent)', borderRadius: '50%',
                              cursor: 'pointer',
                            }}
                          >i</button>
                        )}
                      </td>
                      <td className={o.company && o.company !== '—' ? '' : styles.muted}>{o.company || '—'}</td>
                      <NewBfoCompanyNameCell
                        prospect={matchedProspect}
                        value={o.bfoCompanyName}
                        onCommit={(v) => updateProspect && matchedProspect && updateProspect(matchedProspect.id, { bfoCompanyName: v })}
                      />
                      <td className={o.leadSource && o.leadSource !== '—' ? '' : styles.muted}>{o.leadSource || '—'}</td>
                      <td>
                        <span style={{
                          padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
                          background: o.currentCustomer ? '#DCFCE7' : '#F1F5F9',
                          color: o.currentCustomer ? '#166534' : '#64748B',
                          border: `1px solid ${o.currentCustomer ? '#86EFAC' : '#CBD5E1'}`,
                        }}>{o.currentCustomer ? 'Yes' : 'No'}</span>
                      </td>
                      <td className={o.scope && o.scope !== '—' ? '' : styles.muted}>{o.scope || '—'}</td>
                      <td className={o.stage ? '' : styles.muted}>{o.stage || '—'}</td>
                      <td className={o.projectName ? '' : styles.muted}>{o.projectName || '—'}</td>
                      <td className={o.productLine ? '' : styles.muted}>{o.productLine || '—'}</td>
                      <td className={o.localProjectName ? '' : styles.muted}>{o.localProjectName || '—'}</td>
                      <td className={o.type ? '' : styles.muted}>{o.type || '—'}</td>
                      <td className={o.region ? '' : styles.muted}>{o.region || '—'}</td>
                      <td className={o.class ? '' : styles.muted}>{o.class || '—'}</td>
                      <td className={o.years ? '' : styles.muted}>{o.years || '—'}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
            {infoOpp && (
              <OppInfoModal
                opp={infoOpp}
                headers={oppsCache?.headers || []}
                onClose={() => setInfoOpp(null)}
              />
            )}
          </section>
        );
      })()}

      {(() => {
        // Close Dates prompt — a tab-delimited "Opportunity Name | New
        // Close Date" block the AI assistant can read row-by-row to
        // bump each opp's BFO Close Date 30 days out.
        const headerLine = 'Opportunity Name\tNew Close Date';
        const lines = [headerLine];
        for (const o of closeDateOpps) lines.push(`${o.name}\t${o.newClose}`);
        const block = lines.join('\n');
        const fullPrompt = `${closeDatesPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setCloseDatesCopyFlash('Copied!');
          } catch {
            setCloseDatesCopyFlash('Copy failed');
          }
          window.setTimeout(() => setCloseDatesCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Close Dates)
              <span className={styles.sectionCount}>{closeDateOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              BFO opps that should slip 30 days: Stage ≤ 4 with under 100 days to close, Stage 5 under 60 days, Stage 6 under 30 days. Stages come from the BFO Activity tab — paste fresh rows there if the list looks stale.
            </p>
            {revealedPrompts.closeDates && (
              <textarea
                className={styles.aiPromptInput}
                value={closeDatesPrompt}
                onChange={(e) => updateCloseDatesPrompt(e.target.value)}
                rows={10}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('closeDates')}>
                {revealedPrompts.closeDates ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.closeDates && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetCloseDatesPrompt}>Reset to default</button>
              )}
              {closeDatesCopyFlash && <span className={styles.copyFlash}>{closeDatesCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th style={{ width: 110 }}>Stage</th>
                    <th style={{ width: 120 }}>Current Close</th>
                    <th style={{ width: 90 }}>Days Out</th>
                    <th style={{ width: 130 }}>New Close Date</th>
                  </tr>
                </thead>
                <tbody>
                  {closeDateOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={5}>No BFO opps currently meet the close-date slip criteria. Confirm the BFO Activity tab has fresh data.</td>
                    </tr>
                  ) : closeDateOpps.map(o => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td>{o.stageLabel || `Stage ${o.stage}`}</td>
                      <td>{o.currentClose}</td>
                      <td>{o.daysOut}</td>
                      <td>{o.newClose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}

      {(() => {
        // Amount Updates prompt — for every BFO opp whose Amount disagrees
        // with the Opps tab's Quoted Amount, emit "BFO Address\tQuoted
        // Amount" so the AI assistant can open each link and bump the
        // BFO Unit Amount to match.
        const headerLine = 'BFO Address\tQuoted Amount';
        const lines = [headerLine];
        for (const o of amountUpdateOpps) lines.push(`${o.bfoUrl}\t${o.quotedAmountFmt}`);
        const block = lines.join('\n');
        const fullPrompt = `${amountUpdatesPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setAmountUpdatesCopyFlash('Copied!');
          } catch {
            setAmountUpdatesCopyFlash('Copy failed');
          }
          window.setTimeout(() => setAmountUpdatesCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Amount updates)
              <span className={styles.sectionCount}>{amountUpdateOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Opps whose BFO Amount disagrees with the Opps tab&rsquo;s Quoted Amount. Join key is BFO Opportunity Name. BFO amounts come from the BFO Activity tab — paste fresh rows there if the list looks stale.
            </p>
            {revealedPrompts.amountUpdates && (
              <textarea
                className={styles.aiPromptInput}
                value={amountUpdatesPrompt}
                onChange={(e) => updateAmountUpdatesPrompt(e.target.value)}
                rows={10}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('amountUpdates')}>
                {revealedPrompts.amountUpdates ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.amountUpdates && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetAmountUpdatesPrompt}>Reset to default</button>
              )}
              {amountUpdatesCopyFlash && <span className={styles.copyFlash}>{amountUpdatesCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th>Account</th>
                    <th style={{ width: 110 }}>Stage</th>
                    <th style={{ width: 120 }}>BFO Amount</th>
                    <th style={{ width: 120 }}>Quoted Amount</th>
                    <th style={{ width: 70 }}>BFO Link</th>
                  </tr>
                </thead>
                <tbody>
                  {amountUpdateOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={6}>No discrepancies — every BFO opp matched against the Opps tab has the same amount. Confirm the BFO Activity tab has fresh data if you expected mismatches.</td>
                    </tr>
                  ) : amountUpdateOpps.map(o => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td className={o.account ? '' : styles.muted}>{o.account || '—'}</td>
                      <td className={o.stage ? '' : styles.muted}>{o.stage || '—'}</td>
                      <td>{fmtMoney(o.bfoAmount)}</td>
                      <td>{o.quotedAmountFmt}</td>
                      <td>
                        <a href={o.bfoUrl} target="_blank" rel="noreferrer" className={styles.bfoLink}>Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}

      {(() => {
        // Stage Change prompt — every opp whose BFO Sales Stage doesn't
        // match what its current Opps 2 Stage maps to gets a
        // "BFO Link\tNew Stage" line so the AI assistant can update BFO.
        const headerLine = 'BFO Link\tNew Stage';
        const lines = [headerLine];
        for (const o of stageChangeOpps) lines.push(`${o.bfoUrl}\t${o.expectedBfoStage}`);
        const block = lines.join('\n');
        const fullPrompt = `${stageChangePrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setStageChangeCopyFlash('Copied!');
          } catch {
            setStageChangeCopyFlash('Copy failed');
          }
          window.setTimeout(() => setStageChangeCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Stage Change)
              <span className={styles.sectionCount}>{stageChangeOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Opps whose BFO Sales Stage doesn&rsquo;t match what their Opps Stage implies. Join key is BFO Opportunity Name. BFO stages come from the BFO Activity tab — paste fresh rows there if the list looks stale.
            </p>
            {revealedPrompts.stageChange && (
              <textarea
                className={styles.aiPromptInput}
                value={stageChangePrompt}
                onChange={(e) => updateStageChangePrompt(e.target.value)}
                rows={8}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('stageChange')}>
                {revealedPrompts.stageChange ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.stageChange && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetStageChangePrompt}>Reset to default</button>
              )}
              {stageChangeCopyFlash && <span className={styles.copyFlash}>{stageChangeCopyFlash}</span>}
            </div>
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th>Account</th>
                    <th>Opps Stage</th>
                    <th>BFO Stage (current)</th>
                    <th>New BFO Stage</th>
                    <th style={{ width: 70 }}>BFO Link</th>
                  </tr>
                </thead>
                <tbody>
                  {stageChangeOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={6}>No stage mismatches — every BFO opp matched against the Opps tab is on the BFO stage its Opps Stage maps to.</td>
                    </tr>
                  ) : stageChangeOpps.map(o => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td className={o.account ? '' : styles.muted}>{o.account || '—'}</td>
                      <td>{o.oppsStage}</td>
                      <td>{o.bfoStage}</td>
                      <td>{o.expectedBfoStage}</td>
                      <td>
                        <a href={o.bfoUrl} target="_blank" rel="noreferrer" className={styles.bfoLink}>Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}

      {(() => {
        // Close Not Solds prompt — every Not-Sold Opps 2 opp that's
        // still open on the BFO Activity tab. Output is a tab-delimited
        // "BFO Link\tStatus\tReason" block so the AI assistant can walk
        // each row and close it out. Rows without a known Reason Not
        // Sold mapping leave Status / Reason blank — surfaced in the
        // table so the user can act on them.
        const headerLine = 'BFO Link\tStatus\tReason';
        const lines = [headerLine];
        for (const o of closeNotSoldOpps) {
          if (o.unmapped) continue;
          lines.push(`${o.bfoUrl}\t${o.status}\t${o.reason}`);
        }
        const block = lines.join('\n');
        const fullPrompt = `${closeNotSoldsPrompt}\n\n${block}`;
        const onCopy = async () => {
          try {
            await navigator.clipboard.writeText(withBfoActivitySuffix(fullPrompt));
            setCloseNotSoldsCopyFlash('Copied!');
          } catch {
            setCloseNotSoldsCopyFlash('Copy failed');
          }
          window.setTimeout(() => setCloseNotSoldsCopyFlash(''), 1500);
        };
        const unmappedCount = closeNotSoldOpps.filter(o => o.unmapped).length;
        const readyCount = closeNotSoldOpps.length - unmappedCount;
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>
              AI Prompt (Close Not Solds)
              <span className={styles.sectionCount}>{closeNotSoldOpps.length}</span>
            </h2>
            <p className={styles.subnote}>
              Not-Sold Opps rows that still have a matching BFO Activity row. Status + Reason come from the Reason Not Sold → BFO mapping. Rows whose Reason Not Sold isn&rsquo;t in the mapping table are listed (highlighted) so you can update them on Opps or extend the mapping.
            </p>
            {revealedPrompts.closeNotSolds && (
              <textarea
                className={styles.aiPromptInput}
                value={closeNotSoldsPrompt}
                onChange={(e) => updateCloseNotSoldsPrompt(e.target.value)}
                rows={10}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('closeNotSolds')}>
                {revealedPrompts.closeNotSolds ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.closeNotSolds && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetCloseNotSoldsPrompt}>Reset to default</button>
              )}
              {closeNotSoldsCopyFlash && <span className={styles.copyFlash}>{closeNotSoldsCopyFlash}</span>}
            </div>
            {closeNotSoldOpps.length > 0 && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#64748B' }}>
                {readyCount} ready · {unmappedCount} need a mapped Reason Not Sold (excluded from the prompt block below).
              </div>
            )}
            <div style={{ marginTop: '0.5rem', overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Opportunity Name</th>
                    <th>Account</th>
                    <th>Reason Not Sold</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th style={{ width: 70 }}>BFO Link</th>
                  </tr>
                </thead>
                <tbody>
                  {closeNotSoldOpps.length === 0 ? (
                    <tr className={styles.emptyRow}>
                      <td colSpan={6}>No Not-Sold opps with a matching BFO Activity row. Paste fresh BFO Activity data if you expected matches.</td>
                    </tr>
                  ) : closeNotSoldOpps.map(o => (
                    <tr key={o.id} style={o.unmapped ? { background: '#FEF3C7' } : undefined}>
                      <td className={o.name ? '' : styles.missing}>{o.name || 'Missing'}</td>
                      <td className={o.account ? '' : styles.missing}>{o.account || 'Missing'}</td>
                      <td className={o.reasonNotSold ? '' : styles.missing}>{o.reasonNotSold || 'Missing'}</td>
                      <td className={o.status ? '' : styles.missing}>{o.status || (o.unmapped ? 'Missing (unmapped reason)' : 'Missing')}</td>
                      <td className={o.reason ? '' : styles.missing}>{o.reason || (o.unmapped ? 'Missing (unmapped reason)' : 'Missing')}</td>
                      <td className={o.bfoUrl ? '' : styles.missing}>
                        {o.bfoUrl ? (
                          <a href={o.bfoUrl} target="_blank" rel="noreferrer" className={styles.bfoLink}>Open</a>
                        ) : 'Missing'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}
      {(() => {
        const fullPrompt = updateBfoActivityPrompt;
        const onCopy = async () => {
          try {
            // This prompt is itself the suffix, so copy it as-is (no
            // double-append).
            await navigator.clipboard.writeText(fullPrompt);
            setUpdateBfoActivityCopyFlash('Copied!');
          } catch {
            setUpdateBfoActivityCopyFlash('Copy failed');
          }
          window.setTimeout(() => setUpdateBfoActivityCopyFlash(''), 1500);
        };
        return (
          <section className={styles.section}>
            <h2 className={styles.sectionHeader}>AI Prompt (Update BFO Activity)</h2>
            <p className={styles.subnote}>
              Appended to the end of every prompt copy on this page (and &ldquo;Copy all prompts&rdquo;) so the assistant finishes by re-pulling the BFO Opportunity list into the BFO Activity tab. You can copy it on its own here too.
            </p>
            {revealedPrompts.updateBfoActivity && (
              <textarea
                className={styles.aiPromptInput}
                value={updateBfoActivityPrompt}
                onChange={(e) => updateUpdateBfoActivityPrompt(e.target.value)}
                rows={8}
                spellCheck={false}
              />
            )}
            <div className={styles.aiPromptControls}>
              <button type="button" className={styles.aiPromptBtn} onClick={onCopy}>Copy full prompt</button>
              <button type="button" className={styles.aiPromptBtnGhost} onClick={() => togglePrompt('updateBfoActivity')}>
                {revealedPrompts.updateBfoActivity ? 'Hide prompt' : 'Edit prompt'}
              </button>
              {revealedPrompts.updateBfoActivity && (
                <button type="button" className={styles.aiPromptBtnGhost} onClick={resetUpdateBfoActivityPrompt}>Reset to default</button>
              )}
              {updateBfoActivityCopyFlash && <span className={styles.copyFlash}>{updateBfoActivityCopyFlash}</span>}
            </div>
            <pre className={styles.aiPromptPreview}>{fullPrompt}</pre>
          </section>
        );
      })()}
      </>)}
    </div>
  );
}
````

### src/components/AgentsView/AgentsView.module.css

````css
.wrap {
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: 100%;
  overflow: auto;
}

.header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.title {
  font-size: 1.4rem;
  font-weight: 700;
  color: #0F172A;
  margin: 0;
}

.dateline {
  font-size: 0.85rem;
  color: #64748B;
  font-weight: 600;
}

.dateField {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: #475569;
}

.hideActivityField {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.dateInput {
  padding: 0.25rem 0.4rem;
  font-size: 0.8rem;
  font-family: inherit;
  border: 1px solid #CBD5E1;
  border-radius: 6px;
  background: #FFFFFF;
  color: #0F172A;
}

.dateInput:focus {
  outline: 2px solid #93C5FD;
  outline-offset: 1px;
}

.dateResetBtn {
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  font-family: inherit;
  color: #1E40AF;
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
  border-radius: 6px;
  cursor: pointer;
}

.dateResetBtn:hover {
  background: #DBEAFE;
}

.refreshActivityBtn {
  margin-left: auto;
  padding: 0.35rem 0.75rem;
  font-size: 0.78rem;
  font-weight: 600;
  font-family: inherit;
  color: #1E40AF;
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
  border-radius: 6px;
  cursor: pointer;
}

.refreshActivityBtn:hover:not(:disabled) {
  background: #DBEAFE;
}

.refreshActivityBtn:disabled {
  cursor: wait;
  opacity: 0.75;
}

.subnote {
  margin: 0;
  color: #64748B;
  font-size: 0.85rem;
}

.tallies {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.tally {
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 6px;
  padding: 0.4rem 0.7rem;
  font-size: 0.78rem;
  color: #475569;
}

.tally strong {
  color: #0F172A;
  font-size: 0.95rem;
  margin-right: 0.3rem;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.sectionHeader {
  font-size: 0.95rem;
  font-weight: 700;
  color: #0F172A;
  margin: 0.5rem 0 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sectionCount {
  font-size: 0.75rem;
  color: #64748B;
  font-weight: 600;
  background: #F1F5F9;
  border: 1px solid #E2E8F0;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
}

.table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid #E2E8F0;
  border-radius: 6px;
  overflow: hidden;
}

.table th {
  text-align: left;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #475569;
  background: #F8FAFC;
  padding: 0.45rem 0.7rem;
  border-bottom: 1px solid #E2E8F0;
  white-space: nowrap;
}

.table td {
  font-size: 0.82rem;
  color: #1E293B;
  padding: 0.45rem 0.7rem;
  border-bottom: 1px solid #F1F5F9;
  vertical-align: top;
}

.table tr:last-child td {
  border-bottom: none;
}

.muted {
  color: #94A3B8;
}

.missing {
  background: #FEE2E2;
  color: #991B1B;
  font-weight: 600;
}

.emptyRow td {
  text-align: center;
  color: #64748B;
  font-style: italic;
  padding: 0.85rem;
}

.empty {
  padding: 1.25rem;
  text-align: center;
  background: #F8FAFC;
  border: 1px dashed #CBD5E1;
  border-radius: 6px;
  color: #64748B;
  font-size: 0.85rem;
}

.staleBanner {
  padding: 0.55rem 0.8rem;
  background: #FEF3C7;
  border: 1px solid #FDE68A;
  color: #92400E;
  border-radius: 6px;
  font-size: 0.78rem;
}

/* Red error banner — data the AI prompts need is missing (e.g. New BFO
   Opp rows with no Product Line / Region / BFO Company Name). */
.errorBanner {
  padding: 0.55rem 0.8rem;
  background: #FEE2E2;
  border: 1px solid #FCA5A5;
  color: #991B1B;
  border-radius: 6px;
  font-size: 0.78rem;
}

.pill {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  white-space: nowrap;
}

.pillOutbound {
  background: #DCFCE7;
  color: #166534;
  border: 1px solid #86EFAC;
}

.pillInbound {
  background: #DBEAFE;
  color: #1E40AF;
  border: 1px solid #93C5FD;
}

.pickerWrap {
  position: relative;
  display: inline-block;
  width: 100%;
}

.pickerTrigger {
  font-size: 0.7rem;
  color: #2563EB;
  border: 1px dashed #93C5FD;
  background: #EFF6FF;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
}

.pickerTrigger:hover {
  background: #DBEAFE;
}

.pickerInput {
  width: 100%;
  font-size: 0.78rem;
  border: 1px solid #93C5FD;
  border-radius: 5px;
  padding: 0.25rem 0.45rem;
  font-family: inherit;
  background: #fff;
  color: #0F172A;
}

.pickerInput:focus {
  outline: none;
  border-color: #2563EB;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.pickerMenu {
  /* Rendered in a portal with fixed positioning (top/left/width set
     inline) so it floats above the page and isn't clipped by the
     table's scroll wrapper. */
  z-index: 1000;
  background: #fff;
  border: 1px solid #CBD5E1;
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.12);
  overflow-y: auto;
  padding: 0.2rem 0;
}

.pickerOption {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: 0.35rem 0.6rem;
  font-size: 0.76rem;
  color: #1E293B;
  cursor: pointer;
  font-family: inherit;
  line-height: 1.3;
}

.pickerOption:hover,
.pickerOption:focus {
  background: #EFF6FF;
  outline: none;
}

.pickerOptionAccount {
  display: block;
  font-size: 0.66rem;
  color: #64748B;
  margin-top: 1px;
}

.pickerEmpty {
  padding: 0.5rem 0.6rem;
  font-size: 0.72rem;
  color: #94A3B8;
  font-style: italic;
}

.overrideValue {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.overrideClear {
  font-size: 0.65rem;
  color: #94A3B8;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0 0.2rem;
  font-family: inherit;
}

.overrideClear:hover {
  color: #DC2626;
}

.ignoreBtn {
  font-size: 0.75rem;
  color: #94A3B8;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0 0.3rem;
  font-family: inherit;
}

.ignoreBtn:hover {
  color: #DC2626;
}

.ignoreBtn:disabled {
  opacity: 0.4;
  cursor: default;
}

.ignoreBtn:disabled:hover {
  color: #94A3B8;
}

.actionsCell {
  white-space: nowrap;
}

.linkBtn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--color-accent, #2563eb);
  text-decoration: underline;
  cursor: pointer;
}

.bfoLink {
  color: var(--color-accent, #2563eb);
  text-decoration: underline;
  font-size: var(--font-size-xs);
}

.bfoLink:hover {
  text-decoration: none;
}

.aiPromptInput {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--font-size-sm);
  line-height: 1.45;
  resize: vertical;
  min-height: 12rem;
}

.aiPromptInput:focus {
  outline: none;
  border-color: var(--color-accent);
}

.aiPromptControls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.aiPromptBtn {
  padding: 0.4rem 0.85rem;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: #fff;
  font-family: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.aiPromptBtn:hover {
  filter: brightness(0.95);
}

.aiPromptBtnGhost {
  padding: 0.4rem 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.aiPromptBtnGhost:hover {
  border-color: var(--color-accent);
}

.copyFlash {
  font-size: var(--font-size-xs);
  color: #16a34a;
  font-weight: 600;
}

.aiPromptPreview {
  margin-top: 0.75rem;
  padding: 0.75rem 0.9rem;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: #f8fafc;
  color: var(--color-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 24rem;
  overflow: auto;
}

/* "BFO Opportunity Name not tagged to an opp on Opps" warning — mirrored
   from the BFO Activity page so the same tagging widget shows here. */
.bfoAssignFlash {
  padding: 0.35rem 0.6rem;
  border-radius: var(--radius-sm);
  background: #d1fae5;
  border: 1px solid #34d399;
  color: #065f46;
  font-size: var(--font-size-xs);
}

.warning {
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  background: #fef3c7;
  border: 1px solid #f59e0b;
  color: #92400e;
  font-size: var(--font-size-xs);
  line-height: 1.4;
}

.warningHint {
  margin-top: 0.2rem;
  color: #b45309;
  opacity: 0.9;
}

.warnList {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 16rem;
  overflow-y: auto;
}

.warnItem {
  padding-top: 0.5rem;
  border-top: 1px solid rgba(180, 83, 9, 0.25);
}

.warnName {
  margin-bottom: 0.3rem;
}

.warnNameText {
  font-weight: 600;
}

.warnAcct {
  color: #b45309;
  font-weight: 500;
}

.warnNone {
  font-style: italic;
  color: #b45309;
  opacity: 0.85;
}

.warnChips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.assignChip {
  border: 1px solid #f59e0b;
  background: #fffbeb;
  color: #92400e;
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  font-size: var(--font-size-xs);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.assignChip:hover:not(:disabled) {
  background: #fde68a;
}

.assignChip:disabled {
  opacity: 0.5;
  cursor: default;
}

/* --- Agents page sub-tab nav (Automations / Prompt Library) --- */
.subTabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid #E2E8F0;
  margin-bottom: 0.25rem;
}

.subTab,
.subTabActive {
  padding: 0.45rem 0.9rem;
  font-size: 0.85rem;
  font-weight: 600;
  font-family: inherit;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: #64748B;
  cursor: pointer;
  margin-bottom: -1px;
}

.subTab:hover {
  color: #1E40AF;
}

.subTabActive {
  color: #1E40AF;
  border-bottom-color: #2563EB;
}

/* --- Prompt Library sub-tab --- */
.promptLib {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.promptLibToolbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.promptSearch {
  flex: 1 1 14rem;
  max-width: 22rem;
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
  font-family: inherit;
  border: 1px solid #CBD5E1;
  border-radius: 6px;
  background: #fff;
  color: #0F172A;
}

.promptSearch:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.promptCard {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.85rem 1rem;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  background: #fff;
}

.promptCardHead {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.promptCardTitle {
  font-size: 1rem;
  font-weight: 700;
  color: #0F172A;
  margin: 0;
  flex: 1 1 auto;
}

.promptCardActions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.promptReorder {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}

.promptMoveBtn {
  padding: 0 0.4rem;
  line-height: 1.2;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg, #fff);
  color: var(--color-text, #0F172A);
  font-size: 0.6rem;
  cursor: pointer;
}

.promptMoveBtn:hover:not(:disabled) {
  border-color: var(--color-accent);
}

.promptMoveBtn:disabled {
  opacity: 0.35;
  cursor: default;
}

.promptForm {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.promptTitleInput {
  width: 100%;
  padding: 0.5rem 0.7rem;
  font-size: 0.9rem;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
}

.promptTitleInput:focus {
  outline: none;
  border-color: var(--color-accent);
}

.copyFlashErr {
  font-size: var(--font-size-xs);
  color: #dc2626;
  font-weight: 600;
}
````

### src/components/OppsView2/OppsView2.jsx

````jsx
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { doc, collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { ContactEditModal } from '../ProspectModal/ProspectModal';
import { toggleContactInEvents } from '../../utils/eventsStore';
import { DataTable } from '../common/DataTable';
import {
  buildListRegistry,
  buildAvailableLists,
  parseMulti,
  resolveColumnLink as resolveSharedColumnLink,
  SelectCell,
  MultiSelectCell,
  LinkColumnsModal,
} from '../common/columnLinks';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { dbGet } from '../../utils/db';
import {
  OPPS2_FIRESTORE_COLLECTION,
  loadOpps2Cache,
  saveOpps2Cache,
  loadOpps2FromFirestore,
  saveOpps2ToFirestore,
  trySaveOpps2ToFirestore,
  flushOpps2ToFirestore,
  mergeOpps2Datasets,
} from '../../utils/opps2Store';
import { pushOpps2Backup } from '../../utils/opps2Backup';
import { loadOptionLinks, setOppOptionLink, OPTION_LINKS_EVENT } from '../../utils/pricingOptionLinks';
import { OPPS_PRICING_SNAPSHOT_EVENT } from '../../utils/oppsPricingSnapshot';
import { fmtMoneyWhole, toNum, unitCountOrOne, rowYearRevenue } from '../../utils/pricingOptionCalc';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';
import { normalizeCompany } from '../../utils/companyNorm';
import { userLsGet, userLsSet } from '../../utils/userLs';
import { computeListFlags } from '../../utils/listFlags';
import { splitPeOwners, joinPeOwners } from '../../utils/peOwners';
import { TYPES, FRAMEWORKS } from '../../data/enums';
import { NewOppsScheduleModal } from './NewOppsScheduleModal';
import { downloadNewOppsOutlookDraft } from '../../utils/newOppsDigestEmail';
import { DEFAULT_EMAIL_SIGNATURE } from '../../data/emailSignature';
import { buildNewOppsTableHtml, downloadOppsTableOutlookDraft, NEW_OPPS_EMAIL_COLUMNS, NEW_OPPS_EMAIL_DEFAULT_COLUMN_KEYS } from '../../utils/newOppsEmailTable';
import styles from './OppsView2.module.css';

// Second Opps tab — user-entered opps stored in Firestore
// (`opps2Data/{uid}`) with an IndexedDB cache (`opps2-cache`, key
// `data`) for instant rehydration on reload. The original Opps tab
// stays the canonical Google Sheets view; Opps 2 is the place the
// user types new opps directly into the app.

// Opps 2 persistence (IndexedDB cache + chunked Firestore doc) lives in
// utils/opps2Store.js so other views can read/write through the same
// path; see the imports above.

// Detail-row visibility. The Opp details popup lets the user hide rows
// (header fields) they don't care to see. The choice is a single global
// preference applied to *every* opp's detail view (not per-opp) and is
// persisted in user-scoped localStorage so it survives reloads and is
// shared across the Opps 2 and Agents detail popups. Stored as a JSON
// array of field names.
const OPP_DETAIL_HIDDEN_FIELDS_KEY = 'opp-detail-hidden-fields';

// Per-user localStorage key holding the "No Further Action Today" clear
// schedules — one per mark type. These replace the old fixed
// start-of-day blank-all + 2 PM X sweep with user-configured
// day-of-week + time schedules set from the toolbar button.
const NFAT_SCHEDULES_KEY = 'opps2-nfat-schedules';

// The three things a schedule can clear from the tristate column:
// ✓ checks, ✗ X marks, or any non-blank value. Each gets its own
// independent schedule (days of week + time of day).
const NFAT_SCHEDULE_TYPES = ['check', 'x', 'any'];
const NFAT_TYPE_LABELS = { check: '✓ Check marks', x: '✗ X marks', any: 'Any value' };

function defaultNfatSchedules() {
  const base = { enabled: false, days: [1, 2, 3, 4, 5], time: '06:00', lastRunAt: 0 };
  return { check: { ...base }, x: { ...base }, any: { ...base } };
}

// Load the saved schedules, merged onto defaults so a partial/older
// stored shape still yields a complete config for every type.
function loadNfatSchedules() {
  const def = defaultNfatSchedules();
  try {
    const raw = userLsGet(NFAT_SCHEDULES_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw);
    for (const t of NFAT_SCHEDULE_TYPES) {
      if (parsed && parsed[t]) def[t] = { ...def[t], ...parsed[t] };
    }
  } catch { /* fall back to defaults */ }
  return def;
}

// True when the tristate "No Further Action Today" value matches the
// clear type: 'check' for ✓/yes, 'x' for ✗/no, 'any' for anything set.
function nfatValueMatches(value, type) {
  const cur = String(value || '').trim().toLowerCase();
  if (cur === '') return false;
  if (type === 'any') return true;
  if (type === 'check') return cur === 'yes' || cur === 'true' || cur === '✓';
  if (type === 'x') return cur === 'no' || cur === 'false' || cur === '✗';
  return false;
}

function loadHiddenDetailFields() {
  try {
    const raw = userLsGet(OPP_DETAIL_HIDDEN_FIELDS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : []);
  } catch { return new Set(); }
}

function saveHiddenDetailFields(set) {
  try { userLsSet(OPP_DETAIL_HIDDEN_FIELDS_KEY, JSON.stringify([...set])); }
  catch (err) { console.warn('opps2: save hidden detail fields failed', err); }
}

// Default column set, seeded so the table has columns to show / sort /
// filter / hide / resize even before any data exists.
const DEFAULT_HEADERS = [
  'Account', 'Open Year', 'Contact', 'Stage', 'Scope', 'Source', 'Type', 'Sales Partner',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Last Spoke', 'Follow Up', 'Call In', 'Notes',
  'Next Steps', 'No Further Action Today', 'Competition', 'Waiting On', 'Close Date', 'BFO Link', 'BFO Company Name',
  'Pricing Option',
  // Quote-stage detail columns. Captured via the QuotedFollowUpModal that
  // pops when an opp moves into the "Quoted" stage.
  'Quoted On', 'Chance?', 'Margin Email Date - Sales Leader Review Date',
];

// Key columns to show by default (the rest are available via Columns toggle)
const KEY_COLS = [
  'Account', 'Contact', 'Stage', 'Scope', 'Source', 'Type', 'Sales Partner',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Last Spoke', 'Follow Up', 'Call In', 'Notes',
  'Next Steps', 'No Further Action Today', 'Competition', 'Waiting On', 'Close Date',
];

// Three-state-checkbox columns. Each cell click cycles
// blank → "Yes" (renders ✓) → "No" (renders ✗) → blank. Stored as
// the literal string so existing string-based filters / exports /
// downstream consumers still work without special handling.
const TRISTATE_COLUMNS = new Set(['No Further Action Today']);

// On-screen display label for an opp column key. The underlying data keys
// stay stable (so stored records, dedup, currency formatting and the stage
// prompts keep working); only the header text the user sees changes. The
// "BFO Link" key reads as "BFO Opportunity Name" and "Quoted Amount" reads
// as "Deal Size".
const HEADER_LABEL_OVERRIDES = {
  'BFO Link': 'BFO Opportunity Name',
  'Quoted Amount': 'Deal Size',
  // The rich per-step column ('Next Steps') reads as "Notes"; the older
  // plain 'Notes' field reads as "Memo" so the two headers don't clash.
  'Next Steps': 'Notes',
  'Notes': 'Memo',
};
function headerLabel(h) {
  return HEADER_LABEL_OVERRIDES[h] || h;
}

// Columns the user wants treated as dates — rendered with a calendar
// popup cell (HTML5 date input) and pre-populated with today on new
// opps so a fresh entry shows useful defaults instead of blanks.
const DATE_COLUMNS = new Set([
  'Start Date', 'Last Client Heard From Us', 'Follow Up',
  // Quote-stage dates, filled from the QuotedFollowUpModal.
  'Quoted On', 'Margin Email Date - Sales Leader Review Date',
]);

// Date columns that should be pre-seeded with today's date on a brand-new
// opp. The quote-stage dates are deliberately excluded — they stay blank
// until the opp actually reaches the Quoted stage.
const SEED_TODAY_DATE_COLUMNS = new Set(['Start Date', 'Last Client Heard From Us', 'Follow Up']);

// "New Opps" report — the actively-working, freshly-progressing opps
// surfaced in the New Opps subtab and the auto-emailed digest. An opp
// qualifies when it has a BFO Opportunity Name, its current Stage is Lead,
// Qualifying, or Quoting (which also excludes "Not Started"), and its
// *combined* time across the Lead + Qualifying + Quoting stages is at most
// NEW_OPPS_MAX_STAGE_AGE_DAYS days. These column keys drive the on-screen
// subtab and its Excel export; the emailed table uses its own fixed set
// (NEW_OPPS_EMAIL_COLUMNS in api/_lib/newOpps.js). "BFO Link" stores the
// BFO Opportunity Name; "BFO Address" is the live Salesforce URL.
const NEW_OPPS_MAX_STAGE_AGE_DAYS = 7;
const NEW_OPPS_ACTIVE_STAGES = ['Lead', 'Qualifying', 'Quoting'];
const NEW_OPPS_ACTIVE_STAGES_SET = new Set(NEW_OPPS_ACTIVE_STAGES);
const NEW_OPPS_REPORT_COLUMNS = [
  'Account', 'Open Year', 'Contact', 'Stage', 'Scope', 'Source', 'Type',
  'Sales Partner', 'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Next Steps',
  'BFO Link', 'BFO Address',
];

const MONTH_FULL_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Parse a free-text Close Date into a Date. Accepts ISO (2026-06-01)
// and locale/US (6/1/2026, "June 1, 2026") entries. Returns null when
// the text isn't a recognizable date so a typo never clobbers the
// derived Close Year / Close Month columns.
function parseCloseDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const ts = Date.parse(s);
  if (Number.isNaN(ts)) return null;
  const d = new Date(ts);
  // Date.parse reads a bare ISO date (YYYY-MM-DD) as UTC midnight, which
  // can land on the previous day in a negative-offset timezone. Pull the
  // UTC parts back for ISO strings; slash/locale strings parse as local
  // so getFullYear/getMonth are already correct there.
  if (/^\d{4}-\d{2}/.test(s)) return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return d;
}

// Locate the "Close Year" / "Close Month" columns to auto-fill from a
// Close Date. Matched loosely (Close/Closed, optional space) so it works
// regardless of the exact label in the user's imported headers.
const CLOSE_YEAR_RE = /^closed?\s*year$/;
const CLOSE_MONTH_RE = /^closed?\s*month$/;
function findCloseDerivedColumns(headers) {
  const yearCols = [];
  const monthCols = [];
  for (const h of (headers || [])) {
    const norm = String(h || '').trim().toLowerCase();
    if (CLOSE_YEAR_RE.test(norm)) yearCols.push(h);
    else if (CLOSE_MONTH_RE.test(norm)) monthCols.push(h);
  }
  return { yearCols, monthCols };
}

// Stages the Days-in-Stage tab reports on. Ordered to mirror the
// pipeline progression so a row stays under one bucket as it moves
// forward. Closed stages (Sold / Not Sold) are intentionally excluded
// — the tab tracks how long active opps are stalling in each step.
const TRACKED_STAGES = ['Not Started', 'Lead', 'Qualifying', 'Quoting', 'Quoted', 'Contracting', 'Agreement Sent'];
const TRACKED_STAGES_SET = new Set(TRACKED_STAGES);

// Closed (won/lost) stages — an opp in one of these is no longer active.
// Mirrors the in-component CLOSED_STAGES used by the activity filter.
const CLOSED_STAGES_SET = new Set(['Sold', 'Not Sold']);

// Stage-specific "stalled too long" thresholds. An opp that has sat in
// one of these stages for more than `days` calendar days surfaces in the
// Days-in-Stage "Needs action" buckets with the paired suggestion. Stages
// not listed (Not Started, Quoting, Contracting, Agreement Sent) have no
// threshold, so they never raise an action prompt. Not Started is
// intentionally excluded — a brand-new opp shouldn't nag to qualify-or-kill.
const STAGE_ACTION_THRESHOLDS = {
  'Lead':        { days: 90,  suggestion: 'Qualify or kill' },
  'Qualifying':  { days: 60,  suggestion: 'Quote or kill' },
  'Quoted':      { days: 90,  suggestion: 'Contract or kill' },
};

// Pull-through opps ride along with a parent sale rather than running
// their own pipeline, so they're excluded from the Days-in-Stage view.
// Matched on the Scope text, mirroring PipelineView's close-rate filter.
const PULL_THROUGH_RE = /pull[\s-]?through/i;

// The stage-action rule an opp has tripped, or null if it's within the
// limit (or its stage has no limit). Shared by the kanban so flagged opps
// can render inline with their suggestion instead of in a separate list.
function stageActionFor(stage, days) {
  const rule = STAGE_ACTION_THRESHOLDS[stage];
  if (!rule || days == null || days <= rule.days) return null;
  return rule;
}

// Read-only columns whose value is derived from other cells.
//   Call In    = calendar days from today to the Follow Up date
//   Last Spoke = business days from Last Client Heard From Us to today
// Always append these to header sets loaded from the legacy Opps cache
// so they show up even when the cached headers predate the columns.
const COMPUTED_COLUMNS = ['Last Spoke', 'Call In'];

// Columns that should always be present on hydration even when the
// saved header set predates them. Includes the computed columns
// plus Next Steps (introduced after the original layout shipped) so
// users who saved their layout before this column existed still pick
// it up — and its "Find out the Story" default lands somewhere
// visible on the next new opp.
const ENSURED_COLUMNS = [...COMPUTED_COLUMNS, 'Next Steps', 'Pricing Option', 'No Further Action Today', 'Sales Partner',
  'Quoted On', 'Chance?', 'Margin Email Date - Sales Leader Review Date', 'BFO Company Name', 'PE Owner'];

// Strips zero-width / BOM characters. Built with fromCharCode so the
// source stays pure ASCII — embedding the literal invisible characters
// (or relying on \u escapes that tooling can mangle) is fragile.
const ZERO_WIDTH_RE = new RegExp([0x200B, 0x200C, 0x200D, 0xFEFF].map(c => String.fromCharCode(c)).join('|'), 'g');

// Normalize a cell value for matching: drop zero-width chars, trim, and
// casefold. Imported or pasted opps sometimes carry invisible characters
// or odd casing (e.g. a trailing zero-width space) that would otherwise
// dodge an exact string match even though the cell *looks* right in the UI.
function normCell(s) {
  return String(s ?? '').replace(ZERO_WIDTH_RE, '').trim().toLowerCase();
}

// The Flags column carries the auto USD 🚩. Match the header tolerantly
// (casing / whitespace / invisible chars, "Flag" or "Flags") so the
// indicator still renders if the saved column name isn't an exact
// "Flags" — otherwise the cell falls back to a plain text editor and the
// flag never shows.
function isFlagsColumn(h) {
  const n = normCell(h);
  return n === 'flags' || n === 'flag';
}

// Stages at or before Lead — these never warrant a USD value, so they
// never flag. Everything else (Qualifying, Quoting, Quoted, Contracting,
// Agreement Sent, Repricing, Sold, Not Sold, plus any future / legacy
// stage label) counts as "past Lead". Using an exclusion list rather than
// an allow list means an unexpected stage name still flags, matching the
// rule "anything past a Lead stage".
const STAGES_AT_OR_BEFORE_LEAD = new Set(['lead', 'not started', 'duplicate opp']);

// True when a row has progressed past Lead but the (often hidden) `USD?`
// column has no real value — blank, or just a dash / currency placeholder
// like "-", "—", "$-", or " - ". Stripping zero-width chars, currency
// symbols, commas, whitespace and every dash variant leaves an empty
// string only when there's no actual number behind it; a real figure such
// as "-500" or "$1,500" survives and won't flag. Surfaced as a 🚩 in the
// Flags column so the gap is visible at a glance without unhiding USD?.
function needsUsdFlag(row) {
  if (!row) return false;
  const stage = normCell(row['Stage']);
  if (!stage || STAGES_AT_OR_BEFORE_LEAD.has(stage)) return false;
  const usd = String(row['USD?'] ?? '')
    .replace(ZERO_WIDTH_RE, '')
    .replace(/[\s$,]/g, '')
    .replace(/[-–—−]/g, '');
  return usd === '';
}

// Record-level merge lives in opps2Store as `mergeOpps2Datasets` so the
// real-time listener, hydration reconcile, and the guarded flush all
// resolve conflicts identically (field-level by `_fieldUpdatedAt`).

// Build the `_fieldUpdatedAt` map for an edit: carry the row's prior
// per-field stamps forward and set `now` on every field that changed
// between `prev` and `next`. Lets the merge resolve concurrent edits to
// different fields of the same opp without one clobbering the other.
function stampChangedFields(prev, next, now) {
  const stamps = { ...(prev._fieldUpdatedAt || {}) };
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (k === '_fieldUpdatedAt' || k === '_rowUpdatedAt') continue;
    if (next[k] !== prev[k]) stamps[k] = now;
  }
  return stamps;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Normalize a user-entered Quoted Amount to "$25,000" — USD currency
// with thousands separators and no decimals. Anything that doesn't
// parse to a number (empty, or legacy free-text like "TBD") is returned
// trimmed and unchanged so it isn't silently wiped.
function formatQuotedAmount(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  // Drop currency symbols, commas, and spaces; keep digits, sign, dot.
  const cleaned = s.replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  if (cleaned === '' || !Number.isFinite(n)) return s;
  return fmtMoneyWhole(Math.round(n));
}

// Live-format the Amount field as the user types in the Quoted Amount
// popup, so the "$" and thousands separators appear on the fly (e.g.
// typing "25000" shows "$25,000"). Keeps a trailing decimal point and
// cents the user is mid-entering. Non-numeric free text (e.g. "TBD") is
// passed through untouched so legacy values stay editable.
function formatQuotedAmountLive(raw) {
  const s = String(raw ?? '');
  if (!s.trim()) return '';
  // Keep only digits and decimal points; drop "$", commas, spaces, etc.
  const cleaned = s.replace(/[^0-9.]/g, '');
  if (cleaned === '') return s.trim(); // free text like "TBD" — leave it
  const firstDot = cleaned.indexOf('.');
  const hasDot = firstDot !== -1;
  let intPart = hasDot ? cleaned.slice(0, firstDot) : cleaned;
  // Collapse any extra decimal points and cap cents at two digits.
  const decPart = hasDot ? cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2) : '';
  intPart = intPart.replace(/^0+(?=\d)/, ''); // trim leading zeros
  const withCommas = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${withCommas}${hasDot ? `.${decPart}` : ''}`;
}

function makeBlankOpp(id, headers, accountOverride, sourceOverride, peOwnerOverride) {
  const row = { _id: id, id, _rowUpdatedAt: Date.now() }; // id mirrored so DataTable's row key stays stable across edits
  const cols = (Array.isArray(headers) && headers.length) ? headers : DEFAULT_HEADERS;
  for (const h of cols) row[h] = '';
  // Leave Account blank when there's no override so the inline cell
  // autocomplete (fed from Table View companies) starts surfacing
  // matches the moment the user types — instead of having to first
  // clear a placeholder string.
  row['Account'] = typeof accountOverride === 'string' && accountOverride.trim() ? accountOverride.trim() : '';
  row['Open Year'] = String(new Date().getFullYear());
  row['Stage'] = 'Not Started';
  row['Status'] = 'Client waiting on ESS team member';
  // Default Scope to AEM (the most common service the user tags on a
  // new opp) and seed the Next Steps column with the prompt the user
  // always types first. Set unconditionally — even if a column was
  // hidden via the columns toggle the value sticks around for when
  // it's unhidden later.
  row['Scope'] = 'AEM';
  row['Next Steps'] = 'Find out the Story';
  // Seed the BFO Opportunity Name (BFO Link) column with a dash so a
  // brand-new opp reads as "BFO opp still needs to be created" — the
  // same sentinel the rest of the app uses for untagged opps. Set
  // unconditionally so the value sticks even when the column is hidden.
  row['BFO Link'] = '-';
  // Source comes from the New Opp prompt — leave blank when the user
  // skipped the picker so the cell still surfaces its dropdown on
  // click.
  if (typeof sourceOverride === 'string' && sourceOverride.trim()) {
    row['Source'] = sourceOverride.trim();
  }
  // PE Owner comes from the New Opp prompt — set only when provided so a
  // blank still surfaces the column's autocomplete on click.
  if (typeof peOwnerOverride === 'string' && peOwnerOverride.trim() && cols.includes('PE Owner')) {
    row['PE Owner'] = peOwnerOverride.trim();
  }
  // Default the three date columns the user tracks day-to-day to
  // today's date. Stored as ISO (YYYY-MM-DD) so the HTML5 date input
  // accepts it directly; DateCell displays a localized format.
  const today = todayISO();
  for (const dateCol of SEED_TODAY_DATE_COLUMNS) {
    if (cols.includes(dateCol)) row[dateCol] = today;
  }
  // Seed Call In with an explicit 0 so a brand-new opp shows up
  // in every Call-In-gated view (Days in Stage, Stage History) from
  // the moment it's created. The first time the user picks a Follow
  // Up date, updateOppField drops this stored value so the live
  // compute (days from today to Follow Up) takes over — i.e. the
  // 0 is a starting point, not a manual override that sticks around.
  if (cols.includes('Call In')) row['Call In'] = 0;
  return row;
}

// Header combobox — same prefix-then-substring autocomplete as the
// Account-column EditableCell, but committing a value creates a brand
// new opp pre-filled with that company name instead of mutating a
// single cell. Lets the user surface an existing company by typing a
// few letters; typing something brand-new and pressing Enter still
// works and creates an opp with that new account name.
function AddCompanyCombobox({ suggestions, onCommit, placeholder = 'Add company…' }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const wrapRef = useRef(null);

  const matches = useMemo(() => {
    if (!suggestions?.length) return [];
    const q = String(draft || '').trim().toLowerCase();
    // No query yet — show the first 8 suggestions alphabetically so
    // the dropdown signals "predictive text is available" as soon as
    // the user clicks into the field.
    if (!q) return suggestions.slice(0, 8);
    const prefix = [];
    const sub = [];
    for (const s of suggestions) {
      const lower = String(s).toLowerCase();
      if (lower === q) continue;
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
      if (prefix.length + sub.length >= 25) break;
    }
    return [...prefix, ...sub].slice(0, 8);
  }, [draft, suggestions]);

  function commit(picked) {
    const v = (picked == null ? draft : picked).trim();
    if (!v) return;
    onCommit(v);
    setDraft('');
    setOpen(false);
    setHoverIdx(0);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => { if (draft) setOpen(true); }}
        onBlur={() => {
          requestAnimationFrame(() => {
            if (!wrapRef.current?.contains(document.activeElement)) setOpen(false);
          });
        }}
        onKeyDown={(e) => {
          if (open && matches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              commit(matches[hoverIdx] || matches[0]);
              return;
            }
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
          } else if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft('');
            setOpen(false);
          }
        }}
        style={{
          width: 240,
          padding: '0.4rem 0.6rem',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--font-size-sm)',
          fontFamily: 'inherit',
          color: 'var(--color-text)',
          background: 'var(--color-bg)',
        }}
      />
      {open && matches.length > 0 && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'absolute', top: '100%', left: 0, minWidth: '100%',
            zIndex: 50, background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            maxHeight: 240, overflowY: 'auto', fontSize: '0.82rem', marginTop: 2,
          }}
        >
          {matches.map((m, i) => (
            <div
              key={m + i}
              onClick={() => commit(m)}
              onMouseEnter={() => setHoverIdx(i)}
              style={{
                padding: '0.35rem 0.6rem', cursor: 'pointer',
                background: i === hoverIdx ? '#DCFCE7' : 'transparent',
                color: i === hoverIdx ? '#166534' : '#1E293B',
                fontWeight: i === hoverIdx ? 700 : 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >{m}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// Click-to-edit cell. Plain text by default; on click flips into an
// input that commits on Enter or blur and reverts on Escape. When
// `suggestions` is provided, the input also shows a prefix-then-
// substring autocomplete dropdown so the user can pick an existing
// company name (used for the Account column on Opps 2).
// Date cell — renders the value as M/D/YYYY for display, and pops a
// native HTML5 date input (calendar) on click so the user can pick a
// new value. Stores the chosen date as ISO (YYYY-MM-DD) so it round-
// trips cleanly through the same `<input type="date">` later.
function toISODate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateDisplay(raw) {
  const iso = toISODate(raw);
  if (!iso) return String(raw || '');
  // Render as M/D/YYYY without time-zone offset surprises (parse the
  // ISO string in local time, not UTC).
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  return `${m}/${d}/${y}`;
}

function DateCell({ value, onChange }) {
  // The native <input type="date"> is permanently mounted but visually
  // hidden and not directly interactable (pointer-events: none, tab
  // disabled). The only way to change the value is via the calendar
  // popup, which we open programmatically from the visible span's
  // click. This blocks every "edit the date itself" affordance the
  // browser exposes on a focused date input — segment typing, arrow-
  // key increments, and spin buttons — so the user can only pick a
  // calendar day.
  const inputRef = useRef(null);
  const iso = toISODate(value);
  const isEmpty = !value;
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        const el = inputRef.current;
        if (!el) return;
        try { el.showPicker?.(); } catch { /* older browser — no-op */ }
      }}
      style={{
        position: 'relative',
        display: 'block', cursor: 'pointer', minHeight: '1em',
        padding: '1px 2px',
        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
      }}
      title="Click to pick a date"
    >
      {isEmpty ? '—' : formatDateDisplay(value)}
      <input
        ref={inputRef}
        type="date"
        value={iso}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: 'absolute', left: 0, top: 0,
          width: '100%', height: '100%',
          opacity: 0, pointerEvents: 'none',
          border: 0, padding: 0, margin: 0, background: 'transparent',
        }}
      />
    </span>
  );
}

// Break a free-text Next Steps cell into bullet items. Splits on
// newlines, strips any leading marker the user typed (- * • 1. etc.),
// and drops empty lines so the popup / hover render cleanly even when
// the source was loose prose.
function textToBulletItems(text) {
  return String(text ?? '')
    .split(/\r?\n+/)
    .map(line => line.replace(/^\s*(?:[-*•·▪►]|\d+[.)])\s*/, '').replace(NOTE_LINEBREAK_RE, '\n').trim())
    .filter(Boolean);
}

// Hard line breaks the user types *inside* a single Next Step box are
// stored as U+2028 (LINE SEPARATOR) rather than a plain "\n" so they
// survive the round-trip. textToBulletItems splits steps on "\n", so a
// "\n" inside one box would otherwise explode it into several boxes (and
// desync the parallel _nextStepsWaiting array). U+2028 still renders as a
// line break in the pre-formatted table cell, so the box looks the same.
const NOTE_LINEBREAK = String.fromCharCode(0x2028);
const NOTE_LINEBREAK_RE = new RegExp(NOTE_LINEBREAK, "g");
// Collapse a single box's internal newlines to U+2028 before steps are
// joined with "\n", so the box stays one step on reload.
const encodeNoteLine = (note) => String(note ?? '').trim().replace(/\r?\n/g, NOTE_LINEBREAK);

// Calendar days from today to the given ISO date. Positive = future,
// negative = past. Returns null for blank / unparseable dates.
function daysFromToday(rawISO) {
  const iso = toISODate(rawISO);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Whole calendar days between two ISO dates (b minus a). Negative when
// b is before a; null when either side is blank/unparseable.
function daysBetween(isoA, isoB) {
  const a = toISODate(isoA);
  const b = toISODate(isoB);
  if (!a || !b) return null;
  const [ay, am, ad] = a.split('-').map(n => parseInt(n, 10));
  const [by, bm, bd] = b.split('-').map(n => parseInt(n, 10));
  const da = new Date(ay, am - 1, ad);
  const db = new Date(by, bm - 1, bd);
  da.setHours(0, 0, 0, 0);
  db.setHours(0, 0, 0, 0);
  return Math.round((db - da) / 86400000);
}

// Whole business days (Mon–Fri) elapsed from the given ISO date to
// today. 0 when the date is today or in the future; null when blank.
function businessDaysSince(rawISO) {
  const iso = toISODate(rawISO);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const start = new Date(y, m - 1, d);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < today) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// Convert "wall time in America/New_York" to a UTC ms timestamp. Used
// by the No-Further-Action-Today auto-clear so the cutoff lands at
// 2 PM Eastern regardless of the user's local timezone, and it stays
// correct across DST flips. One pass is enough — we compute the
// observed Eastern wall time of our initial UTC guess, take the
// difference, and apply it.
function easternWallToUtcMs(year, month, day, hour, minute) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = {};
  for (const p of fmt.formatToParts(new Date(guess))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const obs = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute),
  );
  return guess + (guess - obs);
}

// Eastern calendar parts (+ weekday, 0=Sun..6=Sat) for a UTC ms instant.
// Used to align the configurable No-Further-Action-Today clear schedules
// to Eastern days/times for every user, independent of browser timezone.
function easternDayParts(ms) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const out = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[out.weekday];
  return { year: Number(out.year), month: Number(out.month), day: Number(out.day), dow };
}

// The most recent scheduled occurrence (UTC ms) at or before `nowMs` for
// a schedule that fires on the given Eastern weekdays at "HH:MM" Eastern.
// Returns null when nothing matches within the last week. The scheduler
// compares this against the schedule's lastRunAt: a newer occurrence means
// the clear is due — which also lets it catch up if the app was closed
// across a scheduled time.
function mostRecentNfatScheduleMs(days, time, nowMs = Date.now()) {
  if (!Array.isArray(days) || !days.length) return null;
  const [hh, mm] = String(time || '').split(':').map(n => parseInt(n, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  for (let k = 0; k < 8; k++) {
    const p = easternDayParts(nowMs - k * 24 * 60 * 60 * 1000);
    if (!days.includes(p.dow)) continue;
    const occ = easternWallToUtcMs(p.year, p.month, p.day, hh, mm);
    if (occ <= nowMs) return occ;
  }
  return null;
}

// Values the Opps Google sheet uses to mean "no data" in cells where
// the cell otherwise carries a number — treat them as blank rather
// than as a parseable string.
const BLANK_SENTINELS = new Set(['', '-', '#N/A', '#n/a', 'N/A', 'n/a']);

// True when a BFO field holds no real value — blank, "-", or an "#N/A"
// variant. Lowercased so casing doesn't matter.
function bfoFieldMissing(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '' || s === '-' || s === '#n/a' || s === 'n/a';
}

// Combined days an opp has spent across the Lead + Qualifying + Quoting
// stages: historical durations captured in `_stageHistory` plus the live
// days-so-far when the current Stage is one of those three. Mirrors the
// per-stage math the Stage History tab uses (and combinedActiveStageAge in
// api/_lib/newOpps.js) so the New Opps filter matches on screen and in the
// emailed digest.
function combinedActiveStageAge(r) {
  let total = 0;
  for (const h of (Array.isArray(r?._stageHistory) ? r._stageHistory : [])) {
    const s = String(h?.stage || '').trim();
    if (!NEW_OPPS_ACTIVE_STAGES_SET.has(s)) continue;
    const d = Number(h?.days);
    if (Number.isFinite(d) && d >= 0) total += d;
  }
  const stage = String(r?.['Stage'] || '').trim();
  if (NEW_OPPS_ACTIVE_STAGES_SET.has(stage)) {
    const enteredISO = toISODate(r?._stageEnteredAt) || toISODate(r?.['Start Date']);
    const currentDays = enteredISO ? Math.max(0, -daysFromToday(enteredISO)) : 0;
    total += currentDays;
  }
  return total;
}

// "Missing Data" flag for the Opps 2 table: the opp has a BFO
// Opportunity Name (BFO Link) but its BFO Address is still missing
// (blank / "-" / "#N/A"). These are the rows whose BFO Address needs
// to be filled in.
function oppMissingBfoAddress(row) {
  return !bfoFieldMissing(row?.['BFO Link']) && bfoFieldMissing(row?.['BFO Address']);
}

// Resolve the displayed value of a row's computed column. When the
// sheet shipped a literal value for that column (imported rows carry
// the Google Sheet's own formula output) we honor it — including
// blank sentinels, so a row the sheet decided to hide stays hidden in
// Opps 2. Hand-typed rows have no stored cell and fall through to a
// live compute from the source date. Returns null for "show blank",
// or a finite number for "show this".
function resolveComputedDays(row, storedKey, sourceField, compute) {
  if (row && storedKey in row) {
    const raw = row[storedKey];
    const s = raw == null ? '' : String(raw).trim();
    if (BLANK_SENTINELS.has(s)) return null;
  }
  // Always prefer a live compute from the source date so the cell
  // reflects today, not the stale snapshot the sheet shipped on
  // import. Falls back to the stored number only when the source
  // field is missing/unparseable (imported rows that arrived without
  // a date).
  const live = compute(row?.[sourceField]);
  if (live != null) return live;
  if (row && storedKey in row) {
    const raw = row[storedKey];
    const s = raw == null ? '' : String(raw).trim();
    const n = parseFloat(s.replace(/[,$%]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}
const resolveCallIn = (row) => resolveComputedDays(row, 'Call In', 'Follow Up', daysFromToday);
const resolveLastSpoke = (row) => resolveComputedDays(row, 'Last Spoke', 'Last Client Heard From Us', businessDaysSince);

// Days-in-Stage stall flag for an opp record. Returns { days, suggestion }
// when the opp has sat in its current stage longer than that stage's limit
// (same gates as the Days-in-Stage board: tracked stage, has a Call In,
// not a pull-through), or null otherwise. Ignores the per-opp
// `_ignoreStallFlag` so callers can offer an explicit ignore/restore.
function oppStageStall(row) {
  const stage = String(row?.['Stage'] || '').trim();
  if (!TRACKED_STAGES_SET.has(stage)) return null;
  if (resolveCallIn(row) == null) return null;
  if (PULL_THROUGH_RE.test(String(row?.['Scope'] || ''))) return null;
  const enteredISO = toISODate(row?._stageEnteredAt) || toISODate(row?.['Start Date']);
  const days = enteredISO ? -daysFromToday(enteredISO) : null;
  const rule = stageActionFor(stage, days);
  return rule ? { days, suggestion: rule.suggestion, limit: rule.days } : null;
}

// "Quoted Amount Missing" flag: an active opp (stage isn't a closed Sold /
// Not Sold) that has advanced past "Not Started" but still has no value in
// its Quoted Amount cell. Blank sentinels ("-", "#N/A", …) count as missing.
function oppMissingQuotedAmount(row) {
  const stage = String(row?.['Stage'] || '').trim();
  if (!stage || stage === 'Not Started') return false;
  if (CLOSED_STAGES_SET.has(stage)) return false;
  return bfoFieldMissing(row?.['Quoted Amount']);
}

// "Missing Margin Approval" flag: an opp at Quoted / Contracting /
// Agreement Sent that still has no Margin Email Date - Sales Leader Review
// Date (blank or a sentinel like "-" / "#N/A", which the cell shows as "—").
const MARGIN_APPROVAL_STAGES_SET = new Set(['Quoted', 'Contracting', 'Agreement Sent']);
function oppMissingMarginApproval(row) {
  const stage = String(row?.['Stage'] || '').trim();
  if (!MARGIN_APPROVAL_STAGES_SET.has(stage)) return false;
  return bfoFieldMissing(row?.['Margin Email Date - Sales Leader Review Date']);
}

// One-shot Call-In ascending sort used during initial hydration. Rows
// without a resolvable Call In sink to the bottom. A stable tiebreaker
// (original index) keeps the order deterministic when many rows share
// the same Call In value. Continuous re-sorting during editing would
// yank rows out from under the cursor — that's why this runs only on
// load and not in any update path.
function sortRecordsByCallInAsc(records) {
  if (!Array.isArray(records)) return records;
  const tagged = records.map((r, i) => {
    const n = resolveCallIn(r);
    const key = typeof n === 'number' && Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    return { r, i, key };
  });
  tagged.sort((a, b) => (a.key - b.key) || (a.i - b.i));
  return tagged.map(x => x.r);
}

// Three-state checkbox cell. Click cycles blank → ✓ ("Yes") → ✗ ("No")
// → blank. The stored value is the string "Yes" / "No" / "" so it
// round-trips through the same JSON persistence path as every other
// Opps 2 cell — and falls through to the existing search / filter
// machinery unchanged.
function TristateCheckCell({ value, onChange, title }) {
  const cur = String(value || '').trim().toLowerCase();
  const state = cur === 'yes' || cur === 'true' || cur === '✓' ? 'yes'
    : cur === 'no' || cur === 'false' || cur === '✗' ? 'no'
    : 'blank';
  const next = { blank: 'Yes', yes: 'No', no: '' };
  const cycle = (e) => {
    e.stopPropagation();
    onChange?.(next[state]);
  };
  const glyph = state === 'yes' ? '✓' : state === 'no' ? '✗' : '';
  const fg = state === 'yes' ? '#15803D' : state === 'no' ? '#B91C1C' : 'var(--color-text-muted)';
  const bg = state === 'yes' ? '#DCFCE7' : state === 'no' ? '#FEE2E2' : '#fff';
  return (
    <span
      role="checkbox"
      aria-checked={state === 'yes' ? 'true' : state === 'no' ? 'false' : 'mixed'}
      tabIndex={0}
      onClick={cycle}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); cycle(e); }
      }}
      title={title || 'Click to cycle: blank → ✓ → ✗ → blank'}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 20, height: 20, lineHeight: 1,
        border: '1px solid var(--color-border)', borderRadius: 3,
        background: bg, color: fg, cursor: 'pointer',
        fontWeight: 700, fontSize: '0.95em', userSelect: 'none',
      }}
    >{glyph}</span>
  );
}

// Read-only cell for a column whose value is derived from another cell.
function ComputedCell({ value }) {
  const isEmpty = value == null || value === '';
  return (
    <span
      style={{
        display: 'block', minHeight: '1em',
        padding: '1px 2px',
        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
      }}
      title="Computed value"
    >
      {isEmpty ? '—' : String(value)}
    </span>
  );
}

// Call In cell with a manual override. Clicking a populated cell
// stores a blank sentinel under 'Call In' so the row reads empty even
// though Follow Up still has a date; clicking the "+ add" affordance
// on a cleared cell deletes that override so the live compute takes
// over again. Falls through to the read-only ComputedCell when there's
// nothing to toggle (no Follow Up, no stored override).
function CallInCell({ row, onClear, onRestore }) {
  const storedKey = 'Call In';
  const hasStored = row && storedKey in row;
  const rawStored = hasStored ? row[storedKey] : undefined;
  const storedStr = rawStored == null ? '' : String(rawStored).trim();
  const isCleared = hasStored && BLANK_SENTINELS.has(storedStr);
  const live = daysFromToday(row?.['Follow Up']);
  const n = resolveCallIn(row);

  if (isCleared && live != null) {
    return (
      <span
        onClick={(e) => { e.stopPropagation(); onRestore(); }}
        title={`Restore Call In (${live})`}
        style={{
          display: 'block', cursor: 'pointer',
          color: 'var(--color-text-muted)', fontStyle: 'italic',
          textAlign: 'center', padding: '1px 2px',
        }}
      >+ add</span>
    );
  }

  if (n != null) {
    return (
      <span
        onClick={(e) => {
          e.stopPropagation();
          // Click-to-clear is destructive (it stamps the cell with the
          // BLANK sentinel and you have to find the "+ add" affordance
          // to undo it), and it's easy to brush this cell while
          // scanning the column. Guard with a confirm so a stray click
          // doesn't wipe the value.
          const label = String(row?.['Account'] || '').trim() || 'this row';
          if (window.confirm(`Remove the Call In value for ${label}?`)) {
            onClear();
          }
        }}
        title="Click to clear Call In"
        style={{ display: 'block', cursor: 'pointer' }}
      >
        <ComputedCell value={n} />
      </span>
    );
  }

  return <ComputedCell value="" />;
}

// Renders a frozen Pricing → Options snapshot saved onto the opp.
// Self-contained: doesn't read from Pricing's IndexedDB cache, so it
// keeps working even after the Pricing tab has been cleared.
function PricingOptionSnapshotView({ snapshot }) {
  if (!snapshot) return null;
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const yearTotals = Array.isArray(snapshot.yearTotals) ? snapshot.yearTotals : [];
  const termValues = Array.isArray(snapshot.termValues) ? snapshot.termValues : [];
  const year1Monthly = Array.isArray(snapshot.year1Monthly) ? snapshot.year1Monthly : [];
  const termYears = Math.max(1, Number(snapshot.years) || 1);
  return (
    <div style={{
      border: '1px solid var(--color-border)', borderRadius: 6,
      background: '#fafbfc', padding: '0.65rem 0.75rem',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: '0.5rem', marginBottom: '0.5rem',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{snapshot.name || '(unnamed)'}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
            {termYears}-year term · {snapshot.escPct || 0}% escalator
            {snapshot.savedAt ? ` · saved ${new Date(snapshot.savedAt).toLocaleDateString()}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Year 1</div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{fmtMoneyWhole(snapshot.year1Total || 0)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Year breakdown</div>
          <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
            <tbody>
              {Array.from({ length: termYears }, (_, i) => (
                <tr key={`y-${i}`}>
                  <td style={{ padding: '2px 4px', color: 'var(--color-text-muted)' }}>Year {i + 1}</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right' }}>{fmtMoneyWhole(yearTotals[i] || 0)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '2px 4px', fontWeight: 600 }}>Total Contract Value</td>
                <td style={{ padding: '2px 4px', textAlign: 'right', fontWeight: 600 }}>{fmtMoneyWhole(termValues[termYears - 1] || 0)}</td>
              </tr>
              {snapshot.setupTotal ? (
                <tr>
                  <td style={{ padding: '2px 4px', color: 'var(--color-text-muted)' }}>Setup</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right' }}>{fmtMoneyWhole(snapshot.setupTotal)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Year 1 monthly</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: '0.72rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {year1Monthly.map((_, i) => (
                    <th key={`mh-${i}`} style={{ padding: '2px 4px', color: 'var(--color-text-muted)', fontWeight: 500 }}>M{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {year1Monthly.map((v, i) => (
                    <td key={`mv-${i}`} style={{ padding: '2px 4px', textAlign: 'right' }}>{fmtMoneyWhole(v)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
          Fee schedule ({rows.filter(r => r.fee || r.feeSchedule).length} rows)
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 4 }}>
          <table style={{ width: '100%', fontSize: '0.74rem', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f1f5f9' }}>
              <tr>
                <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Fee Schedule</th>
                <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>Fee</th>
                <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Unit</th>
                <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>Est. Count</th>
                <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>Start Month</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter(r => r.fee || r.feeSchedule || r.type).map((r, idx) => (
                <tr key={idx} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                  <td style={{ padding: '3px 6px' }}>{r.feeSchedule || '—'}</td>
                  <td style={{ padding: '3px 6px' }}>{r.type || '—'}</td>
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{r.fee || '—'}</td>
                  <td style={{ padding: '3px 6px' }}>{r.unit || '—'}</td>
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{r.unitCount || '—'}</td>
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{r.startMonth || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Quoted Amount cell. Clicking the value opens a small editor popup
// with two fields — the dollar amount and an optional hyperlink. The
// cell itself stays icon-free: when a hyperlink is set the amount
// renders as a link to it, and a Pricing-Option snapshot still falls
// back to the existing "open the Opp details popup" affordance when
// no manual URL is set. All edits happen inside the popup.
function QuotedAmountCell({ value, onChange, snapshot, onViewSnapshot, url, onChangeUrl, services, bfoName, bfoAddress }) {
  const [open, setOpen] = useState(false);
  const [draftAmount, setDraftAmount] = useState(value ?? '');
  const [draftUrl, setDraftUrl] = useState(url ?? '');
  useEffect(() => { if (!open) setDraftAmount(value ?? ''); }, [value, open]);
  useEffect(() => { if (!open) setDraftUrl(url ?? ''); }, [url, open]);

  const closePopup = () => setOpen(false);
  const openPopup = (e) => {
    if (e) e.stopPropagation();
    setDraftAmount(value ?? '');
    setDraftUrl(url ?? '');
    setOpen(true);
  };
  const save = () => {
    const nextAmount = draftAmount;
    const trimmedUrl = (draftUrl || '').trim();
    const nextUrl = trimmedUrl && !/^https?:\/\//i.test(trimmedUrl) ? `https://${trimmedUrl}` : trimmedUrl;
    if (nextAmount !== (value ?? '')) onChange?.(nextAmount);
    if (nextUrl !== (url ?? '')) onChangeUrl?.(nextUrl);
    setOpen(false);
  };

  // Derive the at-a-glance figures the popup shows for a saved Pricing
  // Option (SIA) snapshot: which option was saved, the Year-1 Setup +
  // One Time fees (every non-recurring line that bills in year 1), and
  // the monthly Recurring fee (sum of each recurring line's base
  // fee × unit count). Recomputed from the frozen snapshot rows so it
  // stays correct even after the Pricing tab is cleared.
  const snapStats = useMemo(() => {
    if (!snapshot) return null;
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    const years = Math.max(1, Number(snapshot.years) || 1);
    const esc = Number(snapshot.escPct) || 0;
    let setupOneTime = 0;
    let recurringMonthly = 0;
    let recurringAnnual = 0;
    for (const r of rows) {
      if (String(r.type || '').toLowerCase().startsWith('recurring')) {
        recurringMonthly += (toNum(r.fee) || 0) * unitCountOrOne(r.unitCount);
        // Year-1 recurring revenue — matches the pricing page's Year 1
        // "Recurring" column. Uses rowYearRevenue so a line that starts
        // after month 1 bills only its active months (not a flat ×12).
        recurringAnnual += rowYearRevenue(r, 1, years, esc);
      } else {
        // Setup / One Time lines bill a single month — rowYearRevenue
        // returns their amount only when that month lands in Year 1.
        setupOneTime += rowYearRevenue(r, 1, years, esc);
      }
    }
    const year1Total = Number(snapshot.year1Total) || 0;
    return { name: String(snapshot.name || '').trim(), setupOneTime, recurringMonthly, recurringAnnual, year1Total };
  }, [snapshot]);

  // Services bundled in the saved Option. Prefer the list frozen into
  // the snapshot (self-contained); fall back to the live per-Option
  // services map passed in (covers snapshots saved before services were
  // stored). Deduped, blanks dropped.
  const optionServices = useMemo(() => {
    const raw = (Array.isArray(snapshot?.services) && snapshot.services.length)
      ? snapshot.services
      : (Array.isArray(services) ? services : []);
    const seen = new Set();
    const out = [];
    for (const s of raw) {
      const v = String(s || '').trim();
      const k = v.toLowerCase();
      if (!v || seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }, [snapshot, services]);

  // Cell display — no inline action buttons. The whole cell is the
  // click target for the editor popup; when a URL or snapshot is set
  // the value is styled as a link for affordance.
  const hasLink = !!url || !!snapshot;
  const display = value || (url ? '—' : (snapshot ? fmtMoneyWhole(snapshot.year1Total || 0) || '—' : '—'));
  return (
    <>
      <span
        onClick={openPopup}
        title="Click to edit the Deal Size and hyperlink"
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em', padding: '1px 2px',
          color: hasLink ? '#2563eb' : (value ? 'inherit' : 'var(--color-text-muted)'),
          textDecoration: hasLink ? 'underline' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >{display}</span>
      {open && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) closePopup(); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(15, 23, 42, 0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, padding: '1rem 1.25rem',
              minWidth: 360, maxWidth: 480, boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column', gap: '0.75rem',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1E293B' }}>Deal Size</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: '#475569' }}>
              Amount
              <input
                autoFocus
                type="text"
                value={draftAmount}
                onChange={(e) => setDraftAmount(formatQuotedAmountLive(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); save(); }
                  else if (e.key === 'Escape') { e.preventDefault(); closePopup(); }
                }}
                placeholder="$0"
                style={{ padding: '0.4rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.88rem' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: '#475569' }}>
              Sharepoint Hyperlink
              <input
                type="text"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); save(); }
                  else if (e.key === 'Escape') { e.preventDefault(); closePopup(); }
                }}
                placeholder="https://…"
                style={{ padding: '0.4rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit', fontSize: '0.82rem' }}
              />
            </label>
            {(() => {
              // Read-only BFO context for this opp: the BFO Opportunity Name
              // ("BFO Link") and the BFO Address (live Salesforce URL).
              const cleanBfo = (v) => bfoFieldMissing(v) ? '' : String(v).trim();
              const nm = cleanBfo(bfoName);
              const addr = cleanBfo(bfoAddress);
              const addrIsUrl = /^https?:\/\//i.test(addr);
              return (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 6,
                  padding: '0.5rem 0.6rem', background: '#F8FAFC',
                  border: '1px solid var(--color-border-light)', borderRadius: 4,
                  fontSize: '0.78rem', color: '#475569',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>BFO Opportunity Name</span>
                    <strong style={{ color: '#1E293B', textAlign: 'right', wordBreak: 'break-word' }}>{nm || '—'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>BFO Address</span>
                    {addrIsUrl ? (
                      <a
                        href={addr}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: '#2563eb', textDecoration: 'underline', textAlign: 'right', wordBreak: 'break-all' }}
                      >Open in BFO ↗</a>
                    ) : (
                      <strong style={{ color: '#1E293B', textAlign: 'right', wordBreak: 'break-word' }}>{addr || '—'}</strong>
                    )}
                  </div>
                </div>
              );
            })()}
            {snapshot && snapStats && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                padding: '0.5rem 0.6rem', background: '#F8FAFC',
                border: '1px solid var(--color-border-light)', borderRadius: 4,
                fontSize: '0.78rem', color: '#475569',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>Saved SIA Option</span>
                  <strong style={{ color: '#1E293B', textAlign: 'right' }}>{snapStats.name || '—'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>Setup Fees <span style={{ color: '#94A3B8' }}>(Setup + One Time, Yr 1)</span></span>
                  <strong style={{ color: '#1E293B' }}>{fmtMoneyWhole(snapStats.setupOneTime) || '$0'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>Recurring Fees <span style={{ color: '#94A3B8' }}>(monthly)</span></span>
                  <strong style={{ color: '#1E293B' }}>{fmtMoneyWhole(snapStats.recurringMonthly) || '$0'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>Recurring Fees <span style={{ color: '#94A3B8' }}>(annual)</span></span>
                  <strong style={{ color: '#1E293B' }}>{fmtMoneyWhole(snapStats.recurringAnnual) || '$0'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--color-border-light)', paddingTop: 4, marginTop: 2 }}>
                  <span>Year 1 Total <span style={{ color: '#94A3B8' }}>(quoted)</span></span>
                  <strong style={{ color: '#1E293B' }}>{fmtMoneyWhole(snapStats.year1Total) || '$0'}</strong>
                </div>
              </div>
            )}
            {snapshot && optionServices.length > 0 && (
              <div style={{
                padding: '0.5rem 0.6rem', background: '#F8FAFC',
                border: '1px solid var(--color-border-light)', borderRadius: 4,
                fontSize: '0.78rem', color: '#475569',
              }}>
                <div style={{ fontWeight: 600, color: '#1E293B', marginBottom: 4 }}>
                  Services <span style={{ color: '#94A3B8', fontWeight: 400 }}>({optionServices.length})</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {optionServices.map((s, i) => (
                    <li key={`svc-${i}`} style={{ margin: '0.1rem 0' }}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {(url || snapshot) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: '0.78rem' }}>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#2563eb', textDecoration: 'underline' }}
                    onClick={(e) => e.stopPropagation()}
                  >Open hyperlink ↗</a>
                )}
                {snapshot && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setOpen(false); onViewSnapshot?.(); }}
                    style={{ background: 'none', border: 'none', color: '#2563eb', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}
                  >View saved Pricing Option snapshot</button>
                )}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={closePopup}
                style={{ padding: '0.35rem 0.8rem', border: '1px solid var(--color-border)', background: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.82rem' }}
              >Cancel</button>
              <button
                type="button"
                onClick={save}
                style={{ padding: '0.35rem 0.95rem', border: 'none', background: '#2563eb', color: '#fff', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600 }}
              >Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Read-only "Pricing Option" cell: shows the option name linked to this
// opp from the Pricing → Options tab. The user can't type into it — the
// link is set from Pricing → Options ("Save to Opp…") and cleared with
// the × that appears here when a value is present.
function PricingOptionCell({ value, onClear }) {
  const isEmpty = !value;
  return (
    <span
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '1px 2px',
        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
      }}
      title={isEmpty
        ? 'Set from the Pricing → Options tab: open an Option, then click “Save to Opp…”.'
        : `Linked Pricing Option: ${value}`}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isEmpty ? '—' : value}
      </span>
      {!isEmpty && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClear?.(); }}
          title="Clear pricing-option link"
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: '#94a3b8', padding: '0 2px', fontSize: '0.85em', lineHeight: 1,
          }}
        >×</button>
      )}
    </span>
  );
}

// Opt-in hover popover for long-text cells (Next Steps). Mirrors the
// text in a portal-positioned dark box anchored to the cell so the
// content isn't clipped by the column width or by the table's
// horizontal scroll container. Only shows when the value would
// otherwise be cut off — a newline that gets squashed by the cell's
// single-line render, or text wider than the column.
function CellHoverPopover({ anchorRef, value, enabled }) {
  const [pos, setPos] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el || !enabled) return undefined;
    function onEnter() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const node = anchorRef.current;
        if (!node) return;
        const text = String(value ?? '');
        if (!text) return;
        const hasNewline = text.includes('\n');
        const hasOverflow = node.scrollWidth > node.clientWidth + 1;
        if (!hasNewline && !hasOverflow) return;
        const rect = node.getBoundingClientRect();
        const vh = window.innerHeight;
        const flipAbove = rect.bottom + 220 > vh && rect.top > 220;
        setPos({
          top: flipAbove ? rect.top - 4 : rect.bottom + 4,
          left: Math.min(rect.left, window.innerWidth - 500),
          flipAbove,
        });
      }, 250);
    }
    function onLeave() {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      setPos(null);
    }
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [anchorRef, value, enabled]);

  if (!pos || !enabled) return null;
  const items = textToBulletItems(value);
  return createPortal(
    <div
      style={{
        position: 'fixed', top: pos.top, left: pos.left,
        transform: pos.flipAbove ? 'translateY(-100%)' : 'none',
        background: '#1e293b', color: '#f8fafc',
        padding: '6px 10px', borderRadius: 4, fontSize: '0.78rem',
        maxWidth: 480, maxHeight: 320, overflow: 'auto',
        wordBreak: 'break-word', lineHeight: 1.4,
        boxShadow: '0 8px 22px rgba(15, 23, 42, 0.28)',
        zIndex: 10000, pointerEvents: 'none',
      }}
    >
      {items.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {items.map((it, i) => <li key={i} style={{ margin: '2px 0', whiteSpace: 'pre-wrap' }}>{it}</li>)}
        </ul>
      ) : (
        <span style={{ whiteSpace: 'pre-wrap' }}>{String(value ?? '')}</span>
      )}
    </div>,
    document.body,
  );
}

// Next Steps cell — single click opens the bullet-list popup. Inline
// editing isn't useful for this column because the editor in the popup
// is purpose-built for it (per-step Waiting On, bullet reorder, etc.).
// Hover still surfaces the full text via the shared popover so a quick
// glance doesn't require opening the modal.
function NextStepsCell({ value, onOpen }) {
  const ref = useRef(null);
  const isEmpty = value === '' || value == null;
  const text = isEmpty ? '—' : String(value);
  return (
    <>
      <span
        ref={ref}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        title="Click to edit in Notes"
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em',
          padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
      >{text}</span>
      <CellHoverPopover anchorRef={ref} value={text} enabled={!isEmpty} />
    </>
  );
}

function EditableCell({ value, onChange, suggestions, onAddNew, addNewLabel, renderDisplay }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  // Dropdown is portaled to <body> so the table cell's overflow:hidden
  // can't clip it; position is recomputed from the wrapper's bounding
  // rect whenever the dropdown opens.
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef = useRef(null);
  const textareaRef = useRef(null);
  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);

  // Auto-grow the textarea to fit its contents so the user sees every
  // line of an Alt+Enter note while typing.
  useLayoutEffect(() => {
    if (!editing || !textareaRef.current) return;
    const ta = textareaRef.current;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }, [editing, draft]);

  // Matches are a mix of plain strings (existing suggestions) and an
  // optional `+ Add "X"` sentinel object at the end when `onAddNew` is
  // wired up and the current draft isn't an exact match to any
  // suggestion. Keeping both in one array means hover / keyboard nav
  // works uniformly. A suggestion item can also be `{ value, label,
  // secondary }` to render a richer two-line option (e.g. name +
  // email for the Contact column); `value` is what's stored and
  // matched against the query.
  const matchValue = (s) => {
    if (s && typeof s === 'object' && !s.__add) return String(s.value ?? '');
    return String(s ?? '');
  };
  const matches = useMemo(() => {
    const list = suggestions || [];
    const q = String(draft || '').trim().toLowerCase();
    if (!q) {
      // No query yet — surface the first 8 suggestions alphabetically
      // so the dropdown shows as soon as the cell is focused. The add
      // sentinel needs a non-empty draft, so it's not included here.
      return list.slice(0, 8);
    }
    const prefix = [];
    const sub = [];
    for (const s of list) {
      const lower = matchValue(s).toLowerCase();
      if (lower === q) continue;
      if (lower.startsWith(q)) prefix.push(s);
      else if (lower.includes(q)) sub.push(s);
      if (prefix.length + sub.length >= 25) break;
    }
    const result = [...prefix, ...sub].slice(0, 8);
    if (onAddNew) {
      const exact = list.some(s => matchValue(s).toLowerCase() === q);
      if (!exact) {
        const txt = draft.trim();
        const label = typeof addNewLabel === 'function' ? addNewLabel(txt) : `+ Add "${txt}"`;
        result.push({ __add: true, value: txt, label });
      }
    }
    return result;
  }, [draft, suggestions, onAddNew, addNewLabel]);

  const dropdownAvailable = (suggestions?.length || 0) > 0 || !!onAddNew;

  function commit(next) {
    const v = next == null ? draft : next;
    setEditing(false);
    setOpen(false);
    if ((v ?? '') !== (value ?? '')) onChange(v);
  }

  function pickMatch(m) {
    if (m && typeof m === 'object' && m.__add) {
      if (typeof onAddNew === 'function') onAddNew(m.value);
      setDraft(m.value);
      commit(m.value);
      return;
    }
    const v = m && typeof m === 'object' ? String(m.value ?? '') : m;
    setDraft(v);
    commit(v);
  }

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
  }, [open, draft]);

  if (!editing) {
    const isEmpty = value === '' || value == null;
    const text = isEmpty ? '—' : String(value);
    const enterEdit = () => { setEditing(true); setOpen(dropdownAvailable); };
    // Let callers (e.g. the Account column) render a custom non-editing
    // display — such as a clickable company link — while keeping all of
    // EditableCell's editing/autocomplete behavior. `enterEdit` lets the
    // custom display drop back into the normal text editor.
    if (renderDisplay) return renderDisplay({ enterEdit, value, isEmpty, text });
    return (
      <span
        onClick={(e) => { e.stopPropagation(); enterEdit(); }}
        style={{
          // `white-space: pre` keeps Alt+Enter newlines on their own
          // line (so the row grows vertically to fit) while still
          // clipping anything wider than the column.
          display: 'block', cursor: 'text', minHeight: '1em',
          padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
      >{text}</span>
    );
  }
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        autoFocus
        rows={1}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setOpen(true); setHoverIdx(0); }}
        onFocus={() => { if (dropdownAvailable) setOpen(true); }}
        onBlur={() => {
          // Defer so a click on a suggestion lands first.
          requestAnimationFrame(() => {
            if (!wrapRef.current?.contains(document.activeElement)) commit();
          });
        }}
        onKeyDown={(e) => {
          if (open && matches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx(i => (i + 1) % matches.length); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHoverIdx(i => (i - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Tab')       { e.preventDefault(); pickMatch(matches[hoverIdx] || matches[0]); return; }
            if (e.key === 'Enter' && !(e.altKey || e.shiftKey)) {
              e.preventDefault();
              pickMatch(matches[hoverIdx] || matches[0]);
              return;
            }
            if (e.key === 'Escape')    { e.preventDefault(); setDraft(value ?? ''); setEditing(false); setOpen(false); return; }
          } else {
            // Alt+Enter / Shift+Enter inserts a newline (Excel
            // convention) — let the textarea handle it natively.
            // Plain Enter commits and exits edit mode.
            if (e.key === 'Enter' && !(e.altKey || e.shiftKey)) {
              e.preventDefault();
              e.currentTarget.blur();
              return;
            }
            if (e.key === 'Tab')    { e.preventDefault(); e.currentTarget.blur(); return; }
            if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
          }
        }}
        style={{
          width: '100%', boxSizing: 'border-box',
          border: '1px solid var(--color-accent)', borderRadius: 3,
          padding: '1px 4px',
          fontSize: 'inherit', fontFamily: 'inherit', color: 'var(--color-text)',
          background: '#fff', resize: 'none', overflow: 'hidden',
          lineHeight: 1.3,
        }}
      />
      {open && matches.length > 0 && createPortal(
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed', top: dropPos.top, left: dropPos.left,
            minWidth: Math.max(dropPos.width, 160),
            zIndex: 9999, background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
            maxHeight: 220, overflowY: 'auto', fontSize: '0.78rem',
          }}
        >
          {matches.map((m, i) => {
            const isAdd = m && typeof m === 'object' && m.__add;
            const isRich = m && typeof m === 'object' && !m.__add;
            const label = isAdd ? m.label : (isRich ? (m.label ?? m.value) : m);
            const secondary = isRich ? m.secondary : null;
            const keyVal = isAdd ? '__add' : (isRich ? `${m.value}-${i}` : String(m) + i);
            const hovered = i === hoverIdx;
            return (
              <div
                key={keyVal}
                onClick={() => pickMatch(m)}
                onMouseEnter={() => setHoverIdx(i)}
                style={{
                  padding: '0.3rem 0.55rem', cursor: 'pointer',
                  background: hovered ? '#DCFCE7' : 'transparent',
                  color: hovered ? '#166534' : (isAdd ? '#7C3AED' : '#1E293B'),
                  fontStyle: isAdd ? 'italic' : 'normal',
                  fontWeight: hovered ? 700 : 500,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  borderTop: isAdd && i > 0 ? '1px solid var(--color-border-light)' : 'none',
                }}
              >
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                {secondary && (
                  <div style={{
                    fontSize: '0.7rem',
                    color: hovered ? '#15803D' : 'var(--color-text-muted)',
                    fontWeight: 400,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{secondary}</div>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Contact-column cell — tag-style multi-pick scoped to the prospect
// whose `company` matches this row's Account. Shows current tags
// inline + a "+ Contacts" button (only when an Account is set) that
// opens a checkbox picker of every contact on that prospect with
// name on top and email muted underneath. Stores the chosen names
// as a comma-separated string so the same parseMulti round-trip
// works as for Scope.
// Build a set of normalized match keys for a company name, including
// the full name, the name with any parenthetical alias stripped, and
// each parenthetical alias on its own. Two companies are considered
// the same if their key sets intersect. This lets "Unibail-Rodamco-
// Westfield (URW)" match contact records stored under either the long
// form or just "URW".

// Free-mail providers we skip when matching contacts by email domain.
// Mirrors the FREE list inside ProspectModal so an @gmail.com contact
// doesn't match every Opp at every account.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
  'aol.com', 'me.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com',
]);

// Fuzzy company-name match used by the tagged-contacts roster, mirroring
// the looser equality the ProspectModal's contacts panel uses (incl. the
// acronym / single-token branch). Without this, an Opps 2 account like
// "Brookfield (NAM Multifamily)" can't see HubSpot contacts whose
// Company is just "Brookfield" — even though the prospect popup does.
function companyNameMatches(a, b) {
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
  // Acronym / single-token branch: contact "Brookfield" matches Account
  // "Brookfield (NAM Multifamily)" because parens count as separators.
  const tokensOf = (s) => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const sTokens = tokensOf(shorter);
  if (sTokens.length === 1 && sTokens[0].length >= 3) {
    if (tokensOf(longer).includes(sTokens[0])) return true;
  }
  return false;
}

// Email domains tied to a prospect record — used as a fallback so a
// HubSpot contact whose Company text doesn't match the Account still
// shows up when their email sits on a known domain. Mirrors how the
// ProspectModal builds its baseContacts list.
function prospectEmailDomains(prospect) {
  const domains = new Set();
  if (!prospect) return domains;
  if (prospect.emailDomain) {
    for (const entry of String(prospect.emailDomain).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean)) {
      const at = entry.lastIndexOf('@');
      const d = (at >= 0 ? entry.slice(at + 1) : entry).toLowerCase().trim();
      if (d) domains.add(d);
    }
  }
  if (prospect.website) {
    const d = String(prospect.website).replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
    if (d) domains.add(d);
  }
  return domains;
}

function contactEmailDomain(email) {
  if (!email) return '';
  const at = String(email).lastIndexOf('@');
  if (at < 0) return '';
  const d = email.slice(at + 1).toLowerCase().trim();
  return (d && !FREE_EMAIL_DOMAINS.has(d)) ? d : '';
}

function companyMatchKeys(name) {
  const s = String(name || '').trim();
  const keys = new Set();
  if (!s) return keys;
  const full = normalizeCompany(s);
  if (full) keys.add(full);
  const aliases = [...s.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
  if (aliases.length > 0) {
    const stripped = normalizeCompany(s.replace(/\([^)]*\)/g, ' '));
    if (stripped) keys.add(stripped);
    for (const a of aliases) {
      const n = normalizeCompany(a);
      if (n) keys.add(n);
    }
  }
  return keys;
}

// Find the prospect record whose company best matches an opp's Account
// name. Prefer an exact normalized match over an alias-only match so
// "URW" on an opp doesn't accidentally pull from a prospect that happens
// to share an alias. Shared by the Contact and Account columns.
function findProspectForAccount(account, prospects) {
  const accountKeys = companyMatchKeys(account);
  if (accountKeys.size === 0) return null;
  let exact = null;
  let alias = null;
  const accountFull = normalizeCompany(account);
  for (const p of (prospects || [])) {
    const pk = companyMatchKeys(p?.company);
    if (pk.size === 0) continue;
    const full = normalizeCompany(p?.company);
    if (full && accountFull && full === accountFull) { exact = p; break; }
    for (const k of pk) { if (accountKeys.has(k)) { alias = alias || p; break; } }
  }
  return exact || alias;
}

// "BFO Company Name" lives on the Table View company record (prospect),
// not the opp. This cell sources its value from the prospect matching
// the opp's Account and writes edits straight back to that prospect's
// `bfoCompanyName`, so the two views stay in sync. When no Table View
// company matches there's nowhere to store the value, so it renders
// read-only with a hint to add the company on the Table View first.
function BfoCompanyNameCell({ account, prospects, updateProspect }) {
  const matched = useMemo(() => findProspectForAccount(account, prospects), [account, prospects]);
  if (!matched || !updateProspect) {
    return (
      <span
        style={{ color: 'var(--color-text-muted)' }}
        title={matched ? undefined : 'Add this company on the Table View to set its BFO Company Name'}
      >
        {String(matched?.bfoCompanyName || '').trim() || '—'}
      </span>
    );
  }
  return (
    <EditableCell
      value={matched.bfoCompanyName || ''}
      onChange={(v) => updateProspect(matched.id, { bfoCompanyName: v })}
    />
  );
}

// `contactEmails` / `onChangeEmails` persist the tagged contacts' emails on
// the opp row itself (hidden `_contactEmails` map, lowercased name → email),
// captured at tag time. The HubSpot contacts cache is an IndexedDB cache
// that can be cleared or go stale — without the stored map, a tag's email
// (resolved live from that cache) would silently vanish until a refresh.
function ContactCell({ value, onChange, account, peOwner, prospects, updateProspect, hubspotContacts, onOpenContact, onOpenCompany, contactEmails, onChangeEmails }) {
  // Single boolean for popover state — the popover handles both
  // viewing currently tagged contacts and adding new ones (from the
  // company roster or as a custom one-off tag), so the picker/view
  // split is gone.
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [customDraft, setCustomDraft] = useState('');
  const [popPos, setPopPos] = useState({ top: 0, bottom: null, left: 0, maxHeight: 0, placement: 'below' });
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const [copied, setCopied] = useState(null); // key of the last button that flashed "Copied!"

  const matched = useMemo(() => findProspectForAccount(account, prospects), [account, prospects]);

  // The opp's PE Owners are themselves companies in the Table View, so
  // resolve each one to a prospect too — their contacts get folded into
  // the same roster below so the user can tag the PE firms' people
  // alongside the deal company's. PE ownership normally lives on the
  // Table View company record (prospect.peOwner), not on each opp row,
  // so fall back to the matched company's peOwner when the opp's own PE
  // Owner column is blank. A company can list several owners
  // (comma-separated); each gets its own roster entry.
  const peOwnerStr = String(peOwner || matched?.peOwner || '').trim();
  const peResolved = useMemo(
    () => splitPeOwners(peOwnerStr).map(owner => ({
      owner,
      prospect: findProspectForAccount(owner, prospects),
    })),
    [peOwnerStr, prospects],
  );
  const peLabel = peResolved
    .map(({ owner, prospect }) => (prospect?.company || owner).trim())
    .filter(Boolean)
    .join(' & ');

  // Build the contact roster for this opp. Pull from two sources and
  // dedupe by name (case-insensitive):
  //   1. The HubSpot contacts cache, filtered by company match
  //   2. Any contacts attached directly to the matched prospect record
  // Each contact is gathered against the deal company AND, when the opp
  // has a PE Owner, that PE firm — tagged with its source company so the
  // mixed list stays legible. The HubSpot cache is the primary source
  // (most of the user's contacts live there); prospect.contacts is a
  // fallback for accounts that were curated manually.
  const contactOptions = useMemo(() => {
    if (!account && !matched && peResolved.length === 0) return [];
    // A reusable predicate: does this HubSpot contact belong to the
    // company described by `keys` / `names` / `domains`? Mirrors the
    // three-way match the cell has always used (key intersection, fuzzy
    // name, email domain) so the PE side matches identically.
    const makeMatcher = (keys, names, domains) => (c) => {
      const ck = companyMatchKeys(c?.company);
      if (ck.size > 0) {
        for (const k of ck) if (keys.has(k)) return true;
      }
      if (c?.company) {
        for (const n of names) if (n && companyNameMatches(c.company, n)) return true;
      }
      if (domains.size > 0) {
        const d = contactEmailDomain(c?.email);
        if (d && domains.has(d)) return true;
      }
      return false;
    };
    const accountKeys = new Set([
      ...companyMatchKeys(account),
      ...(matched ? companyMatchKeys(matched.company) : []),
    ]);
    const matchesCompany = makeMatcher(
      accountKeys,
      [account, matched?.company],
      prospectEmailDomains(matched),
    );
    // One matcher per PE owner so each firm's contacts get tagged with
    // that firm's name in the mixed roster.
    const peMatchers = peResolved.map(({ owner, prospect }) => ({
      label: (prospect?.company || owner).trim(),
      prospect,
      matches: makeMatcher(
        new Set([
          ...companyMatchKeys(owner),
          ...(prospect ? companyMatchKeys(prospect.company) : []),
        ]),
        [owner, prospect?.company],
        prospectEmailDomains(prospect),
      ),
    }));

    const seen = new Set();
    const out = [];
    const pushContact = (raw, source, company) => {
      if (!raw) return;
      const name = [raw.firstname, raw.lastname].filter(Boolean).join(' ').trim()
        || String(raw.email || '').trim();
      if (!name) return;
      const k = name.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({
        name,
        email: String(raw.email || '').trim(),
        jobtitle: String(raw.jobtitle || '').trim(),
        source,
        company,
      });
    };
    // Deal company wins on a tie (checked first), so a contact shared by
    // both rosters is labeled with the deal company, not the PE firm.
    for (const c of (hubspotContacts || [])) {
      if (matchesCompany(c)) {
        pushContact(c, 'company', matched?.company || account);
      } else {
        const pm = peMatchers.find(m => m.matches(c));
        if (pm) pushContact(c, 'pe', pm.label);
      }
    }
    for (const c of (matched?.contacts || [])) pushContact(c, 'company', matched?.company || account);
    for (const pm of peMatchers) {
      for (const c of (pm.prospect?.contacts || [])) pushContact(c, 'pe', pm.label);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [account, hubspotContacts, matched, peResolved]);

  const selected = useMemo(() => parseMulti(value), [value]);
  const selectedSet = useMemo(() => new Set(selected.map(s => s.toLowerCase())), [selected]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contactOptions;
    return contactOptions.filter(o =>
      o.name.toLowerCase().includes(q) || o.email.toLowerCase().includes(q)
    );
  }, [contactOptions, query]);

  // Anchor the popover next to the cell, flipping above when the row
  // sits near the bottom of the viewport so a long contact list isn't
  // cut off. Also caps the popover's overall max height to whatever
  // vertical space is available on the chosen side; the internal lists
  // stay capped at their own maxHeights so the user can still scroll
  // through them individually.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const margin = 8;
    const gap = 2;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    // Prefer below — the popover's natural sit — unless there's
    // meaningfully more room above. The 200px floor on "below" keeps a
    // close-to-bottom row from flipping needlessly when there's still
    // some room (the list will scroll internally).
    const placeBelow = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    if (placeBelow) {
      setPopPos({
        top: rect.bottom + gap,
        bottom: null,
        left: rect.left,
        maxHeight: Math.max(160, spaceBelow),
        placement: 'below',
      });
    } else {
      setPopPos({
        top: null,
        bottom: window.innerHeight - rect.top + gap,
        left: rect.left,
        maxHeight: Math.max(160, spaceAbove),
        placement: 'above',
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Back-fill: tags created before emails were persisted on the opp only
  // have their email in the live HubSpot cache. When the popover opens
  // (a deliberate, single-row interaction — no render-time or page-load
  // write storms) and the roster can resolve a tag that isn't stored yet,
  // save it so this opp's tags survive the next cache loss.
  useEffect(() => {
    if (!open || !onChangeEmails) return;
    const missing = {};
    for (const name of selected) {
      const key = name.toLowerCase();
      if (storedEmails[key]) continue;
      const live = contactByName.get(key)?.email;
      if (live) missing[key] = live;
    }
    if (Object.keys(missing).length > 0) {
      onChangeEmails({ ...storedEmails, ...missing });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The opp-stored name → email map (see the component comment). Always
  // normalized to lowercased-name keys; tolerate junk from older rows.
  const storedEmails = useMemo(() => {
    const out = {};
    if (contactEmails && typeof contactEmails === 'object') {
      for (const [k, v] of Object.entries(contactEmails)) {
        const key = String(k || '').trim().toLowerCase();
        const email = String(v || '').trim();
        if (key && email) out[key] = email;
      }
    }
    return out;
  }, [contactEmails]);

  function tagName(name, email) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    if (selectedSet.has(trimmed.toLowerCase())) return;
    onChange([...selected, trimmed].join(', '));
    // Persist the email on the opp so the tag survives a lost/stale
    // HubSpot cache. Tags without a known email store nothing.
    const e = String(email || '').trim();
    if (e && onChangeEmails) {
      onChangeEmails({ ...storedEmails, [trimmed.toLowerCase()]: e });
    }
  }

  function untag(name) {
    const key = String(name || '').toLowerCase();
    onChange(selected.filter(s => s.toLowerCase() !== key).join(', '));
    if (onChangeEmails && key in storedEmails) {
      const next = { ...storedEmails };
      delete next[key];
      onChangeEmails(next);
    }
  }

  // Custom tag — used by the "not from this company" path. Just adds
  // the typed name to this opp's tag list without touching the
  // prospect roster, so a one-off contact (consultant, broker,
  // someone at a different account) can ride along on this opp. When
  // the typed text is itself an email address, store it as the tag's
  // email too so it keeps rendering as an email.
  function tagCustom() {
    const name = customDraft.trim();
    if (!name) return;
    tagName(name, name.includes('@') ? name : '');
    setCustomDraft('');
  }

  const accountSelected = !!String(account || '').trim();
  const isEmpty = selected.length === 0;

  // Map tagged names back to their roster entry so the cell can show
  // emails (preferred) instead of names. Falls back to the raw tag
  // text when a tag doesn't resolve to a known contact.
  const contactByName = useMemo(() => {
    const map = new Map();
    for (const c of contactOptions) map.set(c.name.toLowerCase(), c);
    return map;
  }, [contactOptions]);

  // Resolve each tag's email: the live roster wins (freshest data), the
  // opp-stored map is the fallback that survives a lost HubSpot cache, and
  // a tag that is itself an email address renders as one.
  const taggedDetails = useMemo(() => selected.map(name => {
    const key = name.toLowerCase();
    const found = contactByName.get(key);
    const email = found?.email || storedEmails[key] || (name.includes('@') ? name : '');
    return { name, email };
  }), [selected, contactByName, storedEmails]);

  const displayString = useMemo(() => taggedDetails
    .map(t => t.email || t.name)
    .filter(Boolean)
    .join(', '), [taggedDetails]);

  function copyToClipboard(text, key) {
    if (!text) return;
    const writer = navigator?.clipboard?.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error('clipboard unavailable'));
    Promise.resolve(writer)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1100);
      })
      .catch(() => { /* clipboard blocked — user can still highlight manually */ });
  }

  const emailsOnly = taggedDetails.map(t => t.email).filter(Boolean).join(', ');
  const namesAndEmails = taggedDetails
    .map(t => t.email ? `${t.name} <${t.email}>` : t.name)
    .join('\n');

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, minHeight: '1em', minWidth: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        onClick={() => {
          if (isEmpty && !accountSelected) return;
          setOpen(o => !o);
        }}
        style={{
          flex: 1, minWidth: 0,
          cursor: (isEmpty && !accountSelected) ? 'default' : 'pointer',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          display: 'block',
        }}
        title={isEmpty
          ? (accountSelected ? 'Click to tag contacts' : 'Pick an Account first')
          : 'Click to view / copy contact details'}
      >
        {isEmpty ? '—' : displayString}
      </span>
      {/* The + Contacts pill only shows when the column is empty — once
          contacts are tagged, the user clicks the email list itself to
          open the same popover and the pill would just be noise. */}
      {accountSelected && isEmpty && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            padding: '1px 6px', fontSize: '0.7rem', fontFamily: 'inherit',
            fontWeight: 600, color: '#166534', background: '#DCFCE7',
            border: '1px solid #86EFAC', borderRadius: 999, cursor: 'pointer',
            whiteSpace: 'nowrap', lineHeight: 1.4, flex: '0 0 auto',
          }}
          title="Tag contacts from this company"
        >+ Contacts</button>
      )}
      {open && createPortal(
        <div
          ref={popRef}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            ...(popPos.top != null ? { top: popPos.top } : {}),
            ...(popPos.bottom != null ? { bottom: popPos.bottom } : {}),
            left: popPos.left,
            zIndex: 9999, width: 380, maxWidth: '92vw',
            maxHeight: popPos.maxHeight, overflowY: 'auto',
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
            fontSize: '0.85rem',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.5rem 0.6rem',
            borderBottom: '1px solid var(--color-border-light)',
          }}>
            <div>
              <div style={{
                fontSize: '0.72rem', color: 'var(--color-text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
              }}>
                Tagged Contacts ({selected.length})
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text)', marginTop: 1 }}>
                {onOpenCompany && matched ? (
                  <button
                    type="button"
                    onClick={() => { onOpenCompany(matched); setOpen(false); }}
                    title={`Open ${matched.company || account}'s company page`}
                    style={{
                      padding: 0, border: 'none', background: 'transparent',
                      fontFamily: 'inherit', fontSize: 'inherit', color: '#2563EB',
                      fontWeight: 600, cursor: 'pointer',
                      textDecoration: 'underline', textDecorationColor: '#93C5FD',
                      textUnderlineOffset: '2px',
                    }}
                  >{matched.company || account}</button>
                ) : (matched?.company || account || '—')}
              </div>
            </div>
            {!isEmpty && (
              <button
                type="button"
                onClick={() => { onChange(''); if (onChangeEmails) onChangeEmails({}); }}
                style={{
                  padding: '0.25rem 0.55rem', fontSize: '0.7rem', fontWeight: 600,
                  fontFamily: 'inherit', color: 'var(--color-text-muted)',
                  background: 'transparent', border: '1px solid var(--color-border)',
                  borderRadius: 3, cursor: 'pointer',
                }}
                title="Remove all tagged contacts"
              >Clear all</button>
            )}
          </div>

          {!isEmpty && (
            <>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {taggedDetails.map((t, idx) => {
                  const key = `row-${idx}`;
                  return (
                    <div
                      key={`${t.name}-${idx}`}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                        padding: '0.45rem 0.7rem',
                        borderBottom: '1px solid var(--color-border-light)',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {onOpenContact ? (
                          <button
                            type="button"
                            onClick={() => { onOpenContact(t.name, t.email); setOpen(false); }}
                            title={`Open ${t.name}'s details`}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              padding: 0, border: 'none', background: 'transparent',
                              fontFamily: 'inherit', fontSize: 'inherit',
                              fontWeight: 600, color: '#2563EB', cursor: 'pointer',
                              textDecoration: 'underline', textDecorationColor: '#93C5FD',
                              textUnderlineOffset: '2px',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                          >{t.name}</button>
                        ) : (
                          <div style={{
                            fontWeight: 600, color: '#1E293B',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>{t.name}</div>
                        )}
                        <div style={{
                          fontSize: '0.75rem',
                          color: t.email ? 'var(--color-text-muted)' : '#94A3B8',
                          fontStyle: t.email ? 'normal' : 'italic',
                          userSelect: 'text',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>{t.email || '(no email)'}</div>
                      </div>
                      {t.email && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(t.email, key)}
                          style={{
                            flex: '0 0 auto',
                            padding: '0.2rem 0.55rem', fontSize: '0.7rem', fontWeight: 600,
                            fontFamily: 'inherit',
                            color: copied === key ? '#166534' : 'var(--color-text-muted)',
                            background: copied === key ? '#DCFCE7' : 'transparent',
                            border: '1px solid var(--color-border)', borderRadius: 3,
                            cursor: 'pointer',
                          }}
                        >{copied === key ? 'Copied' : 'Copy'}</button>
                      )}
                      <button
                        type="button"
                        onClick={() => untag(t.name)}
                        title="Remove this tag"
                        style={{
                          flex: '0 0 auto',
                          width: 22, height: 22, padding: 0,
                          fontSize: '0.9rem', fontWeight: 600,
                          fontFamily: 'inherit', lineHeight: 1,
                          color: 'var(--color-text-muted)',
                          background: 'transparent',
                          border: '1px solid var(--color-border)', borderRadius: 3,
                          cursor: 'pointer',
                        }}
                      >×</button>
                    </div>
                  );
                })}
              </div>
              <div style={{
                display: 'flex', justifyContent: 'flex-end', gap: '0.4rem',
                padding: '0.4rem 0.6rem',
                borderBottom: '1px solid var(--color-border-light)',
                background: 'var(--color-bg)',
              }}>
                <button
                  type="button"
                  onClick={() => copyToClipboard(emailsOnly, 'all-emails')}
                  disabled={!emailsOnly}
                  style={{
                    padding: '0.25rem 0.6rem', fontSize: '0.72rem', fontWeight: 600,
                    fontFamily: 'inherit',
                    color: copied === 'all-emails' ? '#166534' : 'var(--color-text-muted)',
                    background: copied === 'all-emails' ? '#DCFCE7' : 'transparent',
                    border: '1px solid var(--color-border)', borderRadius: 3,
                    cursor: emailsOnly ? 'pointer' : 'not-allowed',
                    opacity: emailsOnly ? 1 : 0.5,
                  }}
                >{copied === 'all-emails' ? 'Copied' : 'Copy emails'}</button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(namesAndEmails, 'all-pairs')}
                  style={{
                    padding: '0.25rem 0.6rem', fontSize: '0.72rem', fontWeight: 600,
                    fontFamily: 'inherit',
                    color: copied === 'all-pairs' ? '#166534' : 'var(--color-text-muted)',
                    background: copied === 'all-pairs' ? '#DCFCE7' : 'transparent',
                    border: '1px solid var(--color-border)', borderRadius: 3,
                    cursor: 'pointer',
                  }}
                >{copied === 'all-pairs' ? 'Copied' : 'Copy names + emails'}</button>
              </div>
            </>
          )}

          {/* Add from the company's existing roster. */}
          <div style={{ padding: '0.5rem 0.6rem' }}>
            <div style={{
              fontSize: '0.7rem', color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
              marginBottom: '0.3rem',
            }}>
              + Add from {matched?.company || account || 'this company'}
              {peLabel && <> &amp; {peLabel} <span style={{ color: '#7C3AED' }}>(PE Owner)</span></>}
            </div>
            <input
              type="text"
              value={query}
              placeholder="Filter contacts…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
              }}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid var(--color-border)', borderRadius: 3,
                padding: '5px 8px', fontSize: 'inherit', fontFamily: 'inherit',
                color: 'var(--color-text)', background: '#fff',
              }}
            />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', borderTop: '1px solid var(--color-border-light)' }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '0.6rem 0.7rem', color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                {contactOptions.length === 0
                  ? 'No contacts on file for this company yet.'
                  : 'No contacts match the filter.'}
              </div>
            ) : filteredOptions.map(opt => {
              const isTagged = selectedSet.has(opt.name.toLowerCase());
              return (
                <div
                  key={opt.name}
                  onClick={() => isTagged ? untag(opt.name) : tagName(opt.name, opt.email)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.55rem',
                    padding: '0.4rem 0.7rem', cursor: 'pointer',
                    background: isTagged ? '#DCFCE7' : 'transparent',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      color: isTagged ? '#166534' : '#1E293B',
                      fontWeight: isTagged ? 600 : 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {opt.name}
                      {opt.source === 'pe' && (
                        <span
                          title={`PE Owner — ${opt.company}`}
                          style={{
                            marginLeft: 6, padding: '0 5px', fontSize: '0.62rem', fontWeight: 700,
                            color: '#6D28D9', background: '#F3E8FF', border: '1px solid #DDD6FE',
                            borderRadius: 999, verticalAlign: 'middle', whiteSpace: 'nowrap',
                          }}
                        >PE</span>
                      )}
                    </div>
                    {opt.email && (
                      <div style={{
                        fontSize: '0.72rem',
                        color: isTagged ? '#15803D' : 'var(--color-text-muted)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{opt.email}</div>
                    )}
                  </span>
                  <span style={{
                    flex: '0 0 auto', fontSize: '0.7rem', fontWeight: 600,
                    color: isTagged ? '#15803D' : 'var(--color-text-muted)',
                  }}>{isTagged ? '✓ Tagged' : '+ Add'}</span>
                </div>
              );
            })}
          </div>

          {/* Custom contact — someone NOT from this company. Just tags
              the name on this opp; doesn't touch the prospect roster. */}
          <div style={{
            padding: '0.5rem 0.6rem',
            borderTop: '1px solid var(--color-border-light)',
            background: 'var(--color-bg)',
          }}>
            <div style={{
              fontSize: '0.7rem', color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
              marginBottom: '0.3rem',
            }}>
              + Add custom contact (not from this company)
            </div>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                type="text"
                value={customDraft}
                placeholder="Name…"
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
                  if (e.key === 'Enter') { e.preventDefault(); tagCustom(); }
                }}
                style={{
                  flex: 1, minWidth: 0, boxSizing: 'border-box',
                  border: '1px solid var(--color-border)', borderRadius: 3,
                  padding: '5px 8px', fontSize: 'inherit', fontFamily: 'inherit',
                  color: 'var(--color-text)', background: '#fff',
                }}
              />
              <button
                type="button"
                onClick={tagCustom}
                disabled={!customDraft.trim()}
                style={{
                  padding: '0.25rem 0.7rem', background: 'var(--color-accent)',
                  border: '1px solid var(--color-accent)', borderRadius: 3,
                  fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
                  color: '#fff',
                  cursor: customDraft.trim() ? 'pointer' : 'not-allowed',
                  opacity: customDraft.trim() ? 1 : 0.5,
                }}
              >Add</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Default column → list bindings for Opps 2 — preserve the original
// hard-coded behavior for new users. The user can override or extend
// these per column from the "Link columns" modal; picks made there
// (including an explicit `none`) win over these defaults.
const DEFAULT_COLUMN_LINKS = {
  Scope:  { listKey: 'solutions',    mode: 'multi'  },
  Source: { listKey: 'source',       mode: 'single' },
  Stage:  { listKey: 'status',       mode: 'single' },
  Status: { listKey: 'whoIsWaiting', mode: 'single' },
  'Chance?': { listKey: 'chance',    mode: 'single' },
};

// Thin wrapper around the shared resolver so existing call sites in
// this file don't need to thread DEFAULT_COLUMN_LINKS through every
// invocation.
function resolveColumnLink(columnName, userLinks) {
  return resolveSharedColumnLink(columnName, userLinks, DEFAULT_COLUMN_LINKS);
}


// Modal that fires right before a new opp is committed. Collects the
// fields the user wants set up front — Company (Account), Source,
// company Type, and PE Owner — instead of leaving them blank for inline
// editing. The Company and PE Owner inputs autocomplete from the same
// suggestion lists their table cells use (Table View companies + names
// already on this tab); Type prefills from the matched Table View
// record so it can be reviewed (and corrected) as part of the flow.
// When the typed Company doesn't already exist in Table View, the modal
// offers to add it there as a new company so the two views stay in
// sync. Account may be pre-filled when the flow came from the Add
// Company combobox.
function NewOppModal({ account: initialAccount, sourceOptions = [], companySuggestions = [], peOwnerSuggestions = [], prospects = [], onCreate, onCancel }) {
  const [company, setCompany] = useState(initialAccount || '');
  const [source, setSource] = useState('');
  // PE Owners as a chip list (a company can have several). Until the
  // user edits, the chips derive from the matched Table View company
  // (see `peOwners` below), so changing the Company re-prefills them
  // without a sync effect. The draft buffers the owner being typed.
  const [peOwnersInput, setPeOwnersInput] = useState([]);
  const [peOwnerDraft, setPeOwnerDraft] = useState('');
  const [peOwnerTouched, setPeOwnerTouched] = useState(false);
  // Same touched-buffer pattern for the company Type.
  const [typeInput, setTypeInput] = useState('');
  const [typeTouched, setTypeTouched] = useState(false);
  const [addToTableView, setAddToTableView] = useState(true);

  const trimmedCompany = company.trim();
  const matchedProspect = useMemo(
    () => (trimmedCompany ? findProspectForAccount(trimmedCompany, prospects) : null),
    [trimmedCompany, prospects],
  );
  const companyExists = !!matchedProspect;
  const companyType = String(matchedProspect?.type || '').trim();
  // Only meaningful when the Company is new (not yet in Table View).
  const canAddCompany = !!trimmedCompany && !companyExists;
  // Prefill the PE Owners from the matched Table View company until the
  // user edits the chips.
  const peOwners = peOwnerTouched ? peOwnersInput : splitPeOwners(matchedProspect?.peOwner || '');
  function addPeOwner(text) {
    const next = [...peOwners];
    for (const part of splitPeOwners(text)) {
      if (!next.some(o => o.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    setPeOwnerTouched(true);
    setPeOwnersInput(next);
    setPeOwnerDraft('');
  }
  function removePeOwner(name) {
    setPeOwnerTouched(true);
    setPeOwnersInput(peOwners.filter(o => o !== name));
  }
  const peOwnerSuggestionSet = useMemo(
    () => new Set(peOwnerSuggestions.map(s => String(s).toLowerCase())),
    [peOwnerSuggestions],
  );
  // Prefill Type from the matched Table View company until the user
  // picks their own value.
  const type = typeTouched ? typeInput : companyType;

  // Company context shown once a company is entered: its CDM and account
  // Tier (from the Table View record) plus the frameworks it's associated
  // with on the Lists page. computeListFlags merges the Lists-page mappings
  // with the prospect's manual frameworks, keyed by lowercased company name.
  const cdm = String(matchedProspect?.cdm || '').trim();
  const tier = String(matchedProspect?.tier || '').trim();
  const [flaggedFrameworks, setFlaggedFrameworks] = useState([]);
  // User edits to the framework flags, scoped to the company they were
  // made for so changing the Company resets to that company's computed
  // flags (and a background prospects refresh can't clobber the edit).
  const [frameworkEdit, setFrameworkEdit] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!trimmedCompany) { if (!cancelled) setFlaggedFrameworks([]); return; }
      try {
        const flags = await computeListFlags([trimmedCompany], { prospects });
        if (cancelled) return;
        const set = flags.get(trimmedCompany.toLowerCase().trim()) || new Set();
        setFlaggedFrameworks([...set].sort((a, b) => a.localeCompare(b)));
      } catch {
        if (!cancelled) setFlaggedFrameworks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [trimmedCompany, prospects]);
  const frameworks = (frameworkEdit && frameworkEdit.company === trimmedCompany)
    ? frameworkEdit.list
    : flaggedFrameworks;
  const frameworksEdited = !!(frameworkEdit && frameworkEdit.company === trimmedCompany)
    && (frameworks.length !== flaggedFrameworks.length || frameworks.some(f => !flaggedFrameworks.includes(f)));
  function toggleFramework(label) {
    const next = frameworks.includes(label)
      ? frameworks.filter(f => f !== label)
      : [...frameworks, label].sort((a, b) => a.localeCompare(b));
    setFrameworkEdit({ company: trimmedCompany, list: next });
  }
  // Keep a saved non-standard framework label selectable so editing
  // doesn't silently drop it.
  const frameworkOptions = useMemo(
    () => [...FRAMEWORKS, ...frameworks.filter(f => !FRAMEWORKS.includes(f))],
    [frameworks],
  );

  // Show the context panel once a company name is typed, so the
  // framework flags are selectable even for brand-new companies.
  const showCompanyInfo = !!trimmedCompany;

  function submit() {
    // Fold in a typed-but-uncommitted draft so an owner the user didn't
    // chip (no Enter / suggestion pick) still lands on the opp.
    const owners = [...peOwners];
    for (const part of splitPeOwners(peOwnerDraft)) {
      if (!owners.some(o => o.toLowerCase() === part.toLowerCase())) owners.push(part);
    }
    onCreate({
      company: trimmedCompany,
      source,
      peOwner: joinPeOwners(owners),
      type: type.trim(),
      frameworks,
      frameworksEdited,
      addToTableView: canAddCompany && addToTableView,
    });
  }

  const labelStyle = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 4, display: 'block' };
  const fieldStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        style={{
          width: 440, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
        }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            New Opp
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            Set the Company, Source, Type, and PE Owner for the new row. All are optional and editable later.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div>
            <label style={labelStyle}>Company</label>
            <input
              autoFocus
              type="text"
              list="newopp-company-list"
              value={company}
              placeholder="Company name…"
              onChange={(e) => setCompany(e.target.value)}
              style={fieldStyle}
            />
            <datalist id="newopp-company-list">
              {companySuggestions.map(c => <option key={c} value={c} />)}
            </datalist>
            {trimmedCompany && companyExists && (
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                ✓ In Table View · type:{' '}
                <strong style={{ color: 'var(--color-text)' }}>{companyType || 'Unknown'}</strong>
              </div>
            )}
            {canAddCompany && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--color-text)', marginTop: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={addToTableView}
                  onChange={(e) => setAddToTableView(e.target.checked)}
                />
                Add <strong>{trimmedCompany}</strong> to Table View (not found there yet)
              </label>
            )}
            {showCompanyInfo && (
              <div style={{
                marginTop: 8, padding: '0.5rem 0.6rem',
                background: 'var(--color-bg)', border: '1px solid var(--color-border-light)',
                borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 4,
                fontSize: '0.74rem', color: 'var(--color-text)',
              }}>
                <div><span style={{ color: 'var(--color-text-muted)' }}>CDM:</span>{' '}<strong>{cdm || '—'}</strong></div>
                <div><span style={{ color: 'var(--color-text-muted)' }}>Tier:</span>{' '}<strong>{tier || '—'}</strong></div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>Frameworks:</span>{' '}
                  <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, verticalAlign: 'top' }}>
                    {frameworkOptions.map(f => {
                      const on = frameworks.includes(f);
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => toggleFramework(f)}
                          title={on ? `Remove the ${f} flag` : `Flag ${f}`}
                          style={{
                            padding: '0px 6px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700,
                            fontFamily: 'inherit', cursor: 'pointer',
                            background: on ? '#EFF6FF' : 'transparent',
                            color: on ? '#1E3A8A' : 'var(--color-text-muted)',
                            border: on ? '1px solid #BFDBFE' : '1px dashed var(--color-border)',
                          }}
                        >{f}</button>
                      );
                    })}
                  </span>
                  {frameworksEdited && companyExists && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 3 }}>
                      Will update <strong>{matchedProspect.company}</strong>&apos;s Frameworks in Table View.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>Source</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              style={fieldStyle}
            >
              <option value="">— Select a Source —</option>
              {sourceOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Type</label>
            <select
              value={type}
              onChange={(e) => { setTypeTouched(true); setTypeInput(e.target.value); }}
              style={fieldStyle}
            >
              <option value="">— Select a Type —</option>
              {/* Keep a saved non-standard type selectable so reviewing it
                  doesn't silently blank the dropdown. */}
              {type && !TYPES.includes(type) && <option value={type}>{type}</option>}
              {TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {companyExists && type !== companyType && (
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                {type
                  ? <>Will set <strong>{matchedProspect.company}</strong>&apos;s Type in Table View to <strong>{type}</strong> (currently <strong>{companyType || 'no type'}</strong>).</>
                  : <>Will clear <strong>{matchedProspect.company}</strong>&apos;s Type in Table View (currently <strong>{companyType}</strong>).</>}
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>PE Owner{peOwners.length > 1 ? 's' : ''}</label>
            {peOwners.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 5 }}>
                {peOwners.map(o => (
                  <span key={o} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '1px 4px 1px 8px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600,
                    background: '#F3E8FF', color: '#6D28D9', border: '1px solid #DDD6FE',
                  }}>
                    {o}
                    <button
                      type="button"
                      onClick={() => removePeOwner(o)}
                      title={`Remove ${o}`}
                      style={{
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        padding: 0, lineHeight: 1, fontSize: '0.78rem', color: '#7C3AED', fontFamily: 'inherit',
                      }}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              list="newopp-peowner-list"
              value={peOwnerDraft}
              placeholder={peOwners.length ? 'Add another PE Owner…' : 'PE Owner (if portfolio co)…'}
              onChange={(e) => {
                const v = e.target.value;
                // Picking a datalist suggestion fires a change with the
                // full name — commit it as a chip right away so another
                // owner can be added after it.
                if (peOwnerSuggestionSet.has(v.trim().toLowerCase())) { addPeOwner(v); return; }
                setPeOwnerDraft(v);
              }}
              onKeyDown={(e) => {
                // Enter or comma commits the typed owner as a chip
                // (Cmd/Ctrl+Enter still submits via the modal handler).
                if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === ',') {
                  if (peOwnerDraft.trim()) { e.preventDefault(); addPeOwner(peOwnerDraft); }
                  else if (e.key === ',') e.preventDefault();
                }
              }}
              style={fieldStyle}
            />
            <datalist id="newopp-peowner-list">
              {peOwnerSuggestions.map(p => <option key={p} value={p} />)}
            </datalist>
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.4rem',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Cancel</button>
          <button
            type="button"
            onClick={submit}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Create opp</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Popup that fires after Stage flips to "Not Sold". Prompts the user to
// fill in the three close-out columns (Close Date, Reason Not Sold,
// Final Margin) so the downstream reporting tabs (AgentsView's
// Not-Sold BFO Status block + PipelineView's Final Margin table) have
// what they need without the user having to remember to hunt for the
// columns after the stage change.
//
// The modal pre-populates with whatever the row already has — the
// Close Date was just auto-stamped to today by updateOppField (when it
// was empty), so it shows up here ready to adjust. Save applies the
// three values via updateOppField (skipping fields the user left
// untouched). Skip leaves the row as-is — Stage is still set to Not
// Sold and the stamped Close Date stays.
function NotSoldFollowUpModal({ opp, reasonOptions, onSave, onClose }) {
  const [closeDate, setCloseDate] = useState(toISODate(opp?.['Close Date']) || '');
  const [reason, setReason] = useState(String(opp?.['Reason Not Sold'] ?? ''));
  const [finalMargin, setFinalMargin] = useState(String(opp?.['Final Margin'] ?? ''));

  function handleSave() {
    onSave({
      closeDate,
      reason,
      finalMargin: finalMargin.trim(),
    });
  }

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  // Only dismiss when the press *started* on the backdrop. Drag-selecting text
  // in a field and releasing the mouse over the dimmed backdrop otherwise fires
  // a click on the overlay that would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          width: 460, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Close out this opportunity
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            <strong>{opp?.['Account'] || 'This opp'}</strong>
            {opp?.['Scope'] ? <> &middot; {opp['Scope']}</> : null}
            {' '}is now marked <strong>Not Sold</strong>. Fill in the close-out details below.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div>
            <label style={labelStyle}>Close Date</label>
            <input
              type="date"
              autoFocus
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Reason Not Sold</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Select a reason —</option>
              {reasonOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Final Margin</label>
            <input
              type="text"
              value={finalMargin}
              onChange={(e) => setFinalMargin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
              }}
              placeholder="e.g. 22% or $4,500"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Skip for now</button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Popup that fires after Stage flips to "Sold". Prompts the user to
// fill in the three close-out columns (Reason Not Sold, Final Margin,
// Competition). The Close Date is set automatically to the date of the
// status change (see updateOppField) and shown here read-only so the
// user knows it was captured. Mirrors the NotSoldFollowUpModal pattern.
function SoldFollowUpModal({ opp, reasonOptions, competitionOptions, onSave, onClose }) {
  const [reason, setReason] = useState(String(opp?.['Reason Not Sold'] ?? ''));
  const [finalMargin, setFinalMargin] = useState(String(opp?.['Final Margin'] ?? ''));
  const [competition, setCompetition] = useState(String(opp?.['Competition'] ?? ''));

  function handleSave() {
    onSave({
      reason,
      finalMargin: finalMargin.trim(),
      competition: competition.trim(),
    });
  }

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  // Only dismiss when the press *started* on the backdrop. Drag-selecting text
  // in a field and releasing the mouse over the dimmed backdrop otherwise fires
  // a click on the overlay that would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          width: 460, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Close out this opportunity
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            <strong>{opp?.['Account'] || 'This opp'}</strong>
            {opp?.['Scope'] ? <> &middot; {opp['Scope']}</> : null}
            {' '}is now marked <strong>Sold</strong>. Fill in the close-out details below.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div>
            <label style={labelStyle}>Close Date</label>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text)' }}>
              {formatDateDisplay(opp?.['Close Date']) || '—'}
              <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginLeft: 6 }}>
                (set to the status-change date)
              </span>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Reason Not Sold</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Select a reason —</option>
              {reasonOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Final Margin</label>
            <input
              type="text"
              autoFocus
              value={finalMargin}
              onChange={(e) => setFinalMargin(e.target.value)}
              placeholder="e.g. 22% or $4,500"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Competition</label>
            <select
              value={competition}
              onChange={(e) => setCompetition(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Select —</option>
              {competitionOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Skip for now</button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Popup that fires when an opp's Stage flips from "Not Started" to
// "Lead". Prompts the user to enter the Quoted Amount on the spot so a
// freshly-activated opp carries a dollar figure into the pipeline.
// Pre-populates with whatever the row already has. Save applies the
// value via updateOppField; Skip leaves the row as-is (Stage is still
// Lead). Mirrors the NotSoldFollowUpModal pattern.
function LeadQuotedAmountModal({ opp, onSave, onClose }) {
  const [quotedAmount, setQuotedAmount] = useState(String(opp?.['Quoted Amount'] ?? ''));

  function handleSave() {
    onSave({ quotedAmount: quotedAmount.trim() });
  }

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  // Only dismiss when the press *started* on the backdrop. Drag-selecting text
  // in a field and releasing the mouse over the dimmed backdrop otherwise fires
  // a click on the overlay that would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          width: 420, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Enter the Deal Size
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            <strong>{opp?.['Account'] || 'This opp'}</strong>
            {opp?.['Scope'] ? <> &middot; {opp['Scope']}</> : null}
            {' '}just moved to <strong>Lead</strong>. Add the Deal Size below.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem' }}>
          <label style={labelStyle}>Deal Size</label>
          <input
            type="text"
            autoFocus
            value={quotedAmount}
            onChange={(e) => setQuotedAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
            }}
            placeholder="e.g. $25,000"
            style={inputStyle}
          />
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Skip for now</button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Prompt shown whenever an opp moves into the "Quoted" stage so the user
// can enter / review the quote-tracking data points (Quoted On, Chance?,
// Margin Email Date - Sales Leader Review Date). Pre-populated with the
// opp's current values (with fallbacks to alternate key names) so it
// doubles as a review screen. Mirrors the NotSoldFollowUpModal pattern.
function QuotedFollowUpModal({ opp, chanceOptions, onSave, onClose }) {
  // Read current values with fallbacks to the alternate key names other
  // views / imported sheets use, so existing data shows up here instead
  // of looking blank. The combined margin/review field also absorbs the
  // two legacy split columns if a row was saved before they merged.
  const curQuotedOn = opp?.['Quoted On'] ?? opp?.['Quoted Date'] ?? '';
  const curChance = opp?.['Chance?'] ?? opp?.['Chance'] ?? '';
  const curMarginReview = opp?.['Margin Email Date - Sales Leader Review Date']
    ?? opp?.['Margin Email Date'] ?? opp?.['Sales Leader Review Date'] ?? '';

  const [quotedOn, setQuotedOn] = useState(toISODate(curQuotedOn) || '');
  const [chance, setChance] = useState(String(curChance ?? ''));
  const [marginReviewDate, setMarginReviewDate] = useState(toISODate(curMarginReview) || '');

  function handleSave() {
    onSave({ quotedOn, chance, marginReviewDate });
  }

  // Shows the value already stored on the opp so the user reviews what's
  // there rather than entering blind. Hidden when there's nothing yet.
  const hintStyle = { fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 3 };
  const dateHint = (raw) => {
    const v = (raw ?? '').toString().trim();
    return v ? <div style={hintStyle}>Currently: {formatDateDisplay(v)}</div> : null;
  };
  const textHint = (raw) => {
    const v = (raw ?? '').toString().trim();
    return v ? <div style={hintStyle}>Currently: {v}</div> : null;
  };

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  // Only dismiss when the press *started* on the backdrop. Drag-selecting text
  // in a field and releasing the mouse over the dimmed backdrop otherwise fires
  // a click on the overlay that would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          width: 460, maxWidth: '92vw',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Quote details
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            <strong>{opp?.['Account'] || 'This opp'}</strong>
            {opp?.['Scope'] ? <> &middot; {opp['Scope']}</> : null}
            {' '}is now <strong>Quoted</strong>. Enter or review the quote-tracking details below.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div>
            <label style={labelStyle}>Quoted On</label>
            <input
              type="date"
              autoFocus
              value={quotedOn}
              onChange={(e) => setQuotedOn(e.target.value)}
              style={inputStyle}
            />
            {dateHint(curQuotedOn)}
          </div>
          <div>
            <label style={labelStyle}>Chance?</label>
            <select
              value={chance}
              onChange={(e) => setChance(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Select —</option>
              {chanceOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            {textHint(curChance)}
          </div>
          <div>
            <label style={labelStyle}>Margin Email Date - Sales Leader Review Date</label>
            <input
              type="date"
              value={marginReviewDate}
              onChange={(e) => setMarginReviewDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
              }}
              style={inputStyle}
            />
            {dateHint(curMarginReview)}
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Skip for now</button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Prompt shown whenever an opp moves into the "Agreement Sent" stage,
// mirroring the QuotedFollowUpModal. Captures the approval / close-out
// data points the team reviews at agreement time: the USD deal size,
// the margin-email / sales-leader-review date, Chance?, whether multiple
// invoices apply, the verbal-email status, and the two approval fields.
// The linked Pricing Option is shown read-only (it's owned by the
// Pricing tab). Cleared on Save or Skip.
function AgreementSentFollowUpModal({
  opp, columnLinks, listRegistry, pricingOptionName, onSave, onClose,
}) {
  // Resolve the dropdown options for a field the exact same way the Opp
  // details popup does — via the user's column-link config against the
  // shared list registry — so a field that edits as a dropdown there
  // (USD?, Entity Outside the US Approval, COA Approval, …) shows the
  // same menu here. When a field has no explicit link we also fall back
  // to a Dropdowns-page list whose name matches the field (normalized, so
  // a "USD" list backs the "USD?" column), which lets a column the user
  // wired up by creating a same-named custom list resolve even without an
  // explicit link. Failing all that, a couple of fields have an obvious
  // canonical list / Yes-No answer; everything else is a plain text input.
  const FALLBACK_LIST_KEYS = { 'Chance?': 'chance', 'Verbal': 'verbal' };
  const FALLBACK_STATIC = { 'Multiple Invoices?': ['Yes', 'No'] };
  const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const optionsFor = (field) => {
    const link = columnLinks ? resolveColumnLink(field, columnLinks) : null;
    if (link && listRegistry) return listRegistry.get(link.listKey)?.options || [];
    if (listRegistry) {
      const target = normName(field);
      for (const list of listRegistry.values()) {
        if (normName(list.label) === target && Array.isArray(list.options) && list.options.length) {
          return list.options;
        }
      }
    }
    const fk = FALLBACK_LIST_KEYS[field];
    if (fk && listRegistry) return listRegistry.get(fk)?.options || [];
    return FALLBACK_STATIC[field] || null;
  };

  // Read current values with fallbacks to the alternate key names other
  // views / imported sheets use, so existing data shows up here instead
  // of looking blank. The combined margin/review field also absorbs the
  // two legacy split columns if a row was saved before they merged.
  const curUsd = opp?.['USD?'] ?? '';
  const curMarginReview = opp?.['Margin Email Date - Sales Leader Review Date']
    ?? opp?.['Margin Email Date'] ?? opp?.['Sales Leader Review Date'] ?? '';
  const curChance = opp?.['Chance?'] ?? opp?.['Chance'] ?? '';
  const curMultiInvoices = opp?.['Multiple Invoices?'] ?? '';
  const curVerbal = opp?.['Verbal'] ?? '';
  const curEntity = opp?.['Entity Outside the US Approval'] ?? '';
  const curCoa = opp?.['COA Approval'] ?? '';

  const [usd, setUsd] = useState(String(curUsd ?? ''));
  const [marginReviewDate, setMarginReviewDate] = useState(toISODate(curMarginReview) || '');
  const [chance, setChance] = useState(String(curChance ?? ''));
  const [multiInvoices, setMultiInvoices] = useState(String(curMultiInvoices ?? ''));
  const [verbal, setVerbal] = useState(String(curVerbal ?? ''));
  const [entity, setEntity] = useState(String(curEntity ?? ''));
  const [coa, setCoa] = useState(String(curCoa ?? ''));

  function handleSave() {
    onSave({ usd, marginReviewDate, chance, multiInvoices, verbal, entity, coa });
  }

  // Render a field as a dropdown when it has resolvable options (matching
  // the Opp details popup), otherwise a free-text input. A stored value
  // that isn't one of the configured options is kept selectable so legacy
  // data doesn't silently drop off the menu — same as SelectCell.
  const fieldInput = (field, val, setVal, { autoFocus = false, onEnter } = {}) => {
    const opts = optionsFor(field);
    if (opts) {
      const cur = String(val ?? '');
      const display = (!cur || opts.includes(cur)) ? opts : [cur, ...opts];
      return (
        <select
          autoFocus={autoFocus}
          value={cur}
          onChange={(e) => setVal(e.target.value)}
          style={inputStyle}
        >
          <option value="">— Select —</option>
          {display.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return (
      <input
        type="text"
        autoFocus={autoFocus}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } } : undefined}
        style={inputStyle}
      />
    );
  };

  // Shows the value already stored on the opp so the user reviews what's
  // there rather than entering blind. Hidden when there's nothing yet.
  const hintStyle = { fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 3 };
  const dateHint = (raw) => {
    const v = (raw ?? '').toString().trim();
    return v ? <div style={hintStyle}>Currently: {formatDateDisplay(v)}</div> : null;
  };
  const textHint = (raw) => {
    const v = (raw ?? '').toString().trim();
    return v ? <div style={hintStyle}>Currently: {v}</div> : null;
  };

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  // Only dismiss when the press *started* on the backdrop. Drag-selecting text
  // in a field and releasing the mouse over the dimmed backdrop otherwise fires
  // a click on the overlay that would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          width: 460, maxWidth: '92vw', maxHeight: '88vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Agreement Sent details
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            <strong>{opp?.['Account'] || 'This opp'}</strong>
            {opp?.['Scope'] ? <> &middot; {opp['Scope']}</> : null}
            {' '}is now <strong>Agreement Sent</strong>. Enter or review the details below.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', overflowY: 'auto' }}>
          <div>
            <label style={labelStyle}>USD?</label>
            {fieldInput('USD?', usd, setUsd, { autoFocus: true })}
            {textHint(curUsd)}
          </div>
          <div>
            <label style={labelStyle}>Margin Email Date - Sales Leader Review Date</label>
            <input
              type="date"
              value={marginReviewDate}
              onChange={(e) => setMarginReviewDate(e.target.value)}
              style={inputStyle}
            />
            {dateHint(curMarginReview)}
          </div>
          <div>
            <label style={labelStyle}>Chance?</label>
            {fieldInput('Chance?', chance, setChance)}
            {textHint(curChance)}
          </div>
          <div>
            <label style={labelStyle}>Multiple Invoices?</label>
            {fieldInput('Multiple Invoices?', multiInvoices, setMultiInvoices)}
            {textHint(curMultiInvoices)}
          </div>
          <div>
            <label style={labelStyle}>Verbal</label>
            {fieldInput('Verbal', verbal, setVerbal)}
            {textHint(curVerbal)}
          </div>
          <div>
            <label style={labelStyle}>Entity Outside the US Approval</label>
            {fieldInput('Entity Outside the US Approval', entity, setEntity)}
            {textHint(curEntity)}
          </div>
          <div>
            <label style={labelStyle}>COA Approval</label>
            {fieldInput('COA Approval', coa, setCoa, { onEnter: handleSave })}
            {textHint(curCoa)}
          </div>
          <div>
            <label style={labelStyle}>Pricing Option</label>
            <div style={{
              ...inputStyle,
              background: 'var(--color-bg)', color: 'var(--color-text-muted)',
              cursor: 'default',
            }}>
              {pricingOptionName || '—'}
            </div>
            <div style={hintStyle}>Read-only — linked from the Pricing tab.</div>
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Skip for now</button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Prompt shown whenever an opp's Follow Up date changes, asking the user
// to pick the new Status (Who is waiting) for that opp so it stays
// current with each follow-up. Cleared on Save or Skip.
function FollowUpStatusModal({ opp, statusOptions, onSave, onClose, onCancel }) {
  const curStatus = opp?.['Status'] ?? '';
  const [status, setStatus] = useState(String(curStatus ?? ''));
  const [salesPartner, setSalesPartner] = useState(String(opp?.['Sales Partner'] ?? ''));

  // Seed the Next Steps rows from the same source the standalone
  // NextStepsEditor uses so this popup edits them in the identical
  // Next Step / Waiting On format. Kept as local state and flattened
  // back on Save.
  const noteLines = useMemo(() => textToBulletItems(opp?.['Next Steps']), [opp]);
  const storedWaiting = Array.isArray(opp?._nextStepsWaiting) ? opp._nextStepsWaiting : [];
  const [rows, setRows] = useState(() => {
    const seed = noteLines.map((note, i) => ({ note, waitingOn: String(storedWaiting[i] || '') }));
    return seed.length > 0 ? seed : [{ note: '', waitingOn: '' }];
  });
  const updateRow = (idx, key, value) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: value } : r));
  const addRow = () => setRows(prev => [...prev, { note: '', waitingOn: '' }]);
  const deleteRow = (idx) => setRows(prev => {
    const next = prev.filter((_, i) => i !== idx);
    return next.length > 0 ? next : [{ note: '', waitingOn: '' }];
  });

  function handleSave() {
    const kept = rows.filter(r => (r.note || '').trim() || (r.waitingOn || '').trim());
    const nextSteps = kept.map(r => encodeNoteLine(r.note)).join('\n');
    const nextStepsWaiting = kept.map(r => (r.waitingOn || '').trim());
    onSave({ status, nextSteps, nextStepsWaiting, salesPartner: salesPartner.trim() });
  }

  const hintStyle = { fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: 3 };
  const textHint = (raw) => {
    const v = (raw ?? '').toString().trim();
    return v ? <div style={hintStyle}>Currently: {v}</div> : null;
  };

  const labelStyle = { fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: 4 };
  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '0.45rem 0.55rem',
    border: '1px solid var(--color-border)', borderRadius: 4,
    fontSize: '0.85rem', fontFamily: 'inherit',
    background: '#fff', color: 'var(--color-text)',
  };

  // Only dismiss when the press *started* on the backdrop. Drag-selecting text
  // in a field and releasing the mouse over the dimmed backdrop otherwise fires
  // a click on the overlay that would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        style={{
          width: 'min(820px, 94vw)', maxHeight: '88vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Update Status
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            <strong>{opp?.['Account'] || 'This opp'}</strong>
            {opp?.['Scope'] ? <> &middot; {opp['Scope']}</> : null}
            {' '}has a new <strong>Follow Up</strong> date. Pick the current Status and review the Notes below.
          </div>
        </div>

        <div style={{ padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', overflow: 'auto' }}>
          <div>
            <label style={labelStyle}>Status</label>
            <select
              autoFocus
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Select —</option>
              {statusOptions.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            {textHint(curStatus)}
          </div>
          <div>
            <label style={labelStyle}>Sales Partner</label>
            <input
              type="text"
              value={salesPartner}
              onChange={(e) => setSalesPartner(e.target.value)}
              placeholder="—"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <NextStepsRowsEditor
              rows={rows}
              onUpdateRow={updateRow}
              onAddRow={addRow}
              onDeleteRow={deleteRow}
              onCommit={() => {}}
              onQuickWaiting={(idx, value) => updateRow(idx, 'waitingOn', value)}
            />
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem',
          borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)',
        }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={onCancel}
              title="Put the Follow Up date back to what it was before this edit."
              style={{
                padding: '0.35rem 0.7rem', background: 'transparent',
                border: '1px solid var(--color-border)', borderRadius: 4,
                fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >Cancel</button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.35rem 0.7rem', background: 'transparent',
                border: '1px solid var(--color-border)', borderRadius: 4,
                fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >Skip for now</button>
          </div>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Popup that shows the basic info for one opp + a Delete button. Opened
// from the row-level info button so the user can eyeball the full record
// without having to hunt through the (often horizontally scrolled) row.
export function OppInfoModal({
  opp,
  headers,
  onClose,
  onDelete,
  onFieldChange,
  columnLinks,
  listRegistry,
  companySuggestions,
  peOwnerSuggestions,
  prospects,
  updateProspect,
  hubspotContacts,
  pricingOptionServices,
  pricingOptionLinkName,
  onOpenContact,
  onOpenCompany,
}) {
  // Globally-hidden detail rows (header fields) + a session toggle to
  // temporarily reveal them. Declared before the early return so the
  // hook order stays stable. The hidden set is a global preference, so
  // toggling a row here hides/shows it on every opp's detail popup.
  const [hiddenFields, setHiddenFields] = useState(() => loadHiddenDetailFields());
  const [showHiddenRows, setShowHiddenRows] = useState(false);
  const toggleDetailField = useCallback((field) => {
    setHiddenFields(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field); else next.add(field);
      saveHiddenDetailFields(next);
      return next;
    });
  }, []);
  if (!opp) return null;
  // Show every header column the row has a value for, in the same order
  // the table presents them, so the popup matches the user's mental
  // model of the row. Computed columns are pulled from the live row
  // (the parent computes them into the opp before passing it in).
  // Guarantee "BFO Company Name" shows here and sits right after the
  // BFO Opportunity Name (BFO Link) field — saved layouts that predate
  // the column would otherwise bury it at the very end (or omit it
  // until the next hydration appends it).
  const orderedFields = (headers || [])
    .filter(h => h && h !== '_select' && h !== '_info' && h !== '_actions' && h !== 'BFO Company Name');
  {
    const idx = orderedFields.indexOf('BFO Link');
    if (idx >= 0) orderedFields.splice(idx + 1, 0, 'BFO Company Name');
    else orderedFields.push('BFO Company Name');
  }
  // Count of currently-hidden rows among the fields this opp actually
  // shows, so the "Show N hidden" toggle reflects what's collapsed here.
  const hiddenCount = orderedFields.filter(h => hiddenFields.has(h)).length;
  const formatValue = (key, raw) => {
    if (raw == null || raw === '') return '—';
    if (DATE_COLUMNS.has(key)) return formatDateDisplay(raw);
    return String(raw);
  };
  const renderEditor = (h) => {
    const value = opp[h];
    // Computed columns stay read-only — they're derived from sibling
    // fields and don't have a stored value to edit.
    if (h === 'Call In' || h === 'Last Spoke') {
      return (
        <span style={{ color: 'var(--color-text-muted)' }}>
          {value == null || value === '' ? '—' : String(value)}
        </span>
      );
    }
    // Sourced from the matching Table View company, independent of the
    // opp's own edit callback, so it works even in the read-only modal.
    if (h === 'BFO Company Name') {
      return <BfoCompanyNameCell account={opp['Account']} prospects={prospects} updateProspect={updateProspect} />;
    }
    if (!onFieldChange) {
      // Fallback to the original read-only renderer when the modal is
      // mounted without an edit callback.
      return <span>{formatValue(h, value)}</span>;
    }
    const onChange = (v) => onFieldChange(h, v);
    if (DATE_COLUMNS.has(h)) {
      return <DateCell value={value} onChange={onChange} />;
    }
    if (TRISTATE_COLUMNS.has(h)) {
      return <TristateCheckCell value={value} onChange={onChange} title={`${h}: blank → ✓ → ✗ → blank`} />;
    }
    const link = columnLinks ? resolveColumnLink(h, columnLinks) : null;
    if (link && listRegistry) {
      const opts = listRegistry.get(link.listKey)?.options || [];
      if (link.mode === 'multi') {
        const extraGroups = link.listKey === 'solutions'
          ? Object.entries(pricingOptionServices || {})
              .map(([sheetName, services]) => ({
                label: sheetName,
                options: Array.isArray(services) ? services : [],
              }))
              .filter(g => g.options.length > 0)
              .sort((a, b) => a.label.localeCompare(b.label))
          : undefined;
        return (
          <MultiSelectCell
            value={value}
            onChange={onChange}
            options={opts}
            extraGroups={extraGroups}
            extraGroupsLabel="Add from Pricing Option"
            extraGroupsPlaceholder="— pick an option —"
            nowrap={h === 'Scope'}
          />
        );
      }
      return <SelectCell value={value} onChange={onChange} options={opts} />;
    }
    if (h === 'Contact') {
      return (
        <ContactCell
          value={value}
          onChange={onChange}
          account={opp['Account']}
          peOwner={opp['PE Owner']}
          prospects={prospects}
          updateProspect={updateProspect}
          hubspotContacts={hubspotContacts}
          onOpenContact={onOpenContact}
          onOpenCompany={onOpenCompany}
          contactEmails={opp._contactEmails}
          onChangeEmails={(m) => onFieldChange('_contactEmails', m)}
        />
      );
    }
    return (
      <EditableCell
        value={value}
        onChange={onChange}
        suggestions={h === 'Account' ? companySuggestions : h === 'PE Owner' ? peOwnerSuggestions : undefined}
      />
    );
  };
  // Only dismiss when the press *started* on the backdrop, so drag-selecting
  // text in a field and releasing over the backdrop doesn't close the popup.
  const backdropMouseDown = useRef(false);

  return createPortal(
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 1100, maxWidth: '94vw', maxHeight: '92vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '0.7rem', color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 600,
            }}>Opp details</div>
            <div style={{
              fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {String(opp['Account'] || '').trim() || '(no account)'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.3rem 0.65rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Close</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '0.5rem 1rem 0.75rem' }}>
          {needsUsdFlag(opp) && (
            // Same rule as the Flags-column 🚩: deal is Qualifying or
            // later but USD? has no real value. Surfaced here too so it's
            // visible even when the Flags column is hidden in the table.
            <div style={{
              margin: '0.25rem 0 0.75rem',
              padding: '0.6rem 0.8rem',
              border: '1px solid #FCA5A5', borderRadius: 6,
              background: '#FEF2F2', fontSize: '0.8rem',
              color: '#991B1B', lineHeight: 1.4,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>🚩</span>
              <span>
                <strong>Missing USD value.</strong> This opp is at the{' '}
                <strong>{String(opp['Stage'] || '').trim() || 'current'}</strong> stage but the{' '}
                <strong>USD?</strong> field is blank or “-”. Fill it in to clear the flag.
              </span>
            </div>
          )}
          {opp._pricingOption ? (
            <div style={{ margin: '0.25rem 0 0.75rem' }}>
              <div style={{
                fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em',
                color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '0.35rem',
              }}>Pricing Option (saved snapshot)</div>
              <PricingOptionSnapshotView snapshot={opp._pricingOption} />
            </div>
          ) : pricingOptionLinkName ? (
            // Linked to a Pricing Option by name, but no saved snapshot
            // on the record yet — likely a link created before the
            // snapshot feature shipped. Tell the user how to recapture.
            <div style={{
              margin: '0.25rem 0 0.75rem',
              padding: '0.6rem 0.8rem',
              border: '1px dashed var(--color-border)', borderRadius: 6,
              background: '#fff8e1', fontSize: '0.8rem',
              color: '#92400e', lineHeight: 1.4,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                Linked to <em>{pricingOptionLinkName}</em>, but no saved snapshot here yet.
              </div>
              <div>
                Open the Pricing tab, find that option, and click <strong>Save to Opp…</strong>
                again to capture the rows + Year 1 fees onto this opp. The new save
                will appear here.
              </div>
            </div>
          ) : null}
          {hiddenCount > 0 && (
            <div style={{
              display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
              margin: '0 0 0.35rem',
            }}>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: '0.74rem', color: 'var(--color-text-muted)',
                fontWeight: 600, cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={showHiddenRows}
                  onChange={e => setShowHiddenRows(e.target.checked)}
                />
                Show {hiddenCount} hidden {hiddenCount === 1 ? 'row' : 'rows'}
              </label>
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <tbody>
              {orderedFields.map(h => {
                const isHidden = hiddenFields.has(h);
                if (isHidden && !showHiddenRows) return null;
                const label = headerLabel(h);
                return (
                  <tr key={h} style={{
                    borderTop: '1px solid var(--color-border-light)',
                    opacity: isHidden ? 0.5 : undefined,
                  }}>
                    <td style={{
                      padding: '0.45rem 0.4rem 0.45rem 0',
                      width: 24, verticalAlign: 'top',
                    }}>
                      <button
                        type="button"
                        onClick={() => toggleDetailField(h)}
                        title={isHidden
                          ? `Show "${label}" on every opp's details`
                          : `Hide "${label}" on every opp's details`}
                        aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
                        style={{
                          width: 18, height: 18, lineHeight: '16px',
                          padding: 0, borderRadius: 4,
                          border: '1px solid var(--color-border)',
                          background: isHidden ? '#E2E8F0' : 'transparent',
                          color: 'var(--color-text-muted)',
                          fontSize: '0.72rem', fontFamily: 'inherit',
                          cursor: 'pointer', display: 'block',
                        }}
                      >{isHidden ? '+' : '×'}</button>
                    </td>
                    <td style={{
                      padding: '0.45rem 0.5rem 0.45rem 0',
                      fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em',
                      color: 'var(--color-text-muted)', fontWeight: 600,
                      width: 170, verticalAlign: 'top',
                    }}>{label}</td>
                    <td style={{
                      padding: '0.45rem 0',
                      color: 'var(--color-text)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>{renderEditor(h)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem', borderTop: '1px solid var(--color-border-light)',
          background: 'var(--color-bg)',
        }}>
          {onDelete ? (
            <button
              type="button"
              onClick={() => {
                const label = String(opp['Account'] || '').trim() || 'this opp';
                if (window.confirm(`Delete ${label}? This can't be undone.`)) {
                  onDelete(opp._id);
                  onClose();
                }
              }}
              style={{
                padding: '0.4rem 0.85rem', background: '#FEE2E2',
                border: '1px solid #FCA5A5', borderRadius: 4,
                fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                color: '#B91C1C', cursor: 'pointer',
              }}
            >Delete opp</button>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.4rem 0.95rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Toolbar that pops in above the table once 1+ rows are checked. Lets
// the user push a single value into every selected opp at once (Stage,
// Status, Source, Scope, etc.) or bulk-delete them. The field list is
// driven by the column header set so it tracks whatever columns the
// user currently has + any list bindings they've set up.
function MassEditBar({ selectedCount, headers, columnLinks, listRegistry, onApply, onDelete, onClear, onEmailTable }) {
  const editableFields = useMemo(() => {
    const out = [];
    for (const h of headers || []) {
      if (!h || h === '_select' || h === '_info' || h === '_actions') continue;
      if (COMPUTED_COLUMNS.includes(h)) continue;
      out.push(h);
    }
    return out;
  }, [headers]);
  const [field, setField] = useState('Stage');
  const [textValue, setTextValue] = useState('');
  const [multiValue, setMultiValue] = useState('');
  // Whichever field is picked, reset both value buffers so a stale
  // value from the previous field doesn't get applied by accident.
  useEffect(() => { setTextValue(''); setMultiValue(''); }, [field]);

  const link = resolveColumnLink(field, columnLinks);
  const isDate = DATE_COLUMNS.has(field);
  const listOptions = link ? (listRegistry?.get(link.listKey)?.options || []) : null;
  const valueToApply = link && link.mode === 'multi' ? multiValue : textValue;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
      margin: '0 1.25rem 0.5rem',
      padding: '0.5rem 0.75rem',
      background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6,
      fontSize: '0.82rem',
    }}>
      <span style={{ fontWeight: 700, color: '#1E3A8A' }}>
        {selectedCount} selected
      </span>
      <span style={{ color: 'var(--color-text-muted)' }}>·</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ color: 'var(--color-text-muted)' }}>Set</span>
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          style={{
            padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        >
          {editableFields.map(h => (
            <option key={h} value={h}>{headerLabel(h)}</option>
          ))}
        </select>
      </label>
      <span style={{ color: 'var(--color-text-muted)' }}>to</span>
      {link && link.mode === 'multi' ? (
        <select
          multiple
          value={parseMulti(multiValue)}
          onChange={(e) => {
            const picked = Array.from(e.target.selectedOptions).map(o => o.value);
            setMultiValue(picked.join(', '));
          }}
          size={Math.min(6, Math.max(3, (listOptions || []).length))}
          style={{
            minWidth: 200, padding: '0.25rem 0.4rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        >
          {(listOptions || []).map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : link ? (
        <select
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          style={{
            minWidth: 180, padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        >
          <option value="">— pick a value —</option>
          {(listOptions || []).map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : isDate ? (
        <input
          type="date"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          style={{
            padding: '0.25rem 0.4rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        />
      ) : (
        <input
          type="text"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder="New value (blank to clear)"
          style={{
            minWidth: 200, padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        />
      )}
      <button
        type="button"
        onClick={() => onApply(field, valueToApply)}
        style={{
          padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
          border: '1px solid var(--color-accent)', borderRadius: 4,
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          color: '#fff', cursor: 'pointer',
        }}
      >Apply to {selectedCount}</button>
      <button
        type="button"
        onClick={onEmailTable}
        title="Build a plain bordered table of the selected opps (choose which columns), ready to paste into an email"
        style={{
          padding: '0.35rem 0.7rem', background: '#fff',
          border: '1px solid #009530', borderRadius: 4,
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          color: '#009530', cursor: 'pointer',
        }}
      >Email table</button>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Delete ${selectedCount} selected opp${selectedCount === 1 ? '' : 's'}? This can't be undone.`)) {
            onDelete();
          }
        }}
        style={{
          padding: '0.35rem 0.7rem', background: '#FEE2E2',
          border: '1px solid #FCA5A5', borderRadius: 4,
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          color: '#B91C1C', cursor: 'pointer',
        }}
      >Delete selected</button>
      <button
        type="button"
        onClick={onClear}
        style={{
          padding: '0.35rem 0.7rem', background: 'transparent',
          border: '1px solid var(--color-border)', borderRadius: 4,
          fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
          color: 'var(--color-text-muted)', cursor: 'pointer',
        }}
      >Clear selection</button>
    </div>
  );
}

// Preview + copy modal for the Mass Edit "Email table" export. Lets the
// user pick which columns to include, then renders a plain black-and-white
// bordered table for the selected opps and copies it to the clipboard as
// rich HTML (text/html) so it pastes into Outlook / Gmail as a clean grid,
// with a plain-text fallback.
function EmailTableModal({ records, onClose, signature }) {
  const previewRef = useRef(null);
  const [copied, setCopied] = useState(false);
  // Selected column keys, defaulting to NEW_OPPS_EMAIL_DEFAULT_COLUMN_KEYS
  // (the rest stay available to toggle on). Kept as a Set; the table is
  // built in the canonical NEW_OPPS_EMAIL_COLUMNS order regardless of the
  // order the user toggles them.
  const [selectedKeys, setSelectedKeys] = useState(() => new Set(NEW_OPPS_EMAIL_DEFAULT_COLUMN_KEYS));
  const toggleKey = (key) => setSelectedKeys(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const orderedKeys = useMemo(
    () => NEW_OPPS_EMAIL_COLUMNS.map(c => c.key).filter(k => selectedKeys.has(k)),
    [selectedKeys]
  );
  const html = useMemo(() => buildNewOppsTableHtml(records, orderedKeys), [records, orderedKeys]);

  const copy = useCallback(async () => {
    const plain = previewRef.current?.innerText || '';
    let ok = false;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
        ok = true;
      }
    } catch { /* fall through to execCommand */ }
    if (!ok) {
      // Fallback: select the rendered preview and run the legacy copy so
      // the table still lands on the clipboard with its borders.
      try {
        const range = document.createRange();
        range.selectNodeContents(previewRef.current);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        ok = document.execCommand('copy');
        sel.removeAllRanges();
      } catch { ok = false; }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      alert('Could not copy automatically — select the table below and copy with Ctrl/Cmd+C.');
    }
  }, [html]);

  // Download an Outlook draft (.eml) of the selected opps: subject "Small
  // Deal Size Help", greeting "Keith,", the chosen columns as the table,
  // and the user's signature. Same flow as the New Opps "Download Outlook
  // draft" — double-click the file to open it in Outlook.
  const createDraft = useCallback(() => {
    if (orderedKeys.length === 0) return;
    downloadOppsTableOutlookDraft(records, orderedKeys, { signature });
  }, [records, orderedKeys, signature]);

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
        style={{
          width: 'min(1000px, 95vw)', maxHeight: '90vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
        }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
              Email table
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
              {records.length} opp{records.length === 1 ? '' : 's'}. Pick columns, then create an Outlook draft (or copy the table).
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={createDraft}
              disabled={orderedKeys.length === 0}
              title='Download an Outlook draft (.eml) — subject "Small Deal Size Help", starting "Keith," with your signature. Double-click the file to open it in Outlook.'
              style={{
                padding: '0.4rem 0.9rem', background: orderedKeys.length === 0 ? '#94A3B8' : '#0F6CBD',
                border: `1px solid ${orderedKeys.length === 0 ? '#94A3B8' : '#0F6CBD'}`, borderRadius: 4,
                fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
                color: '#fff', cursor: orderedKeys.length === 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
              }}
            >Create Outlook draft</button>
            <button
              type="button"
              onClick={copy}
              disabled={orderedKeys.length === 0}
              style={{
                padding: '0.4rem 0.9rem', background: 'transparent',
                border: `1px solid ${orderedKeys.length === 0 ? 'var(--color-border)' : '#009530'}`, borderRadius: 4,
                fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
                color: orderedKeys.length === 0 ? 'var(--color-text-muted)' : (copied ? '#059669' : '#009530'),
                cursor: orderedKeys.length === 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
              }}
            >{copied ? 'Copied!' : 'Copy table'}</button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.4rem 0.8rem', background: 'transparent',
                border: '1px solid var(--color-border)', borderRadius: 4,
                fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
                color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >Close</button>
          </div>
        </div>
        <div style={{
          padding: '0.6rem 1rem', borderBottom: '1px solid var(--color-border-light)',
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem 0.85rem',
        }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>Columns</span>
          <button
            type="button"
            onClick={() => setSelectedKeys(new Set(NEW_OPPS_EMAIL_COLUMNS.map(c => c.key)))}
            style={{ fontSize: '0.72rem', fontFamily: 'inherit', color: '#1E40AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >Select all</button>
          <button
            type="button"
            onClick={() => setSelectedKeys(new Set())}
            style={{ fontSize: '0.72rem', fontFamily: 'inherit', color: '#1E40AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >Clear</button>
          <span style={{ color: 'var(--color-border)' }}>|</span>
          {NEW_OPPS_EMAIL_COLUMNS.map(c => (
            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--color-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={selectedKeys.has(c.key)} onChange={() => toggleKey(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
        <div style={{ padding: '1rem', overflow: 'auto', background: '#F8FAFC' }}>
          <div
            ref={previewRef}
            style={{ background: '#fff', padding: '1rem', borderRadius: 6, border: '1px solid var(--color-border-light)' }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Tab- or comma-separated value parser that handles quoted fields,
// escaped quotes, and CRLF / LF endings. Same shape the Opps tab uses
// — duplicated here to keep the bulk-import modal self-contained.
function parseTabularText(text, delimiter) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field); field = '';
        if (ch === '\r') i++;
        rows.push(current); current = [];
      } else field += ch;
    }
  }
  if (field || current.length > 0) { current.push(field); rows.push(current); }
  return rows;
}

// Auto-detect whether a pasted blob is tab-separated (Google Sheets
// copy) or comma-separated (downloaded CSV). The first newline's worth
// of text is enough to decide reliably.
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

// Bulk Import modal — paste a Google-Sheet-shaped block, review the
// column mapping the modal auto-detected (and adjust by hand), see
// warnings about rows that won't import, and commit. The caller owns
// the actual setData / persistence; we just hand back the additions.
function BulkImportModal({ existingHeaders, existingRecords, dedupKeyFor, onClose, onImport }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  // When on, every formerly-skipped row gets imported anyway with a
  // `Review` note explaining why it was flagged (and, for dupes of an
  // existing row, the existing row gets a back-reference Review note
  // too). Lets the user audit the collisions in-place on Opps2
  // instead of fixing the source before re-pasting.
  const [flagAndImportAll, setFlagAndImportAll] = useState(false);
  const targetOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const h of (existingHeaders || [])) {
      if (h && !seen.has(h)) { seen.add(h); out.push(h); }
    }
    return out;
  }, [existingHeaders]);

  // Map of existing opp `_id` → 1..N display rank (matches the Opp #
  // column the parent table renders). Lets the dedup reasons and the
  // Excel export name a colliding opp by its visible number rather
  // than its raw internal id.
  const rankById = useMemo(() => {
    const map = new Map();
    const ids = (existingRecords || [])
      .map(r => r?._id)
      .filter(id => id != null)
      .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
    ids.forEach((id, idx) => map.set(id, idx + 1));
    return map;
  }, [existingRecords]);

  // Esc / backdrop closes (but not while a commit is mid-flight).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !importing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, importing]);

  function handleParse() {
    const raw = String(text || '').trim();
    if (!raw) { setParsed(null); return; }
    const delimiter = detectDelimiter(raw);
    const rows = parseTabularText(raw, delimiter);
    if (!rows.length) { setParsed(null); return; }
    const headers = rows[0].map(h => String(h || '').trim());
    const dataRows = rows.slice(1).filter(r => r.some(c => String(c || '').trim() !== ''));
    setParsed({ headers, rows: dataRows, delimiter });
    // Auto-map: exact match (case-insensitive) to an existing Opps 2
    // column, else "skip". User can override on any row.
    const lowerTargets = new Map(targetOptions.map(t => [t.toLowerCase(), t]));
    const auto = {};
    for (const h of headers) {
      if (!h) continue;
      const hit = lowerTargets.get(h.toLowerCase());
      auto[h] = hit || '';
    }
    setMapping(auto);
  }

  // Build the rows to insert + the list of skip reasons for each
  // pasted row. Mapping decides which source columns flow through;
  // duplicates are detected against existingRecords using the same
  // dedup key the parent uses for the Opps-tab import.
  const analysis = useMemo(() => {
    if (!parsed) return null;
    const additions = [];
    const skipped = [];
    // Map of dedup-key → existing record so a "duplicate" skip can
    // name the existing row, not just the opaque key. Without this,
    // a phantom Opps 2 record (e.g. a row whose Account+Scope match
    // but whose fields look blank in the table) blocks the paste with
    // no breadcrumb back to whatever's matching.
    const existingByKey = new Map();
    for (const r of (existingRecords || [])) {
      const k = dedupKeyFor(r);
      if (k && !existingByKey.has(k)) existingByKey.set(k, r);
    }
    const seenInPaste = new Map();
    for (let i = 0; i < parsed.rows.length; i++) {
      const cells = parsed.rows[i];
      const record = {};
      let hasMappedData = false;
      for (let j = 0; j < parsed.headers.length; j++) {
        const src = parsed.headers[j];
        const target = mapping[src];
        if (!target) continue;
        const val = String(cells[j] ?? '').trim();
        record[target] = val;
        if (val) hasMappedData = true;
      }
      const lineNo = i + 2; // +1 for header row, +1 for 1-indexed display
      if (!hasMappedData) {
        skipped.push({ lineNo, pasteRecord: record, reason: 'Empty row' });
        continue;
      }
      const key = dedupKeyFor(record);
      if (!key) {
        skipped.push({ lineNo, pasteRecord: record, reason: 'Missing dedup key (need BFO Link or Account + Scope + Year)' });
        continue;
      }
      if (existingByKey.has(key)) {
        const existing = existingByKey.get(key);
        // When BFO Link is the thing that matched, a different Account
        // on the paste row almost always means the source columns
        // shifted (e.g. an Account cell that belongs to a different
        // BFO opportunity). Flag the row so the user can remap names
        // or fix the source before re-pasting.
        const pasteAcct = String(record['Account'] || '').trim().toLowerCase();
        const existingAcct = String(existing['Account'] || '').trim().toLowerCase();
        const accountMismatch = key.startsWith('bfo:') && !!pasteAcct && !!existingAcct && pasteAcct !== existingAcct;
        const oppNum = rankById.get(existing._id) ?? existing._id;
        skipped.push({
          lineNo,
          accountMismatch,
          pasteAccount: record['Account'] || '',
          existingAccount: existing['Account'] || '',
          pasteRecord: record,
          existingRecord: existing,
          key,
          reason: `Duplicate opp (opp# ${oppNum})`,
        });
        continue;
      }
      if (seenInPaste.has(key)) {
        skipped.push({
          lineNo,
          pasteRecord: record,
          key,
          reason: `Duplicate opp (paste line ${seenInPaste.get(key)})`,
        });
        continue;
      }
      seenInPaste.set(key, lineNo);
      additions.push(record);
    }
    return { additions, skipped };
  }, [parsed, mapping, existingRecords, dedupKeyFor]);

  // Convert a skipped entry into an addition with `_reviewReason` (and
  // `_existingMatchId` when we know which existing row it collided
  // with). Used in flag-and-import mode so the parent can stamp the
  // Review column and back-reference the existing row.
  function flagSkippedAsAddition(s) {
    let reviewReason;
    if (s.existingRecord) {
      const accountSuffix = s.accountMismatch && s.existingAccount
        ? ` (existing account: "${s.existingAccount}")`
        : '';
      reviewReason = `Possible duplicate of opp# ${rankById.get(s.existingRecord._id) ?? s.existingRecord._id}${accountSuffix}`;
    } else if (s.reason.startsWith('Duplicate opp (paste line')) {
      reviewReason = s.reason.replace(/^Duplicate opp/, 'Possible duplicate');
    } else {
      reviewReason = s.reason;
    }
    const out = { ...(s.pasteRecord || {}), _reviewReason: reviewReason };
    if (s.existingRecord?._id != null) out._existingMatchId = s.existingRecord._id;
    return out;
  }

  const importableCount = analysis
    ? analysis.additions.length + (flagAndImportAll ? analysis.skipped.length : 0)
    : 0;

  async function handleImport() {
    if (!analysis || importableCount === 0) return;
    setImporting(true);
    try {
      const toImport = flagAndImportAll
        ? [...analysis.additions, ...analysis.skipped.map(flagSkippedAsAddition)]
        : analysis.additions;
      await onImport(toImport, parsed.headers, mapping);
    } finally {
      setImporting(false);
    }
  }

  // Build an .xlsx of every skipped row so the user can investigate
  // duplicates outside the modal. Columns: line / reason / dedup key
  // / account mismatch flag, then a Paste vs Existing pair for each
  // mapped target column so it's obvious which fields differ.
  async function handleExportDuplicates() {
    if (!analysis || analysis.skipped.length === 0) return;
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    const ws = wb.addWorksheet('Skipped rows');
    const mappedTargets = Array.from(new Set(
      Object.values(mapping || {}).filter(Boolean)
    ));
    const baseCols = [
      { header: 'Source line', key: '_lineNo', width: 12 },
      { header: 'Reason', key: '_reason', width: 28 },
      { header: 'Account mismatch (existing)', key: '_mismatch', width: 36 },
    ];
    const pairCols = mappedTargets.flatMap(t => [
      { header: `Paste · ${t}`, key: `paste__${t}`, width: 22 },
      { header: `Existing · ${t}`, key: `existing__${t}`, width: 22 },
    ]);
    ws.columns = [...baseCols, ...pairCols];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    for (const s of analysis.skipped) {
      const row = {
        _lineNo: s.lineNo,
        _reason: s.reason,
        _mismatch: s.accountMismatch ? (s.existingAccount || '(blank)') : '',
      };
      for (const t of mappedTargets) {
        row[`paste__${t}`] = s.pasteRecord ? (s.pasteRecord[t] ?? '') : '';
        row[`existing__${t}`] = s.existingRecord ? (s.existingRecord[t] ?? '') : '';
      }
      const added = ws.addRow(row);
      if (s.accountMismatch) {
        added.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        });
      }
    }
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1 + analysis.skipped.length, column: ws.columns.length },
    };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Opps bulk import - skipped rows - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const mappedCount = useMemo(() => {
    if (!parsed) return 0;
    return parsed.headers.reduce((n, h) => n + (mapping[h] ? 1 : 0), 0);
  }, [parsed, mapping]);

  return (
    <div
      onClick={importing ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8, padding: '1rem 1.25rem',
          width: 'min(900px, 96vw)', maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 18px 50px rgba(15, 23, 42, 0.32)',
          display: 'flex', flexDirection: 'column', gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>Bulk import from a Google Sheet</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none',
              cursor: importing ? 'not-allowed' : 'pointer',
              fontSize: '1.2rem', color: '#64748B', padding: '0 4px', lineHeight: 1,
            }}
          >×</button>
        </div>
        <p style={{ margin: 0, fontSize: '0.78rem', color: '#475569', lineHeight: 1.45 }}>
          Copy a header row + data rows from your Google Sheet and paste below. The modal auto-detects tab or comma separation. Columns with the same name auto-map; tweak the dropdowns to point a source column at a different Opps column, or set it to <em>Skip</em>. Duplicates against existing Opps rows are skipped (same dedup as Import from Opps - Old tab).
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste here…"
          rows={6}
          spellCheck={false}
          style={{
            width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.78rem',
            padding: '0.5rem 0.6rem', border: '1px solid var(--color-border)', borderRadius: 6,
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleParse}
            disabled={!text.trim() || importing}
            style={{
              padding: '0.4rem 0.85rem', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              background: '#fff', color: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 6,
              cursor: (!text.trim() || importing) ? 'not-allowed' : 'pointer',
            }}
          >Parse</button>
          {parsed && (
            <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
              {parsed.rows.length} data row{parsed.rows.length === 1 ? '' : 's'} · {parsed.headers.length} source column{parsed.headers.length === 1 ? '' : 's'} · {mappedCount} mapped · delimiter: {parsed.delimiter === '\t' ? 'tab' : 'comma'}
            </span>
          )}
        </div>

        {parsed && (
          <>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.35rem' }}>Column mapping</div>
              <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC' }}>
                      <th style={{ textAlign: 'left', padding: '0.35rem 0.55rem', borderBottom: '1px solid var(--color-border-light)' }}>Source column</th>
                      <th style={{ textAlign: 'left', padding: '0.35rem 0.55rem', borderBottom: '1px solid var(--color-border-light)' }}>→ Opps column</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.headers.map((h, idx) => (
                      <tr key={`${h}|${idx}`}>
                        <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#0f172a' }}>{h || <span style={{ color: '#94A3B8' }}>(unnamed col {idx + 1})</span>}</td>
                        <td style={{ padding: '0.3rem 0.55rem', borderBottom: '1px solid var(--color-border-light)' }}>
                          <select
                            value={mapping[h] || ''}
                            onChange={(e) => setMapping(prev => ({ ...prev, [h]: e.target.value }))}
                            style={{ width: '100%', fontFamily: 'inherit', fontSize: '0.74rem', padding: '2px 4px' }}
                          >
                            <option value="">— Skip this column —</option>
                            {targetOptions.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {analysis && (() => {
              const mismatchCount = analysis.skipped.filter(s => s.accountMismatch).length;
              const flaggedLabel = flagAndImportAll ? 'flagged for review' : 'skipped';
              const flaggedBg = flagAndImportAll ? '#FFFBEB' : '#FEF3C7';
              const flaggedBorder = flagAndImportAll ? '#FCD34D' : '#FDE68A';
              return (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', padding: '0.5rem 0.75rem', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#166534' }}>{analysis.additions.length} clean row{analysis.additions.length === 1 ? '' : 's'} will import</div>
                  </div>
                  <div style={{ flex: '1 1 220px', padding: '0.5rem 0.75rem', background: flaggedBg, border: `1px solid ${flaggedBorder}`, borderRadius: 6 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400E' }}>{analysis.skipped.length} row{analysis.skipped.length === 1 ? '' : 's'} {flaggedLabel}</div>
                  </div>
                  {mismatchCount > 0 && (
                    <div style={{ flex: '1 1 220px', padding: '0.5rem 0.75rem', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 6 }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#991B1B' }}>⚠ {mismatchCount} account name mismatch{mismatchCount === 1 ? '' : 'es'}</div>
                      <div style={{ fontSize: '0.7rem', color: '#7F1D1D', marginTop: 2 }}>BFO Link matched an existing row but the Account differs — check column alignment or remap the names.</div>
                    </div>
                  )}
                </div>
              );
            })()}

            {analysis && analysis.skipped.length > 0 && (
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                padding: '0.5rem 0.75rem', background: '#FFFBEB',
                border: '1px solid #FCD34D', borderRadius: 6,
                fontSize: '0.75rem', color: '#7C2D12', cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={flagAndImportAll}
                  onChange={(e) => setFlagAndImportAll(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>Import the {analysis.skipped.length} skipped row{analysis.skipped.length === 1 ? '' : 's'} anyway and flag them for review.</strong>
                  {' '}A <code>Review</code> column will be added (if it doesn't exist) and populated with the reason on each flagged row. Existing rows that look like duplicates of an imported row also get a back-reference note so you can audit them on Opps. Clear the cell once you've checked it.
                </span>
              </label>
            )}

            {analysis && analysis.skipped.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0f172a' }}>
                    Skipped rows — source line{analysis.skipped.length === 1 ? '' : 's'} {analysis.skipped.map(s => s.lineNo).join(', ')}
                  </div>
                  <button
                    type="button"
                    onClick={handleExportDuplicates}
                    title="Download an .xlsx of every skipped row with paste vs existing values"
                    style={{
                      padding: '0.3rem 0.7rem', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
                      background: '#fff', color: 'var(--color-accent)',
                      border: '1px solid var(--color-accent)', borderRadius: 6, cursor: 'pointer',
                    }}
                  >Export to Excel</button>
                </div>
                <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC' }}>
                        <th style={{ textAlign: 'left', padding: '0.3rem 0.55rem', width: 80 }}>Source line</th>
                        <th style={{ textAlign: 'left', padding: '0.3rem 0.55rem', width: 280 }}>Account (paste vs existing)</th>
                        <th style={{ textAlign: 'left', padding: '0.3rem 0.55rem' }}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.skipped.map((s, i) => {
                        const rowBg = s.accountMismatch ? '#FEE2E2' : undefined;
                        const showAccountCell = s.pasteAccount != null || s.existingAccount != null;
                        return (
                          <tr key={i} style={{ background: rowBg }}>
                            <td style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#64748B' }}>{s.lineNo}</td>
                            <td style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#0f172a', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                              {showAccountCell ? (
                                <>
                                  <div><strong>Paste:</strong> {s.pasteAccount || <em style={{ color: '#94A3B8' }}>(blank)</em>}</div>
                                  <div><strong>Existing:</strong> {s.existingAccount || <em style={{ color: '#94A3B8' }}>(blank)</em>}</div>
                                </>
                              ) : <span style={{ color: '#94A3B8' }}>—</span>}
                            </td>
                            <td style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', color: '#0f172a', whiteSpace: 'normal', wordBreak: 'break-word' }}>{s.reason}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {analysis && analysis.additions.length > 0 && (
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.35rem' }}>Preview (first 5)</div>
                <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: '0.7rem', width: '100%' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC' }}>
                        {targetOptions.filter(t => Object.values(mapping).includes(t)).map(t => (
                          <th key={t} style={{ textAlign: 'left', padding: '0.3rem 0.55rem', whiteSpace: 'nowrap', borderBottom: '1px solid var(--color-border-light)' }}>{t}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.additions.slice(0, 5).map((row, i) => (
                        <tr key={i}>
                          {targetOptions.filter(t => Object.values(mapping).includes(t)).map(t => (
                            <td key={t} style={{ padding: '0.25rem 0.55rem', borderBottom: '1px solid var(--color-border-light)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(row[t] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            style={{
              padding: '0.4rem 0.85rem', fontSize: '0.8rem', fontFamily: 'inherit',
              background: '#fff', color: '#475569',
              border: '1px solid var(--color-border)', borderRadius: 6,
              cursor: importing ? 'not-allowed' : 'pointer',
            }}
          >Cancel</button>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || importableCount === 0}
            style={{
              padding: '0.4rem 0.95rem', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
              background: 'var(--color-accent)', color: '#fff',
              border: '1px solid var(--color-accent)', borderRadius: 6,
              cursor: (importing || importableCount === 0) ? 'not-allowed' : 'pointer',
              opacity: (importing || importableCount === 0) ? 0.6 : 1,
            }}
          >{importing ? 'Importing…' : `Import ${importableCount} row${importableCount === 1 ? '' : 's'}`}</button>
        </div>
      </div>
    </div>
  );
}

// Modal opened on double-click of a Next Steps cell. Renders the
// per-step rows as a two-column table (Next Step / Waiting On) so the
// user can edit each entry in place. The notes are flattened back to a
// newline-joined string under 'Next Steps' (keeps search, sort, export,
// and the in-table cell render working), and the parallel waiting-on
// array is stored alongside under '_nextStepsWaiting'.
// Textarea that grows to fit its content so long Next Step notes
// aren't clipped to a single line. Resizes on every value change and
// once on mount so existing rows render at their full height the
// instant the popup opens.
function AutoGrowTextarea({ value, onChange, onBlur, placeholder, style }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      style={style}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      rows={2}
    />
  );
}

// The Next Step / Waiting On rows table shared by the standalone
// NextStepsEditor modal and the Follow Up status popup, so both edit
// Next Steps in the exact same format. Presentational only — the
// parent owns the `rows` state and the add / delete / commit handlers.
function NextStepsRowsEditor({ rows, onUpdateRow, onAddRow, onDeleteRow, onCommit, onQuickWaiting }) {
  const inputStyle = {
    width: '100%', padding: '0.4rem 0.5rem', border: '1px solid #CBD5E1',
    borderRadius: 4, fontSize: '0.85rem', fontFamily: 'inherit',
    lineHeight: 1.4, resize: 'vertical', minHeight: 56, background: '#fff',
    overflow: 'hidden',
  };
  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ background: '#F1F5F9', textAlign: 'left', color: '#475569' }}>
            <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600, width: '55%', borderBottom: '1px solid #E2E8F0' }}>Note</th>
            <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600, width: '40%', borderBottom: '1px solid #E2E8F0' }}>Waiting On</th>
            <th style={{ width: 32, borderBottom: '1px solid #E2E8F0' }} aria-label="" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} style={{ verticalAlign: 'top' }}>
              <td style={{ padding: '0.3rem 0.4rem 0.3rem 0', borderBottom: '1px solid #F1F5F9' }}>
                <AutoGrowTextarea
                  style={inputStyle}
                  value={row.note}
                  onChange={(e) => onUpdateRow(idx, 'note', e.target.value)}
                  onBlur={onCommit}
                  placeholder="What needs to happen?"
                />
              </td>
              <td style={{ padding: '0.3rem 0.4rem', borderBottom: '1px solid #F1F5F9' }}>
                <AutoGrowTextarea
                  style={inputStyle}
                  value={row.waitingOn}
                  onChange={(e) => onUpdateRow(idx, 'waitingOn', e.target.value)}
                  onBlur={onCommit}
                  placeholder="Who / what?"
                />
                <button
                  type="button"
                  onClick={() => (onQuickWaiting ? onQuickWaiting(idx, 'Me') : onUpdateRow(idx, 'waitingOn', 'Me'))}
                  title="We're waiting on me — set Waiting On to “Me”"
                  style={{
                    marginTop: 4, padding: '0.2rem 0.55rem', border: '1px solid #BFDBFE',
                    borderRadius: 4, background: '#EFF6FF', color: '#1E40AF',
                    fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >Me</button>
              </td>
              <td style={{ padding: '0.3rem 0 0.3rem 0.2rem', borderBottom: '1px solid #F1F5F9', textAlign: 'right' }}>
                <button
                  type="button"
                  onClick={() => onDeleteRow(idx)}
                  aria-label="Delete step"
                  title="Delete step"
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: '#94A3B8', fontSize: '1rem', padding: '0 4px', lineHeight: 1,
                  }}
                >×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: '0.6rem' }}>
        <button
          type="button"
          onClick={onAddRow}
          style={{
            padding: '0.35rem 0.7rem', border: '1px solid #BFDBFE', borderRadius: 4,
            background: '#EFF6FF', color: '#1E40AF', fontSize: '0.75rem', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >+ Add step</button>
      </div>
    </>
  );
}

function NextStepsEditor({ opp, onClose, updateOppField }) {
  const noteLines = useMemo(() => textToBulletItems(opp?.['Next Steps']), [opp]);
  const storedWaiting = Array.isArray(opp?._nextStepsWaiting) ? opp._nextStepsWaiting : [];
  const initialRows = useMemo(() => {
    const rows = noteLines.map((note, i) => ({ note, waitingOn: String(storedWaiting[i] || '') }));
    return rows.length > 0 ? rows : [{ note: '', waitingOn: '' }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opp]);
  const [rows, setRows] = useState(initialRows);

  function commit(nextRows) {
    const kept = nextRows.filter(r => (r.note || '').trim() || (r.waitingOn || '').trim());
    const notesText = kept.map(r => encodeNoteLine(r.note)).join('\n');
    const waiting = kept.map(r => (r.waitingOn || '').trim());
    updateOppField(opp._id, 'Next Steps', notesText);
    updateOppField(opp._id, '_nextStepsWaiting', waiting);
  }

  function updateRow(idx, key, value) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: value } : r));
  }

  function addRow() {
    setRows(prev => {
      const next = [...prev, { note: '', waitingOn: '' }];
      commit(next);
      return next;
    });
  }

  function deleteRow(idx) {
    setRows(prev => {
      const next = prev.filter((_, i) => i !== idx);
      const safe = next.length > 0 ? next : [{ note: '', waitingOn: '' }];
      commit(safe);
      return safe;
    });
  }

  const account = String(opp?.['Account'] || '').trim() || '(no account)';

  // One-click activity marks. Stamps today's date on `_calledOn` /
  // `_metOn` (clicking again the same day clears it). The Agents page
  // reads these stamps so a marked call or meeting shows up in its
  // Activity table and the BFO Activity AI prompt without needing a
  // phone-touch phrase in the notes text.
  const markBtn = (field, icon, label) => {
    const today = todayISO();
    const stamped = toISODate(opp?.[field]);
    const isToday = stamped === today;
    return (
      <button
        type="button"
        onClick={() => updateOppField(opp._id, field, isToday ? '' : today)}
        title={isToday
          ? `Marked "${label}" today — click to unmark`
          : stamped
            ? `Last marked "${label}" on ${stamped} — click to mark again for today (shows on the Agents page's BFO Activity list)`
            : `Mark "${label}" today — shows on the Agents page's BFO Activity list`}
        style={{
          display: 'inline-block', padding: '3px 10px', borderRadius: 999,
          fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
          cursor: 'pointer', fontFamily: 'inherit',
          background: isToday ? '#DCFCE7' : '#fff',
          color: isToday ? '#166534' : '#64748B',
          border: isToday ? '1px solid #86EFAC' : '1px dashed #CBD5E1',
        }}
      >{icon} {label}{isToday ? ' ✓' : ''}</button>
    );
  };

  // Only treat a backdrop click as "close" when the press *started* on the
  // backdrop. Without this, drag-selecting text in a field and releasing the
  // mouse over the dimmed backdrop fires a click whose target is the overlay,
  // which would close the popup mid-selection.
  const backdropMouseDown = useRef(false);

  return (
    <div
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && backdropMouseDown.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8, padding: '1rem 1.25rem',
          width: 'min(1100px, 96vw)', maxHeight: '88vh', overflow: 'auto',
          boxShadow: '0 18px 50px rgba(15, 23, 42, 0.32)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem', gap: '1rem' }}>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Notes — {account}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: '0.72rem', color: '#64748B' }}>
              Sales Partner
              <input
                key={String(opp?.['Sales Partner'] ?? '')}
                type="text"
                defaultValue={String(opp?.['Sales Partner'] ?? '')}
                placeholder="—"
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (v !== String(opp?.['Sales Partner'] ?? '').trim()) updateOppField(opp._id, 'Sales Partner', v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                  else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.value = String(opp?.['Sales Partner'] ?? ''); e.currentTarget.blur(); }
                }}
                style={{ padding: '2px 6px', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'inherit', color: '#334155', minWidth: 170 }}
              />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {markBtn('_calledOn', '📞', 'Called')}
            {markBtn('_metOn', '🤝', 'Meeting')}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: '1.1rem', color: '#64748B', padding: '0 4px', lineHeight: 1,
              }}
            >×</button>
          </div>
        </div>
        <NextStepsRowsEditor
          rows={rows}
          onUpdateRow={updateRow}
          onAddRow={addRow}
          onDeleteRow={deleteRow}
          onCommit={() => commit(rows)}
          onQuickWaiting={(idx, value) => setRows(prev => {
            const next = prev.map((r, i) => i === idx ? { ...r, waitingOn: value } : r);
            commit(next);
            return next;
          })}
        />
      </div>
    </div>
  );
}

// Modal for configuring the "No Further Action Today" clear schedules.
// Each mark type (✓ checks, ✗ X marks, any value) gets an independent
// schedule: an on/off toggle, the Eastern weekdays it runs on, and a
// time of day. Also offers a "Clear now" button per type. Times run in
// Eastern and only fire while the app is open in a browser (catching up
// on the next open if a scheduled time was missed).
function NfatScheduleModal({ schedules, onSave, onClearNow, onClose }) {
  const [draft, setDraft] = useState(() => {
    const def = defaultNfatSchedules();
    for (const t of NFAT_SCHEDULE_TYPES) {
      if (schedules?.[t]) def[t] = { ...def[t], ...schedules[t] };
    }
    return def;
  });
  const WEEKDAYS = [
    { v: 0, label: 'Sun' }, { v: 1, label: 'Mon' }, { v: 2, label: 'Tue' },
    { v: 3, label: 'Wed' }, { v: 4, label: 'Thu' }, { v: 5, label: 'Fri' },
    { v: 6, label: 'Sat' },
  ];
  const patch = (type, changes) =>
    setDraft(d => ({ ...d, [type]: { ...d[type], ...changes } }));
  const toggleDay = (type, v) =>
    setDraft(d => {
      const set = new Set(d[type].days || []);
      if (set.has(v)) set.delete(v); else set.add(v);
      return { ...d, [type]: { ...d[type], days: [...set].sort((a, b) => a - b) } };
    });
  const save = () => {
    // Re-baseline lastRunAt to now for every type so saving never
    // retro-fires a scheduled time that already passed earlier today —
    // only future occurrences trigger a clear.
    const now = Date.now();
    const next = {};
    for (const t of NFAT_SCHEDULE_TYPES) next[t] = { ...draft[t], lastRunAt: now };
    onSave(next);
    onClose();
  };
  const clearNow = (type) => {
    const n = onClearNow(type);
    window.alert(n > 0
      ? `Cleared ${NFAT_TYPE_LABELS[type]} from ${n} row${n === 1 ? '' : 's'}.`
      : `No matching "${NFAT_TYPE_LABELS[type]}" values to clear.`);
  };

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface, #fff)', color: 'var(--color-text)', borderRadius: 8, padding: '1.25rem', width: 'min(560px, 94vw)', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Clear “No Further Action Today”</h3>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
        <p style={{ marginTop: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          Set a schedule for each mark type, or clear it right now. Schedules run on the chosen days at the chosen time (US Eastern) and only fire while this app is open — a missed time catches up the next time you open it.
        </p>
        {NFAT_SCHEDULE_TYPES.map(type => {
          const s = draft[type];
          return (
            <div key={type} style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!s.enabled}
                    onChange={e => patch(type, { enabled: e.target.checked })}
                  />
                  {NFAT_TYPE_LABELS[type]}
                </label>
                <button
                  type="button"
                  onClick={() => clearNow(type)}
                  style={{ padding: '0.3rem 0.6rem', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', color: 'inherit' }}
                  title={`Clear ${NFAT_TYPE_LABELS[type]} now`}
                >Clear now</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center', opacity: s.enabled ? 1 : 0.5 }}>
                {WEEKDAYS.map(d => {
                  const on = (s.days || []).includes(d.v);
                  return (
                    <button
                      key={d.v}
                      type="button"
                      disabled={!s.enabled}
                      onClick={() => toggleDay(type, d.v)}
                      style={{
                        padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-md)',
                        border: `1px solid ${on ? '#2563EB' : 'var(--color-border)'}`,
                        background: on ? '#2563EB' : 'transparent',
                        color: on ? '#fff' : 'inherit',
                        fontSize: '0.74rem', fontWeight: 600,
                        cursor: s.enabled ? 'pointer' : 'not-allowed',
                      }}
                    >{d.label}</button>
                  );
                })}
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                  at
                  <input
                    type="time"
                    value={s.time || '06:00'}
                    disabled={!s.enabled}
                    onChange={e => patch(type, { time: e.target.value })}
                    style={{ padding: '0.2rem 0.3rem', fontFamily: 'inherit', fontSize: '0.8rem' }}
                  />
                </span>
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="button" onClick={onClose} style={{ padding: '0.4rem 0.8rem', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', color: 'inherit' }}>Cancel</button>
          <button type="button" onClick={save} style={{ padding: '0.4rem 0.9rem', background: '#2563EB', border: '1px solid #2563EB', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', color: '#fff' }}>Save schedule</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function OppsView2({ settings, updateSettings, prospects = [], updateProspect, addProspect, onSelectProspect } = {}) {
  const { user, isAdmin } = useAuth();
  // Seeded with DEFAULT_HEADERS so the table renders columns immediately;
  // the hydration effect below replaces this with the user's saved
  // headers + records once Firestore / IndexedDB returns.
  const [data, setData] = useState({ headers: DEFAULT_HEADERS, records: [] });
  const [loading, setLoading] = useState(true);
  const [error] = useState(null);

  // One-time migration: the PE Owner column was added after this table
  // shipped, so existing users have a saved visible-columns set (local
  // and/or synced) that omits it — DataTable then keeps it hidden. Reveal
  // it once so it shows up on new and existing opps. Gated on
  // settings._lastWriteAt so we only act after synced settings have
  // actually loaded, and marked done in settings so it never re-fights a
  // user who later chooses to hide the column.
  useEffect(() => {
    if (!settings || !settings._lastWriteAt) return;
    if (settings.opps2PeOwnerRevealed) return;
    const updates = { opps2PeOwnerRevealed: true };
    const remote = settings?.tablePrefs?.opps2?.visible;
    if (Array.isArray(remote) && remote.length > 0 && !remote.includes('PE Owner')) {
      updates.tablePrefs = {
        ...(settings.tablePrefs || {}),
        opps2: { ...(settings.tablePrefs.opps2 || {}), visible: [...remote, 'PE Owner'] },
      };
    }
    try {
      const LS_KEY = 'prospect-col-visible-opps2';
      const saved = JSON.parse(localStorage.getItem(LS_KEY));
      if (Array.isArray(saved) && saved.length > 0 && !saved.includes('PE Owner')) {
        localStorage.setItem(LS_KEY, JSON.stringify([...saved, 'PE Owner']));
      }
    } catch { /* ignore */ }
    updateSettings?.(updates);
  }, [settings, updateSettings]);
  // Set when a Firestore cloud save fails so the failure is visible in
  // the UI instead of only the console. A silent failure here once let
  // edits live only in local IndexedDB while other devices kept showing
  // stale data; the banner makes that state impossible to miss.
  const [syncError, setSyncError] = useState(false);
  // The specific reason the last cloud write failed (permission denied,
  // quota exhausted, offline, …) so the banner can say *why*, not just
  // "it failed".
  const [syncErrorDetail, setSyncErrorDetail] = useState('');
  // Wall-clock of the last confirmed Firestore write this session, shown
  // in the banner so the user knows how long their edits have been
  // local-only.
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  // True while a manual "Retry now" is in flight, to disable the button
  // and avoid clearing the banner optimistically before the write acks.
  const [retryingSync, setRetryingSync] = useState(false);

  // HubSpot contacts cache feeds the Contact column's per-row picker.
  // Most contact rosters live here (not on the prospect record), so
  // pull from this cache and re-pull whenever the HubSpot view emits
  // a refresh event.
  const [hubspotContacts, setHubspotContacts] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getHubspotContacts()
        .then(list => { if (!cancelled) setHubspotContacts(Array.isArray(list) ? list : []); })
        .catch(() => { if (!cancelled) setHubspotContacts([]); });
    };
    refresh();
    window.addEventListener('hubspot-cache-updated', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('hubspot-cache-updated', refresh);
    };
  }, []);

  // Per-Pricing-Option services bundle, used by the Scope cell to
  // offer an "Add from Pricing Option" bulk-add. PricingView keeps a
  // pre-derived copy in IndexedDB, but we also fall back to deriving
  // from the raw cached workbook + Line Item → Services mapping —
  // otherwise the picker would be empty whenever the user lands on
  // Opps 2 without having opened the Pricing tab in this session.
  // Map of `oppId → Pricing Option name` owned by the Pricing tab.
  // We render the "Pricing Option" column from this map so the link
  // lives in one place — saving from Pricing or clearing from here
  // both go through `setOppOptionLink`.
  const [optionLinks, setOptionLinks] = useState({});
  useEffect(() => {
    let cancelled = false;
    loadOptionLinks().then(val => { if (!cancelled) setOptionLinks(val || {}); });
    const onChange = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') setOptionLinks(detail);
    };
    window.addEventListener(OPTION_LINKS_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(OPTION_LINKS_EVENT, onChange);
    };
  }, []);
  const [pricingOptionServicesCache, setPricingOptionServicesCache] = useState({});
  const [pricingWorkbook, setPricingWorkbook] = useState(null);
  const [lineItemServices, setLineItemServices] = useState({});
  useEffect(() => {
    let cancelled = false;
    const loadWorkbook = () => dbGet('pricing-cache', 'current')
      .then(val => { if (!cancelled && val && val.workbook) setPricingWorkbook(val.workbook); })
      .catch(() => {});
    const loadMapping = () => dbGet('pricing-cache', 'lineItemServices')
      .then(val => { if (!cancelled && val && typeof val === 'object') setLineItemServices(val); })
      .catch(() => {});
    const loadDerived = () => dbGet('pricing-cache', 'pricingOptionServices')
      .then(val => { if (!cancelled && val && typeof val === 'object') setPricingOptionServicesCache(val); })
      .catch(() => {});
    loadWorkbook();
    loadMapping();
    loadDerived();
    const onMapping = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') setLineItemServices(detail); else loadMapping();
    };
    const onDerived = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') setPricingOptionServicesCache(detail); else loadDerived();
      // Workbook changes ride along with derived-bundle changes — refresh.
      loadWorkbook();
    };
    window.addEventListener('pricing:lineItemServicesChanged', onMapping);
    window.addEventListener('pricing:optionServicesChanged', onDerived);
    return () => {
      cancelled = true;
      window.removeEventListener('pricing:lineItemServicesChanged', onMapping);
      window.removeEventListener('pricing:optionServicesChanged', onDerived);
    };
  }, []);

  const pricingOptionServices = useMemo(() => {
    // Local derivation always wins when a workbook is in the cache —
    // it can't be stale relative to the inputs in this tab. The
    // pre-derived copy is only used when the workbook is missing
    // (e.g. PricingView populated it but the cache has since been
    // partially cleared, or a cross-tab edit beat us to it).
    if (pricingWorkbook && Array.isArray(pricingWorkbook.options) && pricingWorkbook.options.length > 0) {
      const out = {};
      for (const o of pricingWorkbook.options) {
        const seen = new Set();
        const services = [];
        for (const sec of (o.sections || [])) {
          for (const item of (sec.items || [])) {
            const key = String(item.description || '').trim().toLowerCase();
            const mapped = key ? lineItemServices?.[key] : null;
            if (!Array.isArray(mapped)) continue;
            for (const s of mapped) {
              const k = String(s || '').toLowerCase();
              if (!k || seen.has(k)) continue;
              seen.add(k);
              services.push(s);
            }
          }
        }
        out[o.sheetName] = services;
      }
      return out;
    }
    return pricingOptionServicesCache;
  }, [pricingWorkbook, lineItemServices, pricingOptionServicesCache]);
  // Persisting only kicks in after the initial hydration finishes —
  // otherwise the seed value would be written back, wiping the saved
  // state for any user who happens to refresh before the load
  // resolves.
  const hydratedRef = useRef(false);
  // State mirror of hydratedRef so effects can re-run *after* the initial
  // load + reconcile settles. A ref alone doesn't trigger a re-render, so
  // the once-per-day NFAT clear needs this to fire against the final
  // reconciled data instead of the intermediate IndexedDB cache paint.
  const [hydrated, setHydrated] = useState(false);
  const firestoreSaveTimerRef = useRef(null);
  // _updatedAt timestamp of the most recent blob we wrote to Firestore.
  // The onSnapshot listener compares against this to skip our own echoes.
  const lastFsSavedAtRef = useRef(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('opps');
  // New Opps subtab: controls the recurring-email schedule manager modal.
  const [newOppsScheduleOpen, setNewOppsScheduleOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Dedicated Start Date range for the "By Source" tab. Kept separate
  // from the (hidden) global dateFrom/dateTo so the source summary can
  // be scoped to a time window without touching the other tabs.
  const [sourceFrom, setSourceFrom] = useState('');
  const [sourceTo, setSourceTo] = useState('');
  // "By Source" tab activity filter: 'active' (open stages, the default
  // for this tab), 'closed' (Sold / Not Sold), or 'all'. Mirrors the
  // main tab's Show control.
  const [sourceActivityFilter, setSourceActivityFilter] = useState('active');
  // "By Source" drilldown: the Source whose opps the user clicked through
  // to. null when the list modal is closed.
  const [sourceDrillDown, setSourceDrillDown] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('all');
  const [showHiddenByFilter, setShowHiddenByFilter] = useState(false);
  // Rows that don't have an active Call In number (no Follow Up date,
  // or the value was manually cleared) are treated as "history" — they
  // aren't on a callback schedule and don't need to render alongside
  // active opps. Hidden by default so the page loads fewer rows;
  // surfaced on demand via the "Show history" button.
  const [hideHistory, setHideHistory] = useState(true);
  // Days-in-Stage kanban — Not Started rows are often noise (intake
  // backlog), so we let the user hide that column without losing the
  // data. Defaulted to visible so the column is discoverable.
  const [hideNotStarted, setHideNotStarted] = useState(false);
  const servicesDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (activeTab === 'services' && !servicesDefaultAppliedRef.current) {
      servicesDefaultAppliedRef.current = true;
      setActivityFilter(prev => (prev === 'all' ? 'active' : prev));
    }
  }, [activeTab]);
  const [hiddenServices, setHiddenServices] = useState(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  // null when idle; { account } when the user clicked + New Opp (or
  // committed the Add Company combobox) and the Source-picker modal
  // is open. Account flows through so the modal can show "Adding
  // <company>" when the company is already known.
  const [pendingNewOpp, setPendingNewOpp] = useState(null);
  // _id of the opp that just had its Stage flipped to "Not Sold". When
  // set, the NotSoldFollowUpModal asks the user to fill in Close Date
  // (auto-stamped to the status-change date in updateOppField, shown
  // pre-filled for adjustment), Reason Not Sold, and Final Margin so
  // the close-out reporting views have what they need. Cleared on Save
  // or Skip.
  const [notSoldPromptId, setNotSoldPromptId] = useState(null);
  // _id of the opp that just moved into the "Quoted" stage. When set,
  // the QuotedFollowUpModal asks the user to enter / review Quoted On,
  // Chance?, and Margin Email Date - Sales Leader Review Date. Cleared on
  // Save or Skip.
  const [quotedPromptId, setQuotedPromptId] = useState(null);
  // _id of the opp that just moved into the "Agreement Sent" stage. When
  // set, the AgreementSentFollowUpModal asks the user to enter / review
  // USD?, the Margin Email / Sales Leader Review date, Chance?, Multiple
  // Invoices?, Verbal, the Entity Outside the US Approval, and COA
  // Approval (plus a read-only view of the linked Pricing Option).
  // Cleared on Save or Skip.
  const [agreementSentPromptId, setAgreementSentPromptId] = useState(null);
  // _id of the opp that just had its Stage flipped to "Sold". When set,
  // the SoldFollowUpModal asks the user to fill in Reason Not Sold,
  // Final Margin, and Competition. The Close Date is auto-stamped to the
  // status-change date in updateOppField. Cleared on Save or Skip.
  const [soldPromptId, setSoldPromptId] = useState(null);
  // _id of the opp that just moved from "Not Started" to "Lead". When
  // set, the LeadQuotedAmountModal prompts the user to enter the Quoted
  // Amount so a newly-activated opp carries a dollar figure. Cleared on
  // Save or Skip.
  const [leadQuotedPromptId, setLeadQuotedPromptId] = useState(null);
  // _id of the opp that just had its Follow Up date changed. When set,
  // the FollowUpStatusModal asks the user to pick the new Status
  // (Who is waiting) for that opp. Cleared on Save or Skip.
  const [followUpStatusPromptId, setFollowUpStatusPromptId] = useState(null);
  // Snapshot of the Follow Up (and its sibling Call In) value from before
  // the edit that opened the FollowUpStatusModal. Lets the modal's Cancel
  // button put the Follow Up date back to what it was originally.
  const [followUpStatusPrev, setFollowUpStatusPrev] = useState(null);
  // Imperative sort trigger handed to the DataTable. Bumping it re-ranks
  // the table by Call In ascending — fired once the Follow Up status
  // popup is dismissed so the re-scheduled opp lands in its new
  // soonest-first position.
  const [callInSortSignal, setCallInSortSignal] = useState(null);
  const requestCallInSort = useCallback(() => {
    setCallInSortSignal({ key: 'Call In', direction: 'asc', nonce: Date.now() });
  }, []);
  // _id of the opp whose info popup is open, or null when no popup
  // is showing. Resolved against the live records list on render so
  // the popup always reflects the latest cell edits.
  const [infoOppId, setInfoOppId] = useState(null);
  // Double-clicking the Next Steps cell opens a read-only popup showing
  // the full value (useful when the column is narrow and the entry
  // spans multiple Alt+Enter lines). Closing is via the modal's own
  // Close / × buttons — Esc is intentionally not wired so accidental
  // presses don't blow away an in-flight edit.
  const [nextStepsPopupId, setNextStepsPopupId] = useState(null);
  // Mass-edit selection — set of row _id's the user has checked. The
  // mass-edit toolbar shows whenever this is non-empty.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Mass-edit mode. The checkbox column is only rendered (and the
  // bulk toolbar is only available) while this is on, so the default
  // view is uncluttered.
  const [massEditOn, setMassEditOn] = useState(false);
  // _ids of rows that DataTable is currently showing (after column
  // filters / search). Lets the select-column header offer a
  // "select all rows in the current filter" checkbox so the user
  // can mass-edit a filtered subset without per-row clicking.
  const [filteredRowIds, setFilteredRowIds] = useState(() => new Set());
  // When on, the table view is narrowed to just the rows the user has
  // ticked. The button only renders when there's at least one
  // selection, and we auto-flip back off as soon as the selection is
  // cleared (so the table doesn't go empty under the user).
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const handleFilteredRowsChange = useCallback((rows) => {
    setFilteredRowIds(prev => {
      const next = new Set();
      for (const r of (rows || [])) if (r?._id != null) next.add(r._id);
      if (prev.size === next.size) {
        let same = true;
        for (const id of prev) if (!next.has(id)) { same = false; break; }
        if (same) return prev;
      }
      return next;
    });
  }, []);
  // The HubSpot contact currently open in the rich ContactEditModal,
  // launched when the user clicks a tagged-contact name on the
  // Contact cell's popover. Null when no modal is open.
  const [editingContact, setEditingContact] = useState(null);
  useEffect(() => {
    if (showOnlySelected && selectedIds.size === 0) setShowOnlySelected(false);
  }, [showOnlySelected, selectedIds]);
  // Set while the "Import from Opps tab" one-time copy is running so
  // the button locks out double-clicks and shows a "Importing…"
  // label.
  const [importingFromOpps, setImportingFromOpps] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  // Dedup key for the Opps → Opps 2 one-time import. BFO Link is the
  // natural unique id; for rows that lack one we fall back to a
  // composite of Account + Open Year + Scope + Start Date so a
  // legacy hand-typed Opps 2 entry doesn't get blocked by a fuzzy
  // match against a Google-Sheets row with the same Account in a
  // different year.
  const oppDedupKeyForImport = useCallback((r) => {
    if (!r) return '';
    const bfo = String(r['BFO Link'] || '').trim().toLowerCase();
    if (bfo && bfo !== '-' && bfo !== '#n/a') return `bfo:${bfo}`;
    const acct = String(r['Account'] || '').trim().toLowerCase();
    const year = String(r['Open Year'] || '').trim();
    const scope = String(r['Scope'] || '').trim().toLowerCase();
    const start = String(r['Start Date'] || '').trim();
    if (!acct && !year && !scope && !start) return '';
    return `acct:${acct}|${year}|${scope}|${start}`;
  }, []);

  // One-time copy from the Opps tab's IndexedDB cache into Opps 2.
  // Adds only — every existing Opps 2 record is left exactly as-is.
  // Dedup is by BFO Link (with the composite fallback above), so a
  // re-run only adds rows that are new since the last import. The
  // user is free to re-click this any time they refresh the Opps tab
  // and want the new rows mirrored over.
  const importFromOppsTab = useCallback(async () => {
    if (importingFromOpps) return;
    setImportingFromOpps(true);
    try {
      let opps = null;
      try { opps = await dbGet('opps-cache', 'data'); } catch { /* ignore */ }
      const incoming = Array.isArray(opps?.records) ? opps.records : [];
      if (!incoming.length) {
        window.alert(
          'No Opps - Old tab data found in this browser. Open the Opps - Old tab once so it ' +
          'fetches the Google Sheet, then come back and click Import again.'
        );
        return;
      }
      const baseHeaders = data?.headers?.length ? data.headers : DEFAULT_HEADERS;
      const baseRecords = data?.records || [];
      const existingKeys = new Set();
      for (const r of baseRecords) {
        const k = oppDedupKeyForImport(r);
        if (k) existingKeys.add(k);
      }
      let nextId = baseRecords.reduce((m, r) => Math.max(m, Number(r?._id) || 0), 0);
      const additions = [];
      let skippedDuplicate = 0;
      // Bring everything across — every row the Opps tab cached is fair
      // game. The Opps cache parser already drops rows with no Account
      // and no other data, so we don't need a second guard here. Older
      // versions of this import filtered on Open Year and on having
      // Account-or-BFO Link, which silently dropped legitimate rows
      // (e.g. opps still missing an Open Year value) and produced a
      // smaller Opps 2 dataset than the source Opps tab.
      for (const r of incoming) {
        const key = oppDedupKeyForImport(r);
        if (!key || existingKeys.has(key)) { skippedDuplicate += 1; continue; }
        existingKeys.add(key);
        nextId += 1;
        // Stamp the row so per-row merge has a real signal — without it
        // an imported row counts as ts 0 (oldest) and could be dropped.
        additions.push({ ...r, _id: nextId, id: nextId, _source: 'opps-import', _rowUpdatedAt: Date.now() });
      }
      if (!additions.length) {
        window.alert(
          `Nothing new to import — every Opps - Old tab row (${incoming.length}) is ` +
          `already on Opps (duplicates skipped: ${skippedDuplicate}).`
        );
        return;
      }
      // Union headers so any columns the Opps tab tracks but Opps 2's
      // saved layout doesn't yet know about become selectable from the
      // Columns toggle. Preserve Opps 2's column order.
      const headerSet = new Set(baseHeaders);
      const mergedHeaders = [...baseHeaders];
      for (const h of (opps?.headers || [])) {
        if (h && !headerSet.has(h)) { headerSet.add(h); mergedHeaders.push(h); }
      }
      // Build the next state explicitly so we can persist it
      // synchronously below — relying solely on the debounced
      // save-effect lets a quick refresh / tab switch lose the import
      // (component unmount cancels the pending Firestore write, and on
      // the next load the stale Firestore copy wins over IndexedDB).
      const nextRecords = [...additions, ...(data?.records || [])];
      const nextState = { ...(data || {}), headers: mergedHeaders, records: nextRecords };
      // Snapshot the pre-import dataset (forced) so a bad import is one
      // click to undo from the Backups dropdown.
      await pushOpps2Backup(data, 'pre-import (Opps - Old tab)', { force: true });
      setData(nextState);
      // Cancel any in-flight debounced Firestore save so the explicit
      // write below isn't immediately followed by a stale debounced one.
      if (firestoreSaveTimerRef.current) {
        clearTimeout(firestoreSaveTimerRef.current);
        firestoreSaveTimerRef.current = null;
      }
      await saveOpps2Cache(nextState);
      let firestoreWarning = '';
      if (user?.uid) {
        try {
          const ts = await saveOpps2ToFirestore(user.uid, nextState);
          if (ts != null) lastFsSavedAtRef.current = ts;
        } catch (err) {
          console.error('Import from Opps tab: Firestore save failed:', err);
          firestoreWarning = `\n\nWarning: cross-device sync failed (${err?.message || err}). Rows are safe on this device — hydration now picks the newer of IndexedDB vs Firestore, so a refresh here will keep them.`;
        }
      }
      window.alert(
        `Imported ${additions.length} row${additions.length === 1 ? '' : 's'} ` +
        `from the Opps - Old tab. Skipped ${skippedDuplicate} already on Opps.${firestoreWarning}`
      );
    } catch (err) {
      console.error('Import from Opps tab failed:', err);
      window.alert(`Import failed: ${err?.message || err}`);
    } finally {
      setImportingFromOpps(false);
    }
  }, [importingFromOpps, data, oppDedupKeyForImport, user?.uid]);

  // Commit a batch of rows produced by the Bulk Import modal. The
  // modal has already done dedup + column mapping; we just splice the
  // additions into state and persist synchronously (same shape as the
  // Import-from-Opps path so refresh / tab-switch can't drop the
  // writes). New columns from the source paste merge into the Opps 2
  // header set so they're selectable from the Columns toggle.
  const commitBulkImport = useCallback(async (additions, sourceHeaders, mapping) => {
    if (!Array.isArray(additions) || additions.length === 0) return;
    const baseHeaders = data?.headers?.length ? data.headers : DEFAULT_HEADERS;
    const baseRecords = data?.records || [];
    const headerSet = new Set(baseHeaders);
    const mergedHeaders = [...baseHeaders];
    // The mapping values are the target Opps 2 columns; any new ones
    // (e.g. a sheet column the user mapped to a custom Opps 2 column)
    // get appended so they show up in the column toggle.
    for (const target of Object.values(mapping || {})) {
      if (target && !headerSet.has(target)) { headerSet.add(target); mergedHeaders.push(target); }
    }
    // Flag-and-import mode: rows arrive carrying `_reviewReason` (and,
    // for duplicate-of-existing rows, `_existingMatchId`). Stamp the
    // Review column on the new rows and post a back-reference Review
    // note on the existing rows so the user can audit collisions
    // in-place.
    const anyFlagged = additions.some(r => r?._reviewReason);
    if (anyFlagged && !headerSet.has('Review')) {
      headerSet.add('Review');
      mergedHeaders.push('Review');
    }
    let nextId = baseRecords.reduce((m, r) => Math.max(m, Number(r?._id) || 0), 0);
    // Map of existing _id → list of new opp ranks that point at it,
    // so a single existing row that collides with multiple imported
    // rows lists every match instead of overwriting.
    const existingFlagsByMatchId = new Map();
    // Display rank = position in the ascending sort of all _ids
    // (matches the Opp # column). After import: existing ranks stay
    // the same; new ones get baseRecords.length + 1 onward (since
    // they have the highest _ids).
    const baseExistingCount = baseRecords.filter(r => r?._id != null).length;
    const stamped = additions.map((r, idx) => {
      const id = ++nextId;
      const newRank = baseExistingCount + idx + 1;
      const { _reviewReason, _existingMatchId, ...rest } = r;
      const out = { ...rest, _id: id, id, _source: 'bulk-import', _rowUpdatedAt: Date.now() };
      if (_reviewReason) out['Review'] = _reviewReason;
      if (_existingMatchId != null) {
        const list = existingFlagsByMatchId.get(_existingMatchId) || [];
        list.push(newRank);
        existingFlagsByMatchId.set(_existingMatchId, list);
      }
      return out;
    });
    const flaggedExistingRecords = existingFlagsByMatchId.size > 0
      ? baseRecords.map(r => {
          const matches = existingFlagsByMatchId.get(r?._id);
          if (!matches?.length) return r;
          const label = matches.length === 1
            ? `Possible duplicate of imported opp# ${matches[0]}`
            : `Possible duplicate of imported opps# ${matches.join(', ')}`;
          const existing = String(r['Review'] || '').trim();
          const next = existing ? `${existing} · ${label}` : label;
          // This is a modification of an existing row — stamp it so the
          // Review note wins a merge against another device's copy.
          return { ...r, Review: next, _rowUpdatedAt: Date.now() };
        })
      : baseRecords;
    const nextRecords = [...stamped, ...flaggedExistingRecords];
    const nextState = { ...(data || {}), headers: mergedHeaders, records: nextRecords };
    // Snapshot the pre-import dataset (forced) so a bad bulk import is
    // one click to undo from the Backups dropdown.
    await pushOpps2Backup(data, 'pre-import (bulk paste)', { force: true });
    setData(nextState);
    if (firestoreSaveTimerRef.current) {
      clearTimeout(firestoreSaveTimerRef.current);
      firestoreSaveTimerRef.current = null;
    }
    await saveOpps2Cache(nextState);
    let firestoreWarning = '';
    if (user?.uid) {
      try {
        const ts = await saveOpps2ToFirestore(user.uid, nextState);
        if (ts != null) lastFsSavedAtRef.current = ts;
      } catch (err) {
        console.error('Bulk import: Firestore save failed:', err);
        firestoreWarning = `\n\nWarning: cross-device sync failed (${err?.message || err}). Rows are safe on this device.`;
      }
    }
    setBulkImportOpen(false);
    // Suppress unused-arg lint — sourceHeaders is informational only.
    void sourceHeaders;
    const flaggedNewCount = additions.filter(r => r?._reviewReason).length;
    const flaggedExistingCount = existingFlagsByMatchId.size;
    const flagSuffix = flaggedNewCount > 0
      ? `\n\nFlagged for review: ${flaggedNewCount} imported row${flaggedNewCount === 1 ? '' : 's'}${flaggedExistingCount > 0 ? ` + ${flaggedExistingCount} existing row${flaggedExistingCount === 1 ? '' : 's'}` : ''}. Look in the Review column.`
      : '';
    window.alert(`Imported ${additions.length} row${additions.length === 1 ? '' : 's'} from the pasted sheet.${flagSuffix}${firestoreWarning}`);
  }, [data, user?.uid]);

  // Look the tagged contact's full HubSpot record up by email (most
  // reliable) and fall back to a case-insensitive name match. When
  // nothing matches, fabricate a minimal record so ContactEditModal
  // can still display the name + email the user already had visible.
  const openContactDetails = useCallback((name, email) => {
    const normEmail = String(email || '').trim().toLowerCase();
    const normName = String(name || '').trim().toLowerCase();
    let found = null;
    if (normEmail) {
      found = (hubspotContacts || []).find(c => String(c?.email || '').trim().toLowerCase() === normEmail);
    }
    if (!found && normName) {
      found = (hubspotContacts || []).find(c => {
        const cName = [c?.firstname, c?.lastname].filter(Boolean).join(' ').trim().toLowerCase();
        return cName === normName;
      });
    }
    if (!found) {
      const parts = String(name || '').trim().split(/\s+/);
      found = {
        firstname: parts[0] || '',
        lastname: parts.slice(1).join(' ') || '',
        email: email || '',
      };
    }
    setEditingContact(found);
  }, [hubspotContacts]);

  // Open the prospect record for a tagged contact's company. Caller
  // hands us the already-resolved prospect (ContactCell has it via
  // the same companyMatchKeys lookup that drives the contact roster),
  // so we just hand it to the App-level handler that owns the modal.
  const openCompanyDetails = useCallback((prospect) => {
    if (!prospect || !onSelectProspect) return;
    onSelectProspect(prospect);
  }, [onSelectProspect]);

  // ContactEditModal saves through these handlers so per-contact
  // notes / nicknames / etc. land in the same Firestore settings
  // maps every other view writes to (Key Contacts uses the same
  // set). `silent` saves come from the modal's tag-autosave path —
  // don't close the modal in that case.
  const closeContactModal = useCallback((updated, opts) => {
    if (!opts?.silent) setEditingContact(null);
    void updated;
  }, []);
  const saveContactNote = useCallback((cid, note) => {
    const cur = settings?.contactNotes || {};
    const next = { ...cur };
    if (note && note.trim()) next[cid] = note; else delete next[cid];
    updateSettings({ contactNotes: next });
  }, [settings?.contactNotes, updateSettings]);
  const saveContactOldEmails = useCallback((cid, val) => {
    const cur = settings?.contactOldEmails || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactOldEmails: next });
  }, [settings?.contactOldEmails, updateSettings]);
  const saveContactNickname = useCallback((cid, val) => {
    const cur = settings?.contactNicknames || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val; else delete next[cid];
    updateSettings({ contactNicknames: next });
  }, [settings?.contactNicknames, updateSettings]);
  const saveContactTeamName = useCallback((cid, val) => {
    const cur = settings?.contactTeamNames || {};
    const next = { ...cur };
    if (val && val.trim()) next[cid] = val.trim(); else delete next[cid];
    updateSettings({ contactTeamNames: next });
  }, [settings?.contactTeamNames, updateSettings]);
  const saveContactReportsTo = useCallback((cid, managerIds) => {
    const cur = settings?.contactReportsTo || {};
    const next = { ...cur };
    const arr = Array.isArray(managerIds)
      ? managerIds.filter(Boolean).map(String)
      : (managerIds ? [String(managerIds)] : []);
    if (arr.length > 0) next[cid] = arr; else delete next[cid];
    updateSettings({ contactReportsTo: next });
  }, [settings?.contactReportsTo, updateSettings]);
  const saveContactFamily = useCallback((cid, info) => {
    const cur = settings?.contactFamilies || {};
    const next = { ...cur };
    const partner = String(info?.partner || '').trim();
    const kids = String(info?.kids || '').trim();
    if (!partner && !kids) delete next[cid];
    else next[cid] = { partner, kids };
    updateSettings({ contactFamilies: next });
  }, [settings?.contactFamilies, updateSettings]);
  const saveContactMetInPerson = useCallback((cid, met) => {
    const cur = settings?.contactMetInPerson || {};
    updateSettings({ contactMetInPerson: { ...cur, [cid]: !!met } });
  }, [settings?.contactMetInPerson, updateSettings]);
  const saveContactInvitedToLouisville = useCallback((cid, invited) => {
    const cur = settings?.contactInvitedToLouisville || {};
    updateSettings({ contactInvitedToLouisville: { ...cur, [cid]: !!invited } });
  }, [settings?.contactInvitedToLouisville, updateSettings]);

  // Hydration — load the user's saved opps. Both stores are kicked off
  // in parallel, but we paint whichever resolves first (IndexedDB
  // almost always wins) so the table is visible before the Firestore
  // round-trip lands. Once both are in we reconcile by `_updatedAt` and
  // merge any IDB-only Pricing-Option snapshots, same as before.
  useEffect(() => {
    if (!user?.uid) {
      // Logged-out / pre-auth: keep the seed but don't enable saves
      // (we'd hit the dbPut scoping guard).
      setLoading(false);
      return;
    }
    let cancelled = false;
    let painted = false;
    hydratedRef.current = false;
    setHydrated(false);
    setLoading(true);

    function applyResult(next) {
      const headerSet = new Set((next.headers || []).map(h => String(h || '').trim()).filter(Boolean));
      const extra = ENSURED_COLUMNS.filter(c => !headerSet.has(c));
      let withCols = extra.length ? { ...next, headers: [...(next.headers || []), ...extra] } : next;
      // Mirror `id` ← `_id` on every loaded record. New / imported rows
      // already carry this (see makeBlankOpp), but legacy and sheet-synced
      // rows can arrive with only `_id`. DataTable keys its row identity —
      // including the Call In freeze-sort snapshot — on `id`, so a missing
      // `id` would drop the row from that snapshot and the Call In header
      // click would appear to do nothing.
      {
        const recs = withCols.records || [];
        if (recs.some(r => r && r.id == null && r._id != null)) {
          withCols = {
            ...withCols,
            records: recs.map(r => (r && r.id == null && r._id != null ? { ...r, id: r._id } : r)),
          };
        }
      }
      // Initial-load only: order rows by Call In ascending so the most
      // urgent rows land at the top. Once hydratedRef flips true (after
      // reconcile finishes), every later setData skips this branch so
      // edits don't reorder rows mid-keystroke.
      if (!hydratedRef.current) {
        withCols = { ...withCols, records: sortRecordsByCallInAsc(withCols.records || []) };
      }
      setData(withCols);
      painted = true;
    }

    const fsPromise = loadOpps2FromFirestore(user.uid);
    const idbPromise = loadOpps2Cache();

    let fromFs = null;
    let fromIdb = null;
    let fsDone = false;
    let idbDone = false;

    function reconcile() {
      if (cancelled || !fsDone || !idbDone) return;
      // Read both stores so we can carry over Pricing-Option snapshots
      // written by the Pricing tab into IDB but not yet replicated to
      // Firestore. Without this safety net, a stale Firestore copy
      // would clobber the snapshot on `saveOpps2Cache`.
      const fsHas = fromFs && (Array.isArray(fromFs.records) || Array.isArray(fromFs.headers));
      const idbHas = fromIdb && (Array.isArray(fromIdb.records) || Array.isArray(fromIdb.headers));
      let next = null;
      if (fsHas && idbHas) {
        // PER-ROW reconcile (not whole-document last-write-wins). The
        // newest `_rowUpdatedAt` wins for each opp, so a stale full copy
        // on either side — e.g. a background tab that flushed later, or a
        // manual blob restore — can no longer revert rows edited more
        // recently on another device. IDB is the merge base so any
        // IDB-only Pricing-Option snapshot survives the union.
        next = mergeOpps2Datasets(fromIdb, fromFs);
        // Pricing-Option carve-out: a row the Pricing tab wrote into IDB
        // seconds ago may carry a `_pricingOption` that the merged
        // (possibly remote-won) row lacks. Re-apply those from IDB.
        const idbById = new Map();
        for (const r of (fromIdb?.records || [])) {
          if (r?._id != null) idbById.set(String(r._id), r);
        }
        let touched = false;
        const reconciled = (next.records || []).map(r => {
          const idbRow = idbById.get(String(r?._id));
          if (idbRow?._pricingOption && !r?._pricingOption) {
            touched = true;
            return {
              ...r,
              _pricingOption: idbRow._pricingOption,
              'Quoted Amount': idbRow['Quoted Amount'] ?? r['Quoted Amount'],
            };
          }
          return r;
        });
        if (touched) next = { ...next, records: reconciled };
        // Persist the merged union to BOTH stores so they converge and
        // the cloud reflects every device's latest rows. Replaces the old
        // "push only when IDB looked newer" path, which let a whole-doc
        // timestamp decide and so dropped rows that lived only in the
        // copy that happened to look older.
        saveOpps2Cache(next);
        trySaveOpps2ToFirestore(user.uid, next)
          .then(ts => { if (ts != null) lastFsSavedAtRef.current = ts; });
      } else if (idbHas) {
        // Cloud empty / unreadable — local cache is all we have; push it
        // up so the cloud catches up to whatever never made the round trip.
        next = fromIdb;
        trySaveOpps2ToFirestore(user.uid, next)
          .then(ts => { if (ts != null) lastFsSavedAtRef.current = ts; });
      } else if (fsHas) {
        // Cold local cache — seed it from the cloud.
        next = fromFs;
        saveOpps2Cache(next);
      }
      if (next) {
        applyResult(next);
        // Snapshot the dataset we loaded this session into the rolling
        // backup ring (forced, bypassing the throttle) so there's always
        // a known-good restore point captured before any local edits.
        pushOpps2Backup(next, 'session-load', { force: true });
      }
      setLoading(false);
      hydratedRef.current = true;
      setHydrated(true);
    }

    idbPromise.then(res => {
      if (cancelled) return;
      fromIdb = res;
      idbDone = true;
      // Render-while-fetching: paint the local cache the moment it
      // lands so the user sees the table before Firestore resolves.
      const idbHas = res && (Array.isArray(res.records) || Array.isArray(res.headers));
      if (!painted && idbHas) {
        applyResult(res);
        setLoading(false);
      }
      reconcile();
    }).catch(() => { idbDone = true; reconcile(); });

    fsPromise.then(res => {
      if (cancelled) return;
      fromFs = res;
      fsDone = true;
      // Cold-cache case: IDB had nothing, FS arrived first. Paint it
      // before the IDB read returns so we're not waiting on either.
      const fsHas = res && (Array.isArray(res.records) || Array.isArray(res.headers));
      if (!painted && fsHas) {
        applyResult(res);
        setLoading(false);
      }
      reconcile();
    }).catch(() => { fsDone = true; reconcile(); });

    return () => { cancelled = true; };
  }, [user?.uid]);

  // The Pricing → Options tab writes the snapshot directly into our
  // IndexedDB cache (so it survives a Pricing tab Clear) — when that
  // happens, patch the affected row in place. Reading the whole cache
  // back here would risk clobbering an in-flight cell edit that's only
  // in component state but not yet flushed to IDB.
  useEffect(() => {
    if (!user?.uid) return;
    function onSnapshotChanged(e) {
      if (!hydratedRef.current) return;
      const detail = e?.detail;
      if (!detail || detail.oppId == null) return;
      setData(prev => {
        const records = prev?.records || [];
        const idx = records.findIndex(r => String(r._id) === String(detail.oppId));
        if (idx === -1) return prev;
        const updates = detail.record || {};
        const merged = { ...records[idx] };
        if ('_pricingOption' in updates) merged._pricingOption = updates._pricingOption || null;
        if ('Quoted Amount' in updates) merged['Quoted Amount'] = updates['Quoted Amount'];
        const next = records.slice();
        next[idx] = merged;
        return { ...prev, records: next };
      });
    }
    window.addEventListener(OPPS_PRICING_SNAPSHOT_EVENT, onSnapshotChanged);
    return () => window.removeEventListener(OPPS_PRICING_SNAPSHOT_EVENT, onSnapshotChanged);
  }, [user?.uid]);

  // Real-time sync — subscribe to Firestore changes on the opps2 document
  // so edits from another browser (or device) arrive within ~500ms without
  // a page reload. The listener skips our own saves (identified by
  // lastFsSavedAtRef) and the initial snapshot that fires before hydration
  // completes. Incoming data is merged at the record level via
  // mergeOpps2Datasets so in-flight local edits are never overwritten by a
  // stale remote value for the same row.
  useEffect(() => {
    if (!user?.uid) return;
    const parentRef = doc(db, OPPS2_FIRESTORE_COLLECTION, user.uid);
    const unsub = onSnapshot(parentRef, async (snap) => {
      // Skip until our own initial load (getDoc + reconcile) is done.
      if (!hydratedRef.current) return;
      // Skip snapshots that only reflect our OWN un-acknowledged local
      // writes. Firestore's latency compensation fires the listener with
      // the locally-buffered value (metadata.hasPendingWrites === true)
      // before the server acks. Acting on those echoes merges them back
      // into state, which triggers another debounced save, which fires
      // the listener again — an infinite loop that enqueues a fresh
      // multi-megabyte chunked write each pass until the SDK throws
      // "resource-exhausted: Write stream exhausted maximum allowed
      // queued writes". We only care about server-confirmed updates here
      // (genuine edits from another device), which always arrive with
      // hasPendingWrites === false.
      if (snap.metadata?.hasPendingWrites) return;
      if (!snap.exists()) return;
      const raw = snap.data() || {};
      // Convert the ISO updatedAt field on the Firestore doc to ms so we
      // can compare it against lastFsSavedAtRef (also in ms).
      const remoteTs = raw.updatedAt ? Date.parse(raw.updatedAt) : 0;
      // Skip echoes of our own writes.
      if (remoteTs > 0 && remoteTs === lastFsSavedAtRef.current) return;
      // Reassemble the chunked JSON.
      try {
        let json = null;
        if (Number.isFinite(raw.chunkCount) && raw.chunkCount > 0) {
          const parts = new Array(raw.chunkCount).fill('');
          const chunksSnap = await getDocs(collection(parentRef, 'chunks'));
          chunksSnap.forEach((d) => {
            const idx = Number(d.id);
            if (Number.isFinite(idx) && idx >= 0 && idx < parts.length) {
              parts[idx] = String(d.data()?.json || '');
            }
          });
          json = parts.join('');
        } else if (raw.json) {
          json = raw.json;
        }
        if (!json) return;
        const remote = JSON.parse(json);
        setData(local => mergeOpps2Datasets(local, remote));
      } catch (err) {
        console.error('opps2: real-time sync failed to apply remote update', err);
      }
    }, (err) => {
      console.error('opps2: real-time listener error', err);
    });
    return () => unsub();
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the latest data + uid in refs so the unmount-flush effect
  // (which only runs on mount/unmount) can read the most recent values
  // without re-subscribing on every keystroke.
  const latestDataRef = useRef(data);
  const latestUidRef = useRef(user?.uid);
  useEffect(() => { latestDataRef.current = data; }, [data]);
  useEffect(() => { latestUidRef.current = user?.uid; }, [user?.uid]);

  // Persistence — IndexedDB writes immediately (cheap, survives
  // reload), Firestore writes are debounced 1.5s so a flurry of cell
  // edits collapses into a single round-trip. The saved _updatedAt is
  // captured so the real-time listener can skip our own echoes.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveOpps2Cache(data);
    if (!user?.uid) return;
    if (firestoreSaveTimerRef.current) clearTimeout(firestoreSaveTimerRef.current);
    firestoreSaveTimerRef.current = setTimeout(async () => {
      // Use the throwing variant so we can capture *why* the cloud write
      // failed (permission, quota, offline) and show it in the banner —
      // a denied/exhausted write must never go unnoticed while edits sit
      // only in the local cache.
      try {
        const ts = await saveOpps2ToFirestore(user.uid, data);
        lastFsSavedAtRef.current = ts;
        setLastSyncedAt(ts);
        setSyncError(false);
        setSyncErrorDetail('');
      } catch (err) {
        console.error('opps2: Firestore save failed', err);
        setSyncError(true);
        setSyncErrorDetail(err?.message || String(err));
      }
      // Drop a throttled snapshot into the rolling backup ring once edits
      // have settled. pushOpps2Backup self-throttles (one per few minutes)
      // and dedups by _updatedAt, so this is cheap on a flurry of saves.
      pushOpps2Backup(data, 'autosave');
    }, 1500);
    return () => {
      if (firestoreSaveTimerRef.current) clearTimeout(firestoreSaveTimerRef.current);
    };
  }, [data, user?.uid]);

  // Manual "Retry now" from the sync-failure banner. Writes the latest
  // data straight to Firestore (no debounce) and only clears the banner
  // once the write actually acks, so a still-failing connection keeps
  // the warning up instead of flickering it away.
  const retrySync = useCallback(async () => {
    if (!latestUidRef.current || retryingSync) return;
    setRetryingSync(true);
    try {
      const ts = await saveOpps2ToFirestore(latestUidRef.current, latestDataRef.current);
      lastFsSavedAtRef.current = ts;
      setLastSyncedAt(ts);
      setSyncError(false);
      setSyncErrorDetail('');
    } catch (err) {
      console.error('opps2: manual retry failed', err);
      setSyncError(true);
      setSyncErrorDetail(err?.message || String(err));
    } finally {
      setRetryingSync(false);
    }
  }, [retryingSync]);

  // Flush any pending Firestore save on unmount — without this, a
  // user who clicks Import (or makes a quick edit) and then switches
  // tabs inside the 1.5s debounce window loses the write. On next
  // hydration the stale Firestore copy wins over the up-to-date IDB
  // cache, so the change appears to vanish.
  useEffect(() => {
    return () => {
      if (firestoreSaveTimerRef.current && latestUidRef.current) {
        clearTimeout(firestoreSaveTimerRef.current);
        firestoreSaveTimerRef.current = null;
        // Guarded flush: merge against the cloud copy first so this
        // (possibly stale) tab can't blind-overwrite rows that are newer
        // in Firestore. App stays alive across an in-app tab switch, so
        // the async read-merge-write completes.
        flushOpps2ToFirestore(latestUidRef.current, latestDataRef.current)
          .then(ts => { if (ts != null) lastFsSavedAtRef.current = ts; });
      }
    };
  }, []);

  // Flush any pending Firestore save when the tab is closed / reloaded
  // so the last keystroke before a reload still survives the round
  // trip.
  useEffect(() => {
    function flush() {
      if (firestoreSaveTimerRef.current && user?.uid) {
        clearTimeout(firestoreSaveTimerRef.current);
        firestoreSaveTimerRef.current = null;
        // Guarded flush (best-effort on unload): merge against the cloud
        // so a stale tab closing can't revert newer rows. If the async
        // write doesn't finish before the tab dies, IDB still holds the
        // data and the next per-row hydration reconcile recovers it.
        flushOpps2ToFirestore(user.uid, data);
      }
    }
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [data, user?.uid]);

  const addNewOpp = useCallback((accountName, source, peOwner) => {
    setData(prev => {
      const records = prev?.records || [];
      const headers = prev?.headers?.length ? prev.headers : DEFAULT_HEADERS;
      const nextId = records.reduce((m, r) => Math.max(m, r._id || 0), 0) + 1;
      return { ...prev, headers, records: [makeBlankOpp(nextId, headers, accountName, source, peOwner), ...records] };
    });
  }, []);

  // ---- Undo stack -------------------------------------------------
  // In-memory history of the last UNDO_LIMIT cell mutations. Each
  // updateOppField / deleteOppField call snapshots the prior value
  // (including the sibling columns that get dropped as a side effect)
  // and pushes it here; the Undo button + Ctrl/Cmd+Z pop the top
  // entry and re-apply it via a private mutator that doesn't push
  // back onto the stack. Resets on reload because it's React state
  // only — Firestore + IndexedDB persist the *current* row state, not
  // its history.
  const UNDO_LIMIT = 50;
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);
  const [undoStack, setUndoStack] = useState([]);
  const pushUndoEntry = useCallback((entry) => {
    if (!entry || !entry.fields?.length) return;
    setUndoStack(prev => {
      const next = [...prev, entry];
      if (next.length > UNDO_LIMIT) next.shift();
      return next;
    });
  }, []);
  const undoLastChange = useCallback(() => {
    setUndoStack(prev => {
      if (!prev.length) return prev;
      const entry = prev[prev.length - 1];
      setData(d => {
        const records = d?.records || [];
        return {
          ...d,
          records: records.map(r => {
            if (r._id !== entry.id) return r;
            const next = { ...r };
            for (const f of entry.fields) {
              if (f.hadField) next[f.field] = f.prevValue;
              else delete next[f.field];
            }
            return next;
          }),
        };
      });
      return prev.slice(0, -1);
    });
  }, []);

  // Configurable per-type clear schedules (✓ / ✗ / any), persisted in
  // per-user localStorage. The toolbar button opens a modal to edit these.
  const [nfatSchedules, setNfatSchedules] = useState(loadNfatSchedules);
  const [nfatScheduleOpen, setNfatScheduleOpen] = useState(false);
  const saveNfatSchedules = useCallback((next) => {
    setNfatSchedules(next);
    try { userLsSet(NFAT_SCHEDULES_KEY, JSON.stringify(next)); } catch { /* quota */ }
  }, []);

  // Blank the matching "No Further Action Today" cells for a given clear
  // type ('check' → ✓, 'x' → ✗, 'any' → anything set). Shared by the
  // configurable schedules and the modal's "Clear now" buttons. Clears the
  // value, drops the `_nfatSetAt` tracking stamp, and bumps
  // `_rowUpdatedAt` so the cleared value wins the cross-device merge over
  // a stale mark on another device. Returns the number of rows cleared.
  const clearNfat = useCallback((type) => {
    const recs = dataRef.current?.records || [];
    const count = recs.reduce(
      (n, r) => n + (nfatValueMatches(r?.['No Further Action Today'], type) ? 1 : 0),
      0,
    );
    if (count > 0) {
      setData(prev => {
        const rs = prev?.records || [];
        let touched = false;
        const next = rs.map(r => {
          if (!nfatValueMatches(r?.['No Further Action Today'], type)) return r;
          touched = true;
          const copy = { ...r };
          copy['No Further Action Today'] = '';
          delete copy._nfatSetAt;
          copy._rowUpdatedAt = Date.now();
          return copy;
        });
        if (!touched) return prev;
        return { ...prev, records: next };
      });
    }
    return count;
  }, []);

  // Global Cmd/Ctrl+Z. Skipped when the user has an input/textarea
  // focused so the browser's native text-undo still works mid-edit;
  // the toolbar button stays available either way.
  useEffect(() => {
    function onKeyDown(e) {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta || e.shiftKey || e.altKey) return;
      if ((e.key || '').toLowerCase() !== 'z') return;
      const ae = document.activeElement;
      const tag = (ae?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || ae?.isContentEditable) return;
      e.preventDefault();
      undoLastChange();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undoLastChange]);

  const updateOppField = useCallback((id, field, rawValue) => {
    // Auto-format a user-entered Quoted Amount to currency ($25,000) so
    // the stored value — and every view that reads it — stays consistent,
    // regardless of how the user typed it (25000, 25,000, $25000.50…).
    const value = field === 'Quoted Amount' ? formatQuotedAmount(rawValue) : rawValue;
    // Snapshot the prior cell state before the mutation so the Undo
    // stack can restore it. We also snapshot the sibling columns that
    // are dropped as a side effect (Follow Up → Call In, Last Client
    // Heard From Us → Last Spoke) so a single undo restores all of
    // them in one step instead of leaving the user to chase the
    // computed column back to life via "+ add".
    const row = (dataRef.current?.records || []).find(r => r._id === id);
    const stageChanged = !!row && field === 'Stage' && String(row[field] ?? '') !== String(value ?? '');
    // A changed Follow Up date prompts the user to set the new Status
    // (Who is waiting) for that opp. Compared on the ISO date so a
    // reformat of the same day doesn't trigger the prompt.
    const followUpChanged = !!row && field === 'Follow Up'
      && (toISODate(row[field]) || '') !== (toISODate(value) || '');
    // When the user enters a Close Date, mirror its year + month into the
    // "Close Year" / "Close Month" columns so the Opp details stay in
    // sync without manual entry. A cleared date clears them; an
    // unparseable entry leaves them untouched so a typo doesn't wipe
    // good data.
    let closeDerived = null;
    if (row && field === 'Close Date') {
      const { yearCols, monthCols } = findCloseDerivedColumns(dataRef.current?.headers);
      if (yearCols.length || monthCols.length) {
        const d = parseCloseDate(value);
        const cleared = String(value ?? '').trim() === '';
        if (d || cleared) {
          closeDerived = {
            yearCols,
            monthCols,
            yearVal: d ? String(d.getFullYear()) : '',
            monthVal: d ? MONTH_FULL_NAMES[d.getMonth()] : '',
          };
        }
      }
    }
    // When the Stage flips TO "Sold" or "Not Sold", stamp the Close Date
    // with the date of the status change (today) and mirror it into the
    // derived Close Year / Close Month columns, just like a manual Close
    // Date edit would. Computed here so it can be snapshotted for undo
    // and applied inside the setData mapper below. For Not Sold the
    // follow-up popup opens right after, pre-filled with the stamped
    // date, so the user can adjust it on the spot.
    //
    // Only fill an EMPTY Close Date — never overwrite one already on the
    // row. Re-marking a deal Sold (or a bulk Stage update) used to clobber
    // a real close date with today's date, which silently moved last
    // year's sales into the current year on the YOY Annual Sales chart.
    const hasCloseDate = !!row && String(row['Close Date'] ?? '').trim() !== '';
    const newStageNorm = String(value ?? '').trim().toLowerCase();
    let closeStamp = null;
    if (stageChanged && !hasCloseDate && (newStageNorm === 'sold' || newStageNorm === 'not sold')) {
      const today = todayISO();
      const { yearCols, monthCols } = findCloseDerivedColumns(dataRef.current?.headers);
      const d = parseCloseDate(today);
      closeStamp = {
        date: today,
        yearCols,
        monthCols,
        yearVal: d ? String(d.getFullYear()) : '',
        monthVal: d ? MONTH_FULL_NAMES[d.getMonth()] : '',
      };
    }
    if (row) {
      const snap = (f) => ({ field: f, hadField: f in row, prevValue: f in row ? row[f] : undefined });
      const fields = [snap(field)];
      if (field === 'Follow Up' && 'Call In' in row) fields.push(snap('Call In'));
      if (field === 'Last Client Heard From Us' && 'Last Spoke' in row) fields.push(snap('Last Spoke'));
      // Snapshot the auto-stamped Close Date (+ derived columns) so one
      // undo of the Sold / Not Sold stage change also restores them.
      if (closeStamp) {
        fields.push(snap('Close Date'));
        for (const c of [...closeStamp.yearCols, ...closeStamp.monthCols]) fields.push(snap(c));
      }
      // Days-in-Stage reads `_stageEnteredAt`; snapshot it alongside the
      // Stage edit so an undo restores both in one step. The Stage
      // History tab reads `_stageHistory`, so we snapshot that too.
      if (stageChanged) {
        fields.push(snap('_stageEnteredAt'));
        fields.push(snap('_stageHistory'));
      }
      // No Further Action Today flips track when the row was marked
      // (see `_nfatSetAt`) so the daily start-of-day auto-clear can
      // tell yesterday's leftovers from today's marks. Snapshot it
      // for undo too.
      if (field === 'No Further Action Today') fields.push(snap('_nfatSetAt'));
      // Snapshot the auto-filled Close Year / Close Month so one undo of
      // the Close Date edit restores them in the same step.
      if (closeDerived) {
        for (const c of [...closeDerived.yearCols, ...closeDerived.monthCols]) fields.push(snap(c));
      }
      pushUndoEntry({ id, fields });
    }
    setData(prev => {
      const records = prev?.records || [];
      return {
        ...prev,
        records: records.map(r => {
          if (r._id !== id) return r;
          const now = Date.now();
          const next = { ...r, [field]: value, _rowUpdatedAt: now };
          // When the source date for a computed column changes, drop
          // any sheet-imported stored value on the computed column so
          // the render falls back to a live recompute. Without this, an
          // imported row that arrived with a blank Call In would stay
          // blank forever even after the user picks a new Follow Up.
          if (field === 'Follow Up' && 'Call In' in next) delete next['Call In'];
          if (field === 'Last Client Heard From Us' && 'Last Spoke' in next) delete next['Last Spoke'];
          // Auto-fill the derived Close Year / Close Month columns from
          // the new Close Date (computed above).
          if (closeDerived) {
            for (const c of closeDerived.yearCols) next[c] = closeDerived.yearVal;
            for (const c of closeDerived.monthCols) next[c] = closeDerived.monthVal;
          }
          // Auto-stamp the Close Date (+ derived columns) when the stage
          // flips to Sold or Not Sold, using the status-change date.
          if (closeStamp) {
            next['Close Date'] = closeStamp.date;
            for (const c of closeStamp.yearCols) next[c] = closeStamp.yearVal;
            for (const c of closeStamp.monthCols) next[c] = closeStamp.monthVal;
          }
          // Stamp the stage-entry date whenever Stage flips to a new
          // value so Days-in-Stage measures "time since the last move"
          // rather than the row's age. We also push a history entry
          // for the stage being left so the Stage History tab can
          // report per-stage days for each opp.
          if (stageChanged) {
            const today = todayISO();
            const prevStage = String(r['Stage'] ?? '').trim();
            const prevEntered = toISODate(r._stageEnteredAt) || toISODate(r['Start Date']);
            const dur = prevEntered ? daysBetween(prevEntered, today) : null;
            const days = dur == null ? null : Math.max(0, dur);
            const prior = Array.isArray(r._stageHistory) ? r._stageHistory : [];
            next._stageHistory = [
              ...prior,
              { stage: prevStage, enteredAt: prevEntered || '', exitedAt: today, days },
            ];
            next._stageEnteredAt = today;
          }
          // Track when the No-Further-Action-Today X was placed so the
          // 2 PM Eastern sweep can clear stale ones without nuking a
          // mark the user just made.
          if (field === 'No Further Action Today') {
            const norm = String(value ?? '').trim().toLowerCase();
            if (norm === 'no') next._nfatSetAt = new Date().toISOString();
            else delete next._nfatSetAt;
          }
          // Record per-field edit times so a concurrent edit to a
          // *different* field of this same opp on another device merges
          // field-by-field, instead of one whole-row version clobbering
          // the other. Stamp exactly the fields this edit changed.
          next._fieldUpdatedAt = stampChangedFields(r, next, now);
          return next;
        }),
      };
    });
    // Prompt for the close-out details (Close Date / Reason Not Sold /
    // Final Margin) whenever the Stage flips TO "Not Sold". Skipped on
    // bulk mass-edits — those run through the bulk path below and we
    // don't want to multi-modal across selections.
    if (stageChanged && String(value ?? '').trim().toLowerCase() === 'not sold') {
      setNotSoldPromptId(id);
    }
    // Prompt for the quote-tracking data points (Quoted On / Chance? /
    // Margin Email Date - Sales Leader Review Date) whenever the Stage
    // flips TO "Quoted" so they can be entered or reviewed on the spot.
    if (stageChanged && String(value ?? '').trim().toLowerCase() === 'quoted') {
      setQuotedPromptId(id);
    }
    // Prompt for the agreement-stage approval data points (USD?, Margin
    // Email / Sales Leader Review date, Chance?, Multiple Invoices?,
    // Verbal, Entity Outside the US Approval, COA Approval) whenever the
    // Stage flips TO "Agreement Sent" so they can be entered / reviewed
    // on the spot.
    if (stageChanged && String(value ?? '').trim().toLowerCase() === 'agreement sent') {
      setAgreementSentPromptId(id);
    }
    // Prompt for the close-out details (Reason Not Sold / Final Margin /
    // Competition) whenever the Stage flips TO "Sold". The Close Date was
    // already auto-stamped above.
    if (stageChanged && String(value ?? '').trim().toLowerCase() === 'sold') {
      setSoldPromptId(id);
    }
    // Prompt for the Quoted Amount whenever the Stage flips FROM "Not
    // Started" TO "Lead", so the number is captured the moment the opp
    // becomes active.
    if (
      stageChanged
      && String(row['Stage'] ?? '').trim().toLowerCase() === 'not started'
      && String(value ?? '').trim().toLowerCase() === 'lead'
    ) {
      setLeadQuotedPromptId(id);
    }
    // Whenever the Follow Up date changes, prompt for the new Status so
    // the "Who is waiting" value stays current with each follow-up.
    if (followUpChanged) {
      setFollowUpStatusPromptId(id);
      // Remember the pre-edit Follow Up (and the sibling Call In that
      // gets dropped as a side effect) so the modal's Cancel button can
      // restore the original date.
      setFollowUpStatusPrev({
        hadFollowUp: 'Follow Up' in row,
        followUp: row['Follow Up'],
        hadCallIn: 'Call In' in row,
        callIn: row['Call In'],
      });
    }
  }, [pushUndoEntry]);

  // Restore the Follow Up date (and its sibling Call In) to the snapshot
  // taken before the edit that opened the FollowUpStatusModal. Writes the
  // values back directly via setData rather than updateOppField so the
  // restore doesn't itself count as a change and re-open the prompt.
  const revertFollowUpDate = useCallback((id, prev) => {
    if (!prev) return;
    setData(cur => {
      const records = cur?.records || [];
      return {
        ...cur,
        records: records.map(r => {
          if (r._id !== id) return r;
          const now = Date.now();
          const next = { ...r, _rowUpdatedAt: now };
          if (prev.hadFollowUp) next['Follow Up'] = prev.followUp;
          else delete next['Follow Up'];
          if (prev.hadCallIn) next['Call In'] = prev.callIn;
          else delete next['Call In'];
          next._fieldUpdatedAt = stampChangedFields(r, next, now);
          return next;
        }),
      };
    });
  }, []);

  // Drop a field entirely from a row. Used to clear a user-set Call In
  // override so the live compute from Follow Up takes over again — the
  // sentinel-checking path in resolveComputedDays only ignores the
  // stored value when the key is missing, not just empty.
  const deleteOppField = useCallback((id, field) => {
    const row = (dataRef.current?.records || []).find(r => r._id === id);
    if (row && field in row) {
      pushUndoEntry({ id, fields: [{ field, hadField: true, prevValue: row[field] }] });
    }
    setData(prev => {
      const records = prev?.records || [];
      return {
        ...prev,
        records: records.map(r => {
          if (r._id !== id) return r;
          if (!(field in r)) return r;
          const next = { ...r };
          delete next[field];
          return next;
        }),
      };
    });
  }, [pushUndoEntry]);

  const deleteOpp = useCallback((id) => {
    setData(prev => {
      const records = prev?.records || [];
      // Tombstone the id so the delete propagates across devices instead
      // of the row resurrecting from a stale copy on the next merge.
      return {
        ...prev,
        records: records.filter(r => r._id !== id),
        _deletedIds: { ...(prev?._deletedIds || {}), [String(id)]: Date.now() },
      };
    });
    setSelectedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const updateManyOppFields = useCallback((ids, field, value) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (!idSet.size || !field) return;
    setData(prev => {
      const records = prev?.records || [];
      const stamp = field === 'Stage' ? todayISO() : null;
      return {
        ...prev,
        records: records.map(r => {
          if (!idSet.has(r._id)) return r;
          const now = Date.now();
          const next = { ...r, [field]: value, _rowUpdatedAt: now };
          // Same stage-entry stamp the single-row path applies, so bulk
          // moves through Days-in-Stage start the clock at the bulk
          // edit instead of the rows' original Start Date. Also append
          // a stage-history entry for the stage being left so the
          // Stage History tab matches what the single-row updater
          // produces.
          if (stamp && String(r[field] ?? '') !== String(value ?? '')) {
            const prevStage = String(r[field] ?? '').trim();
            const prevEntered = toISODate(r._stageEnteredAt) || toISODate(r['Start Date']);
            const dur = prevEntered ? daysBetween(prevEntered, stamp) : null;
            const days = dur == null ? null : Math.max(0, dur);
            const prior = Array.isArray(r._stageHistory) ? r._stageHistory : [];
            next._stageHistory = [
              ...prior,
              { stage: prevStage, enteredAt: prevEntered || '', exitedAt: stamp, days },
            ];
            next._stageEnteredAt = stamp;
          }
          // Track when No-Further-Action-Today gets flipped via the
          // mass-edit bar, same as the single-row updater. The 2 PM
          // Eastern sweep needs the stamp to decide what to clear.
          if (field === 'No Further Action Today') {
            const norm = String(value ?? '').trim().toLowerCase();
            if (norm === 'no') next._nfatSetAt = new Date().toISOString();
            else delete next._nfatSetAt;
          }
          next._fieldUpdatedAt = stampChangedFields(r, next, now);
          return next;
        }),
      };
    });
  }, []);

  const deleteManyOpps = useCallback((ids) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (!idSet.size) return;
    setData(prev => {
      const records = prev?.records || [];
      const now = Date.now();
      const deletedIds = { ...(prev?._deletedIds || {}) };
      for (const id of idSet) deletedIds[String(id)] = now;
      return { ...prev, records: records.filter(r => !idSet.has(r._id)), _deletedIds: deletedIds };
    });
    setSelectedIds(new Set());
  }, []);

  const updateColumnLinks = useCallback((nextLinks) => {
    setData(prev => ({ ...(prev || {}), columnLinks: nextLinks || {} }));
  }, []);

  const toggleHideService = useCallback((scope) => {
    setHiddenServices(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope); else next.add(scope);
      return next;
    });
  }, []);

  // Run the configured "No Further Action Today" clear schedules. For each
  // enabled type, if its most recent scheduled occurrence (Eastern weekday
  // + time) is newer than the last time it ran, the clear fires — which
  // also catches up a scheduled time that passed while the app was closed.
  // We re-check on mount (after hydration) and every minute the tab is
  // open, so a tab left open across a scheduled time self-clears. Gating on
  // `hydrated` ensures we clear the reconciled dataset, not the cache paint.
  useEffect(() => {
    if (!hydrated) return undefined;
    const tick = () => {
      const now = Date.now();
      let changed = false;
      const next = { ...nfatSchedules };
      for (const type of NFAT_SCHEDULE_TYPES) {
        const s = next[type];
        if (!s?.enabled) continue;
        const occ = mostRecentNfatScheduleMs(s.days, s.time, now);
        if (occ == null || (s.lastRunAt || 0) >= occ) continue;
        clearNfat(type);
        next[type] = { ...s, lastRunAt: now };
        changed = true;
      }
      // Persist the advanced lastRunAt stamps so a missed-run catch-up
      // doesn't re-fire on the next tick / reload.
      if (changed) saveNfatSchedules(next);
    };
    tick();
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, [hydrated, nfatSchedules, clearNfat, saveNfatSchedules]);

  const headers = data?.headers || [];
  const columnLinks = data?.columnLinks || {};
  // Effective dropdown vocabulary: built-in lists overlaid with the
  // user's edits from the Dropdowns tab. Recomputed when the user
  // tweaks a list so cells and the Link Columns modal stay in sync.
  const dropdownLists = useMemo(
    () => getEffectiveDropdownLists(settings),
    [settings?.dropdownLists]
  );
  const listRegistry = useMemo(() => buildListRegistry(dropdownLists), [dropdownLists]);
  const availableLists = useMemo(() => buildAvailableLists(dropdownLists), [dropdownLists]);
  const records = useMemo(() => data?.records || [], [data]);

  // Drop any selection ids that no longer match a live record (e.g.
  // after a hydration that replaced records, or a delete that came in
  // through another path). Keeps the mass-edit count honest.
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const alive = new Set(records.map(r => r._id));
      let changed = false;
      const next = new Set();
      for (const id of prev) {
        if (alive.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [records]);

  // Sorted, deduped list of company names — fed into the Account
  // column's autocomplete. Pulls from Table View prospects first
  // (the user's authoritative customer list); also folds in any
  // Account names already present in this tab's opps so adding a
  // follow-up opp for an existing account still autocompletes even
  // when the Table View hasn't loaded.
  const companySuggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    const push = (name) => {
      const c = String(name || '').trim();
      if (!c) return;
      const k = c.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(c);
    };
    for (const p of (prospects || [])) push(p?.company);
    for (const r of (data?.records || [])) push(r?.Account);
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [prospects, data?.records]);

  // Predictive-text source for the PE Owner column. Mirrors the PE Owner
  // picker in the company popup: every Table View company is offered, but
  // Private Equity firms are surfaced first since a portfolio company's
  // PE Owner is normally one of those firms. Any PE Owner already typed
  // into an opp is folded in too so follow-ups autocomplete.
  const peOwnerSuggestions = useMemo(() => {
    const seen = new Set();
    const pe = [];
    const others = [];
    const push = (name, isPe) => {
      const c = String(name || '').trim();
      if (!c) return;
      const k = c.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      (isPe ? pe : others).push(c);
    };
    for (const p of (prospects || [])) {
      if (String(p?.type) === 'Private Equity') push(p?.company, true);
    }
    for (const p of (prospects || [])) push(p?.company, false);
    for (const r of (data?.records || [])) {
      for (const o of splitPeOwners(r?.['PE Owner'])) push(o, false);
    }
    pe.sort((a, b) => a.localeCompare(b));
    others.sort((a, b) => a.localeCompare(b));
    return [...pe, ...others];
  }, [prospects, data?.records]);

  // Map of opp `_id` → 1..N display rank. Ranks by ascending `_id` so
  // the relative creation order of surviving opps is preserved, but
  // gaps from deleted rows are compacted out — the column reads as a
  // simple count of opps on the page rather than as the raw internal
  // id. Stays a stable per-opp value across sort/filter (it's a
  // property of the row's `_id`, not the rendered position), but does
  // shift when opps are added or deleted.
  const oppNumberById = useMemo(() => {
    const map = new Map();
    const ids = (data?.records || [])
      .map(r => r?._id)
      .filter(id => id != null)
      .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
    ids.forEach((id, idx) => map.set(id, idx + 1));
    return map;
  }, [data?.records]);

  const columns = useMemo(() => {
    const seen = new Set();
    const mapped = headers
      .filter(h => {
        if (!h || seen.has(h)) return false;
        seen.add(h);
        return true;
      })
      .map(h => ({
        key: h,
        label: headerLabel(h),
        defaultWidth: h === 'Notes' ? 250 : h === 'Next Steps' ? 240 : h === 'Account' ? 200 : h === 'BFO Link' ? 220 : h === 'Scope' ? 220 : TRISTATE_COLUMNS.has(h) ? 90 : h.length > 20 ? 160 : 120,
        sticky: h === 'Account',
        // Every cell is click-to-edit so a freshly created opp can be
        // filled in directly. getFilterValue exposes the raw text to
        // the per-column filter so search keeps working on the value
        // the user sees, not the rendered <input>.
        // Computed columns derive from sibling fields (and may honor a
        // sheet-imported literal); surface the live displayed value so
        // search / filter match what the cell actually shows.
        getFilterValue: (row) => {
          if (h === 'Call In') {
            const n = resolveCallIn(row);
            return n == null ? '' : String(n);
          }
          if (h === 'Last Spoke') {
            const n = resolveLastSpoke(row);
            return n == null ? '' : String(n);
          }
          if (h === 'Waiting On') {
            const stacked = (Array.isArray(row._nextStepsWaiting) ? row._nextStepsWaiting : [])
              .map(s => String(s || '').trim())
              .filter(Boolean)
              .join('\n');
            return stacked || String(row[h] ?? '');
          }
          if (isFlagsColumn(h)) {
            // Expose the auto "needs USD" flag to the column filter /
            // search so the user can isolate flagged rows by typing
            // "needs USD" (or 🚩), on top of any manual flag text.
            const manual = String(row[h] ?? '').trim();
            return needsUsdFlag(row) ? `🚩 needs USD ${manual}`.trim() : manual;
          }
          return row[h] ?? '';
        },
        // Sort by the same displayed value — without this, DataTable
        // falls back to the stored (empty / stale) cell and the order
        // doesn't match what you see (e.g. negative "overdue" days
        // wouldn't lead an ascending sort).
        getSortValue: (h === 'Call In' || h === 'Last Spoke')
          ? (row) => (h === 'Call In' ? resolveCallIn(row) : resolveLastSpoke(row))
          : undefined,
        // Call In is derived from Follow Up. If the table re-sorted on
        // every edit, typing a new Follow Up date would yank the row out
        // from under the cursor as its Call In recomputed. Freeze the
        // order at click time so manual triage stays stable — the user
        // re-clicks the header when they want a fresh ranking.
        freezeSortOrder: h === 'Call In' ? true : undefined,
        render: (row) => {
          if (isFlagsColumn(h)) {
            // Auto 🚩 when the deal is past Lead but the `USD?` field has
            // no real value (blank or "-"). Stays editable so manual flag
            // notes can sit alongside the auto indicator.
            const auto = needsUsdFlag(row);
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {auto && (
                  <span
                    title="Stage is Qualifying or later but the USD? field is blank or “-”"
                    style={{ fontSize: '0.95rem', flexShrink: 0, lineHeight: 1 }}
                  >🚩</span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <EditableCell
                    value={row[h]}
                    onChange={(v) => updateOppField(row._id, h, v)}
                  />
                </div>
              </div>
            );
          }
          if (h === 'Call In') {
            // Click-to-clear / click-to-restore. The cell still
            // computes live from Follow Up by default; the user can
            // override to blank per opp (stores a sentinel) and undo
            // that override with the "+ add" affordance.
            return (
              <CallInCell
                row={row}
                onClear={() => updateOppField(row._id, 'Call In', '-')}
                onRestore={() => deleteOppField(row._id, 'Call In')}
              />
            );
          }
          if (TRISTATE_COLUMNS.has(h)) {
            return (
              <TristateCheckCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                title={`${h}: blank → ✓ → ✗ → blank`}
              />
            );
          }
          if (h === 'Pricing Option') {
            // Read-only column populated from the Pricing → Options tab.
            // The cell shows the linked option name (or em-dash). A
            // small × button clears the link in place.
            const linked = optionLinks[String(row._id)] || '';
            return (
              <PricingOptionCell
                value={linked}
                onClear={() => setOppOptionLink(row._id, '')}
              />
            );
          }
          if (h === 'Quoted Amount') {
            // When the opp has a Pricing-Option snapshot attached, the
            // cell renders as a hyperlink that opens the Opp details
            // popup (where the snapshot detail lives) and exposes a
            // small ✎ for inline override edits. A manual URL on
            // `_quotedAmountUrl` takes precedence so users can attach
            // a quote PDF / BFO doc / etc.
            // Resolve the linked Option's services from the live
            // per-Option map (keyed by sheetName, which equals the saved
            // snapshot's name / the opp's Pricing Option link). Used as a
            // fallback for snapshots saved before services were frozen in.
            const optName = String(row._pricingOption?.name || optionLinks[String(row._id)] || '').trim();
            const cellServices = (optName && pricingOptionServices) ? (pricingOptionServices[optName] || []) : [];
            return (
              <QuotedAmountCell
                value={row[h]}
                snapshot={row._pricingOption || null}
                onChange={(v) => updateOppField(row._id, h, v)}
                onViewSnapshot={() => setInfoOppId(row._id)}
                url={row._quotedAmountUrl || ''}
                onChangeUrl={(u) => updateOppField(row._id, '_quotedAmountUrl', u)}
                services={cellServices}
                bfoName={row['BFO Link']}
                bfoAddress={row['BFO Address']}
              />
            );
          }
          if (h === 'Last Spoke') {
            // Business days since the Last Client Heard From Us date —
            // mirrors the Call In logic above, honoring a sheet-imported
            // blank when present.
            const n = resolveLastSpoke(row);
            return <ComputedCell value={n == null ? '' : n} />;
          }
          if (DATE_COLUMNS.has(h)) {
            return <DateCell value={row[h]} onChange={(v) => updateOppField(row._id, h, v)} />;
          }
          const link = resolveColumnLink(h, columnLinks);
          if (link) {
            const opts = listRegistry.get(link.listKey)?.options || [];
            if (link.mode === 'multi') {
              // Surface the Pricing-tab per-Option services bundle only
              // when this cell's vocabulary is the Solutions catalog
              // (the source of those mappings) — so the quick picker
              // doesn't appear on unrelated multi-select cells the user
              // might bind to other lists.
              const extraGroups = link.listKey === 'solutions'
                ? Object.entries(pricingOptionServices || {})
                    .map(([sheetName, services]) => ({
                      label: sheetName,
                      options: Array.isArray(services) ? services : [],
                    }))
                    .filter(g => g.options.length > 0)
                    .sort((a, b) => a.label.localeCompare(b.label))
                : undefined;
              return (
                <MultiSelectCell
                  value={row[h]}
                  onChange={(v) => updateOppField(row._id, h, v)}
                  options={opts}
                  extraGroups={extraGroups}
                  extraGroupsLabel="Add from Pricing Option"
                  extraGroupsPlaceholder="— pick an option —"
                  nowrap={h === 'Scope'}
                />
              );
            }
            return (
              <SelectCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                options={opts}
              />
            );
          }
          if (h === 'Contact') {
            return (
              <ContactCell
                value={row[h]}
                onChange={(v) => updateOppField(row._id, h, v)}
                account={row['Account']}
                peOwner={row['PE Owner']}
                prospects={prospects}
                updateProspect={updateProspect}
                hubspotContacts={hubspotContacts}
                onOpenContact={openContactDetails}
                onOpenCompany={openCompanyDetails}
                contactEmails={row._contactEmails}
                onChangeEmails={(m) => updateOppField(row._id, '_contactEmails', m)}
              />
            );
          }
          if (h === 'Waiting On') {
            // Mirror the popup's per-step Waiting On values into the
            // table column. The Next Steps editor stores a parallel
            // array (_nextStepsWaiting) aligned with each note line, so
            // joining the non-empty entries with newlines stacks them
            // visually in the cell (white-space: pre keeps each on its
            // own row; auto-grow row heights handle vertical fit).
            // When the popup hasn't been used yet, fall back to the
            // legacy editable field so a manually-typed value still
            // shows and stays editable.
            const stacked = (Array.isArray(row._nextStepsWaiting) ? row._nextStepsWaiting : [])
              .map(s => String(s || '').trim())
              .filter(Boolean)
              .join('\n');
            if (stacked) {
              return (
                <span
                  onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); setNextStepsPopupId(row._id); }}
                  title="Double-click to edit in Notes"
                  style={{
                    display: 'block', cursor: 'pointer', minHeight: '1em',
                    padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
                  }}
                >{stacked}</span>
              );
            }
          }
          if (h === 'Next Steps') {
            return (
              <NextStepsCell
                value={row[h]}
                onOpen={() => setNextStepsPopupId(row._id)}
              />
            );
          }
          if (h === 'BFO Company Name') {
            return <BfoCompanyNameCell account={row['Account']} prospects={prospects} updateProspect={updateProspect} />;
          }
          return (
            <EditableCell
              value={row[h]}
              onChange={(v) => updateOppField(row._id, h, v)}
              suggestions={h === 'Account' ? companySuggestions : h === 'PE Owner' ? peOwnerSuggestions : undefined}
              renderDisplay={h === 'Account' ? ({ enterEdit, isEmpty, text }) => {
                const matched = isEmpty ? null : findProspectForAccount(row[h], prospects);
                // No matching prospect — fall back to the normal
                // click-to-edit text cell.
                if (!matched) {
                  return (
                    <span
                      onClick={(e) => { e.stopPropagation(); enterEdit(); }}
                      style={{
                        display: 'block', cursor: 'text', minHeight: '1em',
                        padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
                        color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
                      }}
                    >{text}</span>
                  );
                }
                // Matched a prospect — render the company name as a link
                // that opens the company popup. Double-click still edits.
                return (
                  <span
                    onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); enterEdit(); }}
                    style={{
                      display: 'block', minHeight: '1em',
                      padding: '1px 2px', whiteSpace: 'pre', overflow: 'hidden',
                    }}
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openCompanyDetails(matched); }}
                      title={`Open ${matched.company || row[h]}'s company page (double-click to edit)`}
                      style={{
                        padding: 0, border: 'none', background: 'transparent',
                        fontFamily: 'inherit', fontSize: 'inherit', color: '#2563EB',
                        fontWeight: 600, cursor: 'pointer',
                        textDecoration: 'underline', textDecorationColor: '#93C5FD',
                        textUnderlineOffset: '2px',
                      }}
                    >{text}</button>
                  </span>
                );
              } : undefined}
            />
          );
        },
      }));
    // Trailing actions column — × button per row for delete. Lives
    // outside the headers loop so it can't be hidden via the columns
    // toggle (you always need a way to delete a row).
    const actions = {
      key: '_actions',
      label: '',
      defaultWidth: 44,
      getFilterValue: () => '',
      render: (row) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const label = String(row['Account'] || '').trim() || 'this opp';
            if (window.confirm(`Delete ${label}? This can't be undone.`)) {
              deleteOpp(row._id);
            }
          }}
          title="Delete this opp"
          style={{
            padding: '0', width: 22, height: 22, lineHeight: 1,
            fontSize: '0.95rem', fontWeight: 600, fontFamily: 'inherit',
            color: '#94A3B8', background: 'transparent',
            border: '1px solid var(--color-border)', borderRadius: 4,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#B91C1C'; e.currentTarget.style.borderColor = '#B91C1C'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
        >×</button>
      ),
    };
    // Selection checkbox — prepended so the user can flip rows on/off
    // for mass-edit. The header checkbox toggles every row in the
    // current filter (so a user can filter to "Stage = Quoting" and
    // mass-select with one click).
    const selectCol = {
      key: '_select',
      label: '',
      defaultWidth: 36,
      getFilterValue: () => '',
      renderHeader: () => {
        const filteredArr = Array.from(filteredRowIds);
        let selectedInFilter = 0;
        for (const id of filteredArr) if (selectedIds.has(id)) selectedInFilter += 1;
        const allSelected = filteredArr.length > 0 && selectedInFilter === filteredArr.length;
        const someSelected = selectedInFilter > 0 && !allSelected;
        return (
          <input
            type="checkbox"
            ref={(el) => { if (el) el.indeterminate = someSelected; }}
            checked={allSelected}
            disabled={filteredArr.length === 0}
            onChange={(e) => {
              const checked = e.target.checked;
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (checked) {
                  for (const id of filteredArr) next.add(id);
                } else {
                  for (const id of filteredArr) next.delete(id);
                }
                return next;
              });
            }}
            style={{ margin: 0, cursor: filteredArr.length === 0 ? 'not-allowed' : 'pointer' }}
            title={filteredArr.length === 0
              ? 'No filtered rows to select'
              : allSelected
                ? `Clear selection for all ${filteredArr.length} filtered row${filteredArr.length === 1 ? '' : 's'}`
                : `Select all ${filteredArr.length} filtered row${filteredArr.length === 1 ? '' : 's'}`}
          />
        );
      },
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row._id)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const checked = e.target.checked;
            setSelectedIds(prev => {
              const next = new Set(prev);
              if (checked) next.add(row._id);
              else next.delete(row._id);
              return next;
            });
          }}
          style={{ margin: 0, cursor: 'pointer' }}
          title="Select for mass edit"
        />
      ),
    };
    // Info button — opens a modal showing the row's basic info and a
    // delete button. Inserted right before Next Steps so the user
    // doesn't have to scroll the row to get a summary.
    const infoCol = {
      key: '_info',
      label: '',
      defaultWidth: 40,
      getFilterValue: () => '',
      render: (row) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setInfoOppId(row._id); }}
          title="Show opp info"
          style={{
            padding: '0', width: 22, height: 22, lineHeight: 1,
            fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit',
            color: 'var(--color-accent)', background: '#fff',
            border: '1px solid var(--color-accent)', borderRadius: '50%',
            cursor: 'pointer',
          }}
        >i</button>
      ),
    };
    // "Flags" — surfaces per-opp attention flags: a BFO Opportunity Name
    // with no BFO Address yet, and the Days-in-Stage stall flag (opp sat
    // in its stage past the limit). The stall flag can be ignored per opp
    // (stored on `_ignoreStallFlag`), which also clears it on the
    // Days-in-Stage board. Synthetic (not a stored field), placed right
    // after the BFO Opportunity Name column for context; falls back to
    // the end when that column is hidden.
    const chipBase = {
      display: 'inline-block', padding: '1px 8px', borderRadius: 999,
      fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap',
    };
    // Not Sold is a closed/lost deal — no point nagging about missing
    // data or stalls on it, so the Flags column stays blank for those
    // rows regardless of which individual flags would otherwise fire.
    const flagsSuppressedForStage = (row) =>
      String(row?.['Stage'] || '').trim() === 'Not Sold';
    const flagSummary = (row) => {
      if (flagsSuppressedForStage(row)) return '';
      const parts = [];
      if (needsUsdFlag(row)) parts.push('Missing USD value');
      if (oppMissingBfoAddress(row)) parts.push('Missing BFO Address');
      if (oppMissingQuotedAmount(row)) parts.push('Deal Size Missing');
      if (oppMissingMarginApproval(row)) parts.push('Missing Margin Approval');
      const stall = oppStageStall(row);
      if (stall && !row?._ignoreStallFlag) parts.push(`Stalled: ${stall.suggestion}`);
      return parts.join('; ');
    };
    const missingDataCol = {
      key: '_missingData',
      label: 'Flags',
      defaultWidth: 200,
      getFilterValue: (row) => flagSummary(row),
      getSortValue: (row) => {
        if (flagsSuppressedForStage(row)) return 0;
        let n = 0;
        if (needsUsdFlag(row)) n += 1;
        if (oppMissingBfoAddress(row)) n += 1;
        if (oppMissingQuotedAmount(row)) n += 1;
        if (oppMissingMarginApproval(row)) n += 1;
        if (oppStageStall(row) && !row?._ignoreStallFlag) n += 1;
        return n;
      },
      exportValue: (row) => flagSummary(row),
      render: (row) => {
        if (flagsSuppressedForStage(row)) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
        const missingUsd = needsUsdFlag(row);
        const missingAddr = oppMissingBfoAddress(row);
        const missingQuote = oppMissingQuotedAmount(row);
        const missingMargin = oppMissingMarginApproval(row);
        const stall = oppStageStall(row);
        const ignored = !!row?._ignoreStallFlag;
        if (!missingUsd && !missingAddr && !missingQuote && !missingMargin && !stall) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
        return (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
            {missingUsd && (
              <span
                title="Stage is Qualifying or later but the USD? field is blank or “-” — fill in USD? to clear it."
                style={{ ...chipBase, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}
              >⚠ Missing USD value</span>
            )}
            {missingAddr && (
              <span
                title="Has a BFO Opportunity Name but no BFO Address — add the BFO Address."
                style={{ ...chipBase, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}
              >⚠ No BFO Address</span>
            )}
            {missingQuote && (
              <span
                title={`Active opp in "${String(row['Stage'] || '').trim()}" with no Deal Size — add the Deal Size.`}
                style={{ ...chipBase, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}
              >⚠ Deal Size Missing</span>
            )}
            {missingMargin && (
              <span
                title={`Opp in "${String(row['Stage'] || '').trim()}" with no Margin Email Date - Sales Leader Review Date — get margin approval.`}
                style={{ ...chipBase, background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }}
              >⚠ Missing Margin Approval</span>
            )}
            {stall && !ignored && (
              <>
                <span
                  title={`Stalled ${stall.days}d in ${row['Stage']} (limit ${stall.limit}d) → ${stall.suggestion}`}
                  style={{ ...chipBase, background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' }}
                >⚠ {stall.suggestion}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); updateOppField(row._id, '_ignoreStallFlag', true); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Ignore this stall flag for this opp (also clears it on the Days in Stage board)"
                  style={{
                    border: 'none', background: 'none', cursor: 'pointer', padding: '0 2px',
                    fontSize: '0.62rem', color: '#92400E', fontFamily: 'inherit', textDecoration: 'underline',
                  }}
                >ignore</button>
              </>
            )}
            {stall && ignored && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span
                  title={`Stall flag ignored (${stall.days}d in ${row['Stage']}).`}
                  style={{ ...chipBase, fontWeight: 600, background: '#F1F5F9', color: '#94A3B8', border: '1px solid #E2E8F0' }}
                >stall ignored</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); updateOppField(row._id, '_ignoreStallFlag', false); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Restore this stall flag"
                  style={{
                    border: 'none', background: 'none', cursor: 'pointer', padding: '0 2px',
                    fontSize: '0.62rem', color: 'var(--color-accent)', fontFamily: 'inherit', textDecoration: 'underline',
                  }}
                >restore</button>
              </span>
            )}
          </span>
        );
      },
    };
    const bfoLinkIdx = mapped.findIndex(c => c.key === 'BFO Link');
    if (bfoLinkIdx >= 0) mapped.splice(bfoLinkIdx + 1, 0, missingDataCol);
    else mapped.push(missingDataCol);
    // Splice the info column in just before Next Steps when it's
    // present in the visible header set. Falls back to appending so
    // a user who hid Next Steps still gets the button.
    const nextStepsIdx = mapped.findIndex(c => c.key === 'Next Steps');
    const withInfo = nextStepsIdx >= 0
      ? [...mapped.slice(0, nextStepsIdx), infoCol, ...mapped.slice(nextStepsIdx)]
      : [...mapped, infoCol];
    // Sequential 1..N display rank — ranks surviving opps by their
    // underlying `_id` (which is still assigned monotonically), so the
    // column always runs from 1 up over the current dataset rather than
    // exposing gaps from deleted rows. Lives leftmost (right after the
    // mass-edit checkbox when that's on). Non-sticky so the existing
    // sticky Account column still acts as the horizontal-scroll anchor.
    const oppNumCol = {
      key: '_oppNum',
      label: 'Opp #',
      defaultWidth: 70,
      getFilterValue: (row) => String(oppNumberById.get(row._id) ?? ''),
      getSortValue: (row) => oppNumberById.get(row._id) ?? 0,
      // The number lives in a derived map keyed by `_id`, not under the
      // column's key, so DataTable's default export (which reads
      // `row[col.key]`) would emit blanks. Map it through explicitly.
      exportValue: (row) => oppNumberById.get(row._id) ?? '',
      render: (row) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#475569' }}>
          {oppNumberById.get(row._id) ?? ''}
        </span>
      ),
    };
    return massEditOn
      ? [selectCol, oppNumCol, ...withInfo, actions]
      : [oppNumCol, ...withInfo, actions];
  }, [headers, columnLinks, listRegistry, updateOppField, deleteOppField, deleteOpp, companySuggestions, peOwnerSuggestions, prospects, updateProspect, hubspotContacts, selectedIds, pricingOptionServices, optionLinks, massEditOn, oppNumberById, filteredRowIds]);

  const CLOSED_STAGES = useMemo(() => new Set(['Sold', 'Not Sold']), []);

  // Rows the current Date / Status / Show / Hide-history filters allow.
  // Always computed so `hiddenByFilterCount` stays accurate even when
  // the Show-hidden toggle is on.
  const filteredByActiveFilters = useMemo(() => {
    const fromTs = dateFrom ? Date.parse(dateFrom) : null;
    const toTs = dateTo ? Date.parse(dateTo) + 86399999 : null;
    return records.filter(r => {
      // History gate runs first so it short-circuits before the more
      // expensive date / stage checks for the bulk of dormant rows.
      if (hideHistory && resolveCallIn(r) == null) return false;
      if (fromTs != null || toTs != null) {
        const raw = r['Start Date'];
        const ts = raw ? Date.parse(raw) : NaN;
        if (isNaN(ts)) return false;
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
      }
      if (statusFilter !== 'all' && (r['Status'] || '').trim() !== statusFilter) return false;
      const stage = (r['Stage'] || '').trim();
      if (activityFilter === 'active' && CLOSED_STAGES.has(stage)) return false;
      if (activityFilter === 'closed' && !CLOSED_STAGES.has(stage)) return false;
      return true;
    });
  }, [records, dateFrom, dateTo, statusFilter, activityFilter, hideHistory, CLOSED_STAGES]);

  // Standalone count of rows the Hide-history gate is suppressing, so
  // the toggle button can show "Show history (N)" without depending on
  // the rest of the filter chain.
  const historyCount = useMemo(
    () => records.reduce((n, r) => n + (resolveCallIn(r) == null ? 1 : 0), 0),
    [records],
  );

  // When the user clicks "Show hidden", bypass the active filters and
  // surface every row — the filter inputs are left untouched so a
  // second click returns to the filtered view. Aggregates (stage
  // chips, service breakdown) follow the same source so the page
  // reflects whatever the table is showing.
  const hiddenByFilterCount = records.length - filteredByActiveFilters.length;
  const prefiltered = showHiddenByFilter ? records : filteredByActiveFilters;

  // Global search across every column on each record — see OppsView for
  // the same shape. Trims + lowercases the term so the value the user
  // typed lines up with the stored cell text.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const searched = !term ? prefiltered : prefiltered.filter(r =>
      Object.values(r).some(v => v != null && v !== '' && String(v).toLowerCase().includes(term))
    );
    if (showOnlySelected && selectedIds.size > 0) {
      return searched.filter(r => selectedIds.has(r._id));
    }
    return searched;
  }, [prefiltered, search, showOnlySelected, selectedIds]);

  // "Waiting on Keith" subtab: opps where Keith appears in the Waiting On
  // column. The displayed Waiting On value is the stacked per-step
  // `_nextStepsWaiting` array (falling back to the legacy "Waiting On"
  // field), so we match against the same text the Opportunities tab shows.
  // Sourced from `prefiltered` so it honours the Date / Status / Show /
  // Hide-history filters but stays independent of the Opportunities search.
  const waitingOnKeith = useMemo(() => {
    return prefiltered.filter(row => {
      const stacked = (Array.isArray(row._nextStepsWaiting) ? row._nextStepsWaiting : [])
        .map(s => String(s || '').trim())
        .filter(Boolean)
        .join('\n');
      const text = stacked || String(row['Waiting On'] ?? '');
      return text.toLowerCase().includes('keith');
    });
  }, [prefiltered]);

  // Mass Edit → "Email table": the selected opps to feed the preview/copy
  // modal (which lets the user pick columns and copies a plain bordered
  // table). Null when closed.
  const [emailTableRecords, setEmailTableRecords] = useState(null);
  const handleEmailTable = useCallback(() => {
    const recs = dataRef.current?.records || [];
    const byId = new Map(recs.map(r => [r._id, r]));
    // Keep the current table (filtered) order; append any selected rows
    // that aren't in the current view (e.g. filtered out after selecting).
    const ordered = [];
    const seen = new Set();
    for (const r of filtered) {
      if (selectedIds.has(r._id) && byId.has(r._id)) { ordered.push(byId.get(r._id)); seen.add(r._id); }
    }
    for (const id of selectedIds) {
      if (!seen.has(id) && byId.has(id)) ordered.push(byId.get(id));
    }
    if (ordered.length === 0) return;
    setEmailTableRecords(ordered);
  }, [filtered, selectedIds]);

  // "New Opps" subtab: actively-working opps that are progressing quickly —
  // a BFO Opportunity Name is set, the current Stage is Lead/Qualifying/
  // Quoting (so never "Not Started"), and the combined time across those
  // three stages is at most NEW_OPPS_MAX_STAGE_AGE_DAYS days. Freshest
  // (lowest combined age) first. Mirrors filterNewOpps in
  // api/_lib/newOpps.js so the on-screen list matches the emailed file.
  const newOpps = useMemo(() => {
    return records
      .map(r => ({ r, age: combinedActiveStageAge(r) }))
      .filter(({ r, age }) => {
        const stage = String(r['Stage'] || '').trim();
        if (!NEW_OPPS_ACTIVE_STAGES_SET.has(stage)) return false;
        if (bfoFieldMissing(r['BFO Link'])) return false;
        return age <= NEW_OPPS_MAX_STAGE_AGE_DAYS;
      })
      .sort((a, b) =>
        a.age - b.age || String(a.r['Account'] || '').localeCompare(String(b.r['Account'] || '')))
      .map(({ r }) => r);
  }, [records]);

  // The New Opps subtab + emailed digest share one focused column set, in
  // canonical report order. Keys missing from this dataset's headers (e.g.
  // "BFO Address" on a default-headers install) still get a minimal column
  // def so the BFO fields always show on the subtab and stay pickable for
  // the emailed table.
  const newOppsColumns = useMemo(
    () => NEW_OPPS_REPORT_COLUMNS.map(key =>
      columns.find(c => c.key === key) || {
        key,
        label: headerLabel(key),
        defaultWidth: key === 'BFO Address' ? 260 : 160,
      }
    ),
    [columns]
  );

  // SE-branded (Schneider green) Excel of the new opps shown, mirroring the
  // server-built file the scheduled email attaches.
  const handleExportNewOpps = useCallback(async () => {
    if (newOpps.length === 0) return;
    const { Workbook } = await import('exceljs');
    const SE_GREEN_DARK = 'FF009530';
    const SE_GREEN_LIGHT = 'FFE6F7EC';
    const SE_GREEN = 'FF3DCD58';
    const cols = NEW_OPPS_REPORT_COLUMNS
      .map(key => newOppsColumns.find(c => c.key === key))
      .filter(Boolean);
    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    wb.created = new Date();
    const ws = wb.addWorksheet('New Opps', {
      properties: { tabColor: { argb: SE_GREEN } },
      views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
    });
    ws.columns = cols.map(c => ({ width: Math.min(Math.max(String(c.label).length + 4, 16), 40) }));

    ws.mergeCells(1, 1, 1, cols.length);
    const title = ws.getCell(1, 1);
    title.value = `New Opportunities · ${newOpps.length} opp${newOpps.length === 1 ? '' : 's'}`;
    title.font = { name: 'Nunito Sans', bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 28;
    ws.getRow(2).height = 6;

    const headerRow = ws.getRow(3);
    cols.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.label;
      cell.font = { name: 'Nunito Sans', bold: true, size: 11, color: { argb: SE_GREEN_DARK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_LIGHT } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cell.border = { bottom: { style: 'thin', color: { argb: SE_GREEN_DARK } } };
    });
    headerRow.height = 22;

    newOpps.forEach((r, idx) => {
      const row = ws.getRow(4 + idx);
      cols.forEach((col, i) => {
        const cell = row.getCell(i + 1);
        cell.value = r[col.key] ?? '';
        cell.font = { name: 'Nunito Sans', size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: false };
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6FCF8' } };
      });
      row.height = 18;
    });
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cols.length } };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `new-opps-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [newOpps, newOppsColumns]);

  const serviceBreakdown = useMemo(() => {
    // The breakdown only shows on the "By Service" tab. Skipping the
    // O(N×services) work while the Opportunities tab is active shaves
    // a noticeable chunk off the first render with large datasets.
    if (activeTab !== 'services') return { rows: [], total: prefiltered.length };
    const stats = {};
    const totalOpps = prefiltered.length;
    for (const r of prefiltered) {
      const raw = (r['Scope'] || '').trim();
      const cleaned = raw && raw !== '-' && raw !== '#N/A' ? raw : '';
      const services = cleaned
        ? cleaned.split(',').map(s => s.trim()).filter(Boolean)
        : ['(Unspecified)'];
      const stage = (r['Stage'] || '').trim();
      const isWin = stage === 'Sold';
      const isLoss = stage === 'Not Sold';
      const seen = new Set();
      for (const s of services) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (!stats[s]) stats[s] = { total: 0, wins: 0, losses: 0 };
        stats[s].total += 1;
        if (isWin) stats[s].wins += 1;
        else if (isLoss) stats[s].losses += 1;
      }
    }
    const rows = Object.entries(stats)
      .map(([scope, s]) => {
        const decided = s.wins + s.losses;
        return {
          scope,
          count: s.total,
          wins: s.wins,
          winRate: decided > 0 ? (s.wins / decided) * 100 : null,
          percent: totalOpps > 0 ? (s.total / totalOpps) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
    return { rows, total: totalOpps };
  }, [prefiltered, activeTab]);

  const filtersActive = !!(dateFrom || dateTo || statusFilter !== 'all' || activityFilter !== 'all');
  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setStatusFilter('all'); setActivityFilter('all');
  };

  // Rows for the Days-in-Stage tab. Reads `_stageEnteredAt` (stamped by
  // updateOppField when Stage flips) and falls back to Start Date so
  // pre-existing opps that have never had a stage change still
  // contribute something instead of showing blank. Sorted descending by
  // days so the longest-stalling opps lead the list.
  const stageDaysRows = useMemo(() => {
    if (activeTab !== 'stageDays') return [];
    const rows = [];
    for (const r of records) {
      const stage = String(r['Stage'] || '').trim();
      if (!TRACKED_STAGES_SET.has(stage)) continue;
      // Mirror the Opportunities tab's history gate — opps with no
      // Call In aren't on a callback schedule, so they shouldn't crowd
      // the kanban either.
      if (resolveCallIn(r) == null) continue;
      // Pull-through opps follow a parent sale, so keep them off the board.
      if (PULL_THROUGH_RE.test(String(r['Scope'] || ''))) continue;
      const enteredISO = toISODate(r._stageEnteredAt) || toISODate(r['Start Date']);
      const days = enteredISO ? -daysFromToday(enteredISO) : null;
      const scope = String(r['Scope'] ?? '').trim();
      rows.push({
        id: r._id,
        Account: r['Account'] || '',
        Stage: stage,
        days,
        enteredAt: enteredISO || '',
        startDate: toISODate(r['Start Date']) || '',
        scope: scope && scope !== '-' && scope !== '#N/A' ? scope : '',
        _hasExplicitEntry: !!toISODate(r._stageEnteredAt),
        ignoreStall: !!r._ignoreStallFlag,
      });
    }
    rows.sort((a, b) => {
      // Null days (no Start Date either) settle at the bottom so the
      // top of the list always shows real numbers.
      if (a.days == null && b.days == null) return 0;
      if (a.days == null) return 1;
      if (b.days == null) return -1;
      return b.days - a.days;
    });
    return rows;
  }, [activeTab, records]);

  // Group Days-in-Stage rows by stage so the Kanban view can render one
  // column per stage with its cards stacked beneath. stageDaysRows is
  // pre-sorted descending by days, so each bucket's order falls out for
  // free — longest-stalling firms lead each column.
  const stageDaysByStage = useMemo(() => {
    const map = new Map(TRACKED_STAGES.map(s => [s, []]));
    for (const r of stageDaysRows) {
      if (map.has(r.Stage)) map.get(r.Stage).push(r);
    }
    return map;
  }, [stageDaysRows]);

  // Rows for the Stage History tab. Same gate as the Days-in-Stage tab
  // so the two tabs cover the same set of opps. For each row we sum
  // historical days per TRACKED_STAGE from `_stageHistory` (an opp can
  // revisit a stage, in which case its entries add up) and add the
  // live days-so-far against the row's current stage. Rows that haven't
  // moved stages since this feature shipped will only have a value in
  // their current-stage column — that's expected (we can only report
  // history we've actually captured).
  const stageHistoryRows = useMemo(() => {
    if (activeTab !== 'stageHistory') return [];
    const rows = [];
    for (const r of records) {
      const stage = String(r['Stage'] || '').trim();
      if (!TRACKED_STAGES_SET.has(stage)) continue;
      if (resolveCallIn(r) == null) continue;
      const daysByStage = Object.fromEntries(TRACKED_STAGES.map(s => [s, 0]));
      const visited = new Set();
      for (const h of (Array.isArray(r._stageHistory) ? r._stageHistory : [])) {
        const s = String(h?.stage || '').trim();
        if (!TRACKED_STAGES_SET.has(s)) continue;
        const d = Number(h?.days);
        if (!Number.isFinite(d) || d < 0) continue;
        daysByStage[s] += d;
        visited.add(s);
      }
      const enteredISO = toISODate(r._stageEnteredAt) || toISODate(r['Start Date']);
      const currentDays = enteredISO ? Math.max(0, -daysFromToday(enteredISO)) : null;
      if (currentDays != null) {
        daysByStage[stage] += currentDays;
        visited.add(stage);
      }
      const total = TRACKED_STAGES.reduce((s, k) => s + (daysByStage[k] || 0), 0);
      const scope = String(r['Scope'] ?? '').trim();
      rows.push({
        id: r._id,
        Account: r['Account'] || '',
        Scope: scope && scope !== '-' && scope !== '#N/A' ? scope : '',
        currentStage: stage,
        daysByStage,
        visitedStages: visited,
        total,
      });
    }
    rows.sort((a, b) => b.total - a.total || a.Account.localeCompare(b.Account));
    return rows;
  }, [activeTab, records]);

  const stageHistoryColumns = useMemo(() => {
    const num = (v) => (typeof v === 'number' && v > 0) ? v : '';
    const numCell = (v) => (
      <div style={{ textAlign: 'right' }}>{num(v)}</div>
    );
    const cols = [
      { key: 'Account', label: 'Account', defaultWidth: 220 },
      { key: 'Scope', label: 'Scope', defaultWidth: 180 },
      { key: 'currentStage', label: 'Current Stage', defaultWidth: 140 },
    ];
    for (const stage of TRACKED_STAGES) {
      cols.push({
        key: `stage:${stage}`,
        label: stage,
        defaultWidth: 110,
        getSortValue: (row) => row.daysByStage?.[stage] || 0,
        render: (row) => numCell(row.daysByStage?.[stage]),
      });
    }
    cols.push({
      key: 'total',
      label: 'Total days',
      defaultWidth: 110,
      getSortValue: (row) => row.total || 0,
      render: (row) => <div style={{ textAlign: 'right', fontWeight: 600 }}>{num(row.total)}</div>,
    });
    return cols;
  }, []);

  const servicesColumns = useMemo(() => [
    { key: 'scope', label: 'Service (Scope)', defaultWidth: 260 },
    {
      key: 'wins',
      label: 'Wins',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right' }}>{row.wins}</div>,
    },
    {
      key: 'winRate',
      label: 'Win Rate',
      defaultWidth: 110,
      render: (row) => (
        <div style={{ textAlign: 'right' }}>
          {row.winRate == null ? '—' : `${row.winRate.toFixed(1)}%`}
        </div>
      ),
    },
    {
      key: 'percent',
      label: '% of Total',
      defaultWidth: 220,
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ minWidth: '48px', textAlign: 'right' }}>{row.percent.toFixed(1)}%</span>
          <div className={styles.serviceBar} style={{ flex: 1 }}>
            <div className={styles.serviceBarFill} style={{ width: `${row.percent}%` }} />
          </div>
        </div>
      ),
    },
    {
      key: 'count',
      label: 'Total Opps',
      defaultWidth: 110,
      render: (row) => (
        <div style={{ textAlign: 'right', fontWeight: 600 }}>{row.count}</div>
      ),
    },
    {
      key: '_actions',
      label: '',
      defaultWidth: 90,
      render: (row) => (
        <button
          className={styles.hideServiceBtn}
          onClick={(e) => { e.stopPropagation(); toggleHideService(row.scope); }}
          title={row._hidden ? 'Unhide service' : 'Hide service'}
        >
          {row._hidden ? 'Unhide' : 'Hide'}
        </button>
      ),
    },
  ], [toggleHideService]);

  // Leads grouped by Source for the "By Source" tab, scoped to the
  // tab's own Start Date range. Mirrors serviceBreakdown's shape
  // (count / wins / win rate / % of total) but keyed on the Source
  // field and computed off every record rather than `prefiltered`, so
  // the time-range filter here is the only thing narrowing the set.
  // Map a record to its normalised Source bucket. Shared by the summary
  // table and the click-through drilldown so the two never disagree on
  // which opp belongs to which source.
  const sourceKeyOf = useCallback((r) => {
    const raw = (r['Source'] || '').trim();
    const cleaned = raw && raw !== '-' && raw !== '#N/A' ? raw : '';
    return cleaned || '(Unspecified)';
  }, []);

  // Apply the "By Source" tab's own Start Date range + activity filter to
  // a single record. Returns true when the opp should be counted.
  const sourceRowMatches = useCallback((r) => {
    const fromTs = sourceFrom ? Date.parse(sourceFrom) : null;
    const toTs = sourceTo ? Date.parse(sourceTo) + 86399999 : null;
    if (fromTs != null || toTs != null) {
      const raw = r['Start Date'];
      const ts = raw ? Date.parse(raw) : NaN;
      if (isNaN(ts)) return false;
      if (fromTs != null && ts < fromTs) return false;
      if (toTs != null && ts > toTs) return false;
    }
    const stage = (r['Stage'] || '').trim();
    // Activity filter: 'active' drops closed (Sold / Not Sold) opps,
    // 'closed' keeps only those, 'all' keeps everything.
    if (sourceActivityFilter === 'active' && CLOSED_STAGES.has(stage)) return false;
    if (sourceActivityFilter === 'closed' && !CLOSED_STAGES.has(stage)) return false;
    return true;
  }, [sourceFrom, sourceTo, sourceActivityFilter, CLOSED_STAGES]);

  const sourceBreakdown = useMemo(() => {
    if (activeTab !== 'bySource') return { rows: [], total: 0 };
    const stats = {};
    let total = 0;
    for (const r of records) {
      if (!sourceRowMatches(r)) continue;
      const stage = (r['Stage'] || '').trim();
      const source = sourceKeyOf(r);
      if (!stats[source]) stats[source] = { total: 0, wins: 0, losses: 0 };
      stats[source].total += 1;
      if (stage === 'Sold') stats[source].wins += 1;
      else if (stage === 'Not Sold') stats[source].losses += 1;
      total += 1;
    }
    const rows = Object.entries(stats)
      .map(([source, s]) => {
        const decided = s.wins + s.losses;
        return {
          source,
          count: s.total,
          wins: s.wins,
          winRate: decided > 0 ? (s.wins / decided) * 100 : null,
          percent: total > 0 ? (s.total / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
    return { rows, total };
  }, [activeTab, records, sourceRowMatches, sourceKeyOf]);

  // The opps behind the source the user clicked in the summary table.
  // Scoped to the same filters so the count matches the row they clicked.
  const sourceDrillRows = useMemo(() => {
    if (!sourceDrillDown) return [];
    return records
      .filter(r => sourceRowMatches(r) && sourceKeyOf(r) === sourceDrillDown)
      .sort((a, b) => {
        const ta = a['Start Date'] ? Date.parse(a['Start Date']) : NaN;
        const tb = b['Start Date'] ? Date.parse(b['Start Date']) : NaN;
        if (isNaN(ta) && isNaN(tb)) return 0;
        if (isNaN(ta)) return 1;
        if (isNaN(tb)) return -1;
        return tb - ta;
      });
  }, [sourceDrillDown, records, sourceRowMatches, sourceKeyOf]);

  const sourceColumns = useMemo(() => [
    {
      key: 'source',
      label: 'Source',
      defaultWidth: 240,
      render: (row) => (
        <span style={{ color: 'var(--color-link, #2563EB)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
          {row.source}
        </span>
      ),
    },
    {
      key: 'count',
      label: 'Leads',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right', fontWeight: 600 }}>{row.count}</div>,
    },
    {
      key: 'wins',
      label: 'Wins',
      defaultWidth: 90,
      render: (row) => <div style={{ textAlign: 'right' }}>{row.wins}</div>,
    },
    {
      key: 'winRate',
      label: 'Win Rate',
      defaultWidth: 110,
      render: (row) => (
        <div style={{ textAlign: 'right' }}>
          {row.winRate == null ? '—' : `${row.winRate.toFixed(1)}%`}
        </div>
      ),
    },
    {
      key: 'percent',
      label: '% of Total',
      defaultWidth: 220,
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ minWidth: '48px', textAlign: 'right' }}>{row.percent.toFixed(1)}%</span>
          <div className={styles.serviceBar} style={{ flex: 1 }}>
            <div className={styles.serviceBarFill} style={{ width: `${row.percent}%` }} />
          </div>
        </div>
      ),
    },
  ], []);

  return (
    <div className={styles.wrapper}>
      {syncError && (
        <div className={styles.syncBanner} role="alert" aria-live="assertive">
          <span>
            <strong>⚠ Cloud sync failed — your changes are saved on this device only.</strong>{' '}
            Other devices may show older data, and these edits will be lost if
            you clear this browser. Check your connection and Firestore access,
            then retry.
            {syncErrorDetail && (
              <><br /><span className={styles.syncBannerDetail}>Reason: {syncErrorDetail}</span></>
            )}
            <br />
            <span className={styles.syncBannerDetail}>
              {lastSyncedAt
                ? `Last successful cloud sync: ${new Date(lastSyncedAt).toLocaleTimeString()}.`
                : 'No successful cloud sync yet this session.'}
            </span>
          </span>
          <button
            type="button"
            className={styles.syncBannerRetry}
            onClick={retrySync}
            disabled={retryingSync}
          >
            {retryingSync ? 'Retrying…' : 'Retry now'}
          </button>
        </div>
      )}
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Opps</h2>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <AddCompanyCombobox
            suggestions={companySuggestions}
            onCommit={(name) => setPendingNewOpp({ account: name })}
          />
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text)', cursor: 'pointer',
            }}
            title="Bind columns to Dropdowns-tab lists"
          >Link columns</button>
          <button
            type="button"
            onClick={importFromOppsTab}
            disabled={importingFromOpps}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text)', cursor: importingFromOpps ? 'progress' : 'pointer',
            }}
            title="One-time copy of every row from the Opps - Old tab cache that isn't already on Opps"
          >{importingFromOpps ? 'Importing…' : 'Import from Opps - Old tab'}</button>
          <button
            type="button"
            onClick={() => setBulkImportOpen(true)}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text)', cursor: 'pointer',
            }}
            title="Paste data from a Google Sheet with the same columns and review the mapping before importing"
          >Bulk import</button>
          <button
            type="button"
            onClick={() => setNfatScheduleOpen(true)}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text)', cursor: 'pointer',
            }}
            title="Schedule automatic clears of the No Further Action Today column (✓ / ✗ / any), or clear now"
          >Clear No Further Action</button>
          <button
            type="button"
            onClick={undoLastChange}
            disabled={!undoStack.length}
            style={{
              padding: '0.45rem 0.85rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)', fontWeight: 600, fontFamily: 'inherit',
              color: undoStack.length ? 'var(--color-text)' : 'var(--color-text-muted)',
              cursor: undoStack.length ? 'pointer' : 'not-allowed',
              opacity: undoStack.length ? 1 : 0.6,
            }}
            title={undoStack.length
              ? `Undo last change (${undoStack.length} in history) — Ctrl/Cmd+Z`
              : 'No recent changes to undo'}
          >↶ Undo</button>
          <button className={styles.syncBtn} onClick={() => setPendingNewOpp({})}>+ New Opp</button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {linkModalOpen && (
        <LinkColumnsModal
          headers={headers}
          columnLinks={columnLinks}
          defaultLinks={DEFAULT_COLUMN_LINKS}
          listRegistry={listRegistry}
          availableLists={availableLists}
          onChange={updateColumnLinks}
          onClose={() => setLinkModalOpen(false)}
        />
      )}

      {bulkImportOpen && (
        <BulkImportModal
          existingHeaders={data?.headers?.length ? data.headers : DEFAULT_HEADERS}
          existingRecords={data?.records || []}
          dedupKeyFor={oppDedupKeyForImport}
          onClose={() => setBulkImportOpen(false)}
          onImport={commitBulkImport}
        />
      )}

      {nfatScheduleOpen && (
        <NfatScheduleModal
          schedules={nfatSchedules}
          onSave={saveNfatSchedules}
          onClearNow={clearNfat}
          onClose={() => setNfatScheduleOpen(false)}
        />
      )}

      {pendingNewOpp && (
        <NewOppModal
          account={pendingNewOpp.account}
          sourceOptions={listRegistry.get('source')?.options || []}
          companySuggestions={companySuggestions}
          peOwnerSuggestions={peOwnerSuggestions}
          prospects={prospects}
          onCreate={({ company, source, peOwner, type, frameworks, frameworksEdited, addToTableView }) => {
            // Create the company on Table View first (when requested and
            // it isn't there yet) so the new opp's Account immediately
            // resolves to a real prospect record. addProspect is
            // idempotent by company name, so a race that re-adds an
            // existing company is harmless.
            if (addToTableView && company && addProspect) {
              try {
                Promise.resolve(addProspect({ company, peOwner: peOwner || '', type: type || '', frameworks: frameworksEdited ? frameworks : [] }))
                  .catch(err => console.error('opps2: add company to Table View failed', err));
              } catch (err) {
                console.error('opps2: add company to Table View failed', err);
              }
            } else if (company && updateProspect) {
              // Existing Table View company: the modal prefilled Type and
              // Frameworks from its record, so a different value here is a
              // reviewed correction — persist it back to the prospect.
              const matched = findProspectForAccount(company, prospects);
              if (matched) {
                const updates = {};
                if (type !== String(matched.type || '').trim()) updates.type = type;
                if (frameworksEdited) updates.frameworks = frameworks;
                if (Object.keys(updates).length) {
                  Promise.resolve(updateProspect(matched.id, updates))
                    .catch(err => console.error('opps2: update company failed', err));
                }
              }
            }
            addNewOpp(company, source, peOwner);
            setPendingNewOpp(null);
          }}
          onCancel={() => setPendingNewOpp(null)}
        />
      )}

      {notSoldPromptId != null && (() => {
        const opp = records.find(r => r._id === notSoldPromptId);
        if (!opp) return null;
        return (
          <NotSoldFollowUpModal
            opp={opp}
            reasonOptions={listRegistry.get('reasonNotSold')?.options || []}
            onSave={({ closeDate, reason, finalMargin }) => {
              // Only push fields whose value actually changed so the
              // undo stack stays uncluttered with no-op snapshots.
              if (closeDate !== (toISODate(opp['Close Date']) || '')) {
                updateOppField(opp._id, 'Close Date', closeDate);
              }
              if (reason !== String(opp['Reason Not Sold'] ?? '')) {
                updateOppField(opp._id, 'Reason Not Sold', reason);
              }
              if (finalMargin !== String(opp['Final Margin'] ?? '').trim()) {
                updateOppField(opp._id, 'Final Margin', finalMargin);
              }
              setNotSoldPromptId(null);
            }}
            onClose={() => setNotSoldPromptId(null)}
          />
        );
      })()}

      {soldPromptId != null && (() => {
        const opp = records.find(r => r._id === soldPromptId);
        if (!opp) return null;
        return (
          <SoldFollowUpModal
            opp={opp}
            reasonOptions={listRegistry.get('reasonNotSold')?.options || []}
            competitionOptions={listRegistry.get('competition')?.options || []}
            onSave={({ reason, finalMargin, competition }) => {
              // Only push fields whose value actually changed so the
              // undo stack stays uncluttered with no-op snapshots.
              if (reason !== String(opp['Reason Not Sold'] ?? '')) {
                updateOppField(opp._id, 'Reason Not Sold', reason);
              }
              if (finalMargin !== String(opp['Final Margin'] ?? '').trim()) {
                updateOppField(opp._id, 'Final Margin', finalMargin);
              }
              if (competition !== String(opp['Competition'] ?? '').trim()) {
                updateOppField(opp._id, 'Competition', competition);
              }
              setSoldPromptId(null);
            }}
            onClose={() => setSoldPromptId(null)}
          />
        );
      })()}

      {leadQuotedPromptId != null && (() => {
        const opp = records.find(r => r._id === leadQuotedPromptId);
        if (!opp) return null;
        return (
          <LeadQuotedAmountModal
            opp={opp}
            onSave={({ quotedAmount }) => {
              // Only push when the value actually changed so the undo
              // stack stays uncluttered with no-op snapshots.
              if (quotedAmount !== String(opp['Quoted Amount'] ?? '').trim()) {
                updateOppField(opp._id, 'Quoted Amount', quotedAmount);
              }
              setLeadQuotedPromptId(null);
            }}
            onClose={() => setLeadQuotedPromptId(null)}
          />
        );
      })()}

      {quotedPromptId != null && (() => {
        const opp = records.find(r => r._id === quotedPromptId);
        if (!opp) return null;
        return (
          <QuotedFollowUpModal
            opp={opp}
            chanceOptions={listRegistry.get('chance')?.options || []}
            onSave={({ quotedOn, chance, marginReviewDate }) => {
              // Only push fields whose value actually changed so the
              // undo stack stays uncluttered with no-op snapshots.
              const curQuotedOn = toISODate(opp['Quoted On'] ?? opp['Quoted Date']) || '';
              if (quotedOn !== curQuotedOn) {
                updateOppField(opp._id, 'Quoted On', quotedOn);
              }
              if (chance !== String(opp['Chance?'] ?? opp['Chance'] ?? '')) {
                updateOppField(opp._id, 'Chance?', chance);
              }
              const curMarginReview = toISODate(
                opp['Margin Email Date - Sales Leader Review Date']
                ?? opp['Margin Email Date'] ?? opp['Sales Leader Review Date']
              ) || '';
              if (marginReviewDate !== curMarginReview) {
                updateOppField(opp._id, 'Margin Email Date - Sales Leader Review Date', marginReviewDate);
              }
              setQuotedPromptId(null);
            }}
            onClose={() => setQuotedPromptId(null)}
          />
        );
      })()}

      {agreementSentPromptId != null && (() => {
        const opp = records.find(r => r._id === agreementSentPromptId);
        if (!opp) return null;
        return (
          <AgreementSentFollowUpModal
            opp={opp}
            columnLinks={columnLinks}
            listRegistry={listRegistry}
            pricingOptionName={optionLinks[String(opp._id)] || ''}
            onSave={({ usd, marginReviewDate, chance, multiInvoices, verbal, entity, coa }) => {
              // Only push fields whose value actually changed so the
              // undo stack stays uncluttered with no-op snapshots.
              if (usd !== String(opp['USD?'] ?? '')) {
                updateOppField(opp._id, 'USD?', usd);
              }
              const curMarginReview = toISODate(
                opp['Margin Email Date - Sales Leader Review Date']
                ?? opp['Margin Email Date'] ?? opp['Sales Leader Review Date']
              ) || '';
              if (marginReviewDate !== curMarginReview) {
                updateOppField(opp._id, 'Margin Email Date - Sales Leader Review Date', marginReviewDate);
              }
              if (chance !== String(opp['Chance?'] ?? opp['Chance'] ?? '')) {
                updateOppField(opp._id, 'Chance?', chance);
              }
              if (multiInvoices !== String(opp['Multiple Invoices?'] ?? '')) {
                updateOppField(opp._id, 'Multiple Invoices?', multiInvoices);
              }
              if (verbal !== String(opp['Verbal'] ?? '')) {
                updateOppField(opp._id, 'Verbal', verbal);
              }
              if (entity !== String(opp['Entity Outside the US Approval'] ?? '')) {
                updateOppField(opp._id, 'Entity Outside the US Approval', entity);
              }
              if (coa !== String(opp['COA Approval'] ?? '')) {
                updateOppField(opp._id, 'COA Approval', coa);
              }
              setAgreementSentPromptId(null);
            }}
            onClose={() => setAgreementSentPromptId(null)}
          />
        );
      })()}

      {followUpStatusPromptId != null && (() => {
        const opp = records.find(r => r._id === followUpStatusPromptId);
        if (!opp) return null;
        const link = resolveColumnLink('Status', columnLinks);
        const statusOpts = (link && listRegistry.get(link.listKey)?.options) || [];
        return (
          <FollowUpStatusModal
            opp={opp}
            statusOptions={statusOpts}
            onSave={({ status, nextSteps, nextStepsWaiting, salesPartner }) => {
              if (status !== String(opp['Status'] ?? '')) {
                updateOppField(opp._id, 'Status', status);
              }
              if (nextSteps !== String(opp['Next Steps'] ?? '')) {
                updateOppField(opp._id, 'Next Steps', nextSteps);
              }
              if (salesPartner !== String(opp['Sales Partner'] ?? '').trim()) {
                updateOppField(opp._id, 'Sales Partner', salesPartner);
              }
              const curWaiting = Array.isArray(opp._nextStepsWaiting) ? opp._nextStepsWaiting : [];
              if (JSON.stringify(nextStepsWaiting) !== JSON.stringify(curWaiting)) {
                updateOppField(opp._id, '_nextStepsWaiting', nextStepsWaiting);
              }
              setFollowUpStatusPromptId(null);
              setFollowUpStatusPrev(null);
              requestCallInSort();
            }}
            onClose={() => { setFollowUpStatusPromptId(null); setFollowUpStatusPrev(null); requestCallInSort(); }}
            onCancel={() => {
              revertFollowUpDate(opp._id, followUpStatusPrev);
              setFollowUpStatusPromptId(null);
              setFollowUpStatusPrev(null);
              requestCallInSort();
            }}
          />
        );
      })()}

      {sourceDrillDown != null && createPortal(
        <div
          onClick={() => setSourceDrillDown(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--color-surface, #fff)', color: 'var(--color-text)', borderRadius: 8, padding: '1.25rem', width: 'min(820px, 94vw)', maxHeight: '82vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
                Source: {sourceDrillDown}
                <span style={{ marginLeft: 8, fontWeight: 400, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  {sourceDrillRows.length} opp{sourceDrillRows.length === 1 ? '' : 's'}
                </span>
              </h3>
              <button type="button" onClick={() => setSourceDrillDown(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'inherit' }}>×</button>
            </div>
            <p style={{ marginTop: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              Opps in this source, matching the current date range and Show filter. Click a row to open its details.
            </p>
            {sourceDrillRows.length === 0 ? (
              <div style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>No opps to display.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Account</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Contact</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Stage</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Scope</th>
                    <th style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' }}>Start Date</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceDrillRows.map(r => (
                    <tr
                      key={r._id}
                      onClick={() => { setInfoOppId(r._id); setSourceDrillDown(null); }}
                      style={{ borderBottom: '1px solid var(--color-border)', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>{r['Account'] || '—'}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>{r['Contact'] || '—'}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>{r['Stage'] || '—'}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>{r['Scope'] || '—'}</td>
                      <td style={{ padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' }}>{r['Start Date'] || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>,
        document.body
      )}

      {infoOppId != null && (() => {
        const opp = records.find(r => r._id === infoOppId);
        if (!opp) return null;
        // Splat in the computed values so the popup shows the same
        // numbers the table cells do without re-deriving them inside
        // the modal.
        const augmented = {
          ...opp,
          'Call In': (() => { const n = resolveCallIn(opp); return n == null ? '' : n; })(),
          'Last Spoke': (() => { const n = resolveLastSpoke(opp); return n == null ? '' : n; })(),
        };
        return (
          <OppInfoModal
            opp={augmented}
            headers={headers}
            onClose={() => setInfoOppId(null)}
            onDelete={deleteOpp}
            onFieldChange={(field, value) => updateOppField(opp._id, field, value)}
            columnLinks={columnLinks}
            listRegistry={listRegistry}
            companySuggestions={companySuggestions}
            peOwnerSuggestions={peOwnerSuggestions}
            prospects={prospects}
            updateProspect={updateProspect}
            hubspotContacts={hubspotContacts}
            pricingOptionServices={pricingOptionServices}
            pricingOptionLinkName={optionLinks[String(opp._id)] || ''}
            onOpenContact={openContactDetails}
            onOpenCompany={openCompanyDetails}
          />
        );
      })()}

      {nextStepsPopupId != null && (() => {
        const opp = records.find(r => r._id === nextStepsPopupId);
        if (!opp) return null;
        return (
          <NextStepsEditor
            key={opp._id}
            opp={opp}
            onClose={() => setNextStepsPopupId(null)}
            updateOppField={updateOppField}
          />
        );
      })()}

      {editingContact && (
        <ContactEditModal
          contact={editingContact}
          onSave={closeContactModal}
          onClose={() => setEditingContact(null)}
          contactNotes={settings?.contactNotes || {}}
          onSaveNote={saveContactNote}
          contactOldEmails={settings?.contactOldEmails || {}}
          onSaveOldEmails={saveContactOldEmails}
          contactNicknames={settings?.contactNicknames || {}}
          onSaveNickname={saveContactNickname}
          contactTeamNames={settings?.contactTeamNames || {}}
          onSaveTeamName={saveContactTeamName}
          contactReportsTo={settings?.contactReportsTo || {}}
          onSaveReportsTo={saveContactReportsTo}
          ccMap={settings?.ccMap || {}}
          onSaveCcMap={(m) => updateSettings({ ccMap: m })}
          toAlsoMap={settings?.toAlsoMap || {}}
          onSaveToAlsoMap={(m) => updateSettings({ toAlsoMap: m })}
          contactFamilies={settings?.contactFamilies || {}}
          onSaveFamily={saveContactFamily}
          contactMetInPerson={settings?.contactMetInPerson || {}}
          onSaveMetInPerson={saveContactMetInPerson}
          contactInvitedToLouisville={settings?.contactInvitedToLouisville || {}}
          onSaveInvitedToLouisville={saveContactInvitedToLouisville}
          events={settings?.events || []}
          onToggleContactEvent={(eventId, c) => updateSettings({ events: toggleContactInEvents(settings?.events || [], eventId, c) })}
          companyContacts={(hubspotContacts || []).filter(c => {
            const cCompany = String(c?.company || '').trim().toLowerCase();
            const tgt = String(editingContact?.company || '').trim().toLowerCase();
            return cCompany && tgt && cCompany === tgt;
          })}
          emailDomains={[]}
          companyNames={(prospects || []).map(p => p.company).filter(Boolean)}
        />
      )}

      <div className={styles.tabs}>
        <button
          className={activeTab === 'opps' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('opps')}
        >Opportunities</button>
        <button
          className={activeTab === 'newOpps' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('newOpps')}
        >New Opps{newOpps.length ? ` (${newOpps.length})` : ''}</button>
        <button
          className={activeTab === 'services' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('services')}
        >By Service</button>
        <button
          className={activeTab === 'bySource' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('bySource')}
        >By Source</button>
        <button
          className={activeTab === 'stageDays' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('stageDays')}
        >Days in Stage</button>
        <button
          className={activeTab === 'stageHistory' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('stageHistory')}
        >Stage History</button>
        <button
          className={activeTab === 'waitingKeith' ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab('waitingKeith')}
        >Keith{waitingOnKeith.length ? ` (${waitingOnKeith.length})` : ''}</button>
      </div>

      <div className={styles.filterRow}>
        {/* Start Date range + Status filters intentionally hidden — the
            underlying state stays at its no-op defaults (empty range,
            status "all") so nothing is filtered out. */}
        <label className={styles.filterLabel}>
          Show
          <select
            className={styles.filterInput}
            value={activityFilter}
            onChange={e => setActivityFilter(e.target.value)}
          >
            <option value="active">Active only</option>
            <option value="closed">Closed only</option>
            <option value="all">All</option>
          </select>
        </label>
        {filtersActive && (
          <button className={styles.clearFiltersBtn} onClick={clearFilters}>Clear filters</button>
        )}
        <button
          className={styles.clearFiltersBtn}
          onClick={() => setHideHistory(v => !v)}
          disabled={hideHistory && historyCount === 0}
          title={hideHistory
            ? 'Rows with no Call In number are hidden as history. Click to include them.'
            : 'Hide rows with no Call In number — they aren’t on a callback schedule.'}
        >
          {hideHistory
            ? `Show history${historyCount ? ` (${historyCount})` : ''}`
            : 'Hide history'}
        </button>
        <button
          className={styles.clearFiltersBtn}
          onClick={() => setShowHiddenByFilter(v => !v)}
          disabled={!showHiddenByFilter && hiddenByFilterCount === 0}
          title={showHiddenByFilter
            ? 'Re-apply the Date / Status / Show filters above.'
            : hiddenByFilterCount > 0
              ? 'Temporarily reveal every row hidden by the current filters without changing the filter inputs.'
              : 'No rows are currently hidden by the Date / Status / Show filters.'}
        >
          {showHiddenByFilter
            ? 'Re-apply filters'
            : `Show hidden${hiddenByFilterCount ? ` (${hiddenByFilterCount})` : ''}`}
        </button>
      </div>

      {activeTab === 'opps' && (
        <>
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search across all columns (Account, Stage, Scope, Notes, BFO Address, …)"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span className={styles.resultCount}>{filtered.length} of {prefiltered.length}{filtersActive && prefiltered.length !== records.length ? ` (filtered from ${records.length})` : ''}</span>
            <button
              type="button"
              onClick={() => {
                setMassEditOn(on => {
                  // Leaving mass-edit mode clears any in-flight
                  // selection so the bulk toolbar disappears and the
                  // next time the user re-enters they start fresh.
                  if (on) setSelectedIds(new Set());
                  return !on;
                });
              }}
              title={massEditOn
                ? 'Hide the selection checkboxes and exit mass-edit mode.'
                : 'Show selection checkboxes so you can pick multiple rows to edit at once.'}
              style={{
                marginLeft: '0.5rem',
                padding: '0.3rem 0.7rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                fontFamily: 'inherit',
                color: massEditOn ? '#fff' : '#1E3A8A',
                background: massEditOn ? '#2563EB' : '#fff',
                border: `1px solid ${massEditOn ? '#2563EB' : '#93C5FD'}`,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >{massEditOn ? 'Exit Mass Edit' : 'Mass Edit'}</button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setShowOnlySelected(v => !v)}
                title={showOnlySelected
                  ? 'Show every row again. Your selection is kept.'
                  : 'Hide every row that isn\'t currently selected.'}
                style={{
                  marginLeft: '0.5rem',
                  padding: '0.3rem 0.7rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  color: showOnlySelected ? '#fff' : '#166534',
                  background: showOnlySelected ? '#16A34A' : '#fff',
                  border: `1px solid ${showOnlySelected ? '#16A34A' : '#86EFAC'}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >{showOnlySelected ? `Showing ${selectedIds.size} selected — Show all` : `Show ${selectedIds.size} selected only`}</button>
            )}
          </div>

          {massEditOn && selectedIds.size > 0 && (
            <MassEditBar
              selectedCount={selectedIds.size}
              headers={headers}
              columnLinks={columnLinks}
              listRegistry={listRegistry}
              onApply={(field, value) => updateManyOppFields(selectedIds, field, value)}
              onDelete={() => deleteManyOpps(selectedIds)}
              onClear={() => setSelectedIds(new Set())}
              onEmailTable={handleEmailTable}
            />
          )}

          {loading && !data ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <DataTable
              tableId="opps2"
              columns={columns}
              rows={filtered}
              sortSignal={callInSortSignal}
              alwaysVisible={['Account', '_select', '_info']}
              // No default sort — editing Follow Up / Last Client Heard From
              // Us would otherwise re-rank rows by Call In on every keystroke
              // and yank the row out from under the cursor. The Call In
              // header click still toggles a manual sort when the user
              // actually wants to triage by urgency.
              enableColumnFilters
              onFilteredRowsChange={handleFilteredRowsChange}
              emptyMessage="No opps yet — click + New Opp to create one."
              settings={settings}
              updateSettings={updateSettings}
              // Notes / Next Steps can grow taller via Alt+Enter newlines,
              // so the fixed-rowHeight virtualization spacers misalign and
              // the user ends up scrolled into a "ghost" zone with no
              // rendered rows. variableRowHeight renders every row and lets
              // content-visibility handle off-screen perf.
              variableRowHeight
              rowStyle={(row) => {
                // Tint closed opps so the table reads at a glance —
                // light green for wins, light red for losses. Rows the
                // user has marked "No Further Action Today" go light
                // grey ("Yes") or light yellow ("No" / X) and win
                // against the stage tint so today's do-nothing rows
                // visibly recede. The style also lands on every <td>
                // (including the sticky Account column) so the row
                // is solidly coloured edge to edge.
                const nfat = String(row?.['No Further Action Today'] || '').trim().toLowerCase();
                if (nfat === 'yes') return { background: '#E5E7EB' };
                if (nfat === 'no') return { background: '#FEF9C3' };
                const stage = String(row?.Stage || '').trim();
                if (stage === 'Sold') return { background: '#DCFCE7' };
                if (stage === 'Not Sold') return { background: '#FEE2E2' };
                return undefined;
              }}
            />
          )}
        </>
      )}

      {activeTab === 'newOpps' && (
        <>
          <div className={styles.searchRow}>
            <span className={styles.resultCount}>
              {newOpps.length} active opp{newOpps.length === 1 ? '' : 's'} (≤ {NEW_OPPS_MAX_STAGE_AGE_DAYS} days in Lead/Qualifying/Quoting)
            </span>
            <button
              type="button"
              onClick={handleExportNewOpps}
              disabled={newOpps.length === 0}
              title={newOpps.length ? 'Download these new opps as an SE-formatted Excel file' : 'No new opps to export'}
              style={{
                marginLeft: '0.5rem', padding: '0.3rem 0.7rem', fontSize: '0.78rem', fontWeight: 600,
                fontFamily: 'inherit', color: newOpps.length ? '#fff' : '#94A3B8',
                background: newOpps.length ? '#009530' : '#E2E8F0',
                border: `1px solid ${newOpps.length ? '#009530' : '#CBD5E1'}`,
                borderRadius: 6, cursor: newOpps.length ? 'pointer' : 'not-allowed',
              }}
            >Export to Excel</button>
            <button
              type="button"
              onClick={() => downloadNewOppsOutlookDraft(newOpps, {
                // To / subject / greeting use the util's defaults
                // (keith.mchugh@se.com, "Dan B New Opportunities",
                // "Hey Keith,"). Signature is the same one the Draft
                // Email tab appends: the saved settings.emailSignature,
                // falling back to the bundled default for the admin.
                signature: settings?.emailSignature || (isAdmin ? DEFAULT_EMAIL_SIGNATURE : ''),
              })}
              disabled={newOpps.length === 0}
              title={newOpps.length
                ? 'Download an Outlook draft (.eml) of this email — open it in Outlook to review and send it yourself'
                : 'No new opps to draft'}
              style={{
                marginLeft: '0.5rem', padding: '0.3rem 0.7rem', fontSize: '0.78rem', fontWeight: 600,
                fontFamily: 'inherit', color: newOpps.length ? '#0F6CBD' : '#94A3B8',
                background: '#fff',
                border: `1px solid ${newOpps.length ? '#0F6CBD' : '#CBD5E1'}`,
                borderRadius: 6, cursor: newOpps.length ? 'pointer' : 'not-allowed',
              }}
            >Download Outlook draft</button>
            <button
              type="button"
              onClick={() => setNewOppsScheduleOpen(true)}
              title="Schedule a recurring email that sends these new opps as a table in the email body"
              style={{
                marginLeft: '0.5rem', padding: '0.3rem 0.7rem', fontSize: '0.78rem', fontWeight: 600,
                fontFamily: 'inherit', color: '#009530', background: '#fff',
                border: '1px solid #009530', borderRadius: 6, cursor: 'pointer',
              }}
            >Schedule email</button>
          </div>
          <div style={{ padding: '0 0 0.5rem', fontSize: '0.72rem', color: '#64748B' }}>
            Shows opps with a BFO Opportunity Name whose current stage is Lead, Qualifying, or Quoting and whose combined time across those stages is ≤ {NEW_OPPS_MAX_STAGE_AGE_DAYS} days.
          </div>
          {loading && !data ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <DataTable
              tableId="opps2-new"
              columns={newOppsColumns}
              rows={newOpps}
              alwaysVisible={['Account']}
              enableColumnFilters
              variableRowHeight
              emptyMessage={`No active opps within ${NEW_OPPS_MAX_STAGE_AGE_DAYS} days in Lead/Qualifying/Quoting.`}
              settings={settings}
              updateSettings={updateSettings}
            />
          )}
        </>
      )}

      {activeTab === 'waitingKeith' && (
        <>
          <div className={styles.searchRow}>
            <span className={styles.resultCount}>
              {waitingOnKeith.length} opp{waitingOnKeith.length === 1 ? '' : 's'} waiting on Keith
            </span>
          </div>
          <div style={{ padding: '0 0 0.5rem', fontSize: '0.72rem', color: '#64748B' }}>
            Shows opps with “Keith” in the Waiting On column.
          </div>
          {loading && !data ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <DataTable
              tableId="opps2-waiting-keith"
              columns={columns}
              rows={waitingOnKeith}
              alwaysVisible={['Account', '_info']}
              enableColumnFilters
              variableRowHeight
              emptyMessage="No opps are waiting on Keith."
              settings={settings}
              updateSettings={updateSettings}
              rowStyle={(row) => {
                const nfat = String(row?.['No Further Action Today'] || '').trim().toLowerCase();
                if (nfat === 'yes') return { background: '#E5E7EB' };
                if (nfat === 'no') return { background: '#FEF9C3' };
                const stage = String(row?.Stage || '').trim();
                if (stage === 'Sold') return { background: '#DCFCE7' };
                if (stage === 'Not Sold') return { background: '#FEE2E2' };
                return undefined;
              }}
            />
          )}
        </>
      )}

      <NewOppsScheduleModal
        open={newOppsScheduleOpen}
        onClose={() => setNewOppsScheduleOpen(false)}
        uid={user?.uid}
        email={user?.email}
        oppsRows={newOpps}
      />

      {emailTableRecords && (
        <EmailTableModal
          records={emailTableRecords}
          signature={settings?.emailSignature || (isAdmin ? DEFAULT_EMAIL_SIGNATURE : '')}
          onClose={() => setEmailTableRecords(null)}
        />
      )}

      {activeTab === 'services' && (
        <>
          <div className={styles.searchRow}>
            <span className={styles.resultCount}>
              {(() => {
                const visibleCount = serviceBreakdown.rows.filter(r => showHidden || !hiddenServices.has(r.scope)).length;
                return `${visibleCount} service${visibleCount === 1 ? '' : 's'} · ${serviceBreakdown.total} total opps`;
              })()}
            </span>
            {hiddenServices.size > 0 && (
              <label className={styles.showHiddenLabel}>
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={e => setShowHidden(e.target.checked)}
                />
                Show {hiddenServices.size} hidden
              </label>
            )}
          </div>
          <DataTable
            tableId="opps2-services"
            columns={servicesColumns}
            rows={serviceBreakdown.rows
              .filter(r => showHidden || !hiddenServices.has(r.scope))
              .map(r => ({ ...r, id: r.scope, _hidden: hiddenServices.has(r.scope) }))}
            alwaysVisible={['scope']}
            rowStyle={(row) => row._hidden ? { opacity: 0.5 } : undefined}
            emptyMessage="No services to display."
            settings={settings}
            updateSettings={updateSettings}
          />
        </>
      )}

      {activeTab === 'bySource' && (
        <>
          <div className={styles.searchRow}>
            <label className={styles.filterLabel}>
              From
              <input
                type="date"
                className={styles.filterInput}
                value={sourceFrom}
                max={sourceTo || undefined}
                onChange={e => setSourceFrom(e.target.value)}
              />
            </label>
            <label className={styles.filterLabel}>
              To
              <input
                type="date"
                className={styles.filterInput}
                value={sourceTo}
                min={sourceFrom || undefined}
                onChange={e => setSourceTo(e.target.value)}
              />
            </label>
            <label className={styles.filterLabel}>
              Show
              <select
                className={styles.filterInput}
                value={sourceActivityFilter}
                onChange={e => setSourceActivityFilter(e.target.value)}
              >
                <option value="active">Active only</option>
                <option value="closed">Closed only</option>
                <option value="all">All</option>
              </select>
            </label>
            {(sourceFrom || sourceTo || sourceActivityFilter !== 'active') && (
              <button
                className={styles.clearFiltersBtn}
                onClick={() => { setSourceFrom(''); setSourceTo(''); setSourceActivityFilter('active'); }}
              >Clear filters</button>
            )}
            <span className={styles.resultCount}>
              {sourceBreakdown.rows.length} source{sourceBreakdown.rows.length === 1 ? '' : 's'} · {sourceBreakdown.total} {sourceActivityFilter === 'active' ? 'active ' : sourceActivityFilter === 'closed' ? 'closed ' : ''}lead{sourceBreakdown.total === 1 ? '' : 's'}
              {(sourceFrom || sourceTo) ? ' in range' : ''} · click a source to see its opps
            </span>
          </div>
          <DataTable
            tableId="opps2-source"
            columns={sourceColumns}
            rows={sourceBreakdown.rows.map(r => ({ ...r, id: r.source }))}
            alwaysVisible={['source']}
            emptyMessage="No leads to display for this time range."
            onRowClick={(row) => setSourceDrillDown(row.source)}
            settings={settings}
            updateSettings={updateSettings}
          />
        </>
      )}

      {activeTab === 'stageDays' && (
        <>
          <div className={styles.searchRow}>
            <label className={styles.showHiddenLabel}>
              <input
                type="checkbox"
                checked={hideNotStarted}
                onChange={e => setHideNotStarted(e.target.checked)}
              />
              Hide Not Started ({(stageDaysByStage.get('Not Started') || []).length})
            </label>
            <span style={{ fontSize: '0.72rem', color: '#B45309', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 10, height: 10, borderRadius: 2,
                background: '#FEF3C7', border: '1px solid #FCD34D', display: 'inline-block',
              }} />
              ⚠ flagged = stalled past its stage limit (hover for the suggested move)
            </span>
          </div>
          <div style={{
            display: 'flex', gap: 12, overflowX: 'auto',
            padding: '12px 0', alignItems: 'flex-start',
          }}>
            {TRACKED_STAGES.filter(s => !(hideNotStarted && s === 'Not Started')).map(stage => {
              const items = stageDaysByStage.get(stage) || [];
              return (
                <div key={stage} style={{
                  flex: '0 0 220px', width: 220,
                  background: '#F1F5F9', borderRadius: 6, padding: 8,
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'baseline',
                    justifyContent: 'space-between',
                    padding: '2px 4px 6px',
                    borderBottom: '1px solid #CBD5E1',
                  }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{stage}</span>
                    <span style={{ fontSize: '0.72rem', color: '#64748B' }}>{items.length}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {items.length === 0 ? (
                      <div style={{
                        color: '#94A3B8', fontSize: '0.72rem',
                        textAlign: 'center', padding: '8px 0',
                      }}>—</div>
                    ) : items.map(row => {
                      const dayBadgeTitle = row.enteredAt
                        ? `Stage entered ${formatDateDisplay(row.enteredAt)}${row._hasExplicitEntry ? '' : ' (fallback to Start Date)'}`
                        : 'No entry date recorded.';
                      // Flagged opps (stalled past the stage's limit) stay
                      // in the same column but render in amber, with the
                      // suggested move on the card and in the hover — so
                      // the board doubles as the "needs action" list. Opps
                      // the user ignored on the Opps tab don't flag here.
                      const action = row.ignoreStall ? null : stageActionFor(row.Stage, row.days);
                      // Account-name hover surfaces the row's Scope so
                      // the kanban reads like a triage board — no need
                      // to bounce back to the Opportunities tab to see
                      // what the opp is actually selling.
                      const accountTitle = action
                        ? `Stalled ${row.days}d (> ${action.days}d) → ${action.suggestion}${row.scope ? `\nScope: ${row.scope}` : ''}`
                        : (row.scope ? `Scope: ${row.scope}` : 'No scope set on this opp.');
                      return (
                        <div
                          key={row.id}
                          style={{
                            background: action ? '#FEF3C7' : '#FFFFFF', borderRadius: 4,
                            border: `1px solid ${action ? '#FCD34D' : '#E2E8F0'}`,
                            padding: '6px 8px',
                            display: 'flex', flexDirection: 'column', gap: 3,
                          }}
                        >
                          <div style={{
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between', gap: 8,
                          }}>
                            <span
                              title={accountTitle}
                              style={{
                                fontSize: '0.8rem', fontWeight: 500,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                minWidth: 0, cursor: 'help',
                              }}
                            >
                              {action && <span title="Stalled past its stage limit">⚠ </span>}
                              {row.Account || <span style={{ color: '#94A3B8' }}>(no account)</span>}
                            </span>
                            <span
                              title={dayBadgeTitle}
                              style={{
                                fontSize: '0.72rem', fontWeight: action ? 700 : 600,
                                color: action ? '#B45309' : (row.days != null && row.days > 30 ? '#DC2626' : '#475569'),
                                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                              }}
                            >
                              {row.days == null ? '—' : `${row.days}d`}
                            </span>
                          </div>
                          {action && (
                            <span style={{
                              fontSize: '0.68rem', fontWeight: 600, color: '#B45309',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {action.suggestion}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeTab === 'stageHistory' && (
        <>
          <div className={styles.searchRow}>
            <span className={styles.resultCount}>
              {stageHistoryRows.length} opp{stageHistoryRows.length === 1 ? '' : 's'}
            </span>
            <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
              Per-stage days come from each Stage change you log. The current stage&rsquo;s
              column also includes the time since the last move. Opps that haven&rsquo;t
              moved stages yet will only have a value in their current-stage column.
            </span>
          </div>
          <DataTable
            tableId="opps2-stage-history"
            columns={stageHistoryColumns}
            rows={stageHistoryRows}
            alwaysVisible={['Account']}
            emptyMessage="No tracked opps to show."
            settings={settings}
            updateSettings={updateSettings}
          />
        </>
      )}
    </div>
  );
}
````

### src/components/OppsView2/OppsView2.module.css

````css
.wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem 0.5rem;
}

.syncBanner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  /* Stick to the top so it stays visible while the user scrolls the
     table — a local-only-edits warning must not scroll out of sight. */
  position: sticky;
  top: 0;
  z-index: 20;
  margin: 0.5rem 1.25rem 0;
  padding: 0.625rem 0.875rem;
  background: #fdecea;
  border: 1px solid #f5c2c0;
  border-radius: 6px;
  color: #8a1c12;
  font-size: var(--font-size-sm);
  line-height: 1.4;
  box-shadow: 0 2px 8px rgba(138, 28, 18, 0.18);
}

.syncBannerDetail {
  font-size: var(--font-size-xs);
  opacity: 0.85;
}

.syncBannerRetry:disabled {
  opacity: 0.6;
  cursor: progress;
}

.syncBannerRetry {
  flex: none;
  padding: 0.35rem 0.75rem;
  background: #c0392b;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-weight: 600;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.syncBannerRetry:hover {
  background: #a93226;
}

.title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
}

.lastSync {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.syncBtn {
  padding: 0.45rem 0.85rem;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 600;
  font-family: inherit;
}

.syncBtn:hover { background: var(--color-accent-hover); }
.syncBtn:disabled { opacity: 0.6; cursor: not-allowed; }

.error {
  margin: 0 1.25rem 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--color-danger-light);
  color: var(--color-danger);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}

.summary {
  display: flex;
  gap: 0.5rem;
  padding: 0 1.25rem 0.5rem;
  flex-wrap: wrap;
}

.summaryChip {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.6rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}

.summaryChipValue {
  font-weight: 700;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.summaryChipLabel {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.searchRow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 1.25rem 0.5rem;
}

.searchInput {
  width: 100%;
  max-width: 320px;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-bg);
}

.searchInput:focus {
  outline: none;
  border-color: var(--color-accent);
}

.resultCount {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}

.loading {
  padding: 3rem;
  text-align: center;
  color: var(--color-text-muted);
}

.tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0 1.25rem 0.5rem;
  border-bottom: 1px solid var(--color-border-light);
  margin-bottom: 0.5rem;
}

.tab, .tabActive {
  padding: 0.45rem 0.9rem;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: var(--font-size-sm);
  font-weight: 600;
  font-family: inherit;
  color: var(--color-text-muted);
  cursor: pointer;
  margin-bottom: -1px;
}

.tab:hover { color: var(--color-text); }

.tabActive {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}

.filterRow {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
  padding: 0 1.25rem 0.75rem;
}

.filterLabel {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.filterInput {
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-bg);
  min-width: 140px;
}

.filterInput:focus {
  outline: none;
  border-color: var(--color-accent);
}

.clearFiltersBtn {
  padding: 0.4rem 0.75rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  font-weight: 600;
  font-family: inherit;
  color: var(--color-text-muted);
  cursor: pointer;
}

.clearFiltersBtn:hover:not(:disabled) {
  color: var(--color-text);
  border-color: var(--color-accent);
}

.clearFiltersBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.servicesWrap {
  padding: 0 1.25rem 1.25rem;
  overflow: auto;
}

.servicesHeader {
  padding: 0 0 0.5rem;
}

.servicesTable {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.servicesTable th {
  text-align: left;
  padding: 0.6rem 0.75rem;
  background: var(--color-bg);
  font-weight: 600;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border-bottom: 1px solid var(--color-border-light);
}

.servicesTable td {
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text);
}

.servicesTable tbody tr:last-child td {
  border-bottom: none;
}

.servicesTable tbody tr:hover {
  background: var(--color-bg);
}

.serviceBar {
  height: 8px;
  background: var(--color-border-light);
  border-radius: 999px;
  overflow: hidden;
}

.serviceBarFill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 999px;
  transition: width 0.2s ease;
}

.hideServiceBtn {
  padding: 0.25rem 0.6rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  font-weight: 600;
  font-family: inherit;
  color: var(--color-text-muted);
  cursor: pointer;
}

.hideServiceBtn:hover {
  color: var(--color-danger, #b91c1c);
  border-color: var(--color-danger, #b91c1c);
}

.showHiddenLabel {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  cursor: pointer;
  margin-left: 0.75rem;
}
````

### src/components/OppsView2/NewOppsScheduleModal.jsx

````jsx
import { useEffect, useState } from 'react';
import {
  listSchedules, createSchedule, updateSchedule, removeSchedule, setEnabled,
  describeSchedule, normalizeRecipients, isValidEmail, FREQUENCIES, WEEKDAYS,
} from '../../utils/newOppsSchedulesStore';
import { apiFetch } from '../../utils/apiFetch';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DOM = Array.from({ length: 28 }, (_, i) => i + 1);

// New schedules default to a weekly Monday 9am digest, pre-addressed to the
// signed-in user, since the report covers the actively-progressing new opps.
function emptyForm(defaultRecipient) {
  return {
    id: null,
    name: '',
    recipients: defaultRecipient ? String(defaultRecipient) : '',
    subject: 'New Opportunities',
    message: '',
    frequency: 'weekly',
    hourLocal: 9,
    dayOfWeekLocal: 1, // Monday
    dayOfMonthLocal: 1,
    skipWhenEmpty: false,
    enabled: true,
  };
}

const tzLabel = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'; }
  catch { return 'local time'; }
})();

// Modal that lets the user create / edit / delete recurring emails which
// send the New Opps table (actively-progressing new opps) to a list of
// recipients. Mirrors PEOppsScheduleModal, minus a column picker — the
// emailed table's column set is fixed (see NEW_OPPS_EMAIL_COLUMNS in
// api/_lib/newOpps.js).
export function NewOppsScheduleModal({ open, onClose, uid, email, oppsRows }) {
  const [schedules, setSchedules] = useState([]);
  const [form, setForm] = useState(() => emptyForm(email));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    if (!uid) { setSchedules([]); return; }
    setLoading(true);
    try { setSchedules(await listSchedules()); }
    catch (err) { setError(String(err.message || err)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!open) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, uid]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [toast]);

  if (!open) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const startNew = () => { setForm(emptyForm(email)); setEditing(true); setError(''); };
  const startEdit = (s) => {
    setForm({
      id: s.id,
      name: s.name || '',
      recipients: (s.recipients || []).join('\n'),
      subject: s.subject || 'New Opportunities',
      message: s.message || '',
      frequency: s.frequency || 'weekly',
      hourLocal: s.hourLocal ?? 9,
      dayOfWeekLocal: s.dayOfWeekLocal ?? 1,
      dayOfMonthLocal: s.dayOfMonthLocal ?? 1,
      skipWhenEmpty: !!s.skipWhenEmpty,
      enabled: s.enabled !== false,
    });
    setEditing(true);
    setError('');
  };

  const validate = () => {
    const list = normalizeRecipients(form.recipients);
    if (list.length === 0) return 'Add at least one recipient email.';
    const bad = list.find((e) => !isValidEmail(e));
    if (bad) return `"${bad}" is not a valid email address.`;
    return '';
  };

  const handleSave = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true);
    setError('');
    try {
      if (form.id) await updateSchedule(form.id, form);
      else await createSchedule(uid, email, form);
      setEditing(false);
      setToast('Schedule saved.');
      await reload();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s) => {
    if (!window.confirm(`Delete this schedule? "${describeSchedule(s)}" to ${(s.recipients || []).length} recipient(s).`)) return;
    try { await removeSchedule(s.id); setToast('Schedule deleted.'); await reload(); }
    catch (err) { setToast(`Delete failed: ${err.message || err}`); }
  };

  const handleToggle = async (s) => {
    try { await setEnabled(s.id, !(s.enabled !== false)); await reload(); }
    catch (err) { setToast(`Update failed: ${err.message || err}`); }
  };

  // Send immediately (a saved schedule by id, or the in-progress form).
  const handleSendNow = async (s) => {
    setBusyId(s ? s.id : 'form');
    setError('');
    try {
      // Send exactly the new opps shown on the page (the page reads the
      // newest local/cloud data, which can be ahead of the cloud copy the
      // server would otherwise re-read) so the email matches the table.
      const records = Array.isArray(oppsRows) ? oppsRows : undefined;
      const body = s
        ? { scheduleId: s.id, records }
        : {
            recipients: normalizeRecipients(form.recipients),
            subject: form.subject,
            message: form.message,
            records,
          };
      if (!s) {
        const v = validate();
        if (v) { setError(v); setBusyId(null); return; }
      }
      const res = await apiFetch('/api/new-opps-send-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.code ? ` [${data.code}]` : '';
        throw new Error(`${data.error || `Send failed (${res.status})`}${detail}`);
      }
      setToast(`Sent ${data.opps ?? ''} opps to ${data.recipients ?? ''} recipient(s).`);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '3vh 1rem', overflowY: 'auto' }}
    >
      <div style={{ background: '#fff', borderRadius: 10, width: 'min(680px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ padding: '0.9rem 1.25rem', background: '#009530', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700 }}>Schedule New Opps email</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '1rem 1.25rem' }}>
          {toast && (
            <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 6, fontSize: '0.78rem', color: '#065F46' }}>{toast}</div>
          )}

          {!editing && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <div style={{ fontSize: '0.78rem', color: '#64748B' }}>
                  {loading ? 'Loading…' : schedules.length === 0 ? 'No schedules yet.' : `${schedules.length} schedule${schedules.length === 1 ? '' : 's'}`}
                </div>
                <button type="button" onClick={startNew} style={btnPrimary}>+ New schedule</button>
              </div>

              {schedules.map((s) => (
                <div key={s.id} style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.7rem 0.85rem', marginBottom: '0.6rem', background: s.enabled === false ? '#F8FAFC' : '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1E293B' }}>
                        {s.name || describeSchedule(s)}
                        {s.enabled === false && <span style={{ marginLeft: 8, fontSize: '0.65rem', fontWeight: 700, color: '#94A3B8' }}>PAUSED</span>}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>{describeSchedule(s)} · {tzLabel}</div>
                      <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        To: {(s.recipients || []).join(', ') || '—'}
                      </div>
                      {s.lastStatus && (
                        <div style={{ fontSize: '0.68rem', marginTop: 3, color: s.lastStatus === 'error' ? '#B91C1C' : '#64748B' }}>
                          Last: {s.lastStatus}{s.lastSentAt ? ` · ${new Date(s.lastSentAt).toLocaleString()}` : ''}{s.lastStatus === 'error' && s.lastError ? ` — ${s.lastError}` : ''}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                      <button type="button" onClick={() => handleSendNow(s)} disabled={busyId === s.id} style={btnGhost}>{busyId === s.id ? 'Sending…' : 'Send now'}</button>
                      <button type="button" onClick={() => startEdit(s)} style={btnGhost}>Edit</button>
                      <button type="button" onClick={() => handleToggle(s)} style={btnGhost}>{s.enabled === false ? 'Resume' : 'Pause'}</button>
                      <button type="button" onClick={() => handleDelete(s)} style={{ ...btnGhost, color: '#B91C1C', borderColor: '#FCA5A5' }}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}

              {error && <div style={errBox}>{error}</div>}
            </>
          )}

          {editing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <Field label="Name (optional)">
                <input style={inp} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Weekly new-opps digest" />
              </Field>

              <Field label="Recipients (one per line or comma-separated)">
                <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' }} value={form.recipients} onChange={(e) => set('recipients', e.target.value)} placeholder="alice@example.com, bob@example.com" />
              </Field>
              <div style={{ fontSize: '0.68rem', color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, padding: '0.45rem 0.6rem', marginTop: '-0.3rem' }}>
                Emails are sent from the connected Gmail account and can go to anyone. Use <strong>Send test now</strong> to confirm a recipient receives it.
              </div>

              <Field label="Subject">
                <input style={inp} value={form.subject} onChange={(e) => set('subject', e.target.value)} />
              </Field>

              <Field label="Message (optional intro)">
                <textarea style={{ ...inp, minHeight: 48, resize: 'vertical' }} value={form.message} onChange={(e) => set('message', e.target.value)} placeholder="Optional note shown above the attachment." />
              </Field>

              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Field label="Frequency">
                  <select style={inp} value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>
                    {FREQUENCIES.map((f) => <option key={f} value={f}>{f[0].toUpperCase() + f.slice(1)}</option>)}
                  </select>
                </Field>
                {form.frequency === 'weekly' && (
                  <Field label="Day of week">
                    <select style={inp} value={form.dayOfWeekLocal} onChange={(e) => set('dayOfWeekLocal', Number(e.target.value))}>
                      {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </Field>
                )}
                {form.frequency === 'monthly' && (
                  <Field label="Day of month">
                    <select style={inp} value={form.dayOfMonthLocal} onChange={(e) => set('dayOfMonthLocal', Number(e.target.value))}>
                      {DOM.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </Field>
                )}
                <Field label={`Time (${tzLabel})`}>
                  <select style={inp} value={form.hourLocal} onChange={(e) => set('hourLocal', Number(e.target.value))}>
                    {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </Field>
              </div>

              <div style={{ fontSize: '0.7rem', color: '#64748B', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '0.45rem 0.6rem' }}>
                The emailed table always shows: Account, Stage, Scope, Source, Start Date, Quoted Amount, Next Steps, and a BFO Link.
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: '#334155' }}>
                <input type="checkbox" checked={form.skipWhenEmpty} onChange={(e) => set('skipWhenEmpty', e.target.checked)} />
                Don&apos;t send if there are no new opps
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: '#334155' }}>
                <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
                Enabled
              </label>

              {error && <div style={errBox}>{error}</div>}

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', marginTop: '0.3rem' }}>
                <button type="button" onClick={() => handleSendNow(null)} disabled={busyId === 'form'} style={btnGhost}>{busyId === 'form' ? 'Sending…' : 'Send test now'}</button>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={() => { setEditing(false); setError(''); }} style={btnGhost}>Cancel</button>
                  <button type="button" onClick={handleSave} disabled={saving} style={btnPrimary}>{saving ? 'Saving…' : 'Save schedule'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.72rem', fontWeight: 600, color: '#475569' }}>
      {label}
      {children}
    </label>
  );
}

const inp = { padding: '0.4rem 0.55rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.8rem', fontFamily: 'inherit', fontWeight: 400, color: '#1E293B', width: '100%', boxSizing: 'border-box' };
const btnPrimary = { padding: '0.45rem 0.9rem', border: '1px solid #009530', borderRadius: 6, background: '#009530', color: '#fff', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const btnGhost = { padding: '0.3rem 0.6rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', color: '#334155', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const errBox = { marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, fontSize: '0.76rem', color: '#B91C1C' };
````

### src/components/ProspectModal/ProspectModal.jsx

````jsx
// LIGHTWEIGHT STUB for the Lovable export.
//
// In the full app, clicking a contact on the Opps page opens a rich
// ContactEditModal (notes, nicknames, CC maps, families, events, HubSpot
// cross-reference, "met in person" / "invited to" toggles, …). That
// editor lives in a large module that pulls in a big unrelated subtree
// (Target Accounts compare, the Opportunity form, Firestore sync), none
// of which belongs in an Opps/Dropdowns export. So we replace it with a
// minimal placeholder that shows the selected contact and closes again.
//
// The Opps page itself is unchanged — it still wires up all the real
// save handlers; they just have nothing to call here. Recreating the
// full editor is left as an exercise for whoever needs it.

export function ContactEditModal({ contact, onClose }) {
  if (!contact) return null;
  const name = contact.name || contact.fullName ||
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    'Contact';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, maxWidth: 440, width: '100%',
          padding: '24px 28px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>{name}</h2>
        {contact.company && (
          <div style={{ color: '#64748b', marginBottom: 4 }}>{contact.company}</div>
        )}
        {contact.email && (
          <div style={{ color: '#2563eb', marginBottom: 16 }}>{contact.email}</div>
        )}
        <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.5, margin: '12px 0 20px' }}>
          The full contact editor (notes, nicknames, CC routing, events,
          HubSpot details and more) is omitted from this standalone export.
          This placeholder stands in for it so the Opps page stays focused
          on the table and Dropdowns UI.
        </p>
        <div style={{ textAlign: 'right' }}>
          <button
            onClick={onClose}
            style={{
              background: '#0f172a', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontSize: 14,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
````

### src/components/common/DataTable.jsx

````jsx
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import styles from './DataTable.module.css';

const COL_WIDTHS_PREFIX = 'prospect-col-widths-';
const COL_VISIBLE_PREFIX = 'prospect-col-visible-';
const COL_NAMES_PREFIX = 'prospect-col-names-';
const COL_ORDER_PREFIX = 'prospect-col-order-';
const COL_REMOVED_PREFIX = 'prospect-col-removed-';

function loadColNames(tableId) {
  try { return JSON.parse(localStorage.getItem(COL_NAMES_PREFIX + tableId)) || {}; } catch { return {}; }
}
function saveColNames(tableId, names) { localStorage.setItem(COL_NAMES_PREFIX + tableId, JSON.stringify(names)); }

function loadColOrder(tableId) {
  try { const v = JSON.parse(localStorage.getItem(COL_ORDER_PREFIX + tableId)); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveColOrder(tableId, order) { localStorage.setItem(COL_ORDER_PREFIX + tableId, JSON.stringify(order)); }

// Reorder the columns array by a saved key order. Keys in `order` lead
// (in that order); any column not in the saved order — e.g. a column
// added to the code after the user last arranged the table — keeps its
// original relative position at the tail so it never goes missing.
function orderColumns(columns, order) {
  let out;
  if (!Array.isArray(order) || order.length === 0) {
    out = columns;
  } else {
    const byKey = new Map(columns.map(c => [c.key, c]));
    out = [];
    const used = new Set();
    for (const k of order) {
      const c = byKey.get(k);
      if (c) { out.push(c); used.add(k); }
    }
    for (const c of columns) {
      if (!used.has(c.key)) out.push(c);
    }
  }
  // A selection checkbox column always belongs at the far left, even when a
  // stale saved order (from before the column was added) would push it to
  // the tail. Non-mutating so the caller's array is untouched.
  const selIdx = out.findIndex(c => c.key === '__select__');
  if (selIdx > 0) out = [out[selIdx], ...out.slice(0, selIdx), ...out.slice(selIdx + 1)];
  return out;
}

function loadColWidths(tableId) {
  try { return JSON.parse(localStorage.getItem(COL_WIDTHS_PREFIX + tableId)) || {}; } catch { return {}; }
}
function saveColWidths(tableId, w) { localStorage.setItem(COL_WIDTHS_PREFIX + tableId, JSON.stringify(w)); }

function loadColVisible(tableId, allKeys) {
  try {
    const saved = JSON.parse(localStorage.getItem(COL_VISIBLE_PREFIX + tableId));
    // An empty array means the user (or a sync race) saved a "no
    // columns visible" set. That's never a usable state — fall back to
    // showing everything so the table doesn't render as a blank panel.
    if (Array.isArray(saved) && saved.length > 0) return new Set(saved);
    return new Set(allKeys);
  } catch { return new Set(allKeys); }
}
function saveColVisible(tableId, set) { localStorage.setItem(COL_VISIBLE_PREFIX + tableId, JSON.stringify([...set])); }

// Removed columns (removableColumns mode only): keys the user has taken
// out of the table layout entirely. Unlike hidden columns these don't
// appear in the Columns dropdown's "Hidden" list — they come back only
// via Reset. Stored as a plain key array; absent / unparseable reads as
// "nothing removed".
function loadColRemoved(tableId) {
  try { const v = JSON.parse(localStorage.getItem(COL_REMOVED_PREFIX + tableId)); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
}
function saveColRemoved(tableId, set) { localStorage.setItem(COL_REMOVED_PREFIX + tableId, JSON.stringify([...set])); }

// Combobox-style per-column filter. Holds an array of "picked" values that
// the row's column value must match (substring). A text input drives both
// free-text search and an autocomplete dropdown of unique column values
// gathered from the visible row set; pressing Enter adds the typed value
// as a free-text chip, clicking a suggestion adds it as a chip.
// Parse a colFilters value into normalized {picks, draft}. Backwards
// compatible with the older array-only and string forms.
function readFilterValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      picks: Array.isArray(value.picks) ? value.picks : [],
      draft: typeof value.draft === 'string' ? value.draft : '',
    };
  }
  if (Array.isArray(value)) return { picks: value, draft: '' };
  if (typeof value === 'string' && value.trim()) return { picks: [value.trim()], draft: '' };
  return { picks: [], draft: '' };
}
function writeFilterValue(picks, draft) {
  // Collapse to the simpler array form when there's no draft so the
  // shape stays clean for callers that haven't been updated.
  if (!draft) return picks;
  return { picks, draft };
}

// Hard cap on the dropdown list so a column with thousands of unique
// values doesn't ship a 10k-button popover. Past this, the footer
// nudges the user to type to narrow.
const FILTER_DROPDOWN_CAP = 500;

function ColumnFilterCell({ value, onChange, suggestions }) {
  const { picks, draft: incomingDraft } = readFilterValue(value);
  // We mirror the parent-controlled draft so typing feels instant
  // even when the parent re-render is async (e.g. inside a useMemo
  // chain). Sync down whenever the parent changes the draft.
  const [draft, setDraft] = useState(incomingDraft);
  useEffect(() => { setDraft(incomingDraft); }, [incomingDraft]);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const wrapRef = useRef(null);
  const dropdownRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(e) {
      // Closes when the click lands outside both the filter cell and
      // the portal-rendered dropdown. Without checking the dropdown
      // too, the mousedown on a value button would close the dropdown
      // before the click reaches it.
      const inWrap = wrapRef.current && wrapRef.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inWrap && !inDropdown) setOpen(false);
    }
    function reposition() {
      if (wrapRef.current) setAnchorRect(wrapRef.current.getBoundingClientRect());
    }
    document.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  function openDropdown() {
    if (wrapRef.current) setAnchorRect(wrapRef.current.getBoundingClientRect());
    setOpen(true);
  }

  const { matches, totalAvailable } = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const seen = new Set(picks.map(p => p.toLowerCase()));
    const out = [];
    let totalAvailable = 0;
    for (const s of suggestions) {
      const sl = s.toLowerCase();
      if (seen.has(sl)) continue;
      if (q && !sl.includes(q)) continue;
      totalAvailable += 1;
      if (out.length < FILTER_DROPDOWN_CAP) out.push(s);
    }
    return { matches: out, totalAvailable };
  }, [suggestions, draft, picks]);

  function pushDraft(next) {
    setDraft(next);
    onChange(writeFilterValue(picks, next));
  }
  function addPick(s) {
    const t = String(s || '').trim();
    if (!t) return;
    if (picks.some(p => p.toLowerCase() === t.toLowerCase())) {
      setDraft('');
      onChange(writeFilterValue(picks, ''));
      return;
    }
    setDraft('');
    onChange(writeFilterValue([...picks, t], ''));
  }
  function removePick(s) {
    onChange(writeFilterValue(picks.filter(p => p !== s), draft));
  }
  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // First match wins on Enter — picks the highlighted suggestion or
      // commits the typed text when nothing matches.
      if (matches.length > 0) addPick(matches[0]);
      else if (draft.trim()) addPick(draft);
    } else if (e.key === 'Backspace' && !draft && picks.length > 0) {
      removePick(picks[picks.length - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      setOpen(true);
    }
  }

  // Portal-rendered dropdown: the sticky table header / horizontal
  // scroll container both clip absolutely-positioned children, so the
  // list disappeared under the table body. Fixed-positioning against
  // viewport coordinates side-steps that and lets the list be wider
  // than the (often narrow) filter column.
  const dropdownStyle = anchorRect ? (() => {
    const minWidth = Math.max(anchorRect.width, 220);
    const left = Math.min(anchorRect.left, window.innerWidth - minWidth - 8);
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const flipAbove = spaceBelow < 200 && anchorRect.top > spaceBelow;
    return {
      position: 'fixed',
      top: flipAbove ? undefined : anchorRect.bottom + 1,
      bottom: flipAbove ? window.innerHeight - anchorRect.top + 1 : undefined,
      left,
      minWidth,
      maxWidth: Math.min(420, window.innerWidth - left - 8),
      maxHeight: flipAbove ? Math.min(320, anchorRect.top - 8) : Math.min(320, spaceBelow - 8),
      zIndex: 10000,
      background: '#fff',
      border: '1px solid var(--color-border)',
      borderRadius: 4,
      overflowY: 'auto',
      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
    };
  })() : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div
        onClick={openDropdown}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center',
          padding: '1px 3px',
          border: '1px solid var(--color-border)', borderRadius: 4,
          background: '#fff', minHeight: 22, cursor: 'text',
        }}
      >
        {picks.map(p => (
          <span
            key={p}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: '#DBEAFE', border: '1px solid #93C5FD', color: '#1E3A8A', borderRadius: 999, padding: '0 4px 0 6px', fontSize: '0.62rem', fontWeight: 600, lineHeight: 1.5, maxWidth: '100%' }}
            title={p}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{p}</span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); removePick(p); }}
              style={{ background: 'transparent', border: 'none', color: '#1E3A8A', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '0.85rem' }}
              title="Remove filter"
            >×</button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={e => { pushDraft(e.target.value); openDropdown(); }}
          onFocus={openDropdown}
          onKeyDown={onKeyDown}
          placeholder={picks.length === 0 ? 'Filter…' : ''}
          style={{ border: 'none', outline: 'none', flex: '1 0 60px', minWidth: 40, fontSize: '0.68rem', fontFamily: 'inherit', padding: '1px 2px', background: 'transparent' }}
        />
      </div>
      {open && dropdownStyle && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle}
          onMouseDown={e => e.preventDefault() /* keep input focused */}
        >
          {matches.length === 0 ? (
            <div style={{ padding: '6px 10px', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              {suggestions.length === 0 ? 'No values to filter by.' : 'No match — keep typing to filter.'}
            </div>
          ) : (
            <>
              {matches.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addPick(s)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F1F5F9'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  title={s}
                >{s}</button>
              ))}
              {totalAvailable > matches.length && (
                <div style={{ position: 'sticky', bottom: 0, padding: '4px 8px', fontSize: '0.65rem', color: 'var(--color-text-muted)', background: '#F8FAFC', borderTop: '1px solid var(--color-border-light)' }}>
                  Showing {matches.length} of {totalAvailable} — type to narrow.
                </div>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function ColumnToggle({ columns, visibleCols, onToggle, onRemove, removedCount = 0, alwaysVisible, colNames, onRename, onReorder, onResetOrder, removable, onResetColumns }) {
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [editName, setEditName] = useState('');
  // Drag-to-reorder state: the key being dragged and the key it's
  // currently hovering over (for the drop-position highlight).
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);
  // Removable mode tucks hidden columns into a collapsed section so the
  // main list only shows the columns in play; this toggles it open.
  const [showHidden, setShowHidden] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function startRename(col) {
    setEditingKey(col.key);
    setEditName(colNames[col.key] || col.label);
  }

  function saveRename() {
    if (editingKey && editName.trim()) {
      onRename(editingKey, editName.trim());
    }
    setEditingKey(null);
  }

  // Drop `dragKey` at the position of `targetKey`, emit the full new
  // key order to the parent.
  function handleDrop(targetKey) {
    setOverKey(null);
    const from = dragKey;
    setDragKey(null);
    if (!from || from === targetKey || !onReorder) return;
    const keys = columns.map(c => c.key);
    const fromIdx = keys.indexOf(from);
    const toIdx = keys.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    keys.splice(fromIdx, 1);
    keys.splice(toIdx, 0, from);
    onReorder(keys);
  }

  const labelOf = (col) => colNames[col.key] || col.label;

  // The editable name field, shared by both modes.
  function renderName(col) {
    return editingKey === col.key ? (
      <input
        className={styles.colRenameInput}
        value={editName}
        onChange={e => setEditName(e.target.value)}
        onBlur={saveRename}
        onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditingKey(null); }}
        autoFocus
        onClick={e => e.stopPropagation()}
      />
    ) : (
      <span className={styles.colToggleLabel} onDoubleClick={() => startRename(col)}>
        {labelOf(col) || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>(unnamed)</span>}
      </span>
    );
  }

  const dragHandle = (col) => onReorder && (
    <span
      draggable
      onDragStart={(e) => { setDragKey(col.key); e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { setDragKey(null); setOverKey(null); }}
      title="Drag to reorder"
      style={{ cursor: 'grab', color: 'var(--color-text-muted)', fontSize: '0.8rem', lineHeight: 1, userSelect: 'none', padding: '0 2px' }}
    >⠿</span>
  );

  const rowDragProps = (col) => onReorder ? {
    onDragOver: (e) => { e.preventDefault(); if (overKey !== col.key) setOverKey(col.key); },
    onDrop: () => handleDrop(col.key),
    style: {
      ...(dragKey === col.key ? { opacity: 0.4 } : null),
      ...(overKey === col.key && dragKey && dragKey !== col.key ? { borderTop: '2px solid var(--color-accent)' } : null),
    },
  } : {};

  // Active (shown) and hidden columns for removable mode. alwaysVisible
  // columns can never be removed, so they always live in the active list.
  const activeCols = removable ? columns.filter(c => visibleCols.has(c.key) || alwaysVisible?.includes(c.key)) : columns;
  const hiddenCols = removable ? columns.filter(c => !visibleCols.has(c.key) && !alwaysVisible?.includes(c.key)) : [];

  return (
    <div className={styles.colToggleWrap} ref={ref}>
      <button className={styles.colToggleBtn} onClick={() => setOpen(p => !p)}>
        Columns ({visibleCols.size}/{columns.length})
      </button>
      {open && (
        <div className={styles.colToggleDropdown}>
          {(onReorder || removable) && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '2px 6px 6px', borderBottom: '1px solid var(--color-border-light)', marginBottom: 4 }}>
              <span style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>
                {removable ? 'Drag ⠿ to reorder · Hide (restorable) or Remove (Reset only)' : 'Drag ⠿ to reorder · uncheck to hide'}
              </span>
              {(removable ? onResetColumns : onResetOrder) && (
                <button
                  type="button"
                  onClick={() => (removable ? onResetColumns() : onResetOrder())}
                  style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.62rem', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  title={removable
                    ? `Restore all columns (incl. ${removedCount} removed) and the default order`
                    : 'Restore the default column order'}
                >{removable ? `Reset${removedCount ? ` (${removedCount} removed)` : ''}` : 'Reset order'}</button>
              )}
            </div>
          )}

          {removable ? (
            <>
              {activeCols.map(col => {
                const locked = alwaysVisible?.includes(col.key);
                return (
                  <div key={col.key} className={styles.colToggleItem} {...rowDragProps(col)}>
                    {dragHandle(col)}
                    {renderName(col)}
                    {locked ? (
                      <span title="This column can't be hidden or removed" style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', padding: '0 2px' }}>🔒</span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          type="button"
                          onClick={() => onToggle(col.key)}
                          title="Hide this column — moves it to the Hidden list, where you can restore it with “+ Show”"
                          aria-label={`Hide ${labelOf(col)}`}
                          style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-muted)', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                        >Hide</button>
                        <button
                          type="button"
                          onClick={() => (onRemove ? onRemove(col.key) : onToggle(col.key))}
                          title="Remove this column from the table — it won’t show in the Hidden list. Restore it with Reset."
                          aria-label={`Remove ${labelOf(col)}`}
                          style={{ background: 'transparent', border: '1px solid #FECACA', borderRadius: 4, fontSize: '0.62rem', fontWeight: 600, color: '#B91C1C', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                        >Remove</button>
                      </span>
                    )}
                  </div>
                );
              })}

              {hiddenCols.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowHidden(s => !s)}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', background: 'var(--color-surface-alt)', border: 'none', borderTop: '1px solid var(--color-border-light)', marginTop: 4, padding: '0.35rem 0.5rem', fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <span style={{ fontSize: '0.6rem' }}>{showHidden ? '▾' : '▸'}</span>
                    Hidden columns ({hiddenCols.length})
                  </button>
                  {showHidden && hiddenCols.map(col => (
                    <div key={col.key} className={styles.colToggleItem} style={{ opacity: 0.85 }}>
                      <span className={styles.colToggleLabel} style={{ color: 'var(--color-text-muted)' }}>{labelOf(col)}</span>
                      <button
                        type="button"
                        onClick={() => onToggle(col.key)}
                        title="Restore this column"
                        style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-accent)', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                      >+ Show</button>
                    </div>
                  ))}
                </>
              )}
            </>
          ) : (
            columns.map(col => (
              <div key={col.key} className={styles.colToggleItem} {...rowDragProps(col)}>
                {dragHandle(col)}
                <input
                  type="checkbox"
                  checked={visibleCols.has(col.key)}
                  onChange={() => onToggle(col.key)}
                  disabled={alwaysVisible?.includes(col.key)}
                />
                {renderName(col)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Firestore rejects map field names that both start AND end with "__"
// (e.g. UploadedListView's helper columns __select__, __myAccountsList__).
// We prefix those keys with a sentinel before persisting and strip it
// back off on read so the rest of the app sees the original key.
const REMOTE_KEY_PREFIX = '_x_';
function encodeRemoteKey(k) {
  return /^__.*__$/.test(k) ? REMOTE_KEY_PREFIX + k : k;
}
function decodeRemoteKey(k) {
  return k.startsWith(REMOTE_KEY_PREFIX) ? k.slice(REMOTE_KEY_PREFIX.length) : k;
}
function encodeRemoteMap(m) {
  if (!m || typeof m !== 'object') return m;
  const out = {};
  for (const [k, v] of Object.entries(m)) out[encodeRemoteKey(k)] = v;
  return out;
}
function decodeRemoteMap(m) {
  if (!m || typeof m !== 'object') return m;
  const out = {};
  for (const [k, v] of Object.entries(m)) out[decodeRemoteKey(k)] = v;
  return out;
}

// When settings + updateSettings are provided, column prefs (widths,
// visibility, renames) are mirrored to Firestore at
// settings.tablePrefs[tableId]. Localstorage continues to be written
// as a fast/offline mirror. This makes the prefs survive a browser
// "Clear site data" — Firestore reseeds localStorage on the next
// load. Tables not wired to settings keep the legacy localStorage-only
// behavior.
function persistPrefs(tableId, settings, updateSettings, prefsUpdate) {
  if (prefsUpdate.widths !== undefined) saveColWidths(tableId, prefsUpdate.widths);
  if (prefsUpdate.visible !== undefined) saveColVisible(tableId, prefsUpdate.visible);
  if (prefsUpdate.names !== undefined) saveColNames(tableId, prefsUpdate.names);
  if (prefsUpdate.order !== undefined) saveColOrder(tableId, prefsUpdate.order);
  if (prefsUpdate.removed !== undefined) saveColRemoved(tableId, prefsUpdate.removed);
  if (!settings || !updateSettings || !tableId) return;
  const current = settings.tablePrefs?.[tableId] || {};
  const nextEntry = { ...current };
  if (prefsUpdate.widths !== undefined) nextEntry.widths = encodeRemoteMap(prefsUpdate.widths);
  if (prefsUpdate.visible !== undefined) nextEntry.visible = [...prefsUpdate.visible];
  if (prefsUpdate.names !== undefined) nextEntry.names = encodeRemoteMap(prefsUpdate.names);
  // Order is a plain array of column keys — stored as-is (no map-key
  // encoding needed, and keys like `_select` are fine as array values).
  if (prefsUpdate.order !== undefined) nextEntry.order = [...prefsUpdate.order];
  if (prefsUpdate.removed !== undefined) nextEntry.removed = [...prefsUpdate.removed];
  updateSettings({
    tablePrefs: { ...(settings.tablePrefs || {}), [tableId]: nextEntry },
  });
}

/**
 * Reusable data table with resizable columns and column visibility toggle.
 *
 * Props:
 *   tableId      - unique string for persisting settings (e.g. 'main', 'accounts', 'hubspot')
 *   columns      - array of { key, label, defaultWidth, render(row) }
 *   rows         - array of data objects
 *   onSort       - (key) => void, optional
 *   sortConfig   - { key, direction }, optional
 *   alwaysVisible - array of column keys that can't be hidden
 *   onRowClick   - (row) => void, optional
 *   emptyMessage - string
 */
export function DataTable({
  tableId,
  columns,
  rows,
  onSort: externalSort,
  sortConfig: externalSortConfig,
  defaultSort,
  // Imperative sort trigger: { key, direction, nonce }. Bumping nonce
  // re-applies the given sort through the same path as a header click
  // (incl. the freeze snapshot). Lets a parent re-rank on demand
  // without owning sort state. Ignored when an external sort is wired.
  sortSignal,
  alwaysVisible = [],
  onRowClick,
  rowClassName,
  rowStyle,
  // Inline expansion: when both are provided, rows whose id is in
  // expandedRowIds get a follow-up <tr> rendered immediately below
  // them with the JSX returned by renderExpansion(row). Virtualization
  // is disabled in this mode since expansion rows have variable height.
  expandedRowIds,
  renderExpansion,
  emptyMessage = 'No data found',
  exportFileName,
  exportPrimarySheetName,
  // Extra sheets appended to the exported workbook. Each entry is
  // { name, rows: [{ header: value }] }. Column widths auto-fit from
  // the row keys.
  exportExtraSheets,
  // When provided, clicking Export Excel calls onExport with the full
  // export context instead of running the default XLSX writer. Lets a
  // consumer render a fully-branded workbook (Schneider Electric
  // formatting, etc.) while reusing the table's sort / visibility /
  // rename state.
  onExport,
  // When true, every visible column gets a compact text input under
  // its header. Rows are filtered (substring, case-insensitive) by
  // the raw cell value for each column that has a non-empty filter.
  enableColumnFilters = false,
  // Fires with the rows currently passing the in-table column filters,
  // so a parent can sync its own "select all visible" / "rows on
  // screen" UI against the same set the user sees.
  onFilteredRowsChange,
  // Opt out of fixed-rowHeight virtualization. Consumers whose rows
  // can grow taller than a single line (Opps 2's Alt+Enter Next Steps,
  // Notes, etc.) set this so the table renders every row instead — the
  // JS spacer math assumes a constant row height, and a single tall
  // row breaks scrolling for everything below it. The browser still
  // skips painting off-screen rows via `content-visibility: auto`, so
  // scroll perf stays close to the virtualized path.
  variableRowHeight = false,
  // Optional Firestore-backed settings store. When provided, column
  // prefs (widths, visibility, renames) persist to settings.tablePrefs[tableId]
  // in addition to localStorage so they survive a clear-site-data.
  settings,
  updateSettings,
  // When true, the Columns dropdown lets the user remove columns (× →
  // collapsed "Hidden columns" section with restore) instead of the
  // classic checkbox show/hide list. Visibility still drives what
  // renders; this is purely a friendlier remove/restore affordance.
  removableColumns = false,
}) {
  const rawRemotePrefs = settings?.tablePrefs?.[tableId];
  const remotePrefs = useMemo(() => {
    if (!rawRemotePrefs) return rawRemotePrefs;
    return {
      ...rawRemotePrefs,
      widths: decodeRemoteMap(rawRemotePrefs.widths),
      names: decodeRemoteMap(rawRemotePrefs.names),
    };
  }, [rawRemotePrefs]);
  // settings._lastWriteAt is the canonical "Firestore subscription has
  // produced data" signal — it's stamped by every saveUserSettings call.
  // We use it to distinguish "Firestore has no entry for this table"
  // (don't sync, leave defaults / localStorage) from "Firestore is
  // still loading" (don't do anything; wait).
  const settingsLoaded = !!(settings && settings._lastWriteAt);
  const [colWidths, setColWidths] = useState(() => remotePrefs?.widths || loadColWidths(tableId));
  const [visibleCols, setVisibleCols] = useState(() => (
    // Same empty-array safeguard as loadColVisible: an empty Firestore
    // set has historically rendered the table as blank, so fall through
    // to the local default (= every column visible).
    Array.isArray(remotePrefs?.visible) && remotePrefs.visible.length > 0
      ? new Set(remotePrefs.visible)
      : loadColVisible(tableId, columns.map(c => c.key))
  ));
  const [colNames, setColNames] = useState(() => remotePrefs?.names || loadColNames(tableId));
  const [colOrder, setColOrder] = useState(() => (
    Array.isArray(remotePrefs?.order) ? remotePrefs.order : loadColOrder(tableId)
  ));
  const [removedCols, setRemovedCols] = useState(() => (
    Array.isArray(remotePrefs?.removed) ? new Set(remotePrefs.removed) : loadColRemoved(tableId)
  ));
  const [colFilters, setColFilters] = useState({});
  const resizingRef = useRef(null);

  // Columns the user hasn't removed from the layout. Removed columns
  // (removableColumns mode) are dropped here so they don't render, don't
  // export, and don't appear in the Columns dropdown — they return only
  // via Reset. Tables without removable mode never populate removedCols,
  // so this is a no-op for them.
  const presentColumns = useMemo(
    () => (removedCols.size === 0 ? columns : columns.filter(c => !removedCols.has(c.key))),
    [columns, removedCols],
  );

  // The columns in the user's saved order (defaults to prop order). All
  // rendering — header, body, visibility list, export — runs off this.
  const orderedColumns = useMemo(() => orderColumns(presentColumns, colOrder), [presentColumns, colOrder]);

  // Sync local state when Firestore-backed prefs arrive or change on
  // another device. Stringify-compare so we don't churn state when the
  // values are equivalent. Only acts once settings is loaded — guards
  // against an early-render where settings={} reads as "no entry"
  // and races with a later real value.
  useEffect(() => {
    if (!settingsLoaded) return;
    if (!remotePrefs) return;
    if (remotePrefs.widths && JSON.stringify(remotePrefs.widths) !== JSON.stringify(colWidths)) {
      setColWidths(remotePrefs.widths);
    }
    // Skip empty-array remotes for the same reason loadColVisible
    // does: a synced "nothing visible" state would blank the table.
    if (Array.isArray(remotePrefs.visible) && remotePrefs.visible.length > 0) {
      const incoming = new Set(remotePrefs.visible);
      const same = incoming.size === visibleCols.size && [...incoming].every(k => visibleCols.has(k));
      if (!same) setVisibleCols(incoming);
    }
    if (remotePrefs.names && JSON.stringify(remotePrefs.names) !== JSON.stringify(colNames)) {
      setColNames(remotePrefs.names);
    }
    if (Array.isArray(remotePrefs.order) && JSON.stringify(remotePrefs.order) !== JSON.stringify(colOrder)) {
      setColOrder(remotePrefs.order);
    }
    if (Array.isArray(remotePrefs.removed)) {
      const incoming = new Set(remotePrefs.removed);
      const same = incoming.size === removedCols.size && [...incoming].every(k => removedCols.has(k));
      if (!same) setRemovedCols(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, remotePrefs]);

  function reorderCols(nextKeys) {
    setColOrder(nextKeys);
    persistPrefs(tableId, settings, updateSettings, { order: nextKeys });
  }
  function resetColOrder() {
    setColOrder([]);
    persistPrefs(tableId, settings, updateSettings, { order: [] });
  }
  // Removable mode's Reset: restore every column (all visible, none
  // removed) and the default order in one go.
  function resetColumns() {
    const allKeys = new Set(columns.map(c => c.key));
    const emptyRemoved = new Set();
    setVisibleCols(allKeys);
    setColOrder([]);
    setRemovedCols(emptyRemoved);
    persistPrefs(tableId, settings, updateSettings, { visible: allKeys, order: [], removed: emptyRemoved });
  }

  function renameCol(key, name) {
    setColNames(prev => {
      const next = { ...prev, [key]: name };
      persistPrefs(tableId, settings, updateSettings, { names: next });
      return next;
    });
  }

  // Built-in sort state (used when no external sort is provided)
  const [internalSort, setInternalSort] = useState(() => ({
    key: defaultSort?.key ?? null,
    direction: defaultSort?.direction === 'desc' ? 'desc' : 'asc',
  }));
  const sortConfig = externalSortConfig || internalSort;

  // Snapshot of row-id order captured when the user sorts by a column
  // flagged `freezeSortOrder`. While the snapshot is active, sortedRows
  // re-uses this order instead of re-running the comparator — so a
  // value edit that would otherwise re-rank the row (e.g. typing into
  // Follow Up while sorted by the computed Call In column) leaves the
  // row in place. Clicking the same header again resnapshots.
  const [sortSnapshot, setSortSnapshot] = useState(null);

  function applySort(key, direction) {
    setInternalSort({ key, direction });
    const col = colByKey.get(key);
    if (col?.freezeSortOrder) {
      const sortGetter = col.getSortValue;
      const sorted = [...filteredRows].sort((a, b) => {
        let aVal = sortGetter ? sortGetter(a) : a[key];
        let bVal = sortGetter ? sortGetter(b) : b[key];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        const aNum = parseFloat(String(aVal).replace(/[,$%]/g, ''));
        const bNum = parseFloat(String(bVal).replace(/[,$%]/g, ''));
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return direction === 'asc' ? aNum - bNum : bNum - aNum;
        }
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
        return 0;
      });
      setSortSnapshot({
        key, direction,
        ids: sorted.map(r => (r?.id != null ? String(r.id) : null)).filter(Boolean),
      });
    } else {
      setSortSnapshot(null);
    }
  }

  function handleSort(key) {
    if (externalSort) {
      externalSort(key);
      return;
    }
    const isSame = internalSort.key === key;
    const nextDirection = isSame && internalSort.direction === 'asc' ? 'desc' : 'asc';
    applySort(key, nextDirection);
  }

  // Lets a parent imperatively trigger a sort (e.g. re-rank by Call In
  // after an edit) without taking over sort state. The parent bumps
  // `sortSignal.nonce` to fire; we apply the requested key + direction
  // through the same path as a header click, including the
  // freeze-snapshot capture for `freezeSortOrder` columns. Ignored when
  // an external sort controls the table.
  const lastSortNonce = useRef(sortSignal?.nonce);
  useEffect(() => {
    if (externalSort || externalSortConfig) return;
    const nonce = sortSignal?.nonce;
    if (nonce == null || nonce === lastSortNonce.current) return;
    lastSortNonce.current = nonce;
    if (sortSignal.key) {
      applySort(sortSignal.key, sortSignal.direction === 'desc' ? 'desc' : 'asc');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortSignal?.nonce]);

  // Sort rows internally if no external sort.
  // Apply per-column filters on top of the externally-filtered rows prop.
  // Each colFilters[key] is either a string (legacy) or array of strings
  // (chips from ColumnFilterCell). A row passes if, for each filtered
  // column, the cell value (case-insensitive) contains at least one of
  // the picked values. Columns that supply getFilterValue use that
  // instead of row[key] so derived/custom-render columns can still
  // filter on what the user actually sees.
  const colByKey = useMemo(() => {
    const m = new Map();
    for (const c of columns) m.set(c.key, c);
    return m;
  }, [columns]);
  const filteredRows = useMemo(() => {
    const active = [];
    for (const [key, raw] of Object.entries(colFilters)) {
      let picks = [];
      let draft = '';
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        if (Array.isArray(raw.picks)) picks = raw.picks.map(s => String(s || '').trim()).filter(Boolean);
        if (typeof raw.draft === 'string') draft = raw.draft.trim();
      } else if (Array.isArray(raw)) {
        picks = raw.map(s => String(s || '').trim()).filter(Boolean);
      } else if (typeof raw === 'string' && raw.trim()) {
        picks = [raw.trim()];
      }
      if (picks.length > 0 || draft.length > 0) active.push({ key, picks, draft });
    }
    if (active.length === 0) return rows;
    return rows.filter(row => {
      for (const { key, picks, draft } of active) {
        const col = colByKey.get(key);
        const getter = col?.getFilterValue;
        const raw = getter ? getter(row) : row[key];
        const hay = String(raw ?? '').toLowerCase();
        // Combine committed picks (OR) with the live-typed draft (also OR).
        // The row passes the column's filter if any pick matches as a
        // substring OR the draft matches as a substring.
        const candidates = [...picks];
        if (draft) candidates.push(draft);
        if (!candidates.some(p => hay.includes(p.toLowerCase()))) return false;
      }
      return true;
    });
  }, [rows, colFilters, colByKey]);

  // Notify the consumer whenever the filtered-row set changes so it can
  // sync its own "select all visible" state against what's actually on
  // screen. Skipped when the prop isn't provided.
  useEffect(() => {
    if (onFilteredRowsChange) onFilteredRowsChange(filteredRows);
  }, [filteredRows, onFilteredRowsChange]);

  // Distinct values per column from the current row pool, used to feed
  // the column-filter autocomplete suggestions. Computed lazily and
  // cached so opening the dropdown is cheap on big lists.
  const filterSuggestions = useMemo(() => {
    const cache = new Map();
    return (key) => {
      if (cache.has(key)) return cache.get(key);
      const col = colByKey.get(key);
      const getter = col?.getFilterValue;
      const seen = new Set();
      const out = [];
      for (const row of rows) {
        const raw = getter ? getter(row) : row[key];
        const v = String(raw ?? '').trim();
        if (!v) continue;
        const lower = v.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        out.push(v);
      }
      out.sort((a, b) => a.localeCompare(b));
      cache.set(key, out);
      return out;
    };
  }, [rows, colByKey]);

  const sortedRows = useMemo(() => {
    if (externalSortConfig || !internalSort.key) return filteredRows;
    // When the active sort was captured against a `freezeSortOrder`
    // column, use the snapshotted ID order rather than re-running the
    // comparator. New rows (not in the snapshot) tail the list so they
    // remain visible until the next manual resort.
    if (
      sortSnapshot
      && sortSnapshot.key === internalSort.key
      && sortSnapshot.direction === internalSort.direction
    ) {
      const order = new Map();
      sortSnapshot.ids.forEach((id, i) => order.set(id, i));
      const fallback = sortSnapshot.ids.length;
      return [...filteredRows].sort((a, b) => {
        const ai = order.has(String(a?.id)) ? order.get(String(a.id)) : fallback;
        const bi = order.has(String(b?.id)) ? order.get(String(b.id)) : fallback;
        return ai - bi;
      });
    }
    // Columns can supply a getSortValue(row) that returns a number
    // (e.g. epoch ms for a date) — overrides the default raw-cell
    // numeric/string comparison so date columns sort chronologically
    // instead of as alphabetical text on the displayed format.
    const col = colByKey.get(internalSort.key);
    const sortGetter = col?.getSortValue;
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      let aVal = sortGetter ? sortGetter(a) : a[internalSort.key];
      let bVal = sortGetter ? sortGetter(b) : b[internalSort.key];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      // Try numeric comparison
      const aNum = parseFloat(String(aVal).replace(/[,$%]/g, ''));
      const bNum = parseFloat(String(bVal).replace(/[,$%]/g, ''));
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return internalSort.direction === 'asc' ? aNum - bNum : bNum - aNum;
      }
      // String comparison
      aVal = String(aVal).toLowerCase();
      bVal = String(bVal).toLowerCase();
      if (aVal < bVal) return internalSort.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return internalSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredRows, internalSort, externalSortConfig, colByKey, sortSnapshot]);

  const headerRef = useRef(null);
  const bodyRef = useRef(null);
  const firstRowRef = useRef(null);

  // Virtualization. Only render rows in (or near) the viewport when the
  // dataset is large enough that the savings outweigh the wrapper-row
  // overhead. Row height is measured from the first rendered row so the
  // spacers stay aligned even if the design's padding changes. Below
  // VIRTUALIZE_THRESHOLD, behavior is identical to the legacy table.
  const VIRTUALIZE_THRESHOLD = 50;
  const ROW_BUFFER = 8;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(33);

  function handleBodyScroll(e) {
    if (headerRef.current) headerRef.current.scrollLeft = e.target.scrollLeft;
    setScrollTop(e.target.scrollTop);
  }

  useEffect(() => {
    if (!bodyRef.current) return;
    const el = bodyRef.current;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Measure row height once on first paint and freeze it. Re-measuring
  // on every render (or only ratcheting up) breaks scrolling on tables
  // with variable-height rows: when the user scrolls past a tall row
  // (e.g. an Opps 2 Next Steps cell with several Alt+Enter lines), that
  // row becomes the new firstRowRef, the estimate balloons, and the
  // virtualization spacer math drops the visible window into a "ghost"
  // zone where no rendered rows live. A single measurement avoids both
  // that bug and the original oscillation / infinite re-render loop the
  // ratcheting was meant to dodge — at the cost of slight under- or
  // over-estimation if the very first row isn't representative.
  const rowHeightMeasuredRef = useRef(false);
  useEffect(() => {
    if (rowHeightMeasuredRef.current) return;
    if (!firstRowRef.current) return;
    const h = firstRowRef.current.offsetHeight;
    if (h > 0) {
      rowHeightMeasuredRef.current = true;
      if (Math.abs(h - rowHeight) > 0.5) setRowHeight(h);
    }
  });

  const getWidth = (col) => colWidths[col.key] || col.defaultWidth || 120;
  // Filter to user-visible columns. Safety net: when the persisted
  // visibility set was saved against a different column lineup (e.g.
  // an older Firestore-synced list whose keys don't match the current
  // tableId), the filter can shrink to empty — at which point the
  // table renders as a blank panel even though `visibleCols.size`
  // looks healthy. Fall back to showing every column so the data is
  // never invisible. The user's toggle still works on the next
  // interaction; this just refuses to render an unusable empty state.
  let visibleColumns = orderedColumns.filter(c => visibleCols.has(c.key) || alwaysVisible.includes(c.key));
  if (visibleColumns.length === 0 && orderedColumns.length > 0) visibleColumns = orderedColumns;

  function toggleCol(key) {
    if (alwaysVisible.includes(key)) return;
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      persistPrefs(tableId, settings, updateSettings, { visible: next });
      return next;
    });
  }

  // Remove a column from the layout entirely (removableColumns mode).
  // Unlike Hide it doesn't land in the restorable "Hidden" list — Reset
  // is the only way back. We also drop it from the visible set so a later
  // Reset (which restores everything visible) shows it again rather than
  // resurrecting it hidden.
  function removeCol(key) {
    if (alwaysVisible.includes(key)) return;
    const nextVisible = new Set(visibleCols); nextVisible.delete(key);
    setVisibleCols(nextVisible);
    // Drop any active filter on the column so it doesn't keep silently
    // filtering rows once its header (and filter input) are gone.
    setColFilters(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev }; delete next[key];
      return next;
    });
    setRemovedCols(prev => {
      const next = new Set(prev); next.add(key);
      persistPrefs(tableId, settings, updateSettings, { removed: next, visible: nextVisible });
      return next;
    });
  }

  const handleResizeStart = useCallback((e, colKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colKey] || columns.find(c => c.key === colKey)?.defaultWidth || 120;
    resizingRef.current = colKey;

    function onMouseMove(ev) {
      const diff = ev.clientX - startX;
      const newWidth = Math.max(50, startWidth + diff);
      setColWidths(prev => {
        const next = { ...prev, [colKey]: newWidth };
        persistPrefs(tableId, settings, updateSettings, { widths: next });
        return next;
      });
    }

    function onMouseUp() {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths, columns, tableId, settings, updateSettings]);

  return (
    <div className={styles.outerWrap}>
      <div className={styles.toolbar}>
        <ColumnToggle columns={orderedColumns} visibleCols={visibleCols} onToggle={toggleCol} onRemove={removeCol} removedCount={removedCols.size} alwaysVisible={alwaysVisible} colNames={colNames} onRename={renameCol} onReorder={reorderCols} onResetOrder={resetColOrder} removable={removableColumns} onResetColumns={resetColumns} />
        <button className={styles.resetBtn} onClick={() => { setColWidths({}); persistPrefs(tableId, settings, updateSettings, { widths: {} }); }}>
          Reset widths
        </button>
        <button className={styles.exportBtn} onClick={async () => {
          if (typeof onExport === 'function') {
            onExport({
              columns: visibleColumns,
              rows: sortedRows,
              colNames,
              extraSheets: exportExtraSheets,
            });
            return;
          }
          const XLSX = await import('xlsx');
          const exportCols = visibleColumns;
          const data = sortedRows.map(row => {
            const obj = {};
            for (const col of exportCols) {
              const label = colNames[col.key] || col.label;
              let val;
              // Columns with derived data (e.g. values stored under
              // __electricCost__ while the column key is electricCost)
              // can provide an exportValue mapper so the export matches
              // what's on screen.
              if (typeof col.exportValue === 'function') {
                val = col.exportValue(row);
              } else {
                val = row[col.key];
              }
              obj[label] = Array.isArray(val) ? val.join(', ') : (val ?? '');
            }
            return obj;
          });
          const ws = XLSX.utils.json_to_sheet(data);
          ws['!cols'] = exportCols.map(col => ({ wch: Math.max((colNames[col.key] || col.label).length, 12) }));
          const wb = XLSX.utils.book_new();
          const primarySheetName = (exportPrimarySheetName || exportFileName || tableId || 'Export').replace(/[\\/:*?\[\]]+/g, '-').slice(0, 31);
          XLSX.utils.book_append_sheet(wb, ws, primarySheetName);
          if (Array.isArray(exportExtraSheets)) {
            for (const extra of exportExtraSheets) {
              if (!extra || !Array.isArray(extra.rows) || extra.rows.length === 0) continue;
              const extraWs = XLSX.utils.json_to_sheet(extra.rows);
              const extraHeaders = Object.keys(extra.rows[0]);
              extraWs['!cols'] = extraHeaders.map(h => ({ wch: Math.max(h.length + 2, 14) }));
              const extraName = String(extra.name || 'Sheet').replace(/[\\/:*?\[\]]+/g, '-').slice(0, 31);
              XLSX.utils.book_append_sheet(wb, extraWs, extraName);
            }
          }
          const safeName = (exportFileName || tableId || 'export').replace(/[\\/:*?"<>|]+/g, '-');
          XLSX.writeFile(wb, `${safeName} - ${new Date().toISOString().slice(0, 10)}.xlsx`);
        }}>
          Export Excel
        </button>
        {/* Defensive row-count indicator: surfaces what the table
            actually sees right next to the export controls. If the
            parent says 'showing 42' but this badge shows '0 rows',
            the bug is upstream of the table; if it shows '42 rows'
            but the body is blank, the bug is in the body render. */}
        <span
          title={`${sortedRows.length} of ${rows.length} rows rendered`}
          style={{ marginLeft: 'auto', padding: '0.25rem 0.5rem', borderRadius: 4, background: sortedRows.length === 0 ? '#FEF3C7' : '#F1F5F9', color: sortedRows.length === 0 ? '#92400E' : '#475569', fontSize: '0.65rem', fontWeight: 600 }}
        >
          {sortedRows.length} row{sortedRows.length === 1 ? '' : 's'}
        </span>
      </div>
      {/* Always render the table header + body shell so the column
          headers stay visible when a search / column filter zeros out
          the rows — users need to see which columns exist (and clear
          their filter) instead of staring at a blank panel. */}
      <>
        <div className={styles.headerWrap} ref={headerRef}>
            <table className={styles.table} style={{ tableLayout: 'fixed', width: visibleColumns.reduce((s, c) => s + getWidth(c), 0) }}>
              <colgroup>
                {visibleColumns.map(col => (
                  <col key={col.key} style={{ width: getWidth(col) }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {visibleColumns.map(col => {
                    const headerLabel = colNames[col.key] || col.label;
                    // Native hover tooltip on every header so users can
                    // read the full column name even when the cell text
                    // is truncated by the fixed column width.
                    const headerTitle = typeof headerLabel === 'string' ? headerLabel : undefined;
                    return (
                    <th
                      key={col.key}
                      style={{ width: getWidth(col), position: 'relative' }}
                      onClick={() => handleSort(col.key)}
                      className={col.sticky ? styles.stickyCol : undefined}
                      title={headerTitle}
                    >
                      {col.renderHeader
                        ? col.renderHeader(headerLabel)
                        : headerLabel}
                      {sortConfig?.key === col.key && (
                        <span className={styles.sortArrow}>
                          {sortConfig.direction === 'asc' ? '\u25B2' : '\u25BC'}
                        </span>
                      )}
                      <span
                        className={styles.resizeHandle}
                        onMouseDown={e => handleResizeStart(e, col.key)}
                        onClick={e => e.stopPropagation()}
                      />
                    </th>
                    );
                  })}
                </tr>
                {enableColumnFilters && (
                  <tr>
                    {visibleColumns.map(col => {
                      // Skip filtering on the leftmost helper / select / row-action
                      // columns. Their key starts with "_" by convention.
                      const filterable = !String(col.key || '').startsWith('_') || !!col.getFilterValue;
                      return (
                        <th
                          key={col.key}
                          style={{ width: getWidth(col), padding: '2px 4px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border-light)' }}
                          onClick={e => e.stopPropagation()}
                          className={col.sticky ? styles.stickyCol : undefined}
                        >
                          {filterable ? (
                            <ColumnFilterCell
                              value={colFilters[col.key]}
                              onChange={(next) => setColFilters(prev => {
                                const out = { ...prev };
                                if (Array.isArray(next) && next.length === 0) delete out[col.key];
                                else out[col.key] = next;
                                return out;
                              })}
                              suggestions={filterSuggestions(col.key)}
                            />
                          ) : null}
                        </th>
                      );
                    })}
                  </tr>
                )}
              </thead>
            </table>
          </div>
          {sortedRows.length === 0 ? (
            // Wrap the empty message in a scrollable container the
            // same width as the column total so horizontal scrolling
            // still works when a filter narrows the view to zero rows
            // (the user can otherwise lose access to off-screen
            // columns just because no rows match the current filter).
            // Syncs scrollLeft to the header so the column titles
            // track the user's pan even with no body rows.
            <div className={styles.scrollWrap} ref={bodyRef} onScroll={handleBodyScroll}>
              <div style={{ minWidth: visibleColumns.reduce((s, c) => s + getWidth(c), 0) }}>
                <div className={styles.empty}>{emptyMessage}</div>
              </div>
            </div>
          ) : (() => {
            const total = sortedRows.length;
            const expandable = typeof renderExpansion === 'function';
            const expandedSet = expandable
              ? (expandedRowIds instanceof Set ? expandedRowIds : new Set(expandedRowIds || []))
              : null;
            // Expansion rows have variable height and would corrupt the
            // fixed-rowHeight virtualization math; render every row when
            // expansion is enabled.
            const virtualize = !expandable && !variableRowHeight && total > VIRTUALIZE_THRESHOLD && rowHeight > 0;
            let startIdx = 0;
            let endIdx = total;
            if (virtualize) {
              const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
              startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - ROW_BUFFER);
              endIdx = Math.min(total, startIdx + visibleCount + ROW_BUFFER * 2);
            }
            let topPad = virtualize ? startIdx * rowHeight : 0;
            let bottomPad = virtualize ? Math.max(0, (total - endIdx) * rowHeight) : 0;
            let visibleRows = virtualize ? sortedRows.slice(startIdx, endIdx) : sortedRows;
            // Belt-and-braces: if the virtualization math ever produces
            // an empty slice while data exists (stale scrollTop after
            // a dataset shrinks, weird rowHeight measurement, etc.),
            // render everything rather than show a blank body.
            if (visibleRows.length === 0 && total > 0) {
              visibleRows = sortedRows;
              topPad = 0;
              bottomPad = 0;
            }
            return (
              <div className={styles.scrollWrap} ref={bodyRef} onScroll={handleBodyScroll}>
                <table className={styles.table} style={{ tableLayout: 'fixed', width: visibleColumns.reduce((s, c) => s + getWidth(c), 0) }}>
                  <colgroup>
                    {visibleColumns.map(col => (
                      <col key={col.key} style={{ width: getWidth(col) }} />
                    ))}
                  </colgroup>
                  <tbody>
                    {topPad > 0 && (
                      <tr aria-hidden="true" style={{ height: topPad }}>
                        <td colSpan={visibleColumns.length} style={{ padding: 0, border: 'none' }} />
                      </tr>
                    )}
                    {visibleRows.map((row, ri) => {
                      const absoluteIdx = startIdx + ri;
                      const rowKey = row.id ?? absoluteIdx;
                      // Compute the rowStyle once and apply it to both
                      // the <tr> AND every <td>: tr-level backgrounds
                      // can't tint cells whose CSS sets an explicit
                      // background (e.g. the sticky Account column), so
                      // mirroring the style onto each cell guarantees
                      // visible row tints on `.stickyCol` too.
                      const computedRowStyle = rowStyle ? rowStyle(row) : undefined;
                      // In variable-row-height mode we render every row
                      // and let the browser skip painting the ones off
                      // screen via content-visibility. The reserved
                      // ~33px keeps the scrollbar accurate before each
                      // row is laid out.
                      const variableRowStyle = variableRowHeight
                        ? { contentVisibility: 'auto', containIntrinsicSize: '0 33px' }
                        : undefined;
                      const rowTr = (
                        <tr
                          key={expandable ? `r:${rowKey}` : rowKey}
                          ref={ri === 0 ? firstRowRef : undefined}
                          className={rowClassName ? rowClassName(row) : undefined}
                          onClick={onRowClick ? () => onRowClick(row) : undefined}
                          style={{ ...(onRowClick ? { cursor: 'pointer' } : undefined), ...variableRowStyle, ...computedRowStyle }}
                        >
                          {visibleColumns.map(col => (
                            <td
                              key={col.key}
                              className={col.sticky ? styles.stickyCol : undefined}
                              style={computedRowStyle}
                            >
                              {col.render ? col.render(row) : (row[col.key] ?? '—')}
                            </td>
                          ))}
                        </tr>
                      );
                      if (!expandable) return rowTr;
                      const isExpanded = expandedSet.has(row.id);
                      // Two adjacent <tr>s when expanded; React handles
                      // a returned array directly inside tbody.
                      return isExpanded
                        ? [
                            rowTr,
                            (
                              <tr key={`x:${rowKey}`}>
                                <td colSpan={visibleColumns.length} style={{ padding: 0, background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
                                  {renderExpansion(row)}
                                </td>
                              </tr>
                            ),
                          ]
                        : rowTr;
                    })}
                    {bottomPad > 0 && (
                      <tr aria-hidden="true" style={{ height: bottomPad }}>
                        <td colSpan={visibleColumns.length} style={{ padding: 0, border: 'none' }} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </>
    </div>
  );
}
````

### src/components/common/DataTable.module.css

````css
.outerWrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.headerWrap {
  flex-shrink: 0;
  overflow: hidden;
  background: var(--color-surface-alt);
  border-bottom: 2px solid var(--color-border);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border-light);
  flex-shrink: 0;
}

.colToggleWrap {
  position: relative;
}

.colToggleBtn {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  font-size: var(--font-size-xs);
  font-weight: 500;
  font-family: inherit;
  color: var(--color-text-secondary);
  transition: border-color 0.15s;
}

.colToggleBtn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.colToggleDropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 0.4rem;
  min-width: 180px;
  max-height: 320px;
  overflow-y: auto;
  z-index: 50;
}

.colToggleItem {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.5rem;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.colToggleItem:hover {
  background: var(--color-surface-alt);
}

.colToggleLabel {
  flex: 1;
  cursor: default;
}

.colToggleLabel:hover {
  text-decoration: underline dotted;
}

.colRenameInput {
  flex: 1;
  padding: 0.15rem 0.3rem;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-family: inherit;
  color: var(--color-text);
  min-width: 0;
}

.colRenameInput:focus {
  outline: none;
}

.colToggleItem input {
  accent-color: var(--color-accent);
}

.colToggleItem input:disabled {
  opacity: 0.4;
}

.resetBtn {
  background: none;
  border: none;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-family: inherit;
  padding: 0.3rem 0.5rem;
}

.resetBtn:hover {
  color: var(--color-accent);
}

.exportBtn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  font-weight: 500;
  font-family: inherit;
  color: var(--color-text-secondary);
  padding: 0.3rem 0.6rem;
  cursor: pointer;
  margin-left: auto;
  transition: border-color 0.15s, color 0.15s;
}

.exportBtn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.scrollWrap {
  flex: 1 1 0;
  overflow: auto;
  background: var(--color-surface);
  min-height: 0;
}

.table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--font-size-sm);
}

.table th {
  background: var(--color-surface-alt);
  padding: 0.5rem 0.6rem;
  text-align: left;
  font-weight: 600;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.table th:hover {
  color: var(--color-accent);
}

.resizeHandle {
  position: absolute;
  right: 0;
  top: 20%;
  bottom: 20%;
  width: 7px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s, border-color 0.15s;
  z-index: 20;
  border-right: 2px solid var(--color-border-light);
}

.resizeHandle:hover,
.resizeHandle:active {
  background: rgba(99, 102, 241, 0.15);
  border-right-color: var(--color-accent);
}

.sortArrow {
  margin-left: 4px;
  font-size: 0.65rem;
  color: var(--color-accent);
  font-weight: 700;
}

.table td {
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--color-border-light);
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 0;
}

.table td > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  display: inline-block;
  vertical-align: middle;
}

.table tr:hover td {
  background: var(--color-accent-light);
}

.stickyCol {
  position: sticky;
  left: 0;
  z-index: 5;
  background: var(--color-surface, #fff);
  box-shadow: 2px 0 4px rgba(0,0,0,0.06);
}

.table th.stickyCol {
  z-index: 15;
  background: var(--color-surface-alt);
  box-shadow: 2px 0 4px rgba(0,0,0,0.06);
}

.table tr:hover .stickyCol {
  background: var(--color-accent-light);
}

.empty {
  padding: 3rem;
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-md);
}
````

### src/components/common/columnLinks.jsx

````jsx
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

// Build a key → { key, label, options } map from an array of lists.
// Callers pass the user's effective lists (built-ins merged with the
// per-key overrides stored on settings.dropdownLists) so cell
// renderers and the Link Columns modal always see the latest
// vocabulary.
export function buildListRegistry(lists) {
  const map = new Map();
  for (const list of (lists || [])) {
    if (!list?.key) continue;
    map.set(list.key, list);
  }
  return map;
}

// Same lists, sorted by label — used to populate the picker inside
// the Link Columns modal.
export function buildAvailableLists(lists) {
  return [...(lists || [])].sort((a, b) =>
    String(a.label || '').localeCompare(String(b.label || ''))
  );
}

// Comma-separated string ↔ array helper used by the multi-select cell.
// Tolerates an already-array value so it round-trips cleanly with
// whatever shape upstream code stores.
export function parseMulti(value) {
  if (Array.isArray(value)) return value.map(s => String(s).trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Resolve a column's effective dropdown binding. User picks (from the
// Link Columns modal) win over the caller's built-in defaults; an
// explicit `none` from the user disables a default. Returns null when
// the column is free-text. The shared registry isn't consulted here —
// if the user previously bound the column to a list that's since been
// removed, the consumer's listRegistry.get(listKey)?.options || []
// fallback yields an empty option set and the cell shows the current
// value as-is.
export function resolveColumnLink(columnName, userLinks, defaultLinks = {}) {
  const user = userLinks?.[columnName];
  if (user) {
    if (user.listKey === 'none') return null;
    if (user.listKey && user.listKey !== 'default') {
      return { listKey: user.listKey, mode: user.mode === 'multi' ? 'multi' : 'single' };
    }
  }
  return defaultLinks[columnName] || null;
}

// Single-select cell — click to open a popover of options sourced from
// the Dropdowns page. Picking an option commits the value and closes
// the popover; "Clear" empties it.
export function SelectCell({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  // Popup is portaled to <body> so the table cell's overflow:hidden
  // can't clip it; position is recomputed from the wrapper's bounding
  // rect whenever the popup opens.
  const [popPos, setPopPos] = useState({ top: 0, left: 0, width: 0, maxHeight: 280, dropUp: false });
  const wrapRef = useRef(null);
  const popRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    // Flip the menu above the cell (and cap its height) when there isn't
    // enough room below — otherwise a Stage cell near the bottom of the
    // screen opens a menu that runs off the viewport and gets clipped.
    const GAP = 2;
    const MARGIN = 8; // keep a little breathing room from the viewport edge
    const DESIRED = 280;
    const spaceBelow = window.innerHeight - rect.bottom - GAP - MARGIN;
    const spaceAbove = rect.top - GAP - MARGIN;
    const dropUp = spaceBelow < Math.min(DESIRED, spaceAbove) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(DESIRED, dropUp ? spaceAbove : spaceBelow));
    setPopPos({
      left: rect.left,
      width: rect.width,
      maxHeight,
      dropUp,
      top: dropUp ? undefined : rect.bottom + GAP,
      bottom: dropUp ? window.innerHeight - rect.top + GAP : undefined,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = String(value || '').trim();
  const isEmpty = !current;
  // Surface any pre-existing free-text value that isn't in the
  // configured list, so legacy data stays selectable instead of
  // silently dropping off the menu.
  const displayOptions = useMemo(() => {
    if (!current) return options;
    if (options.some(o => o.toLowerCase() === current.toLowerCase())) return options;
    return [current, ...options];
  }, [options, current]);

  function pick(opt) {
    onChange(opt);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <span
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
        }}
        title="Click to pick a value"
      >
        {isEmpty ? '—' : current}
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            ...(popPos.dropUp ? { bottom: popPos.bottom } : { top: popPos.top }),
            left: popPos.left,
            zIndex: 9999, minWidth: Math.max(popPos.width, 160), width: 240,
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
            fontSize: '0.82rem',
            // Reserve room for the Clear footer so the whole popover stays
            // within the space measured above/below the cell.
            maxHeight: popPos.maxHeight,
            display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
            {displayOptions.map(opt => {
              const selected = opt.toLowerCase() === current.toLowerCase();
              return (
                <div
                  key={opt}
                  onClick={() => pick(opt)}
                  style={{
                    padding: '0.35rem 0.6rem', cursor: 'pointer',
                    background: selected ? '#DCFCE7' : 'transparent',
                    color: selected ? '#166534' : '#1E293B',
                    fontWeight: selected ? 700 : 500,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >{opt}</div>
              );
            })}
          </div>
          {!isEmpty && (
            <div style={{
              display: 'flex', justifyContent: 'flex-end',
              padding: '0.3rem 0.5rem', borderTop: '1px solid var(--color-border-light)',
              background: 'var(--color-bg)',
            }}>
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                style={{
                  padding: '0.2rem 0.5rem', background: 'transparent',
                  border: '1px solid var(--color-border)', borderRadius: 3,
                  fontSize: '0.7rem', fontWeight: 600, fontFamily: 'inherit',
                  color: 'var(--color-text-muted)', cursor: 'pointer',
                }}
              >Clear</button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Multi-select cell — checkbox popover. Stores the chosen options as a
// comma-separated string so the value round-trips through plain text
// storage (CSV export, Firestore strings, etc.).
export function MultiSelectCell({ value, onChange, options, extraGroups, extraGroupsLabel, extraGroupsPlaceholder, nowrap }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [popPos, setPopPos] = useState({ top: 0, left: 0 });
  const [quickPick, setQuickPick] = useState('');
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const selected = useMemo(() => parseMulti(value), [value]);
  const selectedSet = useMemo(() => new Set(selected.map(s => s.toLowerCase())), [selected]);
  const groups = useMemo(
    () => (Array.isArray(extraGroups) ? extraGroups.filter(g => g && g.label && Array.isArray(g.options) && g.options.length > 0) : []),
    [extraGroups],
  );

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setPopPos({ top: rect.bottom + 2, left: rect.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, query]);

  function toggle(opt) {
    const key = opt.toLowerCase();
    const next = selectedSet.has(key)
      ? selected.filter(s => s.toLowerCase() !== key)
      : [...selected, opt];
    onChange(next.join(', '));
  }

  function clearAll() {
    onChange('');
  }

  // Add every option in a named group to the current selection. Items
  // already selected are skipped (matched case-insensitively).
  function addGroup(groupLabel) {
    const g = groups.find(gr => gr.label === groupLabel);
    if (!g) return;
    const existing = new Set(selected.map(s => s.toLowerCase()));
    const next = selected.slice();
    for (const opt of g.options) {
      const lower = String(opt || '').toLowerCase();
      if (!lower || existing.has(lower)) continue;
      existing.add(lower);
      next.push(opt);
    }
    onChange(next.join(', '));
    setQuickPick('');
  }

  const isEmpty = selected.length === 0;
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <span
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
          whiteSpace: nowrap ? 'nowrap' : 'normal',
          wordBreak: nowrap ? 'normal' : 'break-word',
          overflow: nowrap ? 'hidden' : undefined,
          textOverflow: nowrap ? 'ellipsis' : undefined,
        }}
        title={isEmpty ? 'Click to pick values' : selected.join(', ')}
      >
        {isEmpty ? '—' : selected.join(', ')}
      </span>
      {open && createPortal(
        <div
          ref={popRef}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', top: popPos.top, left: popPos.left,
            zIndex: 9999, width: 480, maxWidth: '92vw',
            background: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 4, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
            fontSize: '0.9rem',
          }}
        >
          {groups.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.5rem 0.6rem',
              borderBottom: '1px solid var(--color-border-light)',
              background: 'var(--color-bg)',
            }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                {extraGroupsLabel || 'Quick add'}
              </span>
              <select
                value={quickPick}
                onChange={(e) => { const v = e.target.value; if (v) addGroup(v); }}
                style={{
                  flex: 1, minWidth: 0, padding: '0.3rem 0.4rem',
                  border: '1px solid var(--color-border)', borderRadius: 3,
                  fontSize: '0.8rem', fontFamily: 'inherit',
                  background: '#fff', color: 'var(--color-text)',
                }}
              >
                <option value="">{extraGroupsPlaceholder || '— pick one —'}</option>
                {groups.map(g => (
                  <option key={g.label} value={g.label}>{g.label} ({g.options.length})</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ padding: '0.5rem 0.6rem', borderBottom: '1px solid var(--color-border-light)' }}>
            <input
              autoFocus
              type="text"
              value={query}
              placeholder="Filter options…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } }}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid var(--color-border)', borderRadius: 3,
                padding: '6px 8px', fontSize: 'inherit', fontFamily: 'inherit',
                color: 'var(--color-text)', background: '#fff',
              }}
            />
          </div>
          <div style={{ maxHeight: 440, overflowY: 'auto' }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '0.6rem 0.7rem', color: 'var(--color-text-muted)' }}>
                No matches
              </div>
            ) : filteredOptions.map(opt => {
              const checked = selectedSet.has(opt.toLowerCase());
              return (
                <label
                  key={opt}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.55rem',
                    padding: '0.4rem 0.7rem', cursor: 'pointer',
                    background: checked ? '#DCFCE7' : 'transparent',
                    color: checked ? '#166534' : '#1E293B',
                    fontWeight: checked ? 600 : 500,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt)}
                    style={{ margin: 0 }}
                  />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {opt}
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.4rem 0.6rem', borderTop: '1px solid var(--color-border-light)',
            background: 'var(--color-bg)',
          }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {selected.length} selected
            </span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={clearAll}
                style={{
                  padding: '0.3rem 0.65rem', background: 'transparent',
                  border: '1px solid var(--color-border)', borderRadius: 3,
                  fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit',
                  color: 'var(--color-text-muted)', cursor: 'pointer',
                }}
              >Clear</button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  padding: '0.3rem 0.65rem', background: 'var(--color-accent)',
                  border: '1px solid var(--color-accent)', borderRadius: 3,
                  fontSize: '0.75rem', fontWeight: 600, fontFamily: 'inherit',
                  color: '#fff', cursor: 'pointer',
                }}
              >Done</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Modal for binding columns to Dropdowns-tab lists. Each row mirrors
// one of the caller's column headers and lets the user pick a source
// list + single/multi mode. "Default" leaves the binding to whatever
// the caller's defaultLinks map says, so built-in bindings stay in
// place unless explicitly overridden.
export function LinkColumnsModal({ headers, columnLinks, defaultLinks = {}, listRegistry, availableLists, onChange, onClose }) {
  const registry = listRegistry instanceof Map ? listRegistry : buildListRegistry(listRegistry || []);
  const lists = availableLists || buildAvailableLists(Array.from(registry.values()));
  const setBinding = (column, patch) => {
    const next = { ...(columnLinks || {}) };
    const current = next[column] || { listKey: 'default', mode: 'single' };
    const merged = { ...current, ...patch };
    if (merged.listKey === 'default') delete next[column];
    else next[column] = merged;
    onChange(next);
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 680, maxWidth: '94vw', maxHeight: '86vh',
          background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)',
        }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>
              Link columns to Dropdowns lists
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
              Pick a list for any column. Single = one value per cell, Multi = checkbox list.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.3rem 0.65rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Close</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '0.5rem 1rem 1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)' }}>
                <th style={{ padding: '0.45rem 0.4rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Column</th>
                <th style={{ padding: '0.45rem 0.4rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Dropdown list</th>
                <th style={{ padding: '0.45rem 0.4rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Mode</th>
              </tr>
            </thead>
            <tbody>
              {headers.map(h => {
                const userBinding = columnLinks?.[h];
                const defaultBinding = defaultLinks[h];
                const effective = resolveColumnLink(h, columnLinks, defaultLinks);
                const selectedListKey = userBinding ? userBinding.listKey : 'default';
                const mode = userBinding?.mode || effective?.mode || 'single';
                return (
                  <tr key={h} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                    <td style={{ padding: '0.5rem 0.4rem', fontWeight: 600, color: 'var(--color-text)' }}>{h}</td>
                    <td style={{ padding: '0.5rem 0.4rem' }}>
                      <select
                        value={selectedListKey}
                        onChange={(e) => setBinding(h, { listKey: e.target.value })}
                        style={{
                          width: '100%', padding: '0.35rem 0.45rem',
                          border: '1px solid var(--color-border)', borderRadius: 4,
                          fontSize: '0.82rem', fontFamily: 'inherit',
                          background: '#fff', color: 'var(--color-text)',
                        }}
                      >
                        <option value="default">
                          {defaultBinding
                            ? `Default (${registry.get(defaultBinding.listKey)?.label || defaultBinding.listKey})`
                            : 'Default (free text)'}
                        </option>
                        <option value="none">— No list (free text) —</option>
                        <optgroup label="Dropdowns">
                          {lists.map(l => (
                            <option key={l.key} value={l.key}>{l.label}</option>
                          ))}
                        </optgroup>
                      </select>
                    </td>
                    <td style={{ padding: '0.5rem 0.4rem', whiteSpace: 'nowrap' }}>
                      <label style={{ marginRight: '0.6rem', cursor: effective ? 'pointer' : 'not-allowed', opacity: effective ? 1 : 0.4 }}>
                        <input
                          type="radio"
                          name={`mode-${h}`}
                          disabled={!effective}
                          checked={!!effective && mode === 'single'}
                          onChange={() => setBinding(h, {
                            listKey: selectedListKey === 'default' ? (defaultBinding?.listKey || 'none') : selectedListKey,
                            mode: 'single',
                          })}
                          style={{ marginRight: 4 }}
                        />Single
                      </label>
                      <label style={{ marginRight: '0.6rem', cursor: effective ? 'pointer' : 'not-allowed', opacity: effective ? 1 : 0.4 }}>
                        <input
                          type="radio"
                          name={`mode-${h}`}
                          disabled={!effective}
                          checked={!!effective && mode === 'multi'}
                          onChange={() => setBinding(h, {
                            listKey: selectedListKey === 'default' ? (defaultBinding?.listKey || 'none') : selectedListKey,
                            mode: 'multi',
                          })}
                          style={{ marginRight: 4 }}
                        />Multi
                      </label>
                      <label style={{ cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`mode-${h}`}
                          checked={!effective}
                          onChange={() => setBinding(h, { listKey: 'none', mode: 'single' })}
                          style={{ marginRight: 4 }}
                        />None
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.6rem 1rem', borderTop: '1px solid var(--color-border-light)',
          background: 'var(--color-bg)',
        }}>
          <button
            type="button"
            onClick={() => onChange({})}
            style={{
              padding: '0.35rem 0.7rem', background: 'transparent',
              border: '1px solid var(--color-border)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: 'var(--color-text-muted)', cursor: 'pointer',
            }}
          >Reset to defaults</button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.35rem 0.85rem', background: 'var(--color-accent)',
              border: '1px solid var(--color-accent)', borderRadius: 4,
              fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
              color: '#fff', cursor: 'pointer',
            }}
          >Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
````

### src/data/sampleData.js

````jsx
// Demo dataset for the standalone Agents export.
//
// The real Agents page reads from several browser caches that, in the
// full app, are hydrated from Firestore / HubSpot / pasted Salesforce
// exports:
//
//   • the Opps 2 cache          (`opps2-cache`  IndexedDB)  — the opps roster
//   • the HubSpot contacts cache(`hubspot-contacts` IndexedDB)
//   • the HubSpot activity cache(`hubspot-activity-cache` localStorage)
//   • the pasted BFO Activity   (`bfo-activity` IndexedDB, key `current`)
//   • per-user settings         (workEmail, marketingLeads, savedPrompts)
//
// There's no backend in the export, so this file holds sample values for
// all of them and `seedAgentsDemo()` writes them into the same
// localStorage-backed shims the page reads from. The opps roster is
// seeded lazily by `utils/opps2Store.js` (the SHIM) via `SAMPLE_OPPS2`;
// everything else is seeded once, on first load, by `seedAgentsDemo()`.
//
// After the first load your in-app edits persist locally and take
// precedence. To wipe everything and re-seed, run in the console:
//   import('./data/sampleData.js').then(m => m.resetSampleData())  // then reload

import { dbGet, dbPut } from '../utils/db';
import { userLsGet, userLsSet } from '../utils/userLs';

// ---------------------------------------------------------------------------
// The work email the Agents page matches outbound HubSpot emails against
// (Settings → CDM Name in the full app). Every seeded "sent" email is
// FROM this address so the Activity → Sent emails table lights up.
// ---------------------------------------------------------------------------
export const SAMPLE_WORK_EMAIL = 'dan.baldauf@se.com';

// ---------------------------------------------------------------------------
// Opps 2 roster (same store `oppsCache.loadOppsFromCache` + OppsView2 read).
// ---------------------------------------------------------------------------
export const DEFAULT_HEADERS = [
  'Account', 'Open Year', 'Contact', 'Stage', 'Scope', 'Source', 'Type', 'Sales Partner',
  'Start Date', 'Status', 'Quoted Amount', 'Sites', 'Age',
  'Last Client Heard From Us', 'Last Spoke', 'Follow Up', 'Call In', 'Notes',
  'Next Steps', 'No Further Action Today', 'Competition', 'Waiting On', 'Close Date',
  'BFO Link', 'BFO Company Name', 'BFO Address', 'Pricing Option',
  'Quoted On', 'Chance?', 'Margin Email Date - Sales Leader Review Date', 'PE Owner',
];

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const blanks = () => Object.fromEntries(DEFAULT_HEADERS.map((h) => [h, '']));

function row(id, fields) {
  return {
    _id: id,
    id,
    _rowUpdatedAt: now - id * DAY,
    ...blanks(),
    ...fields,
  };
}

const RECORDS = [
  // Tagged to a BFO opp → shows up in Close Dates / Amount / Stage prompts
  // (joined to the pasted BFO Activity rows below).
  row(1, {
    Account: 'Acme Property Group',
    'Open Year': '2026',
    Contact: 'Alice Johnson <alice.johnson@acmeproperty.com>',
    Stage: 'Qualifying',
    Scope: 'CSRD readiness',
    Source: 'Self Gen - Prospecting Email',
    Type: 'Owner Operator',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-05-15',
    Status: 'I am waiting on the client',
    'Quoted Amount': '$48,000',
    Sites: '12',
    'Last Client Heard From Us': '2026-06-10',
    'Follow Up': '2026-06-30',
    Notes: 'Sustainability lead is building the internal business case.',
    'Next Steps': 'Send scoping summary\nConfirm number of in-scope sites',
    Competition: 'Watershed',
    'Waiting On': 'Client budget committee',
    'BFO Link': 'Acme Property — CSRD Readiness 2026',
    'BFO Company Name': 'Acme Property Group LLC',
    'BFO Address': 'https://se.lightning.force.com/lightning/r/Opportunity/0068V00000ACME01/view',
    'Chance?': 'OK',
    'PE Owner': 'Blackstone',
  }),
  // BFO Opportunity Name is the "-" placeholder (needs a BFO opp created)
  // → surfaces in the "New BFO Opp" table.
  row(2, {
    Account: 'Northwind Logistics',
    'Open Year': '2026',
    Contact: 'Bob Lee <bob.lee@northwindlogistics.com>',
    Stage: 'Quoting',
    Scope: 'AEM',
    Source: 'Customer Referral',
    Type: 'Operator',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-06-08',
    Status: 'Client waiting on me',
    'Quoted Amount': '$72,500',
    Sites: '34',
    'Follow Up': '2026-07-02',
    Notes: 'Referred by an existing client; warm intro from their COO.',
    'Next Steps': 'Build pricing option\nWalk through AEM coverage',
    'BFO Link': '-',
    'Chance?': 'Expected',
  }),
  // "-" placeholder → "New BFO Opp" table.
  row(3, {
    Account: 'Cedar & Vale Real Estate',
    'Open Year': '2026',
    Contact: 'Carla Mendes <carla.mendes@cedarvale.com>',
    Stage: 'Lead',
    Scope: 'Audits',
    Source: 'Marketing',
    Type: 'Equity REIT',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-04-20',
    Status: 'Not in direct contact w client',
    Sites: '8',
    'Follow Up': '2026-06-27',
    Notes: 'Inbound from the CSRD webinar. Still identifying the right owner.',
    'Next Steps': 'Find out the story\nIdentify decision maker',
    'BFO Link': '-',
    'Chance?': 'Weak',
  }),
  // Tagged to a BFO opp → Close Dates / Amount / Stage prompts.
  row(4, {
    Account: 'Harbor Point Holdings',
    'Open Year': '2026',
    Contact: 'David Okoro <david.okoro@harborpointholdings.com>',
    Stage: 'Contracting',
    Scope: 'CSRD readiness',
    Source: 'Existing Customer',
    Type: 'RE Investment Manager',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-03-26',
    Status: 'Client waiting on ESS team member',
    'Quoted Amount': '$110,000',
    Sites: '57',
    'Last Client Heard From Us': '2026-06-18',
    'Follow Up': '2026-06-25',
    Notes: 'Expansion of last year`s engagement. Legal redlining the MSA.',
    'Next Steps': 'Return redlines\nConfirm start date',
    'BFO Link': 'Harbor Point — CSRD Expansion',
    'BFO Company Name': 'Harbor Point Holdings Inc',
    'BFO Address': 'https://se.lightning.force.com/lightning/r/Opportunity/0068V00000HARB01/view',
    'Pricing Option': 'Enterprise — 3yr',
    'Quoted On': '2026-05-30',
    'Chance?': 'Expected',
    'PE Owner': 'KKR',
  }),
  // No BFO Opportunity Name yet → "New BFO Opp" table + a meeting today.
  row(5, {
    Account: 'Summit Facilities Mgmt',
    'Open Year': '2026',
    Contact: 'Erin Walsh <erin.walsh@summitfm.com>',
    Stage: 'Quoted',
    Scope: 'AEM',
    Source: 'Partner',
    Type: 'Facility Manager',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-06-14',
    Status: 'Meeting scheduled',
    'Quoted Amount': '$31,200',
    Sites: '5',
    'Follow Up': '2026-06-26',
    Notes: 'Demo went well; pricing sent. Champion looping in their CFO.',
    'Next Steps': 'Hold pricing review call',
    'BFO Link': '-',
    'Quoted On': '2026-06-20',
    'Chance?': 'OK',
  }),
  // Tagged with a BFO Opportunity Name but MISSING its BFO Address →
  // surfaces in the "AI BFO Prep" table (copy the BFO website address in).
  row(7, {
    Account: 'Beacon Hill Trust',
    'Open Year': '2026',
    Contact: 'Grace Okafor <grace.okafor@beaconhilltrust.com>',
    Stage: 'Quoting',
    Scope: 'AEM',
    Source: 'Self Gen - Prospecting Email',
    Type: 'Owner Operator',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-06-30',
    Status: 'Client waiting on me',
    'Quoted Amount': '$54,000',
    Sites: '18',
    'Follow Up': '2026-07-24',
    'Call In': '4',
    Notes: 'BFO opp created; still need to paste the Salesforce record link.',
    'Next Steps': 'Grab BFO website address',
    'BFO Link': 'Beacon Hill — AEM Rollout',
    'BFO Company Name': 'Beacon Hill Trust',
    'Chance?': 'OK',
  }),
  // Lost/closed → feeds the "Close Not Solds" prompt via its BFO row.
  row(6, {
    Account: 'Lakeshore Capital Partners',
    'Open Year': '2026',
    Contact: 'Frank Idris <frank.idris@lakeshorecap.com>',
    Stage: 'Not Sold',
    Scope: 'Audits',
    Source: 'Inside Sales',
    Type: 'Private Equity',
    'Sales Partner': 'Dan Baldauf',
    'Start Date': '2026-01-02',
    Status: 'Client requested a pause',
    'Quoted Amount': '$95,000',
    Sites: '23',
    Notes: 'Price pain; went with an incumbent. Tracked for the close-out flow.',
    'Reason Not Sold': 'Price pain',
    'BFO Link': 'Lakeshore Capital — Audit Program',
    'BFO Company Name': 'Lakeshore Capital Partners',
    'BFO Address': 'https://se.lightning.force.com/lightning/r/Opportunity/0068V00000LAKE01/view',
    'Chance?': 'Weak',
    'PE Owner': 'Lakeshore Capital',
  }),
];

export const SAMPLE_OPPS2 = {
  headers: DEFAULT_HEADERS,
  records: RECORDS,
  columnLinks: undefined,
  dropdownLists: undefined,
};

// ---------------------------------------------------------------------------
// HubSpot contacts cache (`hubspot-contacts` IndexedDB, key `cache`).
// email → company powers the Activity table's Company column and the
// fuzzy Opps-tab match for each outbound email / meeting.
// ---------------------------------------------------------------------------
export const SAMPLE_HUBSPOT_CONTACTS = {
  fetchedAt: new Date(now).toISOString(),
  contacts: [
    { id: 'c1', email: 'alice.johnson@acmeproperty.com', firstname: 'Alice', lastname: 'Johnson', company: 'Acme Property Group' },
    { id: 'c2', email: 'bob.lee@northwindlogistics.com', firstname: 'Bob', lastname: 'Lee', company: 'Northwind Logistics' },
    { id: 'c3', email: 'carla.mendes@cedarvale.com', firstname: 'Carla', lastname: 'Mendes', company: 'Cedar & Vale Real Estate' },
    { id: 'c4', email: 'david.okoro@harborpointholdings.com', firstname: 'David', lastname: 'Okoro', company: 'Harbor Point Holdings' },
    { id: 'c5', email: 'erin.walsh@summitfm.com', firstname: 'Erin', lastname: 'Walsh', company: 'Summit Facilities Mgmt' },
    { id: 'c6', email: 'grace.okafor@beaconhilltrust.com', firstname: 'Grace', lastname: 'Okafor', company: 'Beacon Hill Trust' },
    { id: 'c7', email: 'dan.baldauf@se.com', firstname: 'Dan', lastname: 'Baldauf', company: 'Schneider Electric' },
  ],
};

// ---------------------------------------------------------------------------
// HubSpot activity cache (`hubspot-activity-cache` localStorage, user-scoped).
// A few outbound emails + one meeting, all stamped for today so they land
// in the Activity window.
// ---------------------------------------------------------------------------
function isoAt(hour, minute, dayOffset = 0) {
  const d = new Date(now + dayOffset * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

export const SAMPLE_ACTIVITY = {
  fetchedAt: new Date(now).toISOString(),
  emails: [
    {
      id: 'e1', hs_object_id: 'e1',
      hs_timestamp: isoAt(9, 12),
      hs_email_from_email: SAMPLE_WORK_EMAIL,
      hs_email_to_email: 'alice.johnson@acmeproperty.com',
      hs_email_subject: 'CSRD scoping summary + in-scope sites',
      hs_email_status: 'SENT',
    },
    {
      id: 'e2', hs_object_id: 'e2',
      hs_timestamp: isoAt(11, 4),
      hs_email_from_email: SAMPLE_WORK_EMAIL,
      hs_email_to_email: 'bob.lee@northwindlogistics.com',
      hs_email_subject: 'Northwind — AEM coverage + pricing option',
      hs_email_status: 'SENT',
    },
    {
      id: 'e3', hs_object_id: 'e3',
      hs_timestamp: isoAt(14, 37),
      hs_email_from_email: SAMPLE_WORK_EMAIL,
      hs_email_to_email: 'david.okoro@harborpointholdings.com',
      hs_email_subject: 'Redlines returned — MSA start date',
      hs_email_status: 'SENT',
    },
    // Prospecting note to a lead who isn't on the Opps tab — exercises the
    // inline "pick opportunity" flow + Marketing Lead match.
    {
      id: 'e4', hs_object_id: 'e4',
      hs_timestamp: isoAt(15, 58),
      hs_email_from_email: SAMPLE_WORK_EMAIL,
      hs_email_to_email: 'grace.tam@meridianreit.com',
      hs_email_subject: 'Intro — energy + sustainability program',
      hs_email_status: 'SENT',
    },
  ],
  calls: [],
  meetings: [
    {
      id: 'm1', hs_object_id: 'm1',
      hs_timestamp: isoAt(13, 0),
      hs_meeting_start_time: isoAt(13, 0),
      hs_meeting_end_time: isoAt(13, 30),
      hs_meeting_title: 'Summit Facilities — pricing review',
      hs_meeting_location: 'Zoom',
      hs_meeting_outcome: 'COMPLETED',
      _contactIds: ['c5'],
    },
  ],
};

// ---------------------------------------------------------------------------
// Pasted BFO Activity (`bfo-activity` IndexedDB, key `current`). Shape is
// { headers, rows } — the Salesforce Opportunity printable view the user
// pastes on the BFO Activity tab. Joined to the opps above by Opportunity
// Name to drive the Close Dates / Amount Updates / Stage Change / Close
// Not Solds prompts.
// ---------------------------------------------------------------------------
function bfoCloseDate(dayOffset) {
  const d = new Date(now + dayOffset * DAY);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

const BFO_HEADERS = ['Account Name', 'Opportunity Name', 'Stage', 'Sales Stage', 'Close Date', 'Amount', 'Status'];

export const SAMPLE_BFO_ACTIVITY = {
  fetchedAt: new Date(now).toISOString(),
  headers: BFO_HEADERS,
  rows: [
    {
      'Account Name': 'Acme Property Group LLC',
      'Opportunity Name': 'Acme Property — CSRD Readiness 2026',
      'Stage': '3 - Qualify Opportunity',
      'Sales Stage': '3 - Qualify Opportunity', // opps Stage "Qualifying" expects 4 → Stage Change surfaces it
      'Close Date': bfoCloseDate(45),           // stage <=4 & <100 days → Close Dates slips it
      'Amount': '$40,000',                       // != Quoted $48,000 → Amount Updates surfaces it
      'Status': 'Open',
    },
    {
      'Account Name': 'Harbor Point Holdings Inc',
      'Opportunity Name': 'Harbor Point — CSRD Expansion',
      'Stage': '5 - Prepare & Bid',
      'Sales Stage': '5 - Prepare & Bid',        // opps Stage "Contracting" also expects 5 → no Stage Change
      'Close Date': bfoCloseDate(40),            // stage 5 & <60 days → Close Dates slips it
      'Amount': '$100,000',                      // != Quoted $110,000 → Amount Updates surfaces it
      'Status': 'Open',
    },
    {
      'Account Name': 'Lakeshore Capital Partners',
      'Opportunity Name': 'Lakeshore Capital — Audit Program',
      'Stage': '4 - Influence and Develop',
      'Sales Stage': '4 - Influence and Develop',
      'Close Date': bfoCloseDate(20),
      'Amount': '$95,000',
      'Status': 'Lost',                          // opps Stage "Not Sold" → Close Not Solds flow
    },
  ],
};

// ---------------------------------------------------------------------------
// Marketing Leads (settings.marketingLeads). One is missing a Salesforce
// link (→ "Marketing Leads" agent, which asks the assistant to paste the
// record URL); the others carry a status that can drift from Salesforce
// (→ "Marketing Lead Status Update" agent).
// ---------------------------------------------------------------------------
export const SAMPLE_MARKETING_LEADS = [
  { id: 'ml1', name: 'Grace Tam', email: 'grace.tam@meridianreit.com', company: 'Meridian REIT', status: '2 - Attempting to Contact', sfUrl: '' },
  { id: 'ml2', name: 'Henry Park', email: 'henry.park@brightpathcap.com', company: 'Brightpath Capital', status: '3 - Connected', sfUrl: 'https://se.lightning.force.com/lightning/r/Lead/00Q8V00000HENRY1/view' },
  { id: 'ml3', name: 'Priya Nair', email: 'priya.nair@vantageproperties.com', company: 'Vantage Properties', status: '4 - Qualifying', sfUrl: '00Q8V00000PRIYA1' },
];

// The BFO Activity page's "Leads" subtab — the pasted Salesforce Leads
// printable view (`bfo-activity` IndexedDB, key `leads-current`). Two of
// the marketing leads above carry a DIFFERENT status here than on the
// Marketing Leads page, so the "Marketing Lead Status Update" agent has
// discrepancies to reconcile.
export const SAMPLE_BFO_LEADS = {
  fetchedAt: new Date(now).toISOString(),
  headers: ['Name', 'Company', 'Status'],
  rows: [
    { Name: 'Park, Henry', Company: 'Brightpath Capital', Status: '1 - New' },       // vs '3 - Connected'
    { Name: 'Nair, Priya', Company: 'Vantage Properties', Status: '2 - Attempting to Contact' }, // vs '4 - Qualifying'
  ],
};

// Default per-user settings for the export (workEmail + marketing leads).
// The savedPrompts library falls back to its built-in seed list until the
// user edits it, so we leave it undefined here.
export const SAMPLE_SETTINGS = {
  workEmail: SAMPLE_WORK_EMAIL,
  marketingLeads: SAMPLE_MARKETING_LEADS,
};

// ---------------------------------------------------------------------------
// Seed the non-opps caches once, on first load. Idempotent via a flag so
// the user's later edits (ignored emails, tags, pasted BFO rows) survive a
// reload. The opps roster itself is seeded separately by the opps2Store SHIM.
// ---------------------------------------------------------------------------
const SEED_FLAG_KEY = 'agents-demo-seeded-v1';

export async function seedAgentsDemo() {
  try {
    if (userLsGet(SEED_FLAG_KEY) === '1') return;

    // HubSpot contacts (IndexedDB shim).
    if (!(await dbGet('hubspot-contacts', 'cache'))) {
      await dbPut('hubspot-contacts', SAMPLE_HUBSPOT_CONTACTS, 'cache');
    }
    // Pasted BFO Activity rows (IndexedDB shim, key `current`).
    if (!(await dbGet('bfo-activity', 'current'))) {
      await dbPut('bfo-activity', SAMPLE_BFO_ACTIVITY, 'current');
    }
    // Pasted BFO Activity "Leads" subtab (IndexedDB shim, key `leads-current`).
    if (!(await dbGet('bfo-activity', 'leads-current'))) {
      await dbPut('bfo-activity', SAMPLE_BFO_LEADS, 'leads-current');
    }
    // HubSpot activity cache (user-scoped localStorage).
    if (userLsGet('hubspot-activity-cache') == null) {
      userLsSet('hubspot-activity-cache', JSON.stringify(SAMPLE_ACTIVITY));
    }

    userLsSet(SEED_FLAG_KEY, '1');
  } catch (err) {
    console.warn('seedAgentsDemo failed', err);
  }
}

// Wipe the seeded demo data (and any local edits) so the next load
// re-seeds fresh. Call from the browser console:
//   import('./data/sampleData.js').then(m => m.resetSampleData())
export function resetSampleData() {
  try {
    for (const prefix of ['agx::', 'u:_anon:', 'u:demo-user:']) {
      const toDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) toDelete.push(k);
      }
      toDelete.forEach((k) => localStorage.removeItem(k));
    }
    localStorage.removeItem('agents-demo-seeded-v1');
  } catch { /* ignore */ }
}
````

### src/data/dropdownLists.js

````jsx
// Reference dropdown lists for the Opps workflow. Lifted from the
// shared spreadsheet so the same option vocabulary surfaces inside
// the app — used by the Dropdowns reference tab.
import { PE_STRATEGIES, ASSET_TYPES } from './enums';

export const DROPDOWN_LISTS = [
  {
    key: 'whoIsWaiting',
    label: 'Who is waiting',
    options: [
      'Client waiting on me',
      'Client waiting on ESS team member',
      'I am waiting on the client',
      'Not in direct contact w client',
      'Meeting scheduled',
      'Client requested a pause',
    ],
  },
  {
    key: 'chance',
    label: 'Chance?',
    options: ['Expected', 'OK', 'Weak'],
  },
  {
    key: 'category',
    label: 'Category',
    options: [
      'Needs Research',
      'Inside Sales',
      'Targeting - Not Sold',
      'Targeting',
      'Not Targeting - Focus',
      'Not Targeting - HQ',
      'Not Targeting - Geography',
      'Not Targeting - Ranking 1',
      'Not Targeting - Ranking 2',
      'Not Targeting - Parent',
      'Not Targeting - Other CDM',
      'Not Targeting - Type',
      'Not Targeting - Sites',
    ],
  },
  {
    key: 'contact',
    label: 'Contact?',
    options: ['No Contact Yet', 'Old Client', 'SE Client', 'Made Contact', 'Client'],
  },
  {
    key: 'utilityResponsibility',
    label: 'Utility Responsibility',
    options: ['Some', 'Unsure', 'None', 'Full'],
  },
  {
    key: 'geographic',
    label: 'Geographic',
    options: ['NAM', 'State', 'Not NAM', 'Global', 'Regional'],
  },
  {
    key: 'type',
    label: 'Type',
    options: [
      'Operator',
      'Owner Operator',
      'RE Investment Manager',
      'Partner',
      'Equity REIT',
      'Developer',
      'Services - FM',
      'Fully Integrated',
      'Asset Management Firm',
      'Portfolio Company',
      'Facility Manager',
      'Private Equity',
    ],
  },
  {
    key: 'commissions',
    label: 'Commissions',
    options: [
      'Payment In Progress',
      'Fully Paid',
      'No Payment',
      'Missing',
      'Submitted missing',
      'Payment Done',
    ],
  },
  {
    key: 'status',
    label: 'Status',
    options: [
      'Lead',
      'Qualifying',
      'Quoting',
      'Quoted',
      'Contracting',
      'Agreement Sent',
      'Sold',
      'Not Sold',
      'Repricing',
      'Not Started',
      'Duplicate Opp',
    ],
  },
  {
    key: 'source',
    label: 'Source',
    options: [
      'Inside Sales',
      'Marketing',
      'Partner',
      'Self Gen - Prospecting Email',
      'ESS Coworker - New Prospect',
      'Other SE BU',
      'Existing Customer',
      'Customer Referral',
      'Sailebot',
      'PE partner',
    ],
  },
  {
    key: 'reasonNotSold',
    label: 'Reason Not Sold',
    options: [
      'Unknown',
      'Ghosted - No Response',
      'Cancelled Internally - Not in targets',
      'Never Connected',
      'Cancelled internally - No Opp',
      'Free Service',
      'Software or service doesn\'t meet need',
      'Price pain',
      'Customer didnt have enough pain',
      'Current service delivery issues',
      'Sold - Current Client',
      'Sold - New Client',
    ],
  },
  {
    key: 'dealPaperwork',
    label: 'Deal Paperwork',
    options: ['Not submitted', 'Sent to Chad', 'Kathy Sent PDF'],
  },
  {
    key: 'agreements',
    label: 'Agreements',
    options: ['Fully Executed Agreement', 'Completed Form', 'PO', 'Completed on MSA', 'Pull Through'],
  },
  {
    key: 'billingLetter',
    label: 'Billing Letter',
    options: [
      'Sent billing letter',
      'Ticket Submitted',
      'Billing letter completed',
      'No billing letter needed',
      'No Box',
    ],
  },
  {
    key: 'closedWon',
    label: 'Closed Won',
    options: [
      'Email Sent',
      'Sent billing letter',
      'Billing letter completed',
      'Onboarding Sheet Completed & Email Sent',
      'Onboarding Sheet Completed & Ticket Submitted',
      'Renewed',
      'Expired',
      'Cancelled',
    ],
  },
  {
    key: 'contractReview',
    label: 'Contract Review',
    options: ['Contract Checklist Reviewed', 'Prenegotiated Terms'],
  },
  {
    key: 'verbal',
    label: 'Verbal',
    options: ['Verbal email sent', 'No verbal email required'],
  },
  {
    key: 'margin',
    label: 'Margin',
    options: ['Margin email'],
  },
  {
    key: 'quoted',
    label: 'Quoted',
    options: ['Quoted', 'Contracting', 'Agreement Sent', 'Sold', 'Not Sold'],
  },
  {
    key: 'quotedDate',
    label: 'Quoted Date',
    options: [
      'Quoted Date',
      'Commercial Review Date',
      'Verbal Email',
      'Single USD Invoice',
      'Legal Review Date',
      'Entity Outside of the US',
    ],
  },
  {
    key: 'months',
    label: 'Months',
    options: [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ],
  },
  {
    key: 'rollout',
    label: 'Rollout',
    options: [
      'Completed',
      'In progress',
      'On hold',
      'Incomplete - Behind Schedule',
      'Waiting on Client',
      'Waiting on SE Team Member',
    ],
  },
  {
    key: 'foundOnRenewals',
    label: 'Found on Renewals',
    options: ['0', '1'],
  },
  {
    key: 'bfoTag',
    label: 'BFO Tag',
    options: ['#SUSUP', '#DATA', '#SUECO', '#SUESP', '#SUREN', '#SUDIG', '-'],
  },
  {
    key: 'region',
    label: 'Region',
    options: ['NAM', 'EU', 'Global', 'Dead', '-'],
  },
  {
    key: 'years',
    label: 'Years',
    options: ['1 year', '3 years'],
  },
  {
    key: 'productLine',
    label: 'Product Line',
    options: [
      'SUSUP - SUPPLY & SUST SERVICES',
      'SUECO - SUSTAINABILITY ECOACT',
      'SUESP - EFFICIENCY & SUST PROG.',
      'SUREN - RENEWABLE ADVIS. SER',
      'SUDIG - SB DIGITAL SOLUTIONS',
    ],
  },
  {
    key: 'serviceType',
    label: 'Service Type',
    options: [
      'Sustainability Reporting',
      'Carbon Footprint',
      'Energy Management Software',
      'Energy Procurement',
      'Net Zero',
      '-',
    ],
  },
  {
    key: 'zoomIntent',
    label: 'Zoom Intent',
    options: ['Recurring', 'Project', '-'],
  },
  {
    key: 'closedReason',
    label: 'Closed / Cancelled Reason',
    options: [
      'Cancelled internally - No Opp',
      'Cancelled Internally - Not in targets',
      'Cancelled by Schneider',
      'Cancelled by Customer',
      'Lost',
      'Duplicate Opp',
      'Free Service',
    ],
  },
  {
    key: 'lostReason',
    label: 'Lost Reason',
    options: [
      'No real opportunity / out of SE strategy',
      'Relationship Issue with SE',
      'No acceptable Offer from SE',
    ],
  },
  {
    key: 'engagementStage',
    label: 'Engagement Stage',
    options: [
      '3 - Qualify Opportunity',
      '4 - Influence and Develop',
      '5 - Prepare & Bid',
      '6 - Negotiate to Win',
    ],
  },
  {
    key: 'cmAlignment',
    label: 'CM Alignment',
    options: [
      'COA Approval',
      'Aligned w/CM on upsells',
      'COA approved',
      'CM to renegotiate - no upsells',
      'Reached out to CM',
    ],
  },
  {
    key: 'relationshipQuality',
    label: 'Relationship Quality',
    options: [
      'Happy with Dan',
      'Asked',
      'Unresponsive, not sure',
      'Unhappy with me or our team',
    ],
  },
  {
    key: 'dealTimeline',
    label: 'Deal Timeline',
    options: [
      'No timeline - Just exploring',
      'Rough timeline - Want to but no urgency',
      'Firm timeline - Need to act',
      'In current talks',
      'Worth still chasing',
      'Meeting scheduled',
      'never',
    ],
  },
  {
    key: 'competition',
    label: 'Competition',
    options: [
      'Only SE',
      'Competitive non RFP',
      'RFP',
      'N/A',
    ],
  },
  {
    key: 'clientCategory',
    label: 'Client Category',
    options: [
      '1. Referral partners',
      '2. Existing customer opportunity',
      '3. New prospect (connected)',
      '4. New prospect (not connected)',
      '5. Transactional relationships',
      '6. Ex whale relationships',
    ],
  },
  {
    key: 'sponsor',
    label: 'Sponsor / Buyer',
    options: [
      'Portfolio company exec sponsor',
      'Repeat buyer',
      'Sustainability lead with buying authority',
    ],
  },
  {
    // Investment-strategy tags for PE firms. Editing this list on the
    // Dropdowns tab drives the options offered in the PE Firm sub-tab's
    // Strategies column and the company pop-up's Strategies field.
    key: 'peStrategies',
    label: 'PE Strategies',
    options: [...PE_STRATEGIES],
  },
  {
    // Asset Types for company / PE records. Editing this list on the
    // Dropdowns tab drives the Asset Types multi-select in Table View,
    // the company pop-up's Asset Types field and the PE Overview tab's
    // Asset Types column.
    key: 'assetTypes',
    label: 'Asset Types',
    options: [...ASSET_TYPES],
  },
];

// Max-target-age + next-move guidance keyed by Stage. Surfaced beside
// the main dropdown grid as a small reference table.
export const STAGE_AGE_GUIDANCE = [
  { stage: '3', maxAge: 60,  nextMove: 'Qualify or kill' },
  { stage: '4', maxAge: 90,  nextMove: 'Quote or kill' },
  { stage: '5', maxAge: 150, nextMove: 'Move to contract or kill' },
  { stage: '6', maxAge: 200, nextMove: '-' },
];

// Long Solutions / Service catalog — listed separately so it can scroll
// inside its own card without crowding the main grid.
export const SOLUTIONS_CATALOG = [
  'AEM',
  'AP upload (indirect payment)',
  'API/ETL',
  'Arc performance certs',
  'Assurance gap assessment',
  'Audits',
  'BBS reporting',
  'BECS/BPS screening',
  'Bespoke consulting SUCON',
  'Bill payment',
  'BPS Reporting',
  'Budgets',
  'Building Activate',
  'CA SB Bills - SUCON',
  'Capital asset planning',
  'Cat 1 & 2',
  'Cat 4', 'Cat 8', 'Cat 9', 'Cat 10', 'Cat 11', 'Cat 12', 'Cat 13', 'Cat 14', 'Cat 15',
  'CDP biodiversity',
  'CDP biodiversity risk assessment',
  'CDP climate',
  'CDP plastics',
  'CDP water',
  'CDP water risk assessment',
  'Client sends invoices',
  'Climate risk & opportunity assessment SUCON',
  'Climate risk disclosure SUCON',
  'Climate risk gap analysis',
  'Climate risk scenario analysis SUCON',
  'Comp GHG',
  'Corporate Compliance Screening',
  'CSRD - DMA - SUCON',
  'CSRD readiness',
  'Demand response',
  'Deposit recovery',
  'E.E.D.',
  'EAC procurement - pull through',
  'EAC/Offset Advisory',
  'EaaS - pull through',
  'ECH',
  'ECLR - SUCON',
  'Ecovadis',
  'ENERGY STAR cert',
  'Enterprise workshop',
  'EPS',
  'ESG marketing',
  'ESG module',
  'ESG report',
  'ESOS',
  'ESPM link',
  'ESPM to RA',
  'EV',
  'GHG',
  'Goals & Projects',
  'Green Tariff',
  'Greenstruxure',
  'GRESB fully managed',
  'GRESB quant',
  'GRESB scorecards',
  'GRI',
  'Historical invoices',
  'IDM',
  'IMP',
  'Incentives/taxes',
  'Insight sourcing',
  'Invoice collection',
  'Invoice collection - light',
  'Invoice recalculation',
  'Invoice variance testing',
  'IREM',
  'ISO 50001',
  'KPI',
  'LEED',
  'Local Law 88',
  'Manual data upload',
  'Materiality assessment SUCON',
  'Microgrid Advisor',
  'Open/Close',
  'Other',
  'Partner scope',
  'Peak alerts',
  'Peer benchmarking SUCON',
  'Power Availability Tool',
  'PPA/VPPA',
  'Procurement contract review',
  'Professional sourcing',
  'Pull through',
  'RA + - pull through',
  'RA AV report',
  'RA dashboards & reporting',
  'RA internal data feed',
  'RA survey',
  'RADAR',
  'Rate optimization',
  'Rebaseline project',
  'Remote assessments',
  'REOA',
  'Reporting gap assessment',
  'Risk managment',
  'Rollout',
  'SASB',
  'SBT AV',
  'Scope 3 estimates',
  'Scope 3 target/roadmap SUCON',
  'SE Bill Pay',
  'SE metering',
  'SEC Reporting',
  'SECR',
  'Sensor audit',
  'SFDR',
  'SSO',
  'Strategic sourcing',
  'Supply Deck',
  'Sustainability exchange SUCON',
  'Target setting/roadmaps SUCON',
  'Tax Equity - pull through',
  'Tax Matrix - pull through',
  'TCFD - UK',
  'UCA',
  'UN PRI - SUCON',
  'UPRs',
  'Utility feeds',
  'Utility screening',
  'Value chain SUCON',
  'Waste data capture',
  'Water Cost Recovery',
  'WELL',
  'Ziego Activate',
  'Ziego Hub',
  'Ziego Network',
  'Ziego Power',
];
````

### src/data/enums.js

````jsx
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

### src/data/serviceCatalog.js

````jsx
// Service catalog metadata used by the Dropdowns › Services subtab.
// Each entry holds the per-service mapping the user defined: BFO Tag,
// Region, recurrence Years, Product Line, and Service Type. The
// Services subtab renders one row per service in the live Solutions
// dropdown list and looks the per-service columns up here. Missing
// services render with empty cells.

export const SERVICE_CATALOG = [
  { name: 'AEM',                                        bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: '-', localProjectName: '#SUSUP' },
  { name: 'AP upload (indirect payment)',               bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Global compliance screening',                bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'API/ETL',                                    bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'Arc performance certs',                      bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'Assurance gap assessment',                   bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Audits',                                     bfoTag: '#SUESP', region: 'NAM',    years: '1 year',  productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project', localProjectName: '#SUESP' },
  { name: 'BBS reporting',                              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Due diligence',                              bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'BECS/BPS screening',                         bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Bespoke consulting SUCON',                   bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Bill payment',                               bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'BPS Reporting',                              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Budgets',                                    bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'CA SB Bills - SUCON',                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Capital asset planning',                     bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Recurring', localProjectName: '#SUESP' },
  { name: 'Cat 1 & 2',                                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 10',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 11',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 12',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 13',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 14',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 15',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 4',                                      bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 8',                                      bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Cat 9',                                      bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP biodiversity',                           bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP biodiversity risk assessment',           bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP climate',                                bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP plastics',                               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP water',                                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'CDP water risk assessment',                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Client sends invoices',                      bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Climate risk & opportunity assessment SUCON', bfoTag: '#SUECO', region: 'NAM',   years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Climate risk disclosure SUCON',              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Climate risk gap analysis',                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Climate risk scenario analysis SUCON',       bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Comp GHG',                                   bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Corporate Compliance Screening',             bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'CSRD - DMA - SUCON',                         bfoTag: '#SUECO', region: 'EU',     years: '1 year',  productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'CSRD readiness',                             bfoTag: '#SUECO', region: 'EU',     years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Demand response',                            bfoTag: '#SUSUP', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Deposit recovery',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'E.E.D.',                                     bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'EAC procurement - pull through',             bfoTag: '#SUREN', region: 'NAM',    years: '3 years', productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Project', localProjectName: '#SUREN' },
  { name: 'EAC/Offset Advisory',                        bfoTag: '#SUREN', region: 'NAM',    years: '3 years', productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Recurring', localProjectName: '#SUREN' },
  { name: 'ECH',                                        bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'ECLR - SUCON',                               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Ecovadis',                                   bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'ENERGY STAR cert',                           bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Enterprise workshop',                        bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project', localProjectName: '#SUESP' },
  { name: 'ESG marketing',                              bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'ESG module',                                 bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'ESG report',                                 bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'ESOS',                                       bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'ESPM link',                                  bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'ESPM to RA',                                 bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'EV',                                         bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: '-', localProjectName: '#SUESP' },
  { name: 'GHG',                                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Goals & Projects',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Local Law 88',                               bfoTag: '#SUSUP', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'GRESB fully managed',                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'GRESB quant',                                bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'GRESB scorecards',                           bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'GRI',                                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Historical invoices',                        bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'IDM',                                        bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'IMP',                                        bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Insight sourcing',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Invoice collection',                         bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Invoice recalculation',                      bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Invoice variance testing',                   bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'LEED',                                       bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Manual data upload',                         bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Materiality assessment SUCON',               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Open/Close',                                 bfoTag: '#DATA',  region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'Other',                                      bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: '-', localProjectName: '#SUSUP' },
  { name: 'Partner scope',                              bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'Peak alerts',                                bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Peer benchmarking SUCON',                    bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Power Availability Tool',                    bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'PPA/VPPA',                                   bfoTag: '#SUREN', region: 'NAM',    years: '3 years', productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Recurring', localProjectName: '#SUREN' },
  { name: 'Procurement contract review',                bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'Professional sourcing',                      bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Pull through',                               bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'RA AV report',                               bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'RA dashboards & reporting',                  bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'RA internal data feed',                      bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'RA survey',                                  bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'RADAR',                                      bfoTag: '#SUECO', region: 'EU',     years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Rate optimization',                          bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Rebasline project',                          bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Remote assessments',                         bfoTag: '#SUESP', region: 'NAM',    years: '1 year',  productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project', localProjectName: '#SUESP' },
  { name: 'REOA',                                       bfoTag: '#SUREN', region: 'NAM',    years: '1 year',  productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Project', localProjectName: '#SUREN' },
  { name: 'Reporting gap assessment',                   bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Risk managment',                             bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'SASB',                                       bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'SBT AV',                                     bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Scope 3 estimates',                          bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Scope 3 target/roadmap SUCON',               bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Invoice collection - light',                 bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'SE metering',                                bfoTag: '#SUSUP', region: 'NAM',    years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'SECR',                                       bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Sensor audit',                               bfoTag: '#DATA',  region: 'EU',     years: '1 year',  productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#DATA' },
  { name: 'SFDR',                                       bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'SSO',                                        bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUSUP' },
  { name: 'Strategic sourcing',                         bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Sustainability exchange SUCON',              bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Target setting/roadmaps SUCON',              bfoTag: '#SUECO', region: 'NAM',    years: '1 year',  productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Tax Equity - pull through',                  bfoTag: '#SUREN', region: 'NAM',    years: '1 year',  productLine: 'SUREN - RENEWABLE ADVIS. SER',   serviceType: 'Project', localProjectName: '#SUREN' },
  { name: 'TCFD - UK',                                  bfoTag: '#SUECO', region: 'EU',     years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'UCA',                                        bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'UN PRI - SUCON',                             bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'UPRs',                                       bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Utility feeds',                              bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Utility screening',                          bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Project', localProjectName: '#SUECO' },
  { name: 'Value chain SUCON',                          bfoTag: '#SUECO', region: 'NAM',    years: '3 years', productLine: 'SUECO - SUSTAINABILITY ECOACT',  serviceType: 'Recurring', localProjectName: '#SUECO' },
  { name: 'Waste data capture',                         bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Water Cost Recovery',                        bfoTag: '#DATA',  region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#DATA' },
  { name: 'Ziego Activate',                             bfoTag: '#SUDIG', region: 'NAM',    years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring', localProjectName: '#SUDIG' },
  { name: 'Ziego Hub',                                  bfoTag: '#SUDIG', region: 'NAM',    years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring', localProjectName: '#SUDIG' },
  { name: 'Ziego Network',                              bfoTag: '#SUDIG', region: 'NAM',    years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring', localProjectName: '#SUDIG' },
  { name: 'Ziego Power',                                bfoTag: '#SUDIG', region: 'EU',     years: '3 years', productLine: 'SUDIG - SB DIGITAL SOLUTIONS',   serviceType: 'Recurring', localProjectName: '#SUDIG' },
  { name: 'ISO 50001',                                  bfoTag: '#SUESP', region: 'EU',     years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Project', localProjectName: '#SUESP' },
  { name: 'Microgrid Advisor',                          bfoTag: '',       region: '',       years: '3 years', productLine: '',                                serviceType: 'Recurring', localProjectName: '' },
  { name: 'Tax Matrix - pull through',                  bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'Building Activate',                          bfoTag: '-',      region: '-',      years: '3 years', productLine: '-',                               serviceType: 'Project', localProjectName: '-' },
  { name: 'EaaS - pull through',                        bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: 'Recurring', localProjectName: '#SUESP' },
  { name: 'ClimVar - EcoAct',                           bfoTag: '#SUSUP', region: 'NAM',    years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: '', localProjectName: '#SUSUP' },
  { name: 'RA + - pull through',                        bfoTag: '#SUSUP', region: '',       years: '3 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: '', localProjectName: '#SUSUP' },
  { name: 'Nature + Biodiversity',                      bfoTag: '',       region: '',       years: '3 years', productLine: '',                                serviceType: '', localProjectName: '' },
  { name: 'EPS',                                        bfoTag: '#SUESP', region: 'NAM',    years: '3 years', productLine: 'SUESP - EFFICIENCY & SUST PROG.', serviceType: '', localProjectName: '#SUESP' },
  { name: 'Recap - CRREM tool',                         bfoTag: '#SUSUP', region: 'Global', years: '4 years', productLine: 'SUSUP - SUPPLY & SUST SERVICES', serviceType: 'Recurring', localProjectName: '#SUSUP' },
  { name: 'SE Bill Pay',                                bfoTag: '#DATA',  region: 'EU',     years: '',        productLine: '',                                serviceType: '-', localProjectName: '#DATA' },
  // Graveyard — kept for reference; flagged so the UI can render them
  // muted / sorted to the bottom when needed.
  { name: 'WELL',              bfoTag: '#SUECO', region: '-',      years: '', productLine: '', serviceType: '-', localProjectName: '#SUECO', graveyard: true },
  { name: 'Incentives/taxes',  bfoTag: '-',      region: '-',      years: '', productLine: '', serviceType: '-', localProjectName: '-', graveyard: true },
  { name: 'SEC Reporting',     bfoTag: '#SUECO', region: 'Dead',   years: '', productLine: '', serviceType: '',  localProjectName: '#SUECO', graveyard: true },
  { name: 'IREM',              bfoTag: '#SUSUP', region: 'Dead',   years: '', productLine: '', serviceType: '-', localProjectName: '#SUSUP', graveyard: true },
  { name: 'KPI',               bfoTag: '#SUECO', region: 'Global', years: '', productLine: '', serviceType: '-', localProjectName: '#SUECO', graveyard: true },
  { name: 'Greenstruxure',     bfoTag: '#SUESP', region: '-',      years: '', productLine: '', serviceType: '',  localProjectName: '#SUESP', graveyard: true },
];

// Map from lower-cased service name → metadata so a lookup ignores
// casing drift between dropdown-list entries and the catalog data.
const SERVICE_BY_NAME = new Map(
  SERVICE_CATALOG.map(s => [s.name.toLowerCase(), s])
);

export function getServiceMetadata(name) {
  if (!name) return null;
  return SERVICE_BY_NAME.get(String(name).toLowerCase()) || null;
}

// Editable per-service fields the Dropdowns › Services subtab exposes.
// The seed values above are the defaults; the user can override any of
// them via settings.serviceOverrides. Local Project Name has no seed —
// it's a user-supplied label that flows into the AI Prompt (New BFO
// Opp) prompt block.
export const SERVICE_EDITABLE_FIELDS = [
  'bfoTag', 'region', 'years', 'productLine', 'serviceType', 'localProjectName',
];

// Merge the static seed catalog with the user's per-service overrides.
// Returns a fully-populated metadata object (every editable field
// present, even if empty) so callers don't have to defensively
// fallback themselves. `overrides` is the raw settings.serviceOverrides
// map keyed by service name (case-insensitive).
export function getEffectiveServiceMetadata(name, overrides) {
  if (!name) return null;
  const key = String(name).toLowerCase();
  const seed = SERVICE_BY_NAME.get(key) || null;
  // Overrides are stored under the original-case name so the
  // Dropdowns view can round-trip them. Look up case-insensitively
  // to forgive casing drift between the Solutions list and the
  // stored map.
  let override = null;
  if (overrides && typeof overrides === 'object') {
    if (overrides[name]) override = overrides[name];
    else {
      for (const k of Object.keys(overrides)) {
        if (k.toLowerCase() === key) { override = overrides[k]; break; }
      }
    }
  }
  if (!seed && !override) {
    return {
      name, bfoTag: '', region: '', years: '',
      productLine: '', serviceType: '', localProjectName: '',
    };
  }
  return {
    name,
    bfoTag:           override?.bfoTag           ?? seed?.bfoTag           ?? '',
    region:           override?.region           ?? seed?.region           ?? '',
    years:            override?.years            ?? seed?.years            ?? '',
    productLine:      override?.productLine      ?? seed?.productLine      ?? '',
    serviceType:      override?.serviceType      ?? seed?.serviceType      ?? '',
    localProjectName: override?.localProjectName ?? seed?.localProjectName ?? '',
    graveyard: seed?.graveyard || false,
  };
}
````

### src/data/serviceQuestions.js

````jsx
// Canned questions seeded into the Opportunity form's question tables when
// a service appears in "Scope Being Explored". These are the DEFAULTS — the
// Dropdowns → Questions subtab can override them per service (stored in
// settings.serviceQuestions / settings.serviceTheirQuestions), and the
// OpportunityForm seeding prefers an override when one exists.

// 'Questions to Ask Them' — a plain list of questions per service.
export const SERVICE_QUESTIONS = {
  'bill payment': [
    'Can you tell us a bit more about our current bill payment program?',
    'How many utility accounts are you managing each month?',
    "How often do you catch billing errors, and what's your process when you do?",
    'Have you ever been hit with late fees or service disruptions? How did that come about?',
    'What does your approval workflow look like, and where does it tend to get stuck?',
  ],
  'budgets': [
    'How do you build your energy budget today? Is it based on prior year actuals, a rate forecast, or something else?',
    "How do you account for weather variability, rate changes, or new sites when you're forecasting?",
    'How close did your actuals come to budget last year, and where were the biggest misses?',
    'How many reforecasts do you do per year?',
  ],
  'rate optimization': [
    'How often do you screen for new regulated rate opportunities?',
    'What kind of regulated rate savings have you seen over the past several years?',
  ],
  'microgrid advisor': [
    'Do they already have batteries in place? If so, where?',
    'What is their main objective they are trying to solve for?',
    "If they don't have batteries in place, what are they looking for? Just BESS or any sort of MG?",
    'How do they plan to fund?',
    'What is their lead time objective?',
  ],
};

// 'Questions They Might Ask' per service, paired with a suggested
// 'Our Response'. Responses may be blank — those rows seed the prompt but
// leave the answer for Dan to craft in the moment.
export const SERVICE_THEIR_QUESTIONS = {
  'bill payment': [
    { question: "What's your process for onboarding new sites or accounts?", response: '' },
    { question: 'Do you integrate with our ERP/AP system, or will we need to manually import data?', response: '' },
    { question: 'What does the approval workflow look like on our end — can we customize it?', response: '' },
    { question: 'How do you handle exceptions, disputes, and bills that fall outside normal parameters?', response: '' },
  ],
  'budgets': [
    { question: "What's your forecasting methodology, and how accurate have you been historically?", response: '' },
    { question: 'How do you handle weather normalization and rate volatility?', response: '' },
    { question: 'How do you factor in our operational changes — new sites, closures, expansions?', response: '' },
    { question: 'Can you model "what-if" scenarios for us?', response: '' },
  ],
  'rate optimization': [
    { question: 'Do you scan all sites and rate schedules?', response: "With our hunting license approach, we only go after utilities where we have a good chance of finding savings. You would not want to pay us to search where it doesn't make sense." },
    { question: 'How often do you scan for new rates?', response: '' },
    { question: "What's a typical savings percentage you find for companies like ours?", response: '' },
    { question: 'Who handles the actual rate switch — you or us?', response: '' },
  ],
};
````

### src/data/emailSignature.js

````jsx
// Shared default email signature block. Used by DraftEmailView as its
// initial signature state, and by ProspectModal's Follow-Up Email path as
// the fallback when the user hasn't explicitly saved a signature to
// settings.emailSignature.
export const DEFAULT_EMAIL_SIGNATURE = '<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 7.5pt; color: #5F5F5F; line-height: 1.5;"><tbody><tr><td style="vertical-align: top;"><table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 7.5pt; color: #5F5F5F;"><tbody><tr><td colspan="3" style="font-family: Arial, sans-serif; padding-bottom: 2px;"><strong style="color: #82C168; font-size: 10pt; font-family: Arial, sans-serif;">Dan Baldauf</strong></td></tr><tr><td style="vertical-align: top; padding-right: 24px; font-family: Arial, sans-serif;">Senior Manager<br>Schneider Electric Advisory<br>Services</td><td style="vertical-align: top; padding-right: 24px; white-space: nowrap; font-family: Arial, sans-serif;">C&nbsp; +1 (917) 787 1701<br>E&nbsp; <a href="mailto:daniel.baldauf@se.com" style="color: #0000EE; text-decoration: underline; font-size: 7.5pt; font-family: Arial, sans-serif;">daniel.baldauf@se.com</a></td><td style="vertical-align: top; white-space: nowrap; text-align: right; font-family: Arial, sans-serif;">1216 Broadway<br>New York, NY<br>10001 USA</td></tr><tr><td colspan="3" style="padding-top: 8px; font-family: Arial, sans-serif; font-size: 9pt;">Here is a <a href="https://outlook.office.com/bookwithme/user/466302b21b9e46f08ce1a412c14e5573%40se.com/meetingtype/SVRwCe7HMUGxuT6WGxi68g2?anonymous&amp;ismsaljsauthenabled" style="color: #0000EE; text-decoration: underline; font-size: 9pt; font-family: Arial, sans-serif;">link</a> to schedule a meeting on my calendar</td></tr></tbody></table></td></tr></tbody></table>';
````

### src/utils/db.js

````jsx
// SHIM for the Lovable export.
//
// The real module is an IndexedDB wrapper with per-user object stores
// (cached opportunities, the Opps backup history, HubSpot contacts,
// pricing-option links, …). Rather than ship a full IndexedDB layer,
// this shim backs the same async API with `localStorage`, namespaced by
// store + key. That's plenty for the demo and has one nice property the
// in-memory version wouldn't: your edits to the Opps table survive a
// page reload, because `saveOpps2Cache` lands here.
//
// Values are JSON-serialized. The Opps dataset can grow large; if it
// ever exceeds the ~5 MB localStorage quota a write will throw, which we
// swallow (the caller treats persistence as best-effort).

let userId = null;
const PREFIX = 'agx'; // agents-export

export function setDbUserId(uid) { userId = uid || null; }
export function getDbUserId() { return userId; }
export function openDB() { return Promise.resolve(null); }

function fullKey(storeName, key) {
  return `${PREFIX}::${userId || 'anon'}::${storeName}::${key}`;
}

export async function dbGet(storeName, key) {
  try {
    const raw = localStorage.getItem(fullKey(storeName, key));
    return raw == null ? undefined : JSON.parse(raw);
  } catch { return undefined; }
}

export async function dbGetAll(storeName) {
  const out = [];
  const scan = `${PREFIX}::${userId || 'anon'}::${storeName}::`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(scan)) {
        try { out.push(JSON.parse(localStorage.getItem(k))); } catch { /* skip */ }
      }
    }
  } catch { /* localStorage unavailable */ }
  return out;
}

export async function dbPut(storeName, value, key) {
  try {
    localStorage.setItem(fullKey(storeName, key ?? 'data'), JSON.stringify(value));
  } catch (err) {
    console.warn('db shim: localStorage write failed (quota?)', err);
  }
}

export async function dbDelete(storeName, key) {
  try { localStorage.removeItem(fullKey(storeName, key)); } catch { /* ignore */ }
}
````

### src/utils/userLs.js

````jsx
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

### src/utils/apiFetch.js

````jsx
// SHIM for the Lovable export.
//
// The real helper attaches the signed-in user's Firebase ID token and
// hits this app's serverless `/api/*` routes (e.g. emailing the New Opps
// digest, saving email schedules). None of those endpoints exist in the
// export, so we short-circuit to a Response-like object that reports the
// feature as unavailable. Every caller already does `if (!res.ok) throw`,
// so the affected modal surfaces a clean error instead of crashing — and
// none of these run on page load, so the page mounts fine.

export async function apiFetch() {
  return {
    ok: false,
    status: 501,
    async json() { return { error: 'This action calls a backend API that is not part of the standalone export.' }; },
    async text() { return 'Not available in the standalone export.'; },
  };
}
````

### src/utils/oppsCache.js

````jsx
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

### src/utils/opps2Store.js

````jsx
// SHIM for the Lovable export.
//
// The original module synced the Opps dataset to a chunked Firestore
// document AND an IndexedDB cache, keeping the two in lock-step with a
// field-level merge. The export is offline, so:
//
//   • The pure conflict-resolution core (`stampUpdatedAt`,
//     `mergeOpps2Datasets` and its helpers) is kept VERBATIM — it's the
//     interesting part to recreate and it needs no backend.
//   • The IndexedDB cache reads/writes go through the localStorage-backed
//     `db` shim, so edits persist across reloads.
//   • All Firestore functions are no-ops. `loadOpps2FromFirestore`
//     returns null; the save variants resolve without doing anything.
//   • `loadOpps2Cache` lazily SEEDS the demo dataset (see
//     ../data/sampleData) the first time, so the Opps table renders with
//     realistic rows out of the box. Once you edit, your version in
//     localStorage takes over.

import { dbGet, dbPut } from './db';
import { SAMPLE_OPPS2 } from '../data/sampleData';

export const OPPS2_STORE = 'opps2-cache';
export const OPPS2_CACHE_KEY = 'data';
export const OPPS2_FIRESTORE_COLLECTION = 'opps2Data';

export function stampUpdatedAt(data) {
  return { ...(data || {}), _updatedAt: Date.now() };
}

// ----- pure conflict-resolution core (verbatim from the app) -----------
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000; // prune deletes older than ~6 months

function fieldTime(row, fieldStamps, key) {
  const t = fieldStamps && Number(fieldStamps[key]);
  return Number.isFinite(t) ? t : (Number(row._rowUpdatedAt) || 0);
}

function mergeOpps2Row(a, b) {
  const aFs = a._fieldUpdatedAt || null;
  const bFs = b._fieldUpdatedAt || null;
  if (!aFs && !bFs) {
    return (Number(b._rowUpdatedAt) || 0) > (Number(a._rowUpdatedAt) || 0) ? b : a;
  }
  const out = { ...a };
  const stamps = { ...(aFs || {}) };
  for (const k of Object.keys(b)) {
    if (k === '_fieldUpdatedAt' || k === '_rowUpdatedAt') continue;
    if (!(k in a)) {
      out[k] = b[k];
      if (bFs && bFs[k] != null) stamps[k] = Number(bFs[k]);
    } else if (fieldTime(b, bFs, k) > fieldTime(a, aFs, k)) {
      out[k] = b[k];
      if (bFs && bFs[k] != null) stamps[k] = Number(bFs[k]);
    }
  }
  out._id = a._id;
  out.id = a.id ?? b.id;
  out._rowUpdatedAt = Math.max(Number(a._rowUpdatedAt) || 0, Number(b._rowUpdatedAt) || 0);
  if (Object.keys(stamps).length) out._fieldUpdatedAt = stamps;
  return out;
}

export function mergeOpps2Datasets(base, incoming) {
  const byId = (arr) => {
    const m = new Map();
    for (const r of (arr?.records || [])) {
      if (r && r._id != null) m.set(String(r._id), r);
    }
    return m;
  };
  const baseById = byId(base);
  const incomingById = byId(incoming);

  const merged = [];
  const seen = new Set();
  for (const [id, baseRow] of baseById) {
    seen.add(id);
    const incomingRow = incomingById.get(id);
    merged.push(incomingRow ? mergeOpps2Row(baseRow, incomingRow) : baseRow);
  }
  for (const [id, incomingRow] of incomingById) {
    if (!seen.has(id)) merged.push(incomingRow);
  }

  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  const deletedIds = {};
  for (const src of [base?._deletedIds, incoming?._deletedIds]) {
    if (!src) continue;
    for (const [id, t] of Object.entries(src)) {
      const ts = Number(t) || 0;
      if (ts >= cutoff && ts > (deletedIds[id] || 0)) deletedIds[id] = ts;
    }
  }
  const records = merged.filter(r => {
    const t = deletedIds[String(r._id)];
    return t == null || (Number(r._rowUpdatedAt) || 0) > t;
  });

  const baseHeaders = base?.headers || incoming?.headers || [];
  const headerSet = new Set(baseHeaders);
  const extraHeaders = (incoming?.headers || []).filter(h => h && !headerSet.has(h));
  const headers = extraHeaders.length ? [...baseHeaders, ...extraHeaders] : baseHeaders;

  const out = {
    ...(incoming || {}),
    ...(base || {}),
    headers,
    records,
    columnLinks: base?.columnLinks ?? incoming?.columnLinks,
    dropdownLists: base?.dropdownLists ?? incoming?.dropdownLists,
  };
  if (Object.keys(deletedIds).length) out._deletedIds = deletedIds;
  else delete out._deletedIds;
  return out;
}

// ----- cache (localStorage-backed) + seeded demo data ------------------
let seeded = false;

export async function loadOpps2Cache() {
  try {
    const existing = await dbGet(OPPS2_STORE, OPPS2_CACHE_KEY);
    if (existing) return existing;
    // First run: seed the demo dataset so the table isn't empty.
    if (!seeded) {
      seeded = true;
      const seed = stampUpdatedAt(SAMPLE_OPPS2);
      await dbPut(OPPS2_STORE, seed, OPPS2_CACHE_KEY);
      return seed;
    }
    return null;
  } catch (err) {
    console.error('opps2: cache load failed', err);
    return stampUpdatedAt(SAMPLE_OPPS2);
  }
}

export async function saveOpps2Cache(data) {
  try { await dbPut(OPPS2_STORE, stampUpdatedAt(data), OPPS2_CACHE_KEY); }
  catch (err) { console.error('opps2: cache save failed', err); }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('opps2-cache-updated'));
    }
  } catch { /* CustomEvent unavailable */ }
}

// ----- Firestore functions → offline no-ops ----------------------------
export async function loadOpps2FromFirestore() {
  return null;
}

export async function saveOpps2ToFirestore(_userId, data) {
  return stampUpdatedAt(data)._updatedAt;
}

export async function trySaveOpps2ToFirestore(_userId, data) {
  return stampUpdatedAt(data)._updatedAt;
}

export async function flushOpps2ToFirestore(userId, data) {
  if (!userId || !data) return null;
  // No cloud to flush to; just keep the local cache current.
  try { await saveOpps2Cache(data); } catch { /* best-effort */ }
  return null;
}

export async function loadOpps2Newest() {
  return loadOpps2Cache();
}

// Set a single field on one opp (used by external views in the full app).
// Kept so the API surface matches; operates on the local cache only.
export async function setOppField(userId, oppId, field, value) {
  const data = await loadOpps2Newest(userId);
  if (!data || !Array.isArray(data.records)) {
    throw new Error('Opps data has not loaded yet.');
  }
  let found = false;
  const records = data.records.map((r) => {
    if (String(r?._id) === String(oppId)) {
      found = true;
      const now = Date.now();
      const prevStamps = (r._fieldUpdatedAt && typeof r._fieldUpdatedAt === 'object') ? r._fieldUpdatedAt : null;
      return { ...r, [field]: value, _rowUpdatedAt: now, _fieldUpdatedAt: { ...(prevStamps || {}), [field]: now } };
    }
    return r;
  });
  if (!found) throw new Error(`Opp #${oppId} not found on Opps.`);
  const next = { ...data, records };
  await saveOpps2Cache(next);
  return next;
}

export async function setOppBfoLink(userId, oppId, bfoLink) {
  return setOppField(userId, oppId, 'BFO Link', bfoLink);
}

export async function bulkSetOppField(userId, oppIds, field, value) {
  const ids = new Set((oppIds || []).map(id => String(id)));
  if (ids.size === 0) return 0;
  const data = await loadOpps2Newest(userId);
  if (!data || !Array.isArray(data.records)) {
    throw new Error('Opps data has not loaded yet.');
  }
  let changed = 0;
  const now = Date.now();
  const records = data.records.map((r) => {
    if (!ids.has(String(r?._id))) return r;
    changed += 1;
    const prevStamps = (r._fieldUpdatedAt && typeof r._fieldUpdatedAt === 'object') ? r._fieldUpdatedAt : null;
    return { ...r, [field]: value, _rowUpdatedAt: now, _fieldUpdatedAt: { ...(prevStamps || {}), [field]: now } };
  });
  if (changed === 0) return 0;
  await saveOpps2Cache({ ...data, records });
  return changed;
}
````

### src/utils/salesforceLeads.js

````jsx
// Shared Salesforce-link helpers for Marketing Leads. The Marketing Leads
// table stores each lead's Salesforce record link (or bare record id) in
// its `sfUrl` field; both that table and the Agents Activity table (which
// logs activity against a matched lead) resolve those values the same way,
// so the logic lives here rather than being duplicated.

// The Salesforce Lightning instance these leads live on. Relative record
// links pulled off the clipboard HTML are resolved against this, and a
// bare Lead record id is expanded into a record URL here.
export const SF_INSTANCE_URL = 'https://se.lightning.force.com';

// Resolve a stored Salesforce Link cell value into a clickable URL, or
// null when it isn't linkable. Accepts a full http(s) URL as-is, and
// expands a bare 15- or 18-char Salesforce record id into a Lead record
// URL on the instance above.
export function resolveSfUrl(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(v)) {
    return `${SF_INSTANCE_URL}/lightning/r/Lead/${v}/view`;
  }
  return null;
}
````

### src/utils/companyNorm.js

````jsx
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
  const key = headers.find(k => /company|name|organi[sz]ation|signatory|entity/i.test(k));
  return key || headers[0];
}
````

### src/utils/hubspotContactsCache.js

````jsx
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

### src/utils/dropdownListsStore.js

````jsx
import { DROPDOWN_LISTS, SOLUTIONS_CATALOG } from '../data/dropdownLists';

// The Solutions / Service Catalog is shown alongside the named lists
// on the Dropdowns page but lives in a separate constant. Surface it
// here as a virtual list keyed `solutions` so the rest of the app can
// treat every Dropdowns-tab vocabulary uniformly (label, key, options).
const SOLUTIONS_LIST = {
  key: 'solutions',
  label: 'Solutions / Service Catalog',
  options: SOLUTIONS_CATALOG,
};

// The full set of built-in lists the Dropdowns tab knows about. Order
// matters here: it's the order the cards render in.
export const BUILTIN_DROPDOWN_LISTS = [...DROPDOWN_LISTS, SOLUTIONS_LIST];

// User-defined lists live under `custom:` to keep them out of the
// built-in keyspace. New keys are slugged from the label + a short
// suffix so similar labels don't collide.
export const CUSTOM_LIST_PREFIX = 'custom:';
export function isCustomListKey(key) { return String(key || '').startsWith(CUSTOM_LIST_PREFIX); }
export function makeCustomListKey(label) {
  const slug = String(label || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
  return `${CUSTOM_LIST_PREFIX}${slug}:${Date.now().toString(36)}`;
}

// Apply user customizations on top of the built-in vocabulary:
//   settings.dropdownLists       → per-list option overrides
//   settings.dropdownListLabels  → per-list label renames (built-ins and customs)
//   settings.dropdownListsHidden → array of built-in keys to omit
//   settings.dropdownCustomLists → user-created lists [{ key, label, options }]
// Returns one flat { key, label, options, builtin } array so callers
// (Dropdowns view, column linking) can stay on one code path.
export function getEffectiveDropdownLists(settings) {
  const optionOverrides = settings?.dropdownLists || {};
  const labelOverrides = settings?.dropdownListLabels || {};
  const hidden = new Set(Array.isArray(settings?.dropdownListsHidden) ? settings.dropdownListsHidden : []);
  const customLists = Array.isArray(settings?.dropdownCustomLists) ? settings.dropdownCustomLists : [];

  const out = [];
  for (const list of BUILTIN_DROPDOWN_LISTS) {
    if (hidden.has(list.key)) continue;
    const options = Array.isArray(optionOverrides[list.key]) ? optionOverrides[list.key] : list.options;
    const label = labelOverrides[list.key] || list.label;
    out.push({ key: list.key, label, options, builtin: true });
  }
  for (const list of customLists) {
    if (!list?.key) continue;
    const options = Array.isArray(optionOverrides[list.key])
      ? optionOverrides[list.key]
      : (Array.isArray(list.options) ? list.options : []);
    const label = labelOverrides[list.key] || list.label || 'Untitled list';
    out.push({ key: list.key, label, options, builtin: false });
  }
  return out;
}
````

### src/utils/eventsStore.js

````jsx
// Shared helpers for the Events feature (Contacts → Events subtab and
// the "Add to event" section in the contact popup). Events live in
// Firestore settings under `settings.events`:
//
//   events: [{ id, name, date, location, notes, attendees: [
//     { contactId, name, email, company, title }
//   ] }]
//
// HubSpot contacts are stored with their contactId so the same person
// can be added from the contact popup or the Events subtab and de-dupe
// against each other. Manual (non-HubSpot) attendees have an empty
// contactId.

export function contactDisplayName(contact) {
  const name = [contact?.firstname, contact?.lastname].filter(Boolean).join(' ').trim();
  return name || contact?.email || contact?.company || 'Unnamed contact';
}

export function contactKey(contact) {
  return String(contact?.id || contact?.vid || '');
}

// Build the stored attendee shape from a HubSpot contact record.
export function attendeeFromContact(contact) {
  return {
    contactId: contactKey(contact),
    name: contactDisplayName(contact),
    email: contact?.email || '',
    company: contact?.company || '',
    title: contact?.jobtitle || '',
  };
}

// Is this contact already saved as an attendee on the event?
export function isContactInEvent(event, contactId) {
  const id = String(contactId || '');
  if (!id) return false;
  const list = Array.isArray(event?.attendees) ? event.attendees : [];
  return list.some(a => a.contactId && String(a.contactId) === id);
}

// Return a new events array with `contact` toggled on/off the event
// identified by `eventId`. Adds when absent, removes when present.
export function toggleContactInEvents(events, eventId, contact) {
  const id = contactKey(contact);
  if (!id) return Array.isArray(events) ? events : [];
  return (Array.isArray(events) ? events : []).map(ev => {
    if (ev.id !== eventId) return ev;
    const list = Array.isArray(ev.attendees) ? ev.attendees : [];
    const exists = list.some(a => a.contactId && String(a.contactId) === id);
    const attendees = exists
      ? list.filter(a => !(a.contactId && String(a.contactId) === id))
      : [...list, attendeeFromContact(contact)];
    return { ...ev, attendees };
  });
}
````

### src/utils/listFlags.js

````jsx
import { userLsGet } from './userLs';

// Shared helper for computing "which Lists-tab lists is this company
// flagged on" across the app. Used by MyAccountsView's List Flags
// column and the Portfolio Companies table / export.
//
// Strict-mapping mode: a flag turns on only when the user has explicitly
// confirmed a mapping for that list — in either the My Accounts column
// or the Portfolio Companies column on the Lists page. Live fuzzy
// suggestions don't count, since they can light up flags for raw list
// entries the user never decided about. Stale flags from before the
// flag definition tightened were caused by the suggestion path; running
// this version once resolves them.
export const LIST_FLAG_SOURCES = [
  { label: 'RECA',     storageKey: 'reca-clients-override', color: { bg: '#DBEAFE', text: '#1E40AF' } },
  { label: 'CSRD',     storageKey: 'csrd-list-override',    color: { bg: '#EDE9FE', text: '#5B21B6' } },
  { label: 'CDP',      storageKey: 'cdp-list-override',     color: { bg: '#DCFCE7', text: '#166534' } },
  { label: 'GRESB',    storageKey: 'gresb-list-override',   color: { bg: '#FEF3C7', text: '#92400E' } },
  { label: 'SBT',      storageKey: 'sbt-list-override',     color: { bg: '#FCE7F3', text: '#9D174D' } },
  { label: 'Ecovadis', storageKey: 'ecovadis-list-override', color: { bg: '#E0F2FE', text: '#075985' } },
  { label: 'UN PRI',   storageKey: 'unpri-list-override',   color: { bg: '#F3E8FF', text: '#6B21A8' } },
  { label: 'CA SB',    storageKey: 'casb-list-override',    color: { bg: '#FFEDD5', text: '#9A3412' } },
  { label: 'NZAM',     storageKey: 'nzam-list-override',    color: { bg: '#CCFBF1', text: '#115E59' } },
];
export const LIST_FLAG_BY_LABEL = Object.fromEntries(
  LIST_FLAG_SOURCES.map(s => [s.label, s])
);
// All framework / list-flag labels, in display order, so the modal's
// Frameworks dropdown and the My Accounts column read from the same
// vocabulary.
export const ALL_FRAMEWORK_LABELS = LIST_FLAG_SOURCES.map(s => s.label);

const LIST_CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|lp|llp|sa|ag|gmbh|nv|bv|oy|ab|spa|kk|pty|holdings|group|grp)\b\.?/g;
export function normalizeListCompany(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(LIST_CORP_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Fuzzy company-name match (looser than normalizeListCompany) so we
// catch cases like "Blue Owl" ↔ "Blue Owl Capital". Mirrors the
// MyAccountsView companiesMatch helper exactly so the two views stay
// consistent.
export function companiesMatch(a, b) {
  const na = (a || '').toLowerCase().trim();
  const nb = (b || '').toLowerCase().trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
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
  return false;
}

export function pickListNameKey(headers) {
  if (!headers?.length) return null;
  return headers.find(k => /company|name|organi[sz]ation|signatory|entity/i.test(k)) || headers[0];
}

// List mappings (which row maps to which prospect/portfolio company)
// are personal salesperson curation, so they're scoped per user via
// userLs. The lists themselves stay shared per CLAUDE.md.
export function safeReadListMapping(storageKey) {
  try {
    const raw = userLsGet(storageKey);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

// Compute which framework labels each of the given company names should
// show. Returns a Map keyed by the lowercased-trimmed company name to a
// Set of labels (e.g. 'CDP', 'GRESB'). A label turns on when EITHER:
//   - The prospect's frameworks array (manual edits from the modal)
//     includes that label.
//   - The Lists page has a confirmed mapping (My Accounts or Portfolio
//     scope) on the corresponding list pointing to that company.
// The union means the Lists page and the modal are the same data: an
// edit in either surface shows up in both.
//
// The function is async for backwards compatibility with existing call
// sites that await it; the body itself runs synchronously.
export async function computeListFlags(names, opts = {}) {
  const flags = new Map();
  const addFlag = (companyKey, label) => {
    if (!companyKey) return;
    if (!flags.has(companyKey)) flags.set(companyKey, new Set());
    flags.get(companyKey).add(label);
  };
  const targets = (names || [])
    .filter(Boolean)
    .map(n => ({ company: n, key: String(n).toLowerCase().trim() }))
    .filter(t => t.key);
  if (!targets.length) return flags;

  // Pull in the prospect.frameworks signal. We match a prospect to a
  // target name by exact lowercased-trimmed equality on `company` —
  // tighter than companiesMatch on purpose, since this side has a real
  // identifier to anchor on.
  const prospectsByKey = new Map();
  for (const p of (opts.prospects || [])) {
    const key = String(p?.company || '').toLowerCase().trim();
    if (key) prospectsByKey.set(key, p);
  }
  for (const t of targets) {
    const p = prospectsByKey.get(t.key);
    if (!p || !Array.isArray(p.frameworks)) continue;
    for (const label of p.frameworks) {
      if (typeof label === 'string' && label) addFlag(t.key, label);
    }
  }

  for (const source of LIST_FLAG_SOURCES) {
    const myAccountsMapping = safeReadListMapping(`${source.storageKey}:my-accounts-mapping`);
    const portfolioMapping = safeReadListMapping(`${source.storageKey}:portfolio-mapping`);
    // Confirmed values from either mapping store flag the matching
    // target. Both stores hold values keyed by an opaque match key —
    // the values are the prospect/portfolio company names the user
    // confirmed. We only care about those values.
    for (const confirmed of [...Object.values(myAccountsMapping), ...Object.values(portfolioMapping)]) {
      if (typeof confirmed !== 'string' || !confirmed) continue;
      for (const t of targets) {
        if (companiesMatch(t.company, confirmed)) {
          addFlag(t.key, source.label);
          break;
        }
      }
    }
  }
  return flags;
}
````

### src/utils/newOppsDigestEmail.js

````jsx
// Build a downloadable Outlook draft (.eml) of the New Opps digest email.
//
// This mirrors the *scheduled* New Opps email exactly — the fixed
// 8-column black-and-white table from api/_lib/newOpps.js
// (NEW_OPPS_EMAIL_COLUMNS + buildNewOppsTableHtml + the sendNewOppsEmail
// body wrapper) — so a downloaded draft reads identically to what the
// cron would send, just authored in the user's own Outlook instead of
// going out from the Gmail account. Keep this in lock-step with
// api/_lib/newOpps.js.
//
// The .eml carries an `X-Unsent: 1` header, which Outlook (desktop)
// honors by opening the file as an editable, unsent draft rather than a
// received message — so the user can review, tweak, and send it themselves.

// Fixed digest columns, in order. Mirrors NEW_OPPS_EMAIL_COLUMNS in
// api/_lib/newOpps.js. The "BFO Address" column renders the literal text
// "BFO Link" hyperlinked to the row's BFO Address.
const DIGEST_COLUMNS = [
  { key: 'Account', label: 'Account' },
  { key: 'Stage', label: 'Stage' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Source', label: 'Source' },
  { key: 'Start Date', label: 'Start Date', value: (r) => formatShortDate(r['Start Date']) },
  { key: 'Quoted Amount', label: 'Deal Size', align: 'right' },
  { key: 'Next Steps', label: 'Next Steps' },
  { key: 'BFO Address', label: 'BFO Link' },
];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Steps inside a single Next Steps box are stored with U+2028 separators
// (and "\n"); render both as <br> so the note stacks instead of running on.
function escapeHtmlMultiline(s) {
  return escapeHtml(s).replace(/\u2028|\r?\n/g, '<br>');
}

// Short date (M/D/YYYY), falling back to the raw value when unparseable.
function formatShortDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  if (Number.isNaN(t)) return s;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

const cellValue = (r, c) => (c.value ? c.value(r) : (r[c.key] ?? ''));

// The SE-free, black-and-white bordered digest table. Mirrors
// buildNewOppsTableHtml in api/_lib/newOpps.js.
export function buildNewOppsDigestTableHtml(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return '<p style="color:#000000;font-size:13px;margin:0">No new opportunities to report.</p>';
  }

  const BORDER = '1px solid #000000';
  const thAlign = (c) => (c.align === 'right' ? 'right' : 'left');
  const head = DIGEST_COLUMNS.map((c) =>
    `<th style="text-align:${thAlign(c)};padding:6px 10px;font:700 13px Arial,sans-serif;color:#000000;border:${BORDER};white-space:nowrap">${escapeHtml(c.label)}</th>`
  ).join('');

  const bfoUrl = (r) => {
    const u = String(r['BFO Address'] || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  };
  const link = (href, text) =>
    `<a href="${escapeHtml(href)}" style="color:#000000;text-decoration:underline">${escapeHtml(text)}</a>`;

  const rows = records.map((r) => {
    const cells = DIGEST_COLUMNS.map((c) => {
      const v = cellValue(r, c);
      let inner;
      if (c.key === 'BFO Address') {
        const url = bfoUrl(r);
        inner = url ? link(url, 'BFO Link') : '';
      } else if (c.key === 'Next Steps') {
        inner = escapeHtmlMultiline(v);
      } else {
        inner = escapeHtml(v);
      }
      return `<td style="text-align:${thAlign(c)};padding:6px 10px;font:13px Arial,sans-serif;color:#000000;border:${BORDER};vertical-align:top">${inner}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:4px 0 8px;border:${BORDER}">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// Full email body for the Outlook draft: greeting ("Hey Keith,"), optional
// intro message, the digest table, then the user's saved email signature
// (the same `settings.emailSignature` HTML the Draft Email tab appends to
// its drafts — see DraftEmailView's buildStyledBodyHtml).
export function buildNewOppsDigestEmailHtml(records, { message = '', greeting = '', signature = '' } = {}) {
  // Explicit <br> blank lines (rather than CSS margins, which Outlook can
  // collapse) so a clear empty line separates the greeting from the table
  // and the table from the signature.
  const hello = greeting
    ? `<p style="color:#000000;font-size:14px;margin:0">${escapeHtml(greeting)}</p><br>`
    : '';
  const intro = message
    ? `<p style="color:#334155;font-size:14px;white-space:pre-wrap;margin:0 0 16px">${escapeHtml(message)}</p>`
    : '';
  const table = buildNewOppsDigestTableHtml(records);
  // The signature is stored as trusted HTML (pasted by the user in the
  // Draft Email tab's signature editor) — appended verbatim, same as the
  // Draft Email .eml export does.
  const sigBlock = signature ? `<br><br><div>${signature}</div>` : '';
  return `<div style="font-family:Arial,sans-serif;max-width:920px;margin:0 auto">${hello}${intro}${table}${sigBlock}</div>`;
}

// Base64 of a UTF-8 string, wrapped at 76 chars per MIME conventions.
function base64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/.{76}/g, '$&\r\n');
}

// Assemble a minimal RFC 822 message whose body is the HTML email. The
// `X-Unsent: 1` header tells Outlook to open it as an editable draft.
export function buildNewOppsEml({ to = '', subject = 'Dan B New Opportunities', html = '' } = {}) {
  const headers = [
    'X-Unsent: 1',
    to ? `To: ${to}` : null,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${base64Utf8(html)}\r\n`;
}

// Build + download an Outlook draft (.eml) of the New Opps digest for the
// given records. Returns the number of opps included.
export function downloadNewOppsOutlookDraft(records, {
  to = 'keith.mchugh@se.com',
  subject = 'Dan B New Opportunities',
  message = '',
  greeting = 'Hey Keith,',
  signature = '',
} = {}) {
  const html = buildNewOppsDigestEmailHtml(records, { message, greeting, signature });
  const eml = buildNewOppsEml({ to, subject, html });
  const blob = new Blob([eml], { type: 'message/rfc822' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `new-opps-${new Date().toISOString().slice(0, 10)}.eml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return Array.isArray(records) ? records.length : 0;
}
````

### src/utils/newOppsEmailTable.js

````jsx
// Client-side builder for the Opps 2 "Email table" export (Mass Edit →
// Email table). Renders the selected opps as a plain black-and-white HTML
// table — borders only, no fill colors, zebra striping, or brand styling —
// so it pastes into an email as a clean grid. Which columns appear (and
// their order) is chosen by the caller in the export modal.

import { buildNewOppsEml } from './newOppsDigestEmail';

// Columns available to the export, in their default order. Mirrors the New
// Opps report column set; `align: 'right'` for the numeric columns.
export const NEW_OPPS_EMAIL_COLUMNS = [
  { key: 'Account', label: 'Account' },
  { key: 'Open Year', label: 'Open Year' },
  { key: 'Contact', label: 'Contact' },
  { key: 'Stage', label: 'Stage' },
  { key: 'Scope', label: 'Scope' },
  { key: 'Source', label: 'Source' },
  { key: 'Type', label: 'Type' },
  { key: 'Sales Partner', label: 'Sales Partner' },
  { key: 'Start Date', label: 'Start Date' },
  { key: 'Status', label: 'Status' },
  { key: 'Quoted Amount', label: 'Deal Size', align: 'right' },
  { key: 'Sites', label: 'Sites', align: 'right' },
  { key: 'Next Steps', label: 'Next Steps' },
  { key: 'BFO Link', label: 'BFO Opportunity Name' },
  { key: 'BFO Address', label: 'BFO Address' },
];

export const NEW_OPPS_EMAIL_COLUMN_KEYS = NEW_OPPS_EMAIL_COLUMNS.map((c) => c.key);

// Columns checked by default when the export modal opens. The rest stay
// available to toggle on. BFO Address is included; its cells render the
// text "BFO Link" hyperlinked to the BFO Address URL (see buildNewOppsTableHtml).
export const NEW_OPPS_EMAIL_DEFAULT_COLUMN_KEYS = [
  'Account', 'Stage', 'Scope', 'Source', 'Start Date', 'Quoted Amount', 'Next Steps', 'BFO Address',
];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Steps inside a single Next Steps box are stored with U+2028 line
// separators (and steps with "\n"); render both as <br> so a multi-line
// note reads as stacked lines in the table rather than one run-on string.
function escapeHtmlMultiline(s) {
  return escapeHtml(s).replace(/\u2028|\r?\n/g, "<br>");
}

// Build a plain bordered table for the given records. `columnKeys` selects
// and orders the columns (any subset of NEW_OPPS_EMAIL_COLUMNS); when
// omitted, all columns in default order are used. Black text on white with
// 1px solid black cell borders — no other styling.
export function buildNewOppsTableHtml(records, columnKeys) {
  const byKey = new Map(NEW_OPPS_EMAIL_COLUMNS.map((c) => [c.key, c]));
  const keys = Array.isArray(columnKeys) ? columnKeys : NEW_OPPS_EMAIL_COLUMN_KEYS;
  const columns = keys.map((k) => byKey.get(k)).filter(Boolean);

  if (!Array.isArray(records) || records.length === 0 || columns.length === 0) {
    return '<p style="font:13px Arial,sans-serif;color:#000;margin:0">Nothing to export — select at least one opp and one column.</p>';
  }

  const cellBorder = 'border:1px solid #000';
  const align = (c) => (c.align === 'right' ? 'right' : 'left');
  const head = columns.map((c) =>
    `<th style="text-align:${align(c)};padding:6px 9px;font:bold 13px Arial,sans-serif;color:#000;${cellBorder}">${escapeHtml(c.label)}</th>`
  ).join('');

  // The row's BFO Address, but only when it actually looks like a web URL —
  // blanks and sentinel values ('-', '#N/A') never become hrefs.
  const bfoUrl = (r) => {
    const u = String(r['BFO Address'] || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  };
  const isBlankish = (v) => {
    const s = String(v ?? '').trim();
    return !s || s === '-' || s.toLowerCase() === '#n/a' || s.toLowerCase() === 'n/a';
  };
  // Links stay black (no color) so the table is strictly black-and-white;
  // they remain clickable when pasted into an email.
  const link = (href, text) =>
    `<a href="${escapeHtml(href)}" style="color:#000">${escapeHtml(text)}</a>`;

  const rows = records.map((r) => {
    const cells = columns.map((c) => {
      const v = r[c.key] ?? '';
      const url = (c.key === 'BFO Link' || c.key === 'BFO Address') ? bfoUrl(r) : '';
      let inner;
      if (c.key === 'BFO Link' && url && !isBlankish(v)) {
        inner = link(url, v);
      } else if (c.key === 'BFO Address' && url) {
        // Show the words "BFO Link" as the anchor text, hyperlinked to the
        // BFO Address URL, rather than printing the raw URL.
        inner = link(url, 'BFO Link');
      } else if (c.key === 'Next Steps') {
        inner = escapeHtmlMultiline(v);
      } else {
        inner = escapeHtml(v);
      }
      return `<td style="text-align:${align(c)};padding:6px 9px;font:13px Arial,sans-serif;color:#000;${cellBorder};vertical-align:top">${inner}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #000;font-family:Arial,sans-serif">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `.trim();
}

// Full email body for the Mass Edit Outlook draft: greeting ("Keith,"), the
// selected-columns table, then the user's saved signature. Mirrors the
// New Opps digest draft body (newOppsDigestEmail.js), but uses the columns
// the user picked in the Email table modal rather than the fixed digest set.
export function buildOppsTableEmailHtml(records, columnKeys, { greeting = 'Keith,', signature = '' } = {}) {
  // Explicit <br> blank lines (rather than CSS margins, which Outlook can
  // collapse) separate greeting → table → signature.
  const hello = greeting
    ? `<p style="color:#000000;font-size:14px;margin:0">${escapeHtml(greeting)}</p><br>`
    : '';
  const table = buildNewOppsTableHtml(records, columnKeys);
  // Signature is trusted HTML (the same settings.emailSignature the Draft
  // Email tab appends) — included verbatim.
  const sigBlock = signature ? `<br><br><div>${signature}</div>` : '';
  return `<div style="font-family:Arial,sans-serif;max-width:920px;margin:0 auto">${hello}${table}${sigBlock}</div>`;
}

// Build + download an Outlook draft (.eml) of the selected opps as a table,
// reusing the shared X-Unsent envelope from newOppsDigestEmail.js. Defaults
// match the request: subject "Small Deal Size Help", greeting "Keith,",
// addressed to Keith McHugh. Returns the number of opps included.
export function downloadOppsTableOutlookDraft(records, columnKeys, {
  to = 'keith.mchugh@se.com',
  subject = 'Small Deal Size Help',
  greeting = 'Keith,',
  signature = '',
} = {}) {
  const html = buildOppsTableEmailHtml(records, columnKeys, { greeting, signature });
  const eml = buildNewOppsEml({ to, subject, html });
  const blob = new Blob([eml], { type: 'message/rfc822' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${subject}.eml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return Array.isArray(records) ? records.length : 0;
}
````

### src/utils/newOppsSchedulesStore.js

````jsx
// Client helpers for New Opps email schedules. CRUD goes through the
// authenticated /api/new-opps-schedules route (admin SDK on the server) so
// the feature works without deploying client-side Firestore rules. The
// hourly cron (api/new-opps-scheduler) reads the same collection.
//
// Scheduling is anchored in UTC. The user picks a *local* hour/day in the
// UI; we resolve the first concrete run instant in local time, then derive
// the UTC recurrence fields from that same instant so the server's
// recurrence math (api/_lib/peOppsSchedule) lines up with what the user
// intended. The recurrence math is shared with the PE Opps schedules.

import { apiFetch } from './apiFetch';
import { firstLocalRun, FREQUENCIES, WEEKDAYS } from './peOppsSchedulesStore';

export { FREQUENCIES, WEEKDAYS };

async function call(action, payload = {}) {
  const res = await apiFetch('/api/new-opps-schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Build the persisted recurrence fields from the user's local choices.
export function buildRecurrenceFields(local) {
  const first = firstLocalRun(local);
  return {
    frequency: local.frequency,
    hourLocal: clamp(local.hourLocal, 0, 23, 9),
    dayOfWeekLocal: local.frequency === 'weekly' ? clamp(local.dayOfWeekLocal, 0, 6, 1) : null,
    dayOfMonthLocal: local.frequency === 'monthly' ? clamp(local.dayOfMonthLocal, 1, 28, 1) : null,
    hourUtc: first.getUTCHours(),
    dayOfWeek: first.getUTCDay(),
    dayOfMonth: Math.min(first.getUTCDate(), 28),
    nextRunAt: first.getTime(),
  };
}

export function describeSchedule(s) {
  const time = `${String(s.hourLocal ?? 9).padStart(2, '0')}:00`;
  if (s.frequency === 'weekly') return `Weekly · ${WEEKDAYS[s.dayOfWeekLocal ?? 1]} at ${time}`;
  if (s.frequency === 'monthly') return `Monthly · day ${s.dayOfMonthLocal ?? 1} at ${time}`;
  return `Daily at ${time}`;
}

export async function listSchedules() {
  const data = await call('list');
  return data.schedules || [];
}

export async function createSchedule(_uid, _email, input) {
  const schedule = {
    ...input,
    ...buildRecurrenceFields(input),
    recipients: normalizeRecipients(input.recipients),
  };
  const data = await call('create', { schedule });
  return data.id;
}

export async function updateSchedule(id, input) {
  const schedule = {
    ...input,
    ...buildRecurrenceFields(input),
    recipients: normalizeRecipients(input.recipients),
  };
  await call('update', { id, schedule });
}

export async function setEnabled(id, enabled) {
  await call('setEnabled', { id, enabled: !!enabled });
}

export async function removeSchedule(id) {
  await call('delete', { id });
}

export function normalizeRecipients(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(/[,;\n]/);
  const seen = new Set();
  const out = [];
  for (const e of arr) {
    const v = String(e || '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
}

function clamp(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}
````

### src/utils/opps2Backup.js

````jsx
// Local IndexedDB rolling backups for the Opps 2 dataset.
//
// Opps 2 is one blob synced across devices, so a stale copy or a botched
// restore can wipe a day's edits with no way back — recovering meant a
// forensic dig through Chrome's IndexedDB blob files. This keeps a
// rolling ring of full snapshots in IndexedDB so recovery is a dropdown
// instead. Mirrors settingsBackup.js. All entries are user-scoped via
// the uid-prefixed keys provided by db.js.

import { dbGet, dbGetAll, dbPut, dbDelete } from './db';

const STORE = 'opps2-backups';
const MAX_BACKUPS = 30;

// Don't snapshot more often than this for routine autosaves — otherwise
// a flurry of edits would churn the ring in seconds and leave only a few
// minutes of history. Forced snapshots (session start, pre-import,
// pre-restore) bypass the throttle so the important boundaries are
// always captured.
const DEFAULT_MIN_INTERVAL_MS = 3 * 60 * 1000;

// Snapshot the dataset into the ring. Skips empty datasets, throttles
// routine saves, and dedups against the most recent snapshot by
// `_updatedAt`. Returns the saved entry's timestamp, or null if skipped.
export async function pushOpps2Backup(data, reason = '', { force = false, minIntervalMs = DEFAULT_MIN_INTERVAL_MS } = {}) {
  if (!data || !Array.isArray(data.records) || data.records.length === 0) return null;
  try {
    const recent = await listOpps2Backups();
    const newest = recent[0];
    if (newest) {
      // Nothing changed since the last snapshot — don't store a dupe.
      if (data._updatedAt != null && newest.updatedAt === data._updatedAt) return null;
      if (!force && Date.now() - newest.timestamp < minIntervalMs) return null;
    }
    const timestamp = Date.now();
    const entry = {
      timestamp,
      reason,
      recordCount: data.records.length,
      updatedAt: data._updatedAt ?? null,
      data: JSON.parse(JSON.stringify(data)),
    };
    await dbPut(STORE, entry, String(timestamp));
    // Trim: keep only the latest MAX_BACKUPS for this user.
    const all = await listOpps2Backups();
    if (all.length > MAX_BACKUPS) {
      const toDelete = all.slice(MAX_BACKUPS).map(b => b.timestamp);
      for (const ts of toDelete) {
        try { await dbDelete(STORE, String(ts)); } catch { /* noop */ }
      }
    }
    return timestamp;
  } catch (err) {
    console.warn('opps2Backup: pushOpps2Backup failed', err);
    return null;
  }
}

// Metadata for every backup, newest first. The full `data` blob is
// stripped so listing the ring (up to 30 full datasets) doesn't keep
// tens of MB live in React state — fetch a single one with
// getOpps2Backup when the user actually restores.
export async function listOpps2Backups() {
  try {
    const rows = await dbGetAll(STORE);
    return rows
      .map(r => ({ timestamp: r.timestamp, reason: r.reason, recordCount: r.recordCount, updatedAt: r.updatedAt }))
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

export async function getOpps2Backup(timestamp) {
  try {
    return (await dbGet(STORE, String(timestamp))) || null;
  } catch {
    return null;
  }
}

export async function deleteOpps2Backup(timestamp) {
  try {
    await dbDelete(STORE, String(timestamp));
  } catch { /* noop */ }
}

// Console escape hatch for emergency restore, mirroring
// window.__settingsBackups.
if (typeof window !== 'undefined') {
  window.__opps2Backups = { listOpps2Backups, getOpps2Backup, pushOpps2Backup, deleteOpps2Backup };
}
````

### src/utils/oppsPricingSnapshot.js

````jsx
// Pricing-Option snapshots live on the Opps 2 record itself
// (`record._pricingOption`) so they survive a Pricing-tab Clear. The
// Pricing → Options tab writes the snapshot here when the user clicks
// "Save to Opp"; the Opps 2 view reads it from the record and renders
// the rich detail in the Opp popup + the linked Year 1 Quoted Amount.
//
// Writes go to BOTH the opps2-cache IndexedDB store and the opps2Data
// Firestore document so the snapshot survives reload and reaches the
// user's other devices. We read Firestore first as the source of
// truth, fall back to IndexedDB when Firestore has nothing (e.g.
// freshly-fed opps that haven't synced yet), and throw a visible error
// if the opp can't be located in either — so the picker shows the
// alert instead of silently doing nothing.

import {
  loadOpps2FromFirestore,
  loadOpps2Cache,
  saveOpps2Cache,
  saveOpps2ToFirestore,
} from './opps2Store';
import { fmtMoneyWhole } from './pricingOptionCalc';

export const OPPS_PRICING_SNAPSHOT_EVENT = 'opps2:pricingSnapshotUpdated';

// Pick the freshest copy of the Opps 2 dataset that contains the
// target opp. Prefer Firestore (server-side truth), fall back to IDB
// (covers freshly-fed Opps tab records that haven't synced yet). Both
// loaders are chunk-aware (the Opps 2 dataset is split across a
// Firestore `chunks` subcollection once it grows past the ~1 MB
// single-document limit), so this reads back large datasets correctly.
async function loadOpps2ContainingOpp(uid, oppId) {
  const target = String(oppId);
  const containsTarget = (data) =>
    Array.isArray(data?.records)
    && data.records.some(r => String(r?._id) === target);
  const fs = uid ? await loadOpps2FromFirestore(uid) : null;
  if (containsTarget(fs)) return { source: 'firestore', data: fs };
  const idb = await loadOpps2Cache();
  if (containsTarget(idb)) return { source: 'idb', data: idb };
  return {
    source: null,
    data: fs || idb || { headers: [], records: [] },
  };
}

async function updateOpp2Record(uid, oppId, mutator) {
  if (oppId == null) throw new Error('updateOpp2Record: missing oppId');
  const { source, data } = await loadOpps2ContainingOpp(uid, oppId);
  if (!source) {
    const haveCount = Array.isArray(data?.records) ? data.records.length : 0;
    throw new Error(
      `Opp #${oppId} not found in Opps (checked Firestore + IndexedDB, ` +
      `${haveCount} record${haveCount === 1 ? '' : 's'} loaded). ` +
      'Open the Opps tab to refresh the local cache, then try again.'
    );
  }
  const records = data.records;
  const idx = records.findIndex(r => String(r?._id) === String(oppId));
  const nextRecord = mutator({ ...records[idx] });
  if (!nextRecord) return null;
  const nextRecords = records.slice();
  nextRecords[idx] = nextRecord;
  const next = { ...data, records: nextRecords };
  // saveOpps2Cache swallows its own errors (best-effort local write);
  // saveOpps2ToFirestore chunks the payload to stay under Firestore's
  // ~1 MB per-document limit and throws on failure so the picker can
  // surface the alert.
  await saveOpps2Cache(next);
  if (uid) {
    await saveOpps2ToFirestore(uid, next);
  }
  try {
    window.dispatchEvent(new CustomEvent(OPPS_PRICING_SNAPSHOT_EVENT, {
      detail: { oppId, record: nextRecord },
    }));
  } catch { /* ignore */ }
  return nextRecord;
}

// Attach a frozen snapshot of a Pricing → Options tab option to the
// Opp identified by `oppId`. Also writes the snapshot's Year 1 total
// into the opp's "Quoted Amount" cell so the user can see the number
// at a glance in the table without opening the detail popup.
export async function setOppPricingSnapshot(uid, oppId, snapshot) {
  if (!snapshot) throw new Error('setOppPricingSnapshot: missing snapshot');
  return updateOpp2Record(uid, oppId, (record) => ({
    ...record,
    _pricingOption: snapshot,
    'Quoted Amount': fmtMoneyWhole(snapshot.year1Total || 0),
  }));
}

// Strip the snapshot from an opp. Leaves Quoted Amount intact — the
// user may have edited it manually, and re-zeroing it would feel like
// the value was lost. They can clear it themselves if needed.
export async function clearOppPricingSnapshot(uid, oppId) {
  try {
    return await updateOpp2Record(uid, oppId, (record) => {
      if (!record._pricingOption) return record;
      const next = { ...record };
      delete next._pricingOption;
      return next;
    });
  } catch (err) {
    // Clearing is best-effort — if the opp isn't reachable, that's
    // equivalent to it already being unlinked.
    console.warn('clearOppPricingSnapshot: ignoring failure', err);
    return null;
  }
}
````

### src/utils/peOppsSchedulesStore.js

````jsx
// Client helpers for PE Opps email schedules. CRUD goes through the
// authenticated /api/pe-opps-schedules route (admin SDK on the server) so
// the feature works without deploying client-side Firestore rules. The
// hourly cron (api/pe-opps-scheduler) reads the same collection.
//
// Scheduling is anchored in UTC. The user picks a *local* hour/day in the
// UI; we resolve the first concrete run instant in local time, then derive
// the UTC recurrence fields (hourUtc / dayOfWeek / dayOfMonth) from that
// same instant so the server's recurrence math (api/_lib/peOppsSchedule)
// lines up with what the user intended.

import { apiFetch } from './apiFetch';

export const FREQUENCIES = ['daily', 'weekly', 'monthly'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function call(action, payload = {}) {
  const res = await apiFetch('/api/pe-opps-schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// First concrete run at/after `from`, computed in the browser's local
// timezone, as a Date.
export function firstLocalRun({ frequency, hourLocal, dayOfWeekLocal, dayOfMonthLocal }, from = new Date()) {
  const hour = clamp(hourLocal, 0, 23, 9);
  const d = new Date(from);
  d.setHours(hour, 0, 0, 0);

  if (frequency === 'weekly') {
    const target = clamp(dayOfWeekLocal, 0, 6, 1);
    const delta = (target - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + delta);
    if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 7);
    return d;
  }
  if (frequency === 'monthly') {
    const dom = clamp(dayOfMonthLocal, 1, 28, 1);
    d.setDate(dom);
    if (d.getTime() <= from.getTime()) d.setMonth(d.getMonth() + 1);
    return d;
  }
  // daily
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

// Build the persisted recurrence fields from the user's local choices.
export function buildRecurrenceFields(local) {
  const first = firstLocalRun(local);
  return {
    frequency: local.frequency,
    hourLocal: clamp(local.hourLocal, 0, 23, 9),
    dayOfWeekLocal: local.frequency === 'weekly' ? clamp(local.dayOfWeekLocal, 0, 6, 1) : null,
    dayOfMonthLocal: local.frequency === 'monthly' ? clamp(local.dayOfMonthLocal, 1, 28, 1) : null,
    // UTC anchors derived from the first concrete instant.
    hourUtc: first.getUTCHours(),
    dayOfWeek: first.getUTCDay(),
    dayOfMonth: Math.min(first.getUTCDate(), 28),
    nextRunAt: first.getTime(),
  };
}

export function describeSchedule(s) {
  const time = `${String(s.hourLocal ?? 9).padStart(2, '0')}:00`;
  if (s.frequency === 'weekly') return `Weekly · ${WEEKDAYS[s.dayOfWeekLocal ?? 1]} at ${time}`;
  if (s.frequency === 'monthly') return `Monthly · day ${s.dayOfMonthLocal ?? 1} at ${time}`;
  return `Daily at ${time}`;
}

export async function listSchedules() {
  const data = await call('list');
  return data.schedules || [];
}

export async function createSchedule(_uid, _email, input) {
  const schedule = {
    ...input,
    ...buildRecurrenceFields(input),
    recipients: normalizeRecipients(input.recipients),
  };
  const data = await call('create', { schedule });
  return data.id;
}

export async function updateSchedule(id, input) {
  const schedule = {
    ...input,
    ...buildRecurrenceFields(input),
    recipients: normalizeRecipients(input.recipients),
  };
  await call('update', { id, schedule });
}

export async function setEnabled(id, enabled) {
  await call('setEnabled', { id, enabled: !!enabled });
}

export async function removeSchedule(id) {
  await call('delete', { id });
}

export function normalizeRecipients(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(/[,;\n]/);
  const seen = new Set();
  const out = [];
  for (const e of arr) {
    const v = String(e || '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
}

function clamp(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}
````

### src/utils/peOwners.js

````jsx
// A company's PE Owner field (prospect.peOwner and the Opps tab's
// "PE Owner" column) holds one or more PE firm names in a single
// comma-separated string — e.g. "Blue Owl Capital, KKR". splitPeOwners
// is the one parser for that format: every consumer that needs the
// individual firms (contact rosters, the PE tab's portfolio-company
// linkage, owner filters, autocomplete) splits through here so they
// can't drift.
//
// Splitting is on commas/semicolons, with one guard: a fragment that is
// just a corporate suffix ("LP", "LLC", "Inc") is glued back onto the
// previous name so a single owner like "Bain Capital, LP" survives.
const CORP_SUFFIX_FRAGMENT = /^(l\.?l\.?c|l\.?p|l\.?l\.?p|inc|incorporated|ltd|limited|plc|co|corp|corporation|s\.?a|n\.?v|gmbh|ag)\.?$/i;

export function splitPeOwners(value) {
  const out = [];
  for (const raw of String(value || '').split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    if (out.length > 0 && CORP_SUFFIX_FRAGMENT.test(part)) {
      out[out.length - 1] += `, ${part}`;
    } else {
      out.push(part);
    }
  }
  return out;
}

export function joinPeOwners(owners) {
  return (owners || []).map(o => String(o || '').trim()).filter(Boolean).join(', ');
}
````

### src/utils/pricingOptionCalc.js

````jsx
// Math + snapshot helpers shared between the Pricing → Options tab
// (the editor) and the Opps 2 view (which renders the frozen snapshot
// attached to an Opp). Keeping these here means a snapshot can be
// re-rendered later even when the Pricing tab has been cleared.

export const MAX_YEARS = 5;

export function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Est. Unit Count column treats a blank entry as 1 so a row with just
// a fee still produces revenue. An explicit 0 is honored.
export function unitCountOrOne(v) {
  const n = toNum(v);
  return n == null ? 1 : n;
}

// Months a row is billed inside the requested year (1-indexed),
// honoring the contract length. One-time and Setup hit a single
// month (the start month); Recurring bills every month from start
// through the end of the contract.
export function activeMonthsInYear(row, yearIdx, termYears) {
  const fee = toNum(row.fee);
  if (fee == null) return 0;
  const startMonth = toNum(row.startMonth);
  if (startMonth == null || startMonth < 1) return 0;
  const lastMonth = termYears * 12;
  if (startMonth > lastMonth) return 0;
  const yStart = (yearIdx - 1) * 12 + 1;
  const yEnd = yearIdx * 12;
  const t = (row.type || '').toLowerCase();
  if (t.startsWith('recurring')) {
    const billStart = Math.max(yStart, startMonth);
    const billEnd = Math.min(yEnd, lastMonth);
    return billEnd >= billStart ? billEnd - billStart + 1 : 0;
  }
  return startMonth >= yStart && startMonth <= yEnd ? 1 : 0;
}

// Per-year revenue for a single row, applying the annual escalator
// to the year the revenue is collected in (Year 1 = base).
export function rowYearRevenue(row, yearIdx, termYears, escPct) {
  const months = activeMonthsInYear(row, yearIdx, termYears);
  if (!months) return 0;
  const fee = toNum(row.fee) || 0;
  const uc = unitCountOrOne(row.unitCount);
  const esc = Math.pow(1 + (escPct || 0) / 100, yearIdx - 1);
  return fee * uc * months * esc;
}

// Revenue billed by a single row in a specific contract month
// (1-indexed, where 1..12 = Year 1).
export function rowMonthRevenue(row, month, termYears, escPct) {
  const fee = toNum(row.fee);
  if (fee == null) return 0;
  const uc = unitCountOrOne(row.unitCount);
  const startMonth = toNum(row.startMonth);
  if (startMonth == null || startMonth < 1) return 0;
  const lastMonth = termYears * 12;
  if (month < startMonth || month > lastMonth) return 0;
  const yearIdx = Math.ceil(month / 12);
  const esc = Math.pow(1 + (escPct || 0) / 100, yearIdx - 1);
  const t = (row.type || '').toLowerCase();
  if (t.startsWith('recurring')) return fee * uc * esc;
  return month === startMonth ? fee * uc : 0;
}

// Freeze an Options-tab option into a self-contained snapshot the
// Opp can render later. Includes every computed total the Options-tab
// summary shows so the Opp view never re-does the math.
export function buildPricingOptionSnapshot(option) {
  const termYears = Math.max(1, Math.min(MAX_YEARS, Number(option?.years) || 1));
  const esc = Number(option?.escPct) || 0;
  const rows = Array.isArray(option?.rows) ? option.rows : [];
  const yearTotals = Array.from({ length: MAX_YEARS }, (_, i) => {
    const year = i + 1;
    if (year > termYears) return 0;
    return rows.reduce((sum, r) => sum + rowYearRevenue(r, year, termYears, esc), 0);
  });
  const termValues = Array.from({ length: MAX_YEARS }, (_, i) => {
    const t = i + 1;
    if (t > termYears) return 0;
    let sum = 0;
    for (let y = 1; y <= t; y += 1) {
      sum += rows.reduce((s, r) => s + rowYearRevenue(r, y, t, esc), 0);
    }
    return sum;
  });
  const setupTotal = rows
    .filter(r => (r.type || '').toLowerCase() === 'setup')
    .reduce((s, r) => s + (toNum(r.fee) || 0) * unitCountOrOne(r.unitCount), 0);
  const year1Monthly = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    return rows.reduce((s, r) => s + rowMonthRevenue(r, month, termYears, esc), 0);
  });
  const year1MonthlyTotal = year1Monthly.reduce((s, v) => s + v, 0);
  return {
    name: option?.name || '',
    years: termYears,
    escPct: esc,
    // Service bundle for this Option (line-item → services mapping,
    // deduped upstream). Frozen in so the Opp can list them even after
    // the Pricing tab is cleared.
    services: Array.isArray(option?.services) ? option.services.filter(Boolean) : [],
    rows: rows.map(r => ({ ...r })),
    year1Total: yearTotals[0] || 0,
    yearTotals,
    termValues,
    setupTotal,
    year1Monthly,
    year1MonthlyTotal,
    savedAt: new Date().toISOString(),
  };
}

export function fmtMoneyWhole(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
````

### src/utils/pricingOptionLinks.js

````jsx
// Pricing-option ↔ Opp links — a per-user map of `oppId → optionName`
// that backs the "Pricing Option" column on the Opps 2 tab.
//
// The link is owned by the Pricing tab (that's where the user saves an
// option to an opp). Opps 2 reads this map and renders the value as a
// computed column — the opp record itself never carries the option
// name, so the two tabs can't disagree about which option is current.
//
// Storage: pricing-cache store, key `optionLinks`. Cross-tab updates
// are broadcast via the `pricing:optionLinksChanged` window event so
// the Opps 2 view re-renders the moment the user saves from Pricing.

import { dbGet, dbPut } from './db';

const PRICING_STORE = 'pricing-cache';
const LINKS_KEY = 'optionLinks';
const EVENT_NAME = 'pricing:optionLinksChanged';

export async function loadOptionLinks() {
  try {
    const val = await dbGet(PRICING_STORE, LINKS_KEY);
    return (val && typeof val === 'object') ? val : {};
  } catch {
    return {};
  }
}

async function persistOptionLinks(links) {
  try { await dbPut(PRICING_STORE, links, LINKS_KEY); } catch { /* idb best-effort */ }
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: links }));
  } catch { /* SSR / non-DOM environment */ }
}

// Set / clear a single oppId → optionName entry. Passing a falsy
// optionName removes the link. Returns the new full map.
export async function setOppOptionLink(oppId, optionName) {
  if (oppId == null) return null;
  const links = await loadOptionLinks();
  const next = { ...links };
  const key = String(oppId);
  const name = typeof optionName === 'string' ? optionName.trim() : '';
  if (!name) delete next[key];
  else next[key] = name;
  await persistOptionLinks(next);
  return next;
}

// When an option is renamed in the Pricing tab, point every link that
// still references the old name at the new one so the Opps 2 column
// stays accurate without a manual re-save.
export async function renameOptionInLinks(oldName, newName) {
  const oldN = String(oldName || '').trim();
  const newN = String(newName || '').trim();
  if (!oldN || oldN === newN) return null;
  const links = await loadOptionLinks();
  let touched = false;
  const next = {};
  for (const [k, v] of Object.entries(links)) {
    if (v === oldN) { next[k] = newN; touched = true; }
    else next[k] = v;
  }
  if (!touched) return links;
  await persistOptionLinks(next);
  return next;
}

// Drop every link pointing at an option name — used when the user
// deletes an Option from the Pricing tab.
export async function dropOptionFromLinks(optionName) {
  const target = String(optionName || '').trim();
  if (!target) return null;
  const links = await loadOptionLinks();
  let touched = false;
  const next = {};
  for (const [k, v] of Object.entries(links)) {
    if (v === target) { touched = true; continue; }
    next[k] = v;
  }
  if (!touched) return links;
  await persistOptionLinks(next);
  return next;
}

export const OPTION_LINKS_EVENT = EVENT_NAME;
````

