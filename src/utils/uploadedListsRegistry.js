// Lists backed by UploadedListView (IDB rows + per-list mappings in
// settings.listMappings.<storageKey>). Mirrors the storageKey-bearing
// entries in ListsView's SUBTABS. Kept here so views outside ListsView
// (e.g. the prospect-modal lists-match panel) don't have to import the
// ListsView module just to scan every list.
export const UPLOADED_LISTS = [
  { key: 'strategic', label: 'Strategic Accounts', storageKey: 'strategic-accounts-override' },
  { key: 'recaclients', label: 'RECA Clients', storageKey: 'reca-clients-override' },
  { key: 'ecoactclients', label: 'EcoAct Clients', storageKey: 'ecoact-clients-override' },
  { key: 'csrd', label: 'CSRD', storageKey: 'csrd-list-override' },
  { key: 'cdp', label: 'CDP', storageKey: 'cdp-list-override' },
  { key: 'gresb', label: 'GRESB', storageKey: 'gresb-list-override' },
  { key: 'sbt', label: 'SBT', storageKey: 'sbt-list-override' },
  { key: 'ecovadis', label: 'Ecovadis', storageKey: 'ecovadis-list-override' },
  { key: 'unpri', label: 'UN PRI', storageKey: 'unpri-list-override' },
  { key: 'casb', label: 'CA SB', storageKey: 'casb-list-override' },
  { key: 'nzam', label: 'NZAM', storageKey: 'nzam-list-override' },
];
