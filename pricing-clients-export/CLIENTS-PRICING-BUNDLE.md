# Clients + Pricing Pages — single-file bundle for Cursor

This document contains **every source file** of the self-contained Clients + Pricing
export, each under a `### path` heading in a four-backtick fenced block (so files that
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
- `src/components/ClientsView/ClientsView.jsx`
- `src/components/ClientsView/CommissionsPasteImportModal.jsx`
- `src/components/ClientsView/CommissionsView.jsx`
- `src/components/DealsView/DealsView.jsx`
- `src/components/DealsView/PasteImportModal.jsx`
- `src/components/PricingView/BrokerFeesTab.jsx`
- `src/components/PricingView/BrokerFeesTab.module.css`
- `src/components/PricingView/CalculatorTab.jsx`
- `src/components/PricingView/CalculatorTab.module.css`
- `src/components/PricingView/CompareTab.jsx`
- `src/components/PricingView/CompareTab.module.css`
- `src/components/PricingView/OptionsTab.jsx`
- `src/components/PricingView/OptionsTab.module.css`
- `src/components/PricingView/PricingConversions.jsx`
- `src/components/PricingView/PricingConversions.module.css`
- `src/components/PricingView/PricingView.jsx`
- `src/components/PricingView/PricingView.module.css`
- `src/components/PricingView/S2CTab.jsx`
- `src/components/PricingView/S2CTab.module.css`
- `src/components/common/DataTable.jsx`
- `src/components/common/DataTable.module.css`
- `src/components/common/columnLinks.jsx`
- `src/contexts/AuthContext.jsx`
- `src/data/dropdownLists.js`
- `src/data/enums.js`
- `src/data/sampleData.js`
- `src/utils/cdmMatch.js`
- `src/utils/clientIssues.js`
- `src/utils/clientManagerStore.js`
- `src/utils/commissionsStore.js`
- `src/utils/companyIndex.js`
- `src/utils/db.js`
- `src/utils/dealClientMap.js`
- `src/utils/dealCommissions.js`
- `src/utils/dealsFormat.js`
- `src/utils/dealsStore.js`
- `src/utils/dropdownListsStore.js`
- `src/utils/opps2Store.js`
- `src/utils/oppsCache.js`
- `src/utils/oppsCallIn.js`
- `src/utils/oppsPricingSnapshot.js`
- `src/utils/pricingOptionCalc.js`
- `src/utils/pricingOptionLinks.js`
- `src/utils/pricingParse.js`
- `src/utils/soldWarningIgnore.js`
- `src/utils/targetTier.js`
- `src/utils/userLs.js`

### README.md

````markdown
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
````

### package.json

````json
{
  "name": "clients-pricing-export",
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
    <title>Clients + Pricing — standalone export</title>
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

export default defineConfig({
  plugins: [react()],
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
import { ClientsView } from './components/ClientsView/ClientsView';
import { PricingView } from './components/PricingView/PricingView';
import { seedSampleData, SAMPLE_PROSPECTS, SAMPLE_CDM_NAME } from './data/sampleData';

// Standalone shell hosting the two exported pages behind a top nav.
//
// In the full app these pages get their props from a top-level layout
// (Firestore prospects, the signed-in user's CDM name, a shared settings
// object + setter). Here we supply all of that locally:
//   - prospects      → the hard-coded SAMPLE_PROSPECTS roster (Clients only)
//   - cdmName        → SAMPLE_CDM_NAME (matches every sample prospect)
//   - settings       → an in-component object; the pages persist column
//                      layout + dropdown-column bindings through it, which
//                      local state handles fine for a demo
//   - updateSettings → merges a patch into that object
//   - user           → provided by the AuthContext stub
//
// Deals & Commissions seed into localStorage on first load; Pricing state
// persists to IndexedDB (utils/db.js is the real browser implementation).
const PAGES = [
  { key: 'clients', label: 'Clients' },
  { key: 'pricing', label: 'Pricing' },
];

export default function App() {
  const [page, setPage] = useState('clients');
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
        <nav
          style={{
            display: 'flex',
            gap: 4,
            padding: '0.5rem 1rem',
            borderBottom: '1px solid #E2E8F0',
            background: '#fff',
            flexShrink: 0,
          }}
        >
          {PAGES.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPage(p.key)}
              style={{
                padding: '0.4rem 1rem',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '0.9rem',
                fontWeight: 600,
                background: page === p.key ? '#2563EB' : 'transparent',
                color: page === p.key ? '#fff' : '#475569',
              }}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {page === 'clients' ? (
            <ClientsView
              prospects={SAMPLE_PROSPECTS}
              cdmName={SAMPLE_CDM_NAME}
              settings={settings}
              updateSettings={updateSettings}
              user={{ uid: 'demo-user' }}
            />
          ) : (
            <PricingView settings={settings} />
          )}
        </div>
      </div>
    </AuthProvider>
  );
}
````

### src/components/ClientsView/ClientsView.jsx

````jsx
import { useMemo, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { matchesCdm } from '../../utils/cdmMatch';
import { buildTargetTierResolver } from '../../utils/targetTier';
import { DealsView } from '../DealsView/DealsView';
import { CommissionsView } from './CommissionsView';
import { loadDealsList } from '../../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../../utils/dealClientMap';
import {
  loadClientManagerMap, setClientManager, CLIENT_MANAGER_EVENT,
  loadClientInPersonMap, setClientInPerson, CLIENT_IN_PERSON_EVENT,
  loadClientStatusMap, setClientStatus, CLIENT_STATUS_EVENT,
  loadClientStatusSetAtMap, setClientStatusSetAt, CLIENT_STATUS_SET_AT_EVENT,
  loadClientNotesMap, setClientNotes, CLIENT_NOTES_EVENT,
  loadClientUntrackedMap, setClientUntracked, CLIENT_UNTRACKED_EVENT,
  loadClientLouisvilleMap, setClientLouisville, CLIENT_LOUISVILLE_EVENT,
} from '../../utils/clientManagerStore';
import {
  asDate, fmtCurrency, fmtPercent, fmtDate, isTruthy,
  DEAL_CURRENCY_KEYS, DEAL_DATE_KEYS, DEAL_PERCENT_KEYS, DEAL_CHECK_KEYS,
} from '../../utils/dealsFormat';
import {
  buildListRegistry, buildAvailableLists, resolveColumnLink,
  SelectCell, MultiSelectCell, LinkColumnsModal,
} from '../common/columnLinks';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
// Shared with the Issues tab so both surfaces agree on what's expired.
import { isInactiveAgreement, normClientName, soonestExpiration } from '../../utils/clientIssues';

const MS_PER_DAY = 86400000;

// A client row is tinted light red as a "needs a status" warning when its
// soonest renewal is inside this many days AND the Status column is still
// blank. Shared by the row-highlight logic and the on-page legend so the two
// can't drift apart.
const RENEWAL_WARNING_DAYS = 270;

// "Reached out to CM" is a time-boxed status: it auto-clears this many days
// after it's set, and a countdown shows how long is left. Kept as one
// constant so the timer, the badge, and any copy stay in sync.
const REACHED_OUT_TIMER_DAYS = 30;
function isReachedOutToCM(status) {
  const s = String(status || '');
  return /reached\s*out/i.test(s) && /\bcm\b/i.test(s);
}
// Days left before a "Reached out to CM" status auto-clears, given the ISO
// date it was set. null when there's no stamp. Can go 0 / negative once the
// window has elapsed (the row-scan effect then clears the status).
function reachedOutDaysLeft(setAtISO) {
  if (!setAtISO) return null;
  const set = new Date(setAtISO);
  if (Number.isNaN(set.getTime())) return null;
  set.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const elapsed = Math.round((today.getTime() - set.getTime()) / MS_PER_DAY);
  return REACHED_OUT_TIMER_DAYS - elapsed;
}
function todayISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Column layout for the per-client contract drill-down. Each entry's
// `key` is the canonical field name stored on the deal row; `label` is
// the heading shown on the Clients tab. Several labels are shorter
// aliases of the Deals-subtab headers — the upload normalizer in
// DealsView already folds them onto the same key.
const CONTRACT_COLUMNS = [
  { key: 'Agreement Name',          label: 'Agreement Name', minWidth: 420 },
  { key: 'Paperwork completed',     label: 'Paperwork', minWidth: 220 },
  { key: 'Current Term Start Date', label: 'Current Term Start Date' },
  { key: 'Payment Terms',           label: 'Payment Terms' },
  { key: 'End Date',                label: 'End Date', minWidth: 130 },
  { key: '__daysToEnd',             label: 'Days to End Date', minWidth: 130 },
  { key: 'Auto renewal?',           label: 'Auto renewal?' },
  { key: 'Esc',                     label: 'Esc', minWidth: 140 },
];

// Whole-day delta between a contract End Date and today, rendered as
// a colored cell. Negative means the date has already passed; rows
// inside 30 days run amber so renewals are easy to spot. Cancelled /
// expired rows render in grey to match the rest of the inactive row.
function renderDaysToEnd(endRaw, inactive) {
  const d = asDate(endRaw);
  if (!d) return <span style={{ color: '#94A3B8' }}>—</span>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
  const color = inactive
    ? '#94A3B8'
    : days < 0 ? '#B91C1C'
    : days <= 30 ? '#92400E'
    : '#334155';
  const label = days === 0
    ? 'Today'
    : days > 0 ? `${days}d`
    : `${Math.abs(days)}d ago`;
  return <span style={{ color, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{label}</span>;
}

// Shared Tier pill used by both the account's own Tier column and the
// mapped Target Tier column. Tier 1 pops red (top accounts), Tier 2 blue,
// anything else slate; blank / "-" renders an em dash. `title` adds a
// hover tooltip (e.g. which target account the mapped tier came from).
function tierBadge(tier, title) {
  const t = String(tier || '').trim();
  if (!t || t === '-') return <span style={{ color: '#94A3B8' }} title={title}>—</span>;
  const palette = /1/.test(t)
    ? { bg: '#FEE2E2', color: '#B91C1C' }
    : /2/.test(t)
    ? { bg: '#DBEAFE', color: '#1E40AF' }
    : { bg: '#F1F5F9', color: '#475569' };
  return (
    <span title={title} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: palette.bg, color: palette.color, whiteSpace: 'nowrap' }}>
      {t}
    </span>
  );
}

// Inline editor for the Client Manager column. Local draft so typing
// stays snappy; commits on blur or Enter, reverts on Escape. The
// container swallows click + keydown so editing doesn't trigger the
// row-open popup or table-level shortcuts.
function ClientManagerCell({ company, value, onCommit }) {
  const [draft, setDraft] = useState(value || '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { setDraft(value || ''); }, [value]);
  function commit() {
    const next = draft.trim();
    if (next === (value || '').trim()) return;
    onCommit(company, next);
  }
  return (
    <input
      type="text"
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(value || ''); e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '3px 6px',
        border: `1px solid ${focused ? '#3B82F6' : 'transparent'}`, borderRadius: 4,
        background: focused ? '#fff' : 'transparent', color: '#1E293B',
        fontSize: '0.72rem', fontFamily: 'inherit',
      }}
    />
  );
}

// Free-text Status editor used when no Dropdowns list is bound to
// the column. When a list IS bound, ClientsView uses the shared
// SelectCell from columnLinks instead.
function ClientStatusTextCell({ company, value, onCommit }) {
  const [draft, setDraft] = useState(value || '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { setDraft(value || ''); }, [value]);
  function commit() {
    const next = draft.trim();
    if (next === (value || '').trim()) return;
    onCommit(company, next);
  }
  return (
    <input
      type="text"
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(value || ''); e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '3px 6px',
        border: `1px solid ${focused ? '#3B82F6' : 'transparent'}`, borderRadius: 4,
        background: focused ? '#fff' : 'transparent', color: '#1E293B',
        fontSize: '0.72rem', fontFamily: 'inherit',
      }}
    />
  );
}

// Multi-line free-form notes cell. Uses a textarea so the user can
// hit Enter for a new line; commits on blur. The cell grows up to a
// max height and scrolls — keeps long notes from blowing out the row.
function NotesCell({ company, value, onCommit }) {
  const [draft, setDraft] = useState(value || '');
  const [focused, setFocused] = useState(false);
  useEffect(() => { setDraft(value || ''); }, [value]);
  function commit() {
    if (draft === (value || '')) return;
    onCommit(company, draft);
  }
  return (
    <textarea
      value={draft}
      placeholder="—"
      rows={focused ? 3 : 1}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); setDraft(value || ''); e.currentTarget.blur(); }
      }}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '3px 6px',
        border: `1px solid ${focused ? '#3B82F6' : 'transparent'}`, borderRadius: 4,
        background: focused ? '#fff' : 'transparent', color: '#1E293B',
        fontSize: '0.72rem', fontFamily: 'inherit',
        resize: 'vertical', minHeight: 24, maxHeight: 160,
        whiteSpace: 'pre-wrap',
      }}
    />
  );
}

// Per-client In Person Meeting flag. Centered checkbox; the table
// row already has no onRowClick so a click on the box only toggles
// the flag, but stop propagation anyway to be safe.
function InPersonCell({ company, checked, onChange }) {
  return (
    <label
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
    >
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(company, e.target.checked)}
        style={{ cursor: 'pointer' }}
      />
    </label>
  );
}

function renderContractCell(key, value) {
  if (value == null || value === '') return <span style={{ color: '#94A3B8' }}>—</span>;
  if (DEAL_CHECK_KEYS.has(key)) {
    const yes = isTruthy(value);
    return (
      <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: yes ? '#DCFCE7' : '#F1F5F9', color: yes ? '#166534' : '#64748B' }}>
        {yes ? 'Yes' : (typeof value === 'string' && value.trim() ? value : 'No')}
      </span>
    );
  }
  if (DEAL_CURRENCY_KEYS.has(key)) return <span style={{ fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtCurrency(value)}</span>;
  if (DEAL_PERCENT_KEYS.has(key)) return <span style={{ fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtPercent(value)}</span>;
  if (DEAL_DATE_KEYS.has(key)) return <span style={{ color: '#334155' }}>{fmtDate(value)}</span>;
  return <span style={{ color: '#1E293B' }}>{String(value)}</span>;
}

function ContractTable({ deals }) {
  if (!deals || deals.length === 0) {
    return (
      <div style={{ padding: '0.75rem 1.25rem', color: '#64748B', fontSize: '0.75rem', fontStyle: 'italic' }}>
        No contracts found for this client. Upload contract data on the Deals subtab — the Client Name column must match this client.
      </div>
    );
  }
  // Cancelled / Expired agreements sink to the bottom — they're still
  // worth seeing as history but shouldn't crowd the active rows. Inside
  // each group sort by End Date ascending so the soonest-expiring
  // contracts surface first; rows with no End Date drop to the bottom
  // of their group.
  const sorted = [...deals].sort((a, b) => {
    const ai = isInactiveAgreement(a) ? 1 : 0;
    const bi = isInactiveAgreement(b) ? 1 : 0;
    if (ai !== bi) return ai - bi;
    const aDate = asDate(a['End Date']);
    const bDate = asDate(b['End Date']);
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate.getTime() - bDate.getTime();
  });
  return (
    <div style={{ overflowX: 'auto', padding: '0.5rem 0.75rem 0.75rem' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.7rem', width: 'max-content', minWidth: '100%' }}>
        <thead>
          <tr style={{ background: '#F1F5F9' }}>
            {CONTRACT_COLUMNS.map(col => (
              <th key={col.key} style={{ padding: '0.35rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, fontSize: '0.65rem', whiteSpace: 'nowrap', borderBottom: '1px solid #CBD5E1', minWidth: col.minWidth }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((d, i) => {
            const inactive = isInactiveAgreement(d);
            const baseBg = i % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
            return (
            <tr key={i} style={{ background: inactive ? '#F1F5F9' : baseBg, color: inactive ? '#94A3B8' : undefined, opacity: inactive ? 0.7 : 1 }}>
              {CONTRACT_COLUMNS.map(col => (
                <td key={col.key} style={{ padding: '0.3rem 0.5rem', whiteSpace: 'nowrap', borderBottom: '1px solid #E2E8F0', minWidth: col.minWidth }}>
                  {col.key === '__daysToEnd'
                    ? renderDaysToEnd(d['End Date'], inactive)
                    : renderContractCell(col.key, d[col.key])}
                </td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SUBTAB_STORAGE_KEY = 'clients-view:active-subtab';
function readSavedSubtab() {
  try {
    const s = localStorage.getItem(SUBTAB_STORAGE_KEY);
    if (s === 'clients' || s === 'oldclients' || s === 'deals' || s === 'commissions') return s;
  } catch {}
  return 'clients';
}

function getServicesCount(p) {
  const svc = p.servicesExplored || {};
  return Object.values(svc).filter(v => v && v !== '-').length;
}

// Loose status check — tolerate trailing whitespace and casing drift in the data.
function normStatus(s) {
  return String(s || '').trim().toLowerCase();
}
function isClient(p) { return normStatus(p.status) === 'client'; }
function isOldClient(p) { return normStatus(p.status) === 'old client'; }

export function ClientsView({ prospects = [], cdmName, settings, updateSettings, user, targetAccountsData, addProspect }) {
  const [subtab, setSubtab] = useState(readSavedSubtab);
  function selectSubtab(key) {
    setSubtab(key);
    try { localStorage.setItem(SUBTAB_STORAGE_KEY, key); } catch {}
  }

  // The Clients and Old Clients subtabs share this view; the only real
  // difference is which Status the primary list filters on. The secondary
  // "Include …" toggle pulls in the other bucket. Labels and the table id
  // (so column widths persist independently) follow the active subtab.
  const isOldMode = subtab === 'oldclients';
  const primaryMatch = isOldMode ? isOldClient : isClient;
  const secondaryMatch = isOldMode ? isClient : isOldClient;
  const statusLabel = isOldMode ? 'Old Client' : 'Client';
  const otherLabel = isOldMode ? 'Client' : 'Old Client';
  const headingLabel = isOldMode ? 'Old Clients' : 'Clients';
  const tableId = isOldMode ? 'oldclients' : 'clients';

  const [showOld, setShowOld] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  // Load uploaded deals so each client row can drill down into its
  // own contracts. Re-read on the cross-tab storage event so an
  // upload from the Deals subtab in another window shows up here.
  const [dealsList, setDealsList] = useState(() => loadDealsList().data);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [managerMap, setManagerMap] = useState(() => loadClientManagerMap());
  const [inPersonMap, setInPersonMap] = useState(() => loadClientInPersonMap());
  const [statusMap, setStatusMap] = useState(() => loadClientStatusMap());
  const [statusSetAtMap, setStatusSetAtMap] = useState(() => loadClientStatusSetAtMap());
  const [notesMap, setNotesMap] = useState(() => loadClientNotesMap());
  const [untrackedMap, setUntrackedMap] = useState(() => loadClientUntrackedMap());
  const [louisvilleMap, setLouisvilleMap] = useState(() => loadClientLouisvilleMap());
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setDealsList(loadDealsList().data);
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'clients-manager-map') setManagerMap(loadClientManagerMap());
      if (e.key === 'clients-inperson-map') setInPersonMap(loadClientInPersonMap());
      if (e.key === 'clients-status-map') setStatusMap(loadClientStatusMap());
      if (e.key === 'clients-status-set-at') setStatusSetAtMap(loadClientStatusSetAtMap());
      if (e.key === 'clients-notes-map') setNotesMap(loadClientNotesMap());
      if (e.key === 'clients-untracked-map') setUntrackedMap(loadClientUntrackedMap());
      if (e.key === 'clients-louisville-map') setLouisvilleMap(loadClientLouisvilleMap());
    }
    function onClientMap() { setClientMap(loadDealClientMap()); }
    function onManagerMap() { setManagerMap(loadClientManagerMap()); }
    function onInPersonMap() { setInPersonMap(loadClientInPersonMap()); }
    function onStatusMap() { setStatusMap(loadClientStatusMap()); }
    function onStatusSetAtMap() { setStatusSetAtMap(loadClientStatusSetAtMap()); }
    function onNotesMap() { setNotesMap(loadClientNotesMap()); }
    function onUntrackedMap() { setUntrackedMap(loadClientUntrackedMap()); }
    function onLouisvilleMap() { setLouisvilleMap(loadClientLouisvilleMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(CLIENT_MANAGER_EVENT, onManagerMap);
    window.addEventListener(CLIENT_IN_PERSON_EVENT, onInPersonMap);
    window.addEventListener(CLIENT_STATUS_EVENT, onStatusMap);
    window.addEventListener(CLIENT_STATUS_SET_AT_EVENT, onStatusSetAtMap);
    window.addEventListener(CLIENT_NOTES_EVENT, onNotesMap);
    window.addEventListener(CLIENT_UNTRACKED_EVENT, onUntrackedMap);
    window.addEventListener(CLIENT_LOUISVILLE_EVENT, onLouisvilleMap);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(CLIENT_MANAGER_EVENT, onManagerMap);
      window.removeEventListener(CLIENT_IN_PERSON_EVENT, onInPersonMap);
      window.removeEventListener(CLIENT_STATUS_EVENT, onStatusMap);
      window.removeEventListener(CLIENT_STATUS_SET_AT_EVENT, onStatusSetAtMap);
      window.removeEventListener(CLIENT_NOTES_EVENT, onNotesMap);
      window.removeEventListener(CLIENT_UNTRACKED_EVENT, onUntrackedMap);
      window.removeEventListener(CLIENT_LOUISVILLE_EVENT, onLouisvilleMap);
    };
  }, []);
  // Refresh deals + client map whenever we switch back to the Clients
  // subtab — same-window upload / mapping changes on the Deals subtab
  // don't fire storage.
  useEffect(() => {
    if (subtab === 'clients' || subtab === 'oldclients') {
      setDealsList(loadDealsList().data);
      setClientMap(loadDealClientMap());
      setManagerMap(loadClientManagerMap());
      setInPersonMap(loadClientInPersonMap());
      setStatusMap(loadClientStatusMap());
      setStatusSetAtMap(loadClientStatusSetAtMap());
      setNotesMap(loadClientNotesMap());
      setUntrackedMap(loadClientUntrackedMap());
      setLouisvilleMap(loadClientLouisvilleMap());
    }
  }, [subtab]);

  // One-time migration for the Tier / Target Tier columns. DataTable
  // permanently hides any column that didn't exist when a user last
  // customized their visible-columns set, so users who've touched the
  // Columns menu would find these stuck under "Hidden columns". Inject any
  // that are missing into their saved set — both the localStorage copy and
  // the Firestore-synced tablePrefs — so they show without hunting. Sticky
  // per-table flag (bumped when new columns are added) so re-hiding still
  // sticks. Only ADDs; never removes a column.
  useEffect(() => {
    if (!settings) return;
    const nextTablePrefs = { ...(settings.tablePrefs || {}) };
    let touchedRemote = false;
    for (const tid of ['clients', 'oldclients']) {
      const flag = `clients-view:mig-tier-cols-v2-${tid}`;
      let alreadyDone = true;
      try { alreadyDone = !!localStorage.getItem(flag); } catch { /* storage blocked */ }
      if (alreadyDone) continue;
      const remote = settings.tablePrefs?.[tid]?.visible;
      let lsSaved = null;
      try {
        const raw = JSON.parse(localStorage.getItem(`prospect-col-visible-${tid}`));
        if (Array.isArray(raw)) lsSaved = raw;
      } catch { /* ignore malformed */ }
      // Firestore prefs win when present; else the local set. No saved
      // customization at all means every column already shows.
      const saved = Array.isArray(remote) && remote.length > 0
        ? remote
        : (Array.isArray(lsSaved) && lsSaved.length > 0 ? lsSaved : null);
      try { localStorage.setItem(flag, '1'); } catch { /* storage blocked */ }
      if (!saved) continue;
      const next = [...saved];
      let changed = false;
      // Tier sits after CDM; Target Tier sits right after Tier.
      if (!next.includes('tier')) {
        const cdmIdx = next.indexOf('cdm');
        if (cdmIdx >= 0) next.splice(cdmIdx, 0, 'tier'); else next.push('tier');
        changed = true;
      }
      if (!next.includes('targetTier')) {
        const tierIdx = next.indexOf('tier');
        if (tierIdx >= 0) next.splice(tierIdx + 1, 0, 'targetTier'); else next.push('targetTier');
        changed = true;
      }
      if (!changed) continue;
      try { localStorage.setItem(`prospect-col-visible-${tid}`, JSON.stringify(next)); } catch { /* storage blocked */ }
      nextTablePrefs[tid] = { ...(settings.tablePrefs?.[tid] || {}), visible: next };
      touchedRemote = true;
    }
    if (touchedRemote && updateSettings) updateSettings({ tablePrefs: nextTablePrefs });
  }, [settings, updateSettings]);

  // User-configurable column-to-Dropdowns-list bindings, mirroring the
  // Deals / Opps 2 "Link columns" feature. Lets the Status column on
  // this table pull picks from a Dropdowns-tab list.
  const columnLinks = settings?.clientsColumnLinks || {};
  const updateColumnLinks = (next) => {
    updateSettings?.({ clientsColumnLinks: next || {} });
  };
  const dropdownLists = useMemo(
    () => getEffectiveDropdownLists(settings),
    [settings?.dropdownLists]
  );
  const listRegistry = useMemo(() => buildListRegistry(dropdownLists), [dropdownLists]);
  const availableLists = useMemo(() => buildAvailableLists(dropdownLists), [dropdownLists]);
  const [linkModalOpen, setLinkModalOpen] = useState(false);

  // Group deals by client. A row's raw Client Name is preferred, but
  // when the user has explicitly mapped that source name to a different
  // client via the helper column on the Deals subtab, we group it
  // under the mapped name instead.
  const dealsByClient = useMemo(() => {
    const map = new Map();
    for (const d of dealsList) {
      const raw = normClientName(d['Client Name']);
      if (!raw) continue;
      const mapped = clientMap[raw];
      const k = mapped ? normClientName(mapped) : raw;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(d);
    }
    return map;
  }, [dealsList, clientMap]);

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Only the configured user's clients. Filter to the tab's primary
  // Status by default, or include the other bucket when the toggle is on.
  const clients = useMemo(() => (
    prospects
      .filter(p => matchesCdm(p.cdm, cdmName))
      .filter(p => primaryMatch(p) || (showOld && secondaryMatch(p)))
      .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
  ), [prospects, showOld, cdmName, primaryMatch, secondaryMatch]);

  // Resolver for the Tier a client inherits from the Target Accounts list
  // it's mapped to (explicit My Accounts mapping first, fuzzy name match as
  // fallback). Rebuilt when the target book, CDM, or mapping changes.
  const resolveTargetTier = useMemo(
    () => buildTargetTierResolver({ targetAccountsData, cdmName, settings }),
    [targetAccountsData, cdmName, settings?.targetMap, settings?.targetCdmColumn]
  );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clients.filter(c => {
        const ck = normClientName(c.company);
        return (
          (c.company || '').toLowerCase().includes(q) ||
          (c.cdm || '').toLowerCase().includes(q) ||
          (c.tier || '').toLowerCase().includes(q) ||
          (resolveTargetTier(c).tier || '').toLowerCase().includes(q) ||
          (c.type || '').toLowerCase().includes(q) ||
          (c.website || '').toLowerCase().includes(q) ||
          (managerMap[ck] || '').toLowerCase().includes(q) ||
          (statusMap[ck] || '').toLowerCase().includes(q)
        );
      })
    : clients;

  const myProspects = useMemo(() => prospects.filter(p => matchesCdm(p.cdm, cdmName)), [prospects, cdmName]);
  const activeCount = myProspects.filter(primaryMatch).length; // primary bucket for this tab
  const oldCount = myProspects.filter(secondaryMatch).length;  // the "Include …" bucket

  // Diagnostic counts for the empty state.
  const totalProspects = prospects.length;
  const allClients = useMemo(() => prospects.filter(primaryMatch).length, [prospects, primaryMatch]);
  const uniqueCdms = useMemo(() => {
    const s = new Set();
    for (const p of prospects) {
      const v = (p.cdm || '').trim();
      if (v) s.add(v);
    }
    return Array.from(s).sort();
  }, [prospects]);

  const rows = useMemo(() => filtered.map(c => {
    const ck = normClientName(c.company);
    const clientDeals = dealsByClient.get(ck) || [];
    const next = soonestExpiration(clientDeals);
    const untracked = !!untrackedMap[ck];
    const tt = resolveTargetTier(c);
    return {
      ...c,
      id: c.id,
      targetTier: tt.tier,
      targetTierName: tt.name,
      targetTierSource: tt.source,
      services: getServicesCount(c),
      contractCount: clientDeals.length,
      soonestExpiration: next.date,
      // Untracked rows blank Days Until so they fall through the
      // default ascending sort (nulls go last) and don't compete with
      // active accounts for attention.
      daysUntilExpiration: untracked ? null : next.days,
      clientManager: managerMap[ck] || '',
      inPersonMeeting: !!inPersonMap[ck],
      invitedToLouisville: !!louisvilleMap[ck],
      Status: statusMap[ck] || '',
      // Days left before a "Reached out to CM" status auto-clears (null for
      // any other status, or until the set-at stamp is backfilled below).
      reachedOutDaysLeft: isReachedOutToCM(statusMap[ck]) ? reachedOutDaysLeft(statusSetAtMap[ck]) : null,
      notes: notesMap[ck] || '',
      untracked,
    };
  }), [filtered, dealsByClient, managerMap, inPersonMap, louisvilleMap, statusMap, statusSetAtMap, notesMap, untrackedMap, resolveTargetTier]);

  // Drive the "Reached out to CM" 30-day timer: start the clock for any such
  // status that has no stamp yet (e.g. set before this shipped), and clear
  // the status once the window has elapsed. Scans the CDM's client list on
  // every relevant change; each branch only writes when something actually
  // needs doing, so it settles rather than looping.
  useEffect(() => {
    for (const c of clients) {
      const ck = normClientName(c.company);
      if (!isReachedOutToCM(statusMap[ck])) continue;
      const setAt = statusSetAtMap[ck];
      if (!setAt) { setClientStatusSetAt(c.company, todayISODate()); continue; }
      const left = reachedOutDaysLeft(setAt);
      if (left != null && left <= 0) setClientStatus(c.company, '');
    }
  }, [clients, statusMap, statusSetAtMap]);

  const columns = useMemo(() => [
    {
      key: 'company', label: 'Company', defaultWidth: 260, sticky: true,
      render: (row) => {
        const isOpen = expandedIds.has(row.id);
        const count = row.contractCount;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleExpand(row.id); }}
              title={count > 0 ? `${isOpen ? 'Hide' : 'Show'} ${count} contract${count === 1 ? '' : 's'}` : 'No contracts uploaded for this client'}
              style={{
                width: 18, height: 18, padding: 0, border: '1px solid #CBD5E1', borderRadius: 4,
                background: isOpen ? '#1E293B' : '#FFFFFF', color: isOpen ? '#FFFFFF' : '#475569',
                fontSize: '0.65rem', lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >{isOpen ? '▾' : '▸'}</button>
            <span style={{ fontWeight: 600, color: '#1E293B' }}>{row.company || '—'}</span>
          </span>
        );
      },
    },
    {
      key: 'status', label: 'Account Status', defaultWidth: 130,
      render: (row) => {
        const isOld = isOldClient(row);
        return (
          <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700, background: isOld ? '#F1F5F9' : '#DCFCE7', color: isOld ? '#64748B' : '#166534' }}>
            {row.status || '—'}
          </span>
        );
      },
    },
    {
      key: 'Status', label: 'Renewal Status', defaultWidth: 160,
      getSortValue: (row) => (row.Status || '').toLowerCase(),
      getFilterValue: (row) => row.Status || '',
      render: (row) => {
        const link = resolveColumnLink('Status', columnLinks);
        let cell;
        if (link) {
          const opts = listRegistry?.get(link.listKey)?.options || [];
          const onChange = (v) => setClientStatus(row.company, v);
          cell = link.mode === 'multi'
            ? <MultiSelectCell value={row.Status} onChange={onChange} options={opts} />
            : <SelectCell value={row.Status} onChange={onChange} options={opts} />;
        } else {
          cell = (
            <ClientStatusTextCell
              company={row.company}
              value={row.Status}
              onCommit={setClientStatus}
            />
          );
        }
        // Countdown badge for the time-boxed "Reached out to CM" status: how
        // many days until it auto-clears (30 days after it was set).
        if (row.reachedOutDaysLeft == null) return cell;
        const left = Math.max(0, row.reachedOutDaysLeft);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0 }}>{cell}</span>
            <span
              title={`This status auto-clears in ${left} day${left === 1 ? '' : 's'} — ${REACHED_OUT_TIMER_DAYS} days after "Reached out to CM" was set.`}
              style={{ flexShrink: 0, fontSize: '0.64rem', fontWeight: 700, color: left <= 7 ? '#B45309' : '#92400E', background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
            >{left}d</span>
          </div>
        );
      },
    },
    {
      key: 'tier', label: 'Tier', defaultWidth: 100,
      // Order Tier 1 → 2 → 3, blanks last, so a Tier sort surfaces the
      // top accounts first regardless of ascending / descending.
      getSortValue: (row) => {
        const m = String(row.tier || '').match(/(\d+)/);
        return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
      },
      getFilterValue: (row) => row.tier || '',
      render: (row) => tierBadge(row.tier),
    },
    {
      key: 'targetTier', label: 'Target Tier', defaultWidth: 120,
      // Tier the account inherits from the Target Accounts list it's
      // mapped to (via My Accounts). Sorts / filters like Tier.
      getSortValue: (row) => {
        const m = String(row.targetTier || '').match(/(\d+)/);
        return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
      },
      getFilterValue: (row) => row.targetTier || '',
      render: (row) => {
        if (!row.targetTier) {
          return <span style={{ color: '#94A3B8' }} title="Not mapped to a Target Account (or the mapped account has no tier). Map it on the My Accounts tab.">—</span>;
        }
        const via = row.targetTierName
          ? `From Target Account "${row.targetTierName}"${row.targetTierSource === 'fuzzy' ? ' (name match)' : ''}`
          : 'From the mapped Target Account';
        return tierBadge(row.targetTier, via);
      },
    },
    { key: 'cdm', label: 'CDM', defaultWidth: 160 },
    {
      key: 'clientManager', label: 'Client Manager', defaultWidth: 180,
      getSortValue: (row) => (row.clientManager || '').toLowerCase(),
      render: (row) => (
        <ClientManagerCell
          company={row.company}
          value={row.clientManager}
          onCommit={setClientManager}
        />
      ),
    },
    {
      key: 'inPersonMeeting', label: 'In Person Meeting', defaultWidth: 150,
      getSortValue: (row) => row.inPersonMeeting ? 1 : 0,
      getFilterValue: (row) => row.inPersonMeeting ? 'Yes' : 'No',
      render: (row) => (
        <InPersonCell
          company={row.company}
          checked={row.inPersonMeeting}
          onChange={setClientInPerson}
        />
      ),
    },
    {
      key: 'invitedToLouisville', label: 'Invited to Louisville?', defaultWidth: 160,
      getSortValue: (row) => row.invitedToLouisville ? 1 : 0,
      getFilterValue: (row) => row.invitedToLouisville ? 'Yes' : 'No',
      render: (row) => (
        <InPersonCell
          company={row.company}
          checked={row.invitedToLouisville}
          onChange={setClientLouisville}
        />
      ),
    },
    {
      key: 'untracked', label: "Don't Track", defaultWidth: 110,
      getSortValue: (row) => row.untracked ? 1 : 0,
      getFilterValue: (row) => row.untracked ? 'Yes' : 'No',
      render: (row) => (
        <InPersonCell
          company={row.company}
          checked={row.untracked}
          onChange={setClientUntracked}
        />
      ),
    },
    { key: 'type', label: 'Type', defaultWidth: 140 },
    {
      key: 'services', label: 'Services', defaultWidth: 100,
      render: (row) => (
        <span style={{ color: row.services > 0 ? '#059669' : '#94A3B8', fontWeight: row.services > 0 ? 600 : 400 }}>
          {row.services || '—'}
        </span>
      ),
    },
    {
      key: 'numberOfSites', label: 'Sites', defaultWidth: 90,
      render: (row) => (
        <span style={{ color: '#475569' }}>{row.numberOfSites || '—'}</span>
      ),
    },
    {
      key: 'soonestExpiration', label: 'Soonest Expiration', defaultWidth: 150,
      getSortValue: (row) => row.soonestExpiration ? row.soonestExpiration.getTime() : null,
      render: (row) => (
        <span style={{ color: row.soonestExpiration ? '#334155' : '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
          {row.soonestExpiration ? fmtDate(row.soonestExpiration) : '—'}
        </span>
      ),
    },
    {
      key: 'daysUntilExpiration', label: 'Days Until', defaultWidth: 110,
      getSortValue: (row) => row.daysUntilExpiration == null ? null : row.daysUntilExpiration,
      render: (row) => {
        if (row.daysUntilExpiration == null) return <span style={{ color: '#94A3B8' }}>—</span>;
        const d = row.daysUntilExpiration;
        // Highlight contracts that are inside the typical 90-day renewal window
        // so they pop without the user having to sort the column manually.
        const color = d <= 30 ? '#B91C1C' : d <= 90 ? '#B45309' : '#475569';
        return (
          <span style={{ color, fontWeight: d <= 90 ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>
            {d}
          </span>
        );
      },
    },
    {
      key: 'website', label: 'Website', defaultWidth: 240,
      render: (row) => {
        if (!row.website) return '—';
        return (
          <a
            href={/^https?:\/\//i.test(row.website) ? row.website : `https://${row.website}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ color: '#0A66C2', textDecoration: 'none', fontSize: '0.72rem' }}
          >
            {row.website}
          </a>
        );
      },
    },
    {
      key: 'notes', label: 'Notes', defaultWidth: 320,
      getSortValue: (row) => (row.notes || '').toLowerCase(),
      getFilterValue: (row) => row.notes || '',
      render: (row) => (
        <NotesCell
          company={row.company}
          value={row.notes}
          onCommit={setClientNotes}
        />
      ),
    },
  ], [expandedIds, columnLinks, listRegistry]);

  const subtabBar = (
    <div style={{ display: 'flex', gap: '0.25rem', padding: '0.5rem 1.25rem 0', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
      {[
        { key: 'clients', label: 'Clients' },
        { key: 'oldclients', label: 'Old Clients' },
        { key: 'deals', label: 'Deals' },
        { key: 'commissions', label: 'Commissions' },
      ].map(t => {
        const active = subtab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => selectSubtab(t.key)}
            style={{
              padding: '0.45rem 0.85rem',
              border: '1px solid',
              borderColor: active ? '#CBD5E1' : 'transparent',
              borderBottomColor: active ? '#fff' : 'transparent',
              borderRadius: '6px 6px 0 0',
              marginBottom: -1,
              background: active ? '#fff' : 'transparent',
              color: active ? '#1E293B' : '#64748B',
              fontSize: '0.78rem',
              fontWeight: active ? 700 : 600,
              cursor: active ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >{t.label}</button>
        );
      })}
    </div>
  );

  if (subtab === 'deals') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {subtabBar}
        <DealsView settings={settings} updateSettings={updateSettings} prospects={prospects} cdmName={cdmName} user={user} addProspect={addProspect} />
      </div>
    );
  }

  if (subtab === 'commissions') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {subtabBar}
        <CommissionsView settings={settings} updateSettings={updateSettings} prospects={prospects} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {subtabBar}
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>{headingLabel}</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            {cdmName ? `${cdmName}'s ${headingLabel.toLowerCase()}` : `Your ${headingLabel.toLowerCase()}`} — every prospect with CDM = {cdmName || 'your CDM'} and <strong>Status = {statusLabel}</strong>
            {showOld ? ` or ${otherLabel}` : ''}. Click ▸ to expand a client&apos;s contracts.
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} />
          <span>Include {otherLabel}s ({oldCount})</span>
        </label>
      </div>

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by company, CDM, Tier, Target Tier, Client Manager, Status, type, website…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <button
          type="button"
          onClick={() => setLinkModalOpen(true)}
          title="Bind the Status column to a Dropdowns-tab list so the cell picks from a fixed option list."
          style={{ padding: '0.4rem 0.8rem', border: '1px solid #E2E8F0', background: 'white', borderRadius: 6, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >Link columns</button>
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {activeCount}{showOld ? ` ${statusLabel.toLowerCase()} · ${oldCount} ${otherLabel.toLowerCase()}` : ''}
        </span>
      </div>

      {/* Always-visible diagnostic strip so 'blank page' is never actually blank. */}
      <div style={{ padding: '0 1.25rem 0.5rem', fontSize: '0.68rem', color: '#64748B', flexShrink: 0 }}>
        Loaded {totalProspects} prospects · {myProspects.length} match CDM &quot;{cdmName || '(unset)'}&quot; · {allClients} are Status={statusLabel} · showing {clients.length}
      </div>

      {/* Legend so the red row tint is self-explanatory on the page. */}
      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.68rem', color: '#64748B', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#FEE2E2', border: '1px solid #FCA5A5', flexShrink: 0 }} />
        <span>
          Red rows need attention: the soonest contract expires within {RENEWAL_WARNING_DAYS} days and the <strong>Status</strong> column is still blank. Set a Status to clear the highlight.
        </span>
        <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#FEF9C3', border: '1px solid #FDE047', flexShrink: 0, marginLeft: '0.6rem' }} />
        <span>Yellow rows are in progress — <strong>Status</strong> is &ldquo;Reached out to CM&rdquo;; the badge counts down the {REACHED_OUT_TIMER_DAYS} days until that status auto-clears.</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {clients.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', textAlign: 'center' }}>No {headingLabel.toLowerCase()} found for {cdmName || 'this user'}</div>
            <div style={{ fontSize: '0.78rem', marginBottom: '0.75rem', textAlign: 'center' }}>
              Set a prospect&apos;s <strong>CDM</strong> to {cdmName || 'your CDM name'} and <strong>Status</strong> to <code>{statusLabel}</code> in My Accounts to list it here.
            </div>
            <div style={{ fontSize: '0.72rem', background: '#F8FAFC', padding: '0.6rem 0.8rem', borderRadius: 6, color: '#334155' }}>
              <div><strong>Diagnostic:</strong></div>
              <div>Total prospects loaded: {totalProspects}</div>
              <div>Prospects matching CDM &quot;{cdmName || '(unset)'}&quot;: {myProspects.length}</div>
              <div>Prospects with Status = {statusLabel}: {allClients}</div>
              <div>{cdmName || 'Your CDM'} + {statusLabel}: {activeCount}</div>
              {totalProspects === 0 && (
                <div style={{ color: '#B91C1C', marginTop: '0.5rem' }}>
                  Prospects haven&apos;t loaded yet. If this sticks, check your network / login.
                </div>
              )}
              {totalProspects > 0 && myProspects.length === 0 && uniqueCdms.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div>No CDM value matches &quot;{cdmName || '(unset)'}&quot;. Unique CDMs in your data:</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', marginTop: '0.25rem', maxHeight: '120px', overflow: 'auto', background: '#fff', padding: '0.4rem', borderRadius: 4 }}>
                    {uniqueCdms.slice(0, 40).map((c, i) => <div key={i}>{c}</div>)}
                    {uniqueCdms.length > 40 && <div>… and {uniqueCdms.length - 40} more</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <DataTable
            tableId={tableId}
            columns={columns}
            rows={rows}
            alwaysVisible={['company']}
            defaultSort={{ key: 'daysUntilExpiration', direction: 'asc' }}
            rowStyle={(row) => {
              // Untracked clients sit greyed at the bottom (Days Until
              // is blanked above so the default ascending sort drops
              // them past every row with a real date).
              if (row.untracked) {
                return { background: '#F1F5F9', color: '#94A3B8' };
              }
              const s = String(row.Status || '').trim();
              // Tint yellow once the user has "Reached out to CM" about a
              // client — these are in progress, distinct from the red rows
              // that still need any status at all.
              if (/reached\s*out/i.test(s) && /\bcm\b/i.test(s)) {
                return { background: '#FEF9C3' };
              }
              // Tint the row light red when a renewal is closing in
              // (<270 days) and the Status column is unset — those are
              // the clients that need a status set before they slip.
              const noStatus = s === '' || s === '-' || s === '—' || s === '–';
              if (row.daysUntilExpiration != null && row.daysUntilExpiration < RENEWAL_WARNING_DAYS && noStatus) {
                return { background: '#FEE2E2' };
              }
              return undefined;
            }}
            expandedRowIds={expandedIds}
            renderExpansion={(row) => (
              <ContractTable deals={dealsByClient.get(normClientName(row.company)) || []} />
            )}
            emptyMessage={q ? `No clients match "${query}"` : 'No clients to display'}
            enableColumnFilters
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>
      {linkModalOpen && (
        <LinkColumnsModal
          headers={['Status']}
          columnLinks={columnLinks}
          listRegistry={listRegistry}
          availableLists={availableLists}
          onChange={updateColumnLinks}
          onClose={() => setLinkModalOpen(false)}
        />
      )}
    </div>
  );
}
````

### src/components/ClientsView/CommissionsPasteImportModal.jsx

````jsx
import { useState, useMemo } from 'react';
import { COMMISSION_MONTH_NAMES } from '../../utils/commissionsStore';

// Canonical destination columns. Order mirrors the table layout the
// user pastes in: identity columns, then monthly revenue, the FY
// total, and finally the monthly commission amounts. Columns are
// year-agnostic — a pasted "1/1/2026 Revenue" cell lands in the
// "January Revenue" column regardless of year.
function buildCanonical() {
  const cols = ['Name', 'Account Name', 'BFO Name', 'Project Name', 'Comm Start Date', 'Comm End Date', '%'];
  for (const m of COMMISSION_MONTH_NAMES) cols.push(`${m} Revenue`);
  cols.push('FY Revenue');
  for (const m of COMMISSION_MONTH_NAMES) cols.push(m);
  return cols;
}

export const COMMISSIONS_CANONICAL = buildCanonical();

// Cheap normalizer for header-vs-header comparisons. Lowercases,
// drops whitespace, "." and "$".
function normHeader(s) {
  return String(s || '').toLowerCase().replace(/[\s.$]/g, '');
}

const NORM_CANONICAL = COMMISSIONS_CANONICAL.map(c => ({ c, n: normHeader(c) }));

// Map a pasted source header onto a canonical destination. Direct
// month-name matches go through the normalized lookup; legacy
// "<m>/1/<year>" date headers (the way Excel sometimes labels monthly
// columns) are translated to the matching month name so the user can
// paste this year's data into year-agnostic columns without
// re-mapping each month by hand.
function autoMap(srcHeader) {
  const cleaned = String(srcHeader || '').trim().replace(/\.+$/, '');
  if (!cleaned) return '';

  // FY{year} Revenue → FY Revenue (year stripped, value rolls into the
  // single year-agnostic FY column).
  if (/^FY\d{4}\s+Revenue$/i.test(cleaned)) return 'FY Revenue';

  // <m>/1/<year> Revenue → "<Month> Revenue"
  const monthRev = /^(\d{1,2})\/1\/\d{4}\s+Revenue$/i.exec(cleaned);
  if (monthRev) {
    const mi = Number(monthRev[1]);
    if (mi >= 1 && mi <= 12) return `${COMMISSION_MONTH_NAMES[mi - 1]} Revenue`;
  }

  // <m>/1/<year> → "<Month>" (commission column)
  const month = /^(\d{1,2})\/1\/\d{4}$/.exec(cleaned);
  if (month) {
    const mi = Number(month[1]);
    if (mi >= 1 && mi <= 12) return COMMISSION_MONTH_NAMES[mi - 1];
  }

  const n = normHeader(cleaned);
  const hit = NORM_CANONICAL.find(x => x.n === n);
  return hit ? hit.c : '';
}

// Tab-separated parser. Mirrors PasteImportModal so cells with
// newlines / tabs / quotes (the Google-Sheets clipboard format) come
// through intact instead of getting torn at the first newline.
function parseTSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"' && !cellStarted) { inQuotes = true; cellStarted = true; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; cellStarted = false; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; cellStarted = false; continue; }
    cell += ch;
    cellStarted = true;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  while (rows.length > 0 && rows[rows.length - 1].every(c => c === '')) rows.pop();
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(h => String(h || '').trim());
  return { headers, rows: rows.slice(1) };
}

export function CommissionsPasteImportModal({ onClose, onImport, initialPaste = '' }) {
  const [paste, setPaste] = useState(initialPaste);
  const [stage, setStage] = useState('paste');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState('');

  function handleNext() {
    setParseError('');
    const { headers: h, rows } = parseTSV(paste);
    if (h.length === 0 || rows.length === 0) {
      setParseError('Nothing to import — paste tab-separated data copied from Excel or Google Sheets.');
      return;
    }
    const m = {};
    for (const src of h) m[src] = autoMap(src);
    setHeaders(h);
    setRawRows(rows);
    setMapping(m);
    setStage('map');
  }

  // Live import preview — re-runs whenever the mapping or pasted data
  // changes so the user sees in real time which rows will land and which
  // will get dropped (and why). handleImport just consumes this same
  // breakdown so the button never disagrees with the on-screen counts.
  const importPreview = useMemo(() => {
    const accepted = [];
    const skipped = [];
    for (let r = 0; r < rawRows.length; r++) {
      const cells = rawRows[r];
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        const dest = mapping[headers[i]];
        if (!dest) continue;
        const v = cells[i];
        if (v == null || v === '') continue;
        obj[dest] = v;
      }
      // Row numbers report against the user's pasted spreadsheet —
      // headers are row 1, the first data row is row 2, etc.
      const rowNumber = r + 2;
      if (Object.keys(obj).length === 0) {
        skipped.push({ rowNumber, reason: 'Blank row (no mapped cells had a value)' });
        continue;
      }
      if (!String(obj['Project Name'] || '').trim()) {
        skipped.push({ rowNumber, reason: 'Missing Project Name' });
        continue;
      }
      accepted.push(obj);
    }
    const byReason = new Map();
    for (const s of skipped) {
      if (!byReason.has(s.reason)) byReason.set(s.reason, []);
      byReason.get(s.reason).push(s.rowNumber);
    }
    return { accepted, skipped, byReason };
  }, [rawRows, headers, mapping]);

  function handleImport() {
    const { accepted } = importPreview;
    if (accepted.length === 0) {
      setParseError('Nothing to import — every pasted row was either blank or missing a Project Name.');
      return;
    }
    onImport(accepted);
  }

  const mappedCount = useMemo(
    () => headers.filter(h => mapping[h]).length,
    [headers, mapping]
  );
  const preview = useMemo(() => rawRows.slice(0, 3), [rawRows]);
  const unmappedSourceNames = useMemo(
    () => headers.filter(h => !mapping[h]),
    [headers, mapping]
  );
  const duplicateDestinations = useMemo(() => {
    const seen = new Map();
    for (const src of headers) {
      const dest = mapping[src];
      if (!dest) continue;
      seen.set(dest, (seen.get(dest) || 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([d]) => d);
  }, [headers, mapping]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(1100px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>
            {stage === 'paste' ? 'Paste commissions from Excel' : `Map columns — ${rawRows.length} rows`}
          </strong>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {stage === 'paste' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
              In Excel, select the rows you want (including the header row) and copy with <strong>Ctrl+C</strong> / <strong>Cmd+C</strong>. Then click in the box below and paste. The next step lets you confirm which pasted column maps to each commission field.
            </div>
            <textarea
              autoFocus
              value={paste}
              onChange={e => setPaste(e.target.value)}
              placeholder="Paste your tab-separated data here…"
              style={{ width: '100%', minHeight: 320, padding: '0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.72rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical', boxSizing: 'border-box' }}
            />
            {parseError && (
              <div style={{ padding: '0.4rem 0.6rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.72rem' }}>{parseError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={onClose} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleNext} disabled={!paste.trim()} style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: paste.trim() ? '#3B82F6' : '#94A3B8', color: '#fff', fontSize: '0.78rem', cursor: paste.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontWeight: 600 }}>Next: Map columns →</button>
            </div>
          </div>
        )}

        {stage === 'map' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1, minHeight: 0 }}>
            <div style={{ fontSize: '0.72rem', color: '#475569' }}>
              {rawRows.length} rows · <strong>{mappedCount}/{headers.length}</strong> columns mapped
              {unmappedSourceNames.length > 0 && <> · <span style={{ color: '#92400E' }}>{unmappedSourceNames.length} pasted column{unmappedSourceNames.length === 1 ? '' : 's'} will be skipped</span></>}
              {duplicateDestinations.length > 0 && <> · <span style={{ color: '#991B1B' }}>Multiple sources point at: {duplicateDestinations.join(', ')}</span></>}
            </div>
            {/* Per-row outcome summary. Lists how many pasted rows
                will land vs. get dropped, broken out by reason. The
                user expects every paste to fully import, so when rows
                fail we want it loud and explicit. */}
            <div style={{ padding: '0.5rem 0.7rem', borderRadius: 6, border: `1px solid ${importPreview.skipped.length > 0 ? '#FCA5A5' : '#A7F3D0'}`, background: importPreview.skipped.length > 0 ? '#FEF2F2' : '#F0FDF4', fontSize: '0.72rem', color: '#1E293B', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div>
                <strong style={{ color: importPreview.accepted.length > 0 ? '#166534' : '#991B1B' }}>{importPreview.accepted.length}</strong>
                {' of '}<strong>{rawRows.length}</strong> row{rawRows.length === 1 ? '' : 's'} will import
                {importPreview.skipped.length > 0 && (
                  <> · <strong style={{ color: '#991B1B' }}>{importPreview.skipped.length} skipped</strong></>
                )}
              </div>
              {importPreview.byReason.size > 0 && (
                <ul style={{ margin: '0.1rem 0 0', padding: '0 0 0 1rem', color: '#7F1D1D' }}>
                  {[...importPreview.byReason.entries()].map(([reason, rowNums]) => (
                    <li key={reason}>
                      <strong>{rowNums.length}</strong> {rowNums.length === 1 ? 'row' : 'rows'} — {reason}
                      <span style={{ color: '#94A3B8' }}> ({rowNums.length <= 10
                        ? `row${rowNums.length === 1 ? '' : 's'} ${rowNums.join(', ')}`
                        : `rows ${rowNums.slice(0, 10).join(', ')}, +${rowNums.length - 10} more`})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div style={{ overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: 6, flex: 1, minHeight: 0 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.72rem' }}>
                <thead style={{ background: '#F1F5F9', position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>Source header</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>→ Destination</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>Preview (first 3 rows)</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((src, i) => {
                    const dest = mapping[src];
                    return (
                      <tr key={i} style={{ background: dest ? '#FFFFFF' : '#FFFBEB' }}>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', fontWeight: 600, color: '#1E293B', whiteSpace: 'nowrap' }}>
                          {src || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(blank)</span>}
                        </td>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0' }}>
                          <select
                            value={dest || ''}
                            onChange={e => setMapping(m => ({ ...m, [src]: e.target.value }))}
                            style={{ padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', minWidth: 240, background: '#fff' }}
                          >
                            <option value="">— Skip —</option>
                            {COMMISSIONS_CANONICAL.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', color: '#64748B', maxWidth: 360 }}>
                          {preview.map((cells, pi) => (
                            <div key={pi} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={cells[i] ?? ''}>
                              {cells[i] || <span style={{ color: '#CBD5E1' }}>—</span>}
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {parseError && (
              <div style={{ padding: '0.4rem 0.6rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.72rem' }}>{parseError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <button onClick={() => setStage('paste')} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={onClose} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={handleImport} disabled={mappedCount === 0 || importPreview.accepted.length === 0} title="New rows are merged into the existing list. Duplicates are screened out by Project Name — the copy with more data filled in survives." style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: (mappedCount === 0 || importPreview.accepted.length === 0) ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: (mappedCount === 0 || importPreview.accepted.length === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Import {importPreview.accepted.length} row{importPreview.accepted.length === 1 ? '' : 's'} (merge by Project Name) →</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
````

### src/components/ClientsView/CommissionsView.jsx

````jsx
import { useMemo, useState, useEffect, useCallback } from 'react';
import { DataTable } from '../common/DataTable';
import { asNumber, asDate, fmtCurrency, fmtPercent, fmtDate } from '../../utils/dealsFormat';
import {
  loadCommissions, saveCommissionsOverride, clearCommissionsOverride,
  COMMISSION_MONTH_NAMES,
} from '../../utils/commissionsStore';
import { CommissionsPasteImportModal, COMMISSIONS_CANONICAL } from './CommissionsPasteImportModal';
import { loadOppsFromCache, findOppByBfoLink } from '../../utils/oppsCache';

// Lookup columns the user adds at the front of the table. Account Name
// is an autocomplete against the Table View prospect roster; BFO Name is
// the BFO Opportunity Name the user pastes from the Opps tab; Scope is
// a read-only lookup that resolves BFO Name against the cached Opps
// records.
const ACCOUNT_NAME_KEY = 'Account Name';
const BFO_NAME_KEY = 'BFO Name';
const SCOPE_KEY = 'Scope';

// Shared <datalist> id for the Account Name autocomplete — every cell
// editor on the column points at this list via `list="..."`.
const ACCOUNT_NAME_LIST_ID = 'commissions-account-name-suggestions';

// Inline cell editor: shows the formatted value, swaps to a text input on
// double-click, commits on Enter / blur, cancels on Escape. `listId`
// hooks the input up to a <datalist> for autocomplete (Account Name).
function EditableCell({ value, render, onSave, listId }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => {
    if (!editing) setDraft(value == null ? '' : String(value));
  }, [value, editing]);

  function commit(next) {
    onSave(next == null ? '' : String(next));
    setEditing(false);
  }

  if (!editing) {
    return (
      <span
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title="Double-click to edit"
        style={{ display: 'inline-block', width: '100%', cursor: 'text' }}
      >
        {render(value)}
      </span>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      value={draft}
      list={listId}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(value == null ? '' : String(value)); setEditing(false); }
      }}
      style={{
        width: '100%', padding: '0.15rem 0.3rem',
        border: '1px solid #3B82F6', borderRadius: 4,
        fontSize: '0.7rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B',
        boxSizing: 'border-box',
      }}
    />
  );
}

// Month columns are year-agnostic — "January" is the January commission
// $, "January Revenue" is its underlying project revenue, and "FY
// Revenue" is the annual roll-up. Helpers recognize those keys when
// summing / formatting; data pasted under the legacy "<m>/1/<year>"
// shape gets migrated to month names on load by commissionsStore.
const MONTH_NAME_SET = new Set(COMMISSION_MONTH_NAMES);
function isMonthCommissionKey(k) { return MONTH_NAME_SET.has(String(k || '').trim()); }
function isMonthRevenueKey(k) {
  const s = String(k || '').trim();
  if (!s.endsWith(' Revenue')) return false;
  return MONTH_NAME_SET.has(s.slice(0, s.length - ' Revenue'.length));
}
function isFYRevenueKey(k) { return String(k || '').trim() === 'FY Revenue'; }

const FY_COMMISSION_KEY = 'FY Commission';
const PAYMENT_STATUS_KEY = 'Payment Status';

const CURRENCY_KEYS = new Set();
const DATE_KEYS = new Set(['Comm Start Date', 'Comm End Date']);
const PERCENT_KEYS = new Set(['%']);

function defaultWidth(k) {
  if (k === ACCOUNT_NAME_KEY) return 200;
  if (k === BFO_NAME_KEY) return 200;
  if (k === SCOPE_KEY) return 180;
  if (k === FY_COMMISSION_KEY) return 130;
  if (k === PAYMENT_STATUS_KEY) return 110;
  if (k === 'Name') return 170;
  if (k === 'Project Name') return 280;
  if (DATE_KEYS.has(k)) return 120;
  if (PERCENT_KEYS.has(k)) return 70;
  if (isFYRevenueKey(k)) return 130;
  if (isMonthRevenueKey(k) || isMonthCommissionKey(k)) return 110;
  return 130;
}

// Sum every column on the row whose key matches `match`. Returns null
// when the row has no matching cells at all — the renderer falls back
// to a muted dash for that case so an empty roster row still reads as
// "no data" instead of "$0.00".
function sumMatchingCells(row, match) {
  let total = 0;
  let any = false;
  for (const k of Object.keys(row || {})) {
    if (!match(k)) continue;
    const n = asNumber(row[k]);
    if (n == null) continue;
    total += n;
    any = true;
  }
  return any ? total : null;
}

// "Are payments still rolling in or have they stopped?" — used by the
// Payment Status column. Prefers the explicit Comm End Date when set; if
// the row doesn't have one, falls back to the most recent non-zero
// monthly commission cell and compares it against today.
function paymentStatusFor(row) {
  const end = asDate(row?.['Comm End Date']);
  if (end) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const e = new Date(end); e.setHours(0, 0, 0, 0);
    if (e.getTime() < today.getTime()) {
      return { state: 'stopped', label: 'Stopped', title: `Comm End Date ${fmtDate(end)} is in the past` };
    }
    return { state: 'active', label: 'Active', title: `Comm End Date ${fmtDate(end)}` };
  }
  let lastIdx = -1;
  for (let i = 0; i < COMMISSION_MONTH_NAMES.length; i++) {
    const n = asNumber(row?.[COMMISSION_MONTH_NAMES[i]]);
    if (n != null && n !== 0) lastIdx = i;
  }
  if (lastIdx === -1) return { state: 'unknown', label: '—', title: 'No Comm End Date and no commission entries on file' };
  const todayMonthIdx = new Date().getMonth();
  if (lastIdx >= todayMonthIdx - 1) {
    return { state: 'active', label: 'Active', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]}` };
  }
  return { state: 'stopped', label: 'Stopped', title: `Most recent commission: ${COMMISSION_MONTH_NAMES[lastIdx]} — no payments since` };
}

function PaymentStatusBadge({ state, label, title }) {
  const palette = state === 'active' ? { bg: '#DCFCE7', fg: '#166534' }
    : state === 'stopped' ? { bg: '#FEE2E2', fg: '#991B1B' }
    : { bg: '#F1F5F9', fg: '#64748B' };
  return (
    <span title={title} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 4, background: palette.bg, color: palette.fg, fontWeight: 600, fontSize: '0.7rem' }}>
      {label}
    </span>
  );
}

// Plain-text cell used by Account Name / BFO Name / pasted Name fields.
function plainTextRender(v) {
  if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  return <span>{String(v)}</span>;
}

// Normalize a Project Name for dedup matching — strips surrounding
// whitespace, collapses internal whitespace, and lowercases so trivial
// typing differences ("Acme — Phase 1" vs "ACME — Phase 1 ") don't
// produce two duplicate rows that fall through the merge.
function normProjectName(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// How many "real" cells on this row carry a value. Used to pick the
// surviving row when two rows share a project name — whichever copy has
// more months / columns filled in beats the stale one.
function countFilledCells(row) {
  let n = 0;
  for (const k of Object.keys(row || {})) {
    if (k === 'id' || k.startsWith('__')) continue;
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s === '') continue;
    n++;
  }
  return n;
}

// Columns the user fills in by hand on top of the pasted roster, or
// that they can now paste in directly. The merge keeps a prior value
// whenever the incoming paste leaves the cell blank — so re-pasting
// refreshed commission data without an Account Name / BFO Name column
// doesn't wipe out the mapping the user already built up. When the
// incoming paste does provide a value, it wins.
const USER_MAPPED_KEYS = [ACCOUNT_NAME_KEY, BFO_NAME_KEY, SCOPE_KEY];

// Concatenate existing + newly-pasted commission rows and dedup by
// normalized Project Name. Rows without a project name pass through
// untouched (we have no key to group them by); for rows with one, the
// copy with more filled cells survives. Newer (incoming) rows win ties
// so a re-paste of an equally-filled row picks up any edits. The
// user-mapped lookup columns (Account Name, BFO Name, Scope) are
// always carried over from the existing row when there is one, since
// the paste source never includes them.
export function mergeAndDedupCommissions(existing, incoming) {
  const out = [];
  const winnerByKey = new Map();
  const existingByKey = new Map();
  function consider(row, isIncoming) {
    const key = normProjectName(row['Project Name']);
    if (!key) { out.push(row); return; }
    if (!isIncoming) existingByKey.set(key, row);
    const score = countFilledCells(row);
    const prev = winnerByKey.get(key);
    if (!prev || score > prev.score || (score === prev.score && isIncoming)) {
      winnerByKey.set(key, { row, score });
    }
  }
  for (const r of (existing || [])) consider(r, false);
  for (const r of (incoming || [])) consider(r, true);
  for (const [key, { row }] of winnerByKey.entries()) {
    const prior = existingByKey.get(key);
    if (prior && prior !== row) {
      const merged = { ...row };
      for (const k of USER_MAPPED_KEYS) {
        const incomingVal = row[k];
        const incomingHas = incomingVal != null && String(incomingVal).trim() !== '';
        if (incomingHas) continue;
        const priorVal = prior[k];
        if (priorVal != null && String(priorVal).trim() !== '') {
          merged[k] = priorVal;
        }
      }
      out.push(merged);
    } else {
      out.push(row);
    }
  }
  return out;
}

// Build the three lookup columns the user adds in front of the imported
// roster: Account Name (autocomplete from prospects), BFO Name (free
// text — the BFO Opportunity Name the user pastes), and Scope (read-only
// lookup that resolves BFO Name against the cached Opps records).
function buildFrontColumns(oppsCache) {
  return [
    {
      key: ACCOUNT_NAME_KEY,
      label: ACCOUNT_NAME_KEY,
      defaultWidth: defaultWidth(ACCOUNT_NAME_KEY),
      sticky: true,
      render: (row) => (
        <EditableCell
          value={row[ACCOUNT_NAME_KEY]}
          render={plainTextRender}
          onSave={(v) => row.__onUpdate?.(row.id, ACCOUNT_NAME_KEY, v)}
          listId={ACCOUNT_NAME_LIST_ID}
        />
      ),
      exportValue: (row) => row[ACCOUNT_NAME_KEY] ?? '',
    },
    {
      key: BFO_NAME_KEY,
      label: BFO_NAME_KEY,
      defaultWidth: defaultWidth(BFO_NAME_KEY),
      render: (row) => (
        <EditableCell
          value={row[BFO_NAME_KEY]}
          render={plainTextRender}
          onSave={(v) => row.__onUpdate?.(row.id, BFO_NAME_KEY, v)}
        />
      ),
      exportValue: (row) => row[BFO_NAME_KEY] ?? '',
    },
    {
      key: SCOPE_KEY,
      label: SCOPE_KEY,
      defaultWidth: defaultWidth(SCOPE_KEY),
      // Scope is derived from the Opps cache — sort and export off the
      // resolved value, not whatever (nothing) is stored on the row.
      getSortValue: (row) => {
        const opp = findOppByBfoLink(oppsCache, row[BFO_NAME_KEY]);
        return opp ? String(opp[SCOPE_KEY] || '') : '';
      },
      render: (row) => {
        const bfo = String(row[BFO_NAME_KEY] || '').trim();
        if (!bfo) return <span style={{ color: 'var(--color-text-muted)' }} title="Paste a BFO Opportunity Name in the previous column to look up its Scope">—</span>;
        const opp = findOppByBfoLink(oppsCache, bfo);
        if (!opp) return <span style={{ color: '#B91C1C' }} title="No Opps row matches this BFO Opportunity Name">no match</span>;
        const scope = String(opp[SCOPE_KEY] || '').trim();
        if (!scope) return <span style={{ color: 'var(--color-text-muted)' }} title="Matching Opps row has no Scope set">—</span>;
        return <span title={`From Opps row for "${bfo}"`}>{scope}</span>;
      },
      exportValue: (row) => {
        const opp = findOppByBfoLink(oppsCache, row[BFO_NAME_KEY]);
        return opp ? (opp[SCOPE_KEY] || '') : '';
      },
    },
  ];
}

// Pill-style currency cell used by the auto-summed FY Revenue / FY
// Commission columns so they read as derived totals, not editable cells.
function renderSumCell(total, emptyTitle, sumTitle) {
  if (total == null) {
    return <span style={{ color: 'var(--color-text-muted)' }} title={emptyTitle}>—</span>;
  }
  return (
    <span
      title={sumTitle}
      style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A', fontWeight: 600 }}
    >
      {fmtCurrency(total)}
    </span>
  );
}

// Columns the user can drive from the bulk-edit bar. Derived columns
// (Scope is read from the Opps cache, FY Revenue / FY Commission are
// summed at render time, Payment Status is computed) are excluded
// because setting them on a row wouldn't survive the next render.
function buildBulkEditableKeys() {
  const out = [
    ACCOUNT_NAME_KEY, BFO_NAME_KEY,
    'Name', 'Project Name',
    'Comm Start Date', 'Comm End Date', '%',
  ];
  for (const m of COMMISSION_MONTH_NAMES) out.push(`${m} Revenue`);
  for (const m of COMMISSION_MONTH_NAMES) out.push(m);
  return out;
}
const BULK_EDITABLE_KEYS = buildBulkEditableKeys();

// Bulk-edit toolbar. Pops in above the table whenever the user has
// at least one row selected. Picks a target column, takes a value,
// and routes the write through onApply / onDelete on the parent.
function BulkEditBar({ selectedCount, onApply, onDelete, onSetIgnored, onClearSelection }) {
  const [field, setField] = useState(BULK_EDITABLE_KEYS[0]);
  const [value, setValue] = useState('');
  return (
    <div style={{
      margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem',
      background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6,
      display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
      fontSize: '0.75rem', color: '#1E3A8A',
    }}>
      <strong>{selectedCount}</strong> selected · set
      <select
        value={field}
        onChange={(e) => setField(e.target.value)}
        style={{ padding: '0.25rem 0.4rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', background: '#fff' }}
        title="Pick which column to set on every selected row"
      >
        {BULK_EDITABLE_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
      </select>
      to
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="value (leave blank to clear)"
        style={{ flex: 1, minWidth: 160, maxWidth: 320, padding: '0.25rem 0.4rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.75rem', fontFamily: 'inherit', background: '#fff' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onApply(field, value); setValue(''); }
        }}
      />
      <button
        type="button"
        onClick={() => { onApply(field, value); setValue(''); }}
        title={`Set ${field} = "${value}" on all ${selectedCount} selected rows`}
        style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: 4, background: '#2563EB', color: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
      >Apply</button>
      <button
        type="button"
        onClick={() => onApply(field, '')}
        title={`Clear ${field} on all ${selectedCount} selected rows`}
        style={{ padding: '0.3rem 0.7rem', border: '1px solid #93C5FD', borderRadius: 4, background: '#fff', color: '#1E3A8A', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >Clear field</button>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={() => onSetIgnored?.(true)}
        title="Grey out every selected row (excluded from YOY totals)"
        style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#334155', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >Mark ignored</button>
      <button
        type="button"
        onClick={() => onSetIgnored?.(false)}
        title="Restore every selected row"
        style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#334155', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >Unignore</button>
      <button
        type="button"
        onClick={onDelete}
        title="Delete every selected row"
        style={{ padding: '0.3rem 0.7rem', border: '1px solid #FCA5A5', borderRadius: 4, background: '#fff', color: '#B91C1C', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
      >Delete selected</button>
      <button
        type="button"
        onClick={onClearSelection}
        title="Deselect every row"
        style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}
      >Cancel</button>
    </div>
  );
}

// Per-row selection checkbox. Lives in its own sticky column on the
// far left of the table. The "select all" header is rendered by
// `buildSelectHeader` inside the component so it can close over the
// current visible-rows state setter.
function buildSelectCol(renderHeader) {
  return {
    key: '__select',
    label: '',
    defaultWidth: 36,
    sticky: true,
    renderHeader,
    render: (row) => (
      <input
        type="checkbox"
        checked={!!row.__isSelected}
        onClick={(e) => e.stopPropagation()}
        onChange={() => row.__onToggleSelect?.(row.id)}
        style={{ cursor: 'pointer' }}
        aria-label="Select row for bulk actions"
      />
    ),
    exportValue: () => '',
  };
}

function buildColumns(oppsCache, selectCol) {
  const front = buildFrontColumns(oppsCache);
  const canonical = COMMISSIONS_CANONICAL.map((k) => {
    const isCurrency = CURRENCY_KEYS.has(k) || isMonthRevenueKey(k) || isFYRevenueKey(k) || isMonthCommissionKey(k);
    const isDate = DATE_KEYS.has(k);
    const isPercent = PERCENT_KEYS.has(k);
    // FY Revenue is computed at render time from the 12 monthly revenue
    // cells to its left — the user wants a live total, not whatever was
    // pasted. Sort / export both follow the same computed number.
    if (isFYRevenueKey(k)) {
      return {
        key: k,
        label: k,
        defaultWidth: defaultWidth(k),
        getSortValue: (row) => sumMatchingCells(row, isMonthRevenueKey),
        render: (row) => renderSumCell(
          sumMatchingCells(row, isMonthRevenueKey),
          'No monthly revenue entries on this row',
          `Sum of the 12 monthly revenue cells across the year`,
        ),
        exportValue: (row) => sumMatchingCells(row, isMonthRevenueKey) ?? '',
      };
    }
    return {
      key: k,
      label: k,
      defaultWidth: defaultWidth(k),
      ...(isDate ? { getSortValue: (row) => { const d = asDate(row[k]); return d ? d.getTime() : null; } } : {}),
      ...(isCurrency || isPercent ? { getSortValue: (row) => asNumber(row[k]) } : {}),
      render: (row) => {
        const v = row[k];
        if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
        if (isCurrency) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtCurrency(v)}</span>;
        if (isPercent) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtPercent(v)}</span>;
        if (isDate) return <span style={{ color: '#334155' }}>{fmtDate(v)}</span>;
        return <span>{String(v)}</span>;
      },
      exportValue: (row) => {
        const v = row[k];
        if (v == null) return '';
        if (isCurrency || isPercent) {
          const n = asNumber(v);
          return n != null ? n : v;
        }
        return v;
      },
    };
  });
  // Mirror of the FY Revenue column, but summing the 12 monthly
  // commission cells — sits at the tail of the table where the user
  // wanted it. Followed by the derived Payment Status pill.
  const fyCommissionCol = {
    key: FY_COMMISSION_KEY,
    label: FY_COMMISSION_KEY,
    defaultWidth: defaultWidth(FY_COMMISSION_KEY),
    getSortValue: (row) => sumMatchingCells(row, isMonthCommissionKey),
    render: (row) => renderSumCell(
      sumMatchingCells(row, isMonthCommissionKey),
      'No monthly commission entries on this row',
      `Sum of the 12 monthly commission cells across the year`,
    ),
    exportValue: (row) => sumMatchingCells(row, isMonthCommissionKey) ?? '',
  };
  const paymentStatusCol = {
    key: PAYMENT_STATUS_KEY,
    label: PAYMENT_STATUS_KEY,
    defaultWidth: defaultWidth(PAYMENT_STATUS_KEY),
    getSortValue: (row) => paymentStatusFor(row).state,
    render: (row) => {
      const s = paymentStatusFor(row);
      return <PaymentStatusBadge state={s.state} label={s.label} title={s.title} />;
    },
    exportValue: (row) => paymentStatusFor(row).label,
  };
  // Trailing per-row delete cell. Lives in its own column so the user
  // can wipe a stale project without clearing every other row through
  // the Clear button.
  const deleteCol = {
    key: '__delete',
    label: '',
    defaultWidth: 44,
    render: (row) => (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const label = String(row['Project Name'] || row['Name'] || 'this row').trim() || 'this row';
          if (!window.confirm(`Delete "${label}" from the commissions roster?`)) return;
          row.__onDelete?.(row.id);
        }}
        title="Delete this row"
        style={{
          background: 'transparent', border: '1px solid var(--color-border)',
          color: '#B91C1C', borderRadius: 4, padding: '0 6px',
          fontSize: '0.78rem', fontFamily: 'inherit', cursor: 'pointer', lineHeight: 1.4,
        }}
      >×</button>
    ),
    exportValue: () => '',
  };
  // Per-row "ignore" toggle. Greys out the row everywhere it's rendered
  // without affecting the underlying data — useful for parking
  // intentionally-skipped projects (one-off corrections, refund rows,
  // duplicates) where the user wants a visual mute, not a delete.
  const ignoreCol = {
    key: '__ignored',
    label: '',
    defaultWidth: 64,
    render: (row) => {
      const on = !!row.__ignored;
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            row.__onToggleIgnore?.(row.id);
          }}
          title={on ? 'Row is ignored — click to restore.' : 'Mark this row as ignored (greys it out).'}
          style={{
            background: on ? '#E2E8F0' : 'transparent',
            border: '1px solid var(--color-border)',
            color: on ? '#475569' : '#64748B',
            borderRadius: 4, padding: '0 6px',
            fontSize: '0.72rem', fontFamily: 'inherit', cursor: 'pointer', lineHeight: 1.4,
            fontWeight: 600,
          }}
        >{on ? 'Ignored' : 'Ignore'}</button>
      );
    },
    exportValue: (row) => (row.__ignored ? 'Ignored' : ''),
  };
  return [selectCol, ...front, ...canonical, fyCommissionCol, paymentStatusCol, ignoreCol, deleteCol];
}

export function CommissionsView({ settings, updateSettings, prospects = [] }) {
  const [{ data, source }, setStore] = useState(() => loadCommissions());
  const [search, setSearch] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [initialPaste, setInitialPaste] = useState('');
  // Cached Opps records, used by the Scope lookup column. Refreshes on
  // mount and when the window regains focus so pasting on the Opps tab
  // and switching back here reflects new entries without a reload.
  const [oppsCache, setOppsCache] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      loadOppsFromCache().then(c => { if (!cancelled) setOppsCache(c || null); }).catch(() => {});
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'commissions-list-override') setStore(loadCommissions());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Page-level paste handler. When the user hits Ctrl/Cmd+V anywhere on
  // the Commissions tab — including the empty-state placeholder, the
  // toolbar, or the table — pop the import modal open with the
  // clipboard text pre-filled so they don't have to click Paste from
  // Excel first. Skipped while a real input / textarea has focus so the
  // search box and the modal's own textarea keep working normally.
  useEffect(() => {
    function onPaste(e) {
      if (showPaste) return;
      const ae = document.activeElement;
      const tag = ae && ae.tagName ? ae.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (ae && ae.isContentEditable)) return;
      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (!text || !text.trim()) return;
      e.preventDefault();
      setInitialPaste(text);
      setShowPaste(true);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [showPaste]);

  // Selection state for the bulk-edit toolbar. Row "ids" are the raw
  // array indices on the underlying data; we clear the selection after
  // every bulk mutation so a shifted index never resurfaces as a
  // mis-targeted edit. `visibleIds` mirrors the rows the DataTable is
  // actually rendering (after both the search box and any in-table
  // column-filter chips have been applied), so the header "select all"
  // checkbox grabs only what the user can see.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [visibleIds, setVisibleIds] = useState([]);
  const onTableFilteredRowsChange = useCallback((tableRows) => {
    setVisibleIds(tableRows.map(r => r.id));
  }, []);

  const toggleSelect = (rowId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(prev => {
      const visible = visibleIds;
      const allSelected = visible.length > 0 && visible.every(id => prev.has(id));
      if (allSelected) {
        // Toggle off — clear just the visible ones, leave any
        // off-screen selection alone (the user can still see the count
        // and act on it via the toolbar).
        const next = new Set(prev);
        for (const id of visible) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visible) next.add(id);
      return next;
    });
  };

  // Closure-captured renderHeader so the select-all checkbox sees the
  // live selection state without forcing the column list to rebuild on
  // every toggle.
  const selectColHeader = () => {
    const visible = visibleIds;
    const allSelected = visible.length > 0 && visible.every(id => selectedIds.has(id));
    const someSelected = !allSelected && visible.some(id => selectedIds.has(id));
    return (
      <input
        type="checkbox"
        checked={allSelected}
        ref={(el) => { if (el) el.indeterminate = someSelected; }}
        onClick={(e) => e.stopPropagation()}
        onChange={selectAllVisible}
        style={{ cursor: 'pointer' }}
        title="Select / clear every row currently visible in the table"
      />
    );
  };

  const columns = useMemo(
    () => buildColumns(oppsCache, buildSelectCol(selectColHeader)),
    // selectColHeader closes over selectedIds. tableId depends only on
    // the column keys (stable), so re-creating the array on every
    // selection toggle re-renders the header without remounting the
    // table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [oppsCache, selectedIds]
  );
  const tableId = useMemo(() => 'commissions:' + columns.map(c => c.key).sort().join('|'), [columns]);

  // Page-level autocomplete pool for the Account Name column —
  // mirrors the Deals tab's Client Name suggestions so the user gets
  // predictive matches against every company already in Table View.
  const accountNameSuggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of (prospects || [])) {
      const c = String(p?.company || '').trim();
      if (!c) continue;
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [prospects]);

  // Flip the __ignored flag on a row. A truthy flag greys the row out
  // everywhere it's rendered (and excludes it from the YOY commission
  // totals). Persisted via the same override store as every other
  // cell edit.
  function toggleIgnored(rowId) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setStore(prev => {
      const next = [...prev.data];
      const current = { ...(next[idx] || {}) };
      if (current.__ignored) delete current.__ignored;
      else current.__ignored = true;
      next[idx] = current;
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
  }

  // Bulk version — set or clear __ignored on every selected row.
  function bulkSetIgnored(flag) {
    if (selectedIds.size === 0) return;
    setStore(prev => {
      const next = prev.data.map((row, i) => {
        if (!selectedIds.has(i)) return row;
        const out = { ...row };
        if (flag) out.__ignored = true;
        else delete out.__ignored;
        return out;
      });
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
    setSelectedIds(new Set());
  }

  // Save a single cell back to localStorage / the in-memory data array.
  // Empty values delete the key entirely so empty cells render the muted
  // "—" placeholder. Mirrors the DealsView updateCell pattern.
  function updateCell(rowId, key, value) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setStore(prev => {
      const next = [...prev.data];
      const current = { ...(next[idx] || {}) };
      if (value === '' || value == null) delete current[key];
      else current[key] = value;
      next[idx] = current;
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
  }

  // Drop a single row from the roster. Triggered by the trailing × cell
  // on each row; a confirm() prompt keeps a stray click from nuking a
  // project. Row ids are the raw array index so we splice the original
  // data array, not the filtered view.
  function deleteRow(rowId) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setStore(prev => {
      const next = [...prev.data];
      if (idx < 0 || idx >= next.length) return prev;
      next.splice(idx, 1);
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
  }

  const rows = useMemo(
    () => data.map((r, i) => ({
      ...r,
      id: i,
      __onUpdate: updateCell,
      __onDelete: deleteRow,
      __onToggleIgnore: toggleIgnored,
      __isSelected: selectedIds.has(i),
      __onToggleSelect: toggleSelect,
    })),
    [data, selectedIds]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const term = search.toLowerCase();
    return rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(term)));
  }, [rows, search]);

  // Bulk mutations operate on the full underlying data array; row ids
  // are indices into that array, so we just rebuild it once. After
  // every mutation we wipe the selection so a stale index (rows have
  // shifted up or values have already been written) can't re-trigger
  // an edit on the wrong row.
  function bulkSet(key, rawValue) {
    if (!key) return;
    if (selectedIds.size === 0) return;
    setStore(prev => {
      const next = prev.data.map((row, i) => {
        if (!selectedIds.has(i)) return row;
        const out = { ...row };
        if (rawValue === '' || rawValue == null) delete out[key];
        else out[key] = rawValue;
        return out;
      });
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
    setSelectedIds(new Set());
  }

  function bulkDelete() {
    if (selectedIds.size === 0) return;
    const n = selectedIds.size;
    if (!window.confirm(`Delete ${n} selected commission row${n === 1 ? '' : 's'}?`)) return;
    setStore(prev => {
      const next = prev.data.filter((_row, i) => !selectedIds.has(i));
      try { saveCommissionsOverride(next); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: next, source: 'override' };
    });
    setSelectedIds(new Set());
  }

  function handleImport(records) {
    setStore(prev => {
      // Merge the freshly-pasted records into whatever's already on
      // file, then dedup by Project Name so re-pasting a refreshed
      // commission roster doesn't pile duplicate rows on top of the
      // existing data. When two rows share a project name, the one
      // with more filled cells (months / columns) wins — the user's
      // expectation is that the more complete snapshot survives.
      const merged = mergeAndDedupCommissions(prev.data || [], records);
      try { saveCommissionsOverride(merged); } catch (err) { console.warn('Save commissions failed', err); }
      return { data: merged, source: 'override' };
    });
    setShowPaste(false);
  }

  function handleClear() {
    if (!window.confirm('Clear all imported commissions data?')) return;
    clearCommissionsOverride();
    setStore({ data: [], source: 'empty' });
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Predictive-text source for every Account Name cell. Rendered
          once at the view level so each EditableCell input just points
          at it via list="..." — matches the Deals tab pattern. */}
      <datalist id={ACCOUNT_NAME_LIST_ID}>
        {accountNameSuggestions.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1E293B' }}>Commissions</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.15rem' }}>
            {rows.length === 0
              ? 'Paste your monthly commission roster from Excel — the next step maps each pasted column to a destination.'
              : `${rows.length} commission row${rows.length === 1 ? '' : 's'} on file.`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            title="Paste tab-separated rows copied from Excel. The next step lets you confirm which pasted column maps to each commission field."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid #16A34A', background: '#16A34A', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >Paste from Excel</button>
          {source === 'override' && (
            <button
              type="button"
              onClick={handleClear}
              title="Remove the imported commissions list"
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
          )}
        </div>
      </div>

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter commissions…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      {selectedIds.size > 0 && (
        <BulkEditBar
          selectedCount={selectedIds.size}
          onApply={bulkSet}
          onDelete={bulkDelete}
          onSetIgnored={bulkSetIgnored}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569', textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No commissions yet</div>
            <div style={{ fontSize: '0.78rem' }}>
              Click <strong>Paste from Excel</strong> to drop in copied commission rows. The popup will map each pasted column (Name, Account Name, BFO Name, Project Name, monthly revenue, monthly commission…) onto its destination.
            </div>
          </div>
        ) : (
          <DataTable
            key={tableId}
            tableId={tableId}
            columns={columns}
            rows={filtered}
            emptyMessage={search ? `No rows match "${search}"` : 'No commissions to display'}
            enableColumnFilters
            rowStyle={(row) => row.__ignored ? { opacity: 0.45, background: '#F8FAFC', color: '#64748B' } : undefined}
            onFilteredRowsChange={onTableFilteredRowsChange}
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>

      {showPaste && (
        <CommissionsPasteImportModal
          onClose={() => { setShowPaste(false); setInitialPaste(''); }}
          onImport={(records) => { handleImport(records); setInitialPaste(''); }}
          initialPaste={initialPaste}
        />
      )}
    </div>
  );
}
````

### src/components/DealsView/DealsView.jsx

````jsx
import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { DataTable } from '../common/DataTable';
import {
  buildListRegistry,
  buildAvailableLists,
  resolveColumnLink,
  SelectCell,
  MultiSelectCell,
  LinkColumnsModal,
} from '../common/columnLinks';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { loadDealsList, saveDealsOverride, clearDealsOverride } from '../../utils/dealsStore';
import { loadCommissions } from '../../utils/commissionsStore';
import { loadOpps2Newest } from '../../utils/opps2Store';
import {
  loadSoldWarningIgnore, setSoldWarningIgnore, clearSoldWarningIgnore,
  SOLD_WARNING_IGNORE_EVENT,
} from '../../utils/soldWarningIgnore';
import { DEAL_BFO_KEY, normBfo, indexCommissionsByBfo } from '../../utils/dealCommissions';
import {
  asNumber, asDate, fmtCurrency, fmtPercent, fmtDate,
  DEAL_CURRENCY_KEYS, DEAL_DATE_KEYS, DEAL_PERCENT_KEYS, DEAL_CHECK_KEYS,
} from '../../utils/dealsFormat';
import { matchesCdm } from '../../utils/cdmMatch';
import { STATUSES } from '../../data/enums';
import {
  loadDealClientMap, setDealClientMapping,
  loadDealClientIgnore, setDealClientIgnore,
  bulkSetDealClientIgnore, bulkSetDealClientMapping,
  DEALS_CLIENT_MAP_EVENT,
} from '../../utils/dealClientMap';
import { PasteImportModal } from './PasteImportModal';

const MAPPED_COL_KEY = '__mappedToClient__';
const MAPPED_COL_LABEL = 'Mapped to Client';
const STATUS_COL_KEY = '__clientStatus__';
const STATUS_COL_LABEL = 'Client Status';
const PROGRESS_COL_KEY = '__progress__';
const PROGRESS_COL_LABEL = 'Progress';
// Per-deal flag (truthy → ignored). Lives on the deal row alongside
// other cell values so it persists through the same dealsStore path
// as everything else. Double-underscore prefix keeps it out of the
// generated column list (buildColumns filters those out).
const PROGRESS_IGNORED_KEY = '__progressIgnored';

// The "ready to invoice" handoff fields the user wants to see
// at a glance on every deal. `label` is what shows up in the popover;
// `key` is the canonical field name on the deal row.
const PROGRESS_FIELDS = [
  { key: 'BFO - Close after contract execution email has been sent', label: 'BFO opp name' },
  { key: 'Commission Sheet Sent to Kathy', label: 'Commission Sheet Sent to Kathy' },
  { key: 'Paperwork completed', label: 'Paperwork' },
  { key: 'Billing information collected', label: 'Billing Letter' },
  { key: 'Closed Won', label: 'Closed Won', href: 'https://servicedesk.ems.schneider-electric.com/servicedesk/customer/portal/35/create/3562' },
  { key: 'Setup', label: 'Setup' },
  { key: 'Recurring Revenue', label: 'Recurring' },
  { key: 'Commission', label: 'Commission' },
  { key: '__siaUploadedToBFO', label: 'SIA line items uploaded to BFO?', yesno: true },
];

function normClient(s) { return String(s || '').toLowerCase().trim(); }

// A handoff field counts as "done" when the user has put a real
// value in it — a date, a note, a "Yes", whatever. We treat empty
// strings and bare dash placeholders ("-", "—", "–") as not filled
// so a workbook that uses a dash for "blank" doesn't bump the X/N
// progress count.
const DASH_PLACEHOLDERS = new Set(['-', '–', '—']);
function isFilled(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (s === '') return false;
  if (DASH_PLACEHOLDERS.has(s)) return false;
  return true;
}

// Completion test for a single handoff field. Yes/No fields only count
// as done when the answer is an explicit "Yes" — a "No" is a real
// answer but still an outstanding handoff step. Every other field
// counts as done once it carries any real value.
function isFieldDone(row, field) {
  if (field?.yesno) return String(row[field.key] ?? '').trim().toLowerCase() === 'yes';
  return isFilled(row[field.key]);
}

// Days/Paid on stores a per-row "hide" flag under a double-underscore
// key so the column is filtered out of the visible header set but the
// value still round-trips through the regular dealsStore.
const DAYS_PAID_ON_HIDDEN_KEY = '__daysPaidOnHidden';

// The Deal column that holds the BFO opportunity name. Labeled
// "BFO opp name" everywhere user-facing; the underlying key is the
// long string the user originally pasted from their tracker. The BFO
// matching helpers (DEAL_BFO_KEY / normBfo / indexCommissionsByBfo) live
// in utils/dealCommissions so the YOY Commissions chart can reuse them.

// Whole-day delta between a Due Date cell and today. Returns null when
// the cell can't be parsed as a date. Both sides are flattened to local
// midnight so the value doesn't drift around DST transitions.
function daysUntilDue(dueRaw) {
  const d = asDate(dueRaw);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

// The effective Days/Paid on value for a row — null when the cell is
// hidden, the deal is fully paid, or the Due Date is missing/unparseable.
// Shared by the cell renderer, the column sort, and the Revenue Recorded /
// Paid to Date "grey until overdue" coloring so all three stay in sync.
function effectiveDaysPaidOn(row) {
  if (isFilled(row[DAYS_PAID_ON_HIDDEN_KEY])) return null;
  const commStatus = String(row['Comm Status'] ?? '').trim().toLowerCase();
  if (commStatus === 'fully paid') return null;
  return daysUntilDue(row['Due Date']);
}

// Custom renderer for the "Days/Paid on" column. Shows the computed
// days-until-due delta from the row's Due Date, with a small × button
// that suppresses the value for this row (stored on __daysPaidOnHidden)
// and a ↻ to restore it.
function DaysPaidOnCell({ row }) {
  const hidden = isFilled(row[DAYS_PAID_ON_HIDDEN_KEY]);
  const onUpdate = row.__onUpdate;

  // Once a deal is marked Fully Paid, the days-until-due delta is no
  // longer meaningful — collapse the cell to blank so it doesn't keep
  // counting down (or showing "overdue") against a closed-out deal.
  const commStatus = String(row['Comm Status'] ?? '').trim().toLowerCase();
  if (commStatus === 'fully paid') {
    return <span />;
  }

  if (hidden) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }}>
        <span style={{ color: 'var(--color-text-muted)', flex: 1 }}>—</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onUpdate?.(row.id, DAYS_PAID_ON_HIDDEN_KEY, ''); }}
          title="Restore the computed days-until-due value"
          style={{ background: 'transparent', border: '1px solid var(--color-border)', color: '#475569', cursor: 'pointer', fontSize: '0.7rem', padding: '0 6px', borderRadius: 4, fontFamily: 'inherit', lineHeight: 1.4 }}
        >↻</button>
      </span>
    );
  }

  const delta = daysUntilDue(row['Due Date']);
  if (delta == null) {
    return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  }

  const color = delta < 0 ? '#B91C1C' : delta <= 7 ? '#92400E' : '#0F172A';
  const label = delta === 0 ? 'Due today'
    : delta > 0 ? `${delta}d`
    : `${Math.abs(delta)}d overdue`;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }}>
      <span style={{ flex: 1, color, fontVariantNumeric: 'tabular-nums' }}>{label}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onUpdate?.(row.id, DAYS_PAID_ON_HIDDEN_KEY, '1'); }}
        title="Hide the days-until-due value for this deal"
        style={{ background: 'transparent', border: '1px solid var(--color-border)', color: '#94A3B8', cursor: 'pointer', fontSize: '0.7rem', padding: '0 6px', borderRadius: 4, fontFamily: 'inherit', lineHeight: 1 }}
      >×</button>
    </span>
  );
}

// Editable cell wrapper. Renders the column's normal display until the
// user double-clicks, then swaps to an input typed to match the
// column kind: date picker for date fields, number for currency /
// percent / numeric, plain text otherwise (including Yes/No fields,
// which often need free-text values like "N/A" or "Pending" beyond
// the boolean default). Saves on Enter / blur, cancels on Escape.
// New rows auto-focus the first editable cell so the user can start
// typing immediately.
function EditableCell({ value, kind, render, onSave, autoFocus, listId, hoverTitle }) {
  // Dates edit as plain text in the same M/D/YYYY shape the cell shows,
  // so users can type the short form directly and copy/paste it like
  // any other text. asDate(...) handles parsing on save.
  const toDraft = (v) => {
    if (kind === 'date') return v == null || v === '' ? '' : fmtDate(v);
    return v == null ? '' : String(v);
  };
  const [editing, setEditing] = useState(!!autoFocus);
  const [draft, setDraft] = useState(toDraft(value));
  useEffect(() => {
    if (!editing) setDraft(kind === 'date'
      ? (value == null || value === '' ? '' : fmtDate(value))
      : (value == null ? '' : String(value)));
  }, [value, editing, kind]);

  function commit(next) {
    const v = next == null ? '' : String(next);
    onSave(v);
    setEditing(false);
  }
  function cancel() {
    setDraft(toDraft(value));
    setEditing(false);
  }

  if (!editing) {
    // hoverTitle lets a column override the default "Double-click to
    // edit" hint with the cell's actual content — handy for narrow
    // columns (e.g. Agreement Name) where the text often gets clipped.
    return (
      <span
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title={hoverTitle || 'Double-click to edit'}
        style={{ display: 'inline-block', width: '100%', cursor: 'text' }}
      >
        {render(value)}
      </span>
    );
  }

  const inputType = (kind === 'currency' || kind === 'percent' || kind === 'number') ? 'number'
    : 'text';
  return (
    <input
      autoFocus
      type={inputType}
      value={draft}
      step={inputType === 'number' ? 'any' : undefined}
      list={listId}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
      style={{
        width: '100%', padding: '0.15rem 0.3rem',
        border: '1px solid #3B82F6', borderRadius: 4,
        fontSize: '0.7rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B',
        boxSizing: 'border-box',
      }}
    />
  );
}

// Inline free-text editor used in the Progress popover for fields
// that aren't bound to a Dropdowns list. Holds a local draft so
// typing is instant; the parent learns about the change only when
// the user blurs or hits Enter (Escape reverts).
function ProgressTextEditor({ value, onCommit }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);

  function commit() {
    const trimmed = draft.trim();
    const prev = String(value ?? '').trim();
    if (trimmed === prev) return;
    onCommit(trimmed);
  }

  return (
    <input
      type="text"
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(value == null ? '' : String(value));
          e.currentTarget.blur();
        }
      }}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '3px 6px',
        border: '1px solid var(--color-border)', borderRadius: 4,
        fontSize: '0.72rem', fontFamily: 'inherit',
        color: 'var(--color-text)', background: '#fff',
      }}
    />
  );
}

// One row inside the Progress popover. Picks the right editor based
// on whether the user has linked this column to a Dropdowns list
// (Single / Multi select) or left it as free text.
function ProgressPopoverRow({ row, field, columnLinks, listRegistry, onSave }) {
  const raw = row[field.key];
  const filled = isFieldDone(row, field);
  const link = resolveColumnLink(field.key, columnLinks);
  const onChange = (v) => onSave?.(row.id, field.key, v);

  let editor;
  if (field.yesno) {
    editor = <SelectCell value={raw} onChange={onChange} options={['Yes', 'No']} />;
  } else if (link) {
    const opts = listRegistry?.get(link.listKey)?.options || [];
    editor = link.mode === 'multi'
      ? <MultiSelectCell value={raw} onChange={onChange} options={opts} />
      : <SelectCell value={raw} onChange={onChange} options={opts} />;
  } else {
    editor = <ProgressTextEditor value={raw} onCommit={onChange} />;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem' }}>
      <span
        title={filled ? 'Has a value' : 'Empty'}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 4, border: '1px solid', borderColor: filled ? '#16A34A' : '#CBD5E1', background: filled ? '#16A34A' : '#fff', color: '#fff', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}
      >
        {filled ? '✓' : ''}
      </span>
      {field.href ? (
        <a
          href={field.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ flex: 1, fontSize: '0.72rem', color: '#2563EB', textDecoration: 'underline', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={`${field.label} — open the Service Desk ticket form in a new tab`}
        >{field.label}</a>
      ) : (
        <span style={{ flex: 1, fontSize: '0.72rem', color: filled ? '#1E293B' : '#475569', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={field.label}>{field.label}</span>
      )}
      <div style={{ flex: '0 0 130px', minWidth: 0 }}>
        {editor}
      </div>
    </div>
  );
}

// Browser-native <datalist> ID for the Client Name autocomplete on
// the Deals tab. The datalist itself is rendered once at DealsView
// scope and shared by every Client Name cell that's in edit mode.
const CLIENT_NAME_LIST_ID = 'deals-client-name-suggestions';

// Cell renderer for the leading "Progress" column. Shows a compact
// X/4 pill colored by completion; click opens a popover with a small
// editor per handoff field — a Dropdowns-list picker when the column
// is linked, free-text otherwise. Saves go through the same updateCell
// path as the regular table cells.
function ProgressCell({ row, columnLinks, listRegistry, onSave, onDelete }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const btnRef = useRef(null);

  const ignored = isFilled(row[PROGRESS_IGNORED_KEY]);
  const done = PROGRESS_FIELDS.filter(f => isFieldDone(row, f)).length;
  const total = PROGRESS_FIELDS.length;
  const pct = total === 0 ? 0 : done / total;
  // Greyed-out pill when the user has opted this deal out of the
  // handoff tally. Otherwise the regular red/yellow/green progress
  // colors based on completion ratio.
  const bg = ignored ? '#F1F5F9' : pct === 1 ? '#DCFCE7' : pct === 0 ? '#FEE2E2' : '#FEF3C7';
  const fg = ignored ? '#94A3B8' : pct === 1 ? '#166534' : pct === 0 ? '#991B1B' : '#92400E';

  function openPopover(e) {
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) { setOpen(true); return; }
    // Keep the popover on-screen: prefer opening below the pill, but
    // flip above when the row is near the bottom of the viewport and
    // there's more room overhead. Either way cap maxHeight so the body
    // scrolls inside the panel instead of bleeding off the page.
    const margin = 8;
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    const spaceBelow = viewportH - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const estimatedH = 420;
    const placeAbove = spaceBelow < estimatedH && spaceAbove > spaceBelow;
    const available = Math.max(180, placeAbove ? spaceAbove : spaceBelow);
    const top = placeAbove
      ? Math.max(margin, rect.top - margin - Math.min(estimatedH, spaceAbove))
      : rect.bottom + 4;
    setAnchor({
      left: rect.left,
      top,
      width: Math.max(rect.width, 320),
      maxHeight: available,
    });
    setOpen(true);
  }

  function toggleIgnore() {
    onSave?.(row.id, PROGRESS_IGNORED_KEY, ignored ? '' : '1');
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPopover}
        title={ignored
          ? 'Ignored — this deal is opted out of the handoff tally. Click to edit.'
          : `${done} of ${total} handoff fields complete — click to edit`}
        style={{ padding: '2px 10px', border: '1px solid', borderColor: fg, borderRadius: 999, background: bg, color: fg, fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', minWidth: 56, textDecoration: ignored ? 'line-through' : 'none', opacity: ignored ? 0.85 : 1 }}
      >
        {done}/{total}{pct === 1 && !ignored ? ' ✓' : ''}
      </button>
      {open && createPortal(
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 4999, background: 'transparent' }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: anchor?.left ?? 0, top: anchor?.top ?? 0, width: anchor?.width ?? 320, maxWidth: 'calc(100vw - 16px)', maxHeight: anchor?.maxHeight ?? undefined, zIndex: 5000, background: '#fff', border: '1px solid #CBD5E1', borderRadius: 8, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.18)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FAFC', flex: '0 0 auto' }}>
              <strong style={{ fontSize: '0.75rem', color: '#1E293B' }}>
                Handoff progress · {ignored ? 'Ignored' : `${done}/${total}`}
              </strong>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 4px' }}
                aria-label="Close"
              >×</button>
            </div>
            <div style={{ padding: '0.25rem 0', flex: '1 1 auto', overflowY: 'auto', minHeight: 0 }}>
              {PROGRESS_FIELDS.map(f => (
                <ProgressPopoverRow
                  key={f.key}
                  row={row}
                  field={f}
                  columnLinks={columnLinks}
                  listRegistry={listRegistry}
                  onSave={onSave}
                />
              ))}
            </div>
            {onSave && (
              <div style={{ padding: '0.4rem 0.75rem', borderTop: '1px solid #E2E8F0', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flex: '0 0 auto' }}>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.7rem', color: '#475569' }}
                  title="Don't count this deal in the X/N tally — its pill shows greyed-out."
                >
                  <input
                    type="checkbox"
                    checked={ignored}
                    onChange={toggleIgnore}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />
                  <span>Ignore this deal{ignored ? '' : ` — grey out the X/${PROGRESS_FIELDS.length}`}</span>
                </label>
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      const label = String(row['Client Name'] || '').trim() || 'this deal';
                      if (window.confirm(`Delete ${label}? This can't be undone.`)) {
                        onDelete(row.id);
                        setOpen(false);
                      }
                    }}
                    title="Remove this deal row from the tracker"
                    style={{
                      padding: '0.25rem 0.55rem',
                      background: 'transparent',
                      border: '1px solid #FCA5A5', borderRadius: 4,
                      color: '#B91C1C', fontSize: '0.7rem', fontWeight: 600,
                      fontFamily: 'inherit', cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >Delete deal</button>
                )}
              </div>
            )}
            {!onSave && (
              <div style={{ padding: '0.4rem 0.75rem', borderTop: '1px solid #E2E8F0', fontSize: '0.65rem', color: '#94A3B8', fontStyle: 'italic', flex: '0 0 auto' }}>
                Read-only — editing requires the inline-edit deploy.
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// Color scheme for the per-deal Client Status pill. Matches the style
// used in ClientsView so the same status reads the same across views.
function statusPillStyle(status) {
  const s = normClient(status);
  if (s === 'client') return { background: '#DCFCE7', color: '#166534' };
  if (s === 'old client') return { background: '#F1F5F9', color: '#64748B' };
  if (s === 'prospect') return { background: '#DBEAFE', color: '#1E40AF' };
  if (s === 'lost - not sold' || s === 'lost') return { background: '#FEE2E2', color: '#991B1B' };
  if (s === 'hold off') return { background: '#FEF3C7', color: '#92400E' };
  return { background: '#F1F5F9', color: '#475569' };
}

// The ⚠ shown on a Client Name that matches no company in the Table
// View roster. Clicking it opens a small popover with a one-click
// "Add to Table View" button (plus a Status picker that defaults to
// Client, since a deal implies an active relationship, and stamps the
// current CDM so the new company lands as the user's account). Adding
// goes through the shared, idempotent addProspect — a double-click
// can't mint a duplicate — and once the company lands in Table View
// the roster updates and this warning clears on its own. An "Ignore"
// link drops the name into the same per-name ignore set the Mapped to
// Client column uses, for names that shouldn't ever be added.
function ClientNameWarning({ name, cdmName, onAdd, onIgnore }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [status, setStatus] = useState('Client');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const btnRef = useRef(null);

  function openPopover(e) {
    e.stopPropagation();
    setError(null);
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const margin = 8;
      const width = 260;
      const estimatedH = 190;
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      const spaceBelow = viewportH - rect.bottom - margin;
      const placeAbove = spaceBelow < estimatedH && rect.top > spaceBelow;
      setAnchor({
        left: Math.max(margin, rect.right - width),
        top: placeAbove
          ? Math.max(margin, rect.top - margin - estimatedH)
          : rect.bottom + 4,
        width,
      });
    }
    setOpen(true);
  }

  async function handleAdd() {
    if (busy || !onAdd) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd({ company: name, status: status || 'Client', cdm: cdmName || '' });
      setOpen(false);
    } catch (err) {
      setError(err?.message || 'Could not add the company. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPopover}
        onDoubleClick={(e) => e.stopPropagation()}
        title={`"${name}" isn't a company in Table View — click to add it`}
        style={{ flex: '0 0 auto', background: 'transparent', border: 'none', color: '#B45309', fontSize: '0.85rem', lineHeight: 1, cursor: 'pointer', padding: 0 }}
      >⚠</button>
      {open && createPortal(
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 4999, background: 'transparent' }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: anchor?.left ?? 0, top: anchor?.top ?? 0, width: anchor?.width ?? 260, maxWidth: 'calc(100vw - 16px)', zIndex: 5000, background: '#fff', border: '1px solid #FCD34D', borderRadius: 8, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.18)', padding: '0.6rem 0.7rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          >
            <div style={{ fontSize: '0.72rem', color: '#92400E', lineHeight: 1.35 }}>
              <strong>{name}</strong> isn&apos;t a company in Table View.
            </div>
            {onAdd ? (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: '#475569' }}>
                  <span style={{ flex: '0 0 auto' }}>Status</span>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    style={{ flex: 1, minWidth: 0, padding: '0.2rem 0.3rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.7rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B' }}
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={busy}
                  style={{ padding: '0.35rem 0.6rem', border: '1px solid #16A34A', background: busy ? '#86EFAC' : '#16A34A', color: '#fff', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer' }}
                >{busy ? 'Adding…' : '+ Add to Table View'}</button>
              </>
            ) : (
              <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontStyle: 'italic' }}>
                Adding companies isn&apos;t available here.
              </div>
            )}
            {error && <div style={{ fontSize: '0.68rem', color: '#B91C1C' }}>{error}</div>}
            {onIgnore && (
              <button
                type="button"
                onClick={() => { onIgnore(name, true); setOpen(false); }}
                title="Stop warning about this name — it won't count against the unmapped tally either"
                style={{ padding: 0, background: 'none', border: 'none', color: '#64748B', textDecoration: 'underline', fontSize: '0.68rem', fontFamily: 'inherit', cursor: 'pointer', alignSelf: 'flex-start' }}
              >Ignore this name</button>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

// Render the helper column as a lazy editor. We were previously
// mounting a full <select> with every client option (often 100+) for
// every unmapped row — 250 rows × 130 options = 30k+ DOM nodes just
// for the dropdowns, which can balloon paint cost on large lists and
// leaves the table looking blank while the browser catches up. The
// button form keeps the cell DOM tiny; the <select> only mounts when
// the user clicks the cell to assign a client.
function MappedClientCell({ raw, manual, ignored, clientOptions, onChange, onToggleIgnore }) {
  const [editing, setEditing] = useState(false);
  if (ignored) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
        <span style={{ flex: 1, padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: '#F1F5F9', color: '#64748B', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="This source name is marked as ignored and won't count against the unmapped tally">
          ✕ Ignored
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleIgnore(raw, false); }}
          title="Restore this row to the unmapped list"
          style={{ padding: '0 6px', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.62rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >↺</button>
      </span>
    );
  }
  if (!editing) {
    const label = manual || 'Map to client…';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title={manual ? `Currently mapped to ${manual}. Click to change.` : 'Click to pick the matching client'}
          style={{
            flex: 1, minWidth: 0, padding: '0.2rem 0.4rem',
            border: '1px solid', borderColor: manual ? '#86EFAC' : '#FCD34D',
            borderRadius: 4, fontSize: '0.7rem', fontFamily: 'inherit',
            background: manual ? '#F0FDF4' : '#FFFBEB',
            color: manual ? '#166534' : '#92400E',
            textAlign: 'left', cursor: 'pointer',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >{label}</button>
        {!manual && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleIgnore(raw, true); }}
            title="Ignore this row — it won't count against the unmapped tally"
            style={{ padding: '0 6px', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >✕</button>
        )}
      </span>
    );
  }
  return (
    <select
      autoFocus
      value={manual || ''}
      onChange={(e) => { onChange(raw, e.target.value); setEditing(false); }}
      onBlur={() => setEditing(false)}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%', padding: '0.2rem 0.3rem',
        border: '1px solid #3B82F6', borderRadius: 4,
        fontSize: '0.7rem', fontFamily: 'inherit', background: '#fff',
        color: '#1E293B',
      }}
    >
      <option value="">— Unmap —</option>
      {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

// Canonical ordered column list — these are the headers the Deals
// sub-tab is expected to surface from the user's client-tracker
// workbook. The first column ("Client Name") is sticky.
// Headers in incoming workbooks that should fold into a canonical column
// name. Lets older "Paperwork completed" exports and newer "Paperwork"
// exports both land in the same field, and surfaces the shorter labels
// the user uses on the Clients tab's contract drill-down.
const HEADER_ALIASES = {
  'paperwork': 'Paperwork completed',
  'billing letter': 'Billing information collected',
  'combined bfo': 'Combined',
};

const COLUMN_ORDER = [
  'Client Name',
  'Commission Sheet Sent to Kathy',
  'Paperwork completed',
  'Billing information collected',
  'Closed Won',
  'On Client Tracker?',
  'BFO - Close after contract execution email has been sent',
  'Agreement Name',
  'Current Term Start Date',
  'Original Contract Start',
  'Setup',
  'Recurring Revenue',
  'Commission',
  'Revenue Recorded',
  'Paid to Date',
  'Delta',
  'Currently being paid',
  'Ticket',
  'Comm Status',
  'Due Date',
  'Days/Paid on',
  'GM',
  'Payment Terms',
  'End Date',
  'Auto renewal?',
  'Esc',
  'Current Value',
  'SUCON?',
  'Comm Tracker?',
  'Comm Tracker?2',
  'Comm Tracker?3',
  'Comm Tracker?4',
  'Comm Tracker?5',
  'Comm Tracker?6',
  'Combined',
  'Combine Project Name',
  'Commission Rate',
  'Year',
  'Month',
  'Follow Up On Sale',
];

// The Year column is derived, not stored — it always shows the calendar
// year of the deal's Original Contract Start date so the two can't drift
// apart. Returns '' when that date is missing or unparseable.
function dealYear(row) {
  const d = asDate(row?.['Original Contract Start']);
  return d ? String(d.getFullYear()) : '';
}

function buildColumns(rows, columnLinks, listRegistry, commissionsByBfo) {
  if (!rows.length) return [];
  const keys = new Set();
  // Skip 'id' and any double-underscore internal field (__onUpdate,
  // __newRow, etc.) — those are render-time scaffolding, not data.
  for (const r of rows) for (const k of Object.keys(r)) {
    if (k === 'id' || k.startsWith('__')) continue;
    keys.add(k);
  }
  // Year is always present since it's computed from Original Contract
  // Start — surface the column even when no workbook cell populated it.
  keys.add('Year');
  // Empty new-row case: nothing in the data has populated keys yet
  // (the user just clicked New Deal on a clean slate). Seed with the
  // canonical lineup so they have somewhere to type instead of staring
  // at a zero-column table.
  if (keys.size === 0) for (const k of COLUMN_ORDER) keys.add(k);

  // Lay out canonical columns first, then any extras the workbook
  // brought along, so unexpected headers still render at the end.
  const ordered = [];
  for (const k of COLUMN_ORDER) if (keys.has(k)) ordered.push(k);
  for (const k of keys) if (!ordered.includes(k)) ordered.push(k);

  return ordered.map((k, i) => {
    const sticky = i === 0;
    const isCurrency = DEAL_CURRENCY_KEYS.has(k);
    const isPercent = DEAL_PERCENT_KEYS.has(k);
    const isDate = DEAL_DATE_KEYS.has(k);
    const isCheck = DEAL_CHECK_KEYS.has(k);
    const isRevenueRecorded = k === 'Revenue Recorded';
    const isPaidToDate = k === 'Paid to Date';
    const isDaysPaidOn = k === 'Days/Paid on';
    const isCurrentlyBeingPaid = k === 'Currently being paid';
    const isYear = k === 'Year';
    const kind = isCheck ? 'check'
      : isCurrency ? 'currency'
      : isPercent ? 'percent'
      : isDate ? 'date'
      : 'text';
    // Display zero when a supporting currency cell is empty so the
    // compound "$X/($Y + $Z)" formulas on Revenue Recorded / Paid to
    // Date stay readable instead of collapsing to bare slashes.
    function currencyOrZero(v) {
      const n = asNumber(v);
      return fmtCurrency(n == null ? 0 : n);
    }
    function renderValue(v) {
      if (v == null || v === '') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
      if (isCurrency) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtCurrency(v)}</span>;
      if (isPercent) return <span style={{ display: 'block', textAlign: 'left', fontVariantNumeric: 'tabular-nums', color: '#0F172A' }}>{fmtPercent(v)}</span>;
      if (isDate) return <span style={{ color: '#334155' }}>{fmtDate(v)}</span>;
      return <span>{String(v)}</span>;
    }
    // Revenue Recorded reads as "$recorded/$(setup + recurring)" with
    // the two contract amounts summed into a single denominator.
    // Paid to Date reads as "$paid/$commission". The cell is colored
    // by how the numerator compares to the denominator:
    //   • match              → green
    //   • numerator > denom  → gold (more recorded / paid than expected)
    //   • numerator < denom  → red  (less recorded / paid than expected)
    //   • 0 / 0              → grey
    //   • explicitly ignored → grey (toggled by the ⊘ / ↻ button)
    // The ignored state is persisted per-row on a __ flag key so the
    // override doesn't leak into the visible column list.
    // Look the deal's BFO opp name up against the Commissions roster
    // and pull the matching summed total when one exists. Revenue
    // Recorded reads from the project's annual revenue total; Paid to
    // Date from its commission total. null when nothing matches — the
    // caller falls back to whatever's stored on the deal row in that
    // case so legacy pasted values keep working.
    function lookupCommissionNumerator(row) {
      const bfo = normBfo(row?.[DEAL_BFO_KEY]);
      if (!bfo) return null;
      const hit = commissionsByBfo?.get(bfo);
      if (!hit) return null;
      return isRevenueRecorded ? hit.revenue : hit.commission;
    }

    function renderCompound(row, v) {
      const ignoreKey = isRevenueRecorded ? '__revenueRecordedIgnored' : '__paidToDateIgnored';
      const ignored = isFilled(row[ignoreKey]);
      // Prefer the live Commissions roll-up over whatever was pasted /
      // typed into this cell so the deal tracks the source-of-truth
      // Commissions tab without the user having to copy numbers across.
      const commNumerator = lookupCommissionNumerator(row);
      const numerator = commNumerator != null ? commNumerator : (asNumber(v) ?? 0);
      const denominator = isRevenueRecorded
        ? (asNumber(row['Setup']) ?? 0) + (asNumber(row['Recurring Revenue']) ?? 0)
        : (asNumber(row['Commission']) ?? 0);
      // Hold the cell in its neutral grey state until the deal's Days/Paid
      // on goes negative (overdue). Before that point the recorded /
      // paid amounts are still expected to be short of the contract, so
      // the green/gold/red comparison would be noise.
      const delta = effectiveDaysPaidOn(row);
      const overdue = delta != null && delta < 0;

      let bg = '#F1F5F9';
      let fg = '#475569';
      let stateTitle = 'No amounts yet';
      if (ignored) {
        bg = '#F1F5F9'; fg = '#475569';
        stateTitle = 'Ignored — click ↻ to re-enable status color';
      } else if (numerator === 0 && denominator === 0) {
        bg = '#F1F5F9'; fg = '#475569';
        stateTitle = 'Nothing recorded yet';
      } else if (!overdue) {
        bg = '#F1F5F9'; fg = '#475569';
        stateTitle = 'Status color appears once Days/Paid on goes overdue';
      } else if (numerator === denominator) {
        bg = '#DCFCE7'; fg = '#166534';
        stateTitle = 'Matches expected';
      } else if (numerator > denominator) {
        bg = '#FEF3C7'; fg = '#92400E';
        stateTitle = `Over by ${fmtCurrency(numerator - denominator)}`;
      } else {
        bg = '#FEE2E2'; fg = '#991B1B';
        stateTitle = `Short by ${fmtCurrency(denominator - numerator)}`;
      }

      const primary = commNumerator != null ? fmtCurrency(commNumerator) : currencyOrZero(v);
      const denomText = fmtCurrency(denominator);
      const fullTitle = commNumerator != null
        ? `Auto-populated from Commissions for "${String(row?.[DEAL_BFO_KEY] || '').trim()}" — ${stateTitle}`
        : stateTitle;
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }} title={fullTitle}>
          <span style={{ flex: 1, padding: '1px 8px', borderRadius: 4, background: bg, color: fg, fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'left', textDecoration: ignored ? 'line-through' : 'none' }}>
            {primary}/{denomText}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); row.__onUpdate?.(row.id, ignoreKey, ignored ? '' : '1'); }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={ignored ? 'Re-enable status color for this cell' : 'Ignore this cell — show as grey'}
            style={{ background: 'transparent', border: '1px solid var(--color-border)', color: '#94A3B8', cursor: 'pointer', fontSize: '0.7rem', padding: '0 6px', borderRadius: 4, fontFamily: 'inherit', lineHeight: 1 }}
          >{ignored ? '↻' : '⊘'}</button>
        </span>
      );
    }
    // Closed Won gets a clickable column header that opens the
    // Schneider Electric ServiceDesk "Close after contract execution"
    // ticket form in a new tab — the operational handoff the user
    // wants to do the moment a deal flips to Closed Won.
    const closedWonHeaderUrl = k === 'Closed Won'
      ? 'https://servicedesk.ems.schneider-electric.com/servicedesk/customer/portal/35/create/3562'
      : null;
    return {
      key: k,
      label: k,
      kind,
      renderValue,
      defaultWidth: sticky ? 220 : isCheck ? 110 : isRevenueRecorded ? 210 : isPaidToDate ? 210 : isCurrency || isPercent ? 130 : isDate ? 130 : 150,
      // Date columns sort chronologically off the parsed epoch ms,
      // not the formatted "M/D/YYYY" display string — without this
      // the DataTable falls back to alphabetical text compare and
      // dates land out of order.
      ...(isDate ? { getSortValue: (row) => { const d = asDate(row[k]); return d ? d.getTime() : null; } } : {}),
      // Days/Paid on shows a computed delta, not a stored cell value, so
      // hand the sorter the same number the renderer uses. Hidden /
      // fully-paid / no-due-date rows come through as null and fall to
      // the bottom of the sort either direction.
      ...(isDaysPaidOn ? { getSortValue: (row) => effectiveDaysPaidOn(row) } : {}),
      // Year renders a value derived from Original Contract Start (see the
      // isYear render branch), so the filter, sort, and export must read
      // that same derived value — not the raw stored 'Year' cell. Without
      // this a deal shows e.g. "2026" from its contract date but a Year
      // filter (which would otherwise fall back to the blank stored cell)
      // silently skips it.
      ...(isYear ? {
        getFilterValue: (row) => dealYear(row),
        getSortValue: (row) => { const y = dealYear(row); return y ? Number(y) : null; },
        exportValue: (row) => dealYear(row),
      } : {}),
      ...(sticky ? { sticky: true } : {}),
      ...(closedWonHeaderUrl ? {
        renderHeader: (label) => (
          <a
            href={closedWonHeaderUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open the Schneider Electric ServiceDesk close-after-contract form in a new tab"
            style={{ color: 'var(--color-accent, #3B82F6)', textDecoration: 'underline' }}
          >{label}</a>
        ),
      } : {}),
      render: (row) => {
        if (isDaysPaidOn) {
          return <DaysPaidOnCell row={row} />;
        }
        // Year is derived from Original Contract Start — render it
        // read-only so it always tracks that date instead of drifting to
        // a hand-typed value.
        if (isYear) {
          const year = dealYear(row);
          return year
            ? <span style={{ color: '#334155', fontVariantNumeric: 'tabular-nums' }}>{year}</span>
            : <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
        }
        // Currently being paid mirrors the Commissions tab's Payment
        // Status pill — pulled by the deal's BFO opp name so the user
        // doesn't have to keep two columns in sync by hand. Falls back
        // to the editable cell when no match exists.
        if (isCurrentlyBeingPaid) {
          const bfo = normBfo(row?.[DEAL_BFO_KEY]);
          const hit = bfo ? commissionsByBfo?.get(bfo) : null;
          const status = hit?.paymentStatus;
          if (status) {
            const palette = status.state === 'active' ? { bg: '#DCFCE7', fg: '#166534' }
              : status.state === 'stopped' ? { bg: '#FEE2E2', fg: '#991B1B' }
              : { bg: '#F1F5F9', fg: '#64748B' };
            const title = `Auto-populated from Commissions for "${String(row?.[DEAL_BFO_KEY] || '').trim()}" — ${status.title}`;
            return (
              <span title={title} style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 4, background: palette.bg, color: palette.fg, fontWeight: 600, fontSize: '0.7rem' }}>
                {status.label}
              </span>
            );
          }
        }
        // User-configured dropdown binding from the Link Columns modal
        // wins over the default text/number/date editor. The shared
        // Select/MultiSelect cells store the value as a string so the
        // existing dealsStore persistence round-trips it cleanly.
        const link = resolveColumnLink(k, columnLinks);
        if (link) {
          const opts = listRegistry?.get(link.listKey)?.options || [];
          const onChange = (v) => row.__onUpdate?.(row.id, k, v);
          if (link.mode === 'multi') {
            return <MultiSelectCell value={row[k]} onChange={onChange} options={opts} />;
          }
          return <SelectCell value={row[k]} onChange={onChange} options={opts} />;
        }
        // Revenue Recorded / Paid to Date auto-populate from the
        // Commissions tab when the deal's BFO opp name matches a
        // commission row — render the pill directly so the user
        // isn't tempted to double-click-edit a derived value that
        // wouldn't display anyway. Source-of-truth edits happen on
        // the Commissions tab.
        if ((isRevenueRecorded || isPaidToDate) && lookupCommissionNumerator(row) != null) {
          return renderCompound(row, row[k]);
        }
        const cellRender = (isRevenueRecorded || isPaidToDate)
          ? (v) => renderCompound(row, v)
          : renderValue;
        // Long contract names get clipped in narrow cells; show the
        // full value as the hover tooltip on the Agreement Name column
        // so the user can read it without expanding the column.
        const hoverTitle = k === 'Agreement Name' && isFilled(row[k])
          ? String(row[k])
          : undefined;
        return (
          <EditableCell
            value={row[k]}
            kind={kind}
            render={cellRender}
            onSave={(v) => row.__onUpdate?.(row.id, k, v)}
            autoFocus={!!row.__newRow && sticky}
            listId={k === 'Client Name' ? CLIENT_NAME_LIST_ID : undefined}
            hoverTitle={hoverTitle}
          />
        );
      },
      exportValue: (row) => {
        if (isYear) return dealYear(row);
        const v = row[k];
        if (v == null) return '';
        if (isCurrency || isPercent) {
          const n = asNumber(v);
          return n != null ? n : v;
        }
        return v;
      },
    };
  });
}

export function DealsView({ settings, updateSettings, prospects = [], cdmName, user, addProspect }) {
  const [{ data, source }, setStore] = useState(() => loadDealsList());
  // Opps 2 records, loaded once so the page can flag Sold opps that have
  // no matching deal here (see soldMissingDeals below). Picks the newest
  // of the local cache and the synced Firestore copy so the warning
  // reflects what the Opps 2 tab would show, even on a fresh device.
  const [opps2Records, setOpps2Records] = useState([]);
  // Per-opp dismissals for the "Sold opp has no matching deal" banner, so
  // the user can silence a flagged opp they've decided not to track here.
  const [soldIgnore, setSoldIgnore] = useState(() => loadSoldWarningIgnore());
  // Commissions roster feeds the Revenue Recorded / Paid to Date auto-
  // population. Re-hydrated on the storage event so a paste on the
  // Commissions tab in another window flows through here without a
  // reload.
  const [commissionsData, setCommissionsData] = useState(() => loadCommissions().data || []);
  const [search, setSearch] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const [showPaste, setShowPaste] = useState(false);
  const [clientMap, setClientMap] = useState(() => loadDealClientMap());
  const [ignoreSet, setIgnoreSet] = useState(() => loadDealClientIgnore());
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [bulkPick, setBulkPick] = useState('');
  // Bulk-edit selection (row indices) + the active column / value the
  // user wants to push out to all selected rows. The toolbar lives
  // above the table and only appears when at least one row is ticked.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkEditColumn, setBulkEditColumn] = useState('');
  const [bulkEditValue, setBulkEditValue] = useState('');
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const fileInputRef = useRef(null);

  // User-configurable column-to-Dropdowns-list bindings. Mirrors the
  // Opps 2 "Link columns" feature so a deal column can pull picks
  // straight from the Dropdowns reference lists. Stored on the user's
  // synced settings so it follows them across devices.
  const columnLinks = settings?.dealsColumnLinks || {};
  const updateColumnLinks = (next) => {
    updateSettings?.({ dealsColumnLinks: next || {} });
  };
  // Effective dropdown vocabulary for cell renderers / Link Columns
  // modal. Mirrors OppsView2 — picks up user edits made on the
  // Dropdowns tab through settings.dropdownLists.
  const dropdownLists = useMemo(
    () => getEffectiveDropdownLists(settings),
    [settings?.dropdownLists]
  );
  const listRegistry = useMemo(() => buildListRegistry(dropdownLists), [dropdownLists]);
  const availableLists = useMemo(() => buildAvailableLists(dropdownLists), [dropdownLists]);

  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'deals-list-override') setStore(loadDealsList());
      if (e.key === 'deals-client-map') setClientMap(loadDealClientMap());
      if (e.key === 'deals-client-ignore') setIgnoreSet(loadDealClientIgnore());
      if (e.key === 'commissions-list-override') setCommissionsData(loadCommissions().data || []);
    }
    function onClientMap() {
      setClientMap(loadDealClientMap());
      setIgnoreSet(loadDealClientIgnore());
    }
    function onSoldIgnore() {
      setSoldIgnore(loadSoldWarningIgnore());
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(SOLD_WARNING_IGNORE_EVENT, onSoldIgnore);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(SOLD_WARNING_IGNORE_EVENT, onSoldIgnore);
    };
  }, []);

  // Pull the Opps 2 records so we can warn about Sold opps that aren't
  // represented on the Deals page. A cancelled flag guards against a
  // late resolve writing state after unmount / a user change.
  useEffect(() => {
    let cancelled = false;
    loadOpps2Newest(user?.uid)
      .then((d) => {
        if (cancelled) return;
        setOpps2Records(Array.isArray(d?.records) ? d.records : []);
      })
      .catch(() => { if (!cancelled) setOpps2Records([]); });
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Active + Old Client roster the helper-column dropdown picks from.
  // CDM-matching Client / Old Client prospects come first, but any
  // Old Client in the pool — even ones whose CDM has drifted to
  // another rep — is included too, since a deal row often points at
  // an account that's been reassigned over time. Falls back to every
  // CDM-matching prospect when no clients are flagged yet. Status
  // comparison collapses internal whitespace so "Old  Client",
  // "old\tclient", etc. still match.
  const clientOptions = useMemo(() => {
    const normStatus = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const cdmList = prospects.filter(p => matchesCdm(p.cdm, cdmName));
    const myClients = cdmList.filter(p => {
      const s = normStatus(p.status);
      return s === 'client' || s === 'old client';
    });
    const allOldClients = prospects.filter(p => normStatus(p.status) === 'old client');
    const pool = (myClients.length > 0 || allOldClients.length > 0)
      ? [...myClients, ...allOldClients]
      : cdmList;
    const names = new Set();
    for (const p of pool) {
      const name = String(p.company || '').trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [prospects, cdmName]);

  // Every company name in the Table View prospect roster — feeds the
  // <datalist> the Client Name cell uses for predictive text. Broader
  // than clientOptions on purpose: the user wants autocomplete to
  // match any company they've already added to Table View, not just
  // those currently tagged as a client.
  const companySuggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of (prospects || [])) {
      const c = String(p?.company || '').trim();
      if (!c) continue;
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [prospects]);

  // Normalized set a deal's Client Name auto-maps against. Built from
  // EVERY company in the Table View roster (companySuggestions), not just
  // the CDM/status-filtered client pool — so an exact name match auto-maps
  // regardless of who owns the account or whether it's tagged Client / Old
  // Client. The Mapped-to-Client dropdown still offers the narrower
  // clientOptions pool for manual assignment.
  const clientNameSet = useMemo(
    () => new Set(companySuggestions.map(n => normClient(n))),
    [companySuggestions]
  );

  // Lookup from normalized company name to prospect, so the Client
  // Status column can resolve each deal row to its prospect record.
  // Picks the first prospect with a non-empty status when more than
  // one shares a name, so we surface the "real" status instead of a
  // blank duplicate.
  const prospectByName = useMemo(() => {
    const out = new Map();
    for (const p of prospects) {
      const key = normClient(p.company);
      if (!key) continue;
      const existing = out.get(key);
      if (!existing || (!existing.status && p.status)) out.set(key, p);
    }
    return out;
  }, [prospects]);

  // Per-cell saves write the new value into the stored deal and
  // persist through dealsStore (localStorage + Firestore mirror).
  // Used by inline cell editing (double-click) and the progress
  // popover's checkbox toggles. Falsy / empty saves drop the key
  // entirely so empty cells render the muted "—" placeholder.
  function updateCell(rowId, key, value) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setStore(prev => {
      const next = [...prev.data];
      const current = { ...(next[idx] || {}) };
      if (value === '' || value == null) delete current[key];
      else current[key] = value;
      next[idx] = current;
      try { saveDealsOverride(next); } catch (err) { console.warn('Save deal failed', err); }
      return { data: next, source: 'override' };
    });
  }

  function addNewDeal() {
    setStore(prev => {
      // Pre-fill Due Date 60 days from today so the Days/Paid on
      // delta has something to render against the moment the row
      // appears. Stored in the same M/D/YYYY shape Excel exports use.
      const due = new Date();
      due.setDate(due.getDate() + 60);
      const dueDateStr = due.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
      const next = [{ 'Due Date': dueDateStr }, ...prev.data];
      try { saveDealsOverride(next); } catch (err) { console.warn('Save deal failed', err); }
      return { data: next, source: 'override' };
    });
  }

  // Add a new deal seeded from a flagged Sold opp. Carries over the BFO
  // opp name (so the row immediately matches the opp and clears the
  // warning) plus the Account → Client Name and the opp's GM. Mirrors
  // addNewDeal's Due Date seed so Days/Paid on renders right away.
  function addDealFromOpp(opp) {
    setStore(prev => {
      const due = new Date();
      due.setDate(due.getDate() + 60);
      const dueDateStr = due.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
      const row = { 'Due Date': dueDateStr };
      if (opp.bfo) row[DEAL_BFO_KEY] = opp.bfo;
      if (opp.account) row['Client Name'] = opp.account;
      if (opp.gm) row['GM'] = opp.gm;
      const next = [row, ...prev.data];
      try { saveDealsOverride(next); } catch (err) { console.warn('Save deal failed', err); }
      return { data: next, source: 'override' };
    });
  }

  // Bulk-edit helpers. Selection lives in DealsView state (Set of row
  // indices) and survives table re-renders since `rows` is derived
  // deterministically from `data`. Apply pushes the picked value into
  // every selected row in one setStore pass so the override file gets
  // a single write instead of N round-trips through updateCell.
  function toggleSelected(rowId) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function applyBulkEdit() {
    if (!bulkEditColumn || selectedIds.size === 0) return;
    setStore(prev => {
      const next = prev.data.map((row, idx) => {
        if (!selectedIds.has(idx)) return row;
        const updated = { ...row };
        const v = bulkEditValue;
        if (v === '' || v == null) delete updated[bulkEditColumn];
        else updated[bulkEditColumn] = v;
        return updated;
      });
      try { saveDealsOverride(next); } catch (err) { console.warn('Bulk save failed', err); }
      return { data: next, source: 'override' };
    });
  }

  // Flip the Handoff-progress "ignored" flag on every selected deal.
  // `mode` toggles which way to push it: ignore greys out the first
  // column pill, restore removes the flag.
  function applyBulkIgnore(mode) {
    if (selectedIds.size === 0) return;
    setStore(prev => {
      const next = prev.data.map((row, idx) => {
        if (!selectedIds.has(idx)) return row;
        const updated = { ...row };
        if (mode === 'ignore') updated[PROGRESS_IGNORED_KEY] = '1';
        else delete updated[PROGRESS_IGNORED_KEY];
        return updated;
      });
      try { saveDealsOverride(next); } catch (err) { console.warn('Bulk ignore save failed', err); }
      return { data: next, source: 'override' };
    });
  }

  // Drop a deal row entirely. Wired into the Progress popover's
  // "Delete deal" button so the user can prune rows that shouldn't be
  // in the tracker without hunting for the underlying source.
  function deleteDeal(rowId) {
    const idx = Number(rowId);
    if (!Number.isFinite(idx)) return;
    setStore(prev => {
      if (idx < 0 || idx >= prev.data.length) return prev;
      const next = prev.data.filter((_, i) => i !== idx);
      try { saveDealsOverride(next); } catch (err) { console.warn('Save deals failed', err); }
      return { data: next, source: 'override' };
    });
  }

  const rows = useMemo(
    // A row counts as the freshly-added "new" row (and gets autofocused
    // on its Client Name cell) as long as the top row hasn't been given
    // a Client Name yet. Anchoring this to Client Name rather than the
    // raw key count lets addNewDeal seed defaults like Due Date without
    // disabling the autofocus behavior.
    () => data.map((r, i) => ({ ...r, id: i, __onUpdate: updateCell, __newRow: i === 0 && !isFilled(r['Client Name']) })),
    [data]
  );
  // Sold Opps 2 opps that don't line up with any deal here. The link
  // between the two is the BFO opportunity name — "BFO Link" on an opp,
  // DEAL_BFO_KEY on a deal — so a Sold opp is flagged when it has no BFO
  // name at all, or its BFO name matches no deal row. Surfaces as a
  // warning banner so the user can add the missing deal (or assign the
  // opp's BFO name) before it slips through the cracks.
  const soldMissingDeals = useMemo(() => {
    // Treat dash / #N/A placeholders as "no BFO name", matching the Opps 2
    // import dedup so a "-" cell doesn't read as a real, matchable name.
    const realBfo = (v) => {
      const n = normBfo(v);
      return n === '-' || n === '#n/a' ? '' : n;
    };
    const sold = opps2Records.filter(
      (r) => String(r?.['Stage'] ?? '').trim().toLowerCase() === 'sold'
    );
    if (sold.length === 0) return [];
    const dealBfoNames = new Set();
    for (const r of data) {
      const n = realBfo(r?.[DEAL_BFO_KEY]);
      if (n) dealBfoNames.add(n);
    }
    return sold
      .filter((r) => {
        const n = realBfo(r?.['BFO Link']);
        return !n || !dealBfoNames.has(n);
      })
      .map((r) => {
        const account = String(r?.['Account'] ?? '').trim();
        const scope = String(r?.['Scope'] ?? '').trim();
        const bfo = String(r?.['BFO Link'] ?? '').trim();
        // Stable dismissal key: prefer the opp's _id; fall back to an
        // account/scope/BFO composite so opps without an _id still
        // persist their own ignore state.
        const ignoreKey = r?._id != null
          ? `id:${r._id}`
          : `k:${account}|${scope}|${bfo}`.toLowerCase();
        // GM to carry onto a new deal. Sold opps record their margin as
        // "Final Margin" (the close-out field); fall back to a plain GM /
        // Margin column if the data uses one of those names instead.
        const gm = String(r?.['GM'] ?? r?.['Final Margin'] ?? r?.['Margin'] ?? '').trim();
        return { id: r?._id, account, scope, bfo, ignoreKey, gm };
      });
  }, [opps2Records, data]);

  // Split the flagged opps into the ones still showing and the ones the
  // user has dismissed, so the banner can hide dismissals while still
  // offering a Reset to bring them all back.
  const visibleSoldMissing = useMemo(
    () => soldMissingDeals.filter((o) => !soldIgnore.has(o.ignoreKey)),
    [soldMissingDeals, soldIgnore]
  );
  const ignoredSoldCount = soldMissingDeals.length - visibleSoldMissing.length;

  // Rolled-up Commissions data, keyed by normalized BFO opp name. Feeds
  // the Revenue Recorded / Paid to Date auto-population in buildColumns.
  const commissionsByBfo = useMemo(
    () => indexCommissionsByBfo(commissionsData),
    [commissionsData]
  );
  const baseColumns = useMemo(
    () => buildColumns(rows, columnLinks, listRegistry, commissionsByBfo),
    [rows, columnLinks, listRegistry, commissionsByBfo]
  );
  // Inject a helper "Mapped to Client" column right after the sticky
  // Client Name. The column is read-only when the row's Client Name
  // already matches an active client, and otherwise renders a small
  // dropdown that persists the user's pick via dealClientMap. Only
  // surfaces when prospects are passed in.
  const columns = useMemo(() => {
    if (baseColumns.length === 0) return baseColumns;
    // Leading checkbox column for bulk-edit selection. Underscore-key
    // so DataTable's filter row leaves it alone, and the header
    // renders a compact "select-all-visible" toggle that respects the
    // currently filtered row set.
    const selectCol = {
      key: '__bulkSelect__',
      label: '',
      defaultWidth: 36,
      sticky: false,
      renderHeader: () => null,
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onChange={(e) => { e.stopPropagation(); toggleSelected(row.id); }}
          onClick={(e) => e.stopPropagation()}
          title="Select this deal for bulk edit"
          style={{ cursor: 'pointer' }}
        />
      ),
      exportValue: () => '',
      getFilterValue: () => '',
    };
    // Leading column shows a compact handoff-progress pill for each
    // deal (e.g. "2/4") and opens a popover with the four fields.
    // Always added — independent of the Mapped to Client / Status
    // helpers below, which depend on the prospect roster.
    const progressCol = {
      key: PROGRESS_COL_KEY,
      label: PROGRESS_COL_LABEL,
      defaultWidth: 90,
      sticky: true,
      render: (row) => (
        <ProgressCell
          row={row}
          columnLinks={columnLinks}
          listRegistry={listRegistry}
          onSave={updateCell}
          onDelete={deleteDeal}
        />
      ),
      exportValue: (row) => {
        if (isFilled(row[PROGRESS_IGNORED_KEY])) return 'Ignored';
        const done = PROGRESS_FIELDS.filter(f => isFieldDone(row, f)).length;
        return `${done}/${PROGRESS_FIELDS.length}`;
      },
      getFilterValue: () => '',
    };
    // Drop sticky from the original first column (Client Name) — only
    // one column can be left-anchored at a time. Also decorate the cell
    // with a ⚠ warning when the deal's Client Name matches no company
    // in the Table View roster — directly or through a hand-mapping to
    // a client. This is broader than the "Mapped to Client" helper,
    // which only checks the active-client subset: a name can be a real
    // Table View company that just isn't tagged as a client (that shows
    // the yellow "Map to client…" prompt), versus a name that matches
    // nothing in Table View at all (a typo, or an account never added)
    // — only the latter gets the ⚠. Stays silent when the roster hasn't
    // loaded (prospectByName empty) so there's nothing to match against,
    // and respects the same per-name ignore set as the mapping column.
    const clientNameBaseRender = baseColumns[0].render;
    const clientNameCol = {
      ...baseColumns[0],
      sticky: false,
      render: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        const norm = normClient(raw);
        const mapped = clientMap[norm];
        const unknownToTableView = !!raw
          && prospectByName.size > 0
          && !ignoreSet.has(norm)
          && !prospectByName.has(norm)
          && !(mapped && prospectByName.has(normClient(mapped)));
        if (!unknownToTableView) return clientNameBaseRender(row);
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
            <span style={{ flex: 1, minWidth: 0 }}>{clientNameBaseRender(row)}</span>
            <ClientNameWarning
              name={raw}
              cdmName={cdmName}
              onAdd={addProspect || null}
              onIgnore={setDealClientIgnore}
            />
          </span>
        );
      },
    };
    if (clientNameSet.size === 0) {
      return [selectCol, progressCol, clientNameCol, ...baseColumns.slice(1)];
    }
    const helperCol = {
      key: MAPPED_COL_KEY,
      label: MAPPED_COL_LABEL,
      defaultWidth: 220,
      render: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return <span style={{ color: '#94A3B8' }}>—</span>;
        const norm = normClient(raw);
        const auto = clientNameSet.has(norm);
        const manual = clientMap[norm];
        const ignored = ignoreSet.has(norm);
        if (auto) {
          return (
            <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: '#DCFCE7', color: '#166534' }} title="Client Name matches a company in Table View">
              ✓ Matches
            </span>
          );
        }
        return (
          <MappedClientCell
            raw={raw}
            manual={manual}
            ignored={ignored}
            clientOptions={clientOptions}
            onChange={setDealClientMapping}
            onToggleIgnore={setDealClientIgnore}
          />
        );
      },
      exportValue: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return '';
        const norm = normClient(raw);
        if (clientNameSet.has(norm)) return raw;
        if (ignoreSet.has(norm)) return '(ignored)';
        return clientMap[norm] || '';
      },
    };
    // Looks up the prospect status for each deal row. Uses the
    // mapped target when the user has hand-mapped this source name,
    // otherwise the raw Client Name. Both sides are normalized.
    const statusCol = {
      key: STATUS_COL_KEY,
      label: STATUS_COL_LABEL,
      defaultWidth: 130,
      render: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return <span style={{ color: '#94A3B8' }}>—</span>;
        const norm = normClient(raw);
        const mapped = clientMap[norm];
        const lookupKey = mapped ? normClient(mapped) : norm;
        const prospect = prospectByName.get(lookupKey);
        const status = prospect?.status;
        if (!status) return <span style={{ color: '#94A3B8' }}>—</span>;
        const pill = statusPillStyle(status);
        return (
          <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, ...pill }}>
            {status}
          </span>
        );
      },
      exportValue: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return '';
        const norm = normClient(raw);
        const mapped = clientMap[norm];
        const lookupKey = mapped ? normClient(mapped) : norm;
        return prospectByName.get(lookupKey)?.status || '';
      },
      getFilterValue: (row) => {
        const raw = String(row['Client Name'] || '').trim();
        if (!raw) return '';
        const norm = normClient(raw);
        const mapped = clientMap[norm];
        const lookupKey = mapped ? normClient(mapped) : norm;
        return prospectByName.get(lookupKey)?.status || '';
      },
    };
    // Order: select · progress · client name · mapped-to-client · status · rest.
    return [selectCol, progressCol, clientNameCol, helperCol, statusCol, ...baseColumns.slice(1)];
  }, [baseColumns, clientOptions, clientNameSet, clientMap, ignoreSet, prospectByName, columnLinks, listRegistry, selectedIds, cdmName, addProspect]);
  const tableId = useMemo(
    () => 'deals:' + columns.map(c => c.key).sort().join('|'),
    [columns]
  );
  const alwaysVisible = useMemo(
    () => columns.slice(0, 2).map(c => c.key),
    [columns]
  );
  // Headers that the Link Columns modal lets the user bind to a
  // Dropdowns list. Helper / computed columns (progress pill, Mapped
  // to Client, Client Status) carry an `__` prefix and never get a
  // free-text editor, so a dropdown binding wouldn't apply.
  const linkableHeaders = useMemo(
    () => columns.map(c => c.key).filter(k => !String(k).startsWith('__')),
    [columns]
  );

  function isRowUnmapped(row) {
    if (clientNameSet.size === 0) return false;
    const raw = String(row['Client Name'] || '').trim();
    if (!raw) return false;
    const norm = normClient(raw);
    if (clientNameSet.has(norm)) return false;
    if (clientMap[norm]) return false;
    if (ignoreSet.has(norm)) return false;
    return true;
  }

  // A row counts as "incomplete handoff" when it isn't opted-out via
  // the Progress popover and at least one of the PROGRESS_FIELDS is
  // still blank. Mirrors the X/N math the pill shows in the first
  // column so the filter button stays in lockstep with the badge.
  const incompleteCount = useMemo(
    () => rows.filter(r => !isFilled(r[PROGRESS_IGNORED_KEY])
      && PROGRESS_FIELDS.some(f => !isFieldDone(r, f))).length,
    [rows]
  );

  const filtered = useMemo(() => {
    let out = rows;
    if (search.trim()) {
      const term = search.toLowerCase();
      out = out.filter(r =>
        Object.values(r).some(v => String(v).toLowerCase().includes(term))
      );
    }
    if (onlyUnmapped) out = out.filter(isRowUnmapped);
    if (onlyIncomplete) {
      out = out.filter(r => !isFilled(r[PROGRESS_IGNORED_KEY])
        && PROGRESS_FIELDS.some(f => !isFieldDone(r, f)));
    }
    return out;
  }, [search, rows, onlyUnmapped, onlyIncomplete, clientNameSet, clientMap, ignoreSet, clientOptions]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('Workbook has no sheets');
      const parsed = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('No rows parsed');

      // Normalize headers: trim whitespace, strip stray trailing
      // periods so 'Client Name ' or 'Client Name.' still lands under
      // the canonical column, then fold aliases (e.g. 'Paperwork' ->
      // 'Paperwork completed') so old and new tracker exports share
      // the same underlying column.
      const normalizeHeader = (h) => {
        const cleaned = String(h || '').trim().replace(/\.+$/, '');
        const aliased = HEADER_ALIASES[cleaned.toLowerCase()];
        return aliased || cleaned;
      };
      const cleaned = parsed
        .map(r => {
          const out = {};
          for (const k of Object.keys(r)) out[normalizeHeader(k)] = r[k];
          return out;
        })
        .filter(r => Object.values(r).some(v => v !== '' && v != null));

      if (cleaned.length === 0) throw new Error('All rows were blank.');
      saveDealsOverride(cleaned);
      setStore(loadDealsList());
    } catch (err) {
      const msg = err?.name === 'QuotaExceededError'
        ? 'Upload too large for browser storage (max ~5 MB). Try trimming unused columns.'
        : (err?.message || 'Failed to read file');
      setUploadError(msg);
    }
  }

  function handleRevert() {
    if (!window.confirm('Clear the uploaded deals list?')) return;
    clearDealsOverride();
    setStore(loadDealsList());
  }

  function handlePasteImport(records) {
    saveDealsOverride(records);
    setStore(loadDealsList());
    setShowPaste(false);
  }

  // Count rows whose Client Name doesn't match any active client,
  // hasn't been hand-mapped, and hasn't been explicitly ignored.
  // Surfaces the work the user still has to do after a paste import.
  const unmappedCount = useMemo(() => {
    if (clientNameSet.size === 0) return 0;
    let n = 0;
    for (const r of rows) {
      const raw = String(r['Client Name'] || '').trim();
      if (!raw) continue;
      const norm = normClient(raw);
      if (clientNameSet.has(norm)) continue;
      if (clientMap[norm]) continue;
      if (ignoreSet.has(norm)) continue;
      n++;
    }
    return n;
  }, [rows, clientNameSet, clientMap, ignoreSet]);

  // Distinct unmapped source-name strings drive bulk actions: ignoring
  // or assigning happens per source name, so each "Brookfield (BPREP
  // US fund)" only needs one decision regardless of how many deal
  // rows share it.
  const distinctUnmappedNames = useMemo(() => {
    const out = new Map();
    for (const r of rows) {
      if (!isRowUnmapped(r)) continue;
      const raw = String(r['Client Name'] || '').trim();
      if (!raw) continue;
      const norm = normClient(raw);
      if (!out.has(norm)) out.set(norm, raw);
    }
    return out;
  }, [rows, clientNameSet, clientMap, ignoreSet, clientOptions]);

  function handleBulkIgnore() {
    if (distinctUnmappedNames.size === 0) return;
    if (!window.confirm(`Ignore all ${distinctUnmappedNames.size} unmapped Client Name${distinctUnmappedNames.size === 1 ? '' : 's'}? You can undo per row with the ↺ button.`)) return;
    bulkSetDealClientIgnore([...distinctUnmappedNames.values()], true);
  }

  function handleBulkMap() {
    if (!bulkPick) return;
    if (distinctUnmappedNames.size === 0) return;
    if (!window.confirm(`Map all ${distinctUnmappedNames.size} unmapped Client Name${distinctUnmappedNames.size === 1 ? '' : 's'} to "${bulkPick}"?`)) return;
    bulkSetDealClientMapping([...distinctUnmappedNames.values()], bulkPick);
    setBulkPick('');
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Predictive-text source for every Client Name cell. Rendered
          once at the view level so each EditableCell input just
          points at it via the list="..." attribute. */}
      <datalist id={CLIENT_NAME_LIST_ID}>
        {companySuggestions.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div style={{ padding: '1rem 1.25rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexShrink: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1E293B', margin: 0 }}>Deals</h2>
          <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 2 }}>
            {rows.length} deals{source === 'override' ? ' · uploaded' : ''}. Upload an Excel export or paste from Google Sheets.
            {unmappedCount > 0 && (
              <> · <span style={{ color: '#92400E', fontWeight: 700 }}>{unmappedCount} row{unmappedCount === 1 ? '' : 's'} with unmatched Client Names</span> — use the <em>Mapped to Client</em> column to assign or ignore.</>
            )}
            {ignoreSet.size > 0 && (
              <> · <span style={{ color: '#64748B' }}>{ignoreSet.size} ignored</span></>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={addNewDeal}
            title="Add a blank deal row at the top of the table — start typing into any cell to populate it."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid #16A34A', background: '#16A34A', color: '#fff', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >+ New Deal</button>
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            title="Paste tab-separated rows copied from Google Sheets. The next step lets you confirm which pasted column maps to each deal field."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >Paste from Sheets</button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Replace the Deals table by uploading a new Excel file."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >Upload Excel</button>
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            title="Bind deal columns to Dropdowns-tab lists so cells pick from a fixed option list."
            style={{ padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', background: 'white', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >Link columns</button>
          {source === 'override' && (
            <button
              type="button"
              onClick={handleRevert}
              title="Remove the uploaded deals list"
              style={{ padding: '0.4rem 0.8rem', border: '1px solid #FCA5A5', background: 'white', color: '#DC2626', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Clear</button>
          )}
        </div>
      </div>

      {uploadError && (
        <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.8rem' }}>
          {uploadError}
        </div>
      )}

      {visibleSoldMissing.length > 0 && (
        <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.6rem 0.85rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 6, color: '#92400E', fontSize: '0.8rem', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ⚠ {visibleSoldMissing.length} Sold {visibleSoldMissing.length === 1 ? 'opp has' : 'opps have'} no matching deal here
          </div>
          <div style={{ fontSize: '0.74rem', marginBottom: 6 }}>
            These opportunities are marked <strong>Sold</strong> in Opps but their BFO opp name isn&apos;t on the Deals page. Add the deal (or set the opp&apos;s BFO Opportunity Name) so it shows up here.
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {visibleSoldMissing.map((o) => (
              <li key={o.ignoreKey} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span>
                  <strong>{o.account || 'Unknown account'}</strong>
                  {o.scope ? <> &middot; {o.scope}</> : null}
                  {o.bfo
                    ? <span style={{ color: '#B45309' }}> — BFO opp name &ldquo;{o.bfo}&rdquo; not found on Deals</span>
                    : <span style={{ color: '#B45309' }}> — no BFO opp name set</span>}
                </span>
                <button
                  type="button"
                  onClick={() => addDealFromOpp(o)}
                  title="Create a new deal seeded with this opp's BFO opp name, Client Name, and GM"
                  style={{
                    flex: '0 0 auto', padding: '0 0.45rem', background: '#92400E',
                    border: '1px solid #92400E', borderRadius: 4, color: '#fff',
                    fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                  }}
                >Add to new deal</button>
                <button
                  type="button"
                  onClick={() => setSoldWarningIgnore(o.ignoreKey, true)}
                  title="Stop warning about this opp"
                  style={{
                    flex: '0 0 auto', padding: '0 0.4rem', background: 'transparent',
                    border: '1px solid #FCD34D', borderRadius: 4, color: '#92400E',
                    fontSize: '0.68rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                  }}
                >Ignore</button>
              </li>
            ))}
          </ul>
          {ignoredSoldCount > 0 && (
            <div style={{ fontSize: '0.7rem', marginTop: 6 }}>
              {ignoredSoldCount} ignored ·{' '}
              <button
                type="button"
                onClick={() => clearSoldWarningIgnore()}
                style={{ padding: 0, background: 'none', border: 'none', color: '#92400E', textDecoration: 'underline', fontSize: '0.7rem', fontFamily: 'inherit', cursor: 'pointer' }}
              >Reset</button>
            </div>
          )}
        </div>
      )}

      {visibleSoldMissing.length === 0 && ignoredSoldCount > 0 && (
        <div style={{ margin: '0 1.25rem 0.5rem', fontSize: '0.7rem', color: '#94A3B8', flexShrink: 0 }}>
          {ignoredSoldCount} Sold-opp {ignoredSoldCount === 1 ? 'warning' : 'warnings'} ignored ·{' '}
          <button
            type="button"
            onClick={() => clearSoldWarningIgnore()}
            style={{ padding: 0, background: 'none', border: 'none', color: '#64748B', textDecoration: 'underline', fontSize: '0.7rem', fontFamily: 'inherit', cursor: 'pointer' }}
          >Reset</button>
        </div>
      )}

      <div style={{ padding: '0 1.25rem 0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter deals…"
          style={{ flex: 1, maxWidth: 400, padding: '0.4rem 0.6rem', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: '0.78rem', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
          {filtered.length} of {rows.length}
        </span>
        {clientNameSet.size > 0 && (
          <button
            type="button"
            onClick={() => setOnlyUnmapped(v => !v)}
            disabled={unmappedCount === 0 && !onlyUnmapped}
            title={unmappedCount === 0 ? 'No unmapped rows remain' : (onlyUnmapped ? 'Show all rows' : 'Show only rows whose Client Name is not yet mapped or matched')}
            style={{
              padding: '0.35rem 0.7rem',
              border: '1px solid',
              borderColor: onlyUnmapped ? '#92400E' : '#FCD34D',
              borderRadius: 6,
              background: onlyUnmapped ? '#92400E' : '#FFFBEB',
              color: onlyUnmapped ? '#fff' : '#92400E',
              fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit',
              cursor: (unmappedCount === 0 && !onlyUnmapped) ? 'not-allowed' : 'pointer',
              opacity: (unmappedCount === 0 && !onlyUnmapped) ? 0.5 : 1,
            }}
          >{onlyUnmapped ? `✓ Showing unmapped (${unmappedCount})` : `Show only unmapped (${unmappedCount})`}</button>
        )}
        <button
          type="button"
          onClick={() => setOnlyIncomplete(v => !v)}
          disabled={incompleteCount === 0 && !onlyIncomplete}
          title={incompleteCount === 0
            ? 'Every deal has a fully-checked Handoff progress'
            : (onlyIncomplete
                ? 'Show all rows'
                : `Show only deals whose Handoff progress is less than ${PROGRESS_FIELDS.length}/${PROGRESS_FIELDS.length}`)}
          style={{
            padding: '0.35rem 0.7rem',
            border: '1px solid',
            borderColor: onlyIncomplete ? '#991B1B' : '#FCA5A5',
            borderRadius: 6,
            background: onlyIncomplete ? '#991B1B' : '#FEF2F2',
            color: onlyIncomplete ? '#fff' : '#991B1B',
            fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit',
            cursor: (incompleteCount === 0 && !onlyIncomplete) ? 'not-allowed' : 'pointer',
            opacity: (incompleteCount === 0 && !onlyIncomplete) ? 0.5 : 1,
          }}
        >{onlyIncomplete
          ? `✓ Showing incomplete (${incompleteCount})`
          : `Show only < ${PROGRESS_FIELDS.length}/${PROGRESS_FIELDS.length} (${incompleteCount})`}</button>
        {(() => {
          const visibleIds = filtered.map(r => r.id);
          const visibleCount = visibleIds.length;
          const allSelected = visibleCount > 0 && visibleIds.every(id => selectedIds.has(id));
          return (
            <button
              type="button"
              onClick={() => {
                if (allSelected) {
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    for (const id of visibleIds) next.delete(id);
                    return next;
                  });
                } else {
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    for (const id of visibleIds) next.add(id);
                    return next;
                  });
                }
              }}
              disabled={visibleCount === 0}
              title={visibleCount === 0
                ? 'No rows visible to select'
                : allSelected
                  ? `Deselect the ${visibleCount} visible row${visibleCount === 1 ? '' : 's'}`
                  : `Tick the bulk-edit checkbox on every visible row (${visibleCount})`}
              style={{
                padding: '0.35rem 0.7rem',
                border: '1px solid',
                borderColor: allSelected ? '#1D4ED8' : '#93C5FD',
                borderRadius: 6,
                background: allSelected ? '#1D4ED8' : '#EFF6FF',
                color: allSelected ? '#fff' : '#1D4ED8',
                fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit',
                cursor: visibleCount === 0 ? 'not-allowed' : 'pointer',
                opacity: visibleCount === 0 ? 0.5 : 1,
              }}
            >{allSelected ? `✓ All visible selected (${visibleCount})` : `Select all (${visibleCount})`}</button>
          );
        })()}
      </div>

      {selectedIds.size > 0 && (() => {
        const link = bulkEditColumn ? resolveColumnLink(bulkEditColumn, columnLinks) : null;
        const linkedOpts = link ? (listRegistry?.get(link.listKey)?.options || []) : null;
        return (
          <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem', background: '#EFF6FF', border: '1px solid #93C5FD', borderRadius: 6, display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
            <strong style={{ fontSize: '0.72rem', color: '#1D4ED8' }}>
              {selectedIds.size} selected
            </strong>
            <span style={{ fontSize: '0.7rem', color: '#1E40AF' }}>· set</span>
            <select
              value={bulkEditColumn}
              onChange={(e) => { setBulkEditColumn(e.target.value); setBulkEditValue(''); }}
              style={{ padding: '0.25rem 0.4rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B', maxWidth: 220 }}
            >
              <option value="">— Column… —</option>
              {linkableHeaders.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span style={{ fontSize: '0.7rem', color: '#1E40AF' }}>=</span>
            {linkedOpts ? (
              <select
                value={bulkEditValue}
                onChange={(e) => setBulkEditValue(e.target.value)}
                disabled={!bulkEditColumn}
                style={{ padding: '0.25rem 0.4rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B', maxWidth: 220 }}
              >
                <option value="">(clear)</option>
                {linkedOpts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={bulkEditValue}
                onChange={(e) => setBulkEditValue(e.target.value)}
                placeholder="New value (blank = clear)"
                disabled={!bulkEditColumn}
                style={{ padding: '0.25rem 0.4rem', border: '1px solid #93C5FD', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', background: bulkEditColumn ? '#fff' : '#F1F5F9', color: '#1E293B', minWidth: 160 }}
              />
            )}
            <button
              type="button"
              onClick={() => {
                if (!bulkEditColumn) return;
                const label = bulkEditValue === ''
                  ? `Clear ${bulkEditColumn} on ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'}?`
                  : `Set ${bulkEditColumn} to "${bulkEditValue}" on ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'}?`;
                if (!window.confirm(label)) return;
                applyBulkEdit();
              }}
              disabled={!bulkEditColumn}
              style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: 4, background: bulkEditColumn ? '#1D4ED8' : '#94A3B8', color: '#fff', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: bulkEditColumn ? 'pointer' : 'not-allowed' }}
            >Apply to {selectedIds.size}</button>
            <span style={{ fontSize: '0.7rem', color: '#1E40AF' }}>·</span>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Mark ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'} as Ignored? Their Handoff progress pills will grey out.`)) return;
                applyBulkIgnore('ignore');
              }}
              title="Grey out the Handoff progress pill on every selected deal"
              style={{ padding: '0.3rem 0.7rem', border: '1px solid #64748B', borderRadius: 4, background: '#64748B', color: '#fff', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
            >✕ Ignore {selectedIds.size}</button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Restore ${selectedIds.size} deal${selectedIds.size === 1 ? '' : 's'} into the Handoff progress tally?`)) return;
                applyBulkIgnore('restore');
              }}
              title="Re-include the selected deals in the Handoff progress tally"
              style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
            >↻ Restore</button>
            <button
              type="button"
              onClick={clearSelection}
              style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
            >Clear selection</button>
          </div>
        );
      })()}

      {onlyUnmapped && distinctUnmappedNames.size > 0 && (
        <div style={{ margin: '0 1.25rem 0.5rem', padding: '0.5rem 0.75rem', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 6, display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.72rem', color: '#92400E' }}>
            {distinctUnmappedNames.size} distinct unmapped Client Name{distinctUnmappedNames.size === 1 ? '' : 's'}
          </strong>
          <span style={{ fontSize: '0.7rem', color: '#92400E' }}>· apply to all:</span>
          <select
            value={bulkPick}
            onChange={(e) => setBulkPick(e.target.value)}
            style={{ padding: '0.25rem 0.4rem', border: '1px solid #FCD34D', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', background: '#fff', color: '#1E293B', maxWidth: 280 }}
          >
            <option value="">— Map all to client… —</option>
            {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            type="button"
            onClick={handleBulkMap}
            disabled={!bulkPick}
            style={{ padding: '0.3rem 0.7rem', border: 'none', borderRadius: 4, background: bulkPick ? '#16A34A' : '#94A3B8', color: '#fff', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: bulkPick ? 'pointer' : 'not-allowed' }}
          >Map all</button>
          <span style={{ fontSize: '0.7rem', color: '#92400E' }}>or</span>
          <button
            type="button"
            onClick={handleBulkIgnore}
            style={{ padding: '0.3rem 0.7rem', border: '1px solid #CBD5E1', borderRadius: 4, background: '#fff', color: '#475569', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
          >✕ Ignore all unmapped</button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 ? (
          <div style={{ margin: '0 1.25rem', padding: '1.25rem', background: '#fff', border: '2px dashed #CBD5E1', borderRadius: 8, color: '#475569', textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>No deals yet</div>
            <div style={{ fontSize: '0.78rem' }}>
              Click <strong>+ New Deal</strong> to add a blank row and type into the cells, <strong>Paste from Sheets</strong> to drop in copied Google Sheets rows, or <strong>Upload Excel</strong> for a workbook.
            </div>
          </div>
        ) : (
          <DataTable
            key={tableId}
            tableId={tableId}
            columns={columns}
            rows={filtered}
            defaultSort={{ key: 'Days/Paid on', direction: 'desc' }}
            alwaysVisible={alwaysVisible}
            rowStyle={(row) => {
              if (clientNameSet.size === 0) return undefined;
              const raw = String(row['Client Name'] || '').trim();
              if (!raw) return undefined;
              const norm = normClient(raw);
              if (clientNameSet.has(norm)) return undefined;
              if (clientMap[norm]) return undefined;
              if (ignoreSet.has(norm)) return undefined;
              return { background: '#FFFBEB' };
            }}
            emptyMessage={search ? `No deals match "${search}"` : 'No deals to display'}
            enableColumnFilters
            // Name the downloaded workbook "Deal Export - <date>.xlsx".
            exportFileName="Deal Export"
            // Always include Commission and the derived Year in the Excel
            // export, even when the user has hidden them on screen.
            exportExtraColumnKeys={['Commission', 'Year']}
            settings={settings}
            updateSettings={updateSettings}
          />
        )}
      </div>
      {showPaste && (
        <PasteImportModal
          onClose={() => setShowPaste(false)}
          onImport={handlePasteImport}
        />
      )}
      {linkModalOpen && (
        <LinkColumnsModal
          headers={linkableHeaders}
          columnLinks={columnLinks}
          listRegistry={listRegistry}
          availableLists={availableLists}
          onChange={updateColumnLinks}
          onClose={() => setLinkModalOpen(false)}
        />
      )}
    </div>
  );
}
````

### src/components/DealsView/PasteImportModal.jsx

````jsx
import { useState, useMemo } from 'react';

// Canonical destination columns recognised by the Deals subtab. Kept
// in sync with COLUMN_ORDER + HEADER_ALIASES in DealsView so the
// dropdown always offers the exact field name the rest of the app
// will read.
const CANONICAL = [
  'Client Name',
  'Commission Sheet Sent to Kathy',
  'Paperwork completed',
  'Billing information collected',
  'Closed Won',
  'On Client Tracker?',
  'BFO - Close after contract execution email has been sent',
  'Agreement Name',
  'Current Term Start Date',
  'Original Contract Start',
  'Setup',
  'Recurring Revenue',
  'Commission',
  'Revenue Recorded',
  'Paid to Date',
  'Delta',
  'Currently being paid',
  'Ticket',
  'Comm Status',
  'Due Date',
  'Days/Paid on',
  'GM',
  'Payment Terms',
  'End Date',
  'Auto renewal?',
  'Esc',
  'Current Value',
  'SUCON?',
  'Comm Tracker?',
  'Comm Tracker?2',
  'Comm Tracker?3',
  'Comm Tracker?4',
  'Comm Tracker?5',
  'Comm Tracker?6',
  'Combined',
  'Combine Project Name',
  'Commission Rate',
  'Year',
  'Month',
  'Follow Up On Sale',
];

const ALIASES = {
  'paperwork': 'Paperwork completed',
  'billing letter': 'Billing information collected',
  'combined bfo': 'Combined',
};

function autoMap(srcHeader) {
  const cleaned = String(srcHeader || '').trim().replace(/\.+$/, '');
  if (!cleaned) return '';
  const lower = cleaned.toLowerCase();
  const exact = CANONICAL.find(c => c.toLowerCase() === lower);
  if (exact) return exact;
  return ALIASES[lower] || '';
}

// Robust tab-separated parser for the Google-Sheets clipboard format:
// cells with newlines/tabs/quotes arrive wrapped in double quotes,
// with internal quotes doubled. A naive line.split('\n') would tear
// quoted multi-line cells in half.
function parseTSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"' && !cellStarted) { inQuotes = true; cellStarted = true; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; cellStarted = false; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; cellStarted = false; continue; }
    cell += ch;
    cellStarted = true;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  while (rows.length > 0 && rows[rows.length - 1].every(c => c === '')) rows.pop();
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(h => String(h || '').trim());
  return { headers, rows: rows.slice(1) };
}

export function PasteImportModal({ onClose, onImport }) {
  const [paste, setPaste] = useState('');
  const [stage, setStage] = useState('paste');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [parseError, setParseError] = useState('');

  function handleNext() {
    setParseError('');
    const { headers: h, rows } = parseTSV(paste);
    if (h.length === 0 || rows.length === 0) {
      setParseError('Nothing to import — paste tab-separated data copied from Google Sheets.');
      return;
    }
    const m = {};
    for (const src of h) m[src] = autoMap(src);
    setHeaders(h);
    setRawRows(rows);
    setMapping(m);
    setStage('map');
  }

  function handleImport() {
    const records = rawRows
      .map(cells => {
        const obj = {};
        for (let i = 0; i < headers.length; i++) {
          const dest = mapping[headers[i]];
          if (!dest) continue;
          const v = cells[i];
          if (v == null || v === '') continue;
          obj[dest] = v;
        }
        return obj;
      })
      .filter(r => Object.keys(r).length > 0);
    if (records.length === 0) {
      setParseError('No mapped columns — pick at least one destination column.');
      return;
    }
    onImport(records);
  }

  const mappedCount = useMemo(
    () => headers.filter(h => mapping[h]).length,
    [headers, mapping]
  );
  const preview = useMemo(() => rawRows.slice(0, 3), [rawRows]);
  const unmappedSourceNames = useMemo(
    () => headers.filter(h => !mapping[h]),
    [headers, mapping]
  );
  const duplicateDestinations = useMemo(() => {
    const seen = new Map();
    for (const src of headers) {
      const dest = mapping[src];
      if (!dest) continue;
      seen.set(dest, (seen.get(dest) || 0) + 1);
    }
    return [...seen.entries()].filter(([, n]) => n > 1).map(([d]) => d);
  }, [headers, mapping]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, width: 'min(960px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 10px 40px rgba(15, 23, 42, 0.3)' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <strong style={{ fontSize: '0.9rem', color: '#1E293B' }}>
            {stage === 'paste' ? 'Paste deals from Google Sheets' : `Map columns — ${rawRows.length} rows`}
          </strong>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', color: '#64748B', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {stage === 'paste' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.4 }}>
              In Google Sheets, select the rows you want (including the header row) and copy with <strong>Cmd+C</strong> / <strong>Ctrl+C</strong>. Then click in the box below and paste. The next step lets you confirm which pasted column maps to each deal field.
            </div>
            <textarea
              value={paste}
              onChange={e => setPaste(e.target.value)}
              placeholder="Paste your tab-separated data here…"
              style={{ width: '100%', minHeight: 320, padding: '0.5rem', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: '0.72rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical', boxSizing: 'border-box' }}
            />
            {parseError && (
              <div style={{ padding: '0.4rem 0.6rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.72rem' }}>{parseError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={onClose} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleNext} disabled={!paste.trim()} style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: paste.trim() ? '#3B82F6' : '#94A3B8', color: '#fff', fontSize: '0.78rem', cursor: paste.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontWeight: 600 }}>Next: Map columns →</button>
            </div>
          </div>
        )}

        {stage === 'map' && (
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1, minHeight: 0 }}>
            <div style={{ fontSize: '0.72rem', color: '#475569' }}>
              {rawRows.length} rows · <strong>{mappedCount}/{headers.length}</strong> columns mapped
              {unmappedSourceNames.length > 0 && <> · <span style={{ color: '#92400E' }}>{unmappedSourceNames.length} pasted column{unmappedSourceNames.length === 1 ? '' : 's'} will be skipped</span></>}
              {duplicateDestinations.length > 0 && <> · <span style={{ color: '#991B1B' }}>Multiple sources point at: {duplicateDestinations.join(', ')}</span></>}
            </div>
            <div style={{ overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: 6, flex: 1, minHeight: 0 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.72rem' }}>
                <thead style={{ background: '#F1F5F9', position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>Source header</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>→ Destination</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', color: '#475569', fontWeight: 700, borderBottom: '1px solid #CBD5E1' }}>Preview (first 3 rows)</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((src, i) => {
                    const dest = mapping[src];
                    return (
                      <tr key={i} style={{ background: dest ? '#FFFFFF' : '#FFFBEB' }}>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', fontWeight: 600, color: '#1E293B', whiteSpace: 'nowrap' }}>
                          {src || <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>(blank)</span>}
                        </td>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0' }}>
                          <select
                            value={dest || ''}
                            onChange={e => setMapping(m => ({ ...m, [src]: e.target.value }))}
                            style={{ padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: 4, fontSize: '0.72rem', fontFamily: 'inherit', minWidth: 240, background: '#fff' }}
                          >
                            <option value="">— Skip —</option>
                            {CANONICAL.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #E2E8F0', color: '#64748B', maxWidth: 360 }}>
                          {preview.map((cells, pi) => (
                            <div key={pi} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={cells[i] ?? ''}>
                              {cells[i] || <span style={{ color: '#CBD5E1' }}>—</span>}
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {parseError && (
              <div style={{ padding: '0.4rem 0.6rem', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#991B1B', fontSize: '0.72rem' }}>{parseError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <button onClick={() => setStage('paste')} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>← Back</button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={onClose} style={{ padding: '0.4rem 0.8rem', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={handleImport} disabled={mappedCount === 0} style={{ padding: '0.4rem 0.9rem', border: 'none', borderRadius: 6, background: mappedCount === 0 ? '#94A3B8' : '#16A34A', color: '#fff', fontSize: '0.78rem', cursor: mappedCount === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Replace deals with {rawRows.length} rows →</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
````

### src/components/PricingView/BrokerFeesTab.jsx

````jsx
import { useState } from 'react';
import styles from './BrokerFeesTab.module.css';

const EMPTY_ROW = () => ({
  company: '',
  loadEp: '',     // kWh
  feeEp: '',      // $ / kWh
  rfps: '',
  loadNg: '',     // Dth
  feeNg: '',      // $ / Dth
});

// Historical broker-fee benchmarks pulled from the deal log. Loaded
// as the default seed when no broker-fee data has been entered yet
// (and re-loaded by the "Load historical defaults" button below). The
// "SE PE pricing" rows are reference floors/ceilings and get bolded
// by the benchmark-row check in the render.
const SEED_ROWS = () => ([
  { company: 'Brixmor',                        loadEp: '',          feeEp: '0.00190', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'CBRE IM',                        loadEp: '65444610',  feeEp: '0.00235', rfps: '', loadNg: '11857',  feeNg: '0.11'   },
  { company: 'Group RMC',                      loadEp: '6500000',   feeEp: '0.00300', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'Guy',                            loadEp: '10000000',  feeEp: '0.00300', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'High end SS - SE PE pricing',    loadEp: '10000000',  feeEp: '0.00350', rfps: '', loadNg: '50000',  feeNg: '0.21'   },
  { company: 'High end RFP - SE PE pricing',   loadEp: '10000000',  feeEp: '0.00075', rfps: '', loadNg: '50000',  feeNg: ''       },
  { company: 'Intown Suites',                  loadEp: '',          feeEp: '0.00275', rfps: '', loadNg: '',       feeNg: '0.20'   },
  { company: 'IRG',                            loadEp: '',          feeEp: '0.00206', rfps: '', loadNg: '',       feeNg: '0.05'   },
  { company: 'IRG',                            loadEp: '118090000', feeEp: '0.00090', rfps: '', loadNg: '',       feeNg: '0.07'   },
  { company: 'Jamestown',                      loadEp: '26616828',  feeEp: '0.00075', rfps: '4', loadNg: '25032', feeNg: '0.18'   },
  { company: 'Low end SS - SE PE pricing',     loadEp: '25000000',  feeEp: '0.00120', rfps: '', loadNg: '75000',  feeNg: '0.11'   },
  { company: 'Low end RFP - SE PE pricing',    loadEp: '25000000',  feeEp: '0.00025', rfps: '', loadNg: '75000',  feeNg: '0.06'   },
  { company: 'Luxema',                         loadEp: '26534377',  feeEp: '0.00120', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'Piedmont',                       loadEp: '103772520', feeEp: '0.00080', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'Starwood',                       loadEp: '',          feeEp: '0.00275', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'WeWork',                         loadEp: '',          feeEp: '0.01249', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'Willco',                         loadEp: '17563824',  feeEp: '0.00275', rfps: '', loadNg: '',       feeNg: ''       },
  { company: 'Criterion',                      loadEp: '385000',    feeEp: '0.03600', rfps: '', loadNg: '',       feeNg: ''       },
  { company: '',                               loadEp: '12215073',  feeEp: '0.002',   rfps: '', loadNg: '',       feeNg: ''       },
]);

const fmtMoney = (n, dp = 0) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp });
};

const fmtRate = (n, dp = 5) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return `$${n.toFixed(dp)}`;
};

const fmtNum = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function totalFee(load, rate) {
  const l = toNum(load);
  const r = toNum(rate);
  if (l == null || r == null) return null;
  return l * r;
}

// Heatmap interpolator. Returns an HSL background for a numeric value
// scaled across the [min, max] range. `direction = 'highGood'` puts
// green at the high end (loads — bigger is better for us); 'lowGood'
// puts green at the low end (broker fees — lower is cheaper).
function heatmapBg(value, min, max, direction) {
  if (value == null || !Number.isFinite(value) || min == null || max == null || max === min) return null;
  let t = (value - min) / (max - min);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  if (direction === 'lowGood') t = 1 - t;
  // Interpolate hue red(0) → yellow(60) → green(120). Keep saturation
  // and lightness gentle so text stays readable.
  const hue = Math.round(t * 120);
  return `hsl(${hue} 70% 82%)`;
}

// SE PE pricing reference rows ("High end SS - SE PE pricing", etc.)
// aren't real deals; they're floor/ceiling benchmarks. Bold them so
// they read as reference lines.
function isBenchmarkRow(company) {
  if (!company) return false;
  return /\bse pe pricing\b/i.test(company);
}

// Parse tab- or comma-separated text from Excel. Expected order:
// Company / Annual Load EP / Fee EP / RFPs / (Total Fee EP — ignored) /
// Annual Load NG / Fee NG / (Total Fee NG — ignored).
function parseRowsFromText(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*/);
    const cell = (i) => (cols[i] ?? '').trim();
    out.push({
      company: cell(0),
      loadEp: cell(1),
      feeEp: cell(2),
      rfps: cell(3),
      // cell(4) is the source workbook's Total Fee EP — recomputed below
      loadNg: cell(5),
      feeNg: cell(6),
      // cell(7) is the source workbook's Total Fee NG — recomputed below
    });
  }
  return out;
}

function CellInput({ value, onCommit, align, placeholder }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  return (
    <input
      type="text"
      className={styles.input}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      value={draft}
      placeholder={placeholder || ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== initial) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

export function BrokerFeesTab({ rows, setRows }) {
  // First-time visit (rows === null/undefined) → show the historical
  // seed. An explicitly-saved empty array still wins, so a user who
  // hits Clear doesn't get the seed re-shoved back in.
  const safeRows = Array.isArray(rows) ? (rows.length ? rows : Array.from({ length: 12 }, EMPTY_ROW)) : SEED_ROWS();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');
  // Column sort is a view-only overlay. Click a header to cycle
  // unsorted → ascending → descending → unsorted. The underlying
  // rows array stays in its persisted order so updateRow / removeRow
  // hit the right cell after a sort.
  const [sortConfig, setSortConfig] = useState(null);

  const updateRow = (idx, key, value) => {
    const next = safeRows.slice();
    next[idx] = { ...next[idx], [key]: value };
    setRows(next);
  };
  const addRow = () => setRows([...safeRows, EMPTY_ROW()]);
  const removeRow = (idx) => {
    const next = safeRows.slice();
    next.splice(idx, 1);
    setRows(next.length ? next : [EMPTY_ROW()]);
  };
  const replaceRows = (newRows) => {
    const padded = newRows.length < 12
      ? newRows.concat(Array.from({ length: 12 - newRows.length }, EMPTY_ROW))
      : newRows;
    setRows(padded);
  };
  const clearAll = () => {
    const hasData = safeRows.some(r => r.company || r.loadEp || r.feeEp || r.rfps || r.loadNg || r.feeNg);
    if (!hasData) {
      setRows(Array.from({ length: 12 }, EMPTY_ROW));
      return;
    }
    if (window.confirm('Clear all broker-fee rows? This cannot be undone.')) {
      setRows(Array.from({ length: 12 }, EMPTY_ROW));
    }
  };

  function handleTablePaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text) return;
    const looksTabular = text.includes('\t') || text.includes('\n');
    if (!looksTabular) return;
    e.preventDefault();
    e.stopPropagation();
    const parsed = parseRowsFromText(text);
    if (!parsed.length) return;
    replaceRows(parsed);
    setFlash(`Pasted ${parsed.length} row${parsed.length === 1 ? '' : 's'}.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  // Aggregates across non-empty rows. Per-commodity totals power the
  // summary cards; the weighted-average fee divides total revenue by
  // total load so a small high-rate row can't skew it.
  let epLoadSum = 0;
  let epFeeRevSum = 0;
  let ngLoadSum = 0;
  let ngFeeRevSum = 0;
  let totalRfps = 0;
  for (const r of safeRows) {
    const tEp = totalFee(r.loadEp, r.feeEp);
    if (tEp != null) { epFeeRevSum += tEp; epLoadSum += toNum(r.loadEp) || 0; }
    const tNg = totalFee(r.loadNg, r.feeNg);
    if (tNg != null) { ngFeeRevSum += tNg; ngLoadSum += toNum(r.loadNg) || 0; }
    const rfps = toNum(r.rfps);
    if (rfps != null) totalRfps += rfps;
  }
  const epWeightedRate = epLoadSum > 0 ? epFeeRevSum / epLoadSum : null;
  const ngWeightedRate = ngLoadSum > 0 ? ngFeeRevSum / ngLoadSum : null;

  // Per-column min/max for the heatmap shading. Only numeric values
  // contribute, so blanks stay neutral.
  function rangeOf(values) {
    const nums = values.map(toNum).filter(v => v != null);
    if (!nums.length) return { min: null, max: null };
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }
  const loadEpRange = rangeOf(safeRows.map(r => r.loadEp));
  const feeEpRange  = rangeOf(safeRows.map(r => r.feeEp));
  const loadNgRange = rangeOf(safeRows.map(r => r.loadNg));
  const feeNgRange  = rangeOf(safeRows.map(r => r.feeNg));

  // Sortable column accessor. Returns the value the sorter should
  // compare on — numeric for load / fee / RFP / total columns,
  // lowercased string for company. Total columns sort on the
  // computed load × fee, not on whatever's stored.
  function sortValueFor(row, key) {
    switch (key) {
      case 'company': return String(row.company || '').toLowerCase();
      case 'loadEp':  return toNum(row.loadEp);
      case 'feeEp':   return toNum(row.feeEp);
      case 'rfps':    return toNum(row.rfps);
      case 'totalEp': return totalFee(row.loadEp, row.feeEp);
      case 'loadNg':  return toNum(row.loadNg);
      case 'feeNg':   return toNum(row.feeNg);
      case 'totalNg': return totalFee(row.loadNg, row.feeNg);
      default:        return null;
    }
  }

  // Visible row order. Without a sort, that's just the persisted
  // order. With one, sort a copy by the chosen column — blank cells
  // sink to the bottom regardless of direction so empty padding
  // rows don't shove real data offscreen.
  const indexedRows = safeRows.map((row, idx) => ({ row, idx }));
  let viewRows = indexedRows;
  if (sortConfig?.key) {
    const isAsc = sortConfig.direction === 'asc';
    viewRows = indexedRows.slice().sort((a, b) => {
      const av = sortValueFor(a.row, sortConfig.key);
      const bv = sortValueFor(b.row, sortConfig.key);
      const aEmpty = av == null || av === '';
      const bEmpty = bv == null || bv === '';
      if (aEmpty && bEmpty) return a.idx - b.idx;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return isAsc ? av - bv : bv - av;
      const as = String(av), bs = String(bv);
      return isAsc ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }

  function toggleSort(key) {
    setSortConfig(prev => {
      if (!prev || prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  }

  function sortArrow(key) {
    if (sortConfig?.key !== key) return '';
    return sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
  }

  const sortableHeaderProps = (key, className) => ({
    className,
    onClick: () => toggleSort(key),
    style: { cursor: 'pointer', userSelect: 'none' },
    title: 'Click to sort — click again to reverse, third click clears the sort',
  });

  return (
    <div className={styles.wrapper} onPaste={handleTablePaste}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Close paste' : 'Paste from Excel'}
        </button>
        <button type="button" className={styles.btn} onClick={addRow}>+ Row</button>
        <button
          type="button"
          className={styles.btn}
          title="Replace current rows with the historical benchmark data."
          onClick={() => {
            const hasData = safeRows.some(r => r.company || r.loadEp || r.feeEp || r.rfps || r.loadNg || r.feeNg);
            if (hasData && !window.confirm('Replace current rows with the historical benchmark data?')) return;
            setRows(SEED_ROWS());
            setFlash('Loaded historical defaults.');
            window.setTimeout(() => setFlash(''), 2500);
          }}
        >Load historical defaults</button>
        <button type="button" className={styles.btnDanger} onClick={clearAll}>Clear</button>
        {flash && <span className={styles.flash}>{flash}</span>}
      </div>

      {pasteOpen && (
        <div className={styles.pasteBox}>
          <div className={styles.pasteHint}>
            Tab-separated rows: Company · Annual Load EP (kWh) · Fee EP ($/kWh) · RFPs ·
            (Total Fee EP — ignored, recomputed) · Annual Load NG (Dth) · Fee NG ($/Dth) ·
            (Total Fee NG — ignored).
          </div>
          <textarea
            className={styles.pasteArea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Jamestown\t26,616,828\t$0.00075\t4\t\t25,032\t$0.18\t'}
            rows={5}
          />
          <div className={styles.pasteActions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                const parsed = parseRowsFromText(pasteText);
                if (!parsed.length) return;
                replaceRows(parsed);
                setPasteText('');
                setPasteOpen(false);
                setFlash(`Pasted ${parsed.length} row${parsed.length === 1 ? '' : 's'}.`);
                window.setTimeout(() => setFlash(''), 2500);
              }}
            >Replace rows</button>
            <button type="button" className={styles.btn} onClick={() => { setPasteText(''); setPasteOpen(false); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={styles.gridWrap}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th rowSpan={2} {...sortableHeaderProps('company', styles.colCompany)}>
                Company{sortArrow('company')}
              </th>
              <th colSpan={4} className={styles.epGroup}>Electric Power</th>
              <th colSpan={3} className={styles.ngGroup}>Natural Gas</th>
              <th rowSpan={2} className={styles.actionCol} />
            </tr>
            <tr>
              <th {...sortableHeaderProps('loadEp', `${styles.colLoad} ${styles.numCell} ${styles.epGroup}`)}>
                Annual Deregulated Load (kWh){sortArrow('loadEp')}
              </th>
              <th {...sortableHeaderProps('feeEp', `${styles.colFee} ${styles.numCell} ${styles.epGroup}`)}>
                Broker Fee /kWh{sortArrow('feeEp')}
              </th>
              <th {...sortableHeaderProps('rfps', `${styles.colRfps} ${styles.numCell} ${styles.epGroup}`)}>
                RFPs{sortArrow('rfps')}
              </th>
              <th {...sortableHeaderProps('totalEp', `${styles.colTotal} ${styles.numCell} ${styles.epGroup}`)}>
                Total Fee{sortArrow('totalEp')}
              </th>
              <th {...sortableHeaderProps('loadNg', `${styles.colLoad} ${styles.numCell} ${styles.ngGroup}`)}>
                Annual Load (Dth){sortArrow('loadNg')}
              </th>
              <th {...sortableHeaderProps('feeNg', `${styles.colFee} ${styles.numCell} ${styles.ngGroup}`)}>
                Broker Fee /Dth{sortArrow('feeNg')}
              </th>
              <th {...sortableHeaderProps('totalNg', `${styles.colTotal} ${styles.numCell} ${styles.ngGroup}`)}>
                Total Fee{sortArrow('totalNg')}
              </th>
            </tr>
          </thead>
          <tbody>
            {viewRows.map(({ row, idx }) => {
              const tEp = totalFee(row.loadEp, row.feeEp);
              const tNg = totalFee(row.loadNg, row.feeNg);
              const k = `${idx}-${row.company}-${row.loadEp}-${row.feeEp}-${row.rfps}-${row.loadNg}-${row.feeNg}`;
              const feeEpDisplay = row.feeEp !== '' && row.feeEp != null && toNum(row.feeEp) != null
                ? `$${(toNum(row.feeEp) || 0).toFixed(5)}`
                : (row.feeEp ?? '');
              const feeNgDisplay = row.feeNg !== '' && row.feeNg != null && toNum(row.feeNg) != null
                ? `$${(toNum(row.feeNg) || 0).toFixed(4)}`
                : (row.feeNg ?? '');
              const loadEpNum = toNum(row.loadEp);
              const loadNgNum = toNum(row.loadNg);
              const feeEpNum  = toNum(row.feeEp);
              const feeNgNum  = toNum(row.feeNg);
              // Heatmap shading: larger loads green, smaller red;
              // lower fees green, higher red.
              const loadEpBg = heatmapBg(loadEpNum, loadEpRange.min, loadEpRange.max, 'highGood');
              const feeEpBg  = heatmapBg(feeEpNum,  feeEpRange.min,  feeEpRange.max,  'lowGood');
              const loadNgBg = heatmapBg(loadNgNum, loadNgRange.min, loadNgRange.max, 'highGood');
              const feeNgBg  = heatmapBg(feeNgNum,  feeNgRange.min,  feeNgRange.max,  'lowGood');
              const benchmark = isBenchmarkRow(row.company);
              return (
                <tr key={idx} className={benchmark ? styles.benchmarkRow : ''}>
                  <td className={styles.tan}>
                    <CellInput key={`co-${k}`} value={row.company} onCommit={(v) => updateRow(idx, 'company', v)} />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`} style={loadEpBg ? { background: loadEpBg } : undefined}>
                    <CellInput
                      key={`le-${k}`}
                      value={loadEpNum != null ? loadEpNum.toLocaleString('en-US') : (row.loadEp ?? '')}
                      align="right"
                      onCommit={(v) => updateRow(idx, 'loadEp', v)}
                    />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`} style={feeEpBg ? { background: feeEpBg } : undefined}>
                    <CellInput
                      key={`fe-${k}`}
                      value={feeEpDisplay}
                      align="right"
                      onCommit={(v) => updateRow(idx, 'feeEp', v)}
                    />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`}>
                    <CellInput key={`rf-${k}`} value={row.rfps} align="right" onCommit={(v) => updateRow(idx, 'rfps', v)} />
                  </td>
                  <td className={`${styles.calc} ${styles.numCell}`}>
                    {tEp != null ? fmtMoney(tEp) : ''}
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`} style={loadNgBg ? { background: loadNgBg } : undefined}>
                    <CellInput
                      key={`ln-${k}`}
                      value={loadNgNum != null ? loadNgNum.toLocaleString('en-US') : (row.loadNg ?? '')}
                      align="right"
                      onCommit={(v) => updateRow(idx, 'loadNg', v)}
                    />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`} style={feeNgBg ? { background: feeNgBg } : undefined}>
                    <CellInput
                      key={`fn-${k}`}
                      value={feeNgDisplay}
                      align="right"
                      onCommit={(v) => updateRow(idx, 'feeNg', v)}
                    />
                  </td>
                  <td className={`${styles.calc} ${styles.numCell}`}>
                    {tNg != null ? fmtMoney(tNg, 2) : ''}
                  </td>
                  <td className={styles.actionCell}>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => removeRow(idx)}
                      title="Remove row"
                    >×</button>
                  </td>
                </tr>
              );
            })}
            <tr className={styles.totalsRow}>
              <td style={{ textAlign: 'right' }}>Totals</td>
              <td className={styles.numCell}>{fmtNum(epLoadSum)}</td>
              <td className={styles.numCell}>{epWeightedRate != null ? fmtRate(epWeightedRate, 5) : ''}</td>
              <td className={styles.numCell}>{fmtNum(totalRfps)}</td>
              <td className={styles.numCell}>{fmtMoney(epFeeRevSum)}</td>
              <td className={styles.numCell}>{fmtNum(ngLoadSum)}</td>
              <td className={styles.numCell}>{ngWeightedRate != null ? fmtRate(ngWeightedRate, 4) : ''}</td>
              <td className={styles.numCell}>{fmtMoney(ngFeeRevSum, 2)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
````

### src/components/PricingView/BrokerFeesTab.module.css

````css
.wrapper {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.25rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.intro {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  max-width: 920px;
  line-height: 1.5;
}

.summaryStrip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.summaryCard {
  flex: 1 1 240px;
  min-width: 240px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.summaryHeader {
  background: #f1f5f9;
  padding: 0.45rem 0.75rem;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
}

.summaryGrid {
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: 0.25rem;
  column-gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

.numCell {
  text-align: right;
}

.strong {
  font-weight: 700;
  color: #0f172a;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn {
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.btn:hover {
  border-color: var(--color-accent);
}

.btnDanger {
  padding: 0.4rem 0.7rem;
  border: 1px solid #fecaca;
  border-radius: var(--radius-md);
  background: #fff;
  color: #b91c1c;
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.btnDanger:hover {
  border-color: #ef4444;
  background: #fef2f2;
}

.flash {
  font-size: var(--font-size-xs);
  color: #047857;
  background: #d1fae5;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
}

.pasteBox {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.7rem 0.85rem;
  background: #f8fafc;
}

.pasteHint {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.pasteArea {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--font-size-xs);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.5rem;
  resize: vertical;
}

.pasteActions {
  display: flex;
  gap: 0.5rem;
}

.gridWrap {
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
}

.grid {
  border-collapse: collapse;
  width: 100%;
  table-layout: fixed;
  font-size: var(--font-size-sm);
  background: var(--color-bg);
}

.colCompany { width: 220px; }
.colLoad { width: 140px; }
.colFee { width: 110px; }
.colRfps { width: 70px; }
.colTotal { width: 110px; }
.actionCol { width: 32px; background: #f1f5f9; }

.grid th,
.grid td {
  border: 1px solid #e5e7eb;
  padding: 0;
  vertical-align: middle;
  height: 30px;
}

.grid th {
  background: #f1f5f9;
  text-align: left;
  font-weight: 600;
  font-size: var(--font-size-xs);
  color: #475569;
  padding: 0.35rem 0.55rem;
}

.epGroup {
  background: #ecfdf5;
}

.ngGroup {
  background: #eff6ff;
}

.tan {
  background: #fdf6e3;
}

.calc {
  background: #f9fafb;
  color: var(--color-text);
  padding: 0.35rem 0.55rem;
  font-variant-numeric: tabular-nums;
}

.input {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  padding: 0.35rem 0.5rem;
  font-size: var(--font-size-sm);
  font-family: inherit;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.input:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
  background: #fff;
}

.actionCell {
  text-align: center;
  background: #fff;
}

.removeBtn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  font-family: inherit;
}

.removeBtn:hover {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fef2f2;
}

.totalsRow td {
  background: #e2e8f0;
  font-weight: 600;
  padding: 0.4rem 0.55rem;
  font-variant-numeric: tabular-nums;
}

/* Benchmark rows (e.g. "High end / Low end - SE PE pricing") read as
   reference lines, not real deals — bold so they stand out. */
.benchmarkRow td {
  font-weight: 700;
}
````

### src/components/PricingView/CalculatorTab.jsx

````jsx
import { useCallback, useEffect, useState } from 'react';
import styles from './CalculatorTab.module.css';

// Trim floating-point noise (0.1 + 0.2 → 0.3) and guard against the
// non-finite results a divide-by-zero produces.
const fmt = (n) => {
  if (!Number.isFinite(n)) return 'Error';
  const rounded = Math.round((n + Number.EPSILON) * 1e10) / 1e10;
  return String(rounded);
};

const compute = (a, b, op) => {
  switch (op) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? NaN : a / b;
    default: return b;
  }
};

// A plain four-function calculator. Keeps the classic accumulator / pending
// operator / waiting-for-operand state machine so chained entries
// (e.g. 2 + 3 × 4 =) behave the way a desktop calculator does.
export function CalculatorTab() {
  const [display, setDisplay] = useState('0');
  const [accumulator, setAccumulator] = useState(null);
  const [op, setOp] = useState(null);
  const [waiting, setWaiting] = useState(false);

  // Standalone "multiply one item by another" helper shown beside the
  // calculator. Kept independent of the main calculator's state so the two
  // don't interfere. Inputs stay as free text so partial entries (e.g. a
  // lone "-" or trailing ".") don't get clobbered mid-typing.
  const [mulA, setMulA] = useState('');
  const [mulB, setMulB] = useState('');
  const mulValA = parseFloat(mulA);
  const mulValB = parseFloat(mulB);
  const mulProduct = Number.isFinite(mulValA) && Number.isFinite(mulValB)
    ? mulValA * mulValB
    : null;

  const clearAll = useCallback(() => {
    setDisplay('0');
    setAccumulator(null);
    setOp(null);
    setWaiting(false);
  }, []);

  const inputDigit = useCallback((d) => {
    setDisplay((cur) => {
      if (waiting) return d;
      if (cur === '0' || cur === 'Error') return d;
      if (cur.replace(/[-.]/g, '').length >= 15) return cur; // cap length
      return cur + d;
    });
    if (waiting) setWaiting(false);
  }, [waiting]);

  const inputDot = useCallback(() => {
    setDisplay((cur) => {
      if (waiting || cur === 'Error') return '0.';
      return cur.includes('.') ? cur : cur + '.';
    });
    if (waiting) setWaiting(false);
  }, [waiting]);

  const toggleSign = useCallback(() => {
    setDisplay((cur) => (cur === '0' || cur === 'Error' ? cur : fmt(parseFloat(cur) * -1)));
  }, []);

  const inputPercent = useCallback(() => {
    setDisplay((cur) => (cur === 'Error' ? '0' : fmt(parseFloat(cur) / 100)));
  }, []);

  const backspace = useCallback(() => {
    if (waiting) return;
    setDisplay((cur) => {
      if (cur === 'Error') return '0';
      const next = cur.length > 1 ? cur.slice(0, -1) : '0';
      return next === '-' || next === '' ? '0' : next;
    });
  }, [waiting]);

  const applyOp = useCallback((nextOp) => {
    const value = parseFloat(display);
    if (op != null && !waiting) {
      const result = compute(accumulator, value, op);
      setAccumulator(Number.isFinite(result) ? result : null);
      setDisplay(fmt(result));
    } else {
      setAccumulator(value);
    }
    setWaiting(true);
    setOp(nextOp);
  }, [display, op, waiting, accumulator]);

  const equals = useCallback(() => {
    if (op == null || accumulator == null) return;
    const result = compute(accumulator, parseFloat(display), op);
    setDisplay(fmt(result));
    setAccumulator(null);
    setOp(null);
    setWaiting(true);
  }, [op, accumulator, display]);

  // Keyboard support — calculators are muscle-memory tools, so mirror the
  // on-screen keys to the number row and operators.
  useEffect(() => {
    const onKey = (e) => {
      // Don't hijack typing in the Multiply inputs (or any other field).
      const t = e.target;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      const k = e.key;
      if (k >= '0' && k <= '9') { inputDigit(k); }
      else if (k === '.') { inputDot(); }
      else if (k === '+') { applyOp('+'); }
      else if (k === '-') { applyOp('−'); }
      else if (k === '*') { applyOp('×'); }
      else if (k === '/') { e.preventDefault(); applyOp('÷'); }
      else if (k === 'Enter' || k === '=') { e.preventDefault(); equals(); }
      else if (k === 'Backspace') { backspace(); }
      else if (k === 'Escape') { clearAll(); }
      else if (k === '%') { inputPercent(); }
      else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inputDigit, inputDot, applyOp, equals, backspace, clearAll, inputPercent]);

  const digit = (d) => (
    <button type="button" className={styles.key} onClick={() => inputDigit(d)}>{d}</button>
  );
  const opKey = (symbol) => (
    <button
      type="button"
      className={`${styles.key} ${styles.opKey} ${op === symbol && waiting ? styles.opKeyActive : ''}`}
      onClick={() => applyOp(symbol)}
    >{symbol}</button>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.calc}>
        <div className={styles.display} title={display}>{display}</div>
        <div className={styles.pad}>
          <button type="button" className={`${styles.key} ${styles.fnKey}`} onClick={clearAll}>AC</button>
          <button type="button" className={`${styles.key} ${styles.fnKey}`} onClick={toggleSign}>±</button>
          <button type="button" className={`${styles.key} ${styles.fnKey}`} onClick={inputPercent}>%</button>
          {opKey('÷')}
          {digit('7')}{digit('8')}{digit('9')}{opKey('×')}
          {digit('4')}{digit('5')}{digit('6')}{opKey('−')}
          {digit('1')}{digit('2')}{digit('3')}{opKey('+')}
          <button type="button" className={`${styles.key} ${styles.zeroKey}`} onClick={() => inputDigit('0')}>0</button>
          <button type="button" className={styles.key} onClick={inputDot}>.</button>
          <button type="button" className={`${styles.key} ${styles.eqKey}`} onClick={equals}>=</button>
        </div>
        <div className={styles.hint}>Tip: your keyboard's number and operator keys work here too.</div>
      </div>

      <div className={styles.multiply}>
        <div className={styles.multiplyTitle}>Multiply</div>
        <div className={styles.multiplyBody}>
          <input
            type="text"
            inputMode="decimal"
            className={styles.multiplyInput}
            placeholder="0"
            value={mulA}
            onChange={(e) => setMulA(e.target.value)}
            aria-label="First value"
          />
          <span className={styles.multiplySign}>×</span>
          <input
            type="text"
            inputMode="decimal"
            className={styles.multiplyInput}
            placeholder="0"
            value={mulB}
            onChange={(e) => setMulB(e.target.value)}
            aria-label="Second value"
          />
          <div className={styles.multiplyResult}>
            <span className={styles.multiplyResultLabel}>=</span>
            <span className={styles.multiplyResultValue}>{mulProduct == null ? '—' : fmt(mulProduct)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
````

### src/components/PricingView/CalculatorTab.module.css

````css
.wrap {
  padding: 1.25rem;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
}

.calc {
  width: 100%;
  max-width: 320px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #fff;
  padding: 0.9rem;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
}

.display {
  height: 64px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 0.85rem;
  margin-bottom: 0.75rem;
  font-size: 2rem;
  font-weight: 600;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  white-space: nowrap;
}

.pad {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
}

.key {
  height: 52px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
  font-family: inherit;
  font-size: 1.1rem;
  font-weight: 500;
  color: var(--color-text);
  cursor: pointer;
  user-select: none;
  transition: background 0.1s ease;
}

.key:hover {
  background: #f1f5f9;
}

.key:active {
  background: #e2e8f0;
}

.fnKey {
  background: #f1f5f9;
  color: var(--color-text-muted);
  font-weight: 600;
}

.opKey {
  background: #eef2ff;
  color: #4338ca;
  font-size: 1.25rem;
  font-weight: 700;
}

.opKey:hover {
  background: #e0e7ff;
}

.opKeyActive {
  background: #4338ca;
  color: #fff;
}

.zeroKey {
  grid-column: span 2;
}

.eqKey {
  background: var(--color-accent, #2563eb);
  color: #fff;
  font-weight: 700;
  border-color: var(--color-accent, #2563eb);
}

.eqKey:hover {
  filter: brightness(0.95);
  background: var(--color-accent, #2563eb);
}

.hint {
  margin-top: 0.75rem;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-align: center;
}

/* "Multiply one item by another" helper, sitting beside the calculator. */
.multiply {
  width: 100%;
  max-width: 220px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  overflow: hidden;
  align-self: stretch;
}

.multiplyTitle {
  background: #f1f5f9;
  padding: 0.55rem 0.85rem;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
}

.multiplyBody {
  padding: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.multiplyInput {
  width: 100%;
  box-sizing: border-box;
  height: 44px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fdf6e3;
  padding: 0 0.7rem;
  font-family: inherit;
  font-size: 1.25rem;
  font-weight: 600;
  color: #0f172a;
  text-align: right;
  font-variant-numeric: tabular-nums;
  outline: none;
}

.multiplyInput:focus {
  border-color: var(--color-accent, #2563eb);
  background: #fff;
}

.multiplySign {
  text-align: center;
  font-size: 1.25rem;
  font-weight: 700;
  color: #4338ca;
  line-height: 1;
}

.multiplyResult {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.2rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--color-border);
}

.multiplyResultLabel {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-muted);
}

.multiplyResultValue {
  font-size: 1.4rem;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
````

### src/components/PricingView/CompareTab.jsx

````jsx
import { useEffect, useRef, useState } from 'react';
import { parsePricingWorkbook } from '../../utils/pricingParse';
import styles from './CompareTab.module.css';

// Map a workbook Option's CTS rows into the Compare tab's row shape.
// Fee Bucket pulls the row's resolved Linked To tag (per-row override
// or saved default for its Line Item + Type) so the comparison groups
// by the same buckets the Linked To page wires up. Category is the
// line item description; numeric fields are kept as numbers.
function optionToCompareRows(opt, resolvedLinkedTo) {
  if (!opt || !Array.isArray(opt.sections)) return [];
  const rows = [];
  for (const sec of opt.sections) {
    for (const item of (sec.items || [])) {
      if (typeof item.cts !== 'number') continue;
      const linked = resolvedLinkedTo ? String(resolvedLinkedTo(item) || '').trim() : '';
      rows.push({
        id: newRowId(),
        feeBucket: linked,
        category: item.description || '',
        type: item.type || '',
        cts: item.cts,
        startMonth: item.startMonth ?? '',
      });
    }
  }
  return rows;
}

const TYPE_OPTIONS = ['Setup', 'One Time', 'Recurring (monthly)'];

// Stable per-row id so manual links between Current ↔ New rows survive
// edits / reorders. Rows that came from older state without an id get
// one backfilled on mount (see ensureRowIds below).
const newRowId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* noop */ }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

const EMPTY_ROW = () => ({
  id: newRowId(),
  feeBucket: '', category: '', type: '', cts: '', startMonth: '',
});

const ensureRowIds = (rows) =>
  (Array.isArray(rows) ? rows : []).map(r => (r && r.id ? r : { ...(r || {}), id: newRowId() }));

const fmtMoney = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

const fmtMoneySigned = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const abs = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return abs;
};

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const isRecurring = (t) => (t || '').toLowerCase().startsWith('recurring');
const isSetup = (t) => (t || '').toLowerCase() === 'setup';
const isOneTime = (t) => (t || '').toLowerCase() === 'one time';

// Sum per type for a list of rows. Recurring totals are monthly;
// "annual" multiplies by 12. Setup / One Time are taken at face value
// (a one-shot dollar amount, not a rate).
function summarize(rows) {
  let recurringMonthly = 0;
  let setupTotal = 0;
  let oneTimeTotal = 0;
  for (const r of rows) {
    const v = toNum(r.cts) || 0;
    if (!v) continue;
    if (isRecurring(r.type)) recurringMonthly += v;
    else if (isSetup(r.type)) setupTotal += v;
    else if (isOneTime(r.type)) oneTimeTotal += v;
  }
  return {
    recurringMonthly,
    recurringAnnual: recurringMonthly * 12,
    setupTotal,
    oneTimeTotal,
    firstYear: setupTotal + oneTimeTotal + recurringMonthly * 12,
  };
}

// Parse tab- or comma-separated text from Excel into rows. Columns:
// Fee Bucket / CTS Category / Type / CTS / Start Month. Extra columns
// are ignored.
function parseRowsFromText(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*/);
    const cell = (i) => (cols[i] ?? '').trim();
    out.push({
      id: newRowId(),
      feeBucket: cell(0),
      category: cell(1),
      type: cell(2),
      cts: cell(3),
      startMonth: cell(4),
    });
  }
  return out;
}

// Normalize a category for matching. Lowercase, collapse whitespace,
// strip trailing parens / hyphenated qualifiers so "Foo - Detail" and
// "Foo" land in the same bucket when joining the two sides.
function normalizeCategory(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

function CellInput({ value, onCommit, align, placeholder, title }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  return (
    <input
      type="text"
      className={styles.input}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      value={draft}
      placeholder={placeholder || ''}
      title={title || (draft ? draft : undefined)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== initial) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

function CostTable({ title, rows, otherRows, otherLabel, onChange, onAddRow, onRemoveRow, onReplaceRows, onClear, tone, importOptions, onImportOption, getLinkedOtherId, setLink, clearLink, linkedOtherIds, linkedThisIds, onFileDrop, techDeprPct = 0 }) {
  // Lookup map keyed by category + type so each row compares against
  // the matching row(s) of the same type on the other side. Keying by
  // category alone collapses rows like "Commercial Client Manager"
  // across Setup / Recurring / One Time, which makes every one of
  // them look off by the sum of the others. Multiple rows that share
  // the same (category, type) are still summed under the key — when
  // both sides carry the same set, the sums cancel and the row shows
  // "=" as expected. Rows explicitly tied via the link button are
  // handled separately below and excluded from these sums.
  const compareKey = (r) => `${normalizeCategory(r.category)}||${(r.type || '').trim().toLowerCase()}`;
  const otherById = new Map();
  for (const r of (otherRows || [])) {
    if (r && r.id) otherById.set(r.id, r);
  }
  const otherByKey = new Map();
  for (const r of (otherRows || [])) {
    const cat = normalizeCategory(r.category);
    if (!cat) continue;
    if (linkedOtherIds && linkedOtherIds.has(r.id)) continue; // counted via its link, not auto-match
    const key = compareKey(r);
    const v = toNum(r.cts) || 0;
    otherByKey.set(key, (otherByKey.get(key) || 0) + v);
  }
  // Sum this side's rows the same way so a row's delta is computed
  // against the per-key total on each side — not its own single
  // value against the other side's sum.
  const thisByKey = new Map();
  for (const r of rows) {
    const cat = normalizeCategory(r.category);
    if (!cat) continue;
    if (linkedThisIds && linkedThisIds.has(r.id)) continue;
    const key = compareKey(r);
    const v = toNum(r.cts) || 0;
    thisByKey.set(key, (thisByKey.get(key) || 0) + v);
  }
  // Popover state for the per-row link picker. One open at a time.
  const [linkMenuFor, setLinkMenuFor] = useState(null); // row id whose menu is open
  const [linkFilter, setLinkFilter] = useState('');
  const linkMenuRef = useRef(null);
  useEffect(() => {
    if (!linkMenuFor) return;
    const handler = (e) => {
      if (linkMenuRef.current && !linkMenuRef.current.contains(e.target)) {
        setLinkMenuFor(null);
        setLinkFilter('');
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [linkMenuFor]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const importMenuRef = useRef(null);
  // Highlight state while a file is dragged over this side's panel. Only
  // set for actual file drags (not text / row selections) so hovering a
  // copied cell range doesn't flash the drop hint.
  const [fileDragOver, setFileDragOver] = useState(false);

  const isFileDrag = (e) => {
    const types = e.dataTransfer?.types;
    return !!types && Array.from(types).includes('Files');
  };
  function handleFileDragOver(e) {
    if (!onFileDrop || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!fileDragOver) setFileDragOver(true);
  }
  function handleFileDragLeave(e) {
    if (!onFileDrop) return;
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setFileDragOver(false);
  }
  function handleFileDrop(e) {
    if (!onFileDrop || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onFileDrop(file);
  }

  useEffect(() => {
    if (!importOpen) return;
    const handler = (e) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target)) {
        setImportOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [importOpen]);

  function handleTablePaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text) return;
    const looksTabular = text.includes('\t') || text.includes('\n');
    if (!looksTabular) return;
    e.preventDefault();
    e.stopPropagation();
    const newRows = parseRowsFromText(text);
    if (!newRows.length) return;
    const padded = newRows.length < 10
      ? newRows.concat(Array.from({ length: 10 - newRows.length }, EMPTY_ROW))
      : newRows;
    onReplaceRows(padded);
    setFlash(`Pasted ${newRows.length} row${newRows.length === 1 ? '' : 's'}.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  const totals = summarize(rows);
  // Tech depreciation booked against each cost type's CTS at the rate
  // set on the Pricing subtab (Tech Depr. %). Recurring depr is monthly
  // (matches the recurring total); setup / one-time depr are one-shot.
  const deprPct = typeof techDeprPct === 'number' && techDeprPct > 0 ? techDeprPct : 0;
  const depr = {
    recurringMonthly: totals.recurringMonthly * deprPct,
    setup: totals.setupTotal * deprPct,
    oneTime: totals.oneTimeTotal * deprPct,
  };
  const deprPctLabel = `${(deprPct * 100).toFixed(1)}% of CTS`;
  const cellClass = tone === 'new' ? styles.cellNew : styles.cellCurrent;

  return (
    <div
      className={`${styles.tablePanel} ${fileDragOver ? styles.fileDragOver : ''}`.trim()}
      onPaste={handleTablePaste}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {fileDragOver && (
        <div className={styles.dropOverlay}>
          <div className={styles.dropOverlayText}>
            Drop a pricing workbook to import an Option into “{title}”
          </div>
        </div>
      )}
      <div className={styles.tableHeader}>
        <div className={styles.tableTitle}>{title}</div>
        {importOptions && (
          <div className={styles.importWrap} ref={importMenuRef}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setImportOpen(o => !o)}
              title="Replace these rows with the CTS items from a Pricing Option."
            >
              Import from Option ▾
            </button>
            {importOpen && (
              <div className={styles.importMenu}>
                {importOptions.length === 0 ? (
                  <div className={styles.importMenuEmpty}>No options loaded. Upload a workbook on the Pricing subtab.</div>
                ) : importOptions.map(opt => (
                  <button
                    key={opt.optionNumber}
                    type="button"
                    className={styles.importMenuItem}
                    onClick={() => {
                      const hasData = rows.some(r => r.feeBucket || r.category || r.type || r.cts || r.startMonth);
                      if (hasData && !window.confirm(`Replace the rows in "${title}" with the CTS items from "${opt.sheetName}"?`)) return;
                      onImportOption(opt);
                      setImportOpen(false);
                      setFlash(`Imported from "${opt.sheetName}".`);
                      window.setTimeout(() => setFlash(''), 2500);
                    }}
                  >
                    {opt.sheetName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Close paste' : 'Paste from Excel'}
        </button>
        <button type="button" className={styles.btn} onClick={onAddRow}>+ Row</button>
        <button
          type="button"
          className={styles.btnDanger}
          onClick={() => {
            if (rows.every(r => !r.feeBucket && !r.category && !r.type && !r.cts && !r.startMonth)) {
              onClear();
              return;
            }
            if (window.confirm(`Clear all rows from "${title}"? This cannot be undone.`)) onClear();
          }}
        >Clear</button>
        {flash && <span className={styles.flash}>{flash}</span>}
      </div>

      {pasteOpen && (
        <div className={styles.pasteBox}>
          <div className={styles.pasteHint}>
            Tab-separated rows: Fee Bucket · CTS Category · Type · CTS · Start Month.
            You can also click into the table and paste directly.
          </div>
          <textarea
            className={styles.pasteArea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Sourcing\tElectric Power Origination\tRecurring (monthly)\t$381.00\t1'}
            rows={5}
          />
          <div className={styles.pasteActions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                const newRows = parseRowsFromText(pasteText);
                if (!newRows.length) return;
                const padded = newRows.length < 10
                  ? newRows.concat(Array.from({ length: 10 - newRows.length }, EMPTY_ROW))
                  : newRows;
                onReplaceRows(padded);
                setPasteText('');
                setPasteOpen(false);
                setFlash(`Pasted ${newRows.length} row${newRows.length === 1 ? '' : 's'}.`);
                window.setTimeout(() => setFlash(''), 2500);
              }}
            >Replace rows</button>
            <button type="button" className={styles.btn} onClick={() => { setPasteText(''); setPasteOpen(false); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={styles.gridWrap}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th className={styles.colBucket}>Fee Bucket</th>
              <th className={styles.colCategory}>CTS Category</th>
              <th className={styles.colType}>Type</th>
              <th className={`${styles.colCts} ${styles.numCell}`}>CTS</th>
              <th className={`${styles.colStart} ${styles.numCell}`}>Start Month</th>
              <th className={styles.colCombine} title={`Δ vs the matching row in ${otherLabel || 'the other table'}, or a missing-row marker.`}>Compare</th>
              <th className={styles.actionCol} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const k = `${idx}-${row.feeBucket}-${row.category}-${row.type}-${row.cts}-${row.startMonth}`;
              const cat = normalizeCategory(row.category);
              const rowKey = compareKey(row);
              const linkedOtherId = getLinkedOtherId ? getLinkedOtherId(row.id) : null;
              const linkedOther = linkedOtherId ? otherById.get(linkedOtherId) : null;
              let compareCell;
              if (linkedOther) {
                const thisSum = toNum(row.cts) || 0;
                const otherSum = toNum(linkedOther.cts) || 0;
                const delta = thisSum - otherSum;
                const linkLabel = (linkedOther.category || '').trim() || '(blank)';
                const sign = delta === 0
                  ? <span className={styles.compareMuted}>=</span>
                  : <span className={delta > 0 ? styles.deltaUp : styles.deltaDown}>{fmtMoneySigned(delta)}</span>;
                compareCell = (
                  <span title={`Tied to "${linkLabel}" in ${otherLabel || 'the other table'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span aria-hidden="true" style={{ fontSize: '0.7rem' }}>🔗</span>
                    {sign}
                  </span>
                );
              } else if (!cat) {
                compareCell = <span className={styles.compareMuted}>—</span>;
              } else if (otherByKey.has(rowKey)) {
                const otherSum = otherByKey.get(rowKey) || 0;
                const thisSum = thisByKey.get(rowKey) || 0;
                // Sign convention: positive means THIS side is more
                // expensive than the other. So the more expensive side
                // reads "+$X" (red), the cheaper side reads "−$X"
                // (green) — intuitively "this row costs more / less
                // than its match on the other side".
                const delta = thisSum - otherSum;
                if (delta === 0) {
                  compareCell = <span className={styles.compareMuted}>=</span>;
                } else {
                  compareCell = (
                    <span className={delta > 0 ? styles.deltaUp : styles.deltaDown}>
                      {fmtMoneySigned(delta)}
                    </span>
                  );
                }
              } else {
                compareCell = (
                  <span className={styles.compareMissing} title={`No ${row.type || 'matching'} row with category "${row.category}" found in ${otherLabel || 'the other table'}.`}>
                    Missing in {otherLabel || 'other'}
                  </span>
                );
              }
              // Candidates for the link picker: rows on the other side
              // with at least a category or CTS filled in, that aren't
              // already tied to a different row on this side (so each
              // other-side row only appears in one picker at a time).
              // The currently linked row for THIS picker stays in the
              // list so the user can confirm / re-pick it.
              const candidates = (otherRows || []).filter(r => {
                if (!r || !r.id) return false;
                if (!(r.category || r.feeBucket || r.cts)) return false;
                if (linkedOtherIds && linkedOtherIds.has(r.id) && r.id !== linkedOtherId) return false;
                return true;
              });
              const q = linkFilter.trim().toLowerCase();
              const visibleCandidates = q
                ? candidates.filter(r =>
                    (r.category || '').toLowerCase().includes(q)
                    || (r.feeBucket || '').toLowerCase().includes(q)
                    || (r.type || '').toLowerCase().includes(q))
                : candidates;
              return (
                <tr key={row.id || idx}>
                  <td className={cellClass}>
                    <CellInput key={`fb-${k}`} value={row.feeBucket} onCommit={(v) => onChange(idx, 'feeBucket', v)} />
                  </td>
                  <td className={cellClass}>
                    <CellInput key={`ct-${k}`} value={row.category} onCommit={(v) => onChange(idx, 'category', v)} />
                  </td>
                  <td className={cellClass}>
                    <select
                      className={styles.input}
                      value={row.type || ''}
                      onChange={(e) => onChange(idx, 'type', e.target.value)}
                    >
                      <option value="">—</option>
                      {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                      {row.type && !TYPE_OPTIONS.includes(row.type) && (
                        <option value={row.type}>{row.type}</option>
                      )}
                    </select>
                  </td>
                  <td className={`${cellClass} ${styles.numCell}`}>
                    <CellInput
                      key={`cts-${k}`}
                      value={row.cts !== '' && row.cts != null && toNum(row.cts) != null
                        ? `$${(toNum(row.cts) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : (row.cts ?? '')}
                      align="right"
                      onCommit={(v) => onChange(idx, 'cts', v)}
                    />
                  </td>
                  <td className={`${cellClass} ${styles.numCell}`}>
                    <CellInput key={`sm-${k}`} value={row.startMonth} align="right" onCommit={(v) => onChange(idx, 'startMonth', v)} />
                  </td>
                  <td className={`${cellClass} ${styles.compareCell}`} style={{ position: 'relative' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {compareCell}
                      <button
                        type="button"
                        className={styles.linkBtn}
                        onClick={() => {
                          if (linkMenuFor === row.id) { setLinkMenuFor(null); setLinkFilter(''); }
                          else { setLinkMenuFor(row.id); setLinkFilter(''); }
                        }}
                        title={linkedOther
                          ? `Tied to "${(linkedOther.category || '(blank)').trim()}" in ${otherLabel || 'the other table'}. Click to change or unlink.`
                          : `Tie this row to a specific row in ${otherLabel || 'the other table'}`}
                      >
                        {linkedOther ? '⛓' : '🔗'}
                      </button>
                    </span>
                    {linkMenuFor === row.id && (
                      <div ref={linkMenuRef} className={styles.linkMenu}>
                        <div className={styles.linkMenuHeader}>
                          Tie to a row in {otherLabel || 'the other table'}
                        </div>
                        <input
                          autoFocus
                          value={linkFilter}
                          onChange={(e) => setLinkFilter(e.target.value)}
                          placeholder="Search category, fee bucket, type…"
                          className={styles.linkMenuSearch}
                        />
                        {linkedOther && (
                          <button
                            type="button"
                            className={styles.linkMenuClear}
                            onClick={() => { if (clearLink) clearLink(row.id); setLinkMenuFor(null); setLinkFilter(''); }}
                          >Unlink (currently tied to "{(linkedOther.category || '(blank)').trim()}")</button>
                        )}
                        <div className={styles.linkMenuList}>
                          {visibleCandidates.length === 0 ? (
                            <div className={styles.linkMenuEmpty}>No rows match.</div>
                          ) : visibleCandidates.map(r => {
                            const ctsTxt = toNum(r.cts) != null ? fmtMoney(toNum(r.cts) || 0) : '';
                            const tag = [r.feeBucket, r.type, ctsTxt].filter(Boolean).join(' · ');
                            const isCurrent = linkedOther && linkedOther.id === r.id;
                            return (
                              <button
                                key={r.id}
                                type="button"
                                className={`${styles.linkMenuItem} ${isCurrent ? styles.linkMenuItemActive : ''}`}
                                onClick={() => { if (setLink) setLink(row.id, r.id); setLinkMenuFor(null); setLinkFilter(''); }}
                              >
                                <div className={styles.linkMenuItemTitle}>{(r.category || '').trim() || '(blank category)'}</div>
                                {tag && <div className={styles.linkMenuItemMeta}>{tag}</div>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className={styles.actionCell}>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => onRemoveRow(idx)}
                      title="Remove row"
                    >×</button>
                  </td>
                </tr>
              );
            })}
            <tr className={styles.totalsRow}>
              <td colSpan={3} style={{ textAlign: 'right' }}>Recurring</td>
              <td className={styles.numCell}>{fmtMoney(totals.recurringMonthly)}<span className={styles.unitTag}>/mo</span></td>
              <td colSpan={3} className={styles.deprCell}>
                {deprPct > 0 && totals.recurringMonthly ? (
                  <span className={styles.deprTag} title={`Tech depreciation — ${deprPctLabel}`}>
                    +{fmtMoney(depr.recurringMonthly)} tech depr/mo
                  </span>
                ) : null}
              </td>
            </tr>
            <tr className={styles.totalsRow}>
              <td colSpan={3} style={{ textAlign: 'right' }}>Setup</td>
              <td className={styles.numCell}>{fmtMoney(totals.setupTotal)}</td>
              <td colSpan={3} className={styles.deprCell}>
                {deprPct > 0 && totals.setupTotal ? (
                  <span className={styles.deprTag} title={`Tech depreciation — ${deprPctLabel}`}>
                    +{fmtMoney(depr.setup)} tech depr
                  </span>
                ) : null}
              </td>
            </tr>
            <tr className={styles.totalsRow}>
              <td colSpan={3} style={{ textAlign: 'right' }}>One-time</td>
              <td className={styles.numCell}>{fmtMoney(totals.oneTimeTotal)}</td>
              <td colSpan={3} className={styles.deprCell}>
                {deprPct > 0 && totals.oneTimeTotal ? (
                  <span className={styles.deprTag} title={`Tech depreciation — ${deprPctLabel}`}>
                    +{fmtMoney(depr.oneTime)} tech depr
                  </span>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CompareTab({ state, setState, workbook, resolvedLinkedTo, techDeprPct = 0 }) {
  const importOptions = Array.isArray(workbook?.options) ? workbook.options : [];
  const safe = state && state.current && state.next
    ? state
    : {
        currentLabel: 'Old',
        nextLabel: 'Current',
        current: Array.from({ length: 10 }, EMPTY_ROW),
        next: Array.from({ length: 10 }, EMPTY_ROW),
        links: {},
      };

  // Backfill stable row ids and a links bag once, so legacy saved
  // state immediately supports manual row-to-row tying. Also migrate
  // the previous default labels ("Current" / "New") to the new
  // defaults ("Old" / "Current") so existing users see the rename
  // automatically — user-edited labels are left alone.
  useEffect(() => {
    if (!state || !state.current || !state.next) return;
    const needsIds = state.current.some(r => !r?.id) || state.next.some(r => !r?.id) || !state.links;
    const needsLabelMigration = state.currentLabel === 'Current' && state.nextLabel === 'New';
    if (!needsIds && !needsLabelMigration) return;
    setState({
      ...state,
      current: ensureRowIds(state.current),
      next: ensureRowIds(state.next),
      links: state.links && typeof state.links === 'object' ? state.links : {},
      ...(needsLabelMigration ? { currentLabel: 'Old', nextLabel: 'Current' } : {}),
    });
  }, [state, setState]);

  const update = (next) => setState(next);

  // Drop-to-import: when a pricing workbook is dropped on either side's
  // panel, parse it and open a picker asking which Option tab's costs to
  // pull in. `dropImport` holds { side, fileName, options, error } while
  // the picker is open; null when closed.
  const [dropImport, setDropImport] = useState(null);
  async function handleDroppedFile(side, file) {
    let options = [];
    let error = '';
    try {
      const buf = await file.arrayBuffer();
      const parsed = parsePricingWorkbook(buf);
      options = Array.isArray(parsed?.options) ? parsed.options : [];
      if (!options.length) error = `No “Option 1–5” tabs were found in “${file.name}”.`;
    } catch (err) {
      error = err?.message || `Could not read “${file.name}”.`;
    }
    setDropImport({ side, fileName: file.name, options, error });
  }

  const updateRow = (side) => (idx, key, value) => {
    const rows = safe[side].slice();
    rows[idx] = { ...rows[idx], [key]: value };
    update({ ...safe, [side]: rows });
  };
  const addRow = (side) => () => update({ ...safe, [side]: [...safe[side], EMPTY_ROW()] });
  // Drop any explicit row link that references ids no longer present
  // on either side. Prevents the link map from holding dangling rows
  // after deletions / clears / re-imports.
  const pruneLinks = (links, currentRows, nextRows) => {
    const curIds = new Set((currentRows || []).map(r => r?.id).filter(Boolean));
    const nxtIds = new Set((nextRows || []).map(r => r?.id).filter(Boolean));
    const out = {};
    for (const [cid, nid] of Object.entries(links || {})) {
      if (curIds.has(cid) && nxtIds.has(nid)) out[cid] = nid;
    }
    return out;
  };
  const removeRow = (side) => (idx) => {
    const rows = safe[side].slice();
    rows.splice(idx, 1);
    const finalRows = rows.length ? rows : [EMPTY_ROW()];
    const nextState = { ...safe, [side]: finalRows };
    nextState.links = pruneLinks(safe.links, nextState.current, nextState.next);
    update(nextState);
  };
  const replaceRows = (side) => (rows) => {
    const nextState = { ...safe, [side]: rows };
    nextState.links = pruneLinks(safe.links, nextState.current, nextState.next);
    update(nextState);
  };
  const importOption = (side) => (opt) => {
    const imported = optionToCompareRows(opt, resolvedLinkedTo);
    const padded = imported.length < 10
      ? imported.concat(Array.from({ length: 10 - imported.length }, EMPTY_ROW))
      : imported;
    const nextState = { ...safe, [side]: padded };
    nextState.links = pruneLinks(safe.links, nextState.current, nextState.next);
    update(nextState);
  };
  // Reset a side back to the empty 10-row template (mirrors the
  // initial state so totals + the per-category compare also reset).
  const clearSide = (side) => () => {
    const fresh = Array.from({ length: 10 }, EMPTY_ROW);
    const nextState = { ...safe, [side]: fresh };
    nextState.links = pruneLinks(safe.links, nextState.current, nextState.next);
    update(nextState);
  };

  // Row-link helpers. `links` is keyed by Current row id → Next row id;
  // both setLink callers normalize their (this, other) ids into that
  // canonical orientation. Linking either row replaces any prior link
  // either of them was part of.
  const links = (safe.links && typeof safe.links === 'object') ? safe.links : {};
  const setLinkFor = (side) => (thisId, otherId) => {
    if (!thisId || !otherId) return;
    const currentId = side === 'current' ? thisId : otherId;
    const nextId = side === 'current' ? otherId : thisId;
    const out = {};
    for (const [cid, nid] of Object.entries(links)) {
      if (cid === currentId) continue;
      if (nid === nextId) continue;
      out[cid] = nid;
    }
    out[currentId] = nextId;
    update({ ...safe, links: out });
  };
  const clearLinkFor = (side) => (thisId) => {
    if (!thisId) return;
    const out = {};
    for (const [cid, nid] of Object.entries(links)) {
      if (side === 'current' && cid === thisId) continue;
      if (side === 'next' && nid === thisId) continue;
      out[cid] = nid;
    }
    update({ ...safe, links: out });
  };
  const linkedFromCurrent = new Map(Object.entries(links));
  const linkedFromNext = new Map();
  for (const [cid, nid] of Object.entries(links)) linkedFromNext.set(nid, cid);
  const getLinkedOtherIdFor = (side) => (thisId) => {
    if (!thisId) return null;
    return side === 'current' ? (linkedFromCurrent.get(thisId) || null) : (linkedFromNext.get(thisId) || null);
  };
  const linkedCurrentIds = new Set(linkedFromCurrent.keys());
  const linkedNextIds = new Set(linkedFromNext.keys());

  const currentTotals = summarize(safe.current);
  const nextTotals = summarize(safe.next);

  // Build a side-by-side comparison: every distinct CTS Category that
  // appears on either side becomes a row, paired with its monthly
  // recurring on each side (the dominant cost type for these tables).
  // Explicit row links collapse a Current row + a New row into a
  // single entry (labeled with the New side's category, falling back
  // to Current's) regardless of category text. Unlinked rows still
  // match by normalized category as before.
  const compareRows = (() => {
    const byKey = new Map();
    const keyFor = (s) => normalizeCategory(s);
    const ensure = (key, displayLabel) => {
      if (!byKey.has(key)) {
        byKey.set(key, { key, label: displayLabel, oldMonthly: 0, newMonthly: 0, oldSetup: 0, newSetup: 0 });
      } else if (displayLabel && !byKey.get(key).label) {
        byKey.get(key).label = displayLabel;
      }
      return byKey.get(key);
    };
    const currentById = new Map(safe.current.map(r => [r?.id, r]).filter(([id]) => id));
    const nextById = new Map(safe.next.map(r => [r?.id, r]).filter(([id]) => id));
    // Linked pairs first — each pair gets its own synthetic key so the
    // two rows always roll up together even if their categories differ.
    for (const [cid, nid] of Object.entries(links)) {
      const cur = currentById.get(cid);
      const nxt = nextById.get(nid);
      if (!cur && !nxt) continue;
      const label = (nxt?.category || cur?.category || '').trim() || '(blank)';
      const ent = ensure(`__link__:${cid}|${nid}`, label);
      const cv = toNum(cur?.cts) || 0;
      const nv = toNum(nxt?.cts) || 0;
      if (cur) {
        if (isRecurring(cur.type)) ent.oldMonthly += cv; else ent.oldSetup += cv;
      }
      if (nxt) {
        if (isRecurring(nxt.type)) ent.newMonthly += nv; else ent.newSetup += nv;
      }
    }
    for (const r of safe.current) {
      if (r && r.id && linkedCurrentIds.has(r.id)) continue;
      const cat = (r.category || '').trim();
      if (!cat) continue;
      const v = toNum(r.cts) || 0;
      const ent = ensure(keyFor(cat), cat);
      if (isRecurring(r.type)) ent.oldMonthly += v;
      else ent.oldSetup += v;
    }
    for (const r of safe.next) {
      if (r && r.id && linkedNextIds.has(r.id)) continue;
      const cat = (r.category || '').trim();
      if (!cat) continue;
      const v = toNum(r.cts) || 0;
      const ent = ensure(keyFor(cat), cat);
      if (isRecurring(r.type)) ent.newMonthly += v;
      else ent.newSetup += v;
    }
    const list = Array.from(byKey.values()).map(e => ({
      ...e,
      deltaMonthly: e.newMonthly - e.oldMonthly,
      deltaSetup: e.newSetup - e.oldSetup,
    }));
    list.sort((a, b) => Math.abs(b.deltaMonthly) - Math.abs(a.deltaMonthly));
    return list;
  })();

  const deltaMonthly = nextTotals.recurringMonthly - currentTotals.recurringMonthly;
  const deltaSetup = (nextTotals.setupTotal + nextTotals.oneTimeTotal) - (currentTotals.setupTotal + currentTotals.oneTimeTotal);

  return (
    <div className={styles.wrapper}>
      <div className={styles.intro}>
        Compare two cost-to-serve scenarios side by side. Paste blocks from Excel into the
        {' '}{safe.currentLabel} and {safe.nextLabel} tables — totals, per-category deltas, and
        a first-year roll-up update as you edit. Each row's <strong>Compare</strong> column shows
        the delta vs the matching row on the other side, or a missing-row marker when the
        category isn't there. Click the 🔗 icon to manually tie a row to a specific row on the
        other side when the categories don't match exactly. You can also <strong>drag &amp; drop
        a pricing workbook</strong> (the same file you drop on the Pricing subtab) onto either
        table — you'll be asked which Option tab's costs to import.
      </div>

      <div className={styles.labelRow}>
        <label className={styles.miniField}>
          Left label
          <input
            value={safe.currentLabel}
            onChange={(e) => update({ ...safe, currentLabel: e.target.value })}
          />
        </label>
        <label className={styles.miniField}>
          Right label
          <input
            value={safe.nextLabel}
            onChange={(e) => update({ ...safe, nextLabel: e.target.value })}
          />
        </label>
      </div>

      <div className={styles.summaryStrip}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryHeader}>{safe.currentLabel}</div>
          <div className={styles.summaryGrid}>
            <div>Recurring</div><div className={styles.numCell}>{fmtMoney(currentTotals.recurringMonthly)}<span className={styles.unitTag}>/mo</span></div>
            <div>Annualized</div><div className={styles.numCell}>{fmtMoney(currentTotals.recurringAnnual)}</div>
            <div>Setup + One-time</div><div className={styles.numCell}>{fmtMoney(currentTotals.setupTotal + currentTotals.oneTimeTotal)}</div>
            <div>Year 1 total</div><div className={styles.numCell}>{fmtMoney(currentTotals.firstYear)}</div>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryHeader}>{safe.nextLabel}</div>
          <div className={styles.summaryGrid}>
            <div>Recurring</div><div className={styles.numCell}>{fmtMoney(nextTotals.recurringMonthly)}<span className={styles.unitTag}>/mo</span></div>
            <div>Annualized</div><div className={styles.numCell}>{fmtMoney(nextTotals.recurringAnnual)}</div>
            <div>Setup + One-time</div><div className={styles.numCell}>{fmtMoney(nextTotals.setupTotal + nextTotals.oneTimeTotal)}</div>
            <div>Year 1 total</div><div className={styles.numCell}>{fmtMoney(nextTotals.firstYear)}</div>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryHeader}>Delta ({safe.nextLabel} − {safe.currentLabel})</div>
          <div className={styles.summaryGrid}>
            <div>Recurring</div>
            <div className={`${styles.numCell} ${deltaMonthly > 0 ? styles.deltaUp : deltaMonthly < 0 ? styles.deltaDown : ''}`}>
              {fmtMoneySigned(deltaMonthly)}<span className={styles.unitTag}>/mo</span>
            </div>
            <div>Annualized</div>
            <div className={`${styles.numCell} ${deltaMonthly > 0 ? styles.deltaUp : deltaMonthly < 0 ? styles.deltaDown : ''}`}>
              {fmtMoneySigned(deltaMonthly * 12)}
            </div>
            <div>Setup + One-time</div>
            <div className={`${styles.numCell} ${deltaSetup > 0 ? styles.deltaUp : deltaSetup < 0 ? styles.deltaDown : ''}`}>
              {fmtMoneySigned(deltaSetup)}
            </div>
            <div>Year 1 total</div>
            <div className={`${styles.numCell} ${(nextTotals.firstYear - currentTotals.firstYear) > 0 ? styles.deltaUp : (nextTotals.firstYear - currentTotals.firstYear) < 0 ? styles.deltaDown : ''}`}>
              {fmtMoneySigned(nextTotals.firstYear - currentTotals.firstYear)}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.tablesRow}>
        <CostTable
          title={safe.currentLabel}
          tone="current"
          rows={safe.current}
          otherRows={safe.next}
          otherLabel={safe.nextLabel}
          onChange={updateRow('current')}
          onAddRow={addRow('current')}
          onRemoveRow={removeRow('current')}
          onReplaceRows={replaceRows('current')}
          onClear={clearSide('current')}
          importOptions={importOptions}
          onImportOption={importOption('current')}
          getLinkedOtherId={getLinkedOtherIdFor('current')}
          setLink={setLinkFor('current')}
          clearLink={clearLinkFor('current')}
          linkedThisIds={linkedCurrentIds}
          linkedOtherIds={linkedNextIds}
          onFileDrop={(file) => handleDroppedFile('current', file)}
          techDeprPct={techDeprPct}
        />
        <CostTable
          title={safe.nextLabel}
          tone="new"
          rows={safe.next}
          otherRows={safe.current}
          otherLabel={safe.currentLabel}
          onChange={updateRow('next')}
          onAddRow={addRow('next')}
          onRemoveRow={removeRow('next')}
          onReplaceRows={replaceRows('next')}
          onClear={clearSide('next')}
          importOptions={importOptions}
          onImportOption={importOption('next')}
          getLinkedOtherId={getLinkedOtherIdFor('next')}
          setLink={setLinkFor('next')}
          clearLink={clearLinkFor('next')}
          linkedThisIds={linkedNextIds}
          linkedOtherIds={linkedCurrentIds}
          onFileDrop={(file) => handleDroppedFile('next', file)}
          techDeprPct={techDeprPct}
        />
      </div>

      <div className={styles.compareBlock}>
        <div className={styles.compareHeader}>
          Per-category comparison
          <span className={styles.compareHint}>
            Sorted by largest monthly delta. Matched by CTS Category text, plus any pairs you
            tied manually with the 🔗 icon.
          </span>
        </div>
        <div className={styles.compareTableWrap}>
          <table className={styles.compareTable}>
            <thead>
              <tr>
                <th>CTS Category</th>
                <th className={styles.numCell}>{safe.currentLabel} /mo</th>
                <th className={styles.numCell}>{safe.nextLabel} /mo</th>
                <th className={styles.numCell}>Δ /mo</th>
                <th className={styles.numCell}>Δ Annual</th>
                <th className={styles.numCell}>{safe.currentLabel} Setup</th>
                <th className={styles.numCell}>{safe.nextLabel} Setup</th>
                <th className={styles.numCell}>Δ Setup</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.length === 0 && (
                <tr><td colSpan={8} className={styles.empty}>Add or paste rows above to populate the comparison.</td></tr>
              )}
              {compareRows.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className={styles.numCell}>{r.oldMonthly ? fmtMoney(r.oldMonthly) : '—'}</td>
                  <td className={styles.numCell}>{r.newMonthly ? fmtMoney(r.newMonthly) : '—'}</td>
                  <td className={`${styles.numCell} ${r.deltaMonthly > 0 ? styles.deltaUp : r.deltaMonthly < 0 ? styles.deltaDown : ''}`}>
                    {r.deltaMonthly ? fmtMoneySigned(r.deltaMonthly) : '—'}
                  </td>
                  <td className={`${styles.numCell} ${r.deltaMonthly > 0 ? styles.deltaUp : r.deltaMonthly < 0 ? styles.deltaDown : ''}`}>
                    {r.deltaMonthly ? fmtMoneySigned(r.deltaMonthly * 12) : '—'}
                  </td>
                  <td className={styles.numCell}>{r.oldSetup ? fmtMoney(r.oldSetup) : '—'}</td>
                  <td className={styles.numCell}>{r.newSetup ? fmtMoney(r.newSetup) : '—'}</td>
                  <td className={`${styles.numCell} ${r.deltaSetup > 0 ? styles.deltaUp : r.deltaSetup < 0 ? styles.deltaDown : ''}`}>
                    {r.deltaSetup ? fmtMoneySigned(r.deltaSetup) : '—'}
                  </td>
                </tr>
              ))}
              {compareRows.length > 0 && (
                <tr className={styles.compareTotalsRow}>
                  <td>Totals</td>
                  <td className={styles.numCell}>{fmtMoney(currentTotals.recurringMonthly)}</td>
                  <td className={styles.numCell}>{fmtMoney(nextTotals.recurringMonthly)}</td>
                  <td className={`${styles.numCell} ${deltaMonthly > 0 ? styles.deltaUp : deltaMonthly < 0 ? styles.deltaDown : ''}`}>{fmtMoneySigned(deltaMonthly)}</td>
                  <td className={`${styles.numCell} ${deltaMonthly > 0 ? styles.deltaUp : deltaMonthly < 0 ? styles.deltaDown : ''}`}>{fmtMoneySigned(deltaMonthly * 12)}</td>
                  <td className={styles.numCell}>{fmtMoney(currentTotals.setupTotal + currentTotals.oneTimeTotal)}</td>
                  <td className={styles.numCell}>{fmtMoney(nextTotals.setupTotal + nextTotals.oneTimeTotal)}</td>
                  <td className={`${styles.numCell} ${deltaSetup > 0 ? styles.deltaUp : deltaSetup < 0 ? styles.deltaDown : ''}`}>{fmtMoneySigned(deltaSetup)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {dropImport && (
        <div className={styles.modalOverlay} onMouseDown={() => setDropImport(null)}>
          <div className={styles.modalCard} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>
              Import costs into “{dropImport.side === 'current' ? safe.currentLabel : safe.nextLabel}”
            </div>
            <div className={styles.modalSub}>
              From <strong>{dropImport.fileName}</strong> — choose which Option tab to import the CTS costs from.
            </div>
            {dropImport.error ? (
              <div className={styles.modalError}>{dropImport.error}</div>
            ) : (
              <div className={styles.modalList}>
                {dropImport.options.map(opt => (
                  <button
                    key={opt.optionNumber}
                    type="button"
                    className={styles.modalItem}
                    onClick={() => {
                      const targetRows = dropImport.side === 'current' ? safe.current : safe.next;
                      const targetLabel = dropImport.side === 'current' ? safe.currentLabel : safe.nextLabel;
                      const hasData = targetRows.some(r => r.feeBucket || r.category || r.type || r.cts || r.startMonth);
                      if (hasData && !window.confirm(`Replace the rows in “${targetLabel}” with the CTS items from “${opt.sheetName}”?`)) return;
                      importOption(dropImport.side)(opt);
                      setDropImport(null);
                    }}
                  >
                    <span className={styles.modalItemTitle}>{opt.sheetName}</span>
                    <span className={styles.modalItemMeta}>
                      {(opt.sections || []).reduce((n, s) => n + (s.items ? s.items.filter(i => typeof i.cts === 'number').length : 0), 0)} CTS rows
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className={styles.modalActions}>
              <button type="button" className={styles.btn} onClick={() => setDropImport(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
````

### src/components/PricingView/CompareTab.module.css

````css
.wrapper {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.25rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.intro {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  max-width: 920px;
  line-height: 1.5;
}

.labelRow {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.miniField {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.miniField input {
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-family: inherit;
  width: 12rem;
}

.summaryStrip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.summaryCard {
  flex: 1 1 240px;
  min-width: 240px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.summaryHeader {
  background: #f1f5f9;
  padding: 0.45rem 0.75rem;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
}

.summaryGrid {
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: 0.25rem;
  column-gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
}

.unitTag {
  margin-left: 0.25rem;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.deltaUp { color: #b91c1c; font-weight: 600; }
.deltaDown { color: #047857; font-weight: 600; }

.tablesRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.75rem;
}

@media (max-width: 1100px) {
  .tablesRow {
    grid-template-columns: 1fr;
  }
}

.tablePanel {
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.fileDragOver {
  border-color: var(--color-accent, #2563eb);
  box-shadow: 0 0 0 2px var(--color-accent, #2563eb) inset;
}

.dropOverlay {
  position: absolute;
  inset: 0;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(37, 99, 235, 0.08);
  border-radius: 8px;
  pointer-events: none;
}

.dropOverlayText {
  background: #fff;
  border: 1px dashed var(--color-accent, #2563eb);
  border-radius: var(--radius-md);
  padding: 0.6rem 1rem;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-accent, #2563eb);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  text-align: center;
  max-width: 90%;
}

.tableHeader {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  background: #f8fafc;
  flex-wrap: wrap;
}

.tableTitle {
  font-size: var(--font-size-md);
  font-weight: 600;
  margin-right: auto;
}

.btn {
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.btn:hover {
  border-color: var(--color-accent);
}

.btnDanger {
  padding: 0.35rem 0.65rem;
  border: 1px solid #fecaca;
  border-radius: var(--radius-md);
  background: #fff;
  color: #b91c1c;
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.btnDanger:hover {
  border-color: #ef4444;
  background: #fef2f2;
}

.flash {
  font-size: var(--font-size-xs);
  color: #047857;
  background: #d1fae5;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
}

.importWrap {
  position: relative;
}

.importMenu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 0.25rem;
  z-index: 20;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  min-width: 180px;
  max-width: 320px;
  padding: 0.2rem 0;
}

.importMenuItem {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.7rem;
  font-size: var(--font-size-xs);
  background: transparent;
  border: none;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  color: var(--color-text);
}

.importMenuItem:hover {
  background: var(--color-bg-soft, #f3f4f6);
}

.importMenuEmpty {
  padding: 0.5rem 0.7rem;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-style: italic;
}

.pasteBox {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-bottom: 1px solid var(--color-border);
  padding: 0.7rem 0.85rem;
  background: #f8fafc;
}

.pasteHint {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.pasteArea {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--font-size-xs);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.5rem;
  resize: vertical;
}

.pasteActions {
  display: flex;
  gap: 0.5rem;
}

.gridWrap {
  overflow: auto;
}

.grid {
  border-collapse: collapse;
  width: 100%;
  table-layout: fixed;
  font-size: var(--font-size-sm);
  background: var(--color-bg);
}

.colBucket { width: 130px; }
.colCategory { width: 180px; }
.colType { width: 140px; }
.colCts { width: 90px; }
.colStart { width: 80px; }
.colCombine { width: 130px; }
.actionCol { width: 32px; background: #f1f5f9; }

.grid th,
.grid td {
  border: 1px solid #e5e7eb;
  padding: 0;
  vertical-align: middle;
  height: 30px;
}

.grid th {
  background: #f1f5f9;
  text-align: left;
  font-weight: 600;
  font-size: var(--font-size-xs);
  color: #475569;
  padding: 0.35rem 0.55rem;
}

.cellCurrent {
  background: #fdf6e3; /* tan, mirroring the Excel "Current" side */
}

.cellNew {
  background: #e7f1ff; /* light blue for the "New" side */
}

.numCell {
  text-align: right;
}

.input {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  padding: 0.35rem 0.5rem;
  font-size: var(--font-size-sm);
  font-family: inherit;
  color: var(--color-text);
}

.input:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
  background: #fff;
}

.actionCell {
  text-align: center;
  background: #fff;
}

.removeBtn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  font-family: inherit;
}

.removeBtn:hover {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fef2f2;
}

.totalsRow td {
  background: #e2e8f0;
  font-weight: 600;
  padding: 0.4rem 0.55rem;
  font-variant-numeric: tabular-nums;
}

.deprCell {
  text-align: left;
  white-space: nowrap;
}

.deprTag {
  font-weight: 500;
  font-size: var(--font-size-xs);
  color: #6d28d9;
}

.compareBlock {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.compareHeader {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.55rem 0.85rem;
  background: #f1f5f9;
  border-bottom: 1px solid var(--color-border);
  font-weight: 600;
  font-size: var(--font-size-sm);
  flex-wrap: wrap;
}

.compareHint {
  font-weight: 400;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.compareTableWrap {
  overflow: auto;
}

.compareTable {
  border-collapse: collapse;
  width: 100%;
  font-size: var(--font-size-sm);
}

.compareTable th,
.compareTable td {
  border-bottom: 1px solid #f1f5f9;
  padding: 0.4rem 0.75rem;
  font-variant-numeric: tabular-nums;
  vertical-align: middle;
}

.compareTable th {
  background: #f8fafc;
  text-align: left;
  font-weight: 600;
  font-size: var(--font-size-xs);
  color: #475569;
  border-bottom: 1px solid var(--color-border);
}

.compareTable th.numCell,
.compareTable td.numCell {
  text-align: right;
}

.compareTotalsRow td {
  background: #e2e8f0;
  font-weight: 600;
  border-top: 1px solid var(--color-border);
}

.empty {
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  padding: 1rem;
}

.compareCell {
  text-align: right;
  font-variant-numeric: tabular-nums;
  padding: 0.35rem 0.55rem;
  font-size: var(--font-size-xs);
}

.compareMuted {
  color: var(--color-text-muted);
}

.compareMissing {
  color: #b91c1c;
  font-weight: 600;
  background: #fef2f2;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  font-size: 0.7rem;
}

.linkBtn {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: #475569;
  cursor: pointer;
  font-size: 0.72rem;
  line-height: 1;
  padding: 0;
  font-family: inherit;
}

.linkBtn:hover {
  border-color: #cbd5e1;
  background: #f1f5f9;
}

.linkMenu {
  position: absolute;
  top: calc(100% + 2px);
  right: 0;
  z-index: 30;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  padding: 0.4rem;
  width: 280px;
  max-width: 90vw;
  text-align: left;
}

.linkMenuHeader {
  font-size: 0.68rem;
  font-weight: 600;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 0.2rem 0.3rem;
}

.linkMenuSearch {
  width: 100%;
  padding: 0.3rem 0.45rem;
  font-size: 0.78rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  margin-bottom: 0.35rem;
}

.linkMenuClear {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.3rem 0.45rem;
  margin-bottom: 0.35rem;
  font-size: 0.72rem;
  font-family: inherit;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.linkMenuClear:hover {
  background: #fee2e2;
}

.linkMenuList {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.linkMenuItem {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.35rem 0.45rem;
  font-size: 0.78rem;
  font-family: inherit;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--color-text);
}

.linkMenuItem:hover {
  background: #f1f5f9;
}

.linkMenuItemActive {
  background: #dbeafe;
}

.linkMenuItemTitle {
  font-weight: 600;
}

.linkMenuItemMeta {
  font-size: 0.68rem;
  color: var(--color-text-muted);
  margin-top: 1px;
}

.linkMenuEmpty {
  padding: 0.5rem 0.45rem;
  font-size: 0.72rem;
  color: var(--color-text-muted);
  font-style: italic;
}

.modalOverlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.modalCard {
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.28);
  width: 420px;
  max-width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modalTitle {
  padding: 0.85rem 1rem 0.35rem;
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--color-text);
}

.modalSub {
  padding: 0 1rem 0.75rem;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  line-height: 1.5;
  border-bottom: 1px solid var(--color-border);
}

.modalError {
  padding: 0.85rem 1rem;
  font-size: var(--font-size-sm);
  color: #b91c1c;
}

.modalList {
  overflow-y: auto;
  padding: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.modalItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  text-align: left;
  padding: 0.55rem 0.7rem;
  font-family: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.modalItem:hover {
  background: #f1f5f9;
  border-color: var(--color-border);
}

.modalItemTitle {
  font-weight: 600;
}

.modalItemMeta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}

.modalActions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--color-border);
}
````

### src/components/PricingView/OptionsTab.jsx

````jsx
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { dbGet } from '../../utils/db';
import {
  loadOptionLinks,
  setOppOptionLink,
  renameOptionInLinks,
  dropOptionFromLinks,
  OPTION_LINKS_EVENT,
} from '../../utils/pricingOptionLinks';
import { buildPricingOptionSnapshot } from '../../utils/pricingOptionCalc';
import {
  setOppPricingSnapshot,
  clearOppPricingSnapshot,
} from '../../utils/oppsPricingSnapshot';
import { sortByCallInAsc, resolveCallIn, callInDateISO, formatDateDisplay } from '../../utils/oppsCallIn';
import styles from './OptionsTab.module.css';

const TYPE_OPTIONS = ['Setup', 'One Time', 'Recurring (monthly)'];
const UNIT_OPTIONS = ['Per Site', 'Per Account', 'Per Meter', 'Per User', 'Fixed'];
const MAX_YEARS = 5;
const EMPTY_ROW = () => ({
  feeSchedule: '', type: '', fee: '', unit: '', unitCount: '', startMonth: '',
});

function emptyOption(idx) {
  return {
    name: `Option ${idx + 1}`,
    years: 3,
    escPct: 4,
    rows: Array.from({ length: 12 }, EMPTY_ROW),
  };
}

const fmtMoneyWhole = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Est. Unit Count column treats a blank entry as 1 so a row with just a
// fee still produces revenue. An explicit 0 is honored.
const unitCountOrOne = (v) => {
  const n = toNum(v);
  return n == null ? 1 : n;
};

// Months a row is billed inside the requested year (1-indexed),
// honoring the contract length. One-time and Setup hit a single
// month (the start month); Recurring bills every month from start
// through the end of the contract.
function activeMonthsInYear(row, yearIdx, termYears) {
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
  // Setup / One Time -> single hit at startMonth
  return startMonth >= yStart && startMonth <= yEnd ? 1 : 0;
}

// Per-year revenue for a single row, applying the annual escalator
// to the year the revenue is collected in (Year 1 = base).
function rowYearRevenue(row, yearIdx, termYears, escPct) {
  const months = activeMonthsInYear(row, yearIdx, termYears);
  if (!months) return 0;
  const fee = toNum(row.fee) || 0;
  const uc = unitCountOrOne(row.unitCount);
  const esc = Math.pow(1 + (escPct || 0) / 100, yearIdx - 1);
  return fee * uc * months * esc;
}

// Revenue billed by a single row in a specific contract month
// (1-indexed, where 1..12 = Year 1). Setup / One Time hits only the
// row's start month; Recurring bills every month from its start
// through the end of the contract, with the escalator applied to the
// year the revenue lands in.
function rowMonthRevenue(row, month, termYears, escPct) {
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

// Parse tab- or comma-separated text from Excel into rows.
function parseRowsFromText(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*/);
    const cell = (i) => (cols[i] ?? '').trim();
    out.push({
      feeSchedule: cell(0),
      type: cell(1),
      fee: cell(2),
      unit: cell(3),
      unitCount: cell(4),
      startMonth: cell(5),
    });
  }
  return out;
}

function CellInput({ value, onCommit, align, placeholder }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  return (
    <input
      type="text"
      className={styles.input}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      value={draft}
      placeholder={placeholder || ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== initial) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

function OptionPanel({ opt, onChange, savedToLabel, onClickSave, onClearSave }) {
  const [flash, setFlash] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const termYears = Math.max(1, Math.min(MAX_YEARS, Number(opt.years) || 1));
  const esc = Number(opt.escPct) || 0;

  const updateRow = (idx, key, value) => {
    const rows = opt.rows.slice();
    rows[idx] = { ...rows[idx], [key]: value };
    onChange({ ...opt, rows });
  };

  const addRow = () => onChange({ ...opt, rows: [...opt.rows, EMPTY_ROW()] });
  const removeRow = (idx) => {
    const rows = opt.rows.slice();
    rows.splice(idx, 1);
    onChange({ ...opt, rows: rows.length ? rows : [EMPTY_ROW()] });
  };
  // Reset every row and the term / escalator inputs back to defaults
  // while keeping the option's name (so the user's tab labelling
  // survives a Clear).
  const clearOption = () => onChange({
    name: opt.name,
    years: 3,
    escPct: 4,
    rows: Array.from({ length: 12 }, EMPTY_ROW),
  });

  function handleTablePaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text) return;
    const looksTabular = text.includes('\t') || text.includes('\n');
    if (!looksTabular) return;
    e.preventDefault();
    e.stopPropagation();
    const newRows = parseRowsFromText(text);
    if (!newRows.length) return;
    // Pad to at least 12 rows so the empty tan area mimics Excel.
    const padded = newRows.length < 12
      ? newRows.concat(Array.from({ length: 12 - newRows.length }, EMPTY_ROW))
      : newRows;
    onChange({ ...opt, rows: padded });
    setFlash(`Pasted ${newRows.length} row${newRows.length === 1 ? '' : 's'}.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  const yearTotals = Array.from({ length: MAX_YEARS }, (_, i) => {
    const year = i + 1;
    if (year > termYears) return 0;
    return opt.rows.reduce((sum, r) => sum + rowYearRevenue(r, year, termYears, esc), 0);
  });

  // Term value Yn = sum of years 1..n if contract ran for n years.
  // Beyond the configured contract length, the term value is 0.
  const termValues = Array.from({ length: MAX_YEARS }, (_, i) => {
    const t = i + 1;
    if (t > termYears) return 0;
    let sum = 0;
    for (let y = 1; y <= t; y += 1) {
      sum += opt.rows.reduce((s, r) => s + rowYearRevenue(r, y, t, esc), 0);
    }
    return sum;
  });

  const setupTotal = opt.rows
    .filter(r => (r.type || '').toLowerCase() === 'setup')
    .reduce((s, r) => s + (toNum(r.fee) || 0) * unitCountOrOne(r.unitCount), 0);

  // Year 1 monthly fee breakdown (12 numbers + a year-end total). Each
  // entry is the sum across every row in this option for that contract
  // month. Drives the per-month strip below the grid.
  const year1Monthly = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    return opt.rows.reduce((s, r) => s + rowMonthRevenue(r, month, termYears, esc), 0);
  });
  const year1MonthlyTotal = year1Monthly.reduce((s, v) => s + v, 0);

  return (
    <div className={styles.optionPanel} onPaste={handleTablePaste}>
      <div className={styles.optHeader}>
        <input
          className={styles.optName}
          value={opt.name}
          onChange={(e) => onChange({ ...opt, name: e.target.value })}
          placeholder="Option name"
        />
        <label className={styles.miniField}>
          Years
          <input
            type="number"
            min={1}
            max={MAX_YEARS}
            value={opt.years}
            onChange={(e) => onChange({ ...opt, years: Number(e.target.value) || 1 })}
          />
        </label>
        <label className={styles.miniField}>
          Esc %
          <input
            type="number"
            step="0.1"
            value={opt.escPct}
            onChange={(e) => onChange({ ...opt, escPct: Number(e.target.value) || 0 })}
          />
        </label>
        <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Close paste' : 'Paste from Excel'}
        </button>
        <button type="button" className={styles.btn} onClick={addRow}>+ Row</button>
        <button type="button" className={styles.btnDanger} onClick={clearOption}>Clear</button>
        {savedToLabel ? (
          <span
            className={styles.savedChip}
            title={`Linked to Opps row: ${savedToLabel}`}
          >
            Saved to: {savedToLabel}
            <button
              type="button"
              className={styles.savedChipClear}
              onClick={onClearSave}
              title="Unlink from this Opp"
            >×</button>
          </span>
        ) : (
          <button type="button" className={styles.btn} onClick={onClickSave}>
            Save to Opp…
          </button>
        )}
        {flash && <span className={styles.flash}>{flash}</span>}
      </div>

      {pasteOpen && (
        <div className={styles.pasteBox}>
          <div className={styles.pasteHint}>
            Tab-separated rows: Fee Schedule · Type · Fee · Unit · Est. Unit Count · Fee Start Month.
            You can also just click into the table and paste — multi-row clipboard data is auto-detected.
          </div>
          <textarea
            className={styles.pasteArea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'BPS Per Site Year 1\tOne Time\t$850.00\tPer Site\t26\t1\nBenchmarking\tRecurring (monthly)\t$50.00\tPer Site\t51\t1'}
            rows={5}
          />
          <div className={styles.pasteActions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                const newRows = parseRowsFromText(pasteText);
                if (!newRows.length) return;
                const padded = newRows.length < 12
                  ? newRows.concat(Array.from({ length: 12 - newRows.length }, EMPTY_ROW))
                  : newRows;
                onChange({ ...opt, rows: padded });
                setPasteText('');
                setPasteOpen(false);
                setFlash(`Pasted ${newRows.length} row${newRows.length === 1 ? '' : 's'}.`);
                window.setTimeout(() => setFlash(''), 2500);
              }}
            >
              Replace rows
            </button>
            <button type="button" className={styles.btn} onClick={() => { setPasteText(''); setPasteOpen(false); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={styles.summary}>
        <div className={styles.summaryBlock}>
          <div className={styles.summaryHeader}>Total Contract Value</div>
          <table className={styles.summaryTable}>
            <tbody>
              {termValues.map((v, i) => {
                const t = i + 1;
                return (
                  <tr key={`tv-${i}`} className={t > termYears ? styles.dim : ''}>
                    <td>Year {t}</td>
                    <td className={styles.numCell}>{fmtMoneyWhole(v)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.summaryBlock}>
          <div className={styles.summaryHeader}>Setup &amp; Year Breakdown</div>
          <table className={styles.summaryTable}>
            <tbody>
              <tr>
                <td>Setup</td>
                <td className={styles.numCell}>{fmtMoneyWhole(setupTotal)}</td>
              </tr>
              {Array.from({ length: termYears }, (_, i) => (
                <tr key={`yb-${i}`}>
                  <td>Year {i + 1}</td>
                  <td className={styles.numCell}>{fmtMoneyWhole(yearTotals[i] || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.gridWrap}>
        <table className={styles.grid}>
          <colgroup>
            <col className={styles.colFeeSchedule} />
            <col className={styles.colType} />
            <col className={styles.colFee} />
            <col className={styles.colUnit} />
            <col className={styles.colUnitCount} />
            <col className={styles.colStartMonth} />
            {Array.from({ length: MAX_YEARS }, (_, i) => (
              <col key={`yc-${i}`} className={styles.colYear} />
            ))}
            <col className={styles.colAction} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.colInput}>Fee Schedule</th>
              <th className={styles.colInput}>Type</th>
              <th className={styles.colInput}>Fee</th>
              <th className={styles.colInput}>Unit</th>
              <th className={styles.colInput}>Est. Unit Count</th>
              <th className={styles.colInput}>Fee Start Month</th>
              {Array.from({ length: MAX_YEARS }, (_, i) => (
                <th key={`yh-${i}`} className={styles.colCalc}>{`Year ${i + 1}`}</th>
              ))}
              <th className={styles.actionCol} />
            </tr>
          </thead>
          <tbody>
            {opt.rows.map((row, idx) => {
              const yearVals = Array.from({ length: MAX_YEARS }, (_, i) =>
                rowYearRevenue(row, i + 1, termYears, esc)
              );
              const rowKey = `${idx}-${row.feeSchedule}-${row.type}-${row.fee}-${row.unit}-${row.unitCount}-${row.startMonth}`;
              const startMonthEmpty = !row.startMonth && row.startMonth !== 0;
              return (
                <tr key={idx}>
                  <td className={styles.tan}>
                    <CellInput key={`fs-${rowKey}`} value={row.feeSchedule} onCommit={(v) => updateRow(idx, 'feeSchedule', v)} />
                  </td>
                  <td className={styles.tan}>
                    <select
                      className={styles.input}
                      value={row.type || ''}
                      onChange={(e) => updateRow(idx, 'type', e.target.value)}
                    >
                      <option value="">—</option>
                      {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={styles.tan}>
                    <CellInput
                      key={`fee-${rowKey}`}
                      value={row.fee !== '' && row.fee != null && !Number.isNaN(toNum(row.fee))
                        ? `$${(toNum(row.fee) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : (row.fee ?? '')}
                      onCommit={(v) => updateRow(idx, 'fee', v)}
                    />
                  </td>
                  <td className={styles.tan}>
                    <select
                      className={styles.input}
                      value={row.unit || ''}
                      onChange={(e) => updateRow(idx, 'unit', e.target.value)}
                    >
                      <option value="">—</option>
                      {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                      {row.unit && !UNIT_OPTIONS.includes(row.unit) && (
                        <option value={row.unit}>{row.unit}</option>
                      )}
                    </select>
                  </td>
                  <td className={styles.tan}>
                    <CellInput key={`uc-${rowKey}`} value={row.unitCount} onCommit={(v) => updateRow(idx, 'unitCount', v)} />
                  </td>
                  <td className={`${styles.tan} ${startMonthEmpty && (row.feeSchedule || row.type || row.fee) ? styles.missingStart : ''}`}>
                    <CellInput key={`sm-${rowKey}`} value={row.startMonth} onCommit={(v) => updateRow(idx, 'startMonth', v)} />
                  </td>
                  {yearVals.map((v, i) => (
                    <td key={`yv-${idx}-${i}`} className={styles.calc}>
                      {v ? fmtMoneyWhole(v) : '$0'}
                    </td>
                  ))}
                  <td className={styles.actionCell}>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => removeRow(idx)}
                      title="Remove row"
                    >×</button>
                  </td>
                </tr>
              );
            })}
            <tr className={styles.totalsRow}>
              <td colSpan={6}>Year totals</td>
              {yearTotals.map((v, i) => (
                <td key={`yt-${i}`}>{fmtMoneyWhole(v)}</td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className={styles.monthlyBlock}>
        <div className={styles.monthlyHeader}>Year 1 monthly total fees</div>
        <div className={styles.gridWrap}>
          <table className={styles.monthlyTable}>
            <thead>
              <tr>
                {Array.from({ length: 12 }, (_, i) => (
                  <th key={`mh-${i}`}>{`M${i + 1}`}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                {year1Monthly.map((v, i) => (
                  <td key={`mv-${i}`}>{fmtMoneyWhole(v)}</td>
                ))}
                <td className={styles.monthlyTotal}>{fmtMoneyWhole(year1MonthlyTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function OptionsTab({ options, setOptions }) {
  const { user } = useAuth();
  const list = options && options.length ? options : [emptyOption(0)];
  const [activeIdx, setActiveIdx] = useState(0);
  const safeIdx = Math.min(activeIdx, list.length - 1);
  const opt = list[safeIdx];

  // Opps 2 records (for the picker) and Option ↔ Opp link map. Loaded
  // from IndexedDB on mount and refreshed when either store fires its
  // change event so a save in another tab shows up live here too.
  const [opps2Records, setOpps2Records] = useState([]);
  const [optionLinks, setOptionLinks] = useState({});
  useEffect(() => {
    let cancelled = false;
    dbGet('opps2-cache', 'data')
      .then(val => { if (!cancelled && val && Array.isArray(val.records)) setOpps2Records(val.records); })
      .catch(() => {});
    loadOptionLinks().then(val => { if (!cancelled) setOptionLinks(val || {}); });
    const onLinks = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') setOptionLinks(detail);
    };
    window.addEventListener(OPTION_LINKS_EVENT, onLinks);
    return () => {
      cancelled = true;
      window.removeEventListener(OPTION_LINKS_EVENT, onLinks);
    };
  }, []);

  // Which opp (if any) the active option is linked to. Links are keyed
  // by opp id, but we want to display the Account name in the chip.
  const linkedOppId = useMemo(() => {
    const name = (opt?.name || '').trim();
    if (!name) return null;
    for (const [id, v] of Object.entries(optionLinks)) {
      if (v === name) return id;
    }
    return null;
  }, [opt?.name, optionLinks]);
  const linkedOpp = useMemo(() => {
    if (!linkedOppId) return null;
    return opps2Records.find(r => String(r._id) === String(linkedOppId)) || null;
  }, [linkedOppId, opps2Records]);
  const linkedLabel = linkedOpp
    ? `${linkedOpp.Account || '(no Account)'}${linkedOpp.Scope ? ` · ${linkedOpp.Scope}` : ''}`
    : (linkedOppId ? `(opp ${linkedOppId})` : null);

  // Note: the snapshot is intentionally frozen at "Save to Opp" time
  // (see `onPickOpp` below) — it doesn't auto-refresh as the user keeps
  // editing the option. The user can re-click Save to Opp to capture a
  // fresh snapshot, which guarantees the opp's saved fees survive a
  // Pricing-tab Clear or accidental row wipe.

  const updateOpt = (next) => {
    const copy = list.slice();
    copy[safeIdx] = next;
    setOptions(copy);
    // Keep the link map in sync when the user renames an option so the
    // "Pricing Option" column on Opps 2 doesn't strand on the old name.
    const prevName = (opt?.name || '').trim();
    const nextName = (next?.name || '').trim();
    if (prevName && nextName && prevName !== nextName) {
      renameOptionInLinks(prevName, nextName).catch(() => {});
    }
  };

  const addOption = () => {
    const next = [...list, emptyOption(list.length)];
    setOptions(next);
    setActiveIdx(next.length - 1);
  };

  const removeOption = (idx) => {
    const removed = list[idx];
    if (removed?.name) dropOptionFromLinks(removed.name).catch(() => {});
    if (list.length <= 1) {
      setOptions([emptyOption(0)]);
      setActiveIdx(0);
      return;
    }
    const next = list.slice();
    next.splice(idx, 1);
    setOptions(next);
    if (safeIdx >= next.length) setActiveIdx(next.length - 1);
  };

  const [pickerOpen, setPickerOpen] = useState(false);
  // While the snapshot is being persisted (IDB + Firestore) we keep the
  // picker open so the user can't navigate away mid-flight and miss the
  // Firestore write (which would let Opps 2's next hydration overwrite
  // the IDB snapshot with a pre-write Firestore copy).
  const [saving, setSaving] = useState(false);
  const openPicker = () => {
    if (!(opt?.name || '').trim()) {
      // Linking by name only makes sense once the option has one.
      window.alert('Give this Option a name before saving it to an Opp.');
      return;
    }
    setPickerOpen(true);
  };
  const onClearSave = async () => {
    if (!linkedOppId) return;
    try {
      await setOppOptionLink(linkedOppId, '');
      // Also drop the frozen snapshot that was saved onto the opp so the
      // Opps 2 row stops rendering the rich detail / Year 1 link.
      await clearOppPricingSnapshot(user?.uid, linkedOppId);
    } catch (err) {
      console.error('Save to Opp: clear failed', err);
    }
  };
  const onPickOpp = async (oppId) => {
    if (saving) return;
    const name = (opt?.name || '').trim();
    setSaving(true);
    try {
      await setOppOptionLink(oppId, name);
      // Freeze a self-contained copy of this option onto the opp so it
      // survives a Pricing-tab Clear. Also auto-fills Quoted Amount with
      // Year 1 total — the user can write over it later. Await both so
      // the Firestore write completes before the picker closes (and
      // before the user can navigate to Opps 2).
      if (opt) {
        const snapshot = buildPricingOptionSnapshot(opt);
        await setOppPricingSnapshot(user?.uid, oppId, snapshot);
      }
      setPickerOpen(false);
    } catch (err) {
      console.error('Save to Opp: snapshot save failed', err);
      window.alert(
        'Saved the link, but the Pricing Option snapshot failed to save to Firestore. ' +
        'Year 1 fees and the saved details may not appear on the Opp. Check your network and try again.\n\n' +
        (err?.message || String(err))
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.intro}>
        Build pricing scenarios in an Excel-style grid. Edit the tan input cells, or paste a
        block from Excel — Year 1–{MAX_YEARS} revenue, Total Contract Value, and the Setup /
        Year breakdown all recompute automatically.
      </div>
      <div className={styles.optTabStrip}>
        {list.map((o, i) => (
          <button
            key={i}
            type="button"
            className={i === safeIdx ? styles.optTabActive : styles.optTab}
            onClick={() => setActiveIdx(i)}
          >
            <span>{o.name || `Option ${i + 1}`}</span>
            {list.length > 1 && (
              <span
                className={styles.optTabClose}
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); removeOption(i); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeOption(i); } }}
                title="Remove option"
              >×</span>
            )}
          </button>
        ))}
        <button type="button" className={styles.optAddBtn} onClick={addOption}>+ Option</button>
      </div>
      <OptionPanel
        opt={opt}
        onChange={updateOpt}
        savedToLabel={linkedLabel}
        onClickSave={openPicker}
        onClearSave={onClearSave}
      />
      {pickerOpen && (
        <OppPickerModal
          opps={opps2Records}
          optionName={opt?.name || ''}
          onPick={onPickOpp}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

export function OppPickerModal({ opps, optionName, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ranked = (opps || [])
      .map(r => ({
        r,
        // The picker is keyed on what the user sees in Opps 2 — Account
        // for "who", Scope/Stage for "which deal". Other fields stay
        // out of the search corpus so a typo in Notes can't pull
        // unrelated opps to the top.
        hay: `${r.Account || ''}  ${r.Scope || ''}  ${r.Stage || ''}  ${r.Source || ''}  ${r['BFO Link'] || ''}`.toLowerCase(),
      }))
      .filter(({ r, hay }) => !!(r.Account || r.Scope) && (!q || hay.includes(q)))
      .map(({ r }) => r);
    // Order the same way the Opps 2 page does — Call In ascending, so the
    // most urgent (most overdue) opps sit at the top — instead of A→Z by
    // Account. Predictive filtering above still narrows the list first.
    return sortByCallInAsc(ranked).slice(0, 200);
  }, [opps, query]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, padding: '1rem 1.1rem',
          width: 'min(560px, 92vw)', maxHeight: '80vh', display: 'flex',
          flexDirection: 'column', gap: '0.75rem', boxShadow: '0 20px 60px rgba(15,23,42,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>
            Save "{optionName || 'Option'}" to an Opp
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: '1.2rem', color: '#64748b',
            }}
          >×</button>
        </div>
        <input
          autoFocus
          type="text"
          placeholder="Search Opps by Account, Scope, Stage…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            padding: '0.5rem 0.65rem', border: '1px solid var(--color-border, #cbd5e1)',
            borderRadius: 6, fontSize: '0.9rem', fontFamily: 'inherit',
          }}
        />
        <div style={{ overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '0.75rem', color: '#64748b', fontSize: '0.85rem' }}>
              {opps.length === 0
                ? 'No Opps rows found in this browser. Open the Opps tab first to load them.'
                : 'No matches.'}
            </div>
          ) : filtered.map(r => (
            <button
              key={r._id}
              type="button"
              onClick={() => onPick(r._id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                gap: 2, width: '100%', textAlign: 'left', padding: '0.5rem 0.7rem',
                border: 'none', borderBottom: '1px solid #f1f5f9', background: '#fff',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{r.Account || '—'}</span>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {(() => {
                  const iso = callInDateISO(r);
                  const days = resolveCallIn(r);
                  if (!iso) return 'Call in: —';
                  const when = typeof days === 'number' && Number.isFinite(days)
                    ? ` (${days === 0 ? 'today' : days > 0 ? `in ${days}d` : `${-days}d ago`})`
                    : '';
                  return `Call in: ${formatDateDisplay(iso)}${when}`;
                })()}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {[r.Scope, r.Stage, r.Source].filter(Boolean).join(' · ') || 'No Scope / Stage'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
````

### src/components/PricingView/OptionsTab.module.css

````css
.wrapper {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.25rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.intro {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  max-width: 920px;
  line-height: 1.5;
}

.optTabStrip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0;
}

.optTab,
.optTabActive {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  border-top-left-radius: 6px;
  border-top-right-radius: 6px;
  font-family: inherit;
  position: relative;
  top: 1px;
}

.optTab:hover {
  background: #f1f5f9;
  color: #334155;
}

.optTabActive {
  background: var(--color-bg);
  color: var(--color-text);
  font-weight: 600;
  border-color: var(--color-border);
  border-bottom-color: var(--color-bg);
}

.optTabClose {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 14px;
  line-height: 1;
  color: #94a3b8;
}

.optTabClose:hover {
  background: #e2e8f0;
  color: #b91c1c;
}

.optAddBtn {
  margin-left: 0.25rem;
  padding: 0.3rem 0.6rem;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
}

.optAddBtn:hover {
  border-color: var(--color-accent);
  color: var(--color-text);
}

.optionPanel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.optHeader {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.optName {
  font-size: var(--font-size-md);
  font-weight: 600;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0.25rem 0.4rem;
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  min-width: 140px;
}

.optName:hover,
.optName:focus {
  border-color: var(--color-border);
  background: #fff;
  outline: none;
}

.miniField {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.miniField input {
  width: 4.2rem;
  padding: 0.3rem 0.45rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-family: inherit;
  text-align: left;
}

.btn {
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.btn:hover {
  border-color: var(--color-accent);
}

.btnDanger {
  padding: 0.4rem 0.7rem;
  border: 1px solid #fecaca;
  border-radius: var(--radius-md);
  background: #fff;
  color: #b91c1c;
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.btnDanger:hover {
  border-color: #ef4444;
  background: #fef2f2;
}

.flash {
  font-size: var(--font-size-xs);
  color: #047857;
  background: #d1fae5;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
}

.savedChip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--font-size-xs);
  color: #1e3a8a;
  background: #dbeafe;
  border: 1px solid #93c5fd;
  padding: 0.2rem 0.45rem 0.2rem 0.65rem;
  border-radius: 999px;
}

.savedChipClear {
  border: none;
  background: transparent;
  color: #1e3a8a;
  cursor: pointer;
  font-size: 1em;
  line-height: 1;
  padding: 0 2px;
}

.savedChipClear:hover {
  color: #b91c1c;
}

.pasteBox {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.7rem 0.85rem;
  background: #f8fafc;
}

.pasteHint {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.pasteArea {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--font-size-xs);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.5rem;
  resize: vertical;
}

.pasteActions {
  display: flex;
  gap: 0.5rem;
}

.gridWrap {
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
}

.grid {
  border-collapse: collapse;
  width: auto;
  table-layout: fixed;
  font-size: var(--font-size-sm);
  background: var(--color-bg);
}

/* Per-column widths sized to header / typical content + a bit of
   breathing room. The grid is `width: auto` + `table-layout: fixed`,
   so these widths set the actual rendered column sizes. */
.colFeeSchedule { width: 160px; }
.colType { width: 150px; }
.colFee { width: 90px; }
.colUnit { width: 110px; }
.colUnitCount { width: 110px; }
.colStartMonth { width: 120px; }
.colYear { width: 95px; }
.colAction { width: 32px; }

.grid th,
.grid td {
  border: 1px solid #e5e7eb;
  padding: 0;
  vertical-align: middle;
  height: 30px;
}

.grid th {
  background: #f1f5f9;
  text-align: left;
  font-weight: 600;
  font-size: var(--font-size-xs);
  color: #475569;
  padding: 0.35rem 0.55rem;
}

.colInput {
  background: #f8fafc;
}

.colCalc {
  background: #eef2ff;
}

.tan {
  background: #fdf6e3;
}

.calc {
  background: #f9fafb;
  color: var(--color-text);
  padding: 0.35rem 0.55rem;
  font-variant-numeric: tabular-nums;
}

.numCell {
  text-align: left;
}

.missingStart {
  background: #fee2e2 !important;
}

.input {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  padding: 0.35rem 0.5rem;
  font-size: var(--font-size-sm);
  font-family: inherit;
  color: var(--color-text);
}

.input:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
  background: #fff;
}

.actionCol {
  width: 28px;
  background: #f1f5f9;
}

.actionCell {
  text-align: center;
  background: #fff;
}

.removeBtn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  font-family: inherit;
}

.removeBtn:hover {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fef2f2;
}

.totalsRow td {
  background: #e2e8f0;
  font-weight: 600;
  padding: 0.4rem 0.55rem;
  font-variant-numeric: tabular-nums;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.summaryBlock {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
  min-width: 240px;
  flex: 1 1 240px;
  max-width: 360px;
  overflow: hidden;
}

.summaryHeader {
  background: #f1f5f9;
  padding: 0.45rem 0.75rem;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
}

.summaryTable {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.summaryTable td {
  padding: 0.35rem 0.75rem;
  border-bottom: 1px solid #f1f5f9;
  font-variant-numeric: tabular-nums;
}

.summaryTable tr:last-child td {
  border-bottom: none;
}

.summaryTable .dim {
  color: #94a3b8;
}

.monthlyBlock {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.monthlyHeader {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
}

.monthlyTable {
  border-collapse: collapse;
  width: auto;
  font-size: var(--font-size-sm);
  background: var(--color-bg);
}

.monthlyTable th,
.monthlyTable td {
  border: 1px solid #e5e7eb;
  padding: 0.35rem 0.55rem;
  text-align: left;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.monthlyTable th {
  background: #f1f5f9;
  font-weight: 600;
  font-size: var(--font-size-xs);
  color: #475569;
}

.monthlyTable td {
  background: #f9fafb;
}

.monthlyTotal {
  background: #e2e8f0 !important;
  font-weight: 600;
}
````

### src/components/PricingView/PricingConversions.jsx

````jsx
import { useState } from 'react';
import styles from './PricingConversions.module.css';

const fmtMoney = (n, dp = 2) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp });
};

const fmtPct = (n, dp = 1) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(dp)}%`;
};

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// The pricing model above folds a 4% tech-depreciation uplift into every
// non-pass-through cost (PricingView: cts × (1 + techDeprPct), techDeprPct
// = 0.04). These quick conversions mirror that assumption so a cost typed
// here lands on the same revenue / margin the full model would produce.
const COST_UPLIFT = 0.04;
const upCost = (c) => (c == null ? null : c * (1 + COST_UPLIFT));

// Editable number cell. Local-draft so re-renders don't fight typing;
// commits on blur / Enter.
function NumInput({ value, onChange, prefix, suffix, width = '6rem' }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  return (
    <span className={styles.numInputWrap} style={{ width }}>
      {prefix && <span className={styles.affix}>{prefix}</span>}
      <input
        type="text"
        className={styles.numInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = toNum(draft);
          onChange(n);
          setDraft(n == null ? '' : String(n));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
        }}
      />
      {suffix && <span className={styles.affix}>{suffix}</span>}
    </span>
  );
}

function Card({ title, children }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{title}</div>
      <div className={styles.cardBody}>{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{children}</span>
    </div>
  );
}

function Output({ children, strong }) {
  return <span className={`${styles.output} ${strong ? styles.outputStrong : ''}`}>{children}</span>;
}

// Muted helper line — shows the derived value (e.g. the +4% adjusted cost)
// that feeds the card's real outputs, so the assumption stays visible.
function HintRow({ label, children }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.hintValue}>{children}</span>
    </div>
  );
}

export function PricingConversions() {
  // Each calculator owns its own little state. Sensible defaults that
  // match the worked example values from the request so the panel
  // shows the right answers on first open.
  const [c1Cost, setC1Cost] = useState(4960);
  const [c1Gm, setC1Gm] = useState(45);

  const [c2Rev, setC2Rev] = useState(4000);
  const [c2Gm, setC2Gm] = useState(50);

  const [c3Cost, setC3Cost] = useState(1500);
  const [c3Rev, setC3Rev] = useState(3000);

  const [c4Rev, setC4Rev] = useState(4688);
  const [c4Cost, setC4Cost] = useState(1500);

  const [c5Start, setC5Start] = useState(1500);
  const [c5End, setC5End] = useState(4687.56);

  const [open, setOpen] = useState(true);

  // Costs are bumped 4% before every calculation to match the pricing
  // model above (tech-depreciation uplift). The adjusted figure is shown
  // on its own muted line so the assumption stays transparent.

  // 1) Cost + GM% -> Revenue (monthly) and Annual Retail (Revenue * 12)
  const c1CostAdj = upCost(c1Cost);
  const c1Revenue = c1CostAdj != null && c1Gm != null && c1Gm < 100
    ? c1CostAdj / (1 - c1Gm / 100)
    : null;
  const c1Annual = c1Revenue != null ? c1Revenue * 12 : null;

  // 2) Revenue (annual) + GM% -> Annual Cost and Monthly Cost. The derived
  //    cost is uplifted 4%, so it reflects the same higher cost the model
  //    books rather than the bare GM-implied figure.
  const c2BaseAnnualCost = c2Rev != null && c2Gm != null
    ? c2Rev * (1 - c2Gm / 100)
    : null;
  const c2AnnualCost = upCost(c2BaseAnnualCost);
  const c2MonthlyCost = c2AnnualCost != null ? c2AnnualCost / 12 : null;

  // 3) Cost + Revenue -> GM%
  const c3CostAdj = upCost(c3Cost);
  const c3Gm = c3CostAdj != null && c3Rev != null && c3Rev !== 0
    ? (c3Rev - c3CostAdj) / c3Rev
    : null;

  // 4) Revenue + Cost -> GM% (same math, kept as a separate card per
  //    the request — different ordering of inputs is what users will
  //    actually have in front of them).
  const c4CostAdj = upCost(c4Cost);
  const c4Gm = c4Rev != null && c4CostAdj != null && c4Rev !== 0
    ? (c4Rev - c4CostAdj) / c4Rev
    : null;

  // 5) Starting + Ending -> % Increase
  const c5Increase = c5Start != null && c5End != null && c5Start !== 0
    ? (c5End - c5Start) / c5Start
    : null;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen(o => !o)}
        title={open ? 'Hide quick conversions' : 'Show quick conversions'}
      >
        <span className={styles.caret}>{open ? '▾' : '▸'}</span>
        Quick conversions
      </button>
      {open && (
        <>
        <div className={styles.caption}>
          Cost figures assume a 4% higher cost (tech-depreciation uplift), matching the pricing model above.
        </div>
        <div className={styles.cards}>
          <Card title="Cost → Revenue (with GM%)">
            <Row label="Cost"><NumInput value={c1Cost} onChange={setC1Cost} prefix="$" /></Row>
            <HintRow label="Cost +4%">{fmtMoney(c1CostAdj)}</HintRow>
            <Row label="Gross Margin"><NumInput value={c1Gm} onChange={setC1Gm} suffix="%" width="5rem" /></Row>
            <Row label="Revenue"><Output>{fmtMoney(c1Revenue)}</Output></Row>
            <Row label="Annual retail"><Output strong>{fmtMoney(c1Annual)}</Output></Row>
          </Card>

          <Card title="Revenue → Cost (with GM%)">
            <Row label="Revenue"><NumInput value={c2Rev} onChange={setC2Rev} prefix="$" /></Row>
            <Row label="Gross Margin"><NumInput value={c2Gm} onChange={setC2Gm} suffix="%" width="5rem" /></Row>
            <HintRow label="Base cost">{fmtMoney(c2BaseAnnualCost)}</HintRow>
            <Row label="Annual cost +4%"><Output>{fmtMoney(c2AnnualCost)}</Output></Row>
            <Row label="Monthly cost +4%"><Output strong>{fmtMoney(c2MonthlyCost)}</Output></Row>
          </Card>

          <Card title="Cost + Revenue → GM%">
            <Row label="Cost"><NumInput value={c3Cost} onChange={setC3Cost} prefix="$" /></Row>
            <HintRow label="Cost +4%">{fmtMoney(c3CostAdj)}</HintRow>
            <Row label="Revenue"><NumInput value={c3Rev} onChange={setC3Rev} prefix="$" /></Row>
            <Row label="Gross Margin"><Output strong>{fmtPct(c3Gm)}</Output></Row>
          </Card>

          <Card title="Revenue + Cost → GM%">
            <Row label="Revenue"><NumInput value={c4Rev} onChange={setC4Rev} prefix="$" /></Row>
            <Row label="Cost"><NumInput value={c4Cost} onChange={setC4Cost} prefix="$" /></Row>
            <HintRow label="Cost +4%">{fmtMoney(c4CostAdj)}</HintRow>
            <Row label="Gross Margin"><Output strong>{fmtPct(c4Gm)}</Output></Row>
          </Card>

          <Card title="Starting → Ending → % Increase">
            <Row label="Starting"><NumInput value={c5Start} onChange={setC5Start} prefix="$" /></Row>
            <Row label="Ending"><NumInput value={c5End} onChange={setC5End} prefix="$" /></Row>
            <Row label="Increase"><Output strong>{fmtPct(c5Increase, 0)}</Output></Row>
          </Card>
        </div>
        </>
      )}
    </div>
  );
}
````

### src/components/PricingView/PricingConversions.module.css

````css
.wrap {
  padding: 0 1.25rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.toggle {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  border: none;
  padding: 0.2rem 0.3rem;
  font-family: inherit;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  cursor: pointer;
}

.toggle:hover {
  color: var(--color-text);
}

.caret {
  font-size: 10px;
  display: inline-block;
  width: 12px;
  text-align: center;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.55rem;
}

.card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cardTitle {
  background: #f1f5f9;
  padding: 0.35rem 0.6rem;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cardBody {
  padding: 0.4rem 0.6rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: var(--font-size-xs);
}

.rowLabel {
  color: var(--color-text-muted);
  white-space: nowrap;
}

.rowValue {
  display: inline-flex;
  align-items: center;
  font-variant-numeric: tabular-nums;
}

.numInputWrap {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: #fdf6e3;
  padding: 0 0.25rem;
  height: 22px;
  overflow: hidden;
}

.numInputWrap:focus-within {
  border-color: var(--color-accent);
  background: #fff;
}

.affix {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  user-select: none;
}

.numInput {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  text-align: right;
  padding: 0 0.2rem;
  font-variant-numeric: tabular-nums;
}

.output {
  font-size: var(--font-size-xs);
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

/* Muted value used for the derived "+4% cost" helper lines so the
   assumption is visible without competing with the real outputs. */
.hintValue {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.caption {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  padding: 0 0.3rem;
  margin: -0.1rem 0 0.1rem;
}

.outputStrong {
  font-weight: 700;
  color: #0f172a;
}
````

### src/components/PricingView/PricingView.jsx

````jsx
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts';
import styles from './PricingView.module.css';
import { useAuth } from '../../contexts/AuthContext';
import { parsePricingWorkbook, priceFromCostAndGm } from '../../utils/pricingParse';
import { dbGet, dbPut, dbDelete } from '../../utils/db';
import { getEffectiveDropdownLists } from '../../utils/dropdownListsStore';
import { OptionsTab, OppPickerModal } from './OptionsTab';
import { PricingConversions } from './PricingConversions';
import { CompareTab } from './CompareTab';
import { BrokerFeesTab } from './BrokerFeesTab';
import { S2CTab } from './S2CTab';
import { CalculatorTab } from './CalculatorTab';
import { buildPricingOptionSnapshot } from '../../utils/pricingOptionCalc';
import { setOppPricingSnapshot } from '../../utils/oppsPricingSnapshot';
import {
  loadOptionLinks,
  setOppOptionLink,
  OPTION_LINKS_EVENT,
} from '../../utils/pricingOptionLinks';

// Local-draft text input keyed off the upstream value. The parent
// remounts the input (via React's `key` prop on the wrapping cell)
// whenever it wants to reset the draft — so this component never has
// to sync internal state to props at runtime.
function GmInput({ initialPct, placeholder, title, isOverride, disabled, onCommit }) {
  const initial = initialPct === null || initialPct === undefined ? '' : String(+initialPct.toFixed(2));
  const [draft, setDraft] = useState(initial);
  return (
    <input
      className={`${styles.cellInput} ${isOverride ? styles.overridden : ''}`}
      type="text"
      placeholder={placeholder}
      value={disabled ? '' : draft}
      title={title}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (!disabled) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

// Multi-checkbox menu for toggling column visibility on a table.
function ColumnsMenu({ open, onToggle, columns, hiddenFn, onItemToggle }) {
  return (
    <div className={styles.colsMenuWrap}>
      <button type="button" className={styles.actionBtn} onClick={onToggle}>
        Columns ▾
      </button>
      {open && (
        <div className={styles.colsMenu}>
          {columns.map(col => (
            <label key={col.key} className={styles.colsMenuItem}>
              <input
                type="checkbox"
                checked={!hiddenFn(col.key)}
                onChange={() => onItemToggle(col.key)}
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Local-draft text cell — commits on blur/Enter so re-renders don't
// fight typing. Pass `listId` to bind the input to a <datalist> for
// dropdown suggestions while still allowing free-text entry.
function CellTextInput({ initial, placeholder, type, align, listId, onCommit, disabled }) {
  const [draft, setDraft] = useState(initial == null ? '' : String(initial));
  return (
    <input
      type={type || 'text'}
      className={styles.altCellInput}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      value={draft}
      placeholder={placeholder || ''}
      list={listId}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial == null ? '' : String(initial)); e.currentTarget.blur(); }
      }}
    />
  );
}

// Parse tab- or comma-separated text into alt-fee rows. Each row is
// expected to have 6 columns matching the table: Item / Type / Fee /
// Unit / UnitCount / StartMonth. Excess columns are ignored, missing
// ones become empty.
function parseAltFeePaste(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*/);
    const cell = (i) => (cols[i] ?? '').trim();
    // Skip a header row pasted alongside the data (e.g. from the
    // built-in Copy button). The first column on a header reads
    // "Alternative Fee…" or "Item" and the second is the literal
    // word "Type".
    if (/^(alternative\s*fee|item)\b/i.test(cell(0)) && /^type$/i.test(cell(1))) continue;
    const feeRaw = cell(2).replace(/[$,\s]/g, '');
    const feeNum = feeRaw === '' ? null : Number(feeRaw);
    const ucNum = Number(cell(4));
    const smNum = Number(cell(5));
    const gmRaw = cell(6).replace('%', '').trim();
    const gmNum = gmRaw === '' ? null : Number(gmRaw);
    const passRaw = cell(7).trim().toLowerCase();
    const passThrough = passRaw === 'yes' || passRaw === 'y' || passRaw === 'true' || passRaw === '1' || passRaw === 'pass' || passRaw === 'pass-through' || passRaw === 'passthrough';
    out.push({
      altItem: cell(0),
      type: cell(1),
      fee: Number.isFinite(feeNum) ? feeNum : null,
      unit: cell(3),
      unitCount: Number.isFinite(ucNum) ? ucNum : cell(4),
      startMonth: cell(5) === '' ? null : (Number.isFinite(smNum) && smNum > 0 ? smNum : null),
      feeGmPct: Number.isFinite(gmNum) ? (gmNum > 1 ? gmNum / 100 : gmNum) : null,
      passThrough,
    });
  }
  return out;
}

function AltFeeTable({ rows, onChange, onAddRow, onMoveRow, onRemoveRow, onReplaceRows, onAppendRows, onClearRows, globalGmPct, marginFor, yearRevenue, autoFeeFor, autoStartMonthFor, siteCount, accountCount, altItemSuggestions = [], costByYear, passThroughByYear, passThroughRevenueByYear, numYears = 1 }) {
  const altItemListId = useId();
  const [dragFrom, setDragFrom] = useState(null); // row currently being dragged
  const [dragOverIdx, setDragOverIdx] = useState(null); // insertion point (0..rows.length)
  function rowDragStart(idx, e) {
    setDragFrom(idx);
    e.dataTransfer.effectAllowed = 'move';
    // Setting payload so Firefox actually fires drag events.
    try { e.dataTransfer.setData('text/plain', String(idx)); } catch { /* ignore */ }
  }
  function rowDragOver(idx, e) {
    if (dragFrom === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const next = before ? idx : idx + 1;
    if (next !== dragOverIdx) setDragOverIdx(next);
  }
  function rowDrop(idx, e) {
    e.preventDefault();
    if (dragFrom === null || !onMoveRow) { setDragFrom(null); setDragOverIdx(null); return; }
    const target = dragOverIdx ?? idx;
    onMoveRow(dragFrom, target);
    setDragFrom(null);
    setDragOverIdx(null);
  }
  function rowDragEnd() {
    setDragFrom(null);
    setDragOverIdx(null);
  }
  // When the user picks Per Site / Per Account, fill Unit Count from
  // the SIA metadata if the cell is still the default placeholder
  // (blank or the seed value of 1).
  function handleUnitChange(idx, row, unit) {
    onChange(idx, 'unit', unit);
    const uc = row.unitCount;
    const isDefault = uc === '' || uc === null || uc === undefined || uc === 1 || uc === '1';
    if (!isDefault) return;
    if (unit === 'Per Site' && typeof siteCount === 'number' && siteCount > 0) {
      onChange(idx, 'unitCount', siteCount);
    } else if (unit === 'Per Account' && typeof accountCount === 'number' && accountCount > 0) {
      onChange(idx, 'unitCount', accountCount);
    }
  }
  const fmtFeeInput = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtMoneyCell = (n) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');
  const parsed = pasteOpen ? parseAltFeePaste(pasteText) : [];

  // TSV (tab-separated) snapshot of the table — data rows only, no
  // header. The Fee column uses the effective fee (manual if present,
  // otherwise the auto-computed marked-up fee from linked CTS rows)
  // so the export reflects what the user sees. Pastes cleanly into
  // Excel and round-trips through the paste box.
  function buildTsv() {
    const lines = [];
    for (const r of rows) {
      const manualFee = Number(r.fee);
      const hasManual = r.fee != null && r.fee !== '' && Number.isFinite(manualFee) && manualFee >= 0;
      const auto = !hasManual && autoFeeFor ? autoFeeFor(r) : null;
      const fee = hasManual ? manualFee : (typeof auto === 'number' ? auto : '');
      const feeCell = typeof fee === 'number' ? fee.toFixed(2) : '';
      const gmCell = typeof r.feeGmPct === 'number' ? (r.feeGmPct * 100).toFixed(1) + '%' : '';
      const manualSm = Number(r.startMonth);
      const hasManualSm = r.startMonth != null && r.startMonth !== '' && Number.isFinite(manualSm) && manualSm > 0;
      const autoSm = !hasManualSm && autoStartMonthFor ? autoStartMonthFor(r) : null;
      const smCell = hasManualSm
        ? r.startMonth
        : (typeof autoSm === 'number' && autoSm > 0 ? autoSm : '');
      lines.push([
        r.altItem || '',
        r.type || '',
        feeCell,
        r.unit || '',
        r.unitCount === '' || r.unitCount == null ? '' : r.unitCount,
        smCell,
        gmCell,
        r.passThrough ? 'yes' : '',
      ].join('\t'));
    }
    return lines.join('\n');
  }

  async function handleCopy() {
    const tsv = buildTsv();
    try {
      await navigator.clipboard.writeText(tsv);
      setFlash(`Copied ${rows.length} row${rows.length === 1 ? '' : 's'} to clipboard — paste into Excel.`);
    } catch {
      // Clipboard API blocked (insecure context, permissions). Fall
      // back to opening the paste box prefilled so the user can copy
      // the text manually.
      setPasteText(tsv);
      setPasteOpen(true);
      setFlash('Clipboard blocked — copy the text below manually.');
    }
    window.setTimeout(() => setFlash(''), 2500);
  }

  // Intercept paste anywhere on the table. If the clipboard text
  // looks like multi-row tabular data (more than one row, or any
  // tabs), parse it and replace the table with the pasted rows.
  // Single-value pastes are left alone so a normal paste into a
  // single cell still works.
  function handleTablePaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text) return;
    const looksTabular = text.includes('\t') || text.includes('\n');
    if (!looksTabular) return; // let the browser paste into the focused input
    e.preventDefault();
    e.stopPropagation();
    const newRows = parseAltFeePaste(text);
    if (newRows.length === 0) return;
    onReplaceRows(newRows);
    setFlash(`Pasted ${newRows.length} row${newRows.length === 1 ? '' : 's'} from clipboard.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  return (
    <div className={styles.altFeeWrap} onPaste={handleTablePaste}>
      <div className={styles.altFeeReminder}>
        Reminder: start with bulk fees to create wiggle room for negotiations.
      </div>
      <h3 className={styles.summaryTitle}>Alternative Fee Structure / Schedule</h3>
      {flash && <div className={styles.pasteFlash}>{flash}</div>}
      <datalist id={altItemListId}>
        {altItemSuggestions.map(opt => <option key={opt} value={opt} />)}
      </datalist>
      <table className={styles.altTable}>
        <thead>
          <tr>
            <th style={{ width: 22 }} title="Drag a row by this handle to reorder." />
            <th style={{ width: 260, whiteSpace: 'nowrap' }}>Alternative Fee Structure/Schedule</th>
            <th style={{ width: 110, whiteSpace: 'nowrap' }}>Type</th>
            <th className={styles.numCell} style={{ width: 95, whiteSpace: 'nowrap' }}>Fee</th>
            <th style={{ width: 100, whiteSpace: 'nowrap' }}>Unit</th>
            <th className={styles.numCell} style={{ width: 95, whiteSpace: 'nowrap' }}>Unit Count</th>
            <th className={styles.numCell} style={{ width: 80, maxWidth: 90 }}>Fee Start Month</th>
            {Array.from({ length: numYears }, (_, i) => (
              <th key={`yh-${i}`} className={styles.numCell} style={{ width: 90 }}>{`Y${i + 1}`}</th>
            ))}
            <th className={styles.numCell} style={{ width: 90 }}>Fee GM%</th>
            <th style={{ width: 100, whiteSpace: 'nowrap' }} title="Bill this fee at face cost (no margin). Revenue still shows in totals but it's excluded from the Deal margin.">Pass-through</th>
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isDragging = dragFrom === idx;
            const showInsertBefore = dragFrom !== null && dragOverIdx === idx;
            const showInsertAfter = dragFrom !== null && dragOverIdx === idx + 1;
            const passThrough = row.passThrough === true;
            return (
            <tr
              key={idx}
              className={`${isDragging ? styles.dragRowGhost : ''} ${showInsertBefore ? styles.dragInsertBefore : ''} ${showInsertAfter ? styles.dragInsertAfter : ''} ${passThrough ? styles.passThroughRow : ''}`.trim() || undefined}
              onDragOver={(e) => rowDragOver(idx, e)}
              onDrop={(e) => rowDrop(idx, e)}
              onDragEnd={rowDragEnd}
            >
              <td className={styles.dragHandleCell}>
                <span
                  className={styles.dragHandle}
                  draggable={!!onMoveRow}
                  onDragStart={(e) => rowDragStart(idx, e)}
                  title="Drag to reorder this row"
                >⋮⋮</span>
              </td>
              <td>
                <CellTextInput
                  key={`alt-${idx}-altItem-${row.altItem ?? ''}`}
                  initial={row.altItem}
                  listId={altItemListId}
                  onCommit={(v) => onChange(idx, 'altItem', v)}
                />
              </td>
              <td>
                <select
                  className={styles.altCellInput}
                  value={row.type || ''}
                  onChange={(e) => onChange(idx, 'type', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="Setup">Setup</option>
                  <option value="One Time">One Time</option>
                  <option value="Recurring (monthly)">Recurring (monthly)</option>
                </select>
              </td>
              {(() => {
                const auto = autoFeeFor ? autoFeeFor(row) : null;
                const hasManualFee = typeof row.fee === 'number' && Number.isFinite(row.fee) && row.fee >= 0;
                const initial = hasManualFee ? fmtFeeInput(row.fee) : '';
                const placeholder = typeof auto === 'number' ? fmtFeeInput(auto) : '';
                const title = typeof auto === 'number'
                  ? `Auto-calculated from marked-up linked CTS (${fmtFeeInput(auto)} per unit). Type a value to override.`
                  : 'Tie this row to CTS rows via the Linked To column, then pick Type / Unit Count to auto-calculate the fee.';
                return (
                  <td className={styles.numCell} title={title}>
                    <CellTextInput
                      key={`alt-${idx}-fee-${row.fee ?? ''}-${typeof auto === 'number' ? auto.toFixed(2) : 'n'}`}
                      initial={initial}
                      placeholder={placeholder}
                      align="right"
                      onCommit={(v) => {
                        const trimmed = String(v ?? '').trim();
                        if (!trimmed) { onChange(idx, 'fee', null); return; }
                        const n = Number(trimmed.replace(/[$,\s]/g, ''));
                        if (!Number.isFinite(n)) return;
                        onChange(idx, 'fee', n);
                      }}
                    />
                  </td>
                );
              })()}
              <td>
                <select
                  className={styles.altCellInput}
                  value={row.unit || ''}
                  onChange={(e) => handleUnitChange(idx, row, e.target.value)}
                >
                  <option value="">—</option>
                  <option value="Fixed">Fixed</option>
                  <option value="Per Site">Per Site</option>
                  <option value="Per Account">Per Account</option>
                  <option value="Per Meter">Per Meter</option>
                </select>
              </td>
              <td className={styles.numCell}>
                <CellTextInput
                  key={`alt-${idx}-unitCount-${row.unitCount ?? ''}`}
                  initial={row.unitCount}
                  align="right"
                  onCommit={(v) => onChange(idx, 'unitCount', v)}
                />
              </td>
              {(() => {
                const autoSm = autoStartMonthFor ? autoStartMonthFor(row) : null;
                const manualSm = Number(row.startMonth);
                const hasManualSm = row.startMonth != null && row.startMonth !== '' && Number.isFinite(manualSm) && manualSm > 0;
                const placeholder = typeof autoSm === 'number' && autoSm > 0 ? String(autoSm) : '';
                const title = typeof autoSm === 'number' && autoSm > 0
                  ? `Auto-derived from linked CTS rows (month ${autoSm}). Type a value to override.`
                  : 'Set the month this fee starts billing. Defaults to month 1 when no linked CTS row carries a start month.';
                return (
                  <td className={styles.numCell} title={title}>
                    <CellTextInput
                      key={`alt-${idx}-startMonth-${row.startMonth ?? ''}-${placeholder || 'n'}`}
                      initial={hasManualSm ? row.startMonth : ''}
                      placeholder={placeholder}
                      align="right"
                      onCommit={(v) => onChange(idx, 'startMonth', v)}
                    />
                  </td>
                );
              })()}
              {Array.from({ length: numYears }, (_, yi) => {
                const rev = yearRevenue ? yearRevenue(row, yi + 1) : 0;
                return (
                  <td key={`y-${idx}-${yi}`} className={styles.numCell}>
                    {rev > 0 ? fmtMoneyCell(rev) : ''}
                  </td>
                );
              })}
              {(() => {
                const computed = marginFor ? marginFor(row.altItem) : null;
                const explicitZeroFee = typeof row.fee === 'number' && row.fee === 0;
                const placeholder = passThrough
                  ? 'pass'
                  : (computed
                    ? `${(computed.marginPct * 100).toFixed(1)}%`
                    : (explicitZeroFee
                      ? ''
                      : (typeof globalGmPct === 'number' ? `${Math.round(globalGmPct * 100)}%` : '')));
                const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const title = passThrough
                  ? 'Pass-through fee — billed at face cost, contributes no margin.'
                  : (computed
                    ? `Auto-margin for "${row.altItem}":
  • Total fee revenue: ${fmt(computed.totalFee)} (${computed.altRowCount} alt-fee row${computed.altRowCount === 1 ? '' : 's'} × unit count, recurring projected over term; total units = ${computed.totalUnits})
  • Total cost: ${fmt(computed.totalCost)} (${computed.matchCount} linked CTS row${computed.matchCount === 1 ? '' : 's'}, treated as totals; recurring/rolled projected over term)
  • Margin: (${fmt(computed.totalFee)} − ${fmt(computed.totalCost)}) ÷ ${fmt(computed.totalFee)} = ${(computed.marginPct * 100).toFixed(1)}%
Type a value to override.`
                    : 'No CTS items are linked to this Alt Fee item — falls back to the global GM%.');
                return (
                  <td className={styles.numCell} title={title}>
                    <CellTextInput
                      key={`alt-${idx}-feeGm-${row.feeGmPct ?? ''}-${passThrough ? 'pass' : (computed ? computed.marginPct.toFixed(4) : 'n')}`}
                      initial={passThrough ? '' : (typeof row.feeGmPct === 'number' ? (row.feeGmPct * 100).toString() : '')}
                      placeholder={placeholder}
                      align="right"
                      disabled={passThrough}
                      onCommit={(v) => {
                        const trimmed = String(v ?? '').replace('%', '').trim();
                        if (!trimmed) { onChange(idx, 'feeGmPct', null); return; }
                        const n = Number(trimmed);
                        if (!Number.isFinite(n)) return;
                        onChange(idx, 'feeGmPct', n > 1 ? n / 100 : n);
                      }}
                    />
                  </td>
                );
              })()}
              <td className={styles.passThroughCell}>
                <label className={styles.passThroughLabel} title="Bill this fee at face cost (no margin). The line still appears in totals but is excluded from Deal margin.">
                  <input
                    type="checkbox"
                    checked={passThrough}
                    onChange={(e) => onChange(idx, 'passThrough', e.target.checked)}
                  />
                  {passThrough ? 'Pass' : ''}
                </label>
              </td>
              <td>
                <button
                  type="button"
                  className={styles.rowDelBtn}
                  title="Remove row"
                  onClick={() => onRemoveRow(idx)}
                >×</button>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      {(() => {
        // Two side-by-side summary tables under the alt-fee table.
        //   LEFT  ("Total fees"): every fee, including pass-through.
        //   RIGHT ("Revenue less pass-through"): same Setup + One Time
        //         and Recurring rows (the breakdown stays as-billed)
        //         but Total fee drops to revenue net of pass-through.
        //         Only rendered when the deal has any pass-through.
        // Deal margin and Linked CTS cost are identical in both — the
        // existing margin formula already excludes pass-through from
        // both sides, so the % doesn't change between scenarios.
        const isRecurring = (t) => /recurring/i.test(t || '');
        const isOneTimeOrSetup = (t) => /^setup$|^one\s*time$/i.test(t || '');
        const sums = (predicate) => Array.from({ length: numYears }, (_, i) =>
          rows.reduce((s, r) => predicate(r.type) && yearRevenue ? s + yearRevenue(r, i + 1) : s, 0)
        );
        const setupOneTime = sums(isOneTimeOrSetup);
        const recurring = sums(isRecurring);
        const grand = setupOneTime.map((v, i) => v + recurring[i]);
        const costs = Array.isArray(costByYear) ? costByYear : Array.from({ length: numYears }, () => 0);
        const ctsPasses = Array.isArray(passThroughByYear) ? passThroughByYear : Array.from({ length: numYears }, () => 0);
        const altPasses = Array.from({ length: numYears }, (_, i) =>
          rows.reduce((s, r) => (r.passThrough && yearRevenue ? s + yearRevenue(r, i + 1) : s), 0)
        );
        const passes = ctsPasses.map((v, i) => v + altPasses[i]);
        const ctsPassRev = Array.isArray(passThroughRevenueByYear) ? passThroughRevenueByYear : ctsPasses;
        const revLessPass = grand.map((v, i) => v - (ctsPassRev[i] || 0) - (altPasses[i] || 0));
        const anyPassThrough = passes.some(v => v > 0);
        // "Deal margin" is the deal's cumulative margin through each year,
        // not that single year's margin in isolation: a heavy Year-1 setup
        // fee keeps lifting the blended margin in later years. Accumulate
        // fee / cost (and the pass-through carve-outs) year over year, then
        // apply the same pass-through-excluded formula to the running totals.
        let cumFee = 0;
        let cumCost = 0;
        let cumCtsPass = 0;
        let cumAltPass = 0;
        const margins = grand.map((fee, i) => {
          cumFee += fee;
          cumCost += costs[i] || 0;
          cumCtsPass += ctsPasses[i] || 0;
          cumAltPass += altPasses[i] || 0;
          const adjFee = cumFee - cumCtsPass - cumAltPass;
          if (adjFee <= 0) return null;
          const adjCost = cumCost - cumCtsPass;
          return (adjFee - adjCost) / adjFee;
        });
        const fmtPctCell = (n) => n == null ? '' : `${(n * 100).toFixed(1)}%`;
        const hasCost = Array.isArray(costByYear);

        const cellMoney = (v, showZero = false) => (showZero || v > 0) ? fmtMoneyCell(v) : '';

        const renderScenario = (heading, totalFeeValues) => (
          <table className={styles.scenarioTable}>
            <thead>
              <tr>
                <th>{heading}</th>
                {Array.from({ length: numYears }, (_, i) => (
                  <th key={`yh-${i}`} className={styles.numCell}>Year {i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Setup + One Time</td>
                {setupOneTime.map((v, i) => (
                  <td key={`so-${i}`} className={styles.numCell}>{cellMoney(v)}</td>
                ))}
              </tr>
              <tr>
                <td>Recurring (monthly)</td>
                {recurring.map((v, i) => (
                  <td key={`rec-${i}`} className={styles.numCell}>{cellMoney(v)}</td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Total fee</td>
                {totalFeeValues.map((v, i) => (
                  <td key={`tot-${i}`} className={styles.numCell} style={{ fontWeight: 600 }}>{cellMoney(v, true)}</td>
                ))}
              </tr>
              {hasCost && (
                <tr>
                  <td>Deal margin</td>
                  {margins.map((v, i) => (
                    <td key={`m-${i}`} className={styles.numCell}>{fmtPctCell(v)}</td>
                  ))}
                </tr>
              )}
              {hasCost && (
                <tr>
                  <td>Linked CTS cost</td>
                  {costs.map((v, i) => (
                    <td key={`c-${i}`} className={styles.numCell}>{cellMoney(v, true)}</td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        );

        return (
          <div className={styles.scenarioWrap}>
            {renderScenario('Total fees', grand)}
            {anyPassThrough && renderScenario('Revenue less pass-through', revLessPass)}
          </div>
        );
      })()}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className={styles.actionBtn} onClick={onAddRow}>+ Add row</button>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={handleCopy}
          title="Copy this table as tab-separated rows. Paste straight into Excel."
        >
          Copy to clipboard
        </button>
        <button type="button" className={styles.actionBtn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Hide paste box' : 'Paste from spreadsheet…'}
        </button>
        {onClearRows && (
          <button
            type="button"
            className={styles.actionBtnDanger}
            onClick={() => {
              const hasData = rows.some(r => (r.altItem || '').trim() || (r.type || '').trim() || r.fee != null || (r.unit || '').trim());
              if (hasData && !window.confirm('Clear the Alternative Fee schedule? This cannot be undone.')) return;
              onClearRows();
              setFlash('Cleared.');
              window.setTimeout(() => setFlash(''), 2000);
            }}
            title="Reset the Alternative Fee schedule to blank starter rows."
          >Clear</button>
        )}
      </div>
      {pasteOpen && (
        <div className={styles.pasteBox}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
            Paste tab-separated rows (6 columns: Item · Type · Fee · Unit · Unit Count · Fee Start Month). Type values like "One Time" / "Recurring (monthly)" and Unit values like "Per Site" / "Per Account" will round-trip into the dropdowns.
          </div>
          <textarea
            className={styles.pasteArea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'New sites\tOne Time\t$130.00\tPer Site\t25\t1\n…'}
            rows={8}
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              {parsed.length} row{parsed.length === 1 ? '' : 's'} parsed
            </span>
            <button
              type="button"
              className={styles.actionBtn}
              disabled={parsed.length === 0}
              onClick={() => { onAppendRows(parsed); setPasteText(''); setPasteOpen(false); }}
            >Append</button>
            <button
              type="button"
              className={styles.actionBtn}
              disabled={parsed.length === 0}
              onClick={() => { onReplaceRows(parsed); setPasteText(''); setPasteOpen(false); }}
            >Replace all</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline editor that maps a Line Item (description) to one or more
// services from the Solutions / Service Catalog. The mapping is keyed
// by lowercase line item name so it persists across workbooks and
// matches case-insensitively. Rows come from two sources combined:
// every line item in the current workbook option plus every saved
// mapping (so entries stay reachable after the workbook is cleared).
function LineItemServicesSection({ workbookItems, lineItemServices, setLineItemServices, lineItemIgnored, setLineItemIgnored, solutionsOptions }) {
  const [draftItem, setDraftItem] = useState('');
  const [filter, setFilter] = useState('');

  // Build the row list: union of workbook descriptions and saved-mapping
  // line items, deduped case-insensitively. Workbook ordering wins for
  // names it knows; remaining saved entries get appended alphabetically.
  const rows = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const item of workbookItems || []) {
      const name = String(item.description || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, name });
    }
    const savedExtras = [];
    for (const key of Object.keys(lineItemServices || {})) {
      if (!key || seen.has(key)) continue;
      const services = lineItemServices[key];
      if (!Array.isArray(services) || services.length === 0) continue;
      seen.add(key);
      savedExtras.push({ key, name: key });
    }
    savedExtras.sort((a, b) => a.name.localeCompare(b.name));
    return out.concat(savedExtras);
  }, [workbookItems, lineItemServices]);

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  function updateServices(key, services) {
    const next = { ...(lineItemServices || {}) };
    if (!services || services.length === 0) {
      delete next[key];
    } else {
      next[key] = services;
    }
    setLineItemServices(next);
  }

  function toggleIgnore(key) {
    const next = { ...(lineItemIgnored || {}) };
    if (next[key]) delete next[key];
    else next[key] = true;
    setLineItemIgnored(next);
  }

  // Line items still missing a service mapping, excluding the ones the
  // user has chosen to ignore. Drives the warning banner so it only
  // flags rows that genuinely need attention.
  const unmappedRows = useMemo(() => rows.filter(r => {
    if (lineItemIgnored?.[r.key]) return false;
    const svcs = lineItemServices?.[r.key];
    return !(Array.isArray(svcs) && svcs.length > 0);
  }), [rows, lineItemServices, lineItemIgnored]);

  function addLineItem() {
    const name = draftItem.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!(lineItemServices || {})[key]) {
      setLineItemServices({ ...(lineItemServices || {}), [key]: [] });
    }
    setDraftItem('');
  }

  const mappedCount = Object.values(lineItemServices || {})
    .filter(arr => Array.isArray(arr) && arr.length > 0).length;
  const hasSolutions = Array.isArray(solutionsOptions) && solutionsOptions.length > 0;

  return (
    <section className={styles.linkedSection}>
      <h3 className={styles.linkedSubheading}>Line Item → Services ({mappedCount})</h3>
      <p className={styles.linkedHint}>
        Tie each pricing Line Item to one or more services from the Dropdowns tab's
        Solutions / Service Catalog. Opps' Scope column can then bulk-add the
        union of services across every line item in a Pricing Option from an
        "Add from Pricing Option" picker.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter line items…"
          style={{
            flex: '0 1 220px', padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        />
        <input
          type="text"
          value={draftItem}
          onChange={(e) => setDraftItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLineItem(); } }}
          placeholder="Add a custom line item…"
          style={{
            flex: '0 1 260px', padding: '0.3rem 0.45rem',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.82rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        />
        <button
          type="button"
          onClick={addLineItem}
          disabled={!draftItem.trim()}
          style={{
            padding: '0.3rem 0.7rem', background: draftItem.trim() ? 'var(--color-accent)' : 'transparent',
            color: draftItem.trim() ? '#fff' : 'var(--color-text-muted)',
            border: '1px solid var(--color-border)', borderRadius: 4,
            fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
            cursor: draftItem.trim() ? 'pointer' : 'not-allowed',
          }}
        >Add line item</button>
      </div>
      {!hasSolutions && (
        <div className={styles.linkedEmptyInline}>
          Solutions / Service Catalog list is empty. Add services to it on the Dropdowns tab first.
        </div>
      )}
      {unmappedRows.length > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            margin: '0 0 0.5rem', padding: '0.4rem 0.6rem',
            background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 4,
            fontSize: '0.8rem', color: '#92400E',
          }}
        >
          ⚠ {unmappedRows.length} line item{unmappedRows.length === 1 ? '' : 's'} missing a service mapping. Map them below, or click <strong>Ignore</strong> to set the ones you don't need aside.
        </div>
      )}
      {filteredRows.length === 0 ? (
        <div className={styles.linkedEmptyInline}>
          {rows.length === 0
            ? 'No line items yet. Upload a workbook on the Pricing subtab or add a custom line item above.'
            : 'No line items match the filter.'}
        </div>
      ) : (
        <table className={styles.linkedTable}>
          <thead>
            <tr>
              <th style={{ width: '32%' }}>Line Item</th>
              <th>Services</th>
              <th style={{ width: 70 }}>Ignore</th>
              <th style={{ width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => {
              const services = Array.isArray(lineItemServices?.[row.key]) ? lineItemServices[row.key] : [];
              const ignored = !!lineItemIgnored?.[row.key];
              return (
                <tr key={row.key} style={ignored ? { opacity: 0.5 } : undefined}>
                  <td>{row.name}</td>
                  <td>
                    <ServicesPicker
                      selected={services}
                      options={solutionsOptions}
                      onChange={(next) => updateServices(row.key, next)}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={ignored}
                      onChange={() => toggleIgnore(row.key)}
                      title={ignored
                        ? 'Ignored — greyed out and excluded from the missing-mapping warning. Uncheck to track it again.'
                        : 'Ignore this line item — greys it out and drops it from the missing-mapping warning.'}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td>
                    {services.length > 0 && (
                      <button
                        type="button"
                        className={styles.rowDelBtn}
                        title="Clear all services for this line item"
                        onClick={() => updateServices(row.key, [])}
                      >×</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Chip-style multi-select for the Line Item → Services table. Shows
// the currently-picked services as chips with × buttons, plus a
// dropdown that adds the next pick. Keeping selection inline (no
// popover) so a long table of mappings stays scannable.
function ServicesPicker({ selected, options, onChange }) {
  const [adding, setAdding] = useState('');
  const selectedSet = useMemo(() => new Set(selected.map(s => s.toLowerCase())), [selected]);
  const remaining = useMemo(() => options.filter(o => !selectedSet.has(o.toLowerCase())), [options, selectedSet]);

  function addService(service) {
    if (!service) return;
    if (selectedSet.has(service.toLowerCase())) return;
    onChange([...selected, service]);
    setAdding('');
  }
  function removeService(service) {
    onChange(selected.filter(s => s.toLowerCase() !== service.toLowerCase()));
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', alignItems: 'center' }}>
      {selected.map(s => (
        <span
          key={s}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 6px 2px 8px',
            background: '#DCFCE7', color: '#166534',
            border: '1px solid #86EFAC', borderRadius: 999,
            fontSize: '0.75rem', fontWeight: 600,
          }}
        >
          {s}
          <button
            type="button"
            onClick={() => removeService(s)}
            title={`Remove ${s}`}
            style={{
              padding: 0, width: 14, height: 14, lineHeight: 1,
              background: 'transparent', border: 'none',
              color: '#166534', cursor: 'pointer', fontSize: '0.85rem',
            }}
          >×</button>
        </span>
      ))}
      {remaining.length > 0 && (
        <select
          value={adding}
          onChange={(e) => addService(e.target.value)}
          style={{
            padding: '0.2rem 0.35rem',
            border: '1px solid var(--color-border)', borderRadius: 3,
            fontSize: '0.78rem', fontFamily: 'inherit',
            background: '#fff', color: 'var(--color-text)',
          }}
        >
          <option value="">+ Add service…</option>
          {remaining.map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// Small numeric-ish input for the Linked To page's Fee Start Month
// column. Local-draft pattern so re-renders don't fight typing. Empty
// or non-positive commits drop the override; the placeholder shows the
// auto-derived value from the CTS rows on the active option.
function LinkedStartMonthInput({ initial, placeholder, onCommit }) {
  const [draft, setDraft] = useState(initial === null || initial === undefined ? '' : String(initial));
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder || ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial === null || initial === undefined ? '' : String(initial)); e.currentTarget.blur(); }
      }}
      style={{
        width: 60,
        padding: '1px 4px',
        border: '1px solid var(--color-border)', borderRadius: 3,
        fontSize: '0.78rem', fontFamily: 'inherit', textAlign: 'right',
        background: '#fff', color: 'var(--color-text)',
      }}
    />
  );
}

// Read-only panel describing the existing Linked To logic and showing
// the active relationships on the current workbook. Rendered on the
// "Linked To" page subtab.
function LinkedToPanel({
  workbook,
  activeOption,
  setActiveOption,
  overrides,
  linkedToDefaults,
  linkedToUnitDefaults,
  setLinkedToUnitDefault,
  linkedToStartMonthDefaults,
  setLinkedToStartMonthDefault,
  linkedToPassThroughDefaults,
  setLinkedToPassThroughDefault,
  altFees,
  resolvedLinkedTo,
  effectiveType,
  linkedToDefaultKey,
  removeLinkedToDefault,
  lineItemServices,
  setLineItemServices,
  lineItemIgnored,
  setLineItemIgnored,
  solutionsOptions,
}) {
  const opt = workbook?.options.find(o => o.optionNumber === activeOption) || workbook?.options[0];
  const flatItems = opt ? opt.sections.flatMap(s => s.items) : [];

  // Per-row overrides on the active option, including ones that are
  // explicit empty strings (which mute an inherited default).
  const overrideRows = flatItems
    .map(item => {
      const ov = overrides[item.id]?.linkedTo;
      if (ov === undefined) return null;
      return { item, override: ov, type: effectiveType(item) };
    })
    .filter(Boolean);

  // Every saved (Line Item, Type) default, regardless of whether the
  // current workbook has a row matching it. When a workbook is loaded,
  // we surface the original-case Line Item / Type from a matching row;
  // unreachable defaults (or defaults shown without any workbook) fall
  // back to the stored lowercase key. Each row carries a delete button
  // so defaults can be cleaned up even when no file is loaded.
  // Pick the active option's alt-fee rows so we can auto-fill the Unit
  // column from whichever row carries the matching alt item. Lowercase
  // match keeps "Network Services" / "network services" aligned with
  // how Linked-To resolution works elsewhere on the page.
  const activeAltRows = opt ? (altFees?.[opt.optionNumber] || []) : [];
  const unitByAltItemLower = new Map();
  for (const r of activeAltRows) {
    const t = String(r.altItem || '').trim().toLowerCase();
    if (!t) continue;
    if (!unitByAltItemLower.has(t)) unitByAltItemLower.set(t, r.unit || '');
  }
  const unitCountForOption = (unit) => {
    if (unit === 'Per Site' && typeof opt?.siteCount === 'number' && opt.siteCount > 0) return opt.siteCount;
    if (unit === 'Per Account' && typeof opt?.accountCount === 'number' && opt.accountCount > 0) return opt.accountCount;
    return null;
  };

  const defaultEntries = (() => {
    const labelByKey = new Map();
    // Earliest start month seen on any CTS row matching this
    // (Line Item, Type) pair on the active option. Same value flows
    // into the alt-fee row tagged with this default's Linked To.
    const startMonthByKey = new Map();
    for (const item of flatItems) {
      const key = linkedToDefaultKey(item.description, effectiveType(item));
      if (!labelByKey.has(key)) labelByKey.set(key, { lineItem: item.description, type: effectiveType(item) });
      const sm = Number(item.startMonth);
      if (Number.isFinite(sm) && sm > 0) {
        const prev = startMonthByKey.get(key);
        if (prev == null || sm < prev) startMonthByKey.set(key, sm);
      }
    }
    const rows = [];
    for (const [key, value] of Object.entries(linkedToDefaults)) {
      if (!value) continue;
      const labels = labelByKey.get(key);
      const [keyItem, keyType] = key.split('::');
      const tagLower = String(value).trim().toLowerCase();
      const autoUnit = tagLower ? (unitByAltItemLower.get(tagLower) || '') : '';
      const overrideUnit = linkedToUnitDefaults?.[key] || '';
      const effectiveUnit = overrideUnit || autoUnit;
      const autoStartMonth = startMonthByKey.get(key) ?? null;
      const overrideStartMonthRaw = linkedToStartMonthDefaults?.[key];
      const overrideStartMonth = Number.isFinite(Number(overrideStartMonthRaw)) && Number(overrideStartMonthRaw) > 0
        ? Number(overrideStartMonthRaw)
        : null;
      rows.push({
        key,
        value,
        lineItem: labels?.lineItem || keyItem || '',
        type: labels?.type ?? (keyType || ''),
        reachable: !!labels,
        autoUnit,
        overrideUnit,
        effectiveUnit,
        autoStartMonth,
        overrideStartMonth,
        effectiveStartMonth: overrideStartMonth ?? autoStartMonth,
        passThrough: linkedToPassThroughDefaults?.[key] === true,
      });
    }
    rows.sort((a, b) => (a.lineItem || '').localeCompare(b.lineItem || ''));
    return rows;
  })();

  // Group rows by the alt-fee tag they currently resolve to. Untagged
  // rows go under "(no link)".
  const byTag = new Map();
  for (const item of flatItems) {
    const tag = resolvedLinkedTo(item).trim();
    const key = tag || '(no link)';
    if (!byTag.has(key)) byTag.set(key, []);
    byTag.get(key).push(item);
  }
  // Surface tags referenced by alt-fee rows even when no CTS row links
  // to them yet — those are the dangling alt-fee tags the user might
  // want to wire up.
  const altRows = opt ? (altFees[opt.optionNumber] || []) : [];
  const altTags = new Set();
  for (const r of altRows) {
    const t = (r.altItem || '').trim();
    if (t) altTags.add(t);
  }
  for (const t of altTags) {
    if (!byTag.has(t)) byTag.set(t, []);
  }
  const tagEntries = Array.from(byTag.entries())
    .filter(([k]) => k !== '(no link)')
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className={styles.linkedPanel}>
      <section className={styles.linkedDocBlock}>
        <h2 className={styles.linkedHeading}>How "Linked To" works</h2>
        <ul className={styles.linkedDocList}>
          <li>
            Every upper-table CTS row carries a free-text <strong>Linked To</strong> tag. It connects a cost row
            to the alt-fee item (lower table) that recovers that cost.
          </li>
          <li>
            Resolution order: a <strong>per-row override</strong> always wins. With no override, the row falls
            back to the saved <strong>default for its (Line Item, Type) pair</strong>. With neither, the row is unlinked.
          </li>
          <li>
            The ☆ / ★ button next to the input <strong>promotes the current value to the default</strong> for
            that (Line Item, Type) pair across every option — or clears it. Defaults persist with the page state.
          </li>
          <li>
            Alt-fee margin: for each alt-fee tag, the page sums <em>fee × unit count</em> over alt-fee rows
            sharing the tag (recurring rows are projected over the term with the annual escalator), then sums
            CTS over upper-table rows whose resolved Linked To matches the tag. <code>margin% = (fee − cost) / fee</code>.
          </li>
          <li>
            The bottom-of-page breakdown chart filters rows by the tag selected in its dropdown — only CTS rows
            whose resolved Linked To matches that tag contribute to the chart.
          </li>
          <li>
            Matching is case-insensitive and ignores surrounding whitespace.
          </li>
        </ul>
      </section>

      <section className={styles.linkedSection}>
        <h3 className={styles.linkedSubheading}>Saved defaults ({defaultEntries.length})</h3>
        <p className={styles.linkedHint}>
          Defaults apply to any row matching the same Line Item + Type, on any option, unless that row has its own override. They persist across uploaded files, the Clear button, and parser updates.
        </p>
        {defaultEntries.length === 0 ? (
          <div className={styles.linkedEmptyInline}>No saved defaults yet. Click the ☆ next to any Linked To input to save one.</div>
        ) : (
          <table className={styles.linkedTable}>
            <thead>
              <tr>
                <th>Line Item</th>
                <th>Type</th>
                <th>Unit</th>
                <th>Default Linked To</th>
                <th>Fee Start Month</th>
                <th>Pass-through</th>
                <th style={{ width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {defaultEntries.map(d => {
                const unitCount = unitCountForOption(d.effectiveUnit);
                return (
                  <tr key={d.key}>
                    <td>
                      {d.lineItem || <span className={styles.linkedMuted}>—</span>}
                      {workbook && !d.reachable && <span className={styles.linkedMuted}> · not on this option</span>}
                    </td>
                    <td>{d.type || <span className={styles.linkedMuted}>—</span>}</td>
                    <td>
                      <select
                        value={d.overrideUnit}
                        onChange={(e) => setLinkedToUnitDefault && setLinkedToUnitDefault(d.key, e.target.value)}
                        title={d.overrideUnit
                          ? 'Override saved for this Line Item + Type. Clear to fall back to the matching alt-fee row.'
                          : d.autoUnit
                            ? `Auto-filled from the "${d.value}" alt-fee row. Pick a value to override.`
                            : 'Pick a unit. Per Site / Per Account inherit the SIA count automatically.'}
                        style={{
                          padding: '1px 4px',
                          border: '1px solid var(--color-border)', borderRadius: 3,
                          fontSize: '0.78rem', fontFamily: 'inherit',
                          background: '#fff', color: 'var(--color-text)',
                        }}
                      >
                        <option value="">{d.autoUnit ? `Auto: ${d.autoUnit}` : '—'}</option>
                        <option value="Fixed">Fixed</option>
                        <option value="Per Site">Per Site</option>
                        <option value="Per Account">Per Account</option>
                        <option value="Per Meter">Per Meter</option>
                      </select>
                      {unitCount != null && (
                        <span className={styles.linkedMuted} style={{ marginLeft: 6 }}>({unitCount})</span>
                      )}
                    </td>
                    <td><code>{d.value}</code></td>
                    <td title={d.overrideStartMonth != null
                      ? `Override saved for this Line Item + Type. Auto would be ${d.autoStartMonth ?? '—'}. Clear to fall back to the CTS row's start month.`
                      : (d.autoStartMonth != null
                        ? `Auto-derived from the CTS rows matching this Line Item + Type on the active option (month ${d.autoStartMonth}). Type a value to override; the override flows into the matching alt-fee row's Fee Start Month.`
                        : 'Type a value to set the Fee Start Month for any alt-fee row linked to this default.')}>
                      <LinkedStartMonthInput
                        key={`${d.key}-${d.overrideStartMonth ?? ''}-${d.autoStartMonth ?? ''}`}
                        initial={d.overrideStartMonth ?? ''}
                        placeholder={d.autoStartMonth != null ? String(d.autoStartMonth) : ''}
                        onCommit={(v) => setLinkedToStartMonthDefault && setLinkedToStartMonthDefault(d.key, v)}
                      />
                    </td>
                    <td title="Bill every CTS row matching this Line Item + Type at cost (no markup). Per-row checkboxes on the pricing table still override.">
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.78rem' }}>
                        <input
                          type="checkbox"
                          checked={d.passThrough}
                          onChange={(e) => setLinkedToPassThroughDefault && setLinkedToPassThroughDefault(d.key, e.target.checked)}
                        />
                        {d.passThrough ? 'Yes' : 'No'}
                      </label>
                    </td>
                    <td>
                      {removeLinkedToDefault && (
                        <button
                          type="button"
                          className={styles.rowDelBtn}
                          title="Remove this saved default"
                          onClick={() => removeLinkedToDefault(d.key)}
                        >×</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <LineItemServicesSection
        workbookItems={flatItems}
        lineItemServices={lineItemServices}
        setLineItemServices={setLineItemServices}
        lineItemIgnored={lineItemIgnored}
        setLineItemIgnored={setLineItemIgnored}
        solutionsOptions={solutionsOptions}
      />

      {!workbook ? (
        <div className={styles.linkedEmpty}>
          Upload a workbook on the <strong>Pricing</strong> subtab to see per-row overrides and live tag wiring.
        </div>
      ) : (
        <>
          <div className={styles.subtabStrip} style={{ marginTop: '0.75rem' }}>
            {workbook.options.map(o => {
              const isActive = o.optionNumber === (opt?.optionNumber);
              return (
                <button
                  key={o.sheetName}
                  type="button"
                  className={isActive ? styles.subtabActive : styles.subtab}
                  onClick={() => setActiveOption(o.optionNumber)}
                >
                  {o.sheetName}
                </button>
              );
            })}
          </div>

          <section className={styles.linkedSection}>
            <h3 className={styles.linkedSubheading}>Per-row overrides ({overrideRows.length})</h3>
            <p className={styles.linkedHint}>
              Overrides set on individual rows of this option. An empty override mutes any inherited default.
            </p>
            {overrideRows.length === 0 ? (
              <div className={styles.linkedEmptyInline}>No per-row overrides on this option.</div>
            ) : (
              <table className={styles.linkedTable}>
                <thead>
                  <tr><th>Line Item</th><th>Type</th><th>Override</th></tr>
                </thead>
                <tbody>
                  {overrideRows.map(({ item, override, type }) => (
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td>{type || <span className={styles.linkedMuted}>—</span>}</td>
                      <td>
                        {override
                          ? <code>{override}</code>
                          : <span className={styles.linkedMuted}>(cleared — inherits nothing)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className={styles.linkedSection}>
            <h3 className={styles.linkedSubheading}>Tag → linked CTS rows ({tagEntries.length})</h3>
            <p className={styles.linkedHint}>
              Live mapping of resolved Linked To values to the CTS rows that carry them. Tags marked
              <span className={styles.linkedBadge}> alt-fee</span> are referenced by at least one alt-fee
              row; tags with no badge are linked only on the CTS side and will not contribute to alt-fee margin.
            </p>
            {tagEntries.length === 0 ? (
              <div className={styles.linkedEmptyInline}>No Linked To tags resolve on this option yet.</div>
            ) : (
              <table className={styles.linkedTable}>
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Source</th>
                    <th>Linked CTS row</th>
                    <th>Type</th>
                    <th>Start Month</th>
                  </tr>
                </thead>
                <tbody>
                  {tagEntries.map(([tag, items]) => {
                    const lower = tag.toLowerCase();
                    const altMatch = Array.from(altTags).some(t => t.toLowerCase() === lower);
                    const sourceCell = altMatch
                      ? <span className={styles.linkedBadge}>alt-fee</span>
                      : <span className={styles.linkedMuted}>CTS only</span>;
                    if (items.length === 0) {
                      return (
                        <tr key={tag}>
                          <td><code>{tag}</code></td>
                          <td>{sourceCell}</td>
                          <td colSpan={3}>
                            <span className={styles.linkedMuted}>none — alt-fee tag with no CTS rows linked</span>
                          </td>
                        </tr>
                      );
                    }
                    return items.map((it, idx) => {
                      const sm = Number(it.startMonth);
                      const startMonthCell = Number.isFinite(sm) && sm > 0
                        ? sm
                        : <span className={styles.linkedMuted}>—</span>;
                      return (
                        <tr key={`${tag}-${it.id}`}>
                          {idx === 0 && (
                            <>
                              <td rowSpan={items.length}><code>{tag}</code></td>
                              <td rowSpan={items.length}>{sourceCell}</td>
                            </>
                          )}
                          <td>{it.description}</td>
                          <td>{effectiveType(it)}</td>
                          <td>{startMonthCell}</td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// Free-text per-row cell input. Local-draft like GmInput so typing
// doesn't fight a re-rendered controlled value.
function LinkedToInput({ initial, isDefault, onCommit, suggestions = [] }) {
  const [draft, setDraft] = useState(initial || '');
  const listId = useId();
  return (
    <>
      <input
        className={`${styles.linkedInput} ${isDefault ? styles.linkedDefault : ''}`}
        type="text"
        value={draft}
        placeholder="Tie to…"
        title={isDefault ? 'Auto-filled from saved default for this Line Item + Type. Edit to override.' : undefined}
        list={suggestions.length > 0 ? listId : undefined}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(initial || ''); e.currentTarget.blur(); }
        }}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map(s => <option key={s} value={s} />)}
        </datalist>
      )}
    </>
  );
}

// Manager popup for the Linked To dropdown vocabulary, opened from the
// ± button on the pricing table's Linked To column header. Lists every
// option the dropdown currently offers (auto-derived tags + the user's
// custom adds) with a remove button, shows removed ones with a restore
// button, and takes new options via the input at the top. Add/remove
// handlers live on the parent (addLinkedToOption / removeLinkedToOption)
// so the curation persists with the rest of the pricing cache.
function LinkedToOptionsModal({ autoTags = [], optionsList, onAdd, onRemove, onClose }) {
  const [draft, setDraft] = useState('');
  const custom = optionsList?.custom || [];
  const hidden = optionsList?.hidden || [];
  const hiddenSet = new Set(hidden.map(s => String(s).trim().toLowerCase()));
  const customSet = new Set(custom.map(s => String(s).trim().toLowerCase()));
  const seen = new Map();
  for (const name of [...autoTags, ...custom]) {
    const trimmed = String(name || '').trim();
    if (!trimmed) continue;
    const k = trimmed.toLowerCase();
    if (!seen.has(k) && !hiddenSet.has(k)) seen.set(k, trimmed);
  }
  const visible = [...seen.values()].sort((a, b) => a.localeCompare(b));
  const removed = [...hidden].sort((a, b) => a.localeCompare(b));
  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    onAdd(v);
    setDraft('');
  };
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '0.25rem 0' };
  const xBtnStyle = { padding: '0 7px', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', fontSize: '0.78rem', fontFamily: 'inherit', color: '#b91c1c', cursor: 'pointer', lineHeight: 1.6 };
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
        style={{ width: 440, maxWidth: '92vw', maxHeight: '80vh', background: '#fff', borderRadius: 8, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)' }}>Linked To dropdown options</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            These options appear in every row&apos;s Linked To dropdown. Tags already used on saved defaults, alt-fee rows, or row overrides are suggested automatically; removing one keeps it out of the dropdown without touching the rows that use it.
          </div>
        </div>
        <div style={{ padding: '0.85rem 1rem', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: '0.7rem' }}>
            <input
              autoFocus
              type="text"
              value={draft}
              placeholder="Add an option…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              style={{ flex: 1, boxSizing: 'border-box', padding: '0.4rem 0.55rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.82rem', fontFamily: 'inherit' }}
            />
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              style={{ padding: '0.35rem 0.8rem', border: '1px solid var(--color-accent)', borderRadius: 4, background: draft.trim() ? 'var(--color-accent)' : 'var(--color-border-light)', color: draft.trim() ? '#fff' : 'var(--color-text-muted)', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', cursor: draft.trim() ? 'pointer' : 'not-allowed' }}
            >Add</button>
          </div>
          {visible.length === 0 ? (
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '0.3rem 0' }}>
              No dropdown options yet — add one above, or tag a row and they&apos;ll be suggested automatically.
            </div>
          ) : visible.map(name => {
            const isCustom = customSet.has(name.toLowerCase());
            return (
              <div key={name} style={rowStyle}>
                <span style={{ flex: 1, fontSize: '0.82rem', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>
                  {name}
                  {isCustom && <span style={{ marginLeft: 6, fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>(added)</span>}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(name)}
                  title={isCustom ? 'Remove this option from the dropdown' : 'Remove this auto-suggested tag from the dropdown (rows using it are unaffected)'}
                  style={xBtnStyle}
                >×</button>
              </div>
            );
          })}
          {removed.length > 0 && (
            <>
              <div style={{ margin: '0.7rem 0 0.3rem', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
                Removed
              </div>
              {removed.map(name => (
                <div key={name} style={rowStyle}>
                  <span style={{ flex: 1, fontSize: '0.82rem', color: 'var(--color-text-muted)', textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</span>
                  <button
                    type="button"
                    onClick={() => onAdd(name)}
                    title="Restore this option to the dropdown"
                    style={{ ...xBtnStyle, color: 'var(--color-text)' }}
                  >↩</button>
                </div>
              ))}
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.6rem 1rem', borderTop: '1px solid var(--color-border-light)', background: 'var(--color-bg)' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '0.35rem 0.85rem', border: '1px solid var(--color-border)', borderRadius: 4, background: '#fff', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', color: 'var(--color-text)', cursor: 'pointer' }}
          >Done</button>
        </div>
      </div>
    </div>
  );
}

const COLS = [
  { key: 'lineItem',    label: 'Line Item',         defaultWidth: 280 },
  { key: 'type',        label: 'Type',              defaultWidth: 140 },
  { key: 'cts',         label: 'CTS',               defaultWidth: 110 },
  { key: 'techDepr',    label: 'Tech Depr.',        defaultWidth: 110 },
  { key: 'start',       label: 'Start Month',       defaultWidth: 100 },
  { key: 'comments',    label: 'Comments',          defaultWidth: 280 },
  { key: 'gm',          label: 'GM%',               defaultWidth: 90 },
  { key: 'price',       label: 'Marked-up Price',   defaultWidth: 140 },
  { key: 'passThrough', label: 'Pass-through',      defaultWidth: 100 },
  { key: 'linkedTo',    label: 'Linked To',         defaultWidth: 200 },
];

const SUMMARY_COLS = [
  { key: 'bucket',     label: 'Bucket',                       defaultWidth: 200 },
  { key: 'cost',       label: 'Cost',                         defaultWidth: 110 },
  { key: 'techDepr',   label: 'Tech Depr.',                   defaultWidth: 110 },
  { key: 'totalCost',  label: 'Total cost (incl. tech depr)', defaultWidth: 150 },
  { key: 'price',      label: 'Marked-up',                    defaultWidth: 130 },
  { key: 'termPrice',  label: 'Term value (marked-up)',       defaultWidth: 160 },
];

const STORE = 'pricing-cache';
const KEY = 'current';
// Saved Linked-To defaults live under their own key so they survive
// parser-version cache wipes, file removal, and switching to a new
// SIA workbook. They're user-curated mappings, not parser output.
const LINKED_TO_DEFAULTS_KEY = 'linkedToDefaults';
// Per (Line Item, Type) Unit override for the Linked-To defaults
// table. Same key shape as LINKED_TO_DEFAULTS_KEY ("lineitem::type",
// lowercased) so a row can carry both a Default Linked To and a
// Default Unit. Persisted on its own DB key for the same reason
// linkedToDefaults are — these mappings outlive workbook reloads.
const LINKED_TO_UNIT_DEFAULTS_KEY = 'linkedToUnitDefaults';
// Per (Line Item, Type) Fee Start Month override. Same key shape, kept
// in its own DB key so it survives workbook reloads / parser bumps.
// Overrides the CTS row's own startMonth when auto-deriving the alt-fee
// row's Fee Start Month and when rendering the Linked To Saved defaults
// table's Fee Start Month column.
const LINKED_TO_START_MONTH_DEFAULTS_KEY = 'linkedToStartMonthDefaults';
// Per (Line Item, Type) Pass-through default. CTS rows matching the
// pair are billed at cost (no markup) unless a per-row override on the
// pricing table says otherwise. Persisted on its own DB key.
const LINKED_TO_PASS_THROUGH_DEFAULTS_KEY = 'linkedToPassThroughDefaults';
// User-curated vocabulary for the per-row Linked To dropdown on the
// pricing page. `custom` holds options the user added by hand; `hidden`
// suppresses auto-derived suggestions (tags pulled from saved defaults,
// alt-fee rows, and per-row overrides) the user removed. Persisted on
// its own key so the curation survives parser bumps and Clear-button
// workbook wipes, like the Linked-To defaults above.
const LINKED_TO_OPTIONS_KEY = 'linkedToOptionsList';
// Line Item → Services catalog mapping. Keyed by lowercase line item
// name; value is an array of service strings from the Dropdowns-tab
// Solutions / Service Catalog. Persisted on its own key so it survives
// parser bumps and Clear-button workbook wipes, just like Linked-To
// defaults.
const LINE_ITEM_SERVICES_KEY = 'lineItemServices';
const LINE_ITEM_SERVICES_EVENT = 'pricing:lineItemServicesChanged';
// Line items the user has chosen to ignore in the Line Item → Services
// table. Keyed by lowercase line item name (same shape as the services
// map) and persisted on its own key so the choice survives parser bumps
// and Clear-button wipes. Ignored rows are greyed out and excluded from
// the "missing a service mapping" warning.
const LINE_ITEM_IGNORED_KEY = 'lineItemIgnored';
// Per-Option services bundle derived from the loaded workbook + the
// Line Item → Services mapping. Persisted separately so Opps 2 can
// offer an "Add from Pricing Option" picker on its Scope cell without
// needing to walk the workbook itself.
const OPTION_SERVICES_KEY = 'pricingOptionServices';
const OPTION_SERVICES_EVENT = 'pricing:optionServicesChanged';
// Bump this whenever the parser output shape changes — older cached
// parses are silently discarded on hydration so the user re-uploads
// against the current parser.
const PARSER_VERSION = 10;
// Sheet inside Pricing-page exports carrying a JSON snapshot of
// the full page state. Presence of this sheet on a dropped file
// switches the import path from fee-workbook parsing to state
// rehydration. The legacy double-underscore name is still accepted
// for any exports produced before the rename.
const STATE_SHEET_NAME = 'Pricing State';
const LEGACY_STATE_SHEET_NAMES = ['__pricing_state__'];

const fmtMoney = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Pricing page-wide convention: always show two decimal places on
// every currency cell, including aggregated totals.
const fmtMoneyWhole = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtPct = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return `${(n * 100).toFixed(1)}%`;
};

function parsePctInput(s) {
  if (s === '' || s === null || s === undefined) return null;
  const n = Number(String(s).replace('%', '').trim());
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

export function PricingView({ settings } = {}) {
  const { user } = useAuth();
  const solutionsOptions = useMemo(() => {
    const lists = getEffectiveDropdownLists(settings);
    const solutions = lists.find(l => l.key === 'solutions');
    return Array.isArray(solutions?.options) ? solutions.options : [];
  }, [settings]);
  const [workbook, setWorkbook] = useState(null); // { fileName, options, sheetNames, loadedAt }
  const [globalGmPct, setGlobalGmPct] = useState(0.5);
  const [overrides, setOverrides] = useState({}); // { [itemId]: { gmPct } }
  const [activeOption, setActiveOption] = useState(null); // optionNumber or null
  const [colWidths, setColWidths] = useState({}); // { [colKey]: pixelWidth }
  const [altFees, setAltFees] = useState({}); // { [optionNumber]: [{ altItem, type, fee, unit, unitCount, startMonth }] }
  const [linkedToDefaults, setLinkedToDefaults] = useState({}); // { [`${lineItem}::${type}`]: 'value' }
  const [linkedToUnitDefaults, setLinkedToUnitDefaults] = useState({}); // { [`${lineItem}::${type}`]: 'Per Site' | 'Per Account' | 'Fixed' | 'Per Meter' }
  const [linkedToStartMonthDefaults, setLinkedToStartMonthDefaults] = useState({}); // { [`${lineItem}::${type}`]: number } — overrides the CTS row's startMonth for the auto-derive that feeds alt-fee rows
  const [linkedToPassThroughDefaults, setLinkedToPassThroughDefaults] = useState({}); // { [`${lineItem}::${type}`]: true } — sets pass-through for every CTS row matching the pair, unless the per-row override says otherwise
  const [linkedToOptionsList, setLinkedToOptionsList] = useState({ custom: [], hidden: [] }); // user-curated Linked To dropdown vocabulary (see LINKED_TO_OPTIONS_KEY)
  const [linkedToOptionsModal, setLinkedToOptionsModal] = useState(null); // { autoTags: string[] } — open state for the Linked To options manager
  const [lineItemServices, setLineItemServices] = useState({}); // { [lineItemKey]: string[] }
  const [lineItemIgnored, setLineItemIgnored] = useState({}); // { [lineItemKey]: true } — line items the user opted to ignore (greyed out, excluded from the unmapped warning)
  const [termMonths, setTermMonths] = useState(36);
  const [annualEscalator, setAnnualEscalator] = useState(0.03);
  // Separate escalator for CTS costs — defaults to 3.85% so margin
  // compression year-over-year reflects supplier cost creep, while
  // revenue still escalates at the annual contract rate above.
  const [costEscalator, setCostEscalator] = useState(0.0385);
  const [chartTag, setChartTag] = useState(''); // selected line-item / tag for the breakdown chart
  const [chartView, setChartView] = useState('chart'); // 'chart' | 'table'
  const [chartVisible, setChartVisible] = useState(false); // "Line item year-over-year" panel — hidden by default, user opts in via Show
  const [chartUnitCounts, setChartUnitCounts] = useState({}); // per-line-item unit count (keyed by lowercased tag) for the Fee / Unit column
  const [techDeprPct, setTechDeprPct] = useState(0.04);
  const [colVisibility, setColVisibility] = useState({}); // upper table: { [colKey]: bool, default true }
  const [summaryColWidths, setSummaryColWidths] = useState({});
  const [summaryColVisibility, setSummaryColVisibility] = useState({});
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [summaryMenuOpen, setSummaryMenuOpen] = useState(false);
  const [pageSubtab, setPageSubtab] = useState('pricing'); // 'pricing' | 'linkedTo' | 'options' | 'compare' | 'brokerFees' | 's2c' | 'calculator'
  const [optionsTabData, setOptionsTabData] = useState(null); // OptionsTab state: array of { name, years, escPct, rows: [...] }
  const [compareTabData, setCompareTabData] = useState(null); // CompareTab state: { currentLabel, nextLabel, current: [...], next: [...] }
  const [brokerFeesData, setBrokerFeesData] = useState(null); // BrokerFeesTab state: array of { company, loadEp, feeEp, rfps, loadNg, feeNg }
  const [s2cTabData, setS2cTabData] = useState(null); // S2CTab state: array of { costElement, setup, setupUom, ongoing, ongoingUom }
  // Opps 2 records + Option ↔ Opp link map, shared with the Options
  // sub-tab so saving from either tab updates the Opps 2 "Pricing
  // Option" column. Loaded on mount and refreshed on the cross-tab
  // event so a save anywhere shows up live.
  const [opps2Records, setOpps2Records] = useState([]);
  const [optionLinks, setOptionLinks] = useState({});
  const [pricingPickerOpen, setPricingPickerOpen] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const hydratedRef = useRef(false);

  // Hydrate from IndexedDB on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Linked-To defaults are loaded first from their own key so
        // they survive even if the main cache is wiped (parser bump).
        // Fall back to the legacy field on the main cache for users
        // upgrading from before the split.
        const savedDefaults = await dbGet(STORE, LINKED_TO_DEFAULTS_KEY);
        if (!cancelled && savedDefaults && typeof savedDefaults === 'object') {
          setLinkedToDefaults(savedDefaults);
        }
        const savedUnitDefaults = await dbGet(STORE, LINKED_TO_UNIT_DEFAULTS_KEY);
        if (!cancelled && savedUnitDefaults && typeof savedUnitDefaults === 'object') {
          setLinkedToUnitDefaults(savedUnitDefaults);
        }
        const savedStartMonthDefaults = await dbGet(STORE, LINKED_TO_START_MONTH_DEFAULTS_KEY);
        if (!cancelled && savedStartMonthDefaults && typeof savedStartMonthDefaults === 'object') {
          setLinkedToStartMonthDefaults(savedStartMonthDefaults);
        }
        const savedPassThroughDefaults = await dbGet(STORE, LINKED_TO_PASS_THROUGH_DEFAULTS_KEY);
        if (!cancelled && savedPassThroughDefaults && typeof savedPassThroughDefaults === 'object') {
          setLinkedToPassThroughDefaults(savedPassThroughDefaults);
        }
        const savedOptionsList = await dbGet(STORE, LINKED_TO_OPTIONS_KEY);
        if (!cancelled && savedOptionsList && typeof savedOptionsList === 'object') {
          setLinkedToOptionsList({
            custom: Array.isArray(savedOptionsList.custom) ? savedOptionsList.custom : [],
            hidden: Array.isArray(savedOptionsList.hidden) ? savedOptionsList.hidden : [],
          });
        }
        const savedLineItemServices = await dbGet(STORE, LINE_ITEM_SERVICES_KEY);
        if (!cancelled && savedLineItemServices && typeof savedLineItemServices === 'object') {
          setLineItemServices(savedLineItemServices);
        }
        const savedLineItemIgnored = await dbGet(STORE, LINE_ITEM_IGNORED_KEY);
        if (!cancelled && savedLineItemIgnored && typeof savedLineItemIgnored === 'object') {
          setLineItemIgnored(savedLineItemIgnored);
        }
        const saved = await dbGet(STORE, KEY);
        if (cancelled || !saved) { hydratedRef.current = true; return; }
        // Drop caches written by an older parser — their workbook
        // shape may not match what the UI now expects. Linked-To
        // defaults are preserved via the separate key above.
        if (saved.parserVersion !== PARSER_VERSION) {
          await dbDelete(STORE, KEY).catch(() => {});
          if (!savedDefaults && saved.linkedToDefaults) setLinkedToDefaults(saved.linkedToDefaults);
          if (!savedUnitDefaults && saved.linkedToUnitDefaults) setLinkedToUnitDefaults(saved.linkedToUnitDefaults);
          if (!savedStartMonthDefaults && saved.linkedToStartMonthDefaults) setLinkedToStartMonthDefaults(saved.linkedToStartMonthDefaults);
          if (!savedPassThroughDefaults && saved.linkedToPassThroughDefaults) setLinkedToPassThroughDefaults(saved.linkedToPassThroughDefaults);
          if (!savedOptionsList && saved.linkedToOptionsList && typeof saved.linkedToOptionsList === 'object') {
            setLinkedToOptionsList({
              custom: Array.isArray(saved.linkedToOptionsList.custom) ? saved.linkedToOptionsList.custom : [],
              hidden: Array.isArray(saved.linkedToOptionsList.hidden) ? saved.linkedToOptionsList.hidden : [],
            });
          }
          hydratedRef.current = true;
          return;
        }
        if (saved.workbook) setWorkbook(saved.workbook);
        if (typeof saved.globalGmPct === 'number') setGlobalGmPct(saved.globalGmPct);
        if (saved.overrides) setOverrides(saved.overrides);
        if (typeof saved.activeOption === 'number') setActiveOption(saved.activeOption);
        if (saved.colWidths) setColWidths(saved.colWidths);
        if (saved.altFees) setAltFees(saved.altFees);
        if (!savedDefaults && saved.linkedToDefaults) setLinkedToDefaults(saved.linkedToDefaults);
        if (!savedUnitDefaults && saved.linkedToUnitDefaults) setLinkedToUnitDefaults(saved.linkedToUnitDefaults);
        if (!savedStartMonthDefaults && saved.linkedToStartMonthDefaults) setLinkedToStartMonthDefaults(saved.linkedToStartMonthDefaults);
        if (!savedPassThroughDefaults && saved.linkedToPassThroughDefaults) setLinkedToPassThroughDefaults(saved.linkedToPassThroughDefaults);
        if (!savedOptionsList && saved.linkedToOptionsList && typeof saved.linkedToOptionsList === 'object') {
          setLinkedToOptionsList({
            custom: Array.isArray(saved.linkedToOptionsList.custom) ? saved.linkedToOptionsList.custom : [],
            hidden: Array.isArray(saved.linkedToOptionsList.hidden) ? saved.linkedToOptionsList.hidden : [],
          });
        }
        if (!savedLineItemServices && saved.lineItemServices && typeof saved.lineItemServices === 'object') setLineItemServices(saved.lineItemServices);
        if (!savedLineItemIgnored && saved.lineItemIgnored && typeof saved.lineItemIgnored === 'object') setLineItemIgnored(saved.lineItemIgnored);
        if (typeof saved.termMonths === 'number') setTermMonths(saved.termMonths);
        if (typeof saved.annualEscalator === 'number') setAnnualEscalator(saved.annualEscalator);
        if (typeof saved.costEscalator === 'number') setCostEscalator(saved.costEscalator);
        if (typeof saved.chartTag === 'string') setChartTag(saved.chartTag);
        if (saved.chartView === 'chart' || saved.chartView === 'table') setChartView(saved.chartView);
        if (typeof saved.chartVisible === 'boolean') setChartVisible(saved.chartVisible);
        if (saved.chartUnitCounts && typeof saved.chartUnitCounts === 'object') setChartUnitCounts(saved.chartUnitCounts);
        if (typeof saved.techDeprPct === 'number') setTechDeprPct(saved.techDeprPct);
        if (saved.colVisibility) setColVisibility(saved.colVisibility);
        if (saved.summaryColWidths) setSummaryColWidths(saved.summaryColWidths);
        if (saved.summaryColVisibility) setSummaryColVisibility(saved.summaryColVisibility);
        if (saved.pageSubtab === 'pricing' || saved.pageSubtab === 'linkedTo' || saved.pageSubtab === 'options' || saved.pageSubtab === 'compare' || saved.pageSubtab === 'brokerFees' || saved.pageSubtab === 's2c' || saved.pageSubtab === 'calculator') setPageSubtab(saved.pageSubtab);
        if (Array.isArray(saved.s2cTabData)) setS2cTabData(saved.s2cTabData);
        if (Array.isArray(saved.optionsTabData)) setOptionsTabData(saved.optionsTabData);
        if (saved.compareTabData && typeof saved.compareTabData === 'object') setCompareTabData(saved.compareTabData);
        if (Array.isArray(saved.brokerFeesData)) setBrokerFeesData(saved.brokerFeesData);
      } catch (err) {
        console.warn('Failed to load pricing cache:', err);
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist on changes (skip the first render until hydration finishes).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const payload = { parserVersion: PARSER_VERSION, workbook, globalGmPct, overrides, activeOption, colWidths, altFees, linkedToDefaults, linkedToUnitDefaults, linkedToStartMonthDefaults, linkedToPassThroughDefaults, linkedToOptionsList, lineItemServices, lineItemIgnored, termMonths, annualEscalator, costEscalator, chartTag, chartView, chartVisible, chartUnitCounts, techDeprPct, colVisibility, summaryColWidths, summaryColVisibility, pageSubtab, optionsTabData, compareTabData, brokerFeesData, s2cTabData };
    dbPut(STORE, payload, KEY).catch(err => console.warn('Failed to save pricing cache:', err));
  }, [workbook, globalGmPct, overrides, activeOption, colWidths, altFees, linkedToDefaults, linkedToUnitDefaults, linkedToStartMonthDefaults, linkedToPassThroughDefaults, linkedToOptionsList, lineItemServices, lineItemIgnored, termMonths, annualEscalator, costEscalator, chartTag, chartView, chartVisible, chartUnitCounts, techDeprPct, colVisibility, summaryColWidths, summaryColVisibility, pageSubtab, optionsTabData, compareTabData, brokerFeesData, s2cTabData]);

  // Mirror Linked-To defaults under their dedicated key so they
  // outlive the main cache (parser-version bumps, Clear button,
  // file removal). The main-cache copy above is kept for in-app
  // state-snapshot exports.
  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, linkedToDefaults, LINKED_TO_DEFAULTS_KEY).catch(err => console.warn('Failed to save linked-to defaults:', err));
  }, [linkedToDefaults]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, linkedToUnitDefaults, LINKED_TO_UNIT_DEFAULTS_KEY).catch(err => console.warn('Failed to save linked-to unit defaults:', err));
  }, [linkedToUnitDefaults]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, linkedToOptionsList, LINKED_TO_OPTIONS_KEY).catch(err => console.warn('Failed to save linked-to options list:', err));
  }, [linkedToOptionsList]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, linkedToStartMonthDefaults, LINKED_TO_START_MONTH_DEFAULTS_KEY).catch(err => console.warn('Failed to save linked-to start-month defaults:', err));
  }, [linkedToStartMonthDefaults]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, linkedToPassThroughDefaults, LINKED_TO_PASS_THROUGH_DEFAULTS_KEY).catch(err => console.warn('Failed to save linked-to pass-through defaults:', err));
  }, [linkedToPassThroughDefaults]);

  // Persist Line Item → Services mapping on its own key and broadcast
  // a custom event so other views (Opps 2's Scope cell) can refresh
  // their cached copy without waiting for a remount.
  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, lineItemServices, LINE_ITEM_SERVICES_KEY).catch(err => console.warn('Failed to save line-item services:', err));
    try {
      window.dispatchEvent(new CustomEvent(LINE_ITEM_SERVICES_EVENT, { detail: lineItemServices }));
    } catch { /* CustomEvent unavailable */ }
  }, [lineItemServices]);

  // Persist the ignored-line-item set on its own key so it outlives the
  // main cache (parser bumps, Clear button). No broadcast event — the
  // ignore flag is only consumed inside this view's mapping table.
  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, lineItemIgnored, LINE_ITEM_IGNORED_KEY).catch(err => console.warn('Failed to save ignored line items:', err));
  }, [lineItemIgnored]);

  // Derive a per-Pricing-Option services bundle by walking each option's
  // line items, looking up their saved services in lineItemServices,
  // and unioning the results (case-insensitive dedupe, original casing
  // preserved). Keyed by sheet name so the Opps 2 picker can show the
  // same labels the Pricing tab does.
  const pricingOptionServices = useMemo(() => {
    if (!workbook || !Array.isArray(workbook.options)) return {};
    const out = {};
    for (const o of workbook.options) {
      const seen = new Set();
      const services = [];
      for (const sec of (o.sections || [])) {
        for (const item of (sec.items || [])) {
          const key = String(item.description || '').trim().toLowerCase();
          const mapped = key && lineItemServices ? lineItemServices[key] : null;
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
  }, [workbook, lineItemServices]);

  // Persist the derived per-Option bundle and broadcast a change so
  // Opps 2 can refresh its picker without needing the workbook itself.
  useEffect(() => {
    if (!hydratedRef.current) return;
    dbPut(STORE, pricingOptionServices, OPTION_SERVICES_KEY).catch(err => console.warn('Failed to save option services:', err));
    try {
      window.dispatchEvent(new CustomEvent(OPTION_SERVICES_EVENT, { detail: pricingOptionServices }));
    } catch { /* CustomEvent unavailable */ }
  }, [pricingOptionServices]);

  // Effective per-row cost = supplier CTS + tech depreciation. Tech
  // depr is item.cts × techDeprPct for non-pass-through rows (pass-
  // through bills at face cost, so no depreciation is booked against
  // it). Every cost-projection path that drives margin or the cost
  // export uses this so the depreciation burden flows through both
  // the per-year cost breakdown and the Deal margin calc.
  function ctsItemEffectiveCost(item) {
    if (typeof item.cts !== 'number') return 0;
    if (isPassThrough(item)) return item.cts;
    return item.cts * (1 + techDeprPct);
  }

  // Per-year cost contribution from a single upper-table CTS item.
  // Setup / One Time hit year 1 in full; Rolled variants amortize
  // evenly across the term and escalate; Recurring (monthly) bills
  // 12 months per year and escalates.
  function ctsItemYearCost(item, yearIndex) {
    if (typeof item.cts !== 'number') return 0;
    const t = effectiveType(item);
    const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
    const yearStart = (yearIndex - 1) * 12 + 1;
    const yearEnd = yearIndex * 12;
    // CTS row's Start Month (column on the pricing table) — defaults
    // to 1. Mirrors how altFeeYearRevenue treats the alt-fee row's
    // startMonth so the per-year cost breakdown lines up with the
    // per-year revenue breakdown for any pass-through link.
    const startMonth = Math.max(1, Math.round(Number(item.startMonth) || 1));
    // Effective per-row cost folds tech depr into non-pass-through
    // cost so margin reflects depreciation alongside supplier cost.
    const baseCost = ctsItemEffectiveCost(item);
    if (isRecurring) {
      const billStart = Math.max(yearStart, startMonth);
      const billEnd = Math.min(yearEnd, termMonths);
      if (billEnd < billStart) return 0;
      const months = billEnd - billStart + 1;
      const esc = Math.pow(1 + costEscalator, yearIndex - 1);
      return baseCost * months * esc;
    }
    // Setup / One Time + Setup-Rolled / One-Time-Rolled: cost lands
    // upfront in the year containing startMonth. Rolled variants still
    // amortize their *billing* over the term on the revenue side
    // (autoFee / altFeeYearRevenue handle that), but the cost has
    // already been incurred — so margin should book it in Y1 instead
    // of spreading it monthly.
    if (startMonth > termMonths) return 0;
    if (startMonth >= yearStart && startMonth <= yearEnd) return baseCost;
    return 0;
  }

  // Per-year revenue (marked-up price) from a single upper-table CTS
  // item — the price mirror of ctsItemYearCost. Setup / One Time land
  // upfront in the year containing their start month; Recurring
  // (monthly) bills 12 months per year; Rolled variants amortize their
  // billing evenly across the term. Recurring / Rolled revenue escalates
  // with the revenue escalator (annualEscalator), matching how term
  // price is projected elsewhere. Used by the line-item year-over-year
  // table so a tag with linked CTS rows but no Alternative Fee row still
  // shows the Fee and Margin from the prices the customer actually pays.
  function ctsItemYearRevenue(item, yearIndex) {
    if (typeof item.cts !== 'number') return 0;
    const { price } = priceFor(item);
    if (typeof price !== 'number' || !Number.isFinite(price)) return 0;
    const t = effectiveType(item);
    const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
    const isRolled = /\brolled\b/i.test(t);
    const yearStart = (yearIndex - 1) * 12 + 1;
    const yearEnd = yearIndex * 12;
    const startMonth = Math.max(1, Math.round(Number(item.startMonth) || 1));
    if (isRecurring) {
      const billStart = Math.max(yearStart, startMonth);
      const billEnd = Math.min(yearEnd, termMonths);
      if (billEnd < billStart) return 0;
      const months = billEnd - billStart + 1;
      const esc = Math.pow(1 + annualEscalator, yearIndex - 1);
      return price * months * esc;
    }
    if (isRolled && termMonths > 0) {
      // Cost books upfront (ctsItemYearCost) but billing is amortized
      // across the term on the revenue side, so spread the price evenly
      // over every month of the term and escalate it annually.
      const billStart = Math.max(yearStart, startMonth);
      const billEnd = Math.min(yearEnd, termMonths);
      if (billEnd < billStart) return 0;
      const months = billEnd - billStart + 1;
      const esc = Math.pow(1 + annualEscalator, yearIndex - 1);
      return (price / termMonths) * months * esc;
    }
    if (startMonth > termMonths) return 0;
    if (startMonth >= yearStart && startMonth <= yearEnd) return price;
    return 0;
  }

  // Revenue from a single Alt Fee row in calendar year `yearIndex`
  // (1-based). Setup / One Time charges land in the year containing
  // their start month. Recurring (monthly) bills every month from
  // startMonth through termMonths, escalated each year.
  function altFeeYearRevenue(row, yearIndex) {
    const manualFee = Number(row.fee);
    const hasManualFee = row.fee != null && row.fee !== '' && Number.isFinite(manualFee) && manualFee >= 0;
    const fee = hasManualFee ? manualFee : (autoFeePerUnitFor(row) ?? 0);
    const uc = Number(row.unitCount);
    if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(uc) || uc <= 0) return 0;
    const manualSm = Number(row.startMonth);
    const hasManualSm = row.startMonth != null && row.startMonth !== '' && Number.isFinite(manualSm) && manualSm > 0;
    const startMonth = Math.max(1, Math.round(hasManualSm ? manualSm : (autoStartMonthFor(row) || 1)));
    const yearStart = (yearIndex - 1) * 12 + 1;
    const yearEnd = yearIndex * 12;
    const isRecurring = /recurring/i.test(row.type || '');

    if (!isRecurring) {
      if (startMonth > termMonths) return 0;
      if (startMonth >= yearStart && startMonth <= yearEnd) return fee * uc;
      return 0;
    }
    const billStart = Math.max(yearStart, startMonth);
    const billEnd = Math.min(yearEnd, termMonths);
    if (billEnd < billStart) return 0;
    const monthCount = billEnd - billStart + 1;
    const escMult = Math.pow(1 + annualEscalator, yearIndex - 1);
    return fee * uc * monthCount * escMult;
  }

  // Per-unit fee auto-computed from the marked-up prices of CTS rows
  // linked to this alt-fee row. Type matching:
  //   alt-fee Setup              ← CTS Setup           (face value)
  //   alt-fee One Time           ← CTS One Time        (face value)
  //   alt-fee Recurring (monthly)← CTS Recurring (monthly)            (face monthly)
  //                                + CTS Setup Rolled / One Time Rolled
  //                                  (markup amortized over the term)
  // Returns null if there is no linked + type-matched markup yet, or
  // the row has no usable unit count.
  function autoFeePerUnitFor(row) {
    if (!workbook) return null;
    const target = (row.altItem || '').trim().toLowerCase();
    if (!target) return null;
    const opt = workbook.options.find(o => o.optionNumber === activeOption);
    if (!opt) return null;
    const uc = Number(row.unitCount);
    if (!Number.isFinite(uc) || uc <= 0) return null;
    const rowType = (row.type || '').trim();
    if (!rowType) return null;
    const isRecurringRow = /recurring/i.test(rowType);
    // Setup and One Time are treated as the same bucket — both alt-fee
    // types pull face value from CTS rows of either Setup or One Time
    // (plain, not Rolled). Rolled variants flow into the Recurring
    // bucket and are amortized over the term.
    const isSetupOrOneTimeRow = /^(setup|one\s*time)$/i.test(rowType);

    let totalMarkup = 0;
    for (const sec of opt.sections) {
      for (const item of sec.items) {
        if (resolvedLinkedTo(item).trim().toLowerCase() !== target) continue;
        const { price } = priceFor(item);
        if (typeof price !== 'number' || !Number.isFinite(price)) continue;
        const t = effectiveType(item);
        const itemIsRecurring = /recurring/i.test(t);
        const itemIsRolled = /\brolled\b/i.test(t);
        const itemIsSetupOrOneTime = /^(setup|one\s*time)$/i.test(t);

        if (isRecurringRow) {
          if (itemIsRecurring) totalMarkup += price;
          else if (itemIsRolled && termMonths > 0) totalMarkup += price / termMonths;
        } else if (isSetupOrOneTimeRow && itemIsSetupOrOneTime) {
          totalMarkup += price;
        }
      }
    }
    if (totalMarkup <= 0) return null;
    // Round to two decimals so the value the user sees in the Fee
    // column is exactly the same number used by every downstream
    // calculation (year revenue, margin, totals). Without rounding,
    // a displayed $1.93 can multiply out from an underlying $1.9263.
    return Math.round((totalMarkup / uc) * 100) / 100;
  }

  // Earliest start month from CTS rows linked to this alt-fee row's
  // tag. Falls back through type matching (Setup/One Time bucket vs
  // Recurring incl. Rolled) so a Setup alt-fee row picks up the start
  // month of the upfront CTS lines and a Recurring row picks up the
  // monthly ones. Returns null if no linked rows carry a usable start
  // month.
  function autoStartMonthFor(row) {
    if (!workbook) return null;
    const target = String(row?.altItem || '').trim().toLowerCase();
    if (!target) return null;
    const opt = workbook.options.find(o => o.optionNumber === activeOption);
    if (!opt) return null;
    const rowType = String(row?.type || '').trim();
    const isRecurringRow = /recurring/i.test(rowType);
    const isSetupOrOneTimeRow = /^(setup|one\s*time)$/i.test(rowType);

    let bestTyped = null;
    let bestAny = null;
    for (const sec of opt.sections) {
      for (const item of sec.items) {
        if (resolvedLinkedTo(item).trim().toLowerCase() !== target) continue;
        const sm = effectiveItemStartMonth(item);
        if (!Number.isFinite(sm) || sm <= 0) continue;
        if (bestAny == null || sm < bestAny) bestAny = sm;
        const t = effectiveType(item);
        const itemIsRecurring = /recurring/i.test(t);
        const itemIsRolled = /\brolled\b/i.test(t);
        const itemIsSetupOrOneTime = /^(setup|one\s*time)$/i.test(t);
        const typeMatches = (isRecurringRow && (itemIsRecurring || itemIsRolled))
          || (isSetupOrOneTimeRow && itemIsSetupOrOneTime);
        if (typeMatches && (bestTyped == null || sm < bestTyped)) bestTyped = sm;
      }
    }
    return bestTyped ?? bestAny;
  }

  // For an Alt Fee tag, compute the total margin across ALL alt-fee
  // rows sharing that tag and ALL upper-table CTS rows linked to it.
  //
  //   totalUnits = Σ unitCount over alt-fee rows with this tag
  //                (used to compute fee revenue, not cost)
  //   totalFee   = Σ over alt-fee rows of fee × unitCount, with
  //                Recurring (monthly) rows projected over the term
  //                using the annual escalator
  //   totalCost  = Σ over linked upper-table CTS rows of their term
  //                cost. CTS values are treated as totals (not
  //                per-unit), so no unit-count multiplication. Per
  //                type:
  //                  Setup / One Time          → CTS (face)
  //                  Setup Rolled / One Time Rolled → CTS amortized
  //                                              over the term with
  //                                              the escalator
  //                  Recurring (monthly)       → CTS projected over
  //                                              the term with the
  //                                              escalator
  //   marginPct  = (totalFee − totalCost) / totalFee
  function altFeeMarginFor(altItemName) {
    if (!workbook) return null;
    const target = (altItemName || '').trim().toLowerCase();
    if (!target) return null;
    const opt = workbook.options.find(o => o.optionNumber === activeOption);
    if (!opt) return null;

    const altRows = (altFees[opt.optionNumber] || []).filter(r =>
      (r.altItem || '').trim().toLowerCase() === target);
    if (altRows.length === 0) return null;

    const totalUnits = altRows.reduce((s, r) => {
      const uc = Number(r.unitCount);
      return s + (Number.isFinite(uc) ? uc : 0);
    }, 0);

    const totalFee = altRows.reduce((s, r) => {
      const manualFee = Number(r.fee);
      const hasManualFee = r.fee != null && r.fee !== '' && Number.isFinite(manualFee) && manualFee >= 0;
      const fee = hasManualFee ? manualFee : (autoFeePerUnitFor(r) ?? 0);
      const uc = Number(r.unitCount);
      if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(uc) || uc <= 0) return s;
      const isRecurring = /recurring/i.test(r.type || '');
      if (isRecurring) return s + projectMonthlyOverTerm(fee, annualEscalator, termMonths) * uc;
      return s + fee * uc;
    }, 0);
    if (totalFee <= 0) return null;

    const linked = [];
    for (const sec of opt.sections) {
      for (const item of sec.items) {
        if (resolvedLinkedTo(item).trim().toLowerCase() === target) linked.push(item);
      }
    }

    const totalCost = linked.reduce((s, item) => {
      if (typeof item.cts !== 'number') return s;
      const t = effectiveType(item);
      const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
      // Effective cost folds tech depr into non-pass-through cost.
      const baseCost = ctsItemEffectiveCost(item);
      if (isRecurring) return s + projectMonthlyOverTerm(baseCost, costEscalator, termMonths);
      // Setup / One Time + Setup-Rolled / One-Time-Rolled: cost is
      // booked upfront, not amortized — the customer is billed on a
      // rolled schedule but our cost has already been incurred.
      return s + baseCost;
    }, 0);

    return {
      totalCost,
      totalFee,
      totalUnits,
      matchCount: linked.length,
      altRowCount: altRows.length,
      marginPct: (totalFee - totalCost) / totalFee,
    };
  }
  function projectMonthlyOverTerm(monthly, escPct, months) {
    if (typeof monthly !== 'number' || !Number.isFinite(monthly)) return 0;
    if (!months || months <= 0) return 0;
    const esc = typeof escPct === 'number' && Number.isFinite(escPct) ? escPct : 0;
    let total = 0;
    let remaining = months;
    let mult = 1;
    while (remaining > 0) {
      const band = Math.min(12, remaining);
      total += monthly * mult * band;
      remaining -= band;
      mult *= (1 + esc);
    }
    return total;
  }

  const linkedToDefaultKey = (lineItem, type) =>
    `${(lineItem || '').trim().toLowerCase()}::${(type || '').trim().toLowerCase()}`;

  // Resolve the displayed Linked To value for an item: per-row
  // override wins; otherwise fall back to the saved default for the
  // (Line Item, Type) pair.
  function resolvedLinkedTo(item) {
    const ov = overrides[item.id]?.linkedTo;
    if (ov !== undefined) return ov;
    return linkedToDefaults[linkedToDefaultKey(item.description, effectiveType(item))] || '';
  }

  // Start month for a CTS item, honoring the per-(Line Item, Type)
  // override saved on the Linked To page over the workbook value.
  function effectiveItemStartMonth(item) {
    const key = linkedToDefaultKey(item.description, effectiveType(item));
    const ov = linkedToStartMonthDefaults[key];
    if (ov != null) {
      const n = Number(ov);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const sm = Number(item.startMonth);
    return Number.isFinite(sm) && sm > 0 ? sm : null;
  }

  // Drag-to-resize for either the upper-table or summary-table cols.
  function startColResize(scope, key, evt) {
    evt.preventDefault();
    evt.stopPropagation();
    const cols = scope === 'summary' ? SUMMARY_COLS : COLS;
    const colDef = cols.find(c => c.key === key);
    const widthsState = scope === 'summary' ? summaryColWidths : colWidths;
    const setWidths = scope === 'summary' ? setSummaryColWidths : setColWidths;
    const startX = evt.clientX;
    const startW = widthsState[key] ?? colDef?.defaultWidth ?? 140;
    const onMove = (e) => {
      const next = Math.max(60, startW + (e.clientX - startX));
      setWidths(w => ({ ...w, [key]: next }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const colHidden = (key) => colVisibility[key] === false;
  const summaryColHidden = (key) => summaryColVisibility[key] === false;
  function toggleColVisible(key) {
    setColVisibility(v => ({ ...v, [key]: v[key] === false }));
  }
  function toggleSummaryColVisible(key) {
    setSummaryColVisibility(v => ({ ...v, [key]: v[key] === false }));
  }

  // Keep activeOption pointing at a real tab whenever the workbook changes.
  useEffect(() => {
    if (!workbook?.options?.length) return;
    const exists = workbook.options.some(o => o.optionNumber === activeOption);
    if (!exists) setActiveOption(workbook.options[0].optionNumber);
  }, [workbook, activeOption]);

  // Hydrate Opps 2 records + Option ↔ Opp link map for the per-option
  // "Save to Opp" button on the Pricing sub-tab. Updates broadcast from
  // the Options sub-tab (or another browser tab) flow back through the
  // same cross-tab event used everywhere else.
  useEffect(() => {
    let cancelled = false;
    dbGet('opps2-cache', 'data')
      .then(val => { if (!cancelled && val && Array.isArray(val.records)) setOpps2Records(val.records); })
      .catch(() => {});
    loadOptionLinks().then(val => { if (!cancelled) setOptionLinks(val || {}); });
    const onLinks = (e) => {
      const detail = e?.detail;
      if (detail && typeof detail === 'object') setOptionLinks(detail);
    };
    window.addEventListener(OPTION_LINKS_EVENT, onLinks);
    return () => {
      cancelled = true;
      window.removeEventListener(OPTION_LINKS_EVENT, onLinks);
    };
  }, []);

  // Pull the JSON snapshot out of a dropped Pricing-page export. The
  // state sheet stores the payload in chunked rows (column A, row 2+)
  // because individual cells max out at 32,767 characters in Excel.
  // Returns the parsed snapshot, or null if the sheet isn't present
  // or its payload can't be parsed.
  function readPricingStateFromBuffer(buf) {
    const wb = XLSX.read(buf, { type: 'array' });
    const found = [STATE_SHEET_NAME, ...LEGACY_STATE_SHEET_NAMES].find(n => wb.SheetNames.includes(n));
    if (!found) return null;
    const sheet = wb.Sheets[found];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
    const chunks = aoa.slice(1).map(r => String(r?.[0] ?? ''));
    const json = chunks.join('');
    if (!json) return null;
    return JSON.parse(json);
  }

  function restorePricingState(s) {
    if (s.workbook) setWorkbook(s.workbook);
    if (typeof s.globalGmPct === 'number') setGlobalGmPct(s.globalGmPct);
    setOverrides(s.overrides || {});
    if (typeof s.activeOption === 'number') setActiveOption(s.activeOption);
    else if (s.workbook?.options?.[0]?.optionNumber != null) setActiveOption(s.workbook.options[0].optionNumber);
    setColWidths(s.colWidths || {});
    setAltFees(s.altFees || {});
    // Merge incoming snapshot defaults on top of existing ones so a
    // round-tripped state file doesn't wipe defaults the user built
    // up on this device. An empty {} in the snapshot is a no-op.
    if (s.linkedToDefaults && typeof s.linkedToDefaults === 'object') {
      setLinkedToDefaults(prev => ({ ...prev, ...s.linkedToDefaults }));
    }
    if (s.linkedToUnitDefaults && typeof s.linkedToUnitDefaults === 'object') {
      setLinkedToUnitDefaults(prev => ({ ...prev, ...s.linkedToUnitDefaults }));
    }
    if (s.linkedToOptionsList && typeof s.linkedToOptionsList === 'object') {
      // Same union semantics as the defaults above — fold the snapshot's
      // curated dropdown options into this device's list.
      setLinkedToOptionsList(prev => {
        const union = (a, b) => {
          const seen = new Set((a || []).map(v => String(v).trim().toLowerCase()));
          const out = [...(a || [])];
          for (const v of (b || [])) {
            const k = String(v).trim().toLowerCase();
            if (k && !seen.has(k)) { seen.add(k); out.push(String(v).trim()); }
          }
          return out;
        };
        return {
          custom: union(prev.custom, s.linkedToOptionsList.custom),
          hidden: union(prev.hidden, s.linkedToOptionsList.hidden),
        };
      });
    }
    if (typeof s.termMonths === 'number') setTermMonths(s.termMonths);
    if (typeof s.annualEscalator === 'number') setAnnualEscalator(s.annualEscalator);
    if (typeof s.costEscalator === 'number') setCostEscalator(s.costEscalator);
    if (typeof s.chartTag === 'string') setChartTag(s.chartTag);
    if (s.chartView === 'chart' || s.chartView === 'table') setChartView(s.chartView);
    if (typeof s.chartVisible === 'boolean') setChartVisible(s.chartVisible);
    if (s.chartUnitCounts && typeof s.chartUnitCounts === 'object') setChartUnitCounts(s.chartUnitCounts);
    if (typeof s.techDeprPct === 'number') setTechDeprPct(s.techDeprPct);
    setColVisibility(s.colVisibility || {});
    setSummaryColWidths(s.summaryColWidths || {});
    setSummaryColVisibility(s.summaryColVisibility || {});
  }

  async function handleFile(file) {
    setError('');
    try {
      const buf = await file.arrayBuffer();
      const snapshot = readPricingStateFromBuffer(buf);
      if (snapshot) {
        restorePricingState(snapshot);
        return;
      }
      const parsed = parsePricingWorkbook(buf);
      setWorkbook({
        fileName: file.name,
        options: parsed.options,
        sheetNames: parsed.sheetNames,
        loadedAt: Date.now(),
      });
      setOverrides({});
      // Fresh file → reset the global margin to the 50% default so a
      // stale saved value from a prior workbook doesn't carry over.
      setGlobalGmPct(0.5);
      setActiveOption(parsed.options[0]?.optionNumber ?? null);
      // Seed the Alternative Fee schedule from the cost rows' Linked To
      // tags rather than the workbook's own alt-fee table. Every unique
      // tag a cost row resolves to becomes one alt-fee row; the user
      // fills the fee later. Unit pre-fills from linkedToUnitDefaults
      // when set, and Per Site / Per Account inherit the SIA metadata
      // count. Pad to 9 rows so the grid keeps its Excel-template feel.
      // Normalize an SIA alt-fee Type string into one of the alt-fee
      // dropdown values so imported rows render as selected (and match
      // the seeded rows for the fill pass). Idempotent — already-normal
      // values map back to themselves.
      const normAltType = (raw) => {
        const t = String(raw || '').trim();
        if (/recurring/i.test(t)) return 'Recurring (monthly)';
        if (/^setup/i.test(t)) return 'Setup';
        if (/^one\s*time/i.test(t)) return 'One Time';
        return t;
      };

      const seeded = {};
      for (const opt of parsed.options) {
        const flatItems = (opt.sections || []).flatMap(s => s.items || []);
        // Tag → first matching cost item, so we can pull a unit default
        // off whichever (lineItem, type) pair produced the tag.
        const firstItemByTag = new Map();
        for (const item of flatItems) {
          const k = linkedToDefaultKey(item.description, item.type || '');
          const tag = (linkedToDefaults[k] || '').trim();
          if (!tag || firstItemByTag.has(tag)) continue;
          firstItemByTag.set(tag, item);
        }
        const tags = Array.from(firstItemByTag.keys()).sort((a, b) => a.localeCompare(b));
        // If the uploaded SIA already has its own Alternative Fee
        // Structure/Schedule filled in, treat the file as the source of
        // truth: use its fee rows verbatim and skip the auto-seeded
        // Linked-To rows entirely, so the file's fees REPLACE the fees
        // this tool would otherwise build (instead of stacking on top of
        // them). The parser only yields real rows; we keep the ones
        // carrying an actual fee so blank template rows don't add noise.
        const wbAltRows = (opt.altFees || []).filter(a => a && a.fee != null);
        let rows;
        if (wbAltRows.length > 0) {
          rows = wbAltRows.map(wb => ({
            altItem: wb.altItem,
            type: normAltType(wb.type),
            fee: wb.fee,
            unit: wb.unit || '',
            unitCount: wb.unitCount == null ? 1 : wb.unitCount,
            startMonth: wb.startMonth == null ? null : wb.startMonth,
          }));
        } else {
          // No alt-fee table in the file → seed the schedule from the
          // cost rows' Linked To tags so the user has a starting grid to
          // fill in.
          rows = tags.map(tag => {
            const item = firstItemByTag.get(tag);
            const unitKey = linkedToDefaultKey(item.description, item.type || '');
            const unit = linkedToUnitDefaults[unitKey] || '';
            let unitCount = 1;
            if (unit === 'Per Site' && typeof opt.siteCount === 'number' && opt.siteCount > 0) {
              unitCount = opt.siteCount;
            } else if (unit === 'Per Account' && typeof opt.accountCount === 'number' && opt.accountCount > 0) {
              unitCount = opt.accountCount;
            }
            // Map the cost item's type into one of the alt-fee dropdown
            // values so the seeded row renders as selected. Rolled
            // variants normalize to their base (Setup Rolled → Setup,
            // One Time Rolled → One Time) since the alt-fee table doesn't
            // expose Rolled types — the user can refine if needed.
            const rawType = String(item.type || '').trim();
            let type = '';
            if (/recurring/i.test(rawType)) type = 'Recurring (monthly)';
            else if (/^setup/i.test(rawType)) type = 'Setup';
            else if (/^one\s*time/i.test(rawType)) type = 'One Time';
            // Leave startMonth null so autoStartMonthFor derives it from
            // the linked CTS rows; the user can type a value to override.
            return { altItem: tag, type, fee: null, unit, unitCount, startMonth: null };
          });
        }
        while (rows.length < 9) rows.push({ altItem: '', type: '', fee: null, unit: '', unitCount: 1, startMonth: null });
        seeded[opt.optionNumber] = rows;
      }
      setAltFees(seeded);
    } catch (err) {
      setError(err?.message || 'Failed to parse file.');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver) setDragOver(true);
  }
  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  }

  function clearAll() {
    if (!confirm('Clear the loaded workbook, markup overrides, and the Alternative Fee schedule? Saved Linked-To defaults are kept.')) return;
    setWorkbook(null);
    setOverrides({});
    setActiveOption(null);
    setAltFees({});
    setError('');
    // Linked-To defaults live under their own key (LINKED_TO_DEFAULTS_KEY)
    // and are intentionally preserved across Clear / file changes.
    dbDelete(STORE, KEY).catch(() => {});
  }

  // Clone the active option in-place on the loaded workbook. The new
  // option gets a fresh optionNumber, a unique sheet name ("(Clone)"
  // suffix, with a counter if that name is already taken), and item
  // IDs regenerated against the new sheet name so per-row overrides
  // don't leak between original and clone. Alt-fee rows are deep-
  // copied to the new option number. The clone lives on the in-memory
  // workbook only, so removing the file (Clear / Replace) wipes it
  // automatically along with everything else parsed from the upload.
  function cloneActiveOption() {
    if (!workbook || !Array.isArray(workbook.options) || workbook.options.length === 0) return;
    const src = workbook.options.find(o => o.optionNumber === activeOption) || workbook.options[0];
    if (!src) return;

    const used = new Set(workbook.options.map(o => o.sheetName));
    const baseName = `${src.sheetName} (Clone)`;
    let newSheetName = baseName;
    let n = 2;
    while (used.has(newSheetName)) {
      newSheetName = `${src.sheetName} (Clone ${n})`;
      n += 1;
    }
    const newOptionNumber = workbook.options.reduce((m, o) => Math.max(m, o.optionNumber || 0), 0) + 1;

    const cloned = JSON.parse(JSON.stringify(src));
    cloned.sheetName = newSheetName;
    cloned.optionNumber = newOptionNumber;
    cloned.isClone = true;
    cloned.clonedFrom = src.sheetName;
    cloned.sections = (cloned.sections || []).map(sec => ({
      ...sec,
      items: (sec.items || []).map((item, idx) => ({
        ...item,
        // Mirror the parser's id pattern so resolveColumnLink and
        // override lookups behave identically on the clone.
        id: `${newSheetName}::${sec.title}::${idx}::${String(item.description || '').slice(0, 40)}`,
      })),
    }));

    setWorkbook(prev => prev ? { ...prev, options: [...prev.options, cloned] } : prev);
    setAltFees(prev => {
      const srcRows = prev[src.optionNumber];
      if (!Array.isArray(srcRows) || srcRows.length === 0) return prev;
      return { ...prev, [newOptionNumber]: srcRows.map(r => ({ ...r })) };
    });
    setActiveOption(newOptionNumber);
  }

  // Drop a cloned Option from the in-memory workbook. Only options
  // produced by Clone option (isClone === true) are deletable here —
  // sheets from the source workbook stick around so the user can
  // always re-clone from the original. Active option follows the
  // deletion: if the user was sitting on the clone we switch to the
  // option it was cloned from, falling back to the first remaining
  // option. Per-option state (alt-fee rows, per-row overrides) tied
  // to the clone's optionNumber + item ids is dropped along with it.
  function deleteClonedOption(optionNumber) {
    if (!workbook || !Array.isArray(workbook.options)) return;
    const target = workbook.options.find(o => o.optionNumber === optionNumber);
    if (!target || !target.isClone) return;
    if (!window.confirm(`Delete the cloned option "${target.sheetName}"? Any markup overrides and alt-fee rows on this clone will be removed.`)) return;

    const remaining = workbook.options.filter(o => o.optionNumber !== optionNumber);
    setWorkbook(prev => prev ? { ...prev, options: remaining } : prev);
    setAltFees(prev => {
      if (!(optionNumber in prev)) return prev;
      const next = { ...prev };
      delete next[optionNumber];
      return next;
    });
    setOverrides(prev => {
      const droppedIds = new Set();
      for (const sec of (target.sections || [])) {
        for (const item of (sec.items || [])) {
          if (item.id) droppedIds.add(item.id);
        }
      }
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(prev)) {
        if (droppedIds.has(id)) { delete next[id]; changed = true; }
      }
      return changed ? next : prev;
    });
    if (activeOption === optionNumber) {
      const fallback = remaining.find(o => o.sheetName === target.clonedFrom)
        || remaining[0];
      setActiveOption(fallback ? fallback.optionNumber : null);
    }
  }

  // 9 empty starter rows that match the Excel template — used when
  // an option's alt-fee table hasn't been edited yet.
  const altFeeStarter = () => Array.from({ length: 9 }, () => ({
    altItem: '', type: '', fee: null, unit: '', unitCount: 1, startMonth: null,
  }));

  function updateAltFeeCell(optionNumber, idx, field, value) {
    setAltFees(prev => {
      const list = (prev[optionNumber] || altFeeStarter()).slice();
      const row = { ...(list[idx] || {}), [field]: value };
      list[idx] = row;
      return { ...prev, [optionNumber]: list };
    });
  }

  function addAltFeeRow(optionNumber) {
    setAltFees(prev => {
      const list = (prev[optionNumber] || altFeeStarter()).slice();
      list.push({ altItem: '', type: '', fee: null, unit: '', unitCount: 1, startMonth: null });
      return { ...prev, [optionNumber]: list };
    });
  }

  function removeAltFeeRow(optionNumber, idx) {
    setAltFees(prev => {
      const list = (prev[optionNumber] || []).slice();
      list.splice(idx, 1);
      return { ...prev, [optionNumber]: list };
    });
  }

  // Drag-and-drop reordering. `from` and `to` are indices into the
  // current row array; the row at `from` is removed and reinserted at
  // the position that `to` represents after the removal. Out-of-range
  // or no-op moves are skipped.
  function moveAltFeeRow(optionNumber, from, to) {
    if (from === to || from < 0 || to < 0) return;
    setAltFees(prev => {
      const list = (prev[optionNumber] || []).slice();
      if (from >= list.length || to > list.length) return prev;
      const [row] = list.splice(from, 1);
      const insertAt = to > from ? to - 1 : to;
      list.splice(insertAt, 0, row);
      return { ...prev, [optionNumber]: list };
    });
  }

  function replaceAltFeeRows(optionNumber, newRows) {
    setAltFees(prev => ({ ...prev, [optionNumber]: newRows.slice() }));
  }

  function appendAltFeeRows(optionNumber, newRows) {
    setAltFees(prev => {
      const existing = (prev[optionNumber] || altFeeStarter()).slice();
      // Drop trailing fully-empty starter rows so the appended rows
      // don't sit below a wall of blanks.
      while (existing.length > 0) {
        const r = existing[existing.length - 1];
        const isEmpty = !r.altItem && !r.type && !r.unit &&
          (!r.unitCount || r.unitCount === 1 || r.unitCount === '1') &&
          (typeof r.fee !== 'number' || r.fee === 0) &&
          (r.startMonth == null || r.startMonth === '' || r.startMonth === 1);
        if (!isEmpty) break;
        existing.pop();
      }
      return { ...prev, [optionNumber]: [...existing, ...newRows] };
    });
  }

  function effectiveType(item) {
    const ov = overrides[item.id]?.typeOverride;
    return (ov === undefined || ov === null || ov === '') ? (item.type || '') : ov;
  }

  function setItemType(itemId, newType) {
    setOverrides(prev => {
      const next = { ...prev };
      if (!newType) {
        if (next[itemId]) {
          const { typeOverride: _drop, ...rest } = next[itemId];
          if (Object.keys(rest).length === 0) delete next[itemId];
          else next[itemId] = rest;
        }
      } else {
        next[itemId] = { ...next[itemId], typeOverride: newType };
      }
      return next;
    });
  }

  function setItemLinkedTo(item, raw) {
    const itemId = item.id;
    const trimmed = (raw || '').trim();
    setOverrides(prev => {
      const next = { ...prev };
      if (!trimmed) {
        if (next[itemId]) {
          const { linkedTo: _drop, ...rest } = next[itemId];
          if (Object.keys(rest).length === 0) delete next[itemId];
          else next[itemId] = rest;
        }
      } else {
        next[itemId] = { ...next[itemId], linkedTo: trimmed };
      }
      return next;
    });
  }

  // Add / remove entries in the Linked To dropdown vocabulary (the
  // datalist on each pricing-table row), managed from the ± button on
  // the column header. Adding clears a matching hidden entry, so
  // re-adding (or restoring) a removed option brings it back; removing
  // remembers the name in `hidden` so auto-derived tags that are still
  // in use on defaults / alt fees / overrides stay suppressed.
  function addLinkedToOption(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    setLinkedToOptionsList(prev => {
      const hidden = (prev.hidden || []).filter(h => String(h).trim().toLowerCase() !== lower);
      const custom = (prev.custom || []).some(c => String(c).trim().toLowerCase() === lower)
        ? (prev.custom || [])
        : [...(prev.custom || []), trimmed];
      return { custom, hidden };
    });
  }
  function removeLinkedToOption(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    setLinkedToOptionsList(prev => {
      const custom = (prev.custom || []).filter(c => String(c).trim().toLowerCase() !== lower);
      const hidden = (prev.hidden || []).some(h => String(h).trim().toLowerCase() === lower)
        ? (prev.hidden || [])
        : [...(prev.hidden || []), trimmed];
      return { custom, hidden };
    });
  }

  // Save / clear the (Line Item, Type) default from the row's
  // currently-resolved value via the star button next to the input.
  function toggleLinkedToDefault(item) {
    const key = linkedToDefaultKey(item.description, effectiveType(item));
    const currentValue = resolvedLinkedTo(item).trim();
    const existing = linkedToDefaults[key] || '';
    setLinkedToDefaults(prev => {
      const next = { ...prev };
      if (currentValue && existing !== currentValue) {
        next[key] = currentValue;
      } else if (existing) {
        delete next[key];
      }
      return next;
    });
  }

  function removeLinkedToDefault(key) {
    setLinkedToDefaults(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLinkedToUnitDefaults(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLinkedToStartMonthDefaults(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLinkedToPassThroughDefaults(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // Save / clear the Fee Start Month override for a (Line Item, Type)
  // pair. A non-positive / non-numeric value drops the override so the
  // CTS row's own startMonth (auto-derived) takes back over.
  function setLinkedToStartMonthDefault(key, raw) {
    setLinkedToStartMonthDefaults(prev => {
      const next = { ...prev };
      const n = Number(String(raw ?? '').replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(n) || n <= 0) {
        if (key in next) delete next[key];
        else return prev;
      } else {
        next[key] = Math.round(n);
      }
      return next;
    });
  }

  // Save / clear the Unit default for a (Line Item, Type) pair. Empty
  // string drops the override so the auto-fill (matching alt-fee row's
  // unit) takes back over.
  function setLinkedToUnitDefault(key, unit) {
    setLinkedToUnitDefaults(prev => {
      const next = { ...prev };
      if (!unit) {
        if (key in next) delete next[key];
        else return prev;
      } else {
        next[key] = unit;
      }
      return next;
    });
  }

  function setItemGm(itemId, raw) {
    setOverrides(prev => {
      const next = { ...prev };
      const parsed = parsePctInput(raw);
      if (parsed === null) {
        // Clearing GM% -> drop just the gmPct field, keep other
        // per-row state (e.g. linkedTo).
        if (next[itemId]) {
          const { gmPct: _drop, ...rest } = next[itemId];
          if (Object.keys(rest).length === 0) delete next[itemId];
          else next[itemId] = rest;
        }
      } else {
        next[itemId] = { ...next[itemId], gmPct: parsed };
      }
      return next;
    });
  }

  function isPassThrough(item) {
    const ov = overrides[item.id]?.passThrough;
    if (ov === true) return true;
    if (ov === false) return false;
    const key = linkedToDefaultKey(item.description, effectiveType(item));
    return linkedToPassThroughDefaults[key] === true;
  }

  // Per-row pass-through toggle. Stores an explicit boolean so the row
  // can also mute a Linked-To default (toggle off when the (Line Item,
  // Type) default is on). If the toggled value matches the default,
  // we drop the per-row override so the default flows through cleanly.
  function setItemPassThrough(itemId, on, item) {
    const defaultIsOn = !!(item
      && linkedToPassThroughDefaults[linkedToDefaultKey(item.description, effectiveType(item))] === true);
    setOverrides(prev => {
      const next = { ...prev };
      if (Boolean(on) === defaultIsOn) {
        if (next[itemId]) {
          const { passThrough: _drop, ...rest } = next[itemId];
          if (Object.keys(rest).length === 0) delete next[itemId];
          else next[itemId] = rest;
        }
      } else {
        next[itemId] = { ...next[itemId], passThrough: !!on };
      }
      return next;
    });
  }

  // Save / clear the Pass-through default for a (Line Item, Type) pair.
  // Falsy drops the key so the default no longer applies.
  function setLinkedToPassThroughDefault(key, on) {
    setLinkedToPassThroughDefaults(prev => {
      const next = { ...prev };
      if (on) next[key] = true;
      else if (key in next) delete next[key];
      else return prev;
      return next;
    });
  }

  function effectiveGm(item) {
    if (isPassThrough(item)) return { gm: 0, source: 'passThrough' };
    const ov = overrides[item.id];
    if (ov && typeof ov.gmPct === 'number') return { gm: ov.gmPct, source: 'override' };
    if (typeof globalGmPct === 'number') return { gm: globalGmPct, source: 'global' };
    if (typeof item.gmPct === 'number') return { gm: item.gmPct, source: 'sheet' };
    return { gm: null, source: 'none' };
  }

  function priceFor(item) {
    const { gm, source } = effectiveGm(item);
    if (source === 'passThrough') {
      return { gm: 0, source, price: typeof item.cts === 'number' ? item.cts : null };
    }
    // Mark up against the effective cost (CTS + tech depr) so the
    // displayed Deal margin equals the target GM exactly. Marking up
    // against raw CTS leaves tech depr unrecovered and shows a margin
    // ~techDeprPct below target.
    const effCost = typeof item.cts === 'number' ? ctsItemEffectiveCost(item) : null;
    const price = priceFromCostAndGm(effCost, gm);
    return { gm, source, price };
  }

  function exportCsv() {
    if (!workbook) return;
    const wb = XLSX.utils.book_new();

    // One sheet per option, formatted so parsePricingWorkbook can
    // read this file back through the same path it uses for a fresh
    // fee workbook upload. The parser skips the first 18 rows, then
    // looks for header rows containing both "Type" and "CTS"; the
    // section title is the nearest single-cell row above each header.
    // A trailing "Cost Summary" anchor bounds the data range.
    for (const opt of workbook.options) {
      const rows = [];
      for (let i = 0; i < 18; i++) rows.push([]);
      for (const sec of opt.sections) {
        rows.push([sec.title]);
        rows.push(['Line Item', 'Type', 'CTS', 'Start Month', 'Comments', 'GM %', 'Marked-up Price']);
        for (const item of sec.items) {
          const { price } = priceFor(item);
          rows.push([
            item.description || '',
            effectiveType(item),
            item.cts ?? '',
            item.startMonth || '',
            item.comments || '',
            item.gmPct != null ? item.gmPct : '',
            price != null ? price : '',
          ]);
        }
        rows.push([]);
      }
      rows.push(['Cost Summary']);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      // Apply percent format to the GM% column (col F → index 5).
      // GM values are stored as decimals (0.5 = 50 %); the parser's
      // toPct handles both forms but humans read 50 % more easily.
      for (let r = 0; r < rows.length; r++) {
        if (rows[r].length < 6) continue;
        const v = rows[r][5];
        if (typeof v !== 'number') continue;
        const addr = XLSX.utils.encode_cell({ c: 5, r });
        if (ws[addr]) ws[addr].z = '0%';
      }
      const sheetName = opt.sheetName || `Option ${opt.optionNumber}`;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    // State sheet — JSON snapshot of every piece of state the
    // IndexedDB cache persists, chunked into 30k-char cells so each
    // value stays under Excel's 32,767 cell-text limit. Dropping
    // this workbook back rehydrates from this sheet for full
    // fidelity; without it the per-option sheets above still parse
    // cleanly as a fresh fee workbook (no overrides preserved).
    const snapshot = {
      parserVersion: PARSER_VERSION,
      workbook, globalGmPct, overrides, activeOption, colWidths,
      altFees, linkedToDefaults, termMonths, annualEscalator, costEscalator,
      chartTag, chartView, chartVisible, chartUnitCounts, techDeprPct, colVisibility,
      summaryColWidths, summaryColVisibility,
    };
    const json = JSON.stringify(snapshot);
    const CHUNK = 30000;
    const stateRows = [['DO NOT EDIT — Pricing page round-trip payload. Drop this workbook back onto the Pricing page to restore state.']];
    for (let i = 0; i < json.length; i += CHUNK) stateRows.push([json.slice(i, i + CHUNK)]);
    const stateWs = XLSX.utils.aoa_to_sheet(stateRows);
    XLSX.utils.book_append_sheet(wb, stateWs, STATE_SHEET_NAME);

    XLSX.writeFile(wb, `pricing-markup-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // Per-month CTS cost for a single line item, 1-based monthIndex.
  // Mirrors ctsItemYearCost but resolves the cost down to a single
  // month so the monthly-cost export can lay everything out across
  // the term. Setup / One Time lands in startMonth; Recurring bills
  // each month from startMonth through termMonths; Rolled amortizes
  // cts/termMonths every month from month 1. costEscalator compounds
  // annually (year 1 = months 1..12, year 2 = months 13..24, …).
  function ctsItemMonthlyCost(item, monthIndex) {
    if (typeof item.cts !== 'number') return 0;
    if (monthIndex < 1 || monthIndex > termMonths) return 0;
    const t = effectiveType(item);
    const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
    const startMonth = Math.max(1, Math.round(Number(item.startMonth) || 1));
    const yearIdx = Math.ceil(monthIndex / 12);
    const esc = Math.pow(1 + costEscalator, yearIdx - 1);
    // Includes tech depr on non-pass-through cost so the monthly-cost
    // export matches what flows into the margin calc.
    const baseCost = ctsItemEffectiveCost(item);
    if (isRecurring) {
      if (monthIndex < startMonth) return 0;
      return baseCost * esc;
    }
    // Setup / One Time + Setup-Rolled / One-Time-Rolled: cost lands
    // upfront in the row's startMonth (Rolled bills the customer over
    // the term but we've already paid the supplier).
    return monthIndex === startMonth ? baseCost : 0;
  }

  // Excel export: monthly CTS cost for every line item on the active
  // Option, across the full term, with a totals row. Each line item
  // is one row; columns are Section · Line Item · Type · Start Month
  // · Term Total · M1 … MN. The bottom row sums every month + the
  // grand total. Filename: Monthly-Costs-<option>-<date>.xlsx.
  function exportMonthlyCosts() {
    if (!workbook) return;
    const opt = workbook.options.find(o => o.optionNumber === activeOption) || workbook.options[0];
    if (!opt) return;
    const term = Math.max(1, Math.min(360, termMonths || 36));
    const monthHeaders = Array.from({ length: term }, (_, i) => `M${i + 1}`);
    const rows = [];
    rows.push([`Monthly Costs — ${opt.sheetName}`]);
    rows.push([`Term: ${term} months · Cost escalator: ${(costEscalator * 100).toFixed(2)}% / yr · Tech depreciation: ${(techDeprPct * 100).toFixed(2)}% (folded into each non-pass-through row's cost)`]);
    rows.push([]);
    rows.push(['Section', 'Line Item', 'Type', 'Start Month', 'Term Total', ...monthHeaders]);

    const monthTotals = Array.from({ length: term }, () => 0);
    let grandTotal = 0;
    for (const sec of opt.sections) {
      for (const item of sec.items) {
        if (typeof item.cts !== 'number') continue;
        const monthly = Array.from({ length: term }, (_, i) => ctsItemMonthlyCost(item, i + 1));
        const rowTotal = monthly.reduce((s, v) => s + v, 0);
        for (let i = 0; i < term; i++) monthTotals[i] += monthly[i];
        grandTotal += rowTotal;
        rows.push([
          sec.title || '',
          item.description || '',
          effectiveType(item),
          item.startMonth || 1,
          rowTotal,
          ...monthly,
        ]);
      }
    }
    rows.push([
      '',
      'TOTAL',
      '',
      '',
      grandTotal,
      ...monthTotals,
    ]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Apply $#,##0.00 to every numeric cell from col E (Term Total)
    // onward — that's columns 4..(4 + term).
    const headerRowIdx = 3; // 0-based
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      for (let c = 4; c <= 4 + term; c++) {
        const v = rows[r][c];
        if (typeof v !== 'number') continue;
        const addr = XLSX.utils.encode_cell({ c, r });
        if (ws[addr]) ws[addr].z = '"$"#,##0.00';
      }
    }
    // Column widths: A 18, B 32, C 18, D 12, E 14, monthly cols 12 each.
    ws['!cols'] = [
      { wch: 18 }, { wch: 32 }, { wch: 18 }, { wch: 12 }, { wch: 14 },
      ...monthHeaders.map(() => ({ wch: 12 })),
    ];
    // Freeze the header row and the first 4 label columns so the
    // monthly grid scrolls cleanly.
    ws['!freeze'] = { xSplit: 4, ySplit: headerRowIdx + 1 };

    const wb = XLSX.utils.book_new();
    const sheetName = (`Monthly Costs ${opt.sheetName || `Option ${opt.optionNumber}`}`).slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const slug = (opt.sheetName || `Option-${opt.optionNumber}`).replace(/[^a-zA-Z0-9-]+/g, '-');
    XLSX.writeFile(wb, `Monthly-Costs-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // Commercial Reference export — writes the active Option's cost line
  // items in the SE Commercial Reference template format (Commercial
  // Reference, Unit Amount, Quantity). Each item's CTS is annualized:
  // Recurring (monthly) costs are multiplied by 12 so every row reads
  // as a yearly figure; Setup / One Time costs pass through as-is.
  // Quantity is always 1. Filename: CommercialReference-<option>-<date>.csv.
  function exportCommercialRef() {
    if (!workbook) return;
    const opt = workbook.options.find(o => o.optionNumber === activeOption) || workbook.options[0];
    if (!opt) return;
    const escape = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lineRows = [];
    for (const sec of opt.sections) {
      for (const item of sec.items) {
        if (typeof item.cts !== 'number') continue;
        const isMonthly = /recurring.*monthly|monthly.*recurring|^recurring/i.test(effectiveType(item));
        const unitAmount = item.cts * (isMonthly ? 12 : 1);
        // Plain numbers, no currency formatting; skip zero-value line items.
        if (unitAmount === 0) continue;
        lineRows.push([item.description || '', unitAmount.toFixed(2), 1]);
      }
    }
    if (!lineRows.length) {
      window.alert('No cost line items to export on this Option.');
      return;
    }
    const lines = [
      ['Commercial Reference', 'Unit Amount', 'Quantity'].join(','),
      ...lineRows.map(cols => cols.map(escape).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = (opt.sheetName || `Option-${opt.optionNumber}`).replace(/[^a-zA-Z0-9-]+/g, '-');
    a.href = url;
    a.download = `CommercialReference-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Margin Request Template export — fills the standard SE template
  // with one block per loaded Pricing Option. Services come from the
  // per-option services bundle, Fee Structure is the option's Alt Fee
  // table summarized, Margin is the term-projected option margin
  // rounded to a whole percent, and Escalator is the annual revenue
  // escalator. Customer Name / SIA Link / RFP fields are left blank
  // for the user to fill in.
  async function exportMarginRequest() {
    if (!workbook || !Array.isArray(workbook.options) || workbook.options.length === 0) return;
    const { Workbook } = await import('exceljs');

    const SE_GREEN_DARK = 'FF009530';
    const LABEL_BG     = 'FFF1F5F9';
    const VALUE_BG     = 'FFFFFFFF';
    const OPTION_BG    = 'FFE5E7EB';
    const TEXT_DARK    = 'FF1E293B';
    const TEXT_MUTED   = 'FF64748B';
    const BORDER       = 'FFD4DDE1';

    const wb = new Workbook();
    wb.creator = 'Schneider Electric · Prospect Tracker';
    const ws = wb.addWorksheet('Margin Request', {
      properties: { tabColor: { argb: SE_GREEN_DARK } },
      views: [{ showGridLines: false }],
    });
    ws.columns = [
      { width: 24 }, // A: row labels / "Option N"
      { width: 32 }, // B: services / term value / Yes/No value
      { width: 14 }, // C: "Fee Structure" label
      { width: 44 }, // D: Fee Structure value
      { width: 14 }, // E: Margin / Escalator labels
      { width: 14 }, // F: Margin / Escalator values
    ];
    const SPAN = 6;
    const thinBorder = { style: 'thin', color: { argb: BORDER } };
    const allBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
    const setBordered = (cell) => { cell.border = allBorders; };
    const greenBanner = (cellRange, text) => {
      const [r1, c1, r2, c2] = cellRange;
      ws.mergeCells(r1, c1, r2, c2);
      const cell = ws.getCell(r1, c1);
      cell.value = text;
      cell.font = { name: 'Calibri', bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SE_GREEN_DARK } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      for (let c = c1; c <= c2; c++) setBordered(ws.getCell(r1, c));
      ws.getRow(r1).height = 22;
    };
    const setLabel = (cell, text, opts = {}) => {
      cell.value = text;
      cell.font = { name: 'Calibri', bold: !opts.italic, italic: !!opts.italic, size: 11, color: { argb: opts.italic ? TEXT_MUTED : TEXT_DARK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_BG } };
      cell.alignment = { vertical: 'middle', horizontal: opts.italic ? 'right' : 'left', indent: 1, wrapText: true };
      setBordered(cell);
    };
    const setValue = (cell, value, opts = {}) => {
      if (value !== undefined && value !== null) cell.value = value;
      cell.font = { name: 'Calibri', size: 11, color: { argb: TEXT_DARK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg || VALUE_BG } };
      cell.alignment = { vertical: 'middle', horizontal: opts.align || 'left', indent: 1, wrapText: true };
      if (opts.numFmt) cell.numFmt = opts.numFmt;
      setBordered(cell);
    };

    // --- Header block --------------------------------------------------
    greenBanner([1, 1, 1, SPAN], 'Margin Request Template');

    setLabel(ws.getCell(2, 1), 'Customer Name');
    ws.mergeCells(2, 2, 2, SPAN);
    setValue(ws.getCell(2, 2), '');

    setLabel(ws.getCell(3, 1), 'Sales Investment Analyzer (SIA) Link');
    ws.mergeCells(3, 2, 3, SPAN);
    setValue(ws.getCell(3, 2), '');

    setLabel(ws.getCell(4, 1), 'Is this an RFP?');
    setLabel(ws.getCell(4, 2), 'Yes/No', { italic: true });
    ws.mergeCells(4, 3, 4, 4);
    setValue(ws.getCell(4, 3), 'No');
    setLabel(ws.getCell(4, 5), 'Due Date', { italic: true });
    setValue(ws.getCell(4, 6), 'N/A');

    // --- Options ------------------------------------------------------
    greenBanner([5, 1, 5, SPAN], 'SIA Options Seeking Approval');

    // Per-option margin: (termPrice − termCost) / termPrice, projecting
    // recurring revenue + cost over the term with the active escalators
    // (mirrors the per-option roll-up on the Pricing page).
    const computeOptionMargin = (opt) => {
      let termCost = 0, termPrice = 0;
      for (const sec of (opt.sections || [])) {
        for (const item of (sec.items || [])) {
          const { price } = priceFor(item);
          const t = effectiveType(item);
          const isRecurring = /^recurring/i.test(t);
          const isRolled = /\brolled\b/i.test(t);
          if (isRecurring) {
            termCost += projectMonthlyOverTerm(item.cts ?? null, costEscalator, termMonths);
            termPrice += projectMonthlyOverTerm(price ?? null, annualEscalator, termMonths);
          } else if (isRolled && termMonths > 0) {
            if (typeof item.cts === 'number') termCost += item.cts;
            const monthlyPrice = typeof price === 'number' ? price / termMonths : null;
            termPrice += projectMonthlyOverTerm(monthlyPrice, annualEscalator, termMonths);
          } else {
            if (typeof item.cts === 'number') termCost += item.cts;
            if (typeof price === 'number') termPrice += price;
          }
        }
      }
      if (!Number.isFinite(termPrice) || termPrice <= 0) return null;
      return (termPrice - termCost) / termPrice;
    };

    // Compact summary of an option's Alt Fee rows. Empty rows are
    // dropped; each kept row reads as "{altItem}: ${fee}/{unit}" plus
    // a "({type})" qualifier when the row has one. Falls back to a
    // dash so the cell isn't ambiguous when no alt fees are entered.
    const summarizeAltFees = (opt) => {
      const list = altFees?.[opt.optionNumber] || [];
      const lines = [];
      for (const r of list) {
        const item = String(r?.altItem || '').trim();
        const feeNum = Number(r?.fee);
        if (!item && !Number.isFinite(feeNum)) continue;
        const unit = String(r?.unit || '').trim();
        const type = String(r?.type || '').trim();
        const feeTxt = Number.isFinite(feeNum)
          ? `$${feeNum.toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit ? `/${unit}` : ''}`
          : '';
        const main = [item, feeTxt].filter(Boolean).join(': ');
        lines.push(type ? `${main} (${type})` : main);
      }
      return lines.length > 0 ? lines.join('\n') : '—';
    };

    let row = 6;
    const escPct = Math.round((annualEscalator || 0) * 100);
    const termYrs = termMonths ? termMonths / 12 : 0;
    workbook.options.forEach((opt, idx) => {
      const optionLabel = `Option ${idx + 1}`;
      // Row 1 of the block — option header strip.
      setLabel(ws.getCell(row, 1), optionLabel);
      ws.mergeCells(row, 2, row, SPAN);
      setValue(ws.getCell(row, 2), opt.sheetName || '', { bg: OPTION_BG });
      ws.getCell(row, 2).font = { name: 'Calibri', bold: true, size: 11, color: { argb: TEXT_DARK } };
      ws.getRow(row).height = 20;

      // Row 2 — Services | (Fee Structure label) | (Fee Structure value, merged with row 3) | Margin label/value
      setLabel(ws.getCell(row + 1, 1), 'Services', { italic: true });
      const services = (pricingOptionServices?.[opt.sheetName] || []).filter(Boolean);
      setValue(ws.getCell(row + 1, 2), services.length > 0 ? services.join('\n') : '—');
      setLabel(ws.getCell(row + 1, 3), 'Fee Structure', { italic: true });
      // Merge Fee Structure value across rows 2 and 3 of the block.
      ws.mergeCells(row + 1, 4, row + 2, 4);
      setValue(ws.getCell(row + 1, 4), summarizeAltFees(opt));
      setLabel(ws.getCell(row + 1, 5), 'Margin', { italic: true });
      const margin = computeOptionMargin(opt);
      if (margin == null) {
        setValue(ws.getCell(row + 1, 6), '—', { align: 'right' });
      } else {
        setValue(ws.getCell(row + 1, 6), Math.round(margin * 100) / 100, { align: 'right', numFmt: '0%' });
      }

      // Row 3 — Term | Term value | (Fee Structure value continues) | Escalator label/value
      setLabel(ws.getCell(row + 2, 1), 'Term', { italic: true });
      setValue(ws.getCell(row + 2, 2), termYrs || '—', termYrs ? { numFmt: '0.##" yrs"' } : {});
      // Fee Structure label cell on row 3 stays empty (the value spans
      // from row 2). Tag it with the label-styled empty cell so the
      // border lines up with its row neighbours.
      setLabel(ws.getCell(row + 2, 3), '', { italic: true });
      setLabel(ws.getCell(row + 2, 5), 'Escalator', { italic: true });
      setValue(ws.getCell(row + 2, 6), escPct / 100, { align: 'right', numFmt: '0%' });

      ws.getRow(row + 1).height = Math.max(22, services.length * 14);
      ws.getRow(row + 2).height = 22;
      row += 3;
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileSlug = (workbook.fileName || 'Pricing').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-]+/g, '-');
    a.download = `Margin-Request-${fileSlug}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const totals = useMemo(() => {
    if (!workbook) return null;
    const perOption = {};
    for (const opt of workbook.options) {
      let cost = 0, price = 0;
      for (const sec of opt.sections) {
        for (const item of sec.items) {
          const { price: p } = priceFor(item);
          if (typeof item.cts === 'number') cost += item.cts;
          if (typeof p === 'number') price += p;
        }
      }
      perOption[opt.optionNumber] = { cost, price };
    }
    return perOption;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbook, overrides, globalGmPct]);

  return (
    <div
      className={styles.wrapper}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      style={dragOver ? { outline: '2px dashed var(--color-accent)', outlineOffset: -4, background: '#F0F9FF' } : undefined}
    >
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Pricing</h1>
        </div>

        <div className={styles.toolbar}>
          <label className={styles.gmField}>
            Global GM%
            <input
              className={styles.gmInput}
              type="number"
              step="1"
              min="0"
              max="99"
              value={Math.round(globalGmPct * 1000) / 10}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setGlobalGmPct(Math.max(0, Math.min(0.99, n / 100)));
              }}
            />
            <span>%</span>
          </label>

          <label className={styles.gmField} title="Number of months in the contract term — used to project recurring (monthly) totals.">
            Term
            <input
              className={styles.gmInput}
              type="number"
              step="1"
              min="0"
              max="240"
              value={termMonths}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setTermMonths(Math.max(0, Math.min(240, Math.round(n))));
              }}
            />
            <span>mo</span>
          </label>

          <label className={styles.gmField} title="Annual fee escalator applied to recurring (monthly) fees year-over-year.">
            Escalator
            <input
              className={styles.gmInput}
              type="number"
              step="0.5"
              min="0"
              max="50"
              value={Math.round(annualEscalator * 1000) / 10}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setAnnualEscalator(Math.max(0, Math.min(0.5, n / 100)));
              }}
            />
            <span>%/yr</span>
          </label>

          <label className={styles.gmField} title="Cost escalator applied to recurring (monthly) and rolled CTS costs year-over-year. Separate from the revenue escalator so margin can compress over time.">
            Cost Esc.
            <input
              className={styles.gmInput}
              type="number"
              step="0.05"
              min="0"
              max="50"
              value={Math.round(costEscalator * 10000) / 100}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setCostEscalator(Math.max(0, Math.min(0.5, n / 100)));
              }}
            />
            <span>%/yr</span>
          </label>

          <label className={styles.gmField} title="Tech depreciation rate applied as a derived column on each cost.">
            Tech Depr.
            <input
              className={styles.gmInput}
              type="number"
              step="0.5"
              min="0"
              max="50"
              value={Math.round(techDeprPct * 1000) / 10}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setTechDeprPct(Math.max(0, Math.min(0.5, n / 100)));
              }}
            />
            <span>%</span>
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
          <button className={styles.uploadBtn} onClick={() => fileInputRef.current?.click()}>
            {workbook ? 'Replace file' : 'Upload workbook'}
          </button>

          {workbook && (
            <>
              <button className={styles.actionBtn} onClick={exportCsv}>Export</button>
              <button
                className={styles.actionBtn}
                onClick={exportMonthlyCosts}
                title="Excel export of monthly CTS cost for every line item on the active Option, across the full term, with a totals row at the bottom."
              >
                Monthly costs ⇩
              </button>
              <button
                className={styles.actionBtn}
                onClick={exportMarginRequest}
                title="Fill the SE Margin Request Template with one block per Pricing Option: Services, Term, Alt Fee Structure, Margin, and Escalator."
              >
                Margin Request ⇩
              </button>
              <button className={styles.actionBtnDanger} onClick={clearAll}>Clear</button>
            </>
          )}
        </div>
      </div>

      {workbook && pageSubtab === 'pricing' && (
        <div style={{ padding: '0 1.25rem 0.5rem' }} className={styles.fileMeta}>
          <strong>{workbook.fileName}</strong>
          {' · '}
          {workbook.options.length} option sheet{workbook.options.length === 1 ? '' : 's'} found
          {(() => {
            const sites = workbook.options.find(o => typeof o.siteCount === 'number')?.siteCount;
            const accounts = workbook.options.find(o => typeof o.accountCount === 'number')?.accountCount;
            if (sites == null && accounts == null) return null;
            return (
              <>
                {' · '}
                {sites != null && <span title="Pulled from the SIA metadata block">{sites.toLocaleString()} site{sites === 1 ? '' : 's'}</span>}
                {sites != null && accounts != null && ' · '}
                {accounts != null && <span title="Pulled from the SIA metadata block">{accounts.toLocaleString()} account{accounts === 1 ? '' : 's'}</span>}
              </>
            );
          })()}
        </div>
      )}

      {error && (
        <div style={{ margin: '0 1.25rem 0.5rem', color: '#b91c1c' }}>{error}</div>
      )}

      {pageSubtab === 'pricing' && <PricingConversions />}

      <div className={styles.subtabStrip}>
        <button
          type="button"
          className={pageSubtab === 'pricing' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('pricing')}
        >
          Pricing
        </button>
        <button
          type="button"
          className={pageSubtab === 'linkedTo' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('linkedTo')}
        >
          Linked To
        </button>
        <button
          type="button"
          className={pageSubtab === 'options' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('options')}
        >
          Options
        </button>
        <button
          type="button"
          className={pageSubtab === 'compare' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('compare')}
        >
          Compare
        </button>
        <button
          type="button"
          className={pageSubtab === 'brokerFees' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('brokerFees')}
        >
          Broker Fees
        </button>
        <button
          type="button"
          className={pageSubtab === 's2c' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('s2c')}
        >
          S2C
        </button>
        <button
          type="button"
          className={pageSubtab === 'calculator' ? styles.subtabActive : styles.subtab}
          onClick={() => setPageSubtab('calculator')}
        >
          Calculator
        </button>
      </div>

      {pageSubtab === 'linkedTo' && (
        <LinkedToPanel
          workbook={workbook}
          activeOption={activeOption}
          setActiveOption={setActiveOption}
          overrides={overrides}
          linkedToDefaults={linkedToDefaults}
          linkedToUnitDefaults={linkedToUnitDefaults}
          setLinkedToUnitDefault={setLinkedToUnitDefault}
          linkedToStartMonthDefaults={linkedToStartMonthDefaults}
          setLinkedToStartMonthDefault={setLinkedToStartMonthDefault}
          linkedToPassThroughDefaults={linkedToPassThroughDefaults}
          setLinkedToPassThroughDefault={setLinkedToPassThroughDefault}
          altFees={altFees}
          resolvedLinkedTo={resolvedLinkedTo}
          effectiveType={effectiveType}
          linkedToDefaultKey={linkedToDefaultKey}
          removeLinkedToDefault={removeLinkedToDefault}
          lineItemServices={lineItemServices}
          setLineItemServices={setLineItemServices}
          lineItemIgnored={lineItemIgnored}
          setLineItemIgnored={setLineItemIgnored}
          solutionsOptions={solutionsOptions}
        />
      )}

      {pageSubtab === 'options' && (
        <OptionsTab
          options={optionsTabData || []}
          setOptions={setOptionsTabData}
        />
      )}

      {pageSubtab === 'compare' && (
        <CompareTab
          state={compareTabData}
          setState={setCompareTabData}
          workbook={workbook}
          resolvedLinkedTo={resolvedLinkedTo}
          effectiveType={effectiveType}
          techDeprPct={techDeprPct}
        />
      )}

      {pageSubtab === 'brokerFees' && (
        <BrokerFeesTab
          rows={brokerFeesData}
          setRows={setBrokerFeesData}
        />
      )}

      {pageSubtab === 's2c' && (
        <S2CTab
          rows={s2cTabData}
          setRows={setS2cTabData}
        />
      )}

      {pageSubtab === 'calculator' && <CalculatorTab />}

      <div className={styles.body} style={pageSubtab !== 'pricing' ? { display: 'none' } : undefined}>
        {!workbook && (
          <div className={styles.empty}>
            <div>No workbook loaded.</div>
            <div style={{ fontSize: 'var(--font-size-xs)' }}>
              Click <strong>Upload workbook</strong> above. We'll read every sheet named "Option 1" through "Option 5" — including hidden ones — and pull line items from the section bounded by <strong>Delivery Team Inputs</strong> at the top and <strong>Cost Summary</strong> at the bottom. Set a global GM% (gross margin) to apply across all rows, or override individual line items.
            </div>
          </div>
        )}

        {workbook && workbook.options.length > 0 && (() => {
          const opt = workbook.options.find(o => o.optionNumber === activeOption) || workbook.options[0];
          const t = totals?.[opt.optionNumber];
          // Sheet name doubles as the link label so the Pricing-subtab
          // chip matches what Opps 2 displays under "Pricing Option".
          const optionLabel = (opt.sheetName || '').trim();
          let linkedOppId = null;
          if (optionLabel) {
            for (const [id, v] of Object.entries(optionLinks)) {
              if (v === optionLabel) { linkedOppId = id; break; }
            }
          }
          const linkedOpp = linkedOppId
            ? opps2Records.find(r => String(r._id) === String(linkedOppId)) || null
            : null;
          const linkedLabel = linkedOpp
            ? `${linkedOpp.Account || '(no Account)'}${linkedOpp.Scope ? ` · ${linkedOpp.Scope}` : ''}`
            : (linkedOppId ? `(opp ${linkedOppId})` : null);
          return (
            <>
              <div className={styles.tabStrip}>
                {workbook.options.map(o => {
                  const isActive = o.optionNumber === opt.optionNumber;
                  return (
                    <button
                      key={o.sheetName}
                      type="button"
                      className={isActive ? styles.tabActive : styles.tab}
                      onClick={() => setActiveOption(o.optionNumber)}
                      title={o.solutionDescription || o.sheetName}
                    >
                      <span className={styles.tabLabel}>{o.sheetName}</span>
                      {o.hidden && <span className={styles.tabHidden} title="Hidden in source workbook">·</span>}
                      {o.isClone && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); deleteClonedOption(o.optionNumber); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteClonedOption(o.optionNumber);
                            }
                          }}
                          title="Delete this cloned option"
                          style={{
                            marginLeft: 6,
                            padding: '0 4px',
                            borderRadius: 999,
                            fontSize: '0.85em',
                            lineHeight: 1,
                            cursor: 'pointer',
                            opacity: 0.75,
                          }}
                        >×</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className={styles.optionPanel}>
                <div className={styles.optionPanelHeader}>
                  <div className={styles.optionHeaderLeft}>
                    <h2 className={styles.optionTitle}>{opt.sheetName}</h2>
                    {opt.hidden && <span className={styles.hiddenPill}>hidden in workbook</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={exportCommercialRef}
                      title={`Export "${opt.sheetName}" cost line items as a Commercial Reference CSV. Monthly costs are annualized (×12); Quantity is always 1.`}
                    >Commercial Ref ⇩</button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={cloneActiveOption}
                      title={`Clone "${opt.sheetName}" into a new Option on this workbook. The clone is temporary — it goes away when you remove or replace the file.`}
                    >Clone option</button>
                    {linkedLabel ? (
                      <span
                        className={styles.savedChip}
                        title={`Linked to Opps row: ${linkedLabel}`}
                      >
                        Saved to: {linkedLabel}
                        <button
                          type="button"
                          className={styles.savedChipClear}
                          onClick={() => {
                            if (linkedOppId) setOppOptionLink(linkedOppId, '').catch(() => {});
                          }}
                          title="Unlink from this Opp"
                        >×</button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => {
                          if (!optionLabel) {
                            window.alert('This Option has no sheet name to link.');
                            return;
                          }
                          setPricingPickerOpen(true);
                        }}
                        title={`Save "${opt.sheetName}" to an Opps row.`}
                      >Save to Opp…</button>
                    )}
                    <ColumnsMenu
                      open={colMenuOpen}
                      onToggle={() => setColMenuOpen(o => !o)}
                      columns={COLS}
                      hiddenFn={colHidden}
                      onItemToggle={toggleColVisible}
                    />
                    {t && (
                      <div className={styles.optionSummary}>
                        <span>Cost: <span className={styles.summaryNum}>{fmtMoney(t.cost)}</span></span>
                        <span>Marked-up: <span className={styles.summaryNum}>{fmtMoney(t.price)}</span></span>
                      </div>
                    )}
                  </div>
                </div>

                {(typeof opt.siteCount === 'number' || typeof opt.accountCount === 'number') && (
                  <div className={styles.optionMeta} title="Pulled from the SIA metadata block on this Option sheet">
                    {typeof opt.siteCount === 'number' && (
                      <>{opt.siteCount.toLocaleString()} site{opt.siteCount === 1 ? '' : 's'}</>
                    )}
                    {typeof opt.siteCount === 'number' && typeof opt.accountCount === 'number' && ' · '}
                    {typeof opt.accountCount === 'number' && (
                      <>{opt.accountCount.toLocaleString()} account{opt.accountCount === 1 ? '' : 's'}</>
                    )}
                  </div>
                )}

                {opt.solutionDescription && (
                  <div className={styles.solutionDesc}>{opt.solutionDescription}</div>
                )}
                {opt.sections.length === 0 && (
                  <div className={styles.diagnostic}>
                    <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>
                      No line items detected on this sheet.
                    </div>
                    <div style={{ marginBottom: '0.5rem' }}>
                      The parser skips the first 18 rows of metadata, then looks for tables whose header row contains <em>Line Item + Type + CTS</em> (Cost to Serve), stopping at <em>Cost Summary</em>. Below are the {opt.rawSample?.length || 0} rows we read inside that range on <strong>{opt.sheetName}</strong>; if you can spot the line-item table here, share a screenshot of the relevant rows and I'll tune the detection.
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                      Cells in sheet: {opt.cellCount ?? '?'} ·
                      Range: {opt.refUsed || '(none)'} ·
                      Total rows read: {opt.totalRows ?? '?'} ·
                      Cost Summary row: {opt.endIdx >= 0 ? opt.endIdx + 1 : 'not found'}
                    </div>
                    <div className={styles.rawScroll}>
                      <table className={styles.rawTable}>
                        <tbody>
                          {(opt.rawSample || []).map((row, ri) => (
                            <tr key={ri}>
                              <td className={styles.rawIdx}>{(opt.rawSampleOffset ?? 0) + ri + 1}</td>
                              {row.map((cell, ci) => (
                                <td key={ci}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {(() => {
                  const flatItems = opt.sections.flatMap(s => s.items);
                  if (flatItems.length === 0) return null;
                  // Predictive-text suggestions for the per-row Linked
                  // To input. Unions every tag the user has touched —
                  // saved (Line Item, Type) defaults, alt-fee rows on
                  // this option, and per-row overrides — deduped
                  // case-insensitively while preserving the original
                  // casing for display. The raw auto-derived union is
                  // kept separate so the ± options manager can tell
                  // auto tags from hand-added ones; the dropdown itself
                  // then folds in the user's custom options and drops
                  // the removed (hidden) ones.
                  const linkedToAutoTags = (() => {
                    const seen = new Map();
                    const add = (name) => {
                      const trimmed = String(name || '').trim();
                      if (!trimmed) return;
                      const k = trimmed.toLowerCase();
                      if (!seen.has(k)) seen.set(k, trimmed);
                    };
                    for (const v of Object.values(linkedToDefaults)) add(v);
                    for (const r of (altFees[opt.optionNumber] || [])) add(r.altItem);
                    for (const o of Object.values(overrides)) if (o?.linkedTo) add(o.linkedTo);
                    return [...seen.values()];
                  })();
                  const linkedToSuggestions = (() => {
                    const hiddenTags = new Set((linkedToOptionsList.hidden || []).map(s => String(s).trim().toLowerCase()));
                    const seen = new Map();
                    for (const name of [...linkedToAutoTags, ...(linkedToOptionsList.custom || [])]) {
                      const trimmed = String(name || '').trim();
                      if (!trimmed) continue;
                      const k = trimmed.toLowerCase();
                      if (!seen.has(k) && !hiddenTags.has(k)) seen.set(k, trimmed);
                    }
                    return [...seen.values()].sort((a, b) => a.localeCompare(b));
                  })();
                  const totalCost = flatItems.reduce((s, i) => s + (typeof i.cts === 'number' ? i.cts : 0), 0);
                  const totalPrice = flatItems.reduce((s, i) => {
                    const { price } = priceFor(i);
                    return s + (typeof price === 'number' ? price : 0);
                  }, 0);
                  // Aggregate by effective Type for the summary panel.
                  // "Rolled" variants amortize the cost across the term and
                  // project with the annual escalator (same shape as the
                  // recurring-monthly projection). Plain Setup / One Time
                  // contribute their face value to the term column.
                  const sumByType = (typeRe, isRecurring) => flatItems.reduce((acc, i) => {
                    const t = effectiveType(i);
                    if (!typeRe.test(t)) return acc;
                    const { price } = priceFor(i);
                    const isRolled = /\brolled\b/i.test(t);
                    const itemPassThrough = isPassThrough(i);
                    if (typeof i.cts === 'number') {
                      acc.cost += i.cts;
                      // Tech depreciation is applied only to non-pass-through
                      // cost — pass-through rows are billed at face cost so
                      // we don't book any depreciation against them.
                      if (!itemPassThrough) acc.depreciableCost += i.cts;
                    }
                    if (typeof price === 'number') acc.price += price;

                    if (isRecurring) {
                      acc.termCost += projectMonthlyOverTerm(i.cts ?? null, costEscalator, termMonths);
                      acc.termPrice += projectMonthlyOverTerm(price ?? null, annualEscalator, termMonths);
                    } else if (isRolled && termMonths > 0) {
                      // Rolled: revenue is amortized over the term so
                      // termPrice still projects with the escalator,
                      // but the cost is booked upfront (full face
                      // value, no projection) so margin math reflects
                      // when we actually pay.
                      const monthlyPrice = typeof price === 'number' ? price / termMonths : null;
                      if (typeof i.cts === 'number') acc.termCost += i.cts;
                      acc.termPrice += projectMonthlyOverTerm(monthlyPrice, annualEscalator, termMonths);
                    } else {
                      if (typeof i.cts === 'number') acc.termCost += i.cts;
                      if (typeof price === 'number') acc.termPrice += price;
                    }
                    return acc;
                  }, { cost: 0, depreciableCost: 0, price: 0, termCost: 0, termPrice: 0 });
                  // Setup and One Time (and their Rolled variants) share
                  // a single bucket for fee/margin math, but the Totals
                  // by Type table below still breaks them out so the
                  // user can see what each contributes.
                  const setup = sumByType(/^setup(\s+rolled)?$/i, false);
                  const oneTime = sumByType(/^one\s*time(\s+rolled)?$/i, false);
                  const setupOneTime = {
                    cost: setup.cost + oneTime.cost,
                    depreciableCost: setup.depreciableCost + oneTime.depreciableCost,
                    price: setup.price + oneTime.price,
                    termCost: setup.termCost + oneTime.termCost,
                    termPrice: setup.termPrice + oneTime.termPrice,
                  };
                  const recurring = sumByType(/recurring.*monthly|monthly.*recurring|^recurring/i, true);
                  const grandTermCost = setupOneTime.termCost + recurring.termCost;
                  const grandTermPrice = setupOneTime.termPrice + recurring.termPrice;
                  return (
                    <div className={styles.section}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            {COLS.filter(c => !colHidden(c.key)).map(col => (
                              <th
                                key={col.key}
                                style={{ width: colWidths[col.key] ?? col.defaultWidth }}
                              >
                                <span className={styles.thInner}>
                                  <span className={styles.thLabel}>{col.label}</span>
                                  {col.key === 'linkedTo' && (
                                    <button
                                      type="button"
                                      onClick={() => setLinkedToOptionsModal({ autoTags: linkedToAutoTags })}
                                      title="Add or remove options in the Linked To dropdown"
                                      style={{ marginLeft: 4, padding: '0 5px', border: '1px solid var(--color-border)', borderRadius: 3, background: '#fff', fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', cursor: 'pointer', lineHeight: 1.4, fontFamily: 'inherit' }}
                                    >±</button>
                                  )}
                                  <span
                                    className={styles.colResizer}
                                    onMouseDown={(e) => startColResize('main', col.key, e)}
                                    title="Drag to resize column"
                                  />
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {flatItems.map(item => {
                            const { gm, source, price } = priceFor(item);
                            const overrideVal = overrides[item.id]?.gmPct;
                            const passThrough = isPassThrough(item);
                            const techDepr = (typeof item.cts === 'number' && !passThrough) ? item.cts * techDeprPct : (passThrough ? 0 : null);
                            return (
                              <tr key={item.id} className={passThrough ? styles.passThroughRow : undefined}>
                                {!colHidden('lineItem') && <td>{item.description}</td>}
                                {!colHidden('type') && (
                                  <td>
                                    {(() => {
                                      const t = effectiveType(item);
                                      const knownOptions = ['Setup', 'Setup Rolled', 'One Time', 'One Time Rolled', 'Recurring (monthly)'];
                                      return (
                                        <select
                                          className={styles.typeSelect}
                                          value={t}
                                          onChange={(e) => setItemType(item.id, e.target.value)}
                                          title="Click to change type. 'Rolled' variants amortize the cost over the term but still bucket under Setup or One Time."
                                        >
                                          {t && !knownOptions.includes(t) && <option value={t}>{t}</option>}
                                          <option value="">—</option>
                                          <option value="Setup">Setup</option>
                                          <option value="Setup Rolled">Setup Rolled</option>
                                          <option value="One Time">One Time</option>
                                          <option value="One Time Rolled">One Time Rolled</option>
                                          <option value="Recurring (monthly)">Recurring (monthly)</option>
                                        </select>
                                      );
                                    })()}
                                  </td>
                                )}
                                {!colHidden('cts') && <td className={styles.numCell}>{item.cts === null || item.cts === undefined ? '' : fmtMoney(item.cts)}</td>}
                                {!colHidden('techDepr') && (
                                  <td className={styles.numCell} title={`${(techDeprPct * 100).toFixed(1)}% of CTS`}>
                                    {techDepr === null ? '' : fmtMoney(techDepr)}
                                  </td>
                                )}
                                {!colHidden('start') && <td>{item.startMonth || ''}</td>}
                                {!colHidden('comments') && <td>{item.comments || ''}</td>}
                                {!colHidden('gm') && (
                                  <td className={styles.gmCell}>
                                    <GmInput
                                      key={`${item.id}:${passThrough ? 'pass' : (overrideVal === undefined ? 'unset' : overrideVal)}`}
                                      initialPct={passThrough ? null : (overrideVal !== undefined ? overrideVal * 100 : null)}
                                      isOverride={!passThrough && overrideVal !== undefined}
                                      placeholder={passThrough ? 'pass' : (gm === null ? '' : `${Math.round(gm * 100)}%`)}
                                      disabled={passThrough}
                                      title={
                                        passThrough
                                          ? 'Pass-through row — billed to the customer at cost. Untick Pass-through to apply markup.'
                                          : source === 'override'
                                          ? 'Per-line override. Clear to revert to global GM%.'
                                          : source === 'global'
                                          ? `Using global GM% (${fmtPct(globalGmPct)}). Type a value to override.`
                                          : source === 'sheet'
                                          ? `Using sheet GM% (${fmtPct(item.gmPct)}). Type a value to override.`
                                          : 'No GM% set.'
                                      }
                                      onCommit={(raw) => setItemGm(item.id, raw)}
                                    />
                                  </td>
                                )}
                                {!colHidden('price') && <td className={styles.priceCell}>{fmtMoney(price)}</td>}
                                {!colHidden('passThrough') && (
                                  <td className={styles.passThroughCell}>
                                    <label className={styles.passThroughLabel} title="Bill this row to the customer at cost (no markup). The line still appears in totals but contributes zero margin.">
                                      <input
                                        type="checkbox"
                                        checked={passThrough}
                                        onChange={(e) => setItemPassThrough(item.id, e.target.checked, item)}
                                      />
                                      <span>Pass-through</span>
                                    </label>
                                  </td>
                                )}
                                {!colHidden('linkedTo') && (
                                  <td>
                                    {(() => {
                                      const effType = effectiveType(item);
                                      const key = linkedToDefaultKey(item.description, effType);
                                      const savedDefault = linkedToDefaults[key] || '';
                                      const currentVal = resolvedLinkedTo(item);
                                      const isFromDefault = overrides[item.id]?.linkedTo === undefined && !!savedDefault;
                                      const matchesDefault = !!savedDefault && savedDefault === currentVal.trim();
                                      const canSetDefault = !!currentVal.trim() && !matchesDefault;
                                      const canClearDefault = matchesDefault;
                                      return (
                                        <div className={styles.linkedCell}>
                                          <LinkedToInput
                                            key={`linked:${item.id}:${currentVal}`}
                                            initial={currentVal}
                                            isDefault={isFromDefault}
                                            onCommit={(raw) => setItemLinkedTo(item, raw)}
                                            suggestions={linkedToSuggestions}
                                          />
                                          <button
                                            type="button"
                                            className={`${styles.defaultStar} ${matchesDefault ? styles.defaultStarOn : ''}`}
                                            onClick={() => toggleLinkedToDefault(item)}
                                            disabled={!canSetDefault && !canClearDefault}
                                            title={
                                              matchesDefault
                                                ? `Default for "${item.description}" · ${effType || '(no type)'}. Click to clear.`
                                                : canSetDefault
                                                ? `Save "${currentVal}" as the default for "${item.description}" · ${effType || '(no type)'}.`
                                                : 'Type a value above, then click to save it as the default.'
                                            }
                                          >
                                            {matchesDefault ? '★' : '☆'}
                                          </button>
                                        </div>
                                      );
                                    })()}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                          {(() => {
                            const totalDepr = flatItems.reduce((s, i) => s + ((typeof i.cts === 'number' && !isPassThrough(i)) ? i.cts * techDeprPct : 0), 0);
                            const cells = [];
                            COLS.filter(c => !colHidden(c.key)).forEach(col => {
                              switch (col.key) {
                                case 'lineItem':
                                  cells.push(<td key={col.key}>Total</td>);
                                  break;
                                case 'cts':
                                  cells.push(<td key={col.key} className={styles.numCell}>{fmtMoney(totalCost)}</td>);
                                  break;
                                case 'techDepr':
                                  cells.push(<td key={col.key} className={styles.numCell}>{fmtMoney(totalDepr)}</td>);
                                  break;
                                case 'price':
                                  cells.push(<td key={col.key} className={styles.priceCell}>{fmtMoney(totalPrice)}</td>);
                                  break;
                                default:
                                  cells.push(<td key={col.key} />);
                              }
                            });
                            return <tr className={styles.totalsRow}>{cells}</tr>;
                          })()}
                        </tbody>
                      </table>

                      <div className={styles.bottomRow}>
                      <div className={styles.summaryPanel}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                          <h3 className={styles.summaryTitle} style={{ margin: 0 }}>Totals by type</h3>
                          <ColumnsMenu
                            open={summaryMenuOpen}
                            onToggle={() => setSummaryMenuOpen(o => !o)}
                            columns={SUMMARY_COLS}
                            hiddenFn={summaryColHidden}
                            onItemToggle={toggleSummaryColVisible}
                          />
                        </div>
                        <div className={styles.summaryMeta}>
                          Term:{' '}
                          <input
                            className={styles.metaInput}
                            type="number"
                            step="1"
                            min="0"
                            max="240"
                            value={termMonths}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              setTermMonths(Math.max(0, Math.min(240, Math.round(n))));
                            }}
                          />
                          {' '}months · Annual escalator:{' '}
                          <input
                            className={styles.metaInput}
                            type="number"
                            step="0.5"
                            min="0"
                            max="50"
                            value={Math.round(annualEscalator * 1000) / 10}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              setAnnualEscalator(Math.max(0, Math.min(0.5, n / 100)));
                            }}
                          />
                          % · Cost escalator:{' '}
                          <input
                            className={styles.metaInput}
                            type="number"
                            step="0.05"
                            min="0"
                            max="50"
                            value={Math.round(costEscalator * 10000) / 100}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              setCostEscalator(Math.max(0, Math.min(0.5, n / 100)));
                            }}
                          />
                          % · Tech depr:{' '}
                          <input
                            className={styles.metaInput}
                            type="number"
                            step="0.5"
                            min="0"
                            max="50"
                            value={Math.round(techDeprPct * 1000) / 10}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              setTechDeprPct(Math.max(0, Math.min(0.5, n / 100)));
                            }}
                          />
                          %
                        </div>
                        {(() => {
                          const cellClassFor = (k) => k === 'bucket' ? '' : (k === 'cost' || k === 'techDepr' || k === 'totalCost') ? styles.numCell : styles.priceCell;
                          const renderHeaders = () => SUMMARY_COLS.filter(c => !summaryColHidden(c.key)).map(col => (
                            <th key={col.key} style={{ width: summaryColWidths[col.key] ?? col.defaultWidth }} className={cellClassFor(col.key)}>
                              <span className={styles.thInner}>
                                <span className={styles.thLabel}>{col.label}</span>
                                <span
                                  className={styles.colResizer}
                                  onMouseDown={(e) => startColResize('summary', col.key, e)}
                                  title="Drag to resize column"
                                />
                              </span>
                            </th>
                          ));
                          const renderRow = (label, vals) => (
                            <tr>
                              {SUMMARY_COLS.filter(c => !summaryColHidden(c.key)).map(col => {
                                if (col.key === 'bucket') return <td key={col.key}>{label}</td>;
                                const v = vals[col.key];
                                return <td key={col.key} className={cellClassFor(col.key)}>{typeof v === 'number' ? fmtMoneyWhole(v) : ''}</td>;
                              })}
                            </tr>
                          );
                          // Year-1 annualized basis for the per-period
                          // columns (Cost / Tech Depr / Total cost /
                          // Marked-up). Setup and One Time hit Y1 in
                          // full; Recurring multiplies the monthly
                          // figure by 12 so the bucket reads as the
                          // year's run-rate instead of a single month.
                          // "Term value (marked-up)" stays projected
                          // over the full term.
                          const recAnnualCost  = recurring.cost  * 12;
                          const recAnnualPrice = recurring.price * 12;
                          const recAnnualDeprCost = recurring.depreciableCost * 12;
                          const summaryY1Cost  = setupOneTime.cost + recAnnualCost;
                          const summaryY1Price = setupOneTime.price + recAnnualPrice;
                          // Tech depreciation excludes pass-through rows
                          // — their cost is billed straight through and
                          // doesn't accrue a depreciation charge.
                          const summaryY1Depr  = (setupOneTime.depreciableCost + recAnnualDeprCost) * techDeprPct;
                          const setupDepr = setup.depreciableCost * techDeprPct;
                          const oneTimeDepr = oneTime.depreciableCost * techDeprPct;
                          const recurringDepr = recurring.depreciableCost * techDeprPct;
                          const recurringAnnualDepr = recAnnualDeprCost * techDeprPct;
                          return (
                            <table className={styles.summaryTable}>
                              <thead><tr>{renderHeaders()}</tr></thead>
                              <tbody>
                                {renderRow('Setup', { cost: setup.cost, techDepr: setupDepr, totalCost: setup.cost + setupDepr, price: setup.price, termPrice: setup.termPrice })}
                                {(oneTime.cost > 0 || oneTime.price > 0) && renderRow('One Time', { cost: oneTime.cost, techDepr: oneTimeDepr, totalCost: oneTime.cost + oneTimeDepr, price: oneTime.price, termPrice: oneTime.termPrice })}
                                {renderRow('Recurring (monthly)', { cost: recurring.cost, techDepr: recurringDepr, totalCost: recurring.cost + recurringDepr, price: recurring.price })}
                                {renderRow('Recurring (annual)', { cost: recAnnualCost, techDepr: recurringAnnualDepr, totalCost: recAnnualCost + recurringAnnualDepr, price: recAnnualPrice, termPrice: recurring.termPrice })}
                                <tr className={styles.summaryGrandRow}>
                                  {SUMMARY_COLS.filter(c => !summaryColHidden(c.key)).map(col => {
                                    if (col.key === 'bucket') return <td key={col.key}>Total contract value</td>;
                                    const map = {
                                      cost: summaryY1Cost,
                                      techDepr: summaryY1Depr,
                                      totalCost: summaryY1Cost + summaryY1Depr,
                                      price: summaryY1Price,
                                      termPrice: grandTermPrice,
                                    };
                                    return <td key={col.key} className={cellClassFor(col.key)}>{fmtMoneyWhole(map[col.key])}</td>;
                                  })}
                                </tr>
                              </tbody>
                            </table>
                          );
                        })()}
                      </div>

                      {(() => {
                        // Year 1 cash-flow check. Revenue: sum
                        // altFeeYearRevenue(row, 1) over this option's
                        // alt-fee rows. Cost: per item, Setup / One
                        // Time hit Y1 in full; Rolled variants also
                        // book the full cost upfront (billing is
                        // amortized but the cost has already been
                        // incurred); Recurring (monthly) charges 12
                        // months of cost in Y1 at face value (escalator
                        // only kicks in from Y2). If revenue − cost is
                        // negative, flag it.
                        const flatItems = opt.sections.flatMap(s => s.items);
                        const y1Cost = flatItems.reduce((acc, i) => {
                          if (typeof i.cts !== 'number') return acc;
                          // Effective cost folds in tech depr for
                          // non-pass-through rows so the warning
                          // matches the Linked CTS cost row in the
                          // Alt Fee summary.
                          const c = ctsItemEffectiveCost(i);
                          if (!c) return acc;
                          const t = effectiveType(i);
                          const isRecurring = /recurring.*monthly|monthly.*recurring|^recurring/i.test(t);
                          if (isRecurring) return acc + c * 12;
                          return acc + c;
                        }, 0);
                        const y1Revenue = (altFees[opt.optionNumber] || [])
                          .reduce((s, r) => s + altFeeYearRevenue(r, 1), 0);
                        const y1CashFlow = y1Revenue - y1Cost;
                        if (y1CashFlow >= 0) return null;
                        const fmtAbs = (n) => Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        return (
                          <div className={styles.year1Warning} role="alert">
                            ⚠ Negative cash flow in Year 1 — projected revenue {fmtAbs(y1Revenue)} vs cost {fmtAbs(y1Cost)} (shortfall {fmtAbs(y1CashFlow)}). Consider restructuring fees or shifting Setup costs.
                          </div>
                        );
                      })()}

                      {(() => {
                        // Suggestion list for the altItem combobox:
                        // every distinct Linked To tag used by a CTS
                        // row on this option (override or saved default),
                        // plus tags already typed on alt-fee rows.
                        // Free-text entry is still allowed.
                        const seen = new Map();
                        const add = (name) => {
                          const trimmed = (name || '').trim();
                          if (!trimmed) return;
                          const k = trimmed.toLowerCase();
                          if (!seen.has(k)) seen.set(k, trimmed);
                        };
                        for (const sec of opt.sections) {
                          for (const it of sec.items) add(resolvedLinkedTo(it));
                        }
                        for (const r of (altFees[opt.optionNumber] || [])) add(r.altItem);
                        const altItemSuggestions = [...seen.values()].sort((a, b) => a.localeCompare(b));

                        // Linked-CTS cost per year: every CTS row on
                        // this option whose resolved Linked To
                        // matches an alt-fee tag contributes its
                        // ctsItemYearCost(year) into that year's
                        // bucket. Used by the table's Deal-margin row
                        // so margin = (totalFee - totalCost) / totalFee.
                        const altTagSet = new Set(
                          (altFees[opt.optionNumber] || [])
                            .map(r => (r.altItem || '').trim().toLowerCase())
                            .filter(Boolean)
                        );
                        const numYearsLocal = Math.max(1, Math.ceil(termMonths / 12));
                        // Per-year cost split into all linked CTS cost
                        // vs the pass-through subset. Pass-through cost
                        // is also the matching revenue (pass-through
                        // bills at face), so the Deal-margin row can
                        // subtract it from both sides of the ratio.
                        const passThroughByYear = Array.from({ length: numYearsLocal }, () => 0);
                        // Revenue-side mirror of passThroughByYear used
                        // by the "Revenue less pass-through" totals row.
                        // For each pass-through CTS row we contribute
                        // round(cts/uc, 2) × uc instead of the raw cts
                        // value, where uc is the linked alt-fee row's
                        // unit count. That matches what actually lands
                        // in Total fee (the auto-fee per unit is rounded
                        // to two decimals before being multiplied back
                        // out), so revLessPass = Total fee − passRev
                        // doesn't carry a phantom margin from per-unit
                        // rounding.
                        const passThroughRevenueByYear = Array.from({ length: numYearsLocal }, () => 0);
                        const altRowsForOpt = altFees[opt.optionNumber] || [];
                        const altRowByTag = new Map();
                        for (const r of altRowsForOpt) {
                          const k = (r.altItem || '').trim().toLowerCase();
                          if (k && !altRowByTag.has(k)) altRowByTag.set(k, r);
                        }
                        // Round the per-unit cost the same way auto-fee
                        // rounds (see autoFeePerUnitFor) and run it
                        // through ctsItemYearCost via a shim object so
                        // the year / startMonth / escalator logic stays
                        // in one place.
                        function ctsItemPassThroughRevenue(it, yearIndex) {
                          const tag = resolvedLinkedTo(it).trim().toLowerCase();
                          const altRow = tag ? altRowByTag.get(tag) : null;
                          const uc = altRow ? Number(altRow.unitCount) : NaN;
                          if (!altRow || !Number.isFinite(uc) || uc <= 0) {
                            return ctsItemYearCost(it, yearIndex);
                          }
                          const rounded = Math.round((it.cts / uc) * 100) / 100;
                          const shim = { ...it, cts: rounded * uc };
                          return ctsItemYearCost(shim, yearIndex);
                        }
                        const costByYear = Array.from({ length: numYearsLocal }, (_, yi) => {
                          let sum = 0;
                          for (const sec of opt.sections) {
                            for (const it of sec.items) {
                              const tag = resolvedLinkedTo(it).trim().toLowerCase();
                              if (!tag || !altTagSet.has(tag)) continue;
                              const c = ctsItemYearCost(it, yi + 1);
                              sum += c;
                              if (isPassThrough(it)) {
                                passThroughByYear[yi] += c;
                                passThroughRevenueByYear[yi] += ctsItemPassThroughRevenue(it, yi + 1);
                              }
                            }
                          }
                          return sum;
                        });

                        // Cost line items whose Linked To doesn't match any
                        // alt-fee tag in this section — either blank or a
                        // tag with no corresponding fee row. Their cost is
                        // invisible to the Deal-margin / Linked CTS totals
                        // above, so flag them. Aggregate distinct items
                        // (description + type + tag) and sum their face cost.
                        const unlinkedByKey = new Map();
                        for (const sec of opt.sections) {
                          for (const it of sec.items) {
                            const cost = ctsItemEffectiveCost(it);
                            if (!(cost > 0)) continue;
                            const tag = resolvedLinkedTo(it).trim();
                            if (tag && altTagSet.has(tag.toLowerCase())) continue;
                            const type = effectiveType(it);
                            const desc = String(it.description || '').trim() || '(unnamed line item)';
                            const key = `${desc.toLowerCase()}|${type.toLowerCase()}|${tag.toLowerCase()}`;
                            const prev = unlinkedByKey.get(key);
                            if (prev) { prev.cost += cost; }
                            else unlinkedByKey.set(key, { desc, type, tag, cost });
                          }
                        }
                        const unlinkedCostItems = [...unlinkedByKey.values()]
                          .sort((a, b) => b.cost - a.cost);

                        return (
                          <>
                          {unlinkedCostItems.length > 0 && (
                            <div className={styles.unlinkedWarning} role="alert">
                              <strong>
                                ⚠ {unlinkedCostItems.length} cost line item{unlinkedCostItems.length === 1 ? '' : 's'} not linked to any fee in this section
                              </strong>
                              {' '}— their cost isn&apos;t captured in the Deal margin / Linked CTS totals. Set each row&apos;s Linked To to a fee tag.
                              <ul>
                                {unlinkedCostItems.map((u, i) => (
                                  <li key={`unlinked-${i}`}>
                                    {u.desc}
                                    {u.type ? ` · ${u.type}` : ''}
                                    {' '}
                                    <span className={styles.unlinkedNote}>
                                      ({u.tag ? <>Linked To &ldquo;<span className={styles.unlinkedTag}>{u.tag}</span>&rdquo; — no matching fee</> : 'no Linked To'}
                                      {`, cost ${fmtMoney(u.cost)}`})
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <AltFeeTable
                            rows={altFees[opt.optionNumber] || altFeeStarter()}
                            globalGmPct={globalGmPct}
                            marginFor={altFeeMarginFor}
                            yearRevenue={altFeeYearRevenue}
                            autoFeeFor={autoFeePerUnitFor}
                            autoStartMonthFor={autoStartMonthFor}
                            siteCount={opt.siteCount}
                            accountCount={opt.accountCount}
                            altItemSuggestions={altItemSuggestions}
                            costByYear={costByYear}
                            passThroughByYear={passThroughByYear}
                            passThroughRevenueByYear={passThroughRevenueByYear}
                            numYears={numYearsLocal}
                            onChange={(idx, field, value) => updateAltFeeCell(opt.optionNumber, idx, field, value)}
                            onAddRow={() => addAltFeeRow(opt.optionNumber)}
                            onMoveRow={(from, to) => moveAltFeeRow(opt.optionNumber, from, to)}
                            onRemoveRow={(idx) => removeAltFeeRow(opt.optionNumber, idx)}
                            onReplaceRows={(rows) => replaceAltFeeRows(opt.optionNumber, rows)}
                            onAppendRows={(rows) => appendAltFeeRows(opt.optionNumber, rows)}
                            onClearRows={() => replaceAltFeeRows(opt.optionNumber, altFeeStarter())}
                          />
                          </>
                        );
                      })()}
                      </div>

                      {(() => {
                        // Build list of unique tags from this Option:
                        // every alt-fee row's altItem + every linked-to
                        // value (override + saved default) on a CTS row.
                        const seen = new Map(); // canonical key -> displayed name
                        const add = (name) => {
                          const trimmed = (name || '').trim();
                          if (!trimmed) return;
                          const k = trimmed.toLowerCase();
                          if (!seen.has(k)) seen.set(k, trimmed);
                        };
                        for (const r of (altFees[opt.optionNumber] || [])) add(r.altItem);
                        for (const sec of opt.sections) {
                          for (const it of sec.items) add(resolvedLinkedTo(it));
                        }
                        const tagOptions = [...seen.values()].sort((a, b) => a.localeCompare(b));
                        const tag = chartTag && seen.has(chartTag.toLowerCase())
                          ? seen.get(chartTag.toLowerCase())
                          : (tagOptions[0] || '');
                        const numYears = Math.max(1, Math.ceil(termMonths / 12));
                        const years = Array.from({ length: numYears }, (_, i) => i + 1);
                        const target = (tag || '').trim().toLowerCase();
                        const linkedItems = target
                          ? opt.sections.flatMap(s => s.items).filter(i => resolvedLinkedTo(i).trim().toLowerCase() === target)
                          : [];
                        const matchingAltRows = target
                          ? (altFees[opt.optionNumber] || []).filter(r => (r.altItem || '').trim().toLowerCase() === target)
                          : [];
                        // Fee comes from Alternative Fee rows sharing the
                        // tag. When the tag has none (it was only tagged on
                        // CTS rows' Linked To for cost), fall back to the
                        // marked-up-price revenue of those linked CTS rows so
                        // the Fee and Margin still populate. Decide the source
                        // once for the whole line item — never mix alt-fee and
                        // CTS revenue across years — so a one-time alt fee in
                        // Y1 doesn't leak CTS revenue into later years.
                        const altRevenueByYear = years.map(y => matchingAltRows.reduce((s, r) => s + altFeeYearRevenue(r, y), 0));
                        const useAltRevenue = altRevenueByYear.some(v => v > 0);
                        const chartData = years.map((y, i) => {
                          const cost = linkedItems.reduce((s, it) => s + ctsItemYearCost(it, y), 0);
                          const fee = useAltRevenue
                            ? altRevenueByYear[i]
                            : linkedItems.reduce((s, it) => s + ctsItemYearRevenue(it, y), 0);
                          return { year: `Y${y}`, Cost: Math.round(cost), Fee: Math.round(fee) };
                        });
                        // Unit count for the Fee / Unit column. Use the value
                        // the user typed for this line item; if they haven't
                        // typed one, fall back to the total unit count on the
                        // matching Alternative Fee rows so the column is
                        // populated out of the box when that data exists.
                        const storedUnits = chartUnitCounts[target];
                        const typedUnits = Number(storedUnits);
                        const hasTypedUnits = storedUnits != null && storedUnits !== ''
                          && Number.isFinite(typedUnits) && typedUnits > 0;
                        const autoUnits = matchingAltRows.reduce((s, r) => {
                          const uc = Number(r.unitCount);
                          return s + (Number.isFinite(uc) ? uc : 0);
                        }, 0);
                        const unitCount = hasTypedUnits ? typedUnits : autoUnits;
                        const hasUnits = Number.isFinite(unitCount) && unitCount > 0;
                        return (
                          <div className={styles.chartPanel}>
                            <div className={styles.chartHeader}>
                              <h3 className={styles.summaryTitle} style={{ margin: 0 }}>Line item year-over-year</h3>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                {chartVisible && (
                                  <>
                                    <div className={styles.viewToggle}>
                                      <button
                                        type="button"
                                        className={chartView === 'chart' ? styles.viewToggleOn : styles.viewToggleBtn}
                                        onClick={() => setChartView('chart')}
                                      >Chart</button>
                                      <button
                                        type="button"
                                        className={chartView === 'table' ? styles.viewToggleOn : styles.viewToggleBtn}
                                        onClick={() => setChartView('table')}
                                      >Table</button>
                                    </div>
                                    <label className={styles.chartTagLabel}>
                                      Line item:{' '}
                                      <select
                                        className={styles.chartTagSelect}
                                        value={tag}
                                        onChange={(e) => setChartTag(e.target.value)}
                                        disabled={tagOptions.length === 0}
                                      >
                                        {tagOptions.length === 0 && <option value="">(no tagged items yet)</option>}
                                        {tagOptions.map(t => <option key={t} value={t}>{t}</option>)}
                                      </select>
                                    </label>
                                    <label className={styles.chartTagLabel} title="Number of units for this line item. The Fee / Unit column divides each year's fee by this count.">
                                      Units:{' '}
                                      <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        className={styles.chartTagSelect}
                                        style={{ width: '5.5rem' }}
                                        value={target ? (chartUnitCounts[target] ?? '') : ''}
                                        placeholder={autoUnits > 0 ? String(autoUnits) : '—'}
                                        disabled={!target}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setChartUnitCounts(m => ({ ...m, [target]: v }));
                                        }}
                                      />
                                    </label>
                                  </>
                                )}
                                <button
                                  type="button"
                                  className={styles.viewToggleBtn}
                                  onClick={() => setChartVisible(v => !v)}
                                  title={chartVisible ? 'Hide the line item year-over-year breakdown' : 'Show the line item year-over-year breakdown'}
                                >{chartVisible ? 'Hide' : 'Show'}</button>
                              </div>
                            </div>
                            {chartVisible && (tag ? (
                              chartView === 'table' ? (
                                <table className={styles.summaryTable}>
                                  <thead>
                                    <tr>
                                      <th>Year</th>
                                      <th className={styles.numCell}>Cost</th>
                                      <th className={styles.priceCell}>Fee</th>
                                      <th className={styles.priceCell} title={hasUnits ? `Fee ÷ ${unitCount.toLocaleString('en-US')} units` : 'Enter a unit count above to see fee per unit'}>Fee / Unit</th>
                                      <th className={styles.priceCell}>Margin</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {chartData.map(d => {
                                      const margin = d.Fee > 0 ? ((d.Fee - d.Cost) / d.Fee) : null;
                                      return (
                                        <tr key={d.year}>
                                          <td>{d.year}</td>
                                          <td className={styles.numCell}>{fmtMoney(d.Cost)}</td>
                                          <td className={styles.priceCell}>{fmtMoney(d.Fee)}</td>
                                          <td className={styles.priceCell}>{hasUnits ? fmtMoney(d.Fee / unitCount) : ''}</td>
                                          <td className={styles.priceCell}>{margin === null ? '' : `${(margin * 100).toFixed(1)}%`}</td>
                                        </tr>
                                      );
                                    })}
                                    <tr className={styles.summaryGrandRow}>
                                      <td>Total</td>
                                      <td className={styles.numCell}>{fmtMoney(chartData.reduce((s, d) => s + d.Cost, 0))}</td>
                                      <td className={styles.priceCell}>{fmtMoney(chartData.reduce((s, d) => s + d.Fee, 0))}</td>
                                      <td className={styles.priceCell}>{hasUnits ? fmtMoney(chartData.reduce((s, d) => s + d.Fee, 0) / unitCount) : ''}</td>
                                      <td className={styles.priceCell}>{(() => {
                                        const tc = chartData.reduce((s, d) => s + d.Cost, 0);
                                        const tf = chartData.reduce((s, d) => s + d.Fee, 0);
                                        return tf > 0 ? `${(((tf - tc) / tf) * 100).toFixed(1)}%` : '';
                                      })()}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              ) : (
                                <div style={{ width: '100%', height: 280 }}>
                                  <ResponsiveContainer>
                                    <BarChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
                                      <CartesianGrid strokeDasharray="3 3" />
                                      <XAxis dataKey="year" />
                                      <YAxis tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                                      <Tooltip formatter={(v) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                                      <Legend />
                                      <Bar dataKey="Cost" fill="#ef4444" />
                                      <Bar dataKey="Fee" fill="#2563eb" />
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              )
                            ) : (
                              <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', padding: '1rem 0' }}>
                                Tag at least one CTS row's <strong>Linked To</strong> column or fill in the <strong>Alternative Fee Structure / Schedule</strong> with an item name to populate this chart.
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>
            </>
          );
        })()}
      </div>

      {pricingPickerOpen && (() => {
        const opt = workbook?.options.find(o => o.optionNumber === activeOption) || workbook?.options[0];
        const label = (opt?.sheetName || '').trim();
        return (
          <OppPickerModal
            opps={opps2Records}
            optionName={label}
            onPick={async (oppId) => {
              // Convert the workbook's Alt-Fee rows for this option to
              // the OptionsTab row shape and resolve any auto-computed
              // fees to concrete numbers, so `buildPricingOptionSnapshot`
              // produces a self-contained snapshot that survives a
              // Pricing-tab Clear (or a workbook re-upload).
              const altRowsForOpt = opt ? (altFees[opt.optionNumber] || []) : [];
              const rows = altRowsForOpt.map(r => {
                const manualFee = Number(r.fee);
                const hasManualFee = r.fee != null && r.fee !== ''
                  && Number.isFinite(manualFee) && manualFee >= 0;
                const resolvedFee = hasManualFee ? manualFee : (autoFeePerUnitFor(r) ?? 0);
                const manualSm = Number(r.startMonth);
                const hasManualSm = r.startMonth != null && r.startMonth !== ''
                  && Number.isFinite(manualSm) && manualSm > 0;
                const resolvedSm = hasManualSm ? manualSm : (autoStartMonthFor(r) || 1);
                return {
                  feeSchedule: r.altItem || '',
                  type: r.type || '',
                  fee: resolvedFee,
                  unit: r.unit || '',
                  unitCount: r.unitCount,
                  startMonth: resolvedSm,
                };
              });
              const snapshot = buildPricingOptionSnapshot({
                name: label,
                years: Math.max(1, Math.round((termMonths || 12) / 12)),
                escPct: (Number(annualEscalator) || 0) * 100,
                services: (opt && pricingOptionServices) ? (pricingOptionServices[opt.sheetName] || []) : [],
                rows,
              });
              try {
                // Await both writes so the picker doesn't close before
                // Firestore has the snapshot — otherwise Opps 2's next
                // hydration can overwrite our IDB write with a pre-write
                // Firestore copy and the user sees only the link.
                await setOppOptionLink(oppId, label);
                await setOppPricingSnapshot(user?.uid, oppId, snapshot);
                setPricingPickerOpen(false);
              } catch (err) {
                console.error('Save to Opp (Pricing): snapshot save failed', { err, uid: user?.uid, oppId });
                const denied = err?.code === 'permission-denied'
                  || /insufficient permissions/i.test(err?.message || '');
                window.alert(
                  'Saved the link, but the Pricing snapshot failed to save to Firestore. ' +
                  'Year 1 fees and the saved details may not appear on the Opp.\n\n' +
                  (denied
                    ? 'Firestore denied the write (permission error) — this is a security-rules issue, not your network. '
                      + 'The deployed rules need to allow the opps2Data document for your account.'
                    : 'Check your network and try again.') +
                  '\n\n' +
                  (err?.message || String(err))
                );
              }
            }}
            onClose={() => setPricingPickerOpen(false)}
          />
        );
      })()}

      {linkedToOptionsModal && (
        <LinkedToOptionsModal
          autoTags={linkedToOptionsModal.autoTags}
          optionsList={linkedToOptionsList}
          onAdd={addLinkedToOption}
          onRemove={removeLinkedToOption}
          onClose={() => setLinkedToOptionsModal(null)}
        />
      )}
    </div>
  );
}
````

### src/components/PricingView/PricingView.module.css

````css
.wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem 0.5rem;
  gap: 1rem;
  flex-wrap: wrap;
}

.titleBlock {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--color-text);
  margin: 0;
}

.subtitle {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.uploadBtn,
.actionBtn {
  padding: 0.45rem 0.8rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.uploadBtn:hover,
.actionBtn:hover {
  border-color: var(--color-accent);
}

.actionBtnDanger {
  composes: actionBtn;
  color: #b91c1c;
}

.savedChip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--font-size-xs);
  color: #1e3a8a;
  background: #dbeafe;
  border: 1px solid #93c5fd;
  padding: 0.2rem 0.45rem 0.2rem 0.65rem;
  border-radius: 999px;
}

.savedChipClear {
  border: none;
  background: transparent;
  color: #1e3a8a;
  cursor: pointer;
  font-size: 1em;
  line-height: 1;
  padding: 0 2px;
}

.savedChipClear:hover {
  color: #b91c1c;
}

.gmField {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.gmInput {
  width: 4.5rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-family: inherit;
  text-align: right;
}

.body {
  flex: 1;
  overflow: auto;
  padding: 0 1.25rem 2rem;
}

.empty {
  margin: 4rem auto;
  max-width: 520px;
  text-align: center;
  color: var(--color-text-muted);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
}

/* Chrome-style tab strip across the top of the pricing body. */
.tabStrip {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 0;
  overflow-x: auto;
  padding-top: 0.25rem;
}

.tab,
.tabActive {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
  background: #f1f5f9;
  color: #64748b;
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  position: relative;
  top: 1px;
  font-family: inherit;
}

.tab:hover {
  background: #e2e8f0;
  color: #334155;
}

.tabActive {
  background: var(--color-bg);
  color: #1e293b;
  font-weight: 600;
  border-bottom-color: var(--color-bg);
}

.tabLabel {
  font-variant-numeric: tabular-nums;
}

.tabPrice {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  padding-left: 0.4rem;
  border-left: 1px solid var(--color-border);
}

.tabActive .tabPrice {
  color: var(--color-text);
}

.tabHidden {
  color: #f59e0b;
  font-weight: 700;
}

.optionPanel {
  border: 1px solid var(--color-border);
  border-top: none;
  border-bottom-left-radius: var(--radius-lg);
  border-bottom-right-radius: var(--radius-lg);
  background: var(--color-bg);
  padding: 0.85rem 1rem 1rem;
  margin-bottom: 1.25rem;
}

.optionPanelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;
}

.optionHeaderLeft {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.optionTitle {
  font-size: var(--font-size-md);
  font-weight: 600;
  margin: 0;
}

.optionMeta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.hiddenPill {
  display: inline-block;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: #fde68a;
  color: #92400e;
  font-size: 0.7rem;
  font-weight: 600;
}

.optionSummary {
  display: flex;
  gap: 1rem;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  flex-wrap: wrap;
}

.summaryNum {
  font-weight: 600;
}

.solutionDesc {
  margin: 0 0 0.75rem;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  background: #fef3c7;
  border-left: 3px solid #f59e0b;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
}

.section {
  margin-top: 0.5rem;
}

.sectionTitle {
  font-size: var(--font-size-sm);
  font-weight: 600;
  margin: 0.75rem 0 0.4rem;
  color: var(--color-text);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-xs);
  table-layout: fixed;
}

.thInner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  gap: 0.4rem;
}

.thLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.colResizer {
  position: absolute;
  top: -0.4rem;
  right: -0.55rem;
  bottom: -0.4rem;
  width: 6px;
  cursor: col-resize;
  user-select: none;
  background: transparent;
}

.colResizer:hover {
  background: var(--color-accent, #2563eb);
  opacity: 0.4;
}

.table td {
  overflow: hidden;
  word-break: break-word;
}

.table th,
.table td {
  border: 1px solid var(--color-border);
  padding: 0.4rem 0.55rem;
  text-align: left;
  vertical-align: top;
}

.table th {
  background: var(--color-bg-muted, #f8f9fa);
  font-weight: 600;
}

.numCell {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.gmCell {
  width: 5.5rem;
}

.priceCell {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  white-space: nowrap;
}

.linkedInput {
  width: 100%;
  padding: 0.25rem 0.4rem;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-family: inherit;
  background: transparent;
  color: var(--color-text);
}

.linkedInput:hover {
  border-color: var(--color-border);
}

.linkedInput:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-bg);
}

.linkedDefault {
  color: #6b7280;
  font-style: italic;
}

.typeSelect {
  width: 100%;
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 1px dotted #cbd5e1;
  font-family: inherit;
  font-size: var(--font-size-xs);
  color: var(--color-text);
  padding: 0.2rem 0.35rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-image: none;
}

.typeSelect:hover {
  border: 1px solid var(--color-border);
  background: #f8fafc;
}

.typeSelect:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-bg);
}

.typeSelect::-ms-expand {
  display: none;
}

.linkedCell {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.defaultStar {
  background: transparent;
  border: 1px solid transparent;
  color: #9ca3af;
  font-size: 0.95rem;
  line-height: 1;
  cursor: pointer;
  padding: 0.15rem 0.3rem;
  border-radius: var(--radius-sm);
  flex: 0 0 auto;
}

.defaultStar:hover:not(:disabled) {
  color: #f59e0b;
  border-color: var(--color-border);
}

.defaultStar:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.defaultStarOn {
  color: #f59e0b;
}

.cellInput {
  width: 100%;
  padding: 0.2rem 0.35rem;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-family: inherit;
  background: transparent;
  text-align: right;
}

.cellInput:hover {
  border-color: var(--color-border);
}

.cellInput:disabled {
  color: var(--color-text-muted);
  cursor: not-allowed;
  font-style: italic;
}

.cellInput:disabled:hover {
  border-color: transparent;
}

.passThroughRow {
  background: #f8fafc;
  color: var(--color-text-muted);
}

.passThroughRow td {
  color: var(--color-text-muted);
}

.passThroughCell {
  text-align: center;
}

.passThroughLabel {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  cursor: pointer;
  user-select: none;
}

.passThroughLabel input {
  margin: 0;
}

.cellInput:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-bg);
}

.overridden {
  color: var(--color-accent, #2563eb);
}

.totalsRow td {
  font-weight: 600;
  background: var(--color-bg-muted, #f8f9fa);
}

.bottomRow {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  margin-top: 1rem;
}

.summaryPanel {
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: #f8fafc;
  width: 100%;
}

.summaryTitle {
  font-size: var(--font-size-sm);
  font-weight: 600;
  margin: 0 0 0.25rem;
  color: var(--color-text);
}

.altFeeReminder {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: #dc2626;
  margin: 0 0 0.5rem;
}

.summaryMeta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-bottom: 0.5rem;
}

.metaInput {
  width: 4rem;
  padding: 0.15rem 0.35rem;
  margin: 0 0.15rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-family: inherit;
  text-align: right;
  color: var(--color-text);
  background: var(--color-bg);
}

.metaInput:focus {
  outline: none;
  border-color: var(--color-accent);
}

.summaryTable {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.summaryTable th,
.summaryTable td {
  border: 1px solid var(--color-border);
  padding: 0.4rem 0.6rem;
  vertical-align: middle;
  white-space: nowrap;
  text-align: left;
}

.summaryTable th {
  background: var(--color-bg-muted, #f1f5f9);
  font-weight: 600;
  text-align: left;
  vertical-align: bottom;
  white-space: nowrap;
}

.chartPanel {
  margin-top: 1.25rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
}

.chartHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.chartTagLabel {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}

.chartTagSelect {
  min-width: 240px;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-family: inherit;
  background: var(--color-bg);
  color: var(--color-text);
}

.viewToggle {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.viewToggleBtn,
.viewToggleOn {
  background: var(--color-bg);
  border: none;
  padding: 0.3rem 0.7rem;
  font-size: var(--font-size-xs);
  font-family: inherit;
  color: var(--color-text);
  cursor: pointer;
}

.viewToggleBtn:hover {
  background: #f1f5f9;
}

.viewToggleOn {
  background: var(--color-accent, #2563eb);
  color: #fff;
}

.colsMenuWrap {
  position: relative;
  display: inline-block;
}

.colsMenu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 200px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  padding: 0.4rem 0;
  max-height: 320px;
  overflow: auto;
}

.colsMenuItem {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.7rem;
  font-size: var(--font-size-sm);
  cursor: pointer;
  user-select: none;
}

.colsMenuItem:hover {
  background: #f1f5f9;
}

.summaryGrandRow td {
  font-weight: 700;
  background: #eef2ff;
}

.altFeeWrap {
  flex: 1 1 520px;
  min-width: 0;
}

.year1Warning {
  margin: 0.5rem 0 0.75rem;
  padding: 0.55rem 0.85rem;
  background: #fef2f2;
  border: 1px solid #ef4444;
  border-left: 4px solid #ef4444;
  border-radius: 6px;
  color: #991b1b;
  font-weight: 600;
  font-size: var(--font-size-sm);
  line-height: 1.4;
}

.unlinkedWarning {
  margin: 0.5rem 0 0.75rem;
  padding: 0.55rem 0.85rem;
  background: #fffbeb;
  border: 1px solid #f59e0b;
  border-left: 4px solid #f59e0b;
  border-radius: 6px;
  color: #92400e;
  font-size: var(--font-size-sm);
  line-height: 1.4;
}

.unlinkedWarning strong {
  font-weight: 600;
}

.unlinkedWarning ul {
  margin: 0.35rem 0 0;
  padding-left: 1.1rem;
}

.unlinkedWarning li {
  margin: 0.1rem 0;
}

.unlinkedWarning .unlinkedTag {
  font-weight: 600;
}

.unlinkedWarning .unlinkedNote {
  color: #b45309;
}

.altTable {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-xs);
}

.scenarioWrap {
  display: flex;
  gap: 1.25rem;
  flex-wrap: wrap;
  margin-top: 1rem;
  align-items: flex-start;
}

.scenarioTable {
  border-collapse: collapse;
  font-size: var(--font-size-xs);
  min-width: 360px;
  flex: 1 1 360px;
}

.scenarioTable th,
.scenarioTable td {
  border: 1px solid var(--color-border);
  padding: 0.35rem 0.5rem;
  vertical-align: middle;
}

.scenarioTable thead th {
  background: var(--color-bg-muted, #f1f5f9);
  font-weight: 700;
  text-align: left;
}

.scenarioTable thead th.numCell {
  text-align: right;
}

.scenarioTable tbody td:first-child {
  font-weight: 500;
  color: var(--color-text);
}

.altTable th,
.altTable td {
  border: 1px solid var(--color-border);
  padding: 0.3rem 0.4rem;
  vertical-align: middle;
}

.altTable th {
  background: var(--color-bg-muted, #f1f5f9);
  font-weight: 600;
  text-align: left;
}

.altCellInput {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  font-family: inherit;
  font-size: var(--font-size-xs);
  padding: 0.25rem 0.4rem;
  border-radius: var(--radius-sm);
  color: var(--color-text);
}

select.altCellInput {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-image: none;
  cursor: pointer;
  padding-right: 0.4rem;
}

select.altCellInput::-ms-expand {
  display: none;
}

.altCellInput:hover {
  border-color: var(--color-border);
}

.altCellInput:focus {
  outline: none;
  border-color: var(--color-accent);
  background: var(--color-bg);
}

.rowDelBtn {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 1rem;
  cursor: pointer;
  padding: 0 0.3rem;
  line-height: 1;
}

.rowDelBtn:hover {
  color: #ef4444;
}

.dragHandleCell {
  text-align: center;
  padding: 0 0.1rem !important;
  width: 22px;
  vertical-align: middle;
}

.dragHandle {
  display: inline-block;
  color: #cbd5e1;
  cursor: grab;
  user-select: none;
  font-size: 0.85rem;
  line-height: 1;
  letter-spacing: -2px;
  padding: 0 0.2rem;
}

.dragHandle:hover {
  color: #64748b;
}

.dragHandle:active {
  cursor: grabbing;
}

.dragRowGhost td {
  opacity: 0.4;
}

.dragInsertBefore td {
  box-shadow: inset 0 2px 0 0 #2563eb;
}

.dragInsertAfter td {
  box-shadow: inset 0 -2px 0 0 #2563eb;
}

.pasteBox {
  margin-top: 0.5rem;
  padding: 0.5rem 0.6rem;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: #fffbeb;
}

.pasteArea {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.5rem;
  resize: vertical;
}

.pasteArea:focus {
  outline: none;
  border-color: var(--color-accent);
}

.pasteFlash {
  margin-bottom: 0.5rem;
  padding: 0.35rem 0.6rem;
  border-radius: var(--radius-sm);
  background: #d1fae5;
  border: 1px solid #34d399;
  color: #065f46;
  font-size: var(--font-size-xs);
}

.altTable th {
  white-space: normal;
  word-break: break-word;
  vertical-align: bottom;
}

.altTable td {
  white-space: normal;
  word-break: break-word;
  vertical-align: top;
  text-align: left;
}

.altTable td.numCell,
.altTable th.numCell {
  text-align: left;
}

.altTable .altCellInput {
  text-align: left !important;
}

.fileMeta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  margin-left: 0.5rem;
}

.diagnostic {
  border: 1px dashed var(--color-border);
  background: #fffbeb;
  border-radius: var(--radius-md);
  padding: 0.75rem 0.9rem;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  margin-top: 0.5rem;
}

.rawScroll {
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  border-radius: var(--radius-sm);
}

.rawTable {
  border-collapse: collapse;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  width: 100%;
}

.rawTable td {
  border: 1px solid #e5e7eb;
  padding: 0.15rem 0.35rem;
  vertical-align: top;
  white-space: nowrap;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rawIdx {
  background: #f3f4f6;
  color: #6b7280;
  text-align: right;
  font-variant-numeric: tabular-nums;
  position: sticky;
  left: 0;
}

/* Page-level subtab strip (Pricing / Linked To). Smaller than the
   option tabs that live inside the Pricing subtab. */
.subtabStrip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0.4rem 1.25rem 0;
  border-bottom: 1px solid var(--color-border);
}

.subtab,
.subtabActive {
  padding: 0.4rem 0.85rem;
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  border-top-left-radius: 6px;
  border-top-right-radius: 6px;
  font-family: inherit;
  position: relative;
  top: 1px;
}

.subtab:hover {
  background: #f1f5f9;
  color: #334155;
}

.subtabActive {
  background: var(--color-bg);
  color: var(--color-text);
  font-weight: 600;
  border-color: var(--color-border);
  border-bottom-color: var(--color-bg);
}

/* Linked To subtab body. */
.linkedPanel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.25rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.linkedHeading {
  margin: 0 0 0.5rem;
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.linkedSubheading {
  margin: 0 0 0.25rem;
  font-size: var(--font-size-md);
  font-weight: 600;
}

.linkedDocBlock {
  background: #f8fafc;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.9rem 1.1rem;
}

.linkedDocList {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: var(--font-size-sm);
  color: var(--color-text);
  line-height: 1.45;
}

.linkedDocList code {
  background: #eef2ff;
  padding: 0 0.25rem;
  border-radius: 3px;
  font-size: 0.9em;
}

.linkedSection {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.linkedHint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.linkedTable {
  border-collapse: collapse;
  width: 100%;
  font-size: var(--font-size-sm);
  background: var(--color-bg);
}

.linkedTable th,
.linkedTable td {
  text-align: left;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.linkedTable th {
  background: #f1f5f9;
  font-weight: 600;
  color: #334155;
  border-bottom: 1px solid var(--color-border);
}

.linkedTable code {
  background: #eef2ff;
  padding: 0 0.3rem;
  border-radius: 3px;
  font-size: 0.95em;
}

.linkedEmpty {
  padding: 1rem;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  color: var(--color-text-muted);
  background: var(--color-bg);
}

.linkedEmptyInline {
  padding: 0.5rem 0.7rem;
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  background: #fafafa;
}

.linkedMuted {
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.linkedBadge {
  display: inline-block;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.linkedRowList {
  margin: 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
````

### src/components/PricingView/S2CTab.jsx

````jsx
import { useState } from 'react';
import styles from './S2CTab.module.css';

const EMPTY_ROW = () => ({
  costElement: '',
  setup: '',      // SET-UP or ONE-OFF ($)
  setupUom: '',   // Cost UoM (Per Site, Per Account, etc.)
  ongoing: '',    // ON-GOING per month ($)
  ongoingUom: '', // Cost UoM
});

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const fmtMoney = (n, dp = 2) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp });
};

// Parse tab-separated text from Excel. Expected order matches the
// table left-to-right: Cost Element / SET-UP or ONE-OFF / Cost UoM /
// ON-GOING per month / Cost UoM. Excel-copied blocks may include the
// two-row header banner — skip rows that look like the banner
// ("Cost Element", "COSTS TO SERVE…", "SET-UP…") so the user can paste
// the whole selection without trimming first.
function parseRowsFromText(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const cols = line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*/);
    const cell = (i) => (cols[i] ?? '').trim();
    const first = cell(0).toLowerCase();
    if (
      first === 'cost element' ||
      first.startsWith('costs to serve') ||
      first.startsWith('set-up') ||
      first.startsWith('set up')
    ) continue;
    out.push({
      costElement: cell(0),
      setup: cell(1),
      setupUom: cell(2),
      ongoing: cell(3),
      ongoingUom: cell(4),
    });
  }
  return out;
}

function CellInput({ value, onCommit, align, placeholder }) {
  const initial = value == null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  return (
    <input
      type="text"
      className={styles.input}
      style={align === 'right' ? { textAlign: 'right' } : undefined}
      value={draft}
      placeholder={placeholder || ''}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== initial) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

export function S2CTab({ rows, setRows }) {
  const safeRows = Array.isArray(rows) && rows.length
    ? rows
    : Array.from({ length: 10 }, EMPTY_ROW);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [flash, setFlash] = useState('');

  const updateRow = (idx, key, value) => {
    const next = safeRows.slice();
    next[idx] = { ...next[idx], [key]: value };
    setRows(next);
  };
  const addRow = () => setRows([...safeRows, EMPTY_ROW()]);
  const removeRow = (idx) => {
    const next = safeRows.slice();
    next.splice(idx, 1);
    setRows(next.length ? next : [EMPTY_ROW()]);
  };
  const replaceRows = (newRows) => {
    const padded = newRows.length < 10
      ? newRows.concat(Array.from({ length: 10 - newRows.length }, EMPTY_ROW))
      : newRows;
    setRows(padded);
  };
  const clearAll = () => {
    const hasData = safeRows.some(r => r.costElement || r.setup || r.setupUom || r.ongoing || r.ongoingUom);
    if (!hasData) {
      setRows(Array.from({ length: 10 }, EMPTY_ROW));
      return;
    }
    if (window.confirm('Clear all S2C rows? This cannot be undone.')) {
      setRows(Array.from({ length: 10 }, EMPTY_ROW));
    }
  };

  function handleTablePaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (!text) return;
    const looksTabular = text.includes('\t') || text.includes('\n');
    if (!looksTabular) return;
    e.preventDefault();
    e.stopPropagation();
    const parsed = parseRowsFromText(text);
    if (!parsed.length) return;
    replaceRows(parsed);
    setFlash(`Pasted ${parsed.length} row${parsed.length === 1 ? '' : 's'}.`);
    window.setTimeout(() => setFlash(''), 2500);
  }

  let setupSum = 0;
  let ongoingSum = 0;
  for (const r of safeRows) {
    const s = toNum(r.setup);
    if (s != null) setupSum += s;
    const o = toNum(r.ongoing);
    if (o != null) ongoingSum += o;
  }

  return (
    <div className={styles.wrapper} onPaste={handleTablePaste}>
      <div className={styles.intro}>
        Costs to Serve worksheet — paste a block straight from Excel (5 columns: Cost Element ·
        SET-UP or ONE-OFF · Cost UoM · ON-GOING per month · Cost UoM). The two-row header banner
        from the source workbook is auto-skipped.
      </div>

      <div className={styles.toolbar}>
        <button type="button" className={styles.btn} onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Close paste' : 'Paste from Excel'}
        </button>
        <button type="button" className={styles.btn} onClick={addRow}>+ Row</button>
        <button type="button" className={styles.btnDanger} onClick={clearAll}>Clear</button>
        {flash && <span className={styles.flash}>{flash}</span>}
      </div>

      {pasteOpen && (
        <div className={styles.pasteBox}>
          <div className={styles.pasteHint}>
            Tab-separated rows: Cost Element · SET-UP or ONE-OFF · Cost UoM · ON-GOING per month · Cost UoM.
          </div>
          <textarea
            className={styles.pasteArea}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Implementation\t$2,500\tPer Site\t$25\tPer Site'}
            rows={6}
          />
          <div className={styles.pasteActions}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                const parsed = parseRowsFromText(pasteText);
                if (!parsed.length) return;
                replaceRows(parsed);
                setPasteText('');
                setPasteOpen(false);
                setFlash(`Pasted ${parsed.length} row${parsed.length === 1 ? '' : 's'}.`);
                window.setTimeout(() => setFlash(''), 2500);
              }}
            >Replace rows</button>
            <button type="button" className={styles.btn} onClick={() => { setPasteText(''); setPasteOpen(false); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={styles.gridWrap}>
        <table className={styles.grid}>
          <colgroup>
            <col className={styles.colCostElement} />
            <col className={styles.colSetup} />
            <col className={styles.colSetupUom} />
            <col className={styles.colOngoing} />
            <col className={styles.colOngoingUom} />
            <col className={styles.actionCol} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} className={styles.costElementHeader}>Cost Element</th>
              <th colSpan={4} className={styles.s2cGroup}>COSTS TO SERVE (includes Tech Depreciation)</th>
              <th rowSpan={2} className={styles.actionCol} />
            </tr>
            <tr>
              <th className={styles.s2cHeader}>SET-UP<br/>or ONE-OFF</th>
              <th className={styles.s2cHeader}>Cost UoM</th>
              <th className={styles.s2cHeader}>ON-GOING<br/>per month</th>
              <th className={styles.s2cHeader}>Cost<br/>UoM</th>
            </tr>
          </thead>
          <tbody>
            {safeRows.map((row, idx) => {
              const setupNum = toNum(row.setup);
              const ongoingNum = toNum(row.ongoing);
              const setupDisplay = setupNum != null ? fmtMoney(setupNum) : (row.setup ?? '');
              const ongoingDisplay = ongoingNum != null ? fmtMoney(ongoingNum) : (row.ongoing ?? '');
              const k = `${idx}-${row.costElement}-${row.setup}-${row.setupUom}-${row.ongoing}-${row.ongoingUom}`;
              return (
                <tr key={idx}>
                  <td className={styles.tan}>
                    <CellInput key={`ce-${k}`} value={row.costElement} onCommit={(v) => updateRow(idx, 'costElement', v)} />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`}>
                    <CellInput key={`su-${k}`} value={setupDisplay} align="right" onCommit={(v) => updateRow(idx, 'setup', v)} />
                  </td>
                  <td className={styles.tan}>
                    <CellInput key={`suu-${k}`} value={row.setupUom} onCommit={(v) => updateRow(idx, 'setupUom', v)} />
                  </td>
                  <td className={`${styles.tan} ${styles.numCell}`}>
                    <CellInput key={`og-${k}`} value={ongoingDisplay} align="right" onCommit={(v) => updateRow(idx, 'ongoing', v)} />
                  </td>
                  <td className={styles.tan}>
                    <CellInput key={`ogu-${k}`} value={row.ongoingUom} onCommit={(v) => updateRow(idx, 'ongoingUom', v)} />
                  </td>
                  <td className={styles.actionCell}>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => removeRow(idx)}
                      title="Remove row"
                    >×</button>
                  </td>
                </tr>
              );
            })}
            <tr className={styles.totalsRow}>
              <td style={{ textAlign: 'right' }}>Totals</td>
              <td className={styles.numCell}>{setupSum > 0 ? fmtMoney(setupSum) : ''}</td>
              <td />
              <td className={styles.numCell}>{ongoingSum > 0 ? fmtMoney(ongoingSum) : ''}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
````

### src/components/PricingView/S2CTab.module.css

````css
.wrapper {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.25rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.intro {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  max-width: 920px;
  line-height: 1.5;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.btn {
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.btn:hover { border-color: var(--color-accent); }

.btnDanger {
  padding: 0.4rem 0.7rem;
  border: 1px solid #fecaca;
  border-radius: var(--radius-md);
  background: #fff;
  color: #b91c1c;
  font-size: var(--font-size-xs);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.btnDanger:hover { border-color: #ef4444; background: #fef2f2; }

.flash {
  font-size: var(--font-size-xs);
  color: #047857;
  background: #d1fae5;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
}

.pasteBox {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.7rem 0.85rem;
  background: #f8fafc;
}

.pasteHint {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.pasteArea {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--font-size-xs);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.5rem;
  resize: vertical;
}

.pasteActions {
  display: flex;
  gap: 0.5rem;
}

.gridWrap {
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
}

.grid {
  border-collapse: collapse;
  width: 100%;
  table-layout: fixed;
  font-size: var(--font-size-sm);
  background: var(--color-bg);
}

.colCostElement { width: 260px; }
.colSetup       { width: 150px; }
.colSetupUom    { width: 130px; }
.colOngoing     { width: 150px; }
.colOngoingUom  { width: 130px; }
.actionCol      { width: 32px; background: #f1f5f9; }

.grid th,
.grid td {
  border: 1px solid #e5e7eb;
  padding: 0;
  vertical-align: middle;
  height: 30px;
}

.grid th {
  background: #f1f5f9;
  text-align: left;
  font-weight: 600;
  font-size: var(--font-size-xs);
  color: #475569;
  padding: 0.35rem 0.55rem;
}

/* Green group banner matching the screenshot. */
.s2cGroup {
  background: #a9d18e;
  color: #1f3a1f;
  text-align: center;
  font-weight: 700;
}

.s2cHeader {
  background: #c6e0b4;
  text-align: center;
  font-weight: 600;
  white-space: normal;
}

.costElementHeader {
  background: #a9d18e;
  color: #1f3a1f;
  text-align: left;
  font-weight: 700;
}

.tan { background: #fdf6e3; }
.calc {
  background: #f9fafb;
  color: var(--color-text);
  padding: 0.35rem 0.55rem;
  font-variant-numeric: tabular-nums;
}
.numCell { text-align: right; }

.input {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  padding: 0.35rem 0.5rem;
  font-size: var(--font-size-sm);
  font-family: inherit;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.input:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
  background: #fff;
}

.actionCell {
  text-align: center;
  background: #fff;
}

.removeBtn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  font-family: inherit;
}

.removeBtn:hover {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fef2f2;
}

.totalsRow td {
  background: #e2e8f0;
  font-weight: 600;
  padding: 0.4rem 0.55rem;
  font-variant-numeric: tabular-nums;
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
  // Column keys that should always land in the default Excel export even
  // when the user has hidden them on screen. Included in their natural
  // column order; ignored when a custom onExport is supplied.
  exportExtraColumnKeys,
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
          // Start from the on-screen columns, then fold in any
          // exportExtraColumnKeys the caller wants in the file even when
          // hidden — kept in natural column order via orderedColumns.
          const extraKeys = new Set(exportExtraColumnKeys || []);
          let exportCols = extraKeys.size
            ? orderedColumns.filter(c => visibleCols.has(c.key) || alwaysVisible.includes(c.key) || extraKeys.has(c.key))
            : visibleColumns;
          if (exportCols.length === 0 && orderedColumns.length > 0) exportCols = orderedColumns;
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
export function MultiSelectCell({ value, onChange, options, extraGroups, extraGroupsLabel, extraGroupsPlaceholder, nowrap, placeholder }) {
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
  // When nothing is selected and a placeholder was supplied, show it in
  // muted italics so it reads as a hint (e.g. Scope's default "AEM"),
  // not an actual selected service. Falls back to the plain "—" dash.
  const showPlaceholder = isEmpty && !!placeholder;
  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <span
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'block', cursor: 'pointer', minHeight: '1em',
          padding: '1px 2px',
          color: isEmpty ? 'var(--color-text-muted)' : 'inherit',
          fontStyle: showPlaceholder ? 'italic' : 'normal',
          whiteSpace: nowrap ? 'nowrap' : 'normal',
          wordBreak: nowrap ? 'normal' : 'break-word',
          overflow: nowrap ? 'hidden' : undefined,
          textOverflow: nowrap ? 'ellipsis' : undefined,
        }}
        title={showPlaceholder ? `${placeholder} (placeholder — no service selected)` : isEmpty ? 'Click to pick values' : selected.join(', ')}
      >
        {showPlaceholder ? placeholder : isEmpty ? '—' : selected.join(', ')}
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

### src/data/dropdownLists.js

````javascript
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
  {
    // Lead statuses for the Contacts → Marketing Leads tab. Editing this
    // list on the Dropdowns tab drives the Status column's dropdown there.
    // Seeded with the common Salesforce lead statuses; "Closed - Converted"
    // counts as a win and "Closed - Recycle" as a loss for the page's
    // close-rate summary.
    key: 'marketingLeadStatus',
    label: 'Marketing Lead Status',
    options: [
      'Open',
      'Working',
      'Nurture',
      'Meeting Set',
      'Qualified',
      'Unqualified',
      'Closed - Converted',
      'Closed - Recycle',
    ],
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

### src/utils/dropdownListsStore.js

````javascript
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

### src/utils/opps2Store.js

````javascript
// STUB for the standalone export.
//
// The real module synced "Opps 2" opportunities to/from Firestore
// (collection `opps2Data`) plus an IndexedDB cache. Two exported pages
// touch it:
//   - DealsView (Clients page) → loadOpps2Newest, to flag deals whose
//     linked opportunity is already Sold.
//   - oppsPricingSnapshot (Pricing page) → load/save helpers, used when a
//     pricing option is pushed back onto an opportunity row.
//
// With no backend, the loaders return null/empty and the savers are
// no-ops. Both pages already tolerate an empty result, so the tables and
// calculators render fully from local/sample data — they just skip the
// cross-page opportunity sync.

export const OPPS2_STORE = 'opps2-cache';
export const OPPS2_CACHE_KEY = 'data';
export const OPPS2_FIRESTORE_COLLECTION = 'opps2Data';

export async function loadOpps2Newest() {
  return null;
}

export async function loadOpps2FromFirestore() {
  return null;
}

export async function loadOpps2Cache() {
  return null;
}

export async function saveOpps2Cache() {
  // no-op — nothing to cache without a backend
}

export async function saveOpps2ToFirestore() {
  // no-op — no Firestore in the export
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

### src/utils/oppsCallIn.js

````javascript
// Call-In helpers for Opps 2 rows, mirrored from OppsView2 so other
// views (e.g. the Pricing "Save to Opp" picker) can order opps the same
// way the Opps 2 page does — by Call In ascending, most urgent first —
// and show the call-in date. Kept as small pure functions here so the
// picker doesn't have to import the 6k-line Opps 2 component.

const BLANK_SENTINELS = new Set(['', '-', '#N/A', '#n/a', 'N/A', 'n/a']);

// Normalize a free-text / ISO / Date-parseable value to YYYY-MM-DD.
// Returns '' when blank or unparseable.
export function toISODate(raw) {
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

// Render an ISO/parseable date as M/D/YYYY in local time (no UTC drift).
// Falls back to the raw string when it can't be parsed.
export function formatDateDisplay(raw) {
  const iso = toISODate(raw);
  if (!iso) return String(raw || '');
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  return `${m}/${d}/${y}`;
}

// Calendar days from today to the given date. Positive = future,
// negative = past. null for blank / unparseable.
export function daysFromToday(rawISO) {
  const iso = toISODate(rawISO);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Call In = calendar days from today to the row's Follow Up date.
// Prefers a live compute from Follow Up; falls back to a stored "Call In"
// number for imported rows that arrived without a date. A blank-sentinel
// stored value reads as null (intentionally cleared). Mirrors
// resolveComputedDays('Call In', 'Follow Up') from OppsView2.
export function resolveCallIn(row) {
  if (row && 'Call In' in row) {
    const raw = row['Call In'];
    const s = raw == null ? '' : String(raw).trim();
    if (BLANK_SENTINELS.has(s)) return null;
  }
  const live = daysFromToday(row?.['Follow Up']);
  if (live != null) return live;
  if (row && 'Call In' in row) {
    const raw = row['Call In'];
    const s = raw == null ? '' : String(raw).trim();
    const n = parseFloat(s.replace(/[,$%]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// The date the call-in number counts down to — i.e. the Follow Up date.
// Returns '' when there's no resolvable date.
export function callInDateISO(row) {
  return toISODate(row?.['Follow Up']);
}

// Order rows by Call In ascending so the most urgent (most overdue) land
// first, matching the Opps 2 page's initial-load sort. Rows without a
// resolvable Call In sink to the bottom; original index breaks ties so
// the order stays deterministic.
export function sortByCallInAsc(records) {
  if (!Array.isArray(records)) return records;
  const tagged = records.map((r, i) => {
    const n = resolveCallIn(r);
    const key = typeof n === 'number' && Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    return { r, i, key };
  });
  tagged.sort((a, b) => (a.key - b.key) || (a.i - b.i));
  return tagged.map(x => x.r);
}
````

### src/utils/oppsPricingSnapshot.js

````javascript
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

### src/utils/pricingOptionCalc.js

````javascript
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

````javascript
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

### src/utils/pricingParse.js

````javascript
// Parses cost data out of "Option 1/2/3/4/5" sheets in an uploaded fee
// workbook. The data we care about is bounded between two anchor
// rows on each sheet:
//
//   start: "Delivery Team Inputs"
//   end:   "Cost Summary"
//
// Inside that range, line items live in one or more sub-tables whose
// header rows match the columns:
//
//   Alternative Fee Structure/Schedule | Type | Fee | Unit |
//   Unit Count (# of Sites or Accounts) | Fee Start Month
//
// Each detected header row starts a new section; the rows below it
// (until the next header or the Cost Summary anchor) are line items
// keyed by the value in the first column.
//
// Hidden sheets are read just like visible ones — XLSX preserves
// `Sheet.Hidden` (1 = hidden, 2 = very hidden) on the workbook, which
// we surface but don't filter on.

import * as XLSX from 'xlsx';

const OPTION_RE = /^\s*Option\s*([1-5])\b/i;
const SOLUTION_DESC_RE = /^solution\s*description$/i;
const END_ANCHOR_RE = /^\s*cost\s*summary\b/i;
// Labels in the SIA metadata block that carry # of sites / # of accounts.
// "# Sites", "# of Sites", and "Number of Sites" are all accepted; the
// value can sit in any cell to the right of the label on the same row.
const SITES_LABEL_RE = /^\s*(#\s*(of\s+)?sites?|number\s*of\s*sites?|sites?\s*count|total\s*sites?|sites?)\s*[:-]?\s*$/i;
const ACCOUNTS_LABEL_RE = /^\s*(#\s*(of\s+)?accounts?|number\s*of\s*accounts?|accounts?\s*count|total\s*accounts?|accounts?)\s*[:-]?\s*$/i;
// Per the SIA template, the first 18 rows are sheet metadata (Date,
// Salesperson, Currency Conversion, Solution description, Target
// GM%, Use Target). The line-item tables always begin below row 18.
const SKIP_LEADING_ROWS = 18;

// Header-cell matchers for the 5 columns we display.
const COL_MATCHERS = {
  description: /^line\s*item$|alternative\s*fee\s*structure|^description$/i,
  type: /^type$/i,
  cts: /^cts$|cost\s*to\s*serve/i,
  startMonth: /^start\s*month$|fee\s*start\s*month/i,
  comments: /^comment/i,
};
// GM% is read separately so per-row sheet GM% can still feed the
// markup math even though the column isn't displayed.
const GM_MATCHER = /gm\s*%|individual\s*gm/i;

function cellStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function rowIsBlank(row) {
  if (!Array.isArray(row)) return true;
  return row.every(c => cellStr(c) === '');
}

// A header row is one whose cells include both a "Type" header and
// a "Cost to Serve" / "CTS" header. The section title is then read
// from column A of that same row (e.g. "SB Services (CTS)").
function isHeaderRow(row) {
  if (!Array.isArray(row)) return false;
  let hasType = false, hasCts = false;
  for (const c of row) {
    const s = cellStr(c);
    if (!s) continue;
    if (/^type$/i.test(s)) hasType = true;
    if (/^cts$|cost\s*to\s*serve/i.test(s)) hasCts = true;
  }
  return hasType && hasCts;
}

// The Alternative Fee Structure table has its own header row shape —
// no CTS column, but Type / Fee / Unit / Unit Count / Fee Start Month
// instead. We accept two flavors: the strict SIA template ("Alternative
// Fee Structure/Schedule" label + Fee + Unit/Unit Count), and a looser
// pattern (Type + Fee + Unit or Unit Count, no CTS) so workbooks that
// don't repeat the literal label on the header row still parse.
function isAltFeeHeaderRow(row) {
  if (!Array.isArray(row)) return false;
  let hasAltLabel = false, hasType = false, hasFeeCol = false, hasUnitCol = false, hasCts = false;
  for (const c of row) {
    const s = cellStr(c);
    if (!s) continue;
    if (/alternative\s*fee\s*structure/i.test(s)) hasAltLabel = true;
    if (/^type$/i.test(s)) hasType = true;
    if (/^fee$/i.test(s)) hasFeeCol = true;
    if (/^unit$/i.test(s) || /unit\s*count/i.test(s)) hasUnitCol = true;
    if (/^cts$|cost\s*to\s*serve/i.test(s)) hasCts = true;
  }
  if (hasCts) return false;
  if (hasAltLabel && hasFeeCol) return true;
  return hasType && hasFeeCol && hasUnitCol;
}

function classifyColumns(headerRow) {
  const map = {};
  headerRow.forEach((cell, i) => {
    const s = cellStr(cell);
    if (!s) return;
    if (map.gmPct === undefined && GM_MATCHER.test(s)) map.gmPct = i;
    for (const [field, re] of Object.entries(COL_MATCHERS)) {
      if (map[field] !== undefined) continue;
      if (re.test(s)) { map[field] = i; break; }
    }
  });
  if (map.description === undefined) map.description = 0;
  return map;
}

// Column map for an alt-fee table. Matches the SIA template's six
// columns; falls back to sensible defaults so a partial header still
// produces usable rows.
function classifyAltFeeColumns(headerRow) {
  const map = {};
  headerRow.forEach((cell, i) => {
    const s = cellStr(cell);
    if (!s) return;
    if (map.altItem === undefined && /alternative\s*fee\s*structure/i.test(s)) map.altItem = i;
    if (map.type === undefined && /^type$/i.test(s)) map.type = i;
    if (map.fee === undefined && /^fee$/i.test(s)) map.fee = i;
    if (map.unitCount === undefined && /unit\s*count/i.test(s)) map.unitCount = i;
    if (map.unit === undefined && /^unit$/i.test(s)) map.unit = i;
    if (map.startMonth === undefined && /fee\s*start\s*month|^start\s*month$/i.test(s)) map.startMonth = i;
  });
  if (map.altItem === undefined) map.altItem = 0;
  return map;
}

// Some workbooks (especially sheets that are hidden) ship with no
// `!ref` set or a `!ref` that doesn't actually cover the data. Without
// a valid range, sheet_to_json returns []. Recompute the range from
// every A1-style cell key on the sheet and patch it in before reading.
function ensureSheetRange(sheet) {
  let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const addr = XLSX.utils.decode_cell(key);
    if (!addr || !Number.isFinite(addr.r) || !Number.isFinite(addr.c)) continue;
    if (addr.r < minR) minR = addr.r;
    if (addr.r > maxR) maxR = addr.r;
    if (addr.c < minC) minC = addr.c;
    if (addr.c > maxC) maxC = addr.c;
  }
  if (maxR < 0) return; // truly empty
  const computed = XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
  // Always overwrite — a too-small `!ref` would clip our read.
  sheet['!ref'] = computed;
}

function parseOptionSheet(sheet, sheetName) {
  ensureSheetRange(sheet);
  const cellCount = Object.keys(sheet).filter(k => !k.startsWith('!')).length;
  const refUsed = sheet['!ref'] || '';
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: true,
  });

  // Skip a fixed block of leading metadata rows; locate the Cost
  // Summary end anchor below it.
  const startIdx = Math.min(SKIP_LEADING_ROWS, rows.length);
  let endIdx = -1;
  for (let i = startIdx; i < rows.length; i++) {
    const a = cellStr((rows[i] || [])[0]);
    if (!a) continue;
    if (END_ANCHOR_RE.test(a)) { endIdx = i; break; }
  }

  // # of Sites / # of Accounts live in the SIA metadata block above
  // the line-item tables. Scan rows 0..startIdx for a label match and
  // pull the first numeric cell to the right of it on the same row.
  let siteCount = null;
  let accountCount = null;
  for (let i = 0; i < Math.min(rows.length, startIdx + 4); i++) {
    const row = rows[i] || [];
    for (let c = 0; c < row.length; c++) {
      const label = cellStr(row[c]);
      if (!label) continue;
      const isSiteLabel = siteCount === null && SITES_LABEL_RE.test(label);
      const isAccountLabel = accountCount === null && ACCOUNTS_LABEL_RE.test(label);
      if (!isSiteLabel && !isAccountLabel) continue;
      let value = null;
      for (let j = c + 1; j < row.length; j++) {
        const n = toNumber(row[j]);
        if (n !== null && Number.isFinite(n) && n > 0) { value = n; break; }
      }
      if (value === null) continue;
      if (isSiteLabel) siteCount = value;
      else accountCount = value;
    }
  }

  // Solution description — captured from anywhere on the sheet, even
  // outside the anchor range, since it's typically up at the top.
  let solutionDescription = '';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const a = cellStr(row[0]);
    if (!a) continue;
    if (SOLUTION_DESC_RE.test(a)) {
      const here = cellStr(row[1]);
      if (here) {
        solutionDescription = here;
      } else {
        for (let j = i + 1; j < Math.min(rows.length, i + 4); j++) {
          const next = rows[j] || [];
          const nv = cellStr(next[0]) || cellStr(next[1]);
          if (nv) { solutionDescription = nv; break; }
        }
      }
      break;
    }
  }

  const sections = [];
  const altFees = [];
  {
    const stop = endIdx === -1 ? rows.length : endIdx;
    // Find every header row. CTS section headers must sit inside the
    // bounded Delivery-Team-Inputs → Cost-Summary range; the
    // Alternative Fee table is allowed anywhere on the sheet — some
    // SIAs put it above the metadata block (e.g. a "Fee Development"
    // layout at the very top) and others park it below Cost Summary,
    // so we scan the full sheet for alt-fee headers. Both kinds share
    // the same "row index → next-row-index" segmentation so each
    // block's items don't bleed into the next.
    const headerIdxs = [];
    const altFeeHeaderIdxs = new Set();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      if (isAltFeeHeaderRow(row)) {
        headerIdxs.push(i);
        altFeeHeaderIdxs.add(i);
      } else if (i >= startIdx && i < stop && isHeaderRow(row)) {
        headerIdxs.push(i);
      }
    }

    for (let hi = 0; hi < headerIdxs.length; hi++) {
      const idx = headerIdxs[hi];
      // Default the segment end to the end of the sheet — alt-fee
      // tables sometimes live below Cost Summary, and `stop` would
      // truncate the scan to zero rows in that case. CTS sections
      // cap themselves at `stop` below.
      const nextHeaderIdx = headerIdxs[hi + 1] ?? rows.length;
      if (altFeeHeaderIdxs.has(idx)) {
        // Alt-fee table — collect into altFees[] and continue. We
        // skip the rest of the CTS-section logic for this block since
        // it has no CTS column.
        const headerRow = (rows[idx] || []).map(cellStr);
        const cols = classifyAltFeeColumns(headerRow);
        for (let r = idx + 1; r < nextHeaderIdx; r++) {
          const row = rows[r] || [];
          // The first truly-blank row ends the alt-fee table —
          // anything beyond it belongs to whatever section comes
          // next on the sheet (Fee Structure Variance, term/TCV
          // breakdown, etc.) and must not be imported as alt-fee
          // rows.
          if (rowIsBlank(row)) break;
          const altItem = cellStr(row[cols.altItem]);
          if (!altItem) continue;
          if (/^enter\s+.+\s+here$/i.test(altItem)) continue;
          // Stop the moment we hit a label that signals the table
          // is over (defensive — usually the next header / blank row
          // catches it first).
          if (END_ANCHOR_RE.test(altItem)) break;
          const typeStr = cols.type !== undefined ? cellStr(row[cols.type]) : '';
          if (/^(description|type|comments?|fee|unit|cts|cost\s*to\s*serve|gm\s*%|individual\s*gm|start\s*month)$/i.test(typeStr)) continue;
          // Real alt-fee rows always declare a Type ("Setup", "One
          // Time", "Recurring (monthly)", …). A row with text in
          // column 0 but no Type is a section title that slipped in
          // below the table — drop it.
          if (!typeStr) continue;
          const ucRaw = cols.unitCount !== undefined ? toNumber(row[cols.unitCount]) : null;
          const smRaw = cols.startMonth !== undefined ? toNumber(row[cols.startMonth]) : null;
          altFees.push({
            altItem,
            type: typeStr,
            fee: cols.fee !== undefined ? toNumber(row[cols.fee]) : null,
            unit: cols.unit !== undefined ? cellStr(row[cols.unit]) : '',
            // Mirror altFeeStarter() defaults so an imported blank
            // matches the in-app placeholder values. startMonth stays
            // null when the workbook doesn't supply one so the alt-fee
            // table can auto-derive it from linked CTS rows.
            unitCount: ucRaw == null ? 1 : ucRaw,
            startMonth: smRaw == null ? null : smRaw,
          });
        }
        continue;
      }
      const headerRow = (rows[idx] || []).map(cellStr);
      const cols = classifyColumns(headerRow);
      // CTS sections never read past Cost Summary, even if the next
      // boundary in `headerIdxs` is an alt-fee header that lives
      // below it.
      const ctsSectionEnd = Math.min(nextHeaderIdx, stop);

      // Section title: nearest non-blank single-label row above the
      // header (e.g. "SB Services (CTS w/recommended GM%)"), bounded
      // by the previous header so we don't reach across sections.
      let title = '';
      const lowBound = (headerIdxs[hi - 1] ?? (startIdx - 1)) + 1;
      for (let j = idx - 1; j >= lowBound; j--) {
        const r = rows[j] || [];
        if (rowIsBlank(r)) continue;
        const a = cellStr(r[0]);
        const others = r.slice(1).filter(c => cellStr(c)).length;
        // Skip placeholder lines so they don't become section titles.
        if (/^enter\s+.+\s+here$/i.test(a)) continue;
        // A section-title row has text in col 0 and is otherwise empty.
        if (a && others === 0) { title = a; break; }
        // Stop walking up once we hit something with multiple cells
        // populated (likely another sub-table's data).
        if (others >= 1) break;
      }
      if (!title) {
        title = cellStr(headerRow[cols.description]) || `Section ${hi + 1}`;
      }

      const items = [];
      for (let r = idx + 1; r < ctsSectionEnd; r++) {
        const row = rows[r] || [];
        if (rowIsBlank(row)) continue;
        const desc = cellStr(row[cols.description ?? 0]);
        if (!desc) continue;
        // Skip placeholder rows ("Enter department here", "Enter
        // service here", etc.).
        if (/^enter\s+.+\s+here$/i.test(desc)) continue;
        if (/enter\s+department\s+here/i.test(desc)) continue;
        // Don't consume the end anchor, the GM%/Use Target setup
        // rows, or another section title.
        if (END_ANCHOR_RE.test(desc)) break;
        if (/^(target\s*gm\s*%|use\s*target|delivery\s*team\s*inputs|solution\s*description|are\s+all\s+values)/i.test(desc)) continue;
        // Skip rows whose Type cell is blank — those are unfilled
        // template stubs that show up between real line items.
        if (cols.type !== undefined && !cellStr(row[cols.type])) continue;
        // Skip rows whose Type cell is a header label (e.g. the
        // "Services (per event or shared savings) | Description" row
        // that sits between sub-tables — its col B reads "Description"
        // which clearly isn't a real Type).
        if (cols.type !== undefined) {
          const tval = cellStr(row[cols.type]);
          if (/^(description|type|comments?|fee|unit|cts|cost\s*to\s*serve|gm\s*%|individual\s*gm|start\s*month)$/i.test(tval)) continue;
        }

        const item = {
          id: `${sheetName}::${title}::${items.length}::${desc.slice(0, 40)}`,
          raw: row.slice(),
          description: desc,
          type: cols.type !== undefined ? cellStr(row[cols.type]) : '',
          cts: cols.cts !== undefined ? toNumber(row[cols.cts]) : null,
          startMonth: cols.startMonth !== undefined ? cellStr(row[cols.startMonth]) : '',
          comments: cols.comments !== undefined ? cellStr(row[cols.comments]) : '',
          gmPct: cols.gmPct !== undefined ? toPct(row[cols.gmPct]) : null,
        };
        items.push(item);
      }

      if (items.length > 0) {
        sections.push({ title, headers: headerRow, cols, items });
      }
    }
  }

  // Diagnostic sample so the in-app fallback panel can show the user
  // what was actually read when nothing parses. Trim to the bounded
  // range when the anchors were found so we don't dump the
  // sheet-level metadata (Date / Salesperson / Annual kWh / ...).
  const sampleStart = startIdx >= 0 ? startIdx : 0;
  const sampleEnd = endIdx >= 0 ? Math.min(rows.length, endIdx + 1) : Math.min(rows.length, sampleStart + 80);
  const rawSample = rows.slice(sampleStart, sampleEnd).map(r => (r || []).map(cellStr));
  const rawSampleOffset = sampleStart;

  return {
    sheetName,
    hidden: false, // overwritten by caller
    solutionDescription,
    siteCount,
    accountCount,
    sections,
    altFees,
    rawSample,
    rawSampleOffset,
    totalRows: rows.length,
    startIdx,
    endIdx,
    cellCount,
    refUsed,
  };
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toPct(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? (v > 1 ? v / 100 : v) : null;
  const s = String(v).replace('%', '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

export function parsePricingWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const options = [];
  for (const name of wb.SheetNames || []) {
    const m = name.match(OPTION_RE);
    if (!m) continue;
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const parsed = parseOptionSheet(sheet, name);
    parsed.optionNumber = Number(m[1]);
    parsed.hidden = sheet.Hidden === 1 || sheet.Hidden === 2;
    options.push(parsed);
  }
  options.sort((a, b) => a.optionNumber - b.optionNumber);

  if (options.length === 0) {
    const all = (wb.SheetNames || []).join(', ') || '(none)';
    throw new Error(`No "Option 1/2/3/4/5" sheets found in this workbook. Sheets present: ${all}.`);
  }

  return { options, sheetNames: wb.SheetNames || [] };
}

// Marked-up unit price from cost + gross-margin %. GM is the fraction
// of the *price* that is margin, so price = cost / (1 - gm).
export function priceFromCostAndGm(cost, gmPct) {
  if (cost === null || cost === undefined) return null;
  if (gmPct === null || gmPct === undefined) return null;
  if (gmPct >= 1) return null;
  return cost / (1 - gmPct);
}
````

### src/utils/soldWarningIgnore.js

````javascript
// Persists the "ignore this warning" choices for the Deals-page banner
// that flags Sold Opps 2 opps with no matching deal. Keyed by a stable
// per-opp key (the opp's _id when present, otherwise an account/scope/
// BFO composite) so dismissing one flagged opp doesn't silence the rest.
// Scoped per user via userLs so accounts sharing a browser keep their
// own dismissals.

import { userLsGet, userLsSet, userLsRemove } from './userLs';

const KEY = 'deals-sold-warning-ignore';
export const SOLD_WARNING_IGNORE_EVENT = 'deals-sold-warning-ignore-changed';

export function loadSoldWarningIgnore() {
  try {
    const raw = userLsGet(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(s => String(s || '')).filter(Boolean) : []);
  } catch { return new Set(); }
}

function persist(set) {
  try {
    userLsSet(KEY, JSON.stringify([...set]));
    window.dispatchEvent(new Event(SOLD_WARNING_IGNORE_EVENT));
  } catch (err) {
    console.warn('Failed to persist sold-warning ignore set', err);
  }
}

export function setSoldWarningIgnore(oppKey, ignored) {
  const key = String(oppKey || '').trim();
  if (!key) return;
  const set = loadSoldWarningIgnore();
  if (ignored) set.add(key);
  else set.delete(key);
  persist(set);
}

// Clears every dismissal so all currently-flagged opps reappear. Used by
// the banner's "Reset" affordance.
export function clearSoldWarningIgnore() {
  try {
    userLsRemove(KEY);
    window.dispatchEvent(new Event(SOLD_WARNING_IGNORE_EVENT));
  } catch (err) {
    console.warn('Failed to clear sold-warning ignore set', err);
  }
}
````

### src/utils/targetTier.js

````javascript
// Resolve the Tier a prospect inherits from the Target Accounts list it's
// mapped to. This mirrors the tier resolution My Accounts does, factored
// out so the Clients page can show the same "tier from the mapped target
// account" without duplicating the parse.
//
// Sources, in the order they're consulted:
//   1. settings.targetMap[prospect.id] — the explicit prospect → target
//      account name(s) mapping the user sets on My Accounts.
//   2. A fuzzy name match of the prospect's company against the target
//      list (only when the user never explicitly set/cleared a mapping).

import { matchesCdm, resolveTargetAccountCdm } from './cdmMatch';
import { buildCompanyIndex, findMatchesInIndex } from './companyIndex';

// Pull the company + tier out of a Target Accounts workbook, keeping every
// tier (1–9), not just Tier 1/2. When `scopeToCdm` is true the rows are
// filtered to the configured CDM (matching My Accounts' CDM-scoped parse);
// when false, every rep's rows are kept — used as a fallback so a mapped
// account tiered under another rep / a blank owner cell still resolves.
export function parseTargetAccountTiers(targetAccountsData, cdmName, targetCdmColumn, { scopeToCdm = true } = {}) {
  const data = targetAccountsData;
  if (!data?.sheets) return [];
  const findCol = (r, keywords) => {
    for (const key of Object.keys(r)) {
      const lower = key.toLowerCase();
      for (const kw of keywords) {
        if (lower.includes(kw.toLowerCase())) return String(r[key] || '').trim();
      }
    }
    return '';
  };
  const cdmLastName = (cdmName || '').toLowerCase().split(/\s+/).filter(Boolean).pop() || '';
  const out = [];
  for (const sheetName of data.sheetNames || []) {
    const sheet = data.sheets[sheetName];
    if (!sheet?.records) continue;
    for (const r of sheet.records) {
      if (scopeToCdm) {
        let cdm = resolveTargetAccountCdm(r, targetCdmColumn).toLowerCase();
        if (!cdm && cdmLastName) {
          cdm = String(Object.values(r).find(v => String(v || '').toLowerCase().includes(cdmLastName)) || '').toLowerCase();
        }
        if (!matchesCdm(cdm, cdmName)) continue;
      }
      const company = findCol(r, ['Account', 'Company', 'Account Name', 'Client', 'Name']);
      if (!company) continue;
      let tierRaw = findCol(r, ['Tier', 'Account Tier', 'Tier Level', 'Target']);
      if (!tierRaw) tierRaw = String(Object.values(r).find(v => /Tier\s*[1-9]/i.test(String(v || ''))) || '');
      const m = tierRaw.match(/(?:Tier\s*)?([1-9])/i);
      if (!m) continue;
      out.push({ company: company.trim(), tier: `Tier ${m[1]}` });
    }
  }
  return out;
}

// Build a resolver: prospect → { tier, name, source }. `tier` is '' when
// nothing maps. `name` is the target account the tier came from; `source`
// is 'mapped' (explicit targetMap) or 'fuzzy' (name match). Build once per
// (targetAccountsData, cdmName, settings) change and reuse for every row.
export function buildTargetTierResolver({ targetAccountsData, cdmName, settings }) {
  const targetCdmColumn = settings?.targetCdmColumn;
  const cdmScoped = parseTargetAccountTiers(targetAccountsData, cdmName, targetCdmColumn, { scopeToCdm: true });
  const allReps = parseTargetAccountTiers(targetAccountsData, cdmName, targetCdmColumn, { scopeToCdm: false });
  const targetMap = settings?.targetMap || {};

  const byNameCdm = new Map();
  for (const t of cdmScoped) {
    const k = t.company.toLowerCase().trim();
    if (k && !byNameCdm.has(k)) byNameCdm.set(k, t.tier);
  }
  const byNameAll = new Map();
  for (const t of allReps) {
    const k = t.company.toLowerCase().trim();
    if (k && !byNameAll.has(k)) byNameAll.set(k, t.tier);
  }
  const cdmIndex = buildCompanyIndex(cdmScoped.map(t => t.company));

  const lookupName = (nm) => {
    const k = (nm || '').toLowerCase().trim();
    return byNameCdm.get(k) || byNameAll.get(k) || '';
  };

  return function resolveTargetTier(prospect) {
    if (!prospect) return { tier: '', name: '', source: '' };
    const rawMap = targetMap[prospect.id];
    const hasExplicit = rawMap !== undefined; // explicit empty array = user cleared it
    const names = Array.isArray(rawMap) ? rawMap : (rawMap ? [rawMap] : []);
    if (names.length > 0) {
      for (const nm of names) {
        const t = lookupName(nm);
        if (t) return { tier: t, name: nm, source: 'mapped' };
      }
      // Mapped, but the name isn't on the target list (or has no tier).
      return { tier: '', name: names[0] || '', source: 'mapped' };
    }
    if (!hasExplicit) {
      for (const tName of findMatchesInIndex(cdmIndex, prospect.company || '')) {
        const t = byNameCdm.get((tName || '').toLowerCase().trim());
        if (t) return { tier: t, name: tName, source: 'fuzzy' };
      }
    }
    return { tier: '', name: '', source: '' };
  };
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
