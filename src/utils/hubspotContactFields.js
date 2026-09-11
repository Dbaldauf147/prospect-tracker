// What a cached HubSpot contact is made of, and what the app is allowed to
// write back from one.
//
// Both halves used to be implicit, and the Cell Phone Number paid for it. The
// cache kept a hand-listed subset of each contact — three identical object
// literals in three views — and `mobilephone` was in none of them, nor in the
// properties the sync asked HubSpot for. So every refresh dropped it, the
// contact popup re-opened with the field blank, and because that popup sends
// the whole form on every save, the next edit of any other field pushed the
// blank over HubSpot's copy. The number had to be typed in again, and again.
//
// Hence one shared list (below) that the sync's own property list is tested
// against, and one rule about blanks (further down).

// Keys the cache keeps that HubSpot has no property for — every other key
// here has to be something the sync fetches, or it comes back undefined.
export const LOCAL_CONTACT_KEYS = ['id', 'vid'];

export function slimHubspotContact(c) {
  return {
    id: c.id, vid: c.vid, firstname: c.firstname, lastname: c.lastname,
    email: c.email, phone: c.phone, mobilephone: c.mobilephone,
    jobtitle: c.jobtitle, company: c.company,
    hs_linkedin_url: c.hs_linkedin_url, linkedin_url: c.linkedin_url, hs_linkedinid: c.hs_linkedinid,
    city: c.city, state: c.state, country: c.country,
    dans_tags: c.dans_tags, dan_s_tags: c.dan_s_tags, dans_tag: c.dans_tag,
    decision_maker: c.decision_maker, role: c.role,
    hs_sequences_is_enrolled: c.hs_sequences_is_enrolled,
    notes_last_contacted: c.notes_last_contacted,
  };
}

// Drop the properties a contact form can't honestly speak for: blank, never
// typed in, and missing outright from the record the form was seeded with. A
// blank like that says "nobody told me", not "clear this" — writing it wipes
// whatever HubSpot holds. Clearing a field on purpose still writes, because
// typing in it marks it touched; so does a field the record carries as empty,
// where a blank write is a no-op anyway.
export function withoutUnknownBlanks(props, seed = {}, touched = new Set()) {
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === '' && seed[key] === undefined && !touched.has(key)) continue;
    out[key] = value;
  }
  return out;
}
