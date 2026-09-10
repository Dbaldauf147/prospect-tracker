import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { matchedSubject, primarySubject } from '../utils/campaignSubjects';

// Read-only loader for this user's saved email campaigns (the same
// `emailCampaigns/{uid}` doc the Email Campaigns tab writes). The Email
// Tracking sub-tab uses it to attribute each tracked send to a campaign,
// and the Prospecting ladder to list the campaigns still going out; it
// never writes, so campaign editing stays in one place.
//
// A live subscription rather than a one-shot read. Both readers are mounted
// for the whole session — the ladder from App itself — so a single read at
// login meant they went on describing the campaigns as they were when the
// user signed in. Pause a campaign on the Email Campaigns tab and the
// ladder would keep listing it as outreach still owed until the page was
// reloaded, which reads as the pause not having worked. onSnapshot also
// covers the write landing from another device or tab.

// A stable empty list, so a reader with nothing to show doesn't hand its
// memos a new array on every render.
const NO_CAMPAIGNS = [];

export function useSavedCampaigns() {
  const { user } = useAuth();
  // Stamped with the uid it was read for, so a sign-out or a switch of
  // account can't briefly show the previous user's campaigns while the new
  // read is in flight: a snapshot that isn't this user's simply reads as
  // "not loaded yet".
  const [state, setState] = useState({ uid: null, campaigns: null });

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return undefined;
    // Firestore answers a local write straight away, before the round trip,
    // so pausing a campaign moves the ladder in the same frame the pill
    // changes on the Email Campaigns tab.
    return onSnapshot(
      doc(db, 'emailCampaigns', uid),
      (snap) => setState({ uid, campaigns: snap.exists() ? (snap.data().campaigns || []) : [] }),
      (err) => {
        // A failed read ends as an empty list — a book with no campaigns in
        // it — rather than sitting on "loading" forever.
        console.error('Failed to load campaigns:', err?.message || err);
        setState({ uid, campaigns: [] });
      },
    );
  }, [user?.uid]);

  const mine = state.uid === (user?.uid || null) ? state.campaigns : null;
  return {
    campaigns: mine || NO_CAMPAIGNS,
    loading: !!user?.uid && mine === null,
  };
}

// Attribute a tracked send to a saved campaign.
//
// Uses the same containment test the campaign report uses to match sent mail
// (see trackingByRecipient): a campaign owns a send when the send's subject
// CONTAINS one of the campaign's subject lines, so a draft that picked up a
// prefix or suffix still counts, and a campaign running two lines claims the
// sends under either. When several campaigns match, the longest — most
// specific — matching line wins; ties keep the earlier campaign.
//
// `campaigns` is the raw saved list; the returned object carries the campaign
// plus its `index` in that list, which is what identifies it for filtering
// and for opening it on the Email Campaigns tab (subjects need not be
// unique), and `subject`, the line that actually matched.
export function campaignForSubject(campaigns, subject) {
  let best = null;
  (campaigns || []).forEach((c, index) => {
    const want = matchedSubject(c, subject);
    if (!want) return;
    if (!best || want.length > best.subjectLength) {
      best = { campaign: c, index, subject: want, subjectLength: want.length };
    }
  });
  return best;
}

export function campaignLabel(c) {
  return c?.title || primarySubject(c) || '(untitled campaign)';
}
