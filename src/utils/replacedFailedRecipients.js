// Draft Emails' To line: a recipient keeps the address it had when it was
// added, so one whose email failed stayed red (and would be sent to the dead
// address again) even after a new address was chosen on the contact. This
// moves such a recipient onto the contact's current address.
import { normEmail, contactMovedOffEmail } from './badEmails.js';

/**
 * @param recipients     the To line ([{ id, email, ... }])
 * @param contacts       live contacts ([{ id, email }])
 * @param isFailed       (email) => truthy when that address is flagged failed
 * @param failedByContact settings.contactFailedEmails
 * @returns the same array when nothing changes, else a new one with each
 *          failed recipient whose contact now has a different, unflagged
 *          address carrying that address.
 */
export function withReplacedFailedEmails(recipients, contacts, isFailed, failedByContact) {
  const list = Array.isArray(recipients) ? recipients : [];
  if (!list.length || !Array.isArray(contacts) || !contacts.length) return recipients;
  const byId = new Map();
  for (const c of contacts) {
    const id = c?.id ?? c?.vid;
    if (id != null) byId.set(String(id), c);
  }
  const taken = new Set(list.map(r => normEmail(r?.email)).filter(Boolean));
  let changed = false;
  const next = list.map(r => {
    const old = normEmail(r?.email);
    if (!old || !isFailed(old)) return r;
    const live = (r.id != null && byId.get(String(r.id))) || contactMovedOffEmail(old, contacts, failedByContact);
    const fresh = normEmail(live?.email);
    // No new address, the new one is flagged too, or it is already on the
    // To line (swapping would send that person two copies): leave it red.
    if (!fresh || fresh === old || isFailed(fresh) || taken.has(fresh)) return r;
    taken.add(fresh);
    changed = true;
    return { ...r, email: String(live.email).trim() };
  });
  return changed ? next : recipients;
}
