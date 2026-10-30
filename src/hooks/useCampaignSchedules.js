import { useEffect, useRef } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { EMAIL_CAMPAIGNS_UPDATED_EVENT } from '../components/ProspectModal/ContactCampaignAdd';
import { applyDueSchedules, dueSchedules, localDay, SCHEDULES_SETTINGS_KEY } from '../utils/campaignSchedules';

// How often the clock is checked. A day is the unit a schedule works in, so
// a check every few minutes finds a date coming round (or a laptop waking up
// past it) soon enough, and a check with nothing due costs no read.
const CHECK_MS = 5 * 60 * 1000;

/**
 * Create the yearly email campaigns whose day has come.
 *
 * Lives at the app level, like the Granola sync, because the Email
 * Campaigns tab is only mounted while it is open: a schedule tied to it
 * would wait for somebody to visit the tab.
 *
 * Nothing is read until a schedule is due against the campaigns as last
 * seen; then the write goes through a transaction on emailCampaigns/{uid},
 * re-checked against the stored list, so two tabs or two machines landing
 * on the same morning make the campaign once. The Email Campaigns tab, if
 * it is open, is told to re-read the list.
 */
export function useCampaignSchedules(user, settings, enabled = true) {
  const uid = user?.uid || null;
  const schedules = settings?.[SCHEDULES_SETTINGS_KEY];
  const latest = useRef(schedules);
  latest.current = schedules;
  // The day each schedule was last confirmed done, so a quiet check is free.
  const doneOn = useRef({});
  const running = useRef(false);
  const checkRef = useRef(null);

  useEffect(() => { doneOn.current = {}; }, [uid]);

  useEffect(() => {
    if (!enabled || !uid) return undefined;
    let cancelled = false;

    const check = async () => {
      if (running.current || cancelled) return;
      const today = localDay();
      const list = Array.isArray(latest.current) ? latest.current : [];
      // Due as far as this tab knows: enabled, date reached, not seen made today.
      const maybe = dueSchedules(list, [], today).filter(d => doneOn.current[d.schedule.id] !== today);
      if (!maybe.length) return;
      running.current = true;
      try {
        let created = [];
        await runTransaction(db, async (tx) => {
          const ref = doc(db, 'emailCampaigns', uid);
          const snap = await tx.get(ref);
          const stored = snap.exists() ? (snap.data().campaigns || []) : [];
          const result = applyDueSchedules(stored, list, today);
          created = result.created;
          if (!created.length) return;
          tx.set(ref, { campaigns: result.campaigns, updatedAt: new Date().toISOString() });
        });
        // Done (or blocked, e.g. a subject clash shown on the tab) for today
        // either way: the stored list has been checked.
        for (const d of maybe) doneOn.current[d.schedule.id] = today;
        if (created.length) {
          console.log(`Created ${created.length} scheduled campaign(s): ${created.map(c => c.title).join(', ')}`);
          try { window.dispatchEvent(new CustomEvent(EMAIL_CAMPAIGNS_UPDATED_EVENT)); } catch { /* no window */ }
        }
      } catch (err) {
        console.error('Scheduled campaign check failed:', err?.message || err);
      } finally {
        running.current = false;
      }
    };

    checkRef.current = check;
    check();
    const id = setInterval(check, CHECK_MS);
    return () => { cancelled = true; checkRef.current = null; clearInterval(id); };
  }, [enabled, uid]);

  // A schedule added or edited is looked at straight away rather than on
  // the next tick. Keyed on the content so an unrelated settings write
  // doesn't re-run it.
  const signature = JSON.stringify(schedules || []);
  useEffect(() => {
    doneOn.current = {};
    checkRef.current?.();
  }, [signature]);
}
