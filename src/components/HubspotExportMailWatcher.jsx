// While the app is open, checks Outlook for a new "Dan's Company Export"
// email every few hours and imports it (utils/hubspotExportMailSync.js).
// Renders nothing; the Account move tab shows the last result.
import { useEffect } from 'react';
import { syncHubspotExportMail, exportMailCheckDue, hasOutlookConnection } from '../utils/hubspotExportMailSync';

const POLL_MS = 30 * 60 * 1000;

export function HubspotExportMailWatcher() {
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running || !exportMailCheckDue() || !(await hasOutlookConnection())) return;
      running = true;
      try { await syncHubspotExportMail(); } finally { running = false; }
    };
    // A short delay so the check doesn't compete with the app's first load.
    const first = setTimeout(tick, 20 * 1000);
    const every = setInterval(tick, POLL_MS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);
  return null;
}
