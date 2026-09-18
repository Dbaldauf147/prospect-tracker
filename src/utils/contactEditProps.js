// When the contact popup has to re-render.
//
// ContactEditModal is memoised, and its comparator is not only a rendering
// decision: the popup REWRITES whole settings maps. Saving a contact copies
// the map it was handed - ccMap, contactNotes, contactReportsTo and the
// rest - puts this contact's entry in the copy and saves that. So a map the
// comparator lets it keep a stale version of is a copy missing everything
// saved since the popup opened, and saving it puts the old map back: the CC
// address added on the contact before this one disappears, the one removed
// comes back.
//
// Keeping the rule out here is what lets it be tested (see
// scripts/contactEditProps.test.mjs); the module has no React in it.

// The tag list off a contact record, whichever of the three spellings the
// record happens to carry. The popup seeds its tag state from this and the
// comparator decides whether a changed one is worth a re-render - and those
// two reading it differently is how a saved tag never reaches the popup
// that saved it.
export function contactTagString(c) {
  return (c && (c.dans_tags || c.dan_s_tags || c.dans_tag)) || '';
}

// Every saved store the popup is handed and writes back whole.
export const SAVED_STORE_PROPS = [
  'contactNotes', 'contactOldEmails', 'contactOldCompany', 'contactNicknames',
  'contactTeamNames', 'contactReportsTo', 'ccMap', 'toAlsoMap', 'contactFamilies',
  'contactMetInPerson', 'contactInvitedToLouisville', 'contactSentiment', 'contactTagReview',
];

// Two of those stores are the same when they are the same object, or when
// both are empty. The second half matters: a caller passes
// `settings.ccMap || {}`, so a store nobody has written yet arrives as a
// fresh object on every render, and an identity check alone would re-render
// the popup on every keystroke in the company page behind it.
const isEmptyStore = (v) => !v || (typeof v === 'object' && Object.keys(v).length === 0);
export const sameStore = (a, b) => a === b || (isEmptyStore(a) && isEmptyStore(b));

// This contact's membership in each event, plus each event's identity. A
// toggle here has to reach the chips immediately.
const eventSig = (events, id) => JSON.stringify((events || []).map(e => [
  e.id, e.name, (e.attendees || []).some(a => a.contactId && String(a.contactId) === String(id)),
]));

export function contactEditPropsEqual(prev, next) {
  const prevId = prev.contact.id || prev.contact.vid;
  const nextId = next.contact.id || next.contact.vid;
  const domainsEqual = (prev.emailDomains || []).join('|') === (next.emailDomains || []).join('|');
  // Compare the reportsTo array for this specific contact so changes rerender the picker.
  const prevMgrs = JSON.stringify((prev.contactReportsTo || {})[prevId] || []);
  const nextMgrs = JSON.stringify((next.contactReportsTo || {})[nextId] || []);
  const allContactsEqual = (prev.allContacts || []).length === (next.allContacts || []).length;
  const companyContactsEqual = (prev.companyContacts || []).length === (next.companyContacts || []).length
    && (prev.companyContacts || []).every((c, i) => (c.id || c.vid) === ((next.companyContacts || [])[i]?.id || (next.companyContacts || [])[i]?.vid));
  const eventsEqual = eventSig(prev.events, prevId) === eventSig(next.events, nextId);
  // The popup seeds its tag state from this prop and re-seeds when it
  // changes, so a save coming back with a new tag list has to get through.
  // Nothing else here looks at the contact's contents - the id alone is what
  // the rule turns on - so without this a refreshed list could never reach
  // the popup, and the only thing that ever re-rendered it was an unrelated
  // prop changing identity, with the stale list still in hand.
  const tagsEqual = contactTagString(prev.contact) === contactTagString(next.contact);
  const storesEqual = SAVED_STORE_PROPS.every(k => sameStore(prev[k], next[k]));
  return prevId === nextId
    && tagsEqual
    && storesEqual
    && prev.onSave === next.onSave
    && prev.onClose === next.onClose
    && prev.tagOptions === next.tagOptions
    && prev.onSaveNote === next.onSaveNote
    && prev.onSaveOldEmails === next.onSaveOldEmails
    && prev.onSaveOldCompany === next.onSaveOldCompany
    && prev.onSaveNickname === next.onSaveNickname
    && prev.onSaveReportsTo === next.onSaveReportsTo
    && prev.onOpenCompany === next.onOpenCompany
    && prevMgrs === nextMgrs
    && companyContactsEqual
    && allContactsEqual
    && domainsEqual
    && eventsEqual;
}
