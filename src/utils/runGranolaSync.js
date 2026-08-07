// One Granola sync, with no React in it.
//
// This used to live inside CallRecordingsView, which meant it only ran
// while that page was mounted — open the app on any other tab and no
// calls came in. The logic is here so two callers can share it: the page
// (which drives it from its Sync button and reports progress into its own
// UI) and the app-level hourly hook (which runs it in the background from
// wherever the user happens to be).
//
// Callers supply the two things that differ between them — how to read a
// stored record, and how to write one — and get back the strings to show
// rather than having state set for them.

import {
  syncGranolaCalls, recordPatchFor, matchCompanyForCall, daysAgoIso,
  diagnoseEmptySync, DEFAULT_BACKFILL_DAYS,
} from './granolaCalls';
import { buildCompanyGuessIndex } from './companyGuess';
import { autoNaPatchFor } from './callNaRules';

/**
 * Pull calls from Granola into the stored records.
 *
 * Incremental by default: only notes changed since the last sync are
 * fetched in full, with the watermark kept in user settings so it holds
 * across devices. `full` re-reads everything in the back-fill window,
 * which is the repair path when a sync was interrupted.
 *
 * @param {object}   o
 * @param {string}   o.uid            Signed-in user; nothing runs without one.
 * @param {boolean}  [o.full]         Re-read the whole back-fill window.
 * @param {Array}    [o.prospects]    Drives the attendee → company auto-link.
 * @param {object}   [o.settings]     Reads the watermark / cursor off this.
 * @param {Function} [o.updateSettings] Banks the watermark. Optional: a
 *                                    caller without it just re-walks next time.
 * @param {Array}    [o.naRules]      Auto-N/A rules, matched by meeting name.
 * @param {Function} o.getStored      (id) => stored record | null.
 * @param {Function} o.persist        (id, patch) => written record | null.
 * @param {Function} [o.onProgress]   ({imported, updated}) => void.
 *
 * @returns {Promise<{ok: boolean, note: string, error: string, imported: number,
 *                    updated: number, truncated: boolean, worked: boolean}>}
 *   `note` and `error` are ready to show. `worked` means Granola answered,
 *   which is what lets a caller clear a connection status left unknown by a
 *   timed-out probe.
 */
export async function runGranolaSync({
  uid,
  full = false,
  prospects = [],
  settings = {},
  updateSettings,
  naRules = [],
  getStored,
  persist,
  onProgress,
}) {
  const idle = { ok: false, note: '', error: '', imported: 0, updated: 0, truncated: false, worked: false };
  if (!uid) return idle;

  const idx = buildCompanyGuessIndex(prospects || []);
  const watermark = full ? '' : String(settings.granolaSyncedThrough || '');
  const pendingLatest = full ? '' : String(settings.granolaSyncPendingLatest || '');

  const autoLink = (call, stored) => {
    if (stored?.prospectId || stored?.company) return null;
    const match = matchCompanyForCall(call, prospects, idx);
    return match ? { prospectId: match.prospectId, company: match.company } : null;
  };

  try {
    const result = await syncGranolaCalls({
      updatedAfter: watermark,
      // No watermark means a first sync, which would otherwise pull the
      // whole workspace history; cap it at the back-fill window.
      createdAfter: watermark ? '' : daysAgoIso(DEFAULT_BACKFILL_DAYS),
      // Pick up where the last run stopped. A full re-read starts over.
      startCursor: full ? '' : String(settings.granolaSyncCursor || ''),
      shouldFetchDetail: (summary) => {
        if (full) return true;
        const stored = getStored(`granola:${summary.noteId}`);
        if (!stored) return true;
        // Changed in Granola since we stored it, or stored without its
        // transcript (synced before the plan allowed transcripts).
        if (!stored.transcript) return true;
        const seen = String(stored.granolaUpdatedAt || '');
        return !seen || String(summary.updatedAt || '') > seen;
      },
      onCall: async (call) => {
        const stored = getStored(call.id) || null;
        const saved = await persist(call.id, {
          ...recordPatchFor(call),
          ...(autoLink(call, stored) || {}),
          // A recurring meeting the user has already ruled on is N/A
          // by the time it first appears, rather than passing through
          // the queue on its way there. Costs no extra write — the
          // record is being stored anyway — and never touches a call
          // that has been decided by hand.
          ...(autoNaPatchFor(call, naRules, stored) || {}),
        });
        // Throwing is what keeps the watermark honest. A call that
        // wasn't stored has to land in result.errors, because a sync
        // with no errors banks its position — and banking a position
        // over calls that were never written puts them permanently
        // behind the cursor, where only a full re-sync would find them
        // again. Counting this as "imported" was how a wholly failed
        // sync reported success.
        if (!saved) throw new Error('could not be saved');
        return stored ? 'updated' : 'imported';
      },
      onProgress,
    });

    // The high-water mark a resumed walk has to carry. Each leg of a
    // truncated sync only sees its own pages, so the newest updated_at
    // is the newest across all of them, not the newest in the last one.
    // Without this a resume that finished on older pages would move the
    // watermark backwards and re-read those calls on the next sync.
    const newest = result.latest > pendingLatest ? result.latest : pendingLatest;

    // Advance the watermark only when the sync ran clean AND reached the
    // end of the window. A partial sync that moved it would leave the
    // calls it failed on permanently behind the cursor.
    //
    // A clean-but-truncated run instead banks where it stopped, so the
    // next sync carries on from there rather than re-walking the pages
    // it just finished. Errors bank nothing: restarting the window is
    // what gives the notes that failed another go.
    if (result.errors.length === 0) {
      if (result.truncated) {
        updateSettings?.({ granolaSyncCursor: result.nextCursor || '', granolaSyncPendingLatest: newest });
      } else if (newest) {
        updateSettings?.({ granolaSyncedThrough: newest, granolaSyncCursor: '', granolaSyncPendingLatest: '' });
      }
    } else if (settings.granolaSyncCursor || pendingLatest) {
      updateSettings?.({ granolaSyncCursor: '', granolaSyncPendingLatest: '' });
    }

    const counts = [
      result.imported ? `${result.imported} new` : '',
      result.updated ? `${result.updated} updated` : '',
    ].filter(Boolean).join(', ');
    const more = result.truncated ? ' More remain: sync again to pick up where this stopped.' : '';
    // Worth saying: a stale cursor means this run re-covered calls the
    // last one had already done, so the counts read higher than the
    // number of genuinely new calls.
    const again = result.restarted ? ' The saved position had expired, so this read the window from the start.' : '';
    // A sync that ran clean and imported nothing has two very different
    // causes that read identically: Granola had nothing new, or it
    // answered with something this build couldn't read. Say which.
    const diagnosis = counts ? '' : diagnoseEmptySync(result.shape);
    const note = counts
      ? `Synced ${counts} from Granola.${more}${again}`
      : diagnosis
        ? `No calls imported. ${diagnosis}`
        : `Already up to date with Granola.${again}`;

    let error = '';
    if (!counts && diagnosis) error = diagnosis;
    if (result.errors.length > 0) {
      error = `Some calls didn't import: ${result.errors.slice(0, 3).join(' · ')}`;
    }

    return {
      ok: true,
      note,
      error,
      imported: result.imported,
      updated: result.updated,
      truncated: !!result.truncated,
      // Granola answered, whatever it said.
      worked: true,
    };
  } catch (err) {
    return { ...idle, error: err?.message || String(err) };
  }
}
