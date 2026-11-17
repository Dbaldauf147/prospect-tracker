// What an active email campaign is still missing, as short warnings for the
// Prospecting ladder's "Reach out to contacts with market updates" step.
//
// Two kinds: gaps in how the campaign was set up (no subject line, no
// category, no Sent To audience ticked, nobody on its list), and sending
// that has not finished. Both are reasons the campaign is not done, so both
// are listed, set-up gaps first since they are the ones to fix before the
// rest of the list goes out. Pure (scripts/campaignWarnings.test.mjs).

import { campaignSubjects } from './campaignSubjects.js';
import { campaignCategory } from './campaignCategory.js';
import { campaignAudience } from './campaignAudience.js';
import { campaignSendStats } from './campaignOutreach.js';

// A subject someone typed as a placeholder is no subject at all.
const PLACEHOLDER_SUBJECT = /^(tbd|tba|todo|n\/?a|-+|\?+)$/i;

/**
 * The warnings for one campaign, in display order:
 * [{ key, text, kind: 'setup' | 'sending' }]. Empty when nothing is owed.
 */
export function campaignWarnings(c) {
  if (!c || typeof c !== 'object') return [];
  const out = [];
  const subjects = campaignSubjects(c).filter(s => !PLACEHOLDER_SUBJECT.test(s));
  if (!subjects.length) out.push({ key: 'subject', kind: 'setup', text: 'No subject line' });
  if (!campaignCategory(c)) out.push({ key: 'category', kind: 'setup', text: 'No category' });
  if (!Object.values(campaignAudience(c)).some(Boolean)) {
    out.push({ key: 'audience', kind: 'setup', text: 'Sent To not ticked' });
  }
  const { total, countedTotal, countedSent, remaining } = campaignSendStats(c);
  if (total <= 0) out.push({ key: 'contacts', kind: 'setup', text: 'No contacts yet' });
  else if (countedTotal > 0 && countedSent <= 0) out.push({ key: 'sending', kind: 'sending', text: 'Nothing sent yet' });
  else if (remaining > 0) out.push({ key: 'sending', kind: 'sending', text: `${remaining} still to send` });
  return out;
}
