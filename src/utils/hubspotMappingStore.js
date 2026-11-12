// The Hubspot Mapping subtab's export and Dan's links (see hubspotMapping.js),
// kept in Firestore at lookupTables/{uid}/items/hubspot-mapping so the file
// he dropped is still there on his other machine:
//
//   { companies: [{ id, name, owner, targetAccount, lifecycle, ... }],
//     links: { [accountId]: hubspotCompanyId },
//     meta: { file, at } }
//
// Separate from se-hubspot (the whole portal's companies, used by the
// import files): this export holds only Dan's own companies.

import { doc } from 'firebase/firestore';
import { db as firestore } from '../firebase';
import { getDbUserId } from './db';
import { readChunkedDoc, writeChunkedDoc } from './chunkedDoc.js';

export const HUBSPOT_MAPPING_TABLE = 'hubspot-mapping';

function ref() {
  const uid = getDbUserId();
  if (!uid) throw new Error('Not signed in.');
  return doc(firestore, 'lookupTables', String(uid), 'items', HUBSPOT_MAPPING_TABLE);
}

export const EMPTY_HUBSPOT_MAPPING = { companies: [], links: {}, meta: {} };

export async function loadHubspotMapping() {
  const got = await readChunkedDoc(ref());
  return { ...EMPTY_HUBSPOT_MAPPING, ...(got?.value || {}) };
}

export async function saveHubspotMapping(value) {
  await writeChunkedDoc(ref(), value, { meta: { companies: value.companies?.length || 0 } });
}

// The Activity subtab's activity export (utils/hubspotActivity.js), kept
// beside the mapping at lookupTables/{uid}/items/hubspot-activity:
//
//   { activities: [{ companyId, companyName, companyOwner, date, type,
//                    engagementId, createdBy, assignedTo, subject }],
//     meta: { file, at, hasAssignee },
//     ignored: [activityKey] }   (Others' Activity rows Dan ignored)
export const HUBSPOT_ACTIVITY_TABLE = 'hubspot-activity';
export const EMPTY_HUBSPOT_ACTIVITY = { activities: [], meta: {} };

function activityRef() {
  const uid = getDbUserId();
  if (!uid) throw new Error('Not signed in.');
  return doc(firestore, 'lookupTables', String(uid), 'items', HUBSPOT_ACTIVITY_TABLE);
}

export async function loadHubspotActivity() {
  const got = await readChunkedDoc(activityRef());
  return { ...EMPTY_HUBSPOT_ACTIVITY, ...(got?.value || {}) };
}

export async function saveHubspotActivity(value) {
  await writeChunkedDoc(activityRef(), value, { meta: { activities: value.activities?.length || 0 } });
}

// The Contacts subtab's contacts export (utils/hubspotContacts.js), at
// lookupTables/{uid}/items/hubspot-contacts. Each drop replaces it:
//
//   { contacts: [{ contactId, contactName, firstName, lastName, jobTitle,
//                  contactOwner, email, workEmail, emailDomain, phone,
//                  linkedIn, created, lastContacted, companyId,
//                  zoomInfoId, companyName, companyOwner }],
//     meta: { file, at } }
export const HUBSPOT_CONTACTS_TABLE = 'hubspot-contacts';
export const EMPTY_HUBSPOT_CONTACTS = { contacts: [], meta: {} };

function contactsRef() {
  const uid = getDbUserId();
  if (!uid) throw new Error('Not signed in.');
  return doc(firestore, 'lookupTables', String(uid), 'items', HUBSPOT_CONTACTS_TABLE);
}

export async function loadHubspotContacts() {
  const got = await readChunkedDoc(contactsRef());
  return { ...EMPTY_HUBSPOT_CONTACTS, ...(got?.value || {}) };
}

export async function saveHubspotContacts(value) {
  await writeChunkedDoc(contactsRef(), value, { meta: { contacts: value.contacts?.length || 0 } });
}
