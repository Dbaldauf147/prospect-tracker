// The Edit HubSpot Contact popup's Email Campaign control: which saved
// campaigns this contact is already on, and a picker to put them on another.
//
// Self-contained on purpose. The popup opens from a dozen pages, and every
// one of them gets this without passing anything new: it reads the saved
// campaigns (emailCampaigns/{uid}) itself and writes the add back the same
// way Draft Emails' "Add to existing campaign" does - a fresh read of the
// list just before the write, so an edit made elsewhere in the meantime
// isn't lost. The row it adds is the campaign page's own manual-add row
// (utils/campaignAddContact.js), so it sits there as "Not Sent" until a
// send under the campaign's subject lines matches it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { primarySubject } from '../../utils/campaignSubjects';
import { addContactToCampaign, campaignHasContact } from '../../utils/campaignAddContact';
import { campaignsByRecency, campaignPickerDetail } from '../../utils/campaignPicker';
import { CampaignPicker } from '../common/CampaignPicker';

// Pages that show campaign membership (the All Contacts columns) listen for
// this to re-read the list after an add.
export const EMAIL_CAMPAIGNS_UPDATED_EVENT = 'email-campaigns-updated';

const campaignLabel = (c) => c?.title || primarySubject(c) || '(untitled campaign)';

export function ContactCampaignAdd({ email, name, company }) {
  const auth = useAuth();
  const uid = auth?.user?.uid || null;
  const [campaigns, setCampaigns] = useState(null); // null = loading
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { ok, text }

  const load = useCallback(async () => {
    if (!uid) { setCampaigns([]); return; }
    try {
      const snap = await getDoc(doc(db, 'emailCampaigns', uid));
      setCampaigns(snap.exists() ? (snap.data().campaigns || []) : []);
    } catch { setCampaigns([]); }
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const trimmed = String(email || '').trim();
  const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  // Indexed against the list as loaded, most recently active campaigns first
  // in the picker (utils/campaignPicker.js).
  const entries = useMemo(() => campaignsByRecency(campaigns)
    .map(({ campaign: c, index }) => ({ index, label: campaignLabel(c), on: hasEmail && campaignHasContact(c, trimmed), c })),
  [campaigns, hasEmail, trimmed]);
  const onCampaigns = useMemo(() => entries.filter(e => e.on), [entries]);
  const offCampaigns = useMemo(() => entries.filter(e => !e.on), [entries]);
  const pickerOptions = useMemo(() => offCampaigns.map(e => ({
    key: String(e.index),
    label: e.label,
    // Every subject line, so a campaign can be found by any of them.
    text: [e.c?.subject, ...(Array.isArray(e.c?.subjects) ? e.c.subjects : [])].filter(Boolean).join(' '),
    detail: campaignPickerDetail(e.c),
  })), [offCampaigns]);

  const add = async () => {
    const target = entries.find(e => String(e.index) === pick);
    if (!target || !uid) return;
    setBusy(true);
    setNote(null);
    try {
      const ref = doc(db, 'emailCampaigns', uid);
      const snap = await getDoc(ref);
      const fresh = snap.exists() ? (snap.data().campaigns || []) : [];
      // Found again by its subject in the fresh copy: the index can move if
      // a campaign was added or deleted elsewhere since the popup opened.
      const key = primarySubject(target.c).toLowerCase();
      const idx = fresh.findIndex(c => primarySubject(c).toLowerCase() === key);
      if (idx === -1) {
        setNote({ ok: false, text: `"${target.label}" no longer exists. Pick another.` });
        setCampaigns(fresh);
        return;
      }
      const { status, campaign } = addContactToCampaign(fresh[idx], { email: trimmed, name, company });
      if (status === 'already') {
        setNote({ ok: true, text: `Already on "${target.label}".` });
        setCampaigns(fresh);
        return;
      }
      if (status !== 'added') {
        setNote({ ok: false, text: status === 'internal' ? '@se.com addresses are left out of campaigns.' : 'This contact needs an email address first.' });
        return;
      }
      const next = fresh.map((c, i) => (i === idx ? campaign : c));
      await setDoc(ref, { campaigns: next, updatedAt: new Date().toISOString() });
      setCampaigns(next);
      setPick('');
      setNote({ ok: true, text: `Added to "${target.label}". It shows as Not Sent until a send under that campaign's subject reaches them.` });
      try { window.dispatchEvent(new CustomEvent(EMAIL_CAMPAIGNS_UPDATED_EVENT)); } catch { /* no window */ }
    } catch (err) {
      setNote({ ok: false, text: `Couldn't add to the campaign: ${err?.message || 'unknown error'}` });
    } finally {
      setBusy(false);
    }
  };

  const disabledWhy = !uid ? 'Sign in to use campaigns'
    : !hasEmail ? 'Add an email address to this contact first'
    : campaigns === null ? 'Loading campaigns'
    : campaigns.length === 0 ? 'No saved campaigns yet. Create one on Draft Emails > Email Campaigns'
    : '';

  return (
    <div
      data-contact-campaigns
      style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', padding: '0.3rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '8px', background: '#fff', maxWidth: '100%' }}
    >
      <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Email Campaign</span>
      {onCampaigns.map(e => (
        <span
          key={e.index}
          title={`On the "${e.label}" campaign`}
          style={{ fontSize: '0.7rem', fontWeight: 600, color: '#1D4ED8', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 999, padding: '1px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >{e.label}</span>
      ))}
      <CampaignPicker
        options={pickerOptions}
        value={pick}
        onChange={(key) => { setPick(key); setNote(null); }}
        disabled={!!disabledWhy || busy || offCampaigns.length === 0}
        title={disabledWhy || (offCampaigns.length === 0 ? 'Already on every saved campaign' : 'Type to search, or pick from the most recent campaigns')}
        ariaLabel="Campaign to add this contact to"
        placeholder={campaigns === null ? 'Loading...' : offCampaigns.length === 0 && campaigns.length > 0 ? 'On every campaign' : 'Add to a campaign...'}
        style={{ width: 240, maxWidth: '100%' }}
      />
      <button
        type="button"
        onClick={add}
        disabled={!pick || busy || !!disabledWhy}
        style={{
          padding: '0.22rem 0.6rem', borderRadius: '6px', border: 'none', fontFamily: 'inherit', fontSize: '0.74rem', fontWeight: 700,
          background: !pick || busy || disabledWhy ? '#CBD5E1' : '#2563EB', color: '#fff', cursor: !pick || busy || disabledWhy ? 'default' : 'pointer',
        }}
      >{busy ? 'Adding...' : 'Add'}</button>
      {note && (
        <span role="status" style={{ flexBasis: '100%', fontSize: '0.68rem', color: note.ok ? '#166534' : '#B91C1C' }}>{note.text}</span>
      )}
    </div>
  );
}
