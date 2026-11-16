// While the app is open, checks the Outlook inbox every couple of hours for
// delivery-failure notices and flags each address that bounced as a bad
// email (utils/bounceScan.js, utils/badEmails.js). Renders nothing; the
// contact popup and the email campaigns show the flags.
import { useEffect, useMemo, useRef } from 'react';
import { scanForBounces, bounceScanDue } from '../utils/bounceScan';
import { hasOutlookConnection } from '../utils/hubspotExportMailSync';
import { publishBadEmails, clearBadEmailUpdate } from '../utils/badEmails';

const POLL_MS = 30 * 60 * 1000;

export function BouncedEmailWatcher({ badEmails, updateSettings }) {
  const saveRef = useRef(updateSettings);
  useEffect(() => { saveRef.current = updateSettings; }, [updateSettings]);
  // Hand the flags (and Mark fixed) to the contact popup and the campaigns.
  const clear = useMemo(() => (email) => saveRef.current?.(clearBadEmailUpdate(email)), []);
  useEffect(() => { publishBadEmails(badEmails, clear); }, [badEmails, clear]);
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running || !bounceScanDue() || !(await hasOutlookConnection())) return;
      running = true;
      try { await scanForBounces((fn) => saveRef.current?.(fn)); } finally { running = false; }
    };
    const first = setTimeout(tick, 30 * 1000);
    const every = setInterval(tick, POLL_MS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);
  return null;
}
