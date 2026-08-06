import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

// Read-only loader for this user's saved email campaigns (the same
// `emailCampaigns/{uid}` doc the Email Campaigns tab writes). The Email
// Tracking sub-tab uses it to attribute each tracked send to a campaign;
// it never writes, so campaign editing stays in one place.
export function useSavedCampaigns() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) { setCampaigns([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'emailCampaigns', user.uid));
        if (cancelled) return;
        setCampaigns(snap.exists() ? (snap.data().campaigns || []) : []);
      } catch (err) {
        if (!cancelled) console.error('Failed to load campaigns:', err?.message || err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  return { campaigns, loading };
}

// Attribute a tracked send to a saved campaign.
//
// Uses the same containment test the campaign report uses to match sent mail
// (see trackingByRecipient): a campaign owns a send when the send's subject
// CONTAINS the campaign's subject, so a draft that picked up a prefix or
// suffix still counts. When several campaigns match, the longest — most
// specific — subject wins; ties keep the earlier campaign.
//
// `campaigns` is the raw saved list; the returned object carries the campaign
// plus its `index` in that list, which is what identifies it for filtering
// and for opening it on the Email Campaigns tab (subjects need not be unique).
export function campaignForSubject(campaigns, subject) {
  const sent = String(subject || '').toLowerCase();
  if (!sent) return null;
  let best = null;
  (campaigns || []).forEach((c, index) => {
    const want = String(c?.subject || '').trim().toLowerCase();
    if (!want || !sent.includes(want)) return;
    if (!best || want.length > best.subjectLength) {
      best = { campaign: c, index, subjectLength: want.length };
    }
  });
  return best;
}

export function campaignLabel(c) {
  return c?.title || c?.subject || '(untitled campaign)';
}
