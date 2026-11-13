// The saved email campaigns (Draft Emails > Email Campaigns), read the way
// the campaign pop-ups read them and again whenever one of them adds
// someone (EMAIL_CAMPAIGNS_UPDATED_EVENT). Shared by Prospecting > DMs
// Without Activity (its Email Campaign column) and the count of that list
// on the Prospecting badge and ladder, which leaves campaigned people out.
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { EMAIL_CAMPAIGNS_UPDATED_EVENT } from '../components/ProspectModal/ContactCampaignAdd';

/** The campaigns, [] until they load (or with nobody signed in). */
export function useEmailCampaigns() {
  const auth = useAuth();
  const uid = auth?.user?.uid || null;
  const [campaigns, setCampaigns] = useState([]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      if (!uid) { if (live) setCampaigns([]); return; }
      try {
        const snap = await getDoc(doc(db, 'emailCampaigns', uid));
        if (live) setCampaigns(snap.exists() ? (snap.data().campaigns || []) : []);
      } catch { /* keep what we had */ }
    };
    load();
    window.addEventListener(EMAIL_CAMPAIGNS_UPDATED_EVENT, load);
    return () => { live = false; window.removeEventListener(EMAIL_CAMPAIGNS_UPDATED_EVENT, load); };
  }, [uid]);
  return campaigns;
}
