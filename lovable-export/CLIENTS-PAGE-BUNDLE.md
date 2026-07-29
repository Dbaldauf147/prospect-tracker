# Clients Page — single-file bundle for Lovable

This document contains **every file** of the self-contained Clients page export,
each under a `### path` heading in a four-backtick fenced block (so files that
themselves contain triple-backticks still render correctly). Recreate the same
folder structure — or paste into Lovable and ask it to scaffold these files —
then run `npm install && npm run dev`. Read the embedded README first for what
was stubbed vs. copied verbatim.

**File index:**

- `README.md`
- `package.json`
- `index.html`
- `vite.config.js`
- `src/main.jsx`
- `src/ClientsApp.jsx`
- `src/components/ClientsView/ClientsView.jsx`
- `src/components/ClientsView/CommissionsView.jsx`
- `src/components/ClientsView/CommissionsPasteImportModal.jsx`
- `src/components/DealsView/DealsView.jsx`
- `src/components/DealsView/PasteImportModal.jsx`
- `src/components/common/DataTable.jsx`
- `src/components/common/DataTable.module.css`
- `src/components/common/columnLinks.jsx`
- `src/utils/db.js`
- `src/utils/opps2Store.js`
- `src/utils/oppsCache.js`
- `src/utils/dealsFormat.js`
- `src/utils/cdmMatch.js`
- `src/utils/clientIssues.js`
- `src/utils/userLs.js`
- `src/utils/dealsStore.js`
- `src/utils/clientManagerStore.js`
- `src/utils/dealClientMap.js`
- `src/utils/commissionsStore.js`
- `src/utils/dealCommissions.js`
- `src/utils/soldWarningIgnore.js`
- `src/utils/dropdownListsStore.js`
- `src/data/sampleData.js`
- `src/data/dropdownLists.js`
- `src/data/enums.js`


### `README.md`

````markdown
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
````


### `package.json`

````json
{
  "name": "clients-page-lovable-export",
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
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^6.0.1",
    "vite": "^8.0.1"
  }
}
````


### `index.html`

````html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Clients Page — Lovable export</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
````


### `vite.config.js`

````jsx
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
````


### `src/main.jsx`

````jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ClientsApp from './ClientsApp';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ClientsApp />
  </StrictMode>
);
````


### `src/ClientsApp.jsx`

````jsx
import { useState, useEffect } from 'react';
import { ClientsView } from './components/ClientsView/ClientsView';
import { seedSampleData, SAMPLE_PROSPECTS, SAMPLE_CDM_NAME } from './data/sampleData';

// Standalone wrapper around the real <ClientsView>. In the full app this
// page receives its props from the top-level App (Firestore prospects,
// the signed-in user's CDM name, a shared settings object, and a setter).
// Here we supply all of that locally:
//
//   - prospects     → the hard-coded SAMPLE_PROSPECTS roster
//   - cdmName       → SAMPLE_CDM_NAME (matches every sample prospect)
//   - settings      → an in-component object; the only thing the Clients
//                     page persists through it is column layout + the
//                     Status-column dropdown binding, so local state is
//                     plenty for a demo
//   - updateSettings→ merges a patch into that object
//   - user          → a stub; the Deals tab passes user.uid to the
//                     (now no-op) opportunities sync
//
// Deals and Commissions seed themselves into localStorage on first load.
export default function ClientsApp() {
  const [settings, setSettings] = useState({});
  const updateSettings = (patch) => setSettings((prev) => ({ ...prev, ...patch }));

  useEffect(() => { seedSampleData(); }, []);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#F8FAFC',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <ClientsView
        prospects={SAMPLE_PROSPECTS}
        cdmName={SAMPLE_CDM_NAME}
        settings={settings}
        updateSettings={updateSettings}
        user={{ uid: 'demo-user' }}
      />
    </div>
  );
}
````


### `src/components/ClientsView/ClientsView.jsx`

