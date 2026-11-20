// Every saved email campaign each address is on, newest first.
//
// Feeds the Email Campaign column on the HubSpot contacts table: the cell
// shows the latest campaign and its tooltip lists the rest. Dated the way
// the Key Contacts column dates them: a sent row by its sentDate, a row
// still waiting on its first send by when the campaign was saved, so
// somebody just put on this week's campaign reads as on this week's.
//
// Pure (scripts/contactCampaigns.test.mjs).
import { primarySubject } from './campaignSubjects.js';
import { contactAddresses } from './campaignContactLookup.js';

/**
 * @param campaigns saved campaigns ({ title, subjects, savedAt, contacts })
 * @returns Map<email, [{ campaignIndex, name, tsMs, sent, replied }]>
 */
export function campaignsByAddress(campaigns) {
  const map = new Map();
  (campaigns || []).forEach((camp, campaignIndex) => {
    const name = String(camp?.title || '').trim() || primarySubject(camp) || '(untitled campaign)';
    const savedMs = camp?.savedAt ? Date.parse(camp.savedAt) : NaN;
    // One entry per campaign per address: a campaign listing somebody
    // twice is still one campaign they are on, dated by its latest row.
    const mine = new Map();
    for (const ct of camp?.contacts || []) {
      const t = ct?.sentDate ? Date.parse(ct.sentDate) : NaN;
      const sent = Number.isFinite(t);
      const tsMs = sent ? t : (Number.isFinite(savedMs) ? savedMs : 0);
      for (const em of contactAddresses(ct)) {
        const prev = mine.get(em);
        if (!prev || tsMs > prev.tsMs || (tsMs === prev.tsMs && sent && !prev.sent)) {
          mine.set(em, { campaignIndex, name, tsMs, sent, replied: !!ct?.replied || !!prev?.replied });
        } else if (ct?.replied) prev.replied = true;
      }
    }
    for (const [em, entry] of mine) {
      if (!map.has(em)) map.set(em, []);
      map.get(em).push(entry);
    }
  });
  for (const list of map.values()) list.sort((a, b) => b.tsMs - a.tsMs || a.campaignIndex - b.campaignIndex);
  return map;
}
