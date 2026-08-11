import { useEffect, useState } from 'react';
import { isAgentsRunDue } from '../utils/agentsRunReminder';

// How often to re-check whether the reminder has come due. The app can sit
// open for days, so without a tick the alert wouldn't appear until a reload.
const TICK_MS = 15 * 60 * 1000;

// Whether the "run the agent prompts" reminder is currently up, shared by the
// Sidebar badge and the Agents page so the two can't disagree. `enabled` gates
// on settings having loaded — an unloaded (empty) settings object has no
// stamp, which would otherwise read as "due" and flash the badge on every
// page load. `snoozedUntil` holds the alert down until it passes; the same
// tick brings the reminder back when a snooze lapses, so nothing has to
// schedule its own timer for the expiry.
export function useAgentsRunDue(lastRunAt, enabled = true, snoozedUntil = '') {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [enabled]);
  if (!enabled) return false;
  return isAgentsRunDue(lastRunAt, now, snoozedUntil);
}
