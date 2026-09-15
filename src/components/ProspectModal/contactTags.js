// The tag vocabulary a contact row is read through, and the two readers of
// it.
//
// Lifted out of ProspectModal so the contacts table can read them without
// importing the modal that renders it. Same functions, same buckets: a
// contact filed under Procurement on the org chart, on the roster table and
// in the five-bucket view is filed there by this one list.

// The five (now six) buckets the org chart groups people into, and the
// colours a chip for each one carries.
export const BUCKETS = [
  { key: 'esg',             label: 'ESG',              tag: 'esg',              accent: '#059669', bg: '#ECFDF5', border: '#6EE7B7', headerBg: '#D1FAE5', headerColor: '#065F46' },
  { key: 'procurement',    label: 'Procurement',      tag: 'procurement',     accent: '#7C3AED', bg: '#F5F3FF', border: '#C4B5FD', headerBg: '#EDE9FE', headerColor: '#4C1D95' },
  { key: 'utilities',      label: 'Utilities',        tag: 'utilities',       accent: '#2563EB', bg: '#EFF6FF', border: '#93C5FD', headerBg: '#DBEAFE', headerColor: '#1E3A8A' },
  { key: 'climaterisk',    label: 'Climate Risk',     tag: 'climate risk',    accent: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5', headerBg: '#FEE2E2', headerColor: '#7F1D1D' },
  { key: 'capitalplanning',label: 'Capital Planning', tag: 'capital planning',accent: '#D97706', bg: '#FFFBEB', border: '#FDE68A', headerBg: '#FEF3C7', headerColor: '#78350F' },
  { key: 'efficiencyrenewables', label: 'Efficiency / Renewables', tag: 'efficiency / renewables', accent: '#0D9488', bg: '#F0FDFA', border: '#5EEAD4', headerBg: '#CCFBF1', headerColor: '#134E4A' },
];

// One contact's tags, lower-cased. The field has three spellings across the
// HubSpot exports we have taken in over the years, and all three are read.
export function getContactTags(c) {
  const raw = c.dans_tags || c.dan_s_tags || c.dans_tag || '';
  return raw.split(';').map(t => t.trim().toLowerCase()).filter(Boolean);
}

export function contactHasTag(c, tag) {
  return getContactTags(c).includes(tag.toLowerCase());
}

export function contactIsHidden(c) {
  return contactHasTag(c, 'hide');
}