````jsx
import { useMemo, useState, useEffect } from 'react';
import { DataTable } from '../common/DataTable';
import { matchesCdm } from '../../utils/cdmMatch';
import { DealsView } from '../DealsView/DealsView';
import { CommissionsView } from './CommissionsView';
import { loadDealsList } from '../../utils/dealsStore';
import { loadDealClientMap, DEALS_CLIENT_MAP_EVENT } from '../../utils/dealClientMap';
import {
  loadClientManagerMap, setClientManager, CLIENT_MANAGER_EVENT,
  loadClientInPersonMap, setClientInPerson, CLIENT_IN_PERSON_EVENT,
  loadClientStatusMap, setClientStatus, CLIENT_STATUS_EVENT,
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

export function ClientsView({ prospects = [], cdmName, settings, updateSettings, user }) {
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
      if (e.key === 'clients-notes-map') setNotesMap(loadClientNotesMap());
      if (e.key === 'clients-untracked-map') setUntrackedMap(loadClientUntrackedMap());
      if (e.key === 'clients-louisville-map') setLouisvilleMap(loadClientLouisvilleMap());
    }
    function onClientMap() { setClientMap(loadDealClientMap()); }
    function onManagerMap() { setManagerMap(loadClientManagerMap()); }
    function onInPersonMap() { setInPersonMap(loadClientInPersonMap()); }
    function onStatusMap() { setStatusMap(loadClientStatusMap()); }
    function onNotesMap() { setNotesMap(loadClientNotesMap()); }
    function onUntrackedMap() { setUntrackedMap(loadClientUntrackedMap()); }
    function onLouisvilleMap() { setLouisvilleMap(loadClientLouisvilleMap()); }
    window.addEventListener('storage', onStorage);
    window.addEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
    window.addEventListener(CLIENT_MANAGER_EVENT, onManagerMap);
    window.addEventListener(CLIENT_IN_PERSON_EVENT, onInPersonMap);
    window.addEventListener(CLIENT_STATUS_EVENT, onStatusMap);
    window.addEventListener(CLIENT_NOTES_EVENT, onNotesMap);
    window.addEventListener(CLIENT_UNTRACKED_EVENT, onUntrackedMap);
    window.addEventListener(CLIENT_LOUISVILLE_EVENT, onLouisvilleMap);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DEALS_CLIENT_MAP_EVENT, onClientMap);
      window.removeEventListener(CLIENT_MANAGER_EVENT, onManagerMap);
      window.removeEventListener(CLIENT_IN_PERSON_EVENT, onInPersonMap);
      window.removeEventListener(CLIENT_STATUS_EVENT, onStatusMap);
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
      setNotesMap(loadClientNotesMap());
      setUntrackedMap(loadClientUntrackedMap());
      setLouisvilleMap(loadClientLouisvilleMap());
    }
  }, [subtab]);

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

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clients.filter(c => {
        const ck = normClientName(c.company);
        return (
          (c.company || '').toLowerCase().includes(q) ||
          (c.cdm || '').toLowerCase().includes(q) ||
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
    return {
      ...c,
      id: c.id,
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
      notes: notesMap[ck] || '',
      untracked,
    };
  }), [filtered, dealsByClient, managerMap, inPersonMap, louisvilleMap, statusMap, notesMap, untrackedMap]);

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
      key: 'Status', label: 'Status', defaultWidth: 160,
      getSortValue: (row) => (row.Status || '').toLowerCase(),
      getFilterValue: (row) => row.Status || '',
      render: (row) => {
        const link = resolveColumnLink('Status', columnLinks);
        if (link) {
          const opts = listRegistry?.get(link.listKey)?.options || [];
          const onChange = (v) => setClientStatus(row.company, v);
          if (link.mode === 'multi') {
            return <MultiSelectCell value={row.Status} onChange={onChange} options={opts} />;
          }
          return <SelectCell value={row.Status} onChange={onChange} options={opts} />;
        }
        return (
          <ClientStatusTextCell
            company={row.company}
            value={row.Status}
            onCommit={setClientStatus}
          />
        );
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
        <DealsView settings={settings} updateSettings={updateSettings} prospects={prospects} cdmName={cdmName} user={user} />
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
          placeholder="Filter by company, CDM, Client Manager, Status, type, website…"
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
              // Tint the row light red when a renewal is closing in
              // (<270 days) and the Status column is unset — those are
              // the clients that need a status set before they slip.
              const s = String(row.Status || '').trim();
              const noStatus = s === '' || s === '-' || s === '—' || s === '–';
              if (row.daysUntilExpiration != null && row.daysUntilExpiration < 270 && noStatus) {
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


### `src/components/ClientsView/CommissionsView.jsx`

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


### `src/components/ClientsView/CommissionsPasteImportModal.jsx`

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


### `src/components/DealsView/DealsView.jsx`

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

function buildColumns(rows, columnLinks, listRegistry, commissionsByBfo) {
  if (!rows.length) return [];
  const keys = new Set();
  // Skip 'id' and any double-underscore internal field (__onUpdate,
  // __newRow, etc.) — those are render-time scaffolding, not data.
  for (const r of rows) for (const k of Object.keys(r)) {
    if (k === 'id' || k.startsWith('__')) continue;
    keys.add(k);
  }
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

export function DealsView({ settings, updateSettings, prospects = [], cdmName, user }) {
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

  const clientNameSet = useMemo(
    () => new Set(clientOptions.map(n => normClient(n))),
    [clientOptions]
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
    // one column can be left-anchored at a time.
    const clientNameCol = { ...baseColumns[0], sticky: false };
    if (clientOptions.length === 0) {
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
            <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: '0.62rem', fontWeight: 700, background: '#DCFCE7', color: '#166534' }} title="Client Name matches an active client">
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
  }, [baseColumns, clientOptions, clientNameSet, clientMap, ignoreSet, prospectByName, columnLinks, listRegistry, selectedIds]);
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
    if (clientOptions.length === 0) return false;
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
    if (clientOptions.length === 0) return 0;
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
  }, [rows, clientNameSet, clientMap, ignoreSet, clientOptions]);

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
        {clientOptions.length > 0 && (
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
              if (clientOptions.length === 0) return undefined;
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


### `src/components/DealsView/PasteImportModal.jsx`

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


### `src/components/common/DataTable.jsx`

````jsx
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import styles from './DataTable.module.css';

const COL_WIDTHS_PREFIX = 'prospect-col-widths-';
const COL_VISIBLE_PREFIX = 'prospect-col-visible-';
const COL_NAMES_PREFIX = 'prospect-col-names-';
const COL_ORDER_PREFIX = 'prospect-col-order-';

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
  if (!Array.isArray(order) || order.length === 0) return columns;
  const byKey = new Map(columns.map(c => [c.key, c]));
  const out = [];
  const used = new Set();
  for (const k of order) {
    const c = byKey.get(k);
    if (c) { out.push(c); used.add(k); }
  }
  for (const c of columns) {
    if (!used.has(c.key)) out.push(c);
  }
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

function ColumnToggle({ columns, visibleCols, onToggle, alwaysVisible, colNames, onRename, onReorder, onResetOrder, removable, onResetColumns }) {
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
                {removable ? 'Drag ⠿ to reorder · × to remove' : 'Drag ⠿ to reorder · uncheck to hide'}
              </span>
              {(removable ? onResetColumns : onResetOrder) && (
                <button
                  type="button"
                  onClick={() => (removable ? onResetColumns() : onResetOrder())}
                  style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.62rem', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '1px 6px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  title={removable ? 'Restore all columns and the default order' : 'Restore the default column order'}
                >{removable ? 'Reset' : 'Reset order'}</button>
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
                      <span title="This column can't be removed" style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', padding: '0 2px' }}>🔒</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggle(col.key)}
                        title="Remove this column (moves to Hidden)"
                        aria-label={`Remove ${labelOf(col)}`}
                        style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '0.95rem', lineHeight: 1, cursor: 'pointer', padding: '0 2px' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#B91C1C'}
                        onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                      >×</button>
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
  if (!settings || !updateSettings || !tableId) return;
  const current = settings.tablePrefs?.[tableId] || {};
  const nextEntry = { ...current };
  if (prefsUpdate.widths !== undefined) nextEntry.widths = encodeRemoteMap(prefsUpdate.widths);
  if (prefsUpdate.visible !== undefined) nextEntry.visible = [...prefsUpdate.visible];
  if (prefsUpdate.names !== undefined) nextEntry.names = encodeRemoteMap(prefsUpdate.names);
  // Order is a plain array of column keys — stored as-is (no map-key
  // encoding needed, and keys like `_select` are fine as array values).
  if (prefsUpdate.order !== undefined) nextEntry.order = [...prefsUpdate.order];
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
  const [colFilters, setColFilters] = useState({});
  const resizingRef = useRef(null);

  // The columns in the user's saved order (defaults to prop order). All
  // rendering — header, body, visibility list, export — runs off this.
  const orderedColumns = useMemo(() => orderColumns(columns, colOrder), [columns, colOrder]);

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
  // Removable mode's Reset: restore every column (all visible) and the
  // default order in one go.
  function resetColumns() {
    const allKeys = new Set(columns.map(c => c.key));
    setVisibleCols(allKeys);
    setColOrder([]);
    persistPrefs(tableId, settings, updateSettings, { visible: allKeys, order: [] });
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
        <ColumnToggle columns={orderedColumns} visibleCols={visibleCols} onToggle={toggleCol} alwaysVisible={alwaysVisible} colNames={colNames} onRename={renameCol} onReorder={reorderCols} onResetOrder={resetColOrder} removable={removableColumns} onResetColumns={resetColumns} />
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


### `src/components/common/DataTable.module.css`

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


### `src/components/common/columnLinks.jsx`

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


### `src/utils/db.js`

````jsx
// SHIM for the Lovable export.
//
// In the original app this module wrapped IndexedDB (per-user object
// stores for cached opportunities, HubSpot data, etc.). The Clients page
// only ever READS one of those caches (the Opps-2 snapshot, via
// oppsCache.js) to cross-reference BFO links on the Deals tab — and it
// already tolerates that cache being empty.
//
// Rather than ship a real IndexedDB layer the export doesn't need, we
// back the same API with an in-memory Map. Nothing persists across a
// page reload, which is fine: the sample Deals/Commissions data lives in
// localStorage (see ../data/sampleData.js), not here.

const mem = new Map();
const composite = (storeName, key) => `${storeName}::${key}`;

export function setDbUserId() {}
export function getDbUserId() { return null; }
export async function openDB() { return null; }

export async function dbGet(storeName, key) {
  return mem.get(composite(storeName, key));
}

export async function dbGetAll() {
  return [];
}

export async function dbPut(storeName, value, key) {
  mem.set(composite(storeName, key ?? 'data'), value);
}

export async function dbDelete(storeName, key) {
  mem.delete(composite(storeName, key));
}
````


### `src/utils/opps2Store.js`

````jsx
// SHIM for the Lovable export.
//
// The original module synced "Opps 2" opportunities to/from Firestore
// (collection `opps2Data`) and an IndexedDB cache. The Clients page only
// touches ONE export from here: `loadOpps2Newest`, which the Deals tab
// uses to flag deals whose linked opportunity is already marked Sold.
//
// With no backend in the export we return null — DealsView reads
// `result?.records` and falls back to an empty list, so the Deals table
// still renders fully from the sample data; it just won't show the
// "linked opp is Sold" cross-reference warning.

export const OPPS2_STORE = 'opps2-cache';
export const OPPS2_CACHE_KEY = 'data';
export const OPPS2_FIRESTORE_COLLECTION = 'opps2Data';

export async function loadOpps2Newest() {
  return null;
}
````


### `src/utils/oppsCache.js`

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


### `src/utils/dealsFormat.js`

````jsx
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


### `src/utils/cdmMatch.js`

````jsx
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
````


### `src/utils/clientIssues.js`

````jsx
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
  if (!deals || deals.length === 0) return { date: null, days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  let bestMs = null;
  for (const d of deals) {
    if (isInactiveAgreement(d)) continue;
    const parsed = asDate(d['End Date']);
    if (!parsed) continue;
    const dayStart = new Date(parsed);
    dayStart.setHours(0, 0, 0, 0);
    const ms = dayStart.getTime();
    if (bestMs == null || ms < bestMs) bestMs = ms;
  }
  if (bestMs == null) return { date: null, days: null };
  return { date: new Date(bestMs), days: Math.round((bestMs - todayMs) / MS_PER_DAY) };
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

// Build the full list of outstanding issues. Each detector contributes
// rows; add more detectors here as new issue classes are mapped.
export function computeIssues({ prospects = [], cdmName, dealsList = [], clientMap = {}, untrackedMap = {} }) {
  const dealsByClient = groupDealsByClient(dealsList, clientMap);
  const issues = [];
  issues.push(...detectNegativeDaysUntil({ prospects, cdmName, dealsByClient, untrackedMap }));
  return issues;
}
````


### `src/utils/userLs.js`

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


### `src/utils/dealsStore.js`

````jsx
// Persists a user-uploaded Deals roster in localStorage, scoped per
// user so accounts sharing a browser don't inherit each other's data.
// No bundled default — the Deals sub-tab starts empty until the user
// uploads their tracker workbook.

import { userLsGet, userLsSet, userLsRemove, userLsHas } from './userLs';

const KEY = 'deals-list-override';

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
}

export function clearDealsOverride() {
  userLsRemove(KEY);
}

export function hasDealsOverride() {
  try { return userLsHas(KEY); } catch { return false; }
}
````


### `src/utils/clientManagerStore.js`

````jsx
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
const NOTES_KEY = 'clients-notes-map';
const UNTRACKED_KEY = 'clients-untracked-map';
const LOUISVILLE_KEY = 'clients-louisville-map';
export const CLIENT_MANAGER_EVENT = 'client-manager-changed';
export const CLIENT_IN_PERSON_EVENT = 'client-inperson-changed';
export const CLIENT_STATUS_EVENT = 'client-status-changed';
export const CLIENT_NOTES_EVENT = 'client-notes-changed';
export const CLIENT_UNTRACKED_EVENT = 'client-untracked-changed';
export const CLIENT_LOUISVILLE_EVENT = 'client-louisville-changed';

function normKey(s) { return String(s || '').trim().toLowerCase(); }

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
  if (!trimmed) delete map[key];
  else map[key] = trimmed;
  persistMap(STATUS_KEY, map, CLIENT_STATUS_EVENT);
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
````


### `src/utils/dealClientMap.js`

````jsx
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


### `src/utils/commissionsStore.js`

````jsx
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
````


### `src/utils/dealCommissions.js`

````jsx
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


### `src/utils/soldWarningIgnore.js`

````jsx
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


### `src/utils/dropdownListsStore.js`

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


### `src/data/sampleData.js`

````jsx
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


### `src/data/dropdownLists.js`

````jsx
// Reference dropdown lists for the Opps workflow. Lifted from the
// shared spreadsheet so the same option vocabulary surfaces inside
// the app — used by the Dropdowns reference tab.
import { PE_STRATEGIES } from './enums';

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


### `src/data/enums.js`

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

