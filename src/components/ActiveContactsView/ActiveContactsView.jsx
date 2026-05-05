// Active Contacts page — same layout / interactions as the Key
// Contacts page, but the contact selector is "anyone I've actually
// been emailing with" rather than "tagged Dan Key Target".
//
// We reuse KeyContactsView and just override the selector + copy +
// localStorage prefix so column widths, filters, sort, and view-mode
// preferences are kept distinct from the Key Contacts tab.

import { useState, useEffect, useCallback } from 'react';
import { KeyContactsView } from '../KeyContactsView/KeyContactsView';

const WINDOW_OPTIONS = [
  { key: 30,  label: 'Last 30 days' },
  { key: 90,  label: 'Last 90 days' },
  { key: 180, label: 'Last 180 days' },
  { key: 365, label: 'Last year' },
  { key: 0,   label: 'Any time' },
];

function parseHubspotDate(v) {
  if (!v) return NaN;
  const ts = Date.parse(v);
  if (!Number.isNaN(ts)) return ts;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// A contact is "active" when at least one HubSpot email-activity
// timestamp (sent / replied / opened / clicked / last contacted) sits
// inside the chosen window. Window of 0 → any timestamp present.
function makeActiveSelector(windowDays) {
  const cutoff = windowDays > 0 ? Date.now() - windowDays * 86400000 : null;
  return (c) => {
    const tags = (c.dans_tags || c.dan_s_tags || c.dans_tag || '').toLowerCase();
    if (tags.includes('hide')) return false;
    const fields = [
      c.hs_email_last_send_date,
      c.hs_sales_email_last_replied,
      c.hs_email_last_open_date,
      c.hs_email_last_click_date,
      c.notes_last_contacted,
    ];
    for (const v of fields) {
      const ts = parseHubspotDate(v);
      if (Number.isNaN(ts)) continue;
      if (cutoff === null) return true;
      if (ts >= cutoff) return true;
    }
    return false;
  };
}

export function ActiveContactsView({ prospects = [], onSelectProspect, settings, updateSettings }) {
  const [windowDays, setWindowDays] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('active-contacts:window-days'));
      if (WINDOW_OPTIONS.some(o => o.key === saved)) return saved;
    } catch {}
    return 90;
  });
  useEffect(() => { try { localStorage.setItem('active-contacts:window-days', String(windowDays)); } catch {} }, [windowDays]);
  const selector = useCallback(makeActiveSelector(windowDays), [windowDays]);

  const subtitle = (
    <>
      HubSpot contacts you've emailed back-and-forth with —
      sent, opened, clicked, replied, or otherwise touched in the
      selected window. Toggle <strong>All Contacts</strong> for a flat
      table or <strong>By Company</strong> to roll them up by account.
      {' '}
      <select
        value={windowDays}
        onChange={e => setWindowDays(Number(e.target.value))}
        style={{ marginLeft: 4, fontSize: '0.7rem', padding: '1px 4px', border: '1px solid #CBD5E1', borderRadius: 4, fontFamily: 'inherit' }}
      >
        {WINDOW_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </>
  );

  return (
    <KeyContactsView
      prospects={prospects}
      onSelectProspect={onSelectProspect}
      settings={settings}
      updateSettings={updateSettings}
      storagePrefix="active-contacts"
      pageTitle="Active Contacts"
      pageSubtitle={subtitle}
      emptyTitle="No active contacts found"
      emptyDetail={<>Nothing in HubSpot has email activity in this window. Try widening the range above, or paste new HubSpot data on the HubSpot Contacts tab.</>}
      contactSelector={selector}
    />
  );
}
