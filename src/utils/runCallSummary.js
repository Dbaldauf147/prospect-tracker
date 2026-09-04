// Summarising one call, with no React in it.
//
// This used to live entirely inside CallRecordingsView, which meant a
// summary only ever happened where the Summarize button is — the user had
// to open the Call Recordings page and click it, per call, for a call the
// app already had the transcript of. The logic is here so two callers can
// share it: the page (which drives it from the button and reports progress
// into its own UI) and the app-level background pass (which summarises
// what's due from wherever the user happens to be).
//
// Callers supply how to write a stored record and get back what was
// written, rather than having state set for them.

import { summaryForOpp, mergeIntoNotes } from './callRecordingsStore';
import { loadOppsFromCache } from './oppsCache';
import { setOppFields } from './opps2Store';
import { nextStepLinesFromCall, appendNextSteps, callOnOppPatch } from './nextSteps';
import { withLastCallStamp } from './lastCallOnOpp';
import { apiFetch } from './apiFetch';

/**
 * Push a finished summary onto the tagged opp: the AI prose into Notes,
 * the call's follow-ups onto Next Steps, and the call reference.
 *
 * Opt-in on the page, because the prose is the part a user may not want
 * written into their deal automatically.
 */
export async function pushSummaryToOpp({ uid, recordingId, record, persist }) {
  const oppId = record?.oppId;
  if (!oppId) throw new Error('Tag this call to an opportunity first.');
  const block = summaryForOpp(record);
  if (!block) throw new Error('Nothing to push: summarize the call first.');

  // Read the opp's current Notes so the summary is appended to the
  // user's own text rather than replacing it.
  const cache = await loadOppsFromCache();
  const opp = (cache?.records || []).find(r => String(r?._id) === String(oppId));
  if (!opp) throw new Error('That opp is no longer in the Opps cache: open the Opps 2 tab and try again.');

  const patch = { Notes: mergeIntoNotes(opp['Notes'], block, recordingId) };
  // "Last Spoke" is the date the call happened, not today — a call
  // transcribed a week late shouldn't read as a fresh conversation.
  const when = record?.recordedAt ? new Date(record.recordedAt) : null;
  if (when && !Number.isNaN(when.getTime())) {
    patch['Last Spoke'] = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
  }

  // The call's follow-ups, onto the opp's Next Steps checklist — the
  // column Opps 2 shows as "Notes", which is where the rep actually
  // works from. The summary block above lands in the Memo field and is
  // prose about the call; this is the list of what to do next.
  const steps = appendNextSteps(
    opp['Next Steps'], opp['_nextStepsWaiting'], nextStepLinesFromCall(record),
  );
  if (steps.added > 0) {
    patch['Next Steps'] = steps.text;
    patch['_nextStepsWaiting'] = steps.waiting;
  }

  // One write: the steps and their Waiting On array are index-aligned,
  // and an opp holding one without the other reads every step below
  // the break against the wrong Waiting On. The call reference goes in
  // the same write — it is what the Notes popup names as the last
  // conversation, and it explains the steps sitting under it.
  await setOppFields(uid, oppId, withLastCallStamp(patch, opp, record));
  return persist(recordingId, {
    pushedToOppAt: new Date().toISOString(),
    nextStepsPushed: steps.added,
  });
}

/**
 * What the opp learns from a call mapped to it: the call's next steps,
 * and the call itself.
 *
 * Runs at both moments that can make those facts true — tagging a call
 * that already has follow-ups, and summarising one that was tagged
 * before it had any. Either way the user has said which deal this call
 * belongs to, which is what makes its follow-ups that deal's to-do list
 * and makes it that deal's last conversation.
 *
 * This runs on its own rather than through pushSummaryToOpp because the
 * two push different things for different reasons: that one writes AI
 * prose into the Memo field and is opt-in for exactly that reason,
 * while these are the facts of the mapping and are what was asked for.
 *
 * Returns how many next steps were added — zero when the call hasn't
 * been summarised yet, or when the opp already had every one of them.
 * The reference is still stamped in that case.
 */
