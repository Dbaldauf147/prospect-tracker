// While the app is open, checks every couple of hours for the bounce notices
// Dan has forwarded to the app's mailbox and flags each address that bounced
// as a bad email (utils/bounceScan.js, utils/badEmails.js). Renders nothing; the
// contact popup and the email campaigns show the flags.
import { useEffect, useMemo, useRef } from 'react';
import { scanForBounces, bounceScanDue } from '../utils/bounceScan';
import { publishBadEmails, clearBadEmailUpdate, recordFailedEmailUpdate, removeFailedEmailUpdate } from '../utils/badEmails';

const POLL_MS = 30 * 60 * 1000;

export function BouncedEmailWatcher({ badEmails, contactFailedEmails, updateSettings }) {
  const saveRef = useRef(updateSettings);
  useEffect(() => { saveRef.current = updateSettings; }, [updateSettings]);
  // Hand the flags (and Mark fixed) to the contact popup and the campaigns.
  const clear = useMemo(() => (email) => saveRef.current?.(clearBadEmailUpdate(email)), []);
  // ...and the failed addresses each contact has moved off, with the saves
  // the popup makes when a bounced address is replaced or its chip removed.
  const failedSaves = useMemo(() => ({
    recordFailed: (contactId, email, info) => saveRef.current?.(recordFailedEmailUpdate(contactId, email, info)),
    removeFailed: (contactId, email) => saveRef.current?.(removeFailedEmailUpdate(contactId, email)),
  }), []);
  const failedByContact = useMemo(() => contactFailedEmails || {}, [contactFailedEmails]);
  useEffect(() => { publishBadEmails(badEmails, clear, { failedByContact, ...failedSaves }); }, [badEmails, clear, failedByContact, failedSaves]);
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running || !bounceScanDue()) return;
      running = true;
      try { await scanForBounces((fn) => saveRef.current?.(fn)); } finally { running = false; }
    };
    const first = setTimeout(tick, 30 * 1000);
    const every = setInterval(tick, POLL_MS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);
  return null;
}
