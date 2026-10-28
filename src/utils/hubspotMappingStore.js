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