export async function recordCallOnOpp({ uid, recordingId, record, persist }) {
  const oppId = record?.oppId;
  if (!oppId) return 0;

  const cache = await loadOppsFromCache();
  const opp = (cache?.records || []).find(r => String(r?._id) === String(oppId));
  if (!opp) throw new Error('That opp is no longer in the Opps cache: open the Opps 2 tab and try again.');

  // The steps and the reference together, through the same helper the
  // Opps page's "Calls to map" queue uses — mapping a call means the
  // same thing whichever page it was mapped from.
  const { patch, added } = callOnOppPatch(opp, record);
  if (Object.keys(patch).length === 0) return 0;

  await setOppFields(uid, oppId, patch);
  if (added > 0) await persist(recordingId, { nextStepsPushed: added });
  return added;
}

/**
 * Summarise one call and land the result: the summary onto the record,
 * and whatever the tagged opp is owed.
 *
 * @param {object}   o
 * @param {string}   o.uid           Signed-in user.
 * @param {string}   o.recordingId   Stored record id.
 * @param {object}   o.record        The stored record (company / opp context).
 * @param {string}   o.transcript    What to summarise. Required.
 * @param {object}   [o.meta]        Extra record fields to store alongside
 *                                   the summary (the page passes the live
 *                                   recording's metadata; a background run
 *                                   has none and passes nothing).
 * @param {boolean}  [o.autoPush]    Push the prose onto the opp too.
 * @param {Function} o.persist       (id, patch) => written record | null.
 *
 * @returns {Promise<{ok: boolean, saved: object|null, error: string, oppError: string}>}
 *   `error` means no summary was produced. `oppError` means the summary
 *   was saved but the write to the opp failed — which never discards it.
 */
export async function runCallSummary({
  uid,
  recordingId,
  record = {},
  transcript = '',
  meta = null,
  autoPush = false,
  persist,
}) {
  const idle = { ok: false, saved: null, error: '', oppError: '' };
  if (!String(transcript || '').trim()) {
    return { ...idle, error: 'Transcribe this recording first: there is nothing to summarize.' };
  }

  let data;
  try {
    const r = await apiFetch('/api/call-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        company: record.company || '',
        oppContext: record.oppLabel || '',
        // Who was on the call is what tells an internal meeting from a
        // client one, and machine speaker labels ("A"/"B") don't carry
        // it. Only Granola records have attendees; the others send
        // nothing and the summariser classifies from the transcript.
        attendees: record.attendees || null,
        owner: record.owner || null,
      }),
    });
    data = await r.json().catch(() => ({}));
    if (!r.ok) return { ...idle, error: data.error || `Summary failed (HTTP ${r.status})` };
  } catch (err) {
    return { ...idle, error: err?.message || String(err) };
  }

  const saved = await persist(recordingId, {
    ...(meta || {}),
    meetingType: data.meetingType || '',
    summary: data.summary || '',
    keyItems: data.keyItems || [],
    followUps: data.followUps || [],
    nextSteps: data.nextSteps || '',
    sentiment: data.sentiment || '',
    risks: data.risks || [],
    summarizedAt: new Date().toISOString(),
    summaryClipped: !!data.clipped,
    // A run that got this far starts the attempt counter over, so a call
    // that failed twice and then worked isn't one failure from being
    // given up on.
    autoSummaryAttempts: 0,
    autoSummaryError: '',
  });

  // A summary is the moment a call finally HAS follow-ups, and most
  // calls are tagged long before that: a Granola call is mapped to its
  // deal when it lands, and summarised whenever the rep gets to it.
  // Tagging pushed nothing because there was nothing to push, so
  // without this the steps never reach the opp at all — the one path
  // that would have taken them (the summary push below) is opt-in, and
  // off by default.
  //
  // Which write depends on what the user asked for, and only one of
  // them runs: the summary push carries the follow-ups anyway, so
  // doing both would land the steps twice over — deduped to nothing,
  // but reported as "0 next steps added" on a call that just added
  // several. Without it, the facts of the mapping go on their own —
  // the steps and the call reference, and none of the AI prose that
  // makes the summary push a choice.
  //
  // A failure here is reported but never discards the summary that was
  // just saved.
  let oppError = '';
  if (saved?.oppId) {
    try {
      if (autoPush) await pushSummaryToOpp({ uid, recordingId, record: saved, persist });
      else await recordCallOnOpp({ uid, recordingId, record: saved, persist });
    } catch (err) {
      oppError = autoPush
        ? `Summary saved, but the push to the opp failed: ${err?.message || err}`
        : `Summary saved, but its next steps didn’t reach the opp: ${err?.message || err}`;
    }
  }

  return { ok: true, saved, error: '', oppError };
}
