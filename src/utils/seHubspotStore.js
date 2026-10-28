// The corporate HubSpot portal's records, as Dan last exported them, and his
// company-match overrides (see seHubspotExisting.js), kept in Firestore at
// lookupTables/{uid}/items/se-hubspot so the weekly email job reads the same
// copy the Account move tab writes:
//
//   { companies: [{ id, name, domain, owner }],
//     contacts:  [{ id, email, owner }],
//     overrides: { [prospectId]: recordId | 'new' },
//     meta: { companiesFile, companiesAt, contactsFile, contactsAt } }

import { doc } from 'firebase/firestore';
import { db as firestore } from '../firebase';
import { getDbUserId } from './db';
import { readChunkedDoc, writeChunkedDoc } from './chunkedDoc.js';

export const SE_HUBSPOT_TABLE = 'se-hubspot';

function ref() {
  const uid = getDbUserId();
  if (!uid) throw new Error('Not signed in.');
  return doc(firestore, 'lookupTables', String(uid), 'items', SE_HUBSPOT_TABLE);
}

export const EMPTY_SE_HUBSPOT = { companies: [], contacts: [], overrides: {}, meta: {} };

export async function loadSeHubspot() {
  const got = await readChunkedDoc(ref());
  return { ...EMPTY_SE_HUBSPOT, ...(got?.value || {}) };
}

export async function saveSeHubspot(value) {
  await writeChunkedDoc(ref(), value, {
    meta: { companies: value.companies?.length || 0, contacts: value.contacts?.length || 0 },
  });
}
