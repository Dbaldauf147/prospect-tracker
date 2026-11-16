// Saving a campaign's "Sent To" tick from a page that only reads the saved
// campaigns (the Prospecting ladder). Reads the stored list first and
// changes that one campaign in it, so nothing another tab saved since this
// page last heard is written back over.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { listWithAudience } from './campaignAudience.js';

export async function saveCampaignAudience(uid, campaign, key, on) {
  if (!uid) throw new Error('Not signed in.');
  const ref = doc(db, 'emailCampaigns', uid);
  const snap = await getDoc(ref);
  const stored = snap.exists() ? (snap.data().campaigns || []) : [];
  const campaigns = listWithAudience(stored, campaign, key, on);
  await setDoc(ref, { campaigns, updatedAt: new Date().toISOString() });
}
